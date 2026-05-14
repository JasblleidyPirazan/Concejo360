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
    campos: ['numero', 'fecha', 'hora', 'temas', 'lugar', 'estado', 'tiene_acta'],
    maxRetries: 3,
    delayBetweenPages: 2000
  },

  /**
   * Función principal - Ejecuta todo el proceso
   * @returns {Object} Resultado del scraping
   */
  ejecutar() {
    try {
      console.log(`🚀 Iniciando scraper de sesiones`);
      
      const datos = this.extraer();
      const procesados = this.procesar(datos);
      const guardados = this.guardar(procesados);
      
      return this.resultado(guardados);
    } catch (error) {
      return this.error(error);
    }
  },

  /**
   * Extrae datos del sitio web SIMI
   * @returns {Array} Array de objetos raw extraídos
   */
  extraer() {
    const sesionesRaw = [];
    let paginaActual = 1;
    
    while (true) {
      const sesiones = this.extraerPagina();
      if (sesiones.length === 0) break;
      
      sesionesRaw.push(...sesiones);
      console.log(`📄 Página ${paginaActual}: ${sesiones.length} sesiones extraídas`);
      
      if (!this.siguientePagina()) break;
      paginaActual++;
      
      // Límite de seguridad
      if (paginaActual > 50) {
        console.log(`⚠️ Límite de páginas alcanzado: ${paginaActual}`);
        break;
      }
    }
    
    return sesionesRaw;
  },

  /**
   * Extrae sesiones de la página actual
   * @returns {Array} Sesiones de la página actual
   */
  extraerPagina() {
    try {
      const response = UrlFetchApp.fetch(this.config.url, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Concejal360)' },
        muteHttpExceptions: true
      });
      
      if (response.getResponseCode() !== 200) {
        throw new Error(`HTTP ${response.getResponseCode()}`);
      }
      
      const html = response.getContentText();
      return this.parsearHtmlSesiones(html);
      
    } catch (error) {
      console.log(`❌ Error extrayendo página: ${error.message}`);
      return [];
    }
  },

  /**
   * Parsea HTML y extrae datos de sesiones
   * @param {string} html - HTML de la página
   * @returns {Array} Sesiones parseadas
   */
  parsearHtmlSesiones(html) {
    const sesiones = [];

    try {
      // PrimeFaces datatable: el id "proposiciondt-id" vive en el tbody, no en <table>
      const tbodyMatch = html.match(/<tbody[^>]*id="proposiciondt-id_data"[^>]*>([\s\S]*?)<\/tbody>/);
      if (!tbodyMatch) {
        console.log('❌ tbody proposiciondt-id_data no encontrado en HTML');
        return [];
      }

      // Cada fila de datos lleva data-ri="N" (row index de PrimeFaces)
      const filasMatch = tbodyMatch[1].match(/<tr[^>]*data-ri="\d+"[^>]*>[\s\S]*?<\/tr>/g);
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
   * Guarda sesiones en Google Sheets
   * @param {Array} sesiones - Sesiones procesadas
   * @returns {Object} Estadísticas de guardado
   */
  guardar(sesiones) {
    try {
      return SheetsUtils.guardar(this.config.sheetName, sesiones);
    } catch (error) {
      console.log(`❌ Error guardando sesiones: ${error.message}`);
      return { nuevos: 0, actualizados: 0, errores: 1 };
    }
  },

  /**
   * Navega a la siguiente página
   * @returns {boolean} True si pudo navegar
   */
  siguientePagina() {
    try {
      // En Apps Script, esto se simularía modificando parámetros de URL
      // Por simplicidad, asumimos paginación por parámetro
      Utilities.sleep(this.config.delayBetweenPages);
      return false; // Por ahora, solo primera página
    } catch (error) {
      return false;
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