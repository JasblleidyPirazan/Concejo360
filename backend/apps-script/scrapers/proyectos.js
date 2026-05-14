/**
 * Scraper de Proyectos de Acuerdo del Concejo de Medellín
 *
 * Fuente: SIMI – proyectos.xhtml (datatable "proyectosdt_id").
 *
 * Estrategia:
 * 1) Pagina el listado vía PrimeFaces partial-ajax (igual flujo que sesiones).
 * 2) Por CADA fila del listado dispara un segundo AJAX usando el botón "ojito"
 *    como source, que renderiza el panel "pa-invitados-id" con el detalle del
 *    proyecto (Consecutivo, Título, Tema, Proponentes, Comisión, Coordinador,
 *    Ponentes y la tab Estados con el evento Radicado y su fecha).
 * 3) Arma una fila en proyectos_maestro y N filas en proyectos_detalle
 *    (una por cada concejal en cada rol: Proponente, Coordinador, Ponente).
 * 4) Guarda en chunks via batch upsert para visibilidad en vivo y resilience.
 */

const ScraperProyectos = {
  config: {
    get url() { return URLS.proyectos; },
    sheetName: 'proyectos_maestro',
    detalleSheetName: 'proyectos_detalle',
    datatableId: 'proyectosdt_id',
    detailContainerId: 'pa-invitados-id',
    delayBetweenPages: 600,
    delayBetweenDetails: 250,
    chunkProyectos: 30, // flushear cada N proyectos procesados
    maxPaginas: 200,
    maxElapsedMs: 4.5 * 60 * 1000
  },

  ejecutar() {
    try {
      console.log(`🚀 Iniciando scraper de proyectos`);

      const ctx = {
        bufferMaestro: [],
        bufferDetalle: [],
        stats: {
          maestro: { nuevos: 0, actualizados: 0, errores: 0 },
          detalle: { nuevos: 0, actualizados: 0, errores: 0 },
          totalProyectos: 0,
          detalleFallido: 0
        }
      };
      this._ctx = ctx;

      try {
        this.extraer();
        // Flush final
        if (ctx.bufferMaestro.length > 0 || ctx.bufferDetalle.length > 0) {
          this.flushBuffers();
        }
      } finally {
        delete this._ctx;
      }

      const s = ctx.stats;
      return {
        success: true,
        procesados: s.totalProyectos,
        nuevos: s.maestro.nuevos,
        actualizados: s.maestro.actualizados,
        errores: s.maestro.errores + s.detalle.errores,
        detalle_nuevos: s.detalle.nuevos,
        detalle_actualizados: s.detalle.actualizados,
        detalle_fallido: s.detalleFallido,
        timestamp: new Date()
      };
    } catch (error) {
      console.log(`❌ Error en ScraperProyectos: ${error.message}`);
      return { success: false, error: error.message, timestamp: new Date() };
    }
  },

  /**
   * Vacía los buffers actuales escribiendo al sheet vía batch upsert.
   */
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
  },

  /**
   * Loop principal: paginar listado + traer detalle por fila.
   */
  extraer() {
    const tStart = Date.now();
    const inicial = this.fetchInicial();
    if (!inicial) return;

    let { html, cookies, viewState, viewStateName, formName, datatableId, prependId } = inicial;
    const primerasFilas = this.parsearFilasListado(html);
    console.log(`📄 Página 1: ${primerasFilas.length} proyectos (formName=${formName}, prependId=${prependId}, ViewState=${viewState ? 'ok' : 'missing'}, vsName=${viewStateName})`);

    if (!formName || !viewState) {
      this.logDiagnostico(html, formName);
      console.log('⚠️ No se pudo extraer formName/ViewState — abortando');
      return;
    }
    if (primerasFilas.length === 0) return;

    let viewStateActual = viewState;
    // Procesar primera página (fetch detalle por cada fila)
    viewStateActual = this.procesarFilasListado(primerasFilas, { cookies, viewState: viewStateActual, viewStateName, formName, prependId });

    const pageSize = primerasFilas.length;
    let first = pageSize;
    let pagina = 2;
    let reintentos = 0;
    let salida = 'fin natural';
    let proyectosProcesados = primerasFilas.length;
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
        console.log(`♻️ ${resp.error ? '<error>' : '<redirect>'} en partial-response → flush + re-bootstrap (first=${first})`);
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
      console.log(`📄 Página ${pagina} (first=${first}): ${filas.length} proyectos`);
      if (filas.length === 0) { salida = `página vacía first=${first}`; break; }

      if (resp.viewState) viewStateActual = resp.viewState;
      viewStateActual = this.procesarFilasListado(filas, { cookies, viewState: viewStateActual, viewStateName, formName, prependId });

      first += filas.length;
      pagina++;
      proyectosProcesados += filas.length;

      if (filas.length < pageSize) { salida = `página corta ${filas.length}<${pageSize}`; break; }

      // Flush periódico para visibilidad y resilience
      if (proyectosProcesados - ultimoFlush >= this.config.chunkProyectos) {
        this.flushBuffers();
        ultimoFlush = proyectosProcesados;
      }
    }

    if (pagina > this.config.maxPaginas) salida = `maxPaginas ${this.config.maxPaginas}`;
    const elapsed = Math.round((Date.now() - tStart) / 1000);
    console.log(`🏁 Extracción: ${pagina - 1} página(s), ${proyectosProcesados} proyectos, ${elapsed}s — salida: ${salida}`);
  },

  /**
   * Para cada fila del listado, hace un AJAX al botón "ojito" para
   * traer el panel pa-invitados-id, parsea el detalle y acumula
   * filas maestro + detalle en el buffer.
   * Devuelve el ViewState actualizado tras procesar todas las filas.
   */
  procesarFilasListado(filasListado, ctxAjax) {
    let viewState = ctxAjax.viewState;
    for (const filaList of filasListado) {
      Utilities.sleep(this.config.delayBetweenDetails);
      const respDetalle = this.fetchDetalleAjax({
        eyeButtonId: filaList.eyeButtonId,
        cookies: ctxAjax.cookies,
        viewState,
        viewStateName: ctxAjax.viewStateName,
        formName: ctxAjax.formName
      });

      if (!respDetalle || !respDetalle.html) {
        console.log(`⚠️ Detalle vacío para proyecto ${filaList.numero} (eye=${filaList.eyeButtonId})`);
        this._ctx.stats.detalleFallido++;
        // Aun asi guardamos lo que tenemos del listado
        this._ctx.bufferMaestro.push(this.armarFilaMaestroDesdeListado(filaList));
        this._ctx.stats.totalProyectos++;
        continue;
      }
      if (respDetalle.viewState) viewState = respDetalle.viewState;

      const detalle = this.parsearDetalle(respDetalle.html);
      const filaMaestro = this.armarFilaMaestro(filaList, detalle);
      const filasDetalle = this.armarFilasDetalle(filaList, detalle);

      this._ctx.bufferMaestro.push(filaMaestro);
      this._ctx.bufferDetalle.push(...filasDetalle);
      this._ctx.stats.totalProyectos++;
    }
    return viewState;
  },

  // === Listado (parseo de filas) ===

  /**
   * Parsea las filas del datatable proyectosdt_id.
   * @returns {Array<{numero, titulo, estado, eyeButtonId, rowIndex}>}
   */
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
      if (!celdas || celdas.length < 3) return null;

      const numero = this.valorCelda(celdas[0]);
      const titulo = this.valorCelda(celdas[1]);
      const estado = this.valorCelda(celdas[2]);

      // ID del botón "ojito" (el que dispara el modal de detalle)
      const idMatch = filaHtml.match(/<button[^>]*id="([^"]*j_idt\d+)"[^>]*onclick="PrimeFaces\.ab/);
      const eyeButtonId = idMatch ? idMatch[1] : null;

      const riMatch = filaHtml.match(/data-ri="(\d+)"/);
      const rowIndex = riMatch ? parseInt(riMatch[1], 10) : -1;

      if (!numero || !eyeButtonId) return null;

      return { numero, titulo, estado, eyeButtonId, rowIndex };
    } catch (error) {
      return null;
    }
  },

  valorCelda(celdaHtml) {
    if (!celdaHtml) return '';
    const sinTitle = celdaHtml.replace(/<span[^>]*class="ui-column-title"[^>]*>[\s\S]*?<\/span>/g, '');
    return sinTitle.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  },

  // === Detalle (parseo del panel pa-invitados-id) ===

  /**
   * Parsea el HTML del panel de detalle y devuelve un objeto con
   * todos los campos extraídos.
   * @returns {{consecutivo, titulo, tema, proponentes, comision, coordinador, ponentes, fechaRadicado}}
   */
  parsearDetalle(html) {
    return {
      consecutivo: (this.extraerCampoDetalle(html, 'Consecutivo')[0] || ''),
      titulo: (this.extraerCampoDetalle(html, 'Título')[0] || ''),
      tema: (this.extraerCampoDetalle(html, 'Tema')[0] || ''),
      proponentes: this.extraerCampoDetalle(html, 'Proponentes'),
      comision: (this.extraerCampoDetalle(html, 'Comisión')[0] || ''),
      coordinador: (this.extraerCampoDetalle(html, 'Coordinador')[0] || ''),
      ponentes: this.extraerCampoDetalle(html, 'Ponentes'),
      fechaRadicado: this.extraerFechaRadicado(html)
    };
  },

  /**
   * Extrae los valores asociados a un campo del detalle.
   * Estructura típica:
   *   <label ...>NOMBRE:</label>
   *   <div class="col-12 md:col-10">
   *     <label><span class="ui-outputlabel-label">VALOR</span></label>
   *     <label><span class="ui-outputlabel-label">VALOR2</span></label>
   *     ...
   *   </div>
   * @returns {string[]} Array de valores limpios (vacío si no hay).
   */
  extraerCampoDetalle(html, nombreCampo) {
    const nombreEsc = nombreCampo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<label[^>]*>\\s*${nombreEsc}\\s*:\\s*</label>\\s*<div\\s+class="col-12 md:col-10"[^>]*>([\\s\\S]*?)</div>`, 'i');
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
   * Extrae la fecha del primer registro de la tab "Estados" (que es el
   * evento "Radicado"). Formato esperado: "YYYY/MM/DD".
   */
  extraerFechaRadicado(html) {
    try {
      const idx = html.indexOf('Estados');
      if (idx === -1) return null;
      const sub = html.substring(idx);
      const trMatch = sub.match(/<tr[^>]*data-ri="0"[^>]*>[\s\S]*?<\/tr>/);
      if (!trMatch) return null;

      const spans = [];
      const re = /<span class="ui-outputlabel-label">([\s\S]*?)<\/span>/g;
      let m;
      while ((m = re.exec(trMatch[0])) !== null) {
        const v = m[1].replace(/<[^>]+>/g, '').trim();
        if (v) spans.push(v);
      }
      // Esperamos: [0]=Estado (ej. "Radicado"), [1]=Fecha
      const fechaStr = spans[1] || '';
      const fm = fechaStr.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (!fm) return null;
      return new Date(parseInt(fm[1], 10), parseInt(fm[2], 10) - 1, parseInt(fm[3], 10));
    } catch (e) {
      return null;
    }
  },

  // === Armado de filas para los sheets ===

  armarFilaMaestro(filaList, detalle) {
    const titulo = detalle.titulo || filaList.titulo || '';
    return {
      numero: filaList.numero,
      titulo: titulo,
      proponentes: (detalle.proponentes || []).join(' | '),
      estado: filaList.estado || '',
      fecha: detalle.fechaRadicado || null,
      comision: detalle.comision || ''
    };
  },

  armarFilaMaestroDesdeListado(filaList) {
    return {
      numero: filaList.numero,
      titulo: filaList.titulo || '',
      proponentes: '',
      estado: filaList.estado || '',
      fecha: null,
      comision: ''
    };
  },

  armarFilasDetalle(filaList, detalle) {
    const filas = [];
    const numero = filaList.numero;
    const titulo = detalle.titulo || filaList.titulo || '';

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

  // === PrimeFaces AJAX (igual patrón que ScraperSesiones) ===

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
   * AJAX al botón "ojito" de una fila: dispara el render del panel
   * pa-invitados-id con el detalle del proyecto.
   */
  fetchDetalleAjax({ eyeButtonId, cookies, viewState, viewStateName, formName }) {
    try {
      const partialPrefix = String(viewStateName).startsWith('jakarta') ? 'jakarta.faces' : 'javax.faces';
      const payload = {
        [`${partialPrefix}.partial.ajax`]: 'true',
        [`${partialPrefix}.source`]: eyeButtonId,
        [`${partialPrefix}.partial.execute`]: eyeButtonId,
        [`${partialPrefix}.partial.render`]: this.config.detailContainerId,
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

      const html = this.extraerUpdate(xml, this.config.detailContainerId);
      const viewStateNuevo = this.extraerUpdateViewState(xml);
      return { html, viewState: viewStateNuevo };
    } catch (error) {
      console.log(`❌ Error fetchDetalleAjax: ${error.message}`);
      return null;
    }
  },

  // === Helpers HTTP / parseo común (mismos que ScraperSesiones) ===

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
    const re = new RegExp(`<update[^>]*id="[^"]*${containerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*"[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</update>`);
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
