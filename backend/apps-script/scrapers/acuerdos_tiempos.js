/**
 * Scraper de tiempos de estados de Acuerdos del Concejo de Medellín
 *
 * Extrae el tab "Estados" del modal de cada Acuerdo en SIMI: la secuencia
 * cronológica de estados (Radicado → ... → Acuerdo sancionado).
 *
 * Reutiliza el mismo flujo AJAX que ScraperAcuerdos:
 *   1) Pagina el listado vía PrimeFaces partial-ajax.
 *   2) Por cada acuerdo dispara el AJAX del botón "ojito"
 *      (render=pa-invitados-id,pa-detail-id).
 *   3) Parsea la tabla de dos columnas Estado + Fecha dentro del modal.
 *   4) Guarda en "acuerdos_tiempos" (clave compuesta: id_acuerdo + actividad).
 *
 * Optimización: salta el AJAX de detalle si el estado actual del acuerdo
 * ya está registrado como actividad en la hoja (timeline completo guardado).
 */
const ScraperAcuerdosTiempos = {
  config: {
    get url() { return URLS.acuerdos; },
    sheetName: 'acuerdos_tiempos',
    datatableId: 'proyectosdt-id',
    detailContainerIds: ['pa-invitados-id', 'pa-detail-id'],
    delayBetweenPages: 400,
    delayBetweenDetails: 150,
    chunkAcuerdos: 25,
    maxPaginas: 300,
    maxElapsedMs: 4.5 * 60 * 1000
  },

  ejecutar() {
    try {
      console.log(`🚀 Iniciando scraper de tiempos de acuerdos`);
      const ctx = {
        buffer: [],
        existentes: this.cargarActividadesExistentes(),
        stats: { total: 0, saltados: 0, nuevosExtraidos: 0, fallidos: 0, nuevos: 0, actualizados: 0, errores: 0 }
      };
      this._ctx = ctx;
      console.log(`📋 Cache: ${ctx.existentes.size} acuerdos con tiempos ya guardados`);

      try {
        this.extraer();
        if (ctx.buffer.length > 0) this.flushBuffer();
      } finally {
        delete this._ctx;
      }

      const s = ctx.stats;
      console.log(`📊 Tiempos: ${s.total} acuerdos | ${s.nuevosExtraidos} extraídos | ${s.saltados} saltados | filas: +${s.nuevos} nuevas, ~${s.actualizados} actualizadas`);
      return {
        success: true,
        procesados: s.total,
        saltados: s.saltados,
        nuevos: s.nuevos,
        actualizados: s.actualizados,
        errores: s.errores,
        timestamp: new Date()
      };
    } catch (error) {
      console.log(`❌ Error en ScraperAcuerdosTiempos: ${error.message}`);
      return { success: false, error: error.message, timestamp: new Date() };
    }
  },

  flushBuffer() {
    const ctx = this._ctx;
    if (!ctx || ctx.buffer.length === 0) return;
    const stats = SheetsUtils.guardar(this.config.sheetName, ctx.buffer);
    ctx.stats.nuevos += stats.nuevos || 0;
    ctx.stats.actualizados += stats.actualizados || 0;
    ctx.stats.errores += stats.errores || 0;
    console.log(`💾 Tiempos chunk: +${ctx.buffer.length} (nuevos=${stats.nuevos}, actualizados=${stats.actualizados})`);
    ctx.buffer = [];
  },

  /**
   * Carga Map<id_acuerdo → Set<actividad>> desde la hoja para saber
   * qué timelines ya están completos y evitar re-fetches innecesarios.
   */
  cargarActividadesExistentes() {
    const m = new Map();
    try {
      const datos = SheetsUtils.obtener(this.config.sheetName);
      for (const d of datos) {
        const k = String(d.id_acuerdo == null ? '' : d.id_acuerdo).trim();
        if (!k) continue;
        if (!m.has(k)) m.set(k, new Set());
        const act = String(d.actividad == null ? '' : d.actividad).trim();
        if (act) m.get(k).add(act);
      }
    } catch (e) {
      console.log(`⚠️ No se pudo cargar tiempos existentes: ${e.message}`);
    }
    return m;
  },

  // === Resume offset (PropertiesService) ===

  RESUME_KEY: 'acuerdos_tiempos_resumeFrom',

  leerResumeOffset() {
    try {
      const v = PropertiesService.getScriptProperties().getProperty(this.RESUME_KEY);
      const n = parseInt(v || '0', 10);
      return isNaN(n) ? 0 : n;
    } catch (e) { return 0; }
  },

  guardarResumeOffset(first) {
    try {
      PropertiesService.getScriptProperties().setProperty(this.RESUME_KEY, String(first));
      console.log(`💾 Resume offset acuerdos_tiempos = ${first}`);
    } catch (e) { console.log(`⚠️ guardarResumeOffset falló: ${e.message}`); }
  },

  limpiarResumeOffset() {
    try { PropertiesService.getScriptProperties().deleteProperty(this.RESUME_KEY); } catch (e) { /* */ }
  },

  // === Loop de extracción ===

  extraer() {
    const tStart = Date.now();
    const inicial = this.fetchInicial();
    if (!inicial) return;

    let { html, cookies, viewState, viewStateName, formName, datatableId, prependId } = inicial;
    const primerasFilas = this.parsearFilasListado(html);
    console.log(`📄 Página 1: ${primerasFilas.length} acuerdos (formName=${formName})`);

    if (!formName || !viewState) {
      console.log('⚠️ No se pudo extraer formName/ViewState — abortando');
      return;
    }
    if (primerasFilas.length === 0) return;

    let viewStateActual = viewState;
    viewStateActual = this.procesarFilas(primerasFilas, { cookies, viewState: viewStateActual, viewStateName, formName, prependId });

    const pageSize = primerasFilas.length;
    const resumeFrom = this.leerResumeOffset();
    let first, pagina;
    if (resumeFrom > pageSize) {
      first = resumeFrom;
      pagina = Math.floor(resumeFrom / pageSize) + 1;
      console.log(`▶️ Reanudando desde first=${resumeFrom} (pág ~${pagina})`);
    } else {
      first = pageSize;
      pagina = 2;
    }

    let reintentos = 0;
    let salida = 'fin natural';
    let procesados = primerasFilas.length;
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
        console.log(`♻️ Re-bootstrap (first=${first})`);
        this.flushBuffer();
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
      viewStateActual = this.procesarFilas(filas, { cookies, viewState: viewStateActual, viewStateName, formName, prependId });

      first += filas.length;
      pagina++;
      procesados += filas.length;

      if (filas.length < pageSize) { salida = `página corta ${filas.length}<${pageSize}`; break; }

      if (procesados - ultimoFlush >= this.config.chunkAcuerdos) {
        this.flushBuffer();
        ultimoFlush = procesados;
      }
    }

    if (pagina > this.config.maxPaginas) salida = `maxPaginas ${this.config.maxPaginas}`;
    console.log(`🏁 ${pagina - 1} págs, ${procesados} acuerdos, ${Math.round((Date.now() - tStart) / 1000)}s — ${salida}`);

    const hitBudget = salida.indexOf('time budget') === 0 || salida.indexOf('maxPaginas') === 0;
    if (hitBudget) {
      this.guardarResumeOffset(first);
    } else {
      if (resumeFrom > 0) console.log(`🎉 Backfill tiempos completado — resume offset limpiado`);
      this.limpiarResumeOffset();
    }
  },

  /**
   * Procesa un lote de filas del listado: para cada acuerdo cuyo estado
   * actual no esté ya en la hoja, dispara el AJAX de detalle y guarda
   * las filas de la tabla de estados.
   */
  procesarFilas(filasListado, ctxAjax) {
    let viewState = ctxAjax.viewState;
    for (const fila of filasListado) {
      this._ctx.stats.total++;

      // Si ya tenemos registrada la actividad del estado actual → timeline al día
      const actividadesGuardadas = this._ctx.existentes.get(fila.no_acuerdo);
      const estadoActual = String(fila.estado || '').trim();
      if (actividadesGuardadas && estadoActual && actividadesGuardadas.has(estadoActual)) {
        this._ctx.stats.saltados++;
        continue;
      }

      this._ctx.stats.nuevosExtraidos++;
      Utilities.sleep(this.config.delayBetweenDetails);

      const respDetalle = this.fetchDetalleAjax({
        eyeButtonId: fila.eyeButtonId,
        cookies: ctxAjax.cookies,
        viewState,
        viewStateName: ctxAjax.viewStateName,
        formName: ctxAjax.formName
      });

      if (!respDetalle || !respDetalle.html) {
        console.log(`⚠️ Detalle vacío para acuerdo ${fila.no_acuerdo}`);
        this._ctx.stats.fallidos++;
        continue;
      }
      if (respDetalle.viewState) viewState = respDetalle.viewState;

      const estados = this.parsearEstados(respDetalle.html);
      if (estados.length === 0) {
        console.log(`⚠️ Sin estados en modal de acuerdo ${fila.no_acuerdo}`);
        continue;
      }

      this._ctx.buffer.push(...this.armarFilasTiempos(fila, estados));

      // Actualizar caché en memoria para evitar re-fetch si el acuerdo reaparece
      if (!this._ctx.existentes.has(fila.no_acuerdo)) {
        this._ctx.existentes.set(fila.no_acuerdo, new Set());
      }
      estados.forEach(e => this._ctx.existentes.get(fila.no_acuerdo).add(e.actividad));
    }
    return viewState;
  },

  // === Parseo del listado ===

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
      const titulo = this.valorCelda(celdas[2]);
      const estado = this.valorCelda(celdas[3]);

      const idMatch = filaHtml.match(/<button[^>]*id="([^"]*j_idt\d+)"[^>]*onclick="PrimeFaces\.ab/);
      const eyeButtonId = idMatch ? idMatch[1] : null;

      if (!no_acuerdo || !eyeButtonId) return null;
      return { no_acuerdo, titulo, estado, eyeButtonId };
    } catch (error) {
      return null;
    }
  },

  // === Parseo de la tabla de estados del modal ===

  /**
   * Busca la datatable con exactamente 2 columnas: "Estado" (primero) y
   * "Fecha" (segundo). Es la única tabla del modal con esa estructura exacta.
   */
  parsearEstados(html) {
    const reTablas = /<thead\b[^>]*>([\s\S]*?)<\/thead>[\s\S]*?<tbody[^>]*class="[^"]*ui-datatable-data[^"]*"[^>]*>([\s\S]*?)<\/tbody>/g;
    let m;
    while ((m = reTablas.exec(html)) !== null) {
      const thead = m[1];
      const tbody = m[2];
      const ths = thead.match(/<th\b[^>]*>/g) || [];
      if (ths.length !== 2) continue;
      if (!/aria-label="Estado"/i.test(thead)) continue;
      if (!/aria-label="Fecha"/i.test(thead)) continue;
      if (thead.indexOf('aria-label="Estado"') > thead.indexOf('aria-label="Fecha"')) continue;

      const estados = [];
      const reFilas = /<tr[^>]*data-ri="\d+"[^>]*>([\s\S]*?)<\/tr>/g;
      let fila;
      while ((fila = reFilas.exec(tbody)) !== null) {
        const celdas = fila[1].match(/<td[^>]*role="gridcell"[^>]*>[\s\S]*?<\/td>/g);
        if (!celdas || celdas.length < 2) continue;
        const actividad = this.valorCelda(celdas[0]);
        const fechaStr = this.valorCelda(celdas[1]);
        if (actividad) estados.push({ actividad: actividad, fecha: this.parsearFecha(fechaStr) });
      }
      return estados;
    }
    return [];
  },

  parsearFecha(str) {
    if (!str) return null;
    // Soporta "2026/04/08" y "2026-04-08"
    const m = String(str).match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
    if (!m) return null;
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  },

  // === Armado de filas ===

  armarFilasTiempos(filaList, estados) {
    const ahora = new Date();
    return estados.map(e => ({
      id_acuerdo: filaList.no_acuerdo,
      acuerdo: filaList.titulo || '',
      actividad: e.actividad,
      fecha: e.fecha || '',
      fecha_extraccion: ahora
    }));
  },

  valorCelda(celdaHtml) {
    if (!celdaHtml) return '';
    const sinTitle = celdaHtml.replace(/<span[^>]*class="ui-column-title"[^>]*>[\s\S]*?<\/span>/g, '');
    return sinTitle.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  },

  // === PrimeFaces AJAX (mismo patrón que ScraperAcuerdos) ===

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
        console.log(`❌ AJAX paginación HTTP ${response.getResponseCode()} en first=${first}`);
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
    } catch (error) { return ''; }
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
  }
};
