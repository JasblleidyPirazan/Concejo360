/**
 * Scraper de Acuerdos del Concejo de Medellín
 *
 * Fuente: SIMI – acuerdos.xhtml (datatable "proyectosdt-id" con hyphen,
 * que NO es el mismo de proyectos.xhtml aunque comparten nombre).
 *
 * Estructura del scrape:
 * 1) Pagina el listado (no_acuerdo, no_proyecto_acuerdo, titulo, estado)
 *    via PrimeFaces partial-ajax (mismo flujo que sesiones/proyectos).
 * 2) Por CADA fila dispara un segundo AJAX al botón "ojito"
 *    (source=proyectosdt-id:N:j_idt55, render=pa-invitados-id,pa-detail-id)
 *    que devuelve el modal con dos tabs relevantes:
 *      - "Acuerdo": Título de Acuerdo, Fecha de Sanción, No, Sanción Año,
 *        Gaceta No, Gaceta Año, Astrea (link mojarra.cljs)
 *      - "Proyecto de acuerdo": Consecutivo, Título, Tema, Proponentes,
 *        Comisión, Coordinador, Ponentes
 * 3) Arma tres filas por acuerdo:
 *      - acuerdos_maestro: una fila (no_acuerdo, no_proyecto_acuerdo,
 *        titulo, estado)
 *      - acuerdos_detalle: una fila (no_acuerdo, titulo, fecha_sancion,
 *        ano_sancion, link_astrea, comision)
 *      - acuerdos_concejales: N filas (no_acuerdo, titulo, rol, concejal)
 * 4) Guarda en chunks vía batch upsert para visibilidad y resilience.
 */

const ScraperAcuerdos = {
  config: {
    get url() { return URLS.acuerdos; },
    sheetName: 'acuerdos_maestro',
    detalleSheetName: 'acuerdos_detalle',
    concejalesSheetName: 'acuerdos_concejales',
    datatableId: 'proyectosdt-id', // ¡con hyphen, distinto de proyectos.xhtml!
    detailContainerIds: ['pa-invitados-id', 'pa-detail-id'],
    delayBetweenPages: 400,
    delayBetweenDetails: 100,
    chunkAcuerdos: 30,
    maxPaginas: 300,
    maxElapsedMs: 4.5 * 60 * 1000
  },

  ejecutar() {
    try {
      console.log(`🚀 Iniciando scraper de acuerdos`);

      const ctx = {
        bufferMaestro: [],
        bufferDetalle: [],
        bufferConcejales: [],
        // Cache de acuerdos ya en sheet (no_acuerdo → estado) para saltar
        // el AJAX de detalle cuando el item ya está extraído y su estado
        // no cambió.
        existentes: this.cargarEstadosExistentes(),
        stats: {
          maestro: { nuevos: 0, actualizados: 0, errores: 0 },
          detalle: { nuevos: 0, actualizados: 0, errores: 0 },
          concejales: { nuevos: 0, actualizados: 0, errores: 0 },
          totalAcuerdos: 0,
          detalleFallido: 0,
          saltadosSinCambio: 0,
          cambiosEstado: 0,
          nuevosExtraidos: 0
        }
      };
      console.log(`📋 Cache: ${ctx.existentes.size} acuerdos ya en sheet (se saltará detail si no cambió estado)`);
      this._ctx = ctx;

      try {
        this.extraer();
        if (ctx.bufferMaestro.length > 0 || ctx.bufferDetalle.length > 0 || ctx.bufferConcejales.length > 0) {
          this.flushBuffers();
        }
      } finally {
        delete this._ctx;
      }

      const s = ctx.stats;
      console.log(`📊 Resumen: ${s.totalAcuerdos} listados | ${s.nuevosExtraidos} con detail fetch | ${s.saltadosSinCambio} saltados | ${s.cambiosEstado} con cambio de estado`);
      return {
        success: true,
        procesados: s.totalAcuerdos,
        nuevos: s.maestro.nuevos,
        actualizados: s.maestro.actualizados,
        errores: s.maestro.errores + s.detalle.errores + s.concejales.errores,
        detalle_nuevos: s.detalle.nuevos,
        detalle_actualizados: s.detalle.actualizados,
        concejales_nuevos: s.concejales.nuevos,
        concejales_actualizados: s.concejales.actualizados,
        detalle_fallido: s.detalleFallido,
        saltados_sin_cambio: s.saltadosSinCambio,
        cambios_estado: s.cambiosEstado,
        nuevos_extraidos: s.nuevosExtraidos,
        timestamp: new Date()
      };
    } catch (error) {
      console.log(`❌ Error en ScraperAcuerdos: ${error.message}`);
      return { success: false, error: error.message, timestamp: new Date() };
    }
  },

  flushBuffers() {
    const ctx = this._ctx;
    if (!ctx) return;

    if (ctx.bufferMaestro.length > 0) {
      const stats = SheetsUtils.guardar(this.config.sheetName, ctx.bufferMaestro);
      ctx.stats.maestro.nuevos += stats.nuevos || 0;
      ctx.stats.maestro.actualizados += stats.actualizados || 0;
      ctx.stats.maestro.errores += stats.errores || 0;
      console.log(`💾 Maestro chunk: +${ctx.bufferMaestro.length} (nuevos=${stats.nuevos}, actualizados=${stats.actualizados})`);
      ctx.bufferMaestro = [];
    }

    if (ctx.bufferDetalle.length > 0) {
      const stats = SheetsUtils.guardar(this.config.detalleSheetName, ctx.bufferDetalle);
      ctx.stats.detalle.nuevos += stats.nuevos || 0;
      ctx.stats.detalle.actualizados += stats.actualizados || 0;
      ctx.stats.detalle.errores += stats.errores || 0;
      console.log(`💾 Detalle chunk: +${ctx.bufferDetalle.length} (nuevos=${stats.nuevos}, actualizados=${stats.actualizados})`);
      ctx.bufferDetalle = [];
    }

    if (ctx.bufferConcejales.length > 0) {
      const stats = SheetsUtils.guardar(this.config.concejalesSheetName, ctx.bufferConcejales);
      ctx.stats.concejales.nuevos += stats.nuevos || 0;
      ctx.stats.concejales.actualizados += stats.actualizados || 0;
      ctx.stats.concejales.errores += stats.errores || 0;
      console.log(`💾 Concejales chunk: +${ctx.bufferConcejales.length} (nuevos=${stats.nuevos}, actualizados=${stats.actualizados})`);
      ctx.bufferConcejales = [];
    }
  },

  extraer() {
    const tStart = Date.now();
    const inicial = this.fetchInicial();
    if (!inicial) return;

    let { html, cookies, viewState, viewStateName, formName, datatableId, prependId } = inicial;
    const primerasFilas = this.parsearFilasListado(html);
    console.log(`📄 Página 1: ${primerasFilas.length} acuerdos (formName=${formName}, prependId=${prependId}, ViewState=${viewState ? 'ok' : 'missing'}, vsName=${viewStateName})`);

    if (!formName || !viewState) {
      this.logDiagnostico(html, formName);
      console.log('⚠️ No se pudo extraer formName/ViewState — abortando');
      return;
    }
    if (primerasFilas.length === 0) return;

    let viewStateActual = viewState;
    viewStateActual = this.procesarFilasListado(primerasFilas, { cookies, viewState: viewStateActual, viewStateName, formName, prependId });

    const pageSize = primerasFilas.length;

    // Resume: si hay offset persistido, saltamos directo a esa página vía AJAX.
    // Igual que en sesiones: siempre se extrae página 1 (para refrescar las más
    // recientes y detectar cambios de estado), y el loop arranca desde resumeFrom.
    const resumeFrom = this.leerResumeOffset();
    let first;
    let pagina;
    if (resumeFrom > pageSize) {
      first = resumeFrom;
      pagina = Math.floor(resumeFrom / pageSize) + 1;
      console.log(`▶️ Reanudando backfill desde first=${resumeFrom} (página ~${pagina}). Saltando ${resumeFrom - pageSize} acuerdos ya extraídos.`);
    } else {
      first = pageSize;
      pagina = 2;
    }

    let reintentos = 0;
    let salida = 'fin natural';
    let acuerdosProcesados = primerasFilas.length;
    let ultimoFlush = 0;

    while (pagina <= this.config.maxPaginas) {
      if (Date.now() - tStart > this.config.maxElapsedMs) {
        salida = `time budget (${Math.round(this.config.maxElapsedMs / 1000)}s)`;
        break;
      }

      Utilities.sleep(this.config.delayBetweenPages);

      const resp = this.fetchPaginaAjax({ first, cookies, viewState: viewStateActual, viewStateName, formName, datatableId, prependId, pageSize });
      if (!resp) { salida = `null resp first=${first}`; break; }

      if (resp.error || resp.redirect) {
        if (reintentos >= 1) { salida = `${resp.error ? 'error' : 'redirect'} persistente first=${first}`; break; }
        console.log(`♻️ ${resp.error ? '<error>' : '<redirect>'} → flush + re-bootstrap (first=${first})`);
        this.flushBuffers();
        const nuevo = this.fetchInicial();
        if (!nuevo) { salida = 're-bootstrap fail'; break; }
        cookies = nuevo.cookies;
        viewStateActual = nuevo.viewState;
        viewStateName = nuevo.viewStateName;
        formName = nuevo.formName;
        prependId = nuevo.prependId;
        reintentos++;
        continue;
      }

      const filas = this.parsearFilasListado(resp.html);
      console.log(`📄 Página ${pagina} (first=${first}): ${filas.length} acuerdos`);
      if (filas.length === 0) { salida = `página vacía first=${first}`; break; }

      if (resp.viewState) viewStateActual = resp.viewState;
      viewStateActual = this.procesarFilasListado(filas, { cookies, viewState: viewStateActual, viewStateName, formName, prependId });

      first += filas.length;
      pagina++;
      acuerdosProcesados += filas.length;

      if (filas.length < pageSize) { salida = `página corta ${filas.length}<${pageSize}`; break; }

      if (acuerdosProcesados - ultimoFlush >= this.config.chunkAcuerdos) {
        this.flushBuffers();
        ultimoFlush = acuerdosProcesados;
      }
    }

    if (pagina > this.config.maxPaginas) salida = `maxPaginas ${this.config.maxPaginas}`;
    const elapsed = Math.round((Date.now() - tStart) / 1000);
    console.log(`🏁 Extracción: ${pagina - 1} página(s), ${acuerdosProcesados} acuerdos, ${elapsed}s — salida: ${salida}`);

    // Persistir / limpiar resume offset según razón de salida
    const hitBudget = salida.indexOf('time budget') === 0 || salida.indexOf('maxPaginas') === 0;
    if (hitBudget) {
      this.guardarResumeOffset(first);
    } else if (resumeFrom > 0) {
      console.log(`🎉 Backfill acuerdos completado — resume offset limpiado`);
      this.limpiarResumeOffset();
    } else {
      this.limpiarResumeOffset();
    }
  },

  /**
   * Construye Map<no_acuerdo, estado> leyendo el sheet acuerdos_maestro
   * UNA sola vez al inicio. Permite saltar el AJAX de detalle si el
   * acuerdo ya está en el sheet y su estado no cambió.
   */
  cargarEstadosExistentes() {
    const m = new Map();
    try {
      const datos = SheetsUtils.obtener(this.config.sheetName);
      for (const d of datos) {
        const k = String(d.no_acuerdo == null ? '' : d.no_acuerdo).trim();
        if (!k) continue;
        m.set(k, String(d.estado == null ? '' : d.estado).trim());
      }
    } catch (e) {
      console.log(`⚠️ No se pudo cargar estados existentes: ${e.message}`);
    }
    return m;
  },

  // === Resume offset (PropertiesService) ===

  RESUME_KEY: 'acuerdos_resumeFrom',

  leerResumeOffset() {
    try {
      const v = PropertiesService.getScriptProperties().getProperty(this.RESUME_KEY);
      const n = parseInt(v || '0', 10);
      return isNaN(n) ? 0 : n;
    } catch (e) {
      return 0;
    }
  },

  guardarResumeOffset(first) {
    try {
      PropertiesService.getScriptProperties().setProperty(this.RESUME_KEY, String(first));
      console.log(`💾 Resume offset acuerdos = ${first} (próxima corrida continúa desde aquí)`);
    } catch (e) {
      console.log(`⚠️ guardarResumeOffset falló: ${e.message}`);
    }
  },

  limpiarResumeOffset() {
    try {
      PropertiesService.getScriptProperties().deleteProperty(this.RESUME_KEY);
    } catch (e) { /* */ }
  },

  /**
   * Para cada fila del listado dispara el AJAX al botón "ojito" y parsea
   * el detalle, acumulando en los buffers.
   */
  procesarFilasListado(filasListado, ctxAjax) {
    let viewState = ctxAjax.viewState;
    for (const filaList of filasListado) {
      this._ctx.stats.totalAcuerdos++;

      // Fast path: si ya está en cache con el MISMO estado, skip completo (~0ms).
      // Las columnas de maestro (no_acuerdo, no_proyecto_acuerdo, titulo,
      // estado) están todas en el listado actual; si el estado no cambió,
      // nada que actualizar y los datos de detalle (fecha_sancion, comision,
      // concejales) ya fueron extraídos en una corrida previa.
      const estadoGuardado = this._ctx.existentes.get(filaList.no_acuerdo);
      const estadoActual = String(filaList.estado || '').trim();
      if (estadoGuardado !== undefined && estadoGuardado === estadoActual) {
        this._ctx.stats.saltadosSinCambio++;
        continue;
      }

      // Cambio de estado o item nuevo: necesitamos detail completo
      const esCambioEstado = estadoGuardado !== undefined;
      if (esCambioEstado) this._ctx.stats.cambiosEstado++;
      else this._ctx.stats.nuevosExtraidos++;

      Utilities.sleep(this.config.delayBetweenDetails);

      const respDetalle = this.fetchDetalleAjax({
        eyeButtonId: filaList.eyeButtonId,
        cookies: ctxAjax.cookies,
        viewState,
        viewStateName: ctxAjax.viewStateName,
        formName: ctxAjax.formName
      });

      if (!respDetalle || !respDetalle.html) {
        console.log(`⚠️ Detalle vacío para acuerdo ${filaList.no_acuerdo} (eye=${filaList.eyeButtonId})`);
        this._ctx.stats.detalleFallido++;
        // Guardar al menos lo del listado
        this._ctx.bufferMaestro.push(this.armarFilaMaestro(filaList));
        continue;
      }
      if (respDetalle.viewState) viewState = respDetalle.viewState;

      const detalle = this.parsearDetalle(respDetalle.html);
      this._ctx.bufferMaestro.push(this.armarFilaMaestro(filaList));
      this._ctx.bufferDetalle.push(this.armarFilaDetalle(filaList, detalle));
      const concejales = this.armarFilasConcejales(filaList, detalle);
      this._ctx.bufferConcejales.push(...concejales);

      // Refrescar cache para que la misma corrida no re-procese si vuelve a aparecer
      this._ctx.existentes.set(filaList.no_acuerdo, estadoActual);
    }
    return viewState;
  },

  // === Listado ===

  parsearFilasListado(html) {
    const filas = [];
    try {
      const filasMatch = html.match(/<tr[^>]*data-ri="\d+"[^>]*>[\s\S]*?<\/tr>/g);
      if (!filasMatch) return [];
      for (const fila of filasMatch) {
        const parsed = this.parsearFilaListado(fila);
        if (parsed) filas.push(parsed);
      }
    } catch (error) {
      console.log(`❌ Error parseando filas listado: ${error.message}`);
    }
    return filas;
  },

  parsearFilaListado(filaHtml) {
    try {
      const celdas = filaHtml.match(/<td[^>]*role="gridcell"[^>]*>[\s\S]*?<\/td>/g);
      if (!celdas || celdas.length < 4) return null;

      const no_acuerdo = this.valorCelda(celdas[0]);
      const no_proyecto_acuerdo = this.valorCelda(celdas[1]);
      const titulo = this.valorCelda(celdas[2]);
      const estado = this.valorCelda(celdas[3]);

      const idMatch = filaHtml.match(/<button[^>]*id="([^"]*j_idt\d+)"[^>]*onclick="PrimeFaces\.ab/);
      const eyeButtonId = idMatch ? idMatch[1] : null;

      const riMatch = filaHtml.match(/data-ri="(\d+)"/);
      const rowIndex = riMatch ? parseInt(riMatch[1], 10) : -1;

      if (!no_acuerdo || !eyeButtonId) return null;

      return { no_acuerdo, no_proyecto_acuerdo, titulo, estado, eyeButtonId, rowIndex };
    } catch (error) {
      return null;
    }
  },

  valorCelda(celdaHtml) {
    if (!celdaHtml) return '';
    const sinTitle = celdaHtml.replace(/<span[^>]*class="ui-column-title"[^>]*>[\s\S]*?<\/span>/g, '');
    return sinTitle.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  },

  // === Detalle (parseo de los tabs Acuerdo + Proyecto de acuerdo) ===

  parsearDetalle(html) {
    return {
      // Tab "Acuerdo"
      tituloAcuerdo: (this.extraerCampoDetalle(html, 'Título de Acuerdo')[0] || ''),
      fechaSancion: this.parseFechaEspanol(this.extraerCampoDetalle(html, 'Fecha de Sanción')[0] || ''),
      anoSancion: (this.extraerCampoDetalle(html, 'Sanción Año')[0] || ''),
      linkAstrea: this.extraerLinkAstrea(html),

      // Tab "Proyecto de acuerdo"
      tema: (this.extraerCampoDetalle(html, 'Tema')[0] || ''),
      proponentes: this.extraerCampoDetalle(html, 'Proponentes'),
      comision: (this.extraerCampoDetalle(html, 'Comisión')[0] || ''),
      coordinador: (this.extraerCampoDetalle(html, 'Coordinador')[0] || ''),
      ponentes: this.extraerCampoDetalle(html, 'Ponentes')
    };
  },

  /**
   * Extrae los valores de un campo del detalle. Estructura típica:
   *   <label ...>NOMBRE:</label>
   *   <div class="col-12 md:col-10">
   *     <label><span class="ui-outputlabel-label">VALOR</span></label>
   *     ...
   *   </div>
   */
  extraerCampoDetalle(html, nombreCampo) {
    const nombreEsc = nombreCampo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<label[^>]*>\\s*${nombreEsc}\\s*:?\\s*</label>\\s*<div\\s+class="col-12 md:col-10"[^>]*>([\\s\\S]*?)</div>`, 'i');
    const m = html.match(re);
    if (!m) return [];

    const block = m[1];
    const valores = [];
    const reSpan = /<span class="ui-outputlabel-label">([\s\S]*?)<\/span>/g;
    let sm;
    while ((sm = reSpan.exec(block)) !== null) {
      const v = sm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      if (v) valores.push(v);
    }
    return valores;
  },

  /**
   * El link Astrea en SIMI es un <a> que hace mojarra.cljs (submit del form,
   * no es un URL HTTP directo). Si encontramos href real (http) lo devolvemos;
   * si solo hay un onclick mojarra, devolvemos el texto del link como marker.
   */
  extraerLinkAstrea(html) {
    const re = /<label[^>]*>\s*Astrea\s*:?\s*<\/label>\s*<div\s+class="col-12 md:col-10"[^>]*>([\s\S]*?)<\/div>/i;
    const m = html.match(re);
    if (!m) return '';

    const block = m[1];
    const aMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!aMatch) return '';

    const href = aMatch[1];
    const text = aMatch[2].replace(/<[^>]+>/g, '').trim();
    if (href && href !== '#' && /^https?:/i.test(href)) return href;
    return text || 'SI';
  },

  parseFechaEspanol(str) {
    if (!str) return null;
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

  // === Armado de filas ===

  armarFilaMaestro(filaList) {
    return {
      no_acuerdo: filaList.no_acuerdo,
      no_proyecto_acuerdo: filaList.no_proyecto_acuerdo || '',
      titulo: filaList.titulo || '',
      estado: filaList.estado || ''
    };
  },

  armarFilaDetalle(filaList, detalle) {
    const titulo = detalle.tituloAcuerdo || filaList.titulo || '';
    return {
      no_acuerdo: filaList.no_acuerdo,
      titulo: titulo,
      fecha_sancion: detalle.fechaSancion || null,
      ano_sancion: detalle.anoSancion || '',
      link_astrea: detalle.linkAstrea || '',
      comision: detalle.comision || ''
    };
  },

  armarFilasConcejales(filaList, detalle) {
    const filas = [];
    const numero = filaList.no_acuerdo;
    const titulo = detalle.tituloAcuerdo || filaList.titulo || '';

    const add = (rol, concejal) => {
      const c = String(concejal || '').trim();
      if (!c) return;
      filas.push({ numero, titulo, rol, concejal: c });
    };

    for (const p of (detalle.proponentes || [])) add('Proponente', p);
    if (detalle.coordinador) add('Coordinador', detalle.coordinador);
    for (const p of (detalle.ponentes || [])) add('Ponente', p);

    return filas;
  },

  // === PrimeFaces AJAX (idéntico patrón a proyectos/sesiones) ===

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
      const prependId = formName
        ? html.indexOf(`id="${formName}:${this.config.datatableId}_data"`) !== -1
        : false;
      return { html, cookies, viewState, viewStateName, formName, datatableId: this.config.datatableId, prependId };
    } catch (error) {
      console.log(`❌ Error fetchInicial: ${error.message}`);
      return null;
    }
  },

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
        console.log(`❌ AJAX paginacion HTTP ${response.getResponseCode()} en first=${first}`);
        return null;
      }
      const xml = response.getContentText();
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

  /**
   * AJAX al botón "ojito". El render target son DOS containers
   * (pa-invitados-id, pa-detail-id). Concatenamos los HTML de ambos
   * <update> y se lo pasamos al parser.
   */
  fetchDetalleAjax({ eyeButtonId, cookies, viewState, viewStateName, formName }) {
    try {
      const partialPrefix = String(viewStateName).startsWith('jakarta') ? 'jakarta.faces' : 'javax.faces';
      const renderTargets = this.config.detailContainerIds.join(' ');
      const payload = {
        [`${partialPrefix}.partial.ajax`]: 'true',
        [`${partialPrefix}.source`]: eyeButtonId,
        [`${partialPrefix}.partial.execute`]: eyeButtonId,
        [`${partialPrefix}.partial.render`]: renderTargets,
        [eyeButtonId]: eyeButtonId,
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
        console.log(`❌ AJAX detalle HTTP ${response.getResponseCode()} (button=${eyeButtonId})`);
        return null;
      }
      const xml = response.getContentText();
      if (/<error\b/i.test(xml)) return { html: '', viewState: null, error: true };
      if (/<redirect\b/i.test(xml)) return { html: '', viewState: null, redirect: true };

      // Concatenamos el contenido de ambos updates (pa-invitados-id y pa-detail-id)
      const partes = this.config.detailContainerIds.map(id => this.extraerUpdate(xml, id) || '');
      const html = partes.join('\n');
      const viewStateNuevo = this.extraerUpdateViewState(xml);
      return { html, viewState: viewStateNuevo };
    } catch (error) {
      console.log(`❌ Error fetchDetalleAjax: ${error.message}`);
      return null;
    }
  },

  // === Helpers HTTP / parseo común ===

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
      return lista.map(c => String(c).split(';')[0]).join('; ');
    } catch (error) {
      return '';
    }
  },

  extraerViewState(html) {
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
    const fallback = html.match(/name="[^"]*\.ViewState"[^>]*value="([^"]+)"/i) ||
                     html.match(/value="([^"]+)"[^>]*name="[^"]*\.ViewState"/i);
    return fallback ? fallback[1] : null;
  },

  detectarNombreViewState(html) {
    if (/jakarta\.faces\.ViewState/i.test(html)) return 'jakarta.faces.ViewState';
    return 'javax.faces.ViewState';
  },

  extraerFormName(html, datatableId) {
    const reConPrefijo = new RegExp(`id="([^":\\s]+):${datatableId}(?:_data)?"`);
    const conPrefijo = html.match(reConPrefijo);
    if (conPrefijo) return conPrefijo[1];

    const reForm = /<form[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g;
    let m;
    while ((m = reForm.exec(html)) !== null) {
      if (m[2].indexOf(datatableId) !== -1) return m[1];
    }
    return null;
  },

  extraerUpdate(xml, containerId) {
    const esc = containerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<update[^>]*id="[^"]*${esc}[^"]*"[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</update>`);
    const m = xml.match(re);
    return m ? m[1] : '';
  },

  extraerUpdateViewState(xml) {
    const m = xml.match(/<update[^>]*id="[^"]*ViewState[^"]*"[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/update>/);
    return m ? m[1] : null;
  },

  logDiagnostico(html, formName) {
    try {
      const formas = (html.match(/<form[^>]*\bid="[^"]+"/g) || []).slice(0, 5);
      const tieneJavax = /javax\.faces\.ViewState/i.test(html);
      const tieneJakarta = /jakarta\.faces\.ViewState/i.test(html);
      const tieneDT = html.indexOf(this.config.datatableId) !== -1;
      console.log(`🔍 html ${html.length}b | javax.VS=${tieneJavax} | jakarta.VS=${tieneJakarta} | ${this.config.datatableId}=${tieneDT}`);
      console.log(`🔍 Forms: ${formas.length ? formas.join(' | ') : '(ninguno)'}`);
    } catch (e) { /* */ }
  }
};
