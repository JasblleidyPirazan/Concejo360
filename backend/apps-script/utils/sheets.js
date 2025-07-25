/**
 * Utilidades para operaciones con Google Sheets
 * Patrón: Funciones puras, una responsabilidad cada una
 */

const SheetsUtils = {
  /**
   * Obtener datos de una hoja específica
   * @param {string} sheetName - Nombre de la hoja
   * @param {Object} filtros - Filtros opcionales
   * @returns {Array} Array de objetos con los datos
   */
  obtener(sheetName, filtros = {}) {
    try {
      const sheet = SpreadsheetApp.openById(GOOGLE_IDS.spreadsheetId)
                                  .getSheetByName(sheetName);
      if (!sheet) return [];

      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const rows = data.slice(1);

      return rows.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index];
        });
        return obj;
      }).filter(row => this.aplicarFiltros(row, filtros));

    } catch (error) {
      console.log(`❌ Error obteniendo datos de ${sheetName}: ${error.message}`);
      return [];
    }
  },

  /**
   * Guardar datos en Google Sheets
   * @param {string} sheetName - Nombre de la hoja
   * @param {Array} datos - Array de objetos a guardar
   * @returns {Object} Estadísticas de guardado
   */
  guardar(sheetName, datos) {
    try {
      if (!datos || datos.length === 0) {
        return { nuevos: 0, actualizados: 0, errores: 0 };
      }

      const sheet = this.obtenerOCrearHoja(sheetName);
      const config = SHEETS_CONFIG[sheetName.replace('_maestro', '')];
      const stats = { nuevos: 0, actualizados: 0, errores: 0 };

      datos.forEach(dato => {
        try {
          const existente = this.buscarPorClave(sheet, dato);
          if (existente) {
            this.actualizar(sheet, existente.row, dato);
            stats.actualizados++;
          } else {
            this.insertar(sheet, dato, config);
            stats.nuevos++;
          }
        } catch (error) {
          console.log(`❌ Error guardando registro: ${error.message}`);
          stats.errores++;
        }
      });

      return stats;
    } catch (error) {
      console.log(`❌ Error en guardar: ${error.message}`);
      return { nuevos: 0, actualizados: 0, errores: 1 };
    }
  },

  /**
   * Buscar registro por número/consecutivo
   * @param {string} sheetName - Nombre de la hoja
   * @param {string} numero - Número a buscar
   * @returns {Object|null} Registro encontrado o null
   */
  buscarPorNumero(sheetName, numero) {
    const datos = this.obtener(sheetName);
    return datos.find(d => 
      d.numero === numero || 
      d.consecutivo === numero
    ) || null;
  },

  /**
   * Guardar log de ejecución
   * @param {Object} logData - Datos del log
   */
  guardarLogEjecucion(logData) {
    try {
      const sheet = this.obtenerOCrearHoja('logs_ejecucion');
      const timestamp = new Date();
      
      sheet.appendRow([
        timestamp,
        logData.tipo,
        logData.success,
        logData.procesados || 0,
        logData.nuevos || 0,
        logData.actualizados || 0,
        logData.error || '',
        logData.duracion || 0
      ]);

      // Mantener solo los últimos 1000 registros
      this.limpiarLogsAntiguos(sheet);
    } catch (error) {
      console.log(`❌ Error guardando log: ${error.message}`);
    }
  },

  // Métodos privados
  obtenerOCrearHoja(sheetName) {
    const spreadsheet = SpreadsheetApp.openById(GOOGLE_IDS.spreadsheetId);
    let sheet = spreadsheet.getSheetByName(sheetName);
    
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
      this.configurarEncabezados(sheet, sheetName);
    }
    
    return sheet;
  },

  configurarEncabezados(sheet, sheetName) {
    const tipoSheet = sheetName.replace('_maestro', '');
    const config = SHEETS_CONFIG[tipoSheet];
    
    if (config) {
      sheet.getRange(1, 1, 1, config.campos.length)
           .setValues([config.campos]);
    }
  },

  buscarPorClave(sheet, dato) {
    const data = sheet.getDataRange().getValues();
    const clave = dato.numero || dato.consecutivo;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === clave) {
        return { row: i + 1, data: data[i] };
      }
    }
    return null;
  },

  actualizar(sheet, row, dato) {
    const valores = this.objetoAArray(dato);
    sheet.getRange(row, 1, 1, valores.length).setValues([valores]);
  },

  insertar(sheet, dato, config) {
    const valores = this.objetoAArray(dato, config);
    sheet.appendRow(valores);
  },

  objetoAArray(dato, config = null) {
    if (config) {
      return config.campos.map(campo => dato[campo] || '');
    }
    return Object.values(dato);
  },

  aplicarFiltros(row, filtros) {
    return Object.keys(filtros).every(key => {
      const valor = filtros[key];
      return row[key] === valor;
    });
  },

  limpiarLogsAntiguos(sheet) {
    const numRows = sheet.getLastRow();
    if (numRows > CONFIG.maxLogEntries) {
      const rowsToDelete = numRows - CONFIG.maxLogEntries;
      sheet.deleteRows(2, rowsToDelete);
    }
  }
};