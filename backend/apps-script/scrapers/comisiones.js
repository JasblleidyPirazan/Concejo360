/**
 * Scraper de Comisiones Accidentales del Concejo de Medellín
 *
 * Fuente: SIMI – comisiones.xhtml. Estructura general muy similar a
 * citaciones/invitaciones (datatable proposiciondt-id, form 'form',
 * detail render dual pa-invitados-id + pp-detail-id), pero el modal de
 * detalle trae varios tabs y necesitamos extraer datos de DOS de ellos:
 *
 *  - Tab "Comisión Accidental" (default): Descripción + Coordinador
 *    → van al maestro.
 *  - Tab "Proponentes": tabla j_idt87:tableBancadas3_data con DOS
 *    columnas (Concejal, Bancada) → comisiones_detalle, una fila por
 *    concejal proponente.
 *  - Tab "Resolución": tabla j_idt87:id_integrantes_r_data con UNA
 *    columna (Concejal) → comisiones_detalle_integrantes, una fila
 *    por concejal integrante.
 *
 * Como el AJAX renderiza el panel completo (no solo el tab activo),
 * todos los tabs llegan en una sola respuesta; matcheamos los
 * tbodies por la parte estable del id (sufijo).
 *
 * Optimizaciones aplicadas desde el inicio:
 *  - Cache de existentes Map<consecutivo, estado> → skip si no cambió
 *  - Resume offset persistido
 *  - Chunked save cada 30 comisiones
 */

const ScraperComisiones = {
  config: {
    get url() { return URLS.comisiones; },
    sheetName: 'comisiones_maestro',
    detalleSheetName: 'comisiones_detalle',
    integrantesSheetName: 'comisiones_detalle_integrantes',
    datatableId: 'proposiciondt-id',
    detailContainerIds: ['pa-invitados-id', 'pp-detail-id'],
    delayBetweenPages: 400,
    delayBetweenDetails: 100,
    chunkComisiones: 30,
    maxPaginas: 300,
    maxElapsedMs: 4.5 * 60 * 1000
  },

  ejecutar() {
    try {
      console.log(`🚀 Iniciando scraper de comisiones`);

      const ctx = {
        bufferMaestro: [],
        bufferDetalle: [],
        bufferIntegrantes: [],
        existentes: this.forzandoDetalle() ? new Map() : this.cargarEstadosExistentes(),
        stats: {
          maestro: { nuevos: 0, actualizados: 0, errores: 0 },
          detalle: { nuevos: 0, actualizados: 0, errores: 0 },
          integrantes: { nuevos: 0, actualizados: 0, errores: 0 },
          totalComisiones: 0,
          detalleFallido: 0,
          saltadosSinCambio: 0,
          cambiosEstado: 0,
          nuevosExtraidos: 0
        }
      };
      console.log(`📋 Cache: ${ctx.existentes.size} comisiones ya en sheet (skip detail si no cambió estado)`);
      this._ctx = ctx;

      try {
        this.extraer();
        if (ctx.bufferMaestro.length > 0 || ctx.bufferDetalle.length > 0 || ctx.bufferIntegrantes.length > 0) {
          this.flushBuffers();
        }
      } finally {
        delete this._ctx;
      }

      const s = ctx.stats;
      console.log(`📊 Resumen: ${s.totalComisiones} listados | ${s.nuevosExtraidos} con detail fetch | ${s.saltadosSinCambio} saltados | ${s.cambiosEstado} con cambio de estado`);
      return {
        success: true,
        procesados: s.totalComisiones,
        nuevos: s.maestro.nuevos,
        actualizados: s.maestro.actualizados,
        errores: s.maestro.errores + s.detalle.errores + s.integrantes.errores,
        detalle_nuevos: s.detalle.nuevos,
        detalle_actualizados: s.detalle.actualizados,
        integrantes_nuevos: s.integrantes.nuevos,
        integrantes_actualizados: s.integrantes.actualizados,
        detalle_fallido: s.detalleFallido,
        saltados_sin_cambio: s.saltadosSinCambio,
        cambios_estado: s.cambiosEstado,
        nuevos_extraidos: s.nuevosExtraidos,
        timestamp: new Date()
      };
    } catch (error) {
      console.log(`❌ Error en ScraperComisiones: ${error.message}`);
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

    if (ctx.bufferIntegrantes.length > 0) {
      const stats = SheetsUtils.guardar(this.config.integrantesSheetName, ctx.bufferIntegrantes);
      ctx.stats.integrantes.nuevos += stats.nuevos || 0;
      ctx.stats.integrantes.actualizados += stats.actualizados || 0;
      ctx.stats.integrantes.errores += stats.errores || 0;
      console.log(`💾 Integrantes chunk: +${ctx.bufferIntegrantes.length} (nuevos=${stats.nuevos}, actualizados=${stats.actualizados})`);
      ctx.bufferIntegrantes = [];
    }
  },

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
    console.log(`📄 Página 1: ${primerasFilas.length} comisiones (formName=${formName}, prependId=${prependId}, ViewState=${viewState ? 'ok' : 'missing'}, vsName=${viewStateName})`);

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
      console.log(`▶️ Reanudando backfill desde first=${resumeFrom} (página ~${pagina}). Saltando ${resumeFrom - pageSize} comisiones ya extraídas.`);
    } else {
      first = pageSize;
      pagina = 2;
    }

    let reintentos = 0;
    let salida = 'fin natural';
    let comisionesProcesadas = primerasFilas.length;
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
      console.log(`📄 Página ${pagina} (first=${first}): ${filas.length} comisiones`);
      if (filas.length === 0) { salida = `página vacía first=${first}`; break; }

      if (resp.viewState) viewStateActual = resp.viewState;
      viewStateActual = this.procesarFilasListado(filas, { cookies, viewState: viewStateActual, viewStateName, formName, prependId });

      first += filas.length;
      pagina++;
      comisionesProcesadas += filas.length;

      if (filas.length < pageSize) { salida = `página corta ${filas.length}<${pageSize}`; break; }

      if (comisionesProcesadas - ultimoFlush >= this.config.chunkComisiones) {
        this.flushBuffers();
        ultimoFlush = comisionesProcesadas;
      }
    }

    if (pagina > this.config.maxPaginas) salida = `maxPaginas ${this.config.maxPaginas}`;
    const elapsed = Math.round((Date.now() - tStart) / 1000);
    console.log(`🏁 Extracción: ${pagina - 1} página(s), ${comisionesProcesadas} comisiones, ${elapsed}s — salida: ${salida}`);

    const hitBudget = salida.indexOf('time budget') === 0 || salida.indexOf('maxPaginas') === 0;
    const recorridoCompleto = /^(fin natural|página corta|página vacía)/.test(salida);
    if (recorridoCompleto && this.forzandoDetalle()) {
      console.log('🎉 Reproceso forzado de detalle de comisiones completado');
      this.limpiarForzarDetalle();
    }
    if (hitBudget) {
      this.guardarResumeOffset(first);
    } else if (resumeFrom > 0) {
      console.log(`🎉 Backfill comisiones completado — resume offset limpiado`);
      this.limpiarResumeOffset();
    } else {
      this.limpiarResumeOffset();
    }
  },

  procesarFilasListado(filasListado, ctxAjax) {
    let viewState = ctxAjax.viewState;
    for (const filaList of filasListado) {
      this._ctx.stats.totalComisiones++;

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
        console.log(`⚠️ Detalle vacío para comisión ${filaList.consecutivo}`);
        this._ctx.stats.detalleFallido++;
        this._ctx.bufferMaestro.push(this.armarFilaMaestro(filaList, null));
        continue;
      }
      if (respDetalle.viewState) viewState = respDetalle.viewState;

      const detalle = this.parsearDetalle(respDetalle.html);
      this._ctx.bufferMaestro.push(this.armarFilaMaestro(filaList, detalle));
      this._ctx.bufferDetalle.push(...this.armarFilasDetalle(filaList, detalle));
      this._ctx.bufferIntegrantes.push(...this.armarFilasIntegrantes(filaList, detalle));

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
      // celdas[4]: integrantes header-only
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
      coordinador: (this.extraerCampoDetalle(html, 'Coordinador')[0] || ''),
      proponentes: this.extraerConcejalesProponentes(html),
      integrantes: this.extraerIntegrantes(html)
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

  extraerDescripcion(html) {
    const re = /<label[^>]*>\s*Descripción\s*:?\s*<\/label>\s*<div\s+class="col-12 md:col-10"[^>]*>([\s\S]*?)<\/div>/i;
    const m = html.match(re);
    if (!m) return '';

    const spanMatch = m[1].match(/<span class="ui-outputlabel-label">([\s\S]*?)<\/span>/);
    if (!spanMatch) return '';

    let txt = spanMatch[1];
    txt = txt.replace(/<\/p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
    txt = txt.replace(/<[^>]+>/g, '');
    txt = txt.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const lineas = txt.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l);
    return lineas.join('\n');
  },

  /**
   * Tab "Proponentes" → tbody con id que termina en tableBancadas3_data.
   * Cada <tr data-ri="N"> tiene dos celdas: Concejal | Bancada.
   */
  extraerConcejalesProponentes(html) {
    const re = /<tbody[^>]*id="[^"]*tableBancadas3_data"[^>]*>([\s\S]*?)<\/tbody>/;
    const m = html.match(re);
    if (!m) return [];

    const tbody = m[1];
    const filas = tbody.match(/<tr[^>]*data-ri="\d+"[^>]*>[\s\S]*?<\/tr>/g) || [];

    const result = [];
    for (const fila of filas) {
      const spans = [];
      const reSpan = /<span class="ui-outputlabel-label">([\s\S]*?)<\/span>/g;
      let sm;
      while ((sm = reSpan.exec(fila)) !== null) {
        const v = sm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        if (v) spans.push(v);
      }
      const concejal = spans[0] || '';
      const bancada = spans[1] || '';
      if (concejal) result.push({ concejal, bancada });
    }
    return result;
  },

  /**
   * Tab "Resolución" → tbody con id que termina en id_integrantes_r_data.
   * Cada fila tiene una sola celda con el nombre del concejal integrante.
   */
  extraerIntegrantes(html) {
    const re = /<tbody[^>]*id="[^"]*id_integrantes_r_data"[^>]*>([\s\S]*?)<\/tbody>/;
    const m = html.match(re);
    if (!m) return [];

    const tbody = m[1];
    const integrantes = [];
    const reSpan = /<span class="ui-outputlabel-label">([\s\S]*?)<\/span>/g;
    let sm;
    while ((sm = reSpan.exec(tbody)) !== null) {
      const v = sm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      if (v) integrantes.push(v);
    }
    return integrantes;
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
      acta: filaList.acta_aprobacion || '',
      consecutivo: filaList.consecutivo,
      titulo: titulo,
      estado: filaList.estado || '',
      descripcion: (detalle && detalle.descripcion) ? detalle.descripcion : '',
      coordinador: (detalle && detalle.coordinador) ? detalle.coordinador : ''
    };
  },

  armarFilasDetalle(filaList, detalle) {
    const filas = [];
    const titulo = (detalle && detalle.tituloDetalle) ? detalle.tituloDetalle : (filaList.titulo || '');
    const proponentes = (detalle && detalle.proponentes) ? detalle.proponentes : [];
    for (const p of proponentes) {
      const c = String(p.concejal || '').trim();
      if (!c) continue;
      filas.push({
        consecutivo: filaList.consecutivo,
        titulo,
        concejal_proponente: c,
        bancada: String(p.bancada || '').trim()
      });
    }
    return filas;
  },

  armarFilasIntegrantes(filaList, detalle) {
    const filas = [];
    const titulo = (detalle && detalle.tituloDetalle) ? detalle.tituloDetalle : (filaList.titulo || '');
    const integrantes = (detalle && detalle.integrantes) ? detalle.integrantes : [];
    for (const nombre of integrantes) {
      const n = String(nombre || '').trim();
      if (!n) continue;
      filas.push({ consecutivo: filaList.consecutivo, titulo, integrantes: n });
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

  RESUME_KEY: 'comisiones_resumeFrom',

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
      console.log(`💾 Resume offset comisiones = ${first} (próxima corrida continúa desde aquí)`);
    } catch (e) {
      console.log(`⚠️ guardarResumeOffset falló: ${e.message}`);
    }
  },

  limpiarResumeOffset() {
    try {
      PropertiesService.getScriptProperties().deleteProperty(this.RESUME_KEY);
    } catch (e) { /* */ }
  },

  // === Reproceso forzado del detalle (PropertiesService) ===
  // Persiste entre corridas porque el recorrido completo no cabe en una sola
  // ejecución de 6 min; mientras esté activo no se salta ninguna comisión.

  FORZAR_KEY: 'comisiones_forzarDetalle',

  forzandoDetalle() {
    try {
      return PropertiesService.getScriptProperties().getProperty(this.FORZAR_KEY) === '1';
    } catch (e) {
      return false;
    }
  },

  limpiarForzarDetalle() {
    try {
      PropertiesService.getScriptProperties().deleteProperty(this.FORZAR_KEY);
    } catch (e) { /* */ }
  }
};

/**
 * Vuelve a descargar proponentes e integrantes de TODAS las comisiones.
 * Necesario una vez tras corregir la clave de comisiones_detalle e
 * comisiones_detalle_integrantes: antes se guardaba un solo concejal por
 * comisión. Ejecutar desde el editor; si se corta por tiempo, volver a
 * ejecutarla (continúa donde quedó) hasta ver "Reproceso forzado ... completado".
 */
function reprocesarDetalleComisiones() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(ScraperComisiones.FORZAR_KEY) !== '1') {
    props.setProperty(ScraperComisiones.FORZAR_KEY, '1');
    ScraperComisiones.limpiarResumeOffset();
  }
  return ejecutarScraping('comisiones');
}
