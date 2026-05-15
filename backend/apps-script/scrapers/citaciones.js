/**
 * Scraper de Citaciones del Concejo de Medellín
 *
 * Fuente: SIMI – citaciones.xhtml (datatable "proposiciondt-id", form "form").
 *
 * Estructura del scrape:
 * 1) Pagina el listado (fecha_registro, acta_aprobacion, consecutivo, titulo,
 *    estado) via PrimeFaces partial-ajax.
 * 2) Por CADA fila dispara un segundo AJAX al botón "ojito"
 *    (source=proposiciondt-id:N:j_idt55, render=pa-invitados-id,pp-detail-id;
 *    NOTAR pp-detail-id, distinto del pa-detail-id de acuerdos) para traer
 *    el detalle con: Título, Descripción (HTML con <p>), Fecha, Bancadas.
 * 3) Arma dos filas por citación:
 *      - citaciones_maestro: fecha (de registro), acta_aprobacion,
 *        consecutivo, titulo, descripcion, integrantes (vacío por ahora),
 *        estado.
 *      - citaciones_detalleBa: N filas, una por bancada (consecutivo,
 *        titulo, bancadas[i]).
 * 4) Optimizaciones aplicadas desde acuerdos:
 *      - Cache de existentes al inicio: si estado en sheet === estado
 *        en listado actual, skip total (~0ms).
 *      - Resume offset persistido en ScriptProperties.
 *      - Chunks de 30 citaciones para visibilidad/resilience.
 */

const ScraperCitaciones = {
  config: {
    get url() { return URLS.citaciones; },
    sheetName: 'citaciones_maestro',
    detalleBaSheetName: 'citaciones_detalleBa',
    datatableId: 'proposiciondt-id',
    detailContainerIds: ['pa-invitados-id', 'pp-detail-id'],
    delayBetweenPages: 400,
    delayBetweenDetails: 100,
    chunkCitaciones: 30,
    maxPaginas: 300,
    maxElapsedMs: 4.5 * 60 * 1000
  },

  ejecutar() {
    try {
      console.log(`🚀 Iniciando scraper de citaciones`);

      const ctx = {
        bufferMaestro: [],
        bufferDetalleBa: [],
        existentes: this.cargarEstadosExistentes(),
        stats: {
          maestro: { nuevos: 0, actualizados: 0, errores: 0 },
          detalleBa: { nuevos: 0, actualizados: 0, errores: 0 },
          totalCitaciones: 0,
          detalleFallido: 0,
          saltadosSinCambio: 0,
          cambiosEstado: 0,
          nuevosExtraidos: 0
        }
      };
      console.log(`📋 Cache: ${ctx.existentes.size} citaciones ya en sheet (skip detail si no cambió estado)`);
      this._ctx = ctx;

      try {
        this.extraer();
        if (ctx.bufferMaestro.length > 0 || ctx.bufferDetalleBa.length > 0) {
          this.flushBuffers();
        }
      } finally {
        delete this._ctx;
      }

      const s = ctx.stats;
      console.log(`📊 Resumen: ${s.totalCitaciones} listados | ${s.nuevosExtraidos} con detail fetch | ${s.saltadosSinCambio} saltados | ${s.cambiosEstado} con cambio de estado`);
      return {
        success: true,
        procesados: s.totalCitaciones,
        nuevos: s.maestro.nuevos,
        actualizados: s.maestro.actualizados,
        errores: s.maestro.errores + s.detalleBa.errores,
        detalleBa_nuevos: s.detalleBa.nuevos,
        detalleBa_actualizados: s.detalleBa.actualizados,
        detalle_fallido: s.detalleFallido,
        saltados_sin_cambio: s.saltadosSinCambio,
        cambios_estado: s.cambiosEstado,
        nuevos_extraidos: s.nuevosExtraidos,
        timestamp: new Date()
      };
    } catch (error) {
      console.log(`❌ Error en ScraperCitaciones: ${error.message}`);
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

    if (ctx.bufferDetalleBa.length > 0) {
      const stats = SheetsUtils.guardar(this.config.detalleBaSheetName, ctx.bufferDetalleBa);
      ctx.stats.detalleBa.nuevos += stats.nuevos || 0;
      ctx.stats.detalleBa.actualizados += stats.actualizados || 0;
      ctx.stats.detalleBa.errores += stats.errores || 0;
      console.log(`💾 DetalleBa chunk: +${ctx.bufferDetalleBa.length} (nuevos=${stats.nuevos}, actualizados=${stats.actualizados})`);
      ctx.bufferDetalleBa = [];
    }
  },

  /**
   * Map<consecutivo, estado> leyendo el sheet maestro una sola vez.
   */
  cargarEstadosExistentes() {
    const m = new Map();
    try {
      const datos = SheetsUtils.obtener(this.config.sheetName);
      for (const d of datos) {
        const k = String(d.consecutivo == null ? '' : d.consecutivo).trim();
        if (!k) continue;
        m.set(k, String(d.estado == null ? '' : d.estado).trim());
      }
    } catch (e) {
      console.log(`⚠️ No se pudo cargar estados existentes: ${e.message}`);
    }
    return m;
  },

  extraer() {
    const tStart = Date.now();
    const inicial = this.fetchInicial();
    if (!inicial) return;

    let { html, cookies, viewState, viewStateName, formName, datatableId, prependId } = inicial;
    const primerasFilas = this.parsearFilasListado(html);
    console.log(`📄 Página 1: ${primerasFilas.length} citaciones (formName=${formName}, prependId=${prependId}, ViewState=${viewState ? 'ok' : 'missing'}, vsName=${viewStateName})`);

    if (!formName || !viewState) {
      this.logDiagnostico(html, formName);
      console.log('⚠️ No se pudo extraer formName/ViewState — abortando');
      return;
    }
    if (primerasFilas.length === 0) return;

    let viewStateActual = viewState;
    viewStateActual = this.procesarFilasListado(primerasFilas, { cookies, viewState: viewStateActual, viewStateName, formName, prependId });

    const pageSize = primerasFilas.length;

    const resumeFrom = this.leerResumeOffset();
    let first;
    let pagina;
    if (resumeFrom > pageSize) {
      first = resumeFrom;
      pagina = Math.floor(resumeFrom / pageSize) + 1;
      console.log(`▶️ Reanudando backfill desde first=${resumeFrom} (página ~${pagina}). Saltando ${resumeFrom - pageSize} citaciones ya extraídas.`);
    } else {
      first = pageSize;
      pagina = 2;
    }

    let reintentos = 0;
    let salida = 'fin natural';
    let citacionesProcesadas = primerasFilas.length;
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
      console.log(`📄 Página ${pagina} (first=${first}): ${filas.length} citaciones`);
      if (filas.length === 0) { salida = `página vacía first=${first}`; break; }

      if (resp.viewState) viewStateActual = resp.viewState;
      viewStateActual = this.procesarFilasListado(filas, { cookies, viewState: viewStateActual, viewStateName, formName, prependId });

      first += filas.length;
      pagina++;
      citacionesProcesadas += filas.length;

      if (filas.length < pageSize) { salida = `página corta ${filas.length}<${pageSize}`; break; }

      if (citacionesProcesadas - ultimoFlush >= this.config.chunkCitaciones) {
        this.flushBuffers();
        ultimoFlush = citacionesProcesadas;
      }
    }

    if (pagina > this.config.maxPaginas) salida = `maxPaginas ${this.config.maxPaginas}`;
    const elapsed = Math.round((Date.now() - tStart) / 1000);
    console.log(`🏁 Extracción: ${pagina - 1} página(s), ${citacionesProcesadas} citaciones, ${elapsed}s — salida: ${salida}`);

    const hitBudget = salida.indexOf('time budget') === 0 || salida.indexOf('maxPaginas') === 0;
    if (hitBudget) {
      this.guardarResumeOffset(first);
    } else if (resumeFrom > 0) {
      console.log(`🎉 Backfill citaciones completado — resume offset limpiado`);
      this.limpiarResumeOffset();
    } else {
      this.limpiarResumeOffset();
    }
  },

  procesarFilasListado(filasListado, ctxAjax) {
    let viewState = ctxAjax.viewState;
    for (const filaList of filasListado) {
      this._ctx.stats.totalCitaciones++;

      const estadoGuardado = this._ctx.existentes.get(filaList.consecutivo);
      const estadoActual = String(filaList.estado || '').trim();
      if (estadoGuardado !== undefined && estadoGuardado === estadoActual) {
        this._ctx.stats.saltadosSinCambio++;
        continue;
      }

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
        console.log(`⚠️ Detalle vacío para citación ${filaList.consecutivo}`);
        this._ctx.stats.detalleFallido++;
        // Guardamos al menos lo del listado
        this._ctx.bufferMaestro.push(this.armarFilaMaestro(filaList, null));
        continue;
      }
      if (respDetalle.viewState) viewState = respDetalle.viewState;

      const detalle = this.parsearDetalle(respDetalle.html);
      this._ctx.bufferMaestro.push(this.armarFilaMaestro(filaList, detalle));
      const detalleBa = this.armarFilasDetalleBa(filaList, detalle);
      this._ctx.bufferDetalleBa.push(...detalleBa);

      this._ctx.existentes.set(filaList.consecutivo, estadoActual);
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
      // 6 celdas de datos (la 5ta "Integrantes" es header-only) + 1 con botón
      if (!celdas || celdas.length < 6) return null;

      const fecha_registro = this.valorCelda(celdas[0]);
      const acta_aprobacion = this.valorCelda(celdas[1]);
      const consecutivo = this.valorCelda(celdas[2]);
      const titulo = this.valorCelda(celdas[3]);
      // celdas[4]: integrantes (vacío en listado)
      const estado = this.valorCelda(celdas[5]);

      const idMatch = filaHtml.match(/<button[^>]*id="([^"]*j_idt\d+)"[^>]*onclick="PrimeFaces\.ab/);
      const eyeButtonId = idMatch ? idMatch[1] : null;

      if (!consecutivo || !eyeButtonId) return null;

      return { fecha_registro, acta_aprobacion, consecutivo, titulo, estado, eyeButtonId };
    } catch (error) {
      return null;
    }
  },

  valorCelda(celdaHtml) {
    if (!celdaHtml) return '';
    const sinTitle = celdaHtml.replace(/<span[^>]*class="ui-column-title"[^>]*>[\s\S]*?<\/span>/g, '');
    return sinTitle.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  },

  // === Detalle ===

  parsearDetalle(html) {
    return {
      tituloDetalle: (this.extraerCampoDetalle(html, 'Título')[0] || ''),
      descripcion: this.extraerDescripcion(html),
      bancadas: this.extraerBancadas(html)
    };
  },

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
   * La Descripción viene como HTML con <p>...</p><p><br></p><p>...</p>.
   * Reemplazamos los saltos de párrafo por newlines y limpiamos.
   */
  extraerDescripcion(html) {
    const re = /<label[^>]*>\s*Descripción\s*:?\s*<\/label>\s*<div\s+class="col-12 md:col-10"[^>]*>([\s\S]*?)<\/div>/i;
    const m = html.match(re);
    if (!m) return '';

    // Tomar el contenido del span ui-outputlabel-label
    const spanMatch = m[1].match(/<span class="ui-outputlabel-label">([\s\S]*?)<\/span>/);
    if (!spanMatch) return '';

    let txt = spanMatch[1];
    // <p>...</p> → texto + newline; <br> → newline
    txt = txt.replace(/<\/p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
    // Strip resto de tags
    txt = txt.replace(/<[^>]+>/g, '');
    // Entidades comunes
    txt = txt.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    // Limpiar lineas vacías y espacios duplicados
    const lineas = txt.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l);
    return lineas.join('\n');
  },

  /**
   * Extrae todas las bancadas del tbody id="tableBancadas_data".
   */
  extraerBancadas(html) {
    const re = /<tbody[^>]*id="tableBancadas_data"[^>]*>([\s\S]*?)<\/tbody>/;
    const m = html.match(re);
    if (!m) return [];

    const tbody = m[1];
    const bancadas = [];
    const reSpan = /<span class="ui-outputlabel-label">([\s\S]*?)<\/span>/g;
    let sm;
    while ((sm = reSpan.exec(tbody)) !== null) {
      const b = sm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      if (b) bancadas.push(b);
    }
    return bancadas;
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

  armarFilaMaestro(filaList, detalle) {
    const titulo = (detalle && detalle.tituloDetalle) ? detalle.tituloDetalle : (filaList.titulo || '');
    return {
      fecha: this.parseFechaEspanol(filaList.fecha_registro) || filaList.fecha_registro || '',
      acta_aprobacion: filaList.acta_aprobacion || '',
      consecutivo: filaList.consecutivo,
      titulo: titulo,
      descripcion: (detalle && detalle.descripcion) ? detalle.descripcion : '',
      integrantes: '', // dejado vacío por instrucción del usuario
      estado: filaList.estado || ''
    };
  },

  armarFilasDetalleBa(filaList, detalle) {
    const filas = [];
    const titulo = (detalle && detalle.tituloDetalle) ? detalle.tituloDetalle : (filaList.titulo || '');
    const bancadas = (detalle && detalle.bancadas) ? detalle.bancadas : [];
    for (const b of bancadas) {
      const bn = String(b || '').trim();
      if (!bn) continue;
      filas.push({ consecutivo: filaList.consecutivo, titulo, bancadas: bn });
    }
    return filas;
  },

  // === PrimeFaces AJAX ===

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
  },

  // === Resume offset (PropertiesService) ===

  RESUME_KEY: 'citaciones_resumeFrom',

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
      console.log(`💾 Resume offset citaciones = ${first} (próxima corrida continúa desde aquí)`);
    } catch (e) {
      console.log(`⚠️ guardarResumeOffset falló: ${e.message}`);
    }
  },

  limpiarResumeOffset() {
    try {
      PropertiesService.getScriptProperties().deleteProperty(this.RESUME_KEY);
    } catch (e) { /* */ }
  }
};
