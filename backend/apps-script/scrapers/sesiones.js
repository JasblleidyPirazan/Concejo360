/**
 * Scraper de Sesiones del Concejo de Medellín
 * Siguiendo patrón: extraer → procesar → guardar → resultado
 * Sin screenshots, logs mínimos, funciones cortas
 */

const ScraperSesiones = {
  // Configuración del scraper
  config: {
    get url() { return URLS.sesiones; },
    sheetName: 'sesiones_maestro',
    campos: ['numero', 'fecha', 'hora', 'temas', 'detalle', 'lugar', 'estado', 'fecha_extraccion'],
    maxRetries: 3,
    delayBetweenPages: 600,
    pageSize: 50,
    datatableId: 'proposiciondt-id',
    maxPaginas: 1000,
    maxElapsedMs: 4.5 * 60 * 1000, // 4.5 min, deja 1.5 min para procesar + guardar batch
    chunkPages: 50 // flushear al sheet cada N paginas (visibilidad + tolerancia a cancel)
  },

  /**
   * Función principal - Orquesta extracción incremental:
   *  - Carga estados previos para detección de cambios
   *  - Llama a extraer(), que flushea chunks al sheet via guardarChunk()
   *  - Hace flush final del remanente, persiste cambios y devuelve stats
   *
   * El guardado incremental hace visible el progreso en el sheet durante
   * la corrida y protege contra cancelaciones (manual o por quota): si la
   * ejecución muere en medio, lo guardado hasta el último flush persiste.
   * @returns {Object} Resultado del scraping
   */
  ejecutar() {
    try {
      console.log(`🚀 Iniciando scraper de sesiones (con guardado incremental)`);

      const ctx = {
        estadosPrevios: this.cargarEstadosPrevios(),
        cambios: [],
        stats: { nuevos: 0, actualizados: 0, errores: 0, total: 0 }
      };
      this._ctx = ctx;

      try {
        const sobrante = this.extraer();
        if (sobrante && sobrante.length > 0) this.guardarChunk(sobrante);
      } finally {
        delete this._ctx;
      }

      if (ctx.cambios.length > 0) {
        console.log(`📝 ${ctx.cambios.length} cambio(s) de estado totales`);
        this.logCambios(ctx.cambios);
      }

      return this.resultado({
        nuevos: ctx.stats.nuevos,
        actualizados: ctx.stats.actualizados,
        errores: ctx.stats.errores
      });
    } catch (error) {
      return this.error(error);
    }
  },

  /**
   * Procesa, detecta cambios de estado y guarda un chunk de sesiones raw.
   * Refresca el snapshot de estados para evitar contar dos veces el mismo
   * cambio entre chunks de la misma corrida.
   * @param {Array} rawRows - Sesiones raw recién extraídas
   */
  guardarChunk(rawRows) {
    if (!rawRows || rawRows.length === 0) return;
    const ctx = this._ctx;
    if (!ctx) {
      // Fallback: si alguien llama fuera de ejecutar(), comportarse como save batch simple
      const procesados = this.procesar(rawRows);
      SheetsUtils.guardar(this.config.sheetName, procesados);
      return;
    }

    const procesados = this.procesar(rawRows);
    const cambios = this.detectarCambiosEstado(ctx.estadosPrevios, procesados);
    if (cambios.length > 0) ctx.cambios.push(...cambios);

    const stats = SheetsUtils.guardar(this.config.sheetName, procesados);
    ctx.stats.nuevos += stats.nuevos || 0;
    ctx.stats.actualizados += stats.actualizados || 0;
    ctx.stats.errores += stats.errores || 0;
    ctx.stats.total += procesados.length;

    // Refrescar snapshot con los estados recién escritos (clave compuesta)
    for (const p of procesados) {
      const k = this.claveSesion(p);
      if (k !== '|') ctx.estadosPrevios.set(k, String(p.estado == null ? '' : p.estado).trim());
    }

    console.log(`💾 Chunk save: +${procesados.length} filas (nuevos=${stats.nuevos}, actualizados=${stats.actualizados}, total=${ctx.stats.total})`);
  },

  /**
   * Extrae datos del sitio web SIMI con paginación AJAX de PrimeFaces.
   * Si this._ctx está seteado (caso normal vía ejecutar), flushea al sheet
   * cada chunkPages para mostrar progreso y proteger contra cancelaciones.
   * Si no, acumula todo y devuelve al final (modo "puro").
   * @returns {Array} Sesiones raw NO flusheadas todavía (remanente)
   */
  extraer() {
    const sesionesRaw = [];
    const tStart = Date.now();
    const chunkPages = this.config.chunkPages || 50;

    let inicial = this.fetchInicial();
    if (!inicial) return sesionesRaw;

    let { html, cookies, viewState, viewStateName, formName, datatableId, prependId } = inicial;
    const primeraPagina = this.parsearHtmlSesiones(html);
    sesionesRaw.push(...primeraPagina);
    console.log(`📄 Página 1: ${primeraPagina.length} sesiones (formName=${formName}, prependId=${prependId}, ViewState=${viewState ? 'ok' : 'missing'}, vsName=${viewStateName})`);

    if (!formName || !viewState) {
      this.logDiagnostico(html, formName);
      console.log('⚠️ No se pudo extraer formName/ViewState — devuelvo solo página 1');
      return sesionesRaw;
    }
    if (primeraPagina.length === 0) return sesionesRaw;

    const pageSize = primeraPagina.length;

    // Resume: si hay offset persistido, saltamos directo a esa página vía AJAX.
    // Siempre extraemos página 1 igual (para refrescar las sesiones más recientes
    // y detectar cambios de estado), pero el loop arranca desde resumeFrom.
    const resumeFrom = this.leerResumeOffset();
    let first;
    let pagina;
    if (resumeFrom > pageSize) {
      first = resumeFrom;
      pagina = Math.floor(resumeFrom / pageSize) + 1;
      console.log(`▶️ Reanudando backfill desde first=${resumeFrom} (página ~${pagina}). Saltando ${resumeFrom - pageSize} sesiones ya extraídas en corridas previas.`);
    } else {
      first = pageSize;
      pagina = 2;
    }

    let viewStateActual = viewState;
    let reintentosBootstrap = 0;
    let razonSalida = 'fin natural';

    while (pagina <= this.config.maxPaginas) {
      if (Date.now() - tStart > this.config.maxElapsedMs) {
        razonSalida = `time budget (${Math.round(this.config.maxElapsedMs / 1000)}s)`;
        break;
      }

      Utilities.sleep(this.config.delayBetweenPages);

      const resp = this.fetchPaginaAjax({ first, cookies, viewState: viewStateActual, viewStateName, formName, datatableId, prependId, pageSize });
      if (!resp) { razonSalida = `null response en first=${first}`; break; }

      // ViewExpired / redirect → flush + re-bootstrap una sola vez
      if (resp.error || resp.redirect) {
        if (reintentosBootstrap >= 1) {
          razonSalida = `${resp.error ? 'error' : 'redirect'} persistente en first=${first}`;
          break;
        }
        console.log(`♻️ Detectado ${resp.error ? '<error>' : '<redirect>'} en partial response → flush + re-bootstrap (first=${first})`);
        if (this._ctx && sesionesRaw.length > 0) this.guardarChunk(sesionesRaw.splice(0));
        const nuevo = this.fetchInicial();
        if (!nuevo) { razonSalida = 're-bootstrap fallido'; break; }
        cookies = nuevo.cookies;
        viewStateActual = nuevo.viewState;
        viewStateName = nuevo.viewStateName;
        formName = nuevo.formName;
        prependId = nuevo.prependId;
        reintentosBootstrap++;
        continue;
      }

      const filas = this.parsearHtmlSesiones(resp.html);
      console.log(`📄 Página ${pagina} (first=${first}): ${filas.length} sesiones`);
      if (filas.length === 0) { razonSalida = `página vacía en first=${first}`; break; }

      sesionesRaw.push(...filas);
      if (resp.viewState) viewStateActual = resp.viewState;
      first += filas.length;
      pagina++;

      if (filas.length < pageSize) { razonSalida = `página corta (${filas.length}<${pageSize}) → última`; break; }

      // Flush periódico para visibilidad y resilience
      if (this._ctx && (pagina - 1) % chunkPages === 0 && sesionesRaw.length > 0) {
        this.guardarChunk(sesionesRaw.splice(0));
      }
    }

    if (pagina > this.config.maxPaginas) razonSalida = `maxPaginas ${this.config.maxPaginas} alcanzado`;
    const elapsed = Math.round((Date.now() - tStart) / 1000);
    console.log(`🏁 Extracción: ${pagina - 1} página(s), ${elapsed}s — salida: ${razonSalida}`);

    // Persistir/limpiar el resume offset para la próxima corrida.
    const hitBudget = razonSalida.indexOf('time budget') === 0 || razonSalida.indexOf('maxPaginas') === 0;
    if (hitBudget) {
      this.guardarResumeOffset(first);
    } else if (resumeFrom > 0) {
      console.log(`🎉 Backfill completado — resume offset limpiado`);
      this.limpiarResumeOffset();
    } else {
      // Run normal sin resume previo y terminó natural: nada que limpiar
      this.limpiarResumeOffset();
    }
    return sesionesRaw;
  },

  // === Resume offset (PropertiesService) ===

  RESUME_KEY: 'sesiones_resumeFrom',

  leerResumeOffset() {
    try {
      const v = PropertiesService.getScriptProperties().getProperty(this.RESUME_KEY);
      const n = parseInt(v || '0', 10);
      return isNaN(n) ? 0 : n;
    } catch (e) {
      console.log(`⚠️ leerResumeOffset falló: ${e.message}`);
      return 0;
    }
  },

  guardarResumeOffset(first) {
    try {
      PropertiesService.getScriptProperties().setProperty(this.RESUME_KEY, String(first));
      console.log(`💾 Resume offset = ${first} (próxima corrida continuará desde aquí)`);
    } catch (e) {
      console.log(`⚠️ guardarResumeOffset falló: ${e.message}`);
    }
  },

  limpiarResumeOffset() {
    try {
      PropertiesService.getScriptProperties().deleteProperty(this.RESUME_KEY);
    } catch (e) {
      /* noop */
    }
  },

  /**
   * GET inicial: parsea HTML, captura cookies, ViewState y form que envuelve la datatable.
   * @returns {Object|null} { html, cookies, viewState, formName, datatableId } o null si falla
   */
  fetchInicial() {
    try {
      const response = UrlFetchApp.fetch(this.config.url, {
        method: 'GET',
        headers: this.headersGet(),
        muteHttpExceptions: true,
        followRedirects: true
      });

      if (response.getResponseCode() !== 200) {
        console.log(`❌ GET inicial HTTP ${response.getResponseCode()}`);
        return null;
      }

      const html = response.getContentText();
      const cookies = this.extraerCookies(response);
      const viewState = this.extraerViewState(html);
      const viewStateName = this.detectarNombreViewState(html);
      const formName = this.extraerFormName(html, this.config.datatableId);
      // Si el id renderizado del tbody trae prefijo (formName:proposiciondt-id_data),
      // PrimeFaces está con prependId=true → debemos referenciar la datatable con prefijo.
      const prependId = formName
        ? html.indexOf(`id="${formName}:${this.config.datatableId}_data"`) !== -1
        : false;

      return { html, cookies, viewState, viewStateName, formName, datatableId: this.config.datatableId, prependId };
    } catch (error) {
      console.log(`❌ Error en fetchInicial: ${error.message}`);
      return null;
    }
  },

  /**
   * POST partial-ajax a PrimeFaces para traer la siguiente página de la datatable.
   * @returns {Object|null} { html, viewState } o null si falla
   */
  fetchPaginaAjax({ first, cookies, viewState, viewStateName, formName, datatableId, prependId, pageSize }) {
    try {
      const dtRef = prependId ? `${formName}:${datatableId}` : datatableId;
      const partialPrefix = String(viewStateName).startsWith('jakarta') ? 'jakarta.faces' : 'javax.faces';
      const payload = {
        [`${partialPrefix}.partial.ajax`]: 'true',
        [`${partialPrefix}.source`]: dtRef,
        [`${partialPrefix}.partial.execute`]: dtRef,
        [`${partialPrefix}.partial.render`]: dtRef,
        [`${dtRef}_pagination`]: 'true',
        [`${dtRef}_first`]: String(first),
        [`${dtRef}_rows`]: String(pageSize),
        [`${dtRef}_encodeFeature`]: 'true',
        [formName]: formName,
        [viewStateName]: viewState
      };

      const response = UrlFetchApp.fetch(this.config.url, {
        method: 'POST',
        headers: this.headersAjax(cookies),
        payload: payload,
        muteHttpExceptions: true,
        followRedirects: true
      });

      if (response.getResponseCode() !== 200) {
        console.log(`❌ AJAX HTTP ${response.getResponseCode()} en first=${first}`);
        return null;
      }

      const xml = response.getContentText();

      // JSF/PrimeFaces señala expiración o navegación con <error> o <redirect>.
      // En esos casos el caller debe re-bootstrapear ViewState + cookies.
      if (/<error\b/i.test(xml)) return { html: '', viewState: null, error: true };
      if (/<redirect\b/i.test(xml)) return { html: '', viewState: null, redirect: true };

      const html = this.extraerUpdate(xml, datatableId);
      const viewStateNuevo = this.extraerUpdateViewState(xml);
      return { html, viewState: viewStateNuevo };
    } catch (error) {
      console.log(`❌ Error fetchPaginaAjax first=${first}: ${error.message}`);
      return null;
    }
  },

  headersGet() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9'
    };
  },

  headersAjax(cookies) {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/xml, text/xml, */*; q=0.01',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://simi.concejodemedellin.gov.co',
      'Referer': this.config.url,
      'Cookie': cookies || ''
    };
  },

  extraerCookies(response) {
    try {
      const headers = response.getAllHeaders();
      const raw = headers['Set-Cookie'] || headers['set-cookie'];
      if (!raw) return '';
      const lista = Array.isArray(raw) ? raw : [raw];
      // Quedarse con "name=value" antes del primer ';' por cookie
      return lista.map(c => String(c).split(';')[0]).join('; ');
    } catch (error) {
      return '';
    }
  },

  extraerViewState(html) {
    // Mojarra/MyFaces (javax) y Jakarta Faces 4+ (jakarta), atributos en cualquier orden.
    const nombres = ['javax.faces.ViewState', 'jakarta.faces.ViewState'];
    for (const nombre of nombres) {
      const esc = nombre.replace(/\./g, '\\.');
      const patrones = [
        new RegExp(`name="${esc}"[^>]*value="([^"]+)"`, 'i'),
        new RegExp(`value="([^"]+)"[^>]*name="${esc}"`, 'i'),
        new RegExp(`id="[^"]*${esc}[^"]*"[^>]*value="([^"]+)"`, 'i'),
        new RegExp(`value="([^"]+)"[^>]*id="[^"]*${esc}[^"]*"`, 'i')
      ];
      for (const re of patrones) {
        const m = html.match(re);
        if (m) return m[1];
      }
    }
    // Fallback: cualquier input cuyo name termine en .ViewState
    const fallback = html.match(/name="[^"]*\.ViewState"[^>]*value="([^"]+)"/i) ||
                     html.match(/value="([^"]+)"[^>]*name="[^"]*\.ViewState"/i);
    return fallback ? fallback[1] : null;
  },

  /**
   * Nombre del campo ViewState a usar en el payload AJAX (javax vs jakarta).
   * Inspecciona el HTML para decidir; default = javax.
   */
  detectarNombreViewState(html) {
    if (/jakarta\.faces\.ViewState/i.test(html)) return 'jakarta.faces.ViewState';
    return 'javax.faces.ViewState';
  },

  extraerFormName(html, datatableId) {
    // 1) prependId=true: existe un id "formName:datatableId" o "formName:datatableId_data".
    const reConPrefijo = new RegExp(`id="([^":\\s]+):${datatableId}(?:_data)?"`);
    const conPrefijo = html.match(reConPrefijo);
    if (conPrefijo) return conPrefijo[1];

    // 2) prependId=false: el tbody trae id bare. Hay que buscar el <form> que contiene
    //    la datatable y leer su id.
    const reForm = /<form[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g;
    let m;
    while ((m = reForm.exec(html)) !== null) {
      if (m[2].indexOf(datatableId) !== -1) return m[1];
    }
    return null;
  },

  /**
   * Imprime metadatos del HTML cuando falla la extracción de formName/ViewState.
   * Útil para depurar cambios estructurales en SIMI sin tener que correr diagSesiones.
   */
  logDiagnostico(html, formName) {
    try {
      const formas = (html.match(/<form[^>]*\bid="[^"]+"/g) || []).slice(0, 5);
      const tieneJavax = /javax\.faces\.ViewState/i.test(html);
      const tieneJakarta = /jakarta\.faces\.ViewState/i.test(html);
      const tieneVSgenerico = /viewstate/i.test(html);
      const tieneDT = html.indexOf(this.config.datatableId) !== -1;
      console.log(`🔍 html ${html.length}b | javax.ViewState=${tieneJavax} | jakarta.ViewState=${tieneJakarta} | viewstate(any)=${tieneVSgenerico} | ${this.config.datatableId}=${tieneDT}`);
      console.log(`🔍 Forms: ${formas.length ? formas.join(' | ') : '(ninguno)'}`);

      // Dump hidden inputs dentro del form detectado, para identificar como nombran el ViewState
      if (formName) {
        const escForm = formName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const reForm = new RegExp(`<form[^>]*\\bid="${escForm}"[^>]*>([\\s\\S]*?)<\\/form>`);
        const m = html.match(reForm);
        if (m) {
          const inputs = (m[1].match(/<input[^>]*type="hidden"[^>]*>/gi) || []).slice(0, 8);
          console.log(`🔍 Hidden inputs en form "${formName}": ${inputs.length}`);
          inputs.forEach((inp, i) => console.log(`  [${i}] ${inp.substring(0, 240)}`));
        } else {
          console.log(`🔍 form "${formName}" no matcheo en regex de dump`);
        }
      }
    } catch (e) {
      console.log(`🔍 logDiagnostico falló: ${e.message}`);
    }
  },

  extraerUpdate(xml, datatableId) {
    const re = new RegExp(`<update[^>]*id="[^"]*${datatableId}[^"]*"[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</update>`);
    const m = xml.match(re);
    return m ? m[1] : '';
  },

  extraerUpdateViewState(xml) {
    const m = xml.match(/<update[^>]*id="[^"]*ViewState[^"]*"[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/update>/);
    return m ? m[1] : null;
  },

  /**
   * Parsea HTML y extrae datos de sesiones
   * @param {string} html - HTML de la página
   * @returns {Array} Sesiones parseadas
   */
  parsearHtmlSesiones(html) {
    const sesiones = [];

    try {
      // Funciona tanto para HTML inicial (tbody con id proposiciondt-id_data)
      // como para respuestas partial-ajax que vienen sin tbody envolvente.
      // PrimeFaces marca cada fila de datos con data-ri="N".
      const filasMatch = html.match(/<tr[^>]*data-ri="\d+"[^>]*>[\s\S]*?<\/tr>/g);
      if (!filasMatch) return [];

      for (const fila of filasMatch) {
        const sesion = this.parsearFilaSesion(fila);
        if (sesion) sesiones.push(sesion);
      }

    } catch (error) {
      console.log(`❌ Error parseando HTML: ${error.message}`);
    }

    return sesiones;
  },

  /**
   * Parsea una fila individual de sesión
   * @param {string} filaHtml - HTML de la fila
   * @returns {Object|null} Datos de la sesión o null
   */
  parsearFilaSesion(filaHtml) {
    try {
      // Las celdas reales son <td role="gridcell">. Otros <td> internos no aplican.
      const celdas = filaHtml.match(/<td[^>]*role="gridcell"[^>]*>[\s\S]*?<\/td>/g);
      if (!celdas || celdas.length < 6) return null;

      return {
        numero: this.valorCelda(celdas[0]),
        fecha: this.valorCelda(celdas[1]),
        hora: this.valorCelda(celdas[2]),
        temas: this.extraerTemas(celdas[3]),
        detalle: this.valorCelda(celdas[4]),
        lugar: this.valorCelda(celdas[5]),
        estado: 'Pendiente' // determinarEstado() lo refina segun fecha
      };
    } catch (error) {
      console.log(`❌ Error parseando fila: ${error.message}`);
      return null;
    }
  },

  /**
   * Extrae texto de una celda <td>, descartando el prefijo
   * <span class="ui-column-title">Etiqueta</span> de PrimeFaces responsive.
   */
  valorCelda(celdaHtml) {
    if (!celdaHtml) return '';
    const sinTitle = celdaHtml.replace(/<span[^>]*class="ui-column-title"[^>]*>[\s\S]*?<\/span>/g, '');
    return sinTitle.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  },

  /**
   * Procesa y limpia los datos extraídos
   * @param {Array} datosRaw - Datos sin procesar
   * @returns {Array} Datos procesados y validados
   */
  procesar(datosRaw) {
    const procesados = [];
    
    for (const sesion of datosRaw) {
      try {
        const sesionLimpia = {
          numero: ValidationUtils.limpiarTexto(sesion.numero),
          fecha: this.procesarFecha(sesion.fecha),
          hora: ValidationUtils.limpiarTexto(sesion.hora),
          temas: this.procesarTemas(sesion.temas).join(' | '),
          detalle: ValidationUtils.limpiarTexto(sesion.detalle || ''),
          lugar: ValidationUtils.limpiarTexto(sesion.lugar),
          estado: this.determinarEstado(sesion),
          fecha_extraccion: new Date()
        };
        
        // Validar que la sesión sea válida
        if (ValidationUtils.validarSesion(sesionLimpia)) {
          procesados.push(sesionLimpia);
        }
        
      } catch (error) {
        console.log(`❌ Error procesando sesión ${sesion.numero}: ${error.message}`);
      }
    }
    
    return procesados;
  },

  /**
   * Clave compuesta única para una sesión (numero + fecha).
   * SIMI resetea numero por período, así que numero solo no es único.
   */
  claveSesion(s) {
    const num = String(s == null || s.numero == null ? '' : s.numero).trim();
    const fechaVal = s && s.fecha instanceof Date
      ? String(s.fecha.getTime())
      : String(s == null || s.fecha == null ? '' : s.fecha).trim();
    return `${num}|${fechaVal}`;
  },

  /**
   * Construye Map<claveCompuesta, estado> desde el sheet maestro actual.
   * Si la hoja no existe (primera corrida), devuelve un Map vacío.
   */
  cargarEstadosPrevios() {
    const estados = new Map();
    try {
      const datos = SheetsUtils.obtener(this.config.sheetName);
      for (const d of datos) {
        const k = this.claveSesion(d);
        if (k === '|') continue;
        estados.set(k, String(d.estado == null ? '' : d.estado).trim());
      }
    } catch (e) {
      console.log(`⚠️ No se pudo cargar estados previos: ${e.message}`);
    }
    return estados;
  },

  /**
   * Compara estado previo vs nuevo y arma filas para sesiones_cambios.
   * Solo emite cambios de sesiones que YA existian (las nuevas no son "cambio").
   */
  detectarCambiosEstado(estadosPrevios, sesionesNuevas) {
    const cambios = [];
    const fechaCambio = new Date();
    for (const s of sesionesNuevas) {
      const k = this.claveSesion(s);
      if (k === '|' || !estadosPrevios.has(k)) continue;
      const anterior = estadosPrevios.get(k);
      const nuevo = String(s.estado || '').trim();
      if (anterior === nuevo) continue;
      cambios.push({
        numero: String(s.numero || '').trim(),
        estado_anterior: anterior,
        estado_nuevo: nuevo,
        fecha_cambio: fechaCambio,
        tipo_cambio: this.clasificarCambio(anterior, nuevo)
      });
    }
    return cambios;
  },

  /**
   * Mapea una transición a un tipo de cambio legible.
   */
  clasificarCambio(anterior, nuevo) {
    const a = String(anterior || '').toLowerCase();
    const n = String(nuevo || '').toLowerCase();
    if (a === 'programada' && n === 'realizada') return 'sesion_realizada';
    if (a === 'pendiente' && n === 'programada') return 'sesion_programada';
    if (n === 'cancelada') return 'sesion_cancelada';
    if (n === 'aplazada') return 'sesion_aplazada';
    return 'cambio_estado';
  },

  /**
   * Appende filas en la hoja sesiones_cambios. Si no existe, la crea con
   * headers via SheetsUtils.obtenerOCrearHoja (lee SHEETS_CONFIG.sesiones_cambios).
   */
  logCambios(cambios) {
    try {
      const sheet = SheetsUtils.obtenerOCrearHoja('sesiones_cambios');
      for (const c of cambios) {
        sheet.appendRow([c.numero, c.estado_anterior, c.estado_nuevo, c.fecha_cambio, c.tipo_cambio]);
      }
    } catch (e) {
      console.log(`⚠️ No se pudo escribir sesiones_cambios: ${e.message}`);
    }
  },

  // === Métodos auxiliares ===

  /**
   * Extrae texto limpio de HTML
   * @param {string} html - HTML con texto
   * @returns {string} Texto limpio
   */
  extraerTexto(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').trim();
  },

  /**
   * Extrae array de temas de HTML
   * @param {string} html - HTML con temas
   * @returns {Array} Array de temas
   */
  extraerTemas(html) {
    try {
      const temas = [];
      const labelsMatch = html.match(/<label[^>]*>(.*?)<\/label>/gs);
      
      if (labelsMatch) {
        for (const label of labelsMatch) {
          const texto = this.extraerTexto(label);
          if (texto) temas.push(texto);
        }
      }
      
      return temas;
    } catch (error) {
      return [];
    }
  },

  /**
   * Extrae detalles adicionales de la sesión
   * @param {string} html - HTML con detalles
   * @returns {Array} Array de detalles
   */
  extraerDetalles(html) {
    try {
      const detalles = [];
      const panelsMatch = html.match(/<div[^>]*class="ui-outputpanel"[^>]*>(.*?)<\/div>/gs);
      
      if (panelsMatch) {
        for (const panel of panelsMatch) {
          const detalle = this.parsearDetallePanel(panel);
          if (detalle) detalles.push(detalle);
        }
      }
      
      return detalles;
    } catch (error) {
      return [];
    }
  },

  /**
   * Parsea un panel de detalle individual
   * @param {string} panelHtml - HTML del panel
   * @returns {Object|null} Detalle parseado
   */
  parsearDetallePanel(panelHtml) {
    try {
      const tituloMatch = panelHtml.match(/<label[^>]*style="[^"]*font-weight:bold[^"]*"[^>]*>(.*?)<\/label>/);
      const titulo = tituloMatch ? this.extraerTexto(tituloMatch[1]) : '';
      
      const proponentesMatch = panelHtml.match(/<label[^>]*id="[^"]*j_idt76[^"]*"[^>]*>(.*?)<\/label>/gs);
      const proponentes = proponentesMatch ? proponentesMatch.map(p => this.extraerTexto(p)) : [];
      
      return { titulo, proponentes };
    } catch (error) {
      return null;
    }
  },

  /**
   * Procesa y normaliza fecha
   * @param {string} fechaStr - String de fecha
   * @returns {Date|null} Fecha procesada
   */
  procesarFecha(fechaStr) {
    try {
      if (!fechaStr) return null;
      const fecha = this.parseFechaEspanol(fechaStr) || new Date(fechaStr);
      return ValidationUtils.esFechaValida(fecha) ? fecha : null;
    } catch (error) {
      return null;
    }
  },

  /**
   * Parsea fechas en formato "domingo, 24 de mayo de 2026" -> Date.
   * Devuelve null si no matchea.
   */
  parseFechaEspanol(str) {
    const meses = {
      enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
      julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11
    };
    const m = String(str).toLowerCase().match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/);
    if (!m) return null;
    const mes = meses[m[2]];
    if (mes === undefined) return null;
    return new Date(parseInt(m[3], 10), mes, parseInt(m[1], 10));
  },

  /**
   * Procesa array de temas
   * @param {Array} temas - Array de temas raw
   * @returns {Array} Temas procesados
   */
  procesarTemas(temas) {
    if (!Array.isArray(temas)) return [];
    return temas.map(t => ValidationUtils.limpiarTexto(t)).filter(t => t.length > 0);
  },

  /**
   * Determina el estado de la sesión
   * @param {Object} sesion - Datos de la sesión
   * @returns {string} Estado determinado
   */
  determinarEstado(sesion) {
    const ahora = new Date();
    const fechaSesion = this.procesarFecha(sesion.fecha);
    
    if (!fechaSesion) return 'Pendiente';
    
    if (fechaSesion > ahora) return 'Programada';
    if (fechaSesion <= ahora) return 'Realizada';
    
    return 'Pendiente';
  },

  /**
   * Verifica si existe acta para la sesión
   * @param {string} numeroSesion - Número de sesión
   * @returns {boolean} True si tiene acta
   */
  verificarActa(numeroSesion) {
    try {
      // Verificar en Google Drive si existe PDF
      const nombreArchivo = `acta_sesion_${numeroSesion}.pdf`;
      return DriveUtils.existeArchivo(nombreArchivo);
    } catch (error) {
      return false;
    }
  },

  /**
   * Respuesta exitosa estándar
   * @param {Object} stats - Estadísticas de procesamiento
   * @returns {Object} Respuesta formateada
   */
  resultado(stats) {
    return {
      success: true,
      procesados: stats.nuevos + stats.actualizados,
      nuevos: stats.nuevos,
      actualizados: stats.actualizados,
      errores: stats.errores || 0,
      timestamp: new Date()
    };
  },

  /**
   * Respuesta de error estándar
   * @param {Error} error - Error ocurrido
   * @returns {Object} Respuesta de error
   */
  error(error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date()
    };
  }
};