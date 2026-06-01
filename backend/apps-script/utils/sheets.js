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
   * Guardar datos en Google Sheets con upsert masivo (batch).
   *
   * Estrategia: leer toda la hoja una sola vez, hacer merge en memoria
   * indexado por la columna clave (numero o consecutivo), y reescribir
   * el body en una sola llamada setValues. Esto evita el O(N²) del
   * read-per-row anterior y permite manejar miles de filas en segundos.
   *
   * Merge-friendly: al actualizar, las columnas presentes en `dato`
   * pisan al existente; las que no estén en `dato` conservan el valor
   * actual del sheet (no se borran).
   *
   * @param {string} sheetName - Nombre de la hoja destino
   * @param {Array} datos - Objetos a insertar/actualizar
   * @returns {Object} { nuevos, actualizados, errores }
   */
  guardar(sheetName, datos) {
    try {
      if (!datos || datos.length === 0) {
        return { nuevos: 0, actualizados: 0, errores: 0 };
      }

      const sheet = this.obtenerOCrearHoja(sheetName);
      const config = SHEETS_CONFIG[sheetName.replace('_maestro', '')];

      // 1) Lectura única de toda la hoja
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      let headers;
      let filas;

      if (lastRow >= 1 && lastCol >= 1) {
        const valores = sheet.getRange(1, 1, lastRow, lastCol).getValues();
        headers = valores[0];
        filas = valores.slice(1);
      } else if (config) {
        headers = config.campos.slice();
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        filas = [];
      } else {
        headers = Object.keys(datos[0]);
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        filas = [];
      }

      // 2) Determinar columnas clave (puede ser compuesta vía config.claveUnica).
      //    Default: 'numero' o 'consecutivo' simple si la config no especifica.
      const claveCampos = (config && Array.isArray(config.claveUnica) && config.claveUnica.length > 0)
        ? config.claveUnica
        : (headers.indexOf('numero') !== -1 ? ['numero']
           : headers.indexOf('consecutivo') !== -1 ? ['consecutivo']
           : null);
      if (!claveCampos) throw new Error(`No se encontro columna clave (numero/consecutivo) en ${sheetName}`);

      // Indices de cada campo clave en el array de headers
      const claveIdxs = claveCampos.map(c => headers.indexOf(c));
      for (let i = 0; i < claveIdxs.length; i++) {
        if (claveIdxs[i] === -1) throw new Error(`Campo de clave '${claveCampos[i]}' no esta en headers de ${sheetName}`);
      }

      // Normaliza un valor para que la clave sea estable (Date → timestamp, resto → string trim)
      const normalizar = (v) => {
        if (v == null) return '';
        if (v instanceof Date) return String(v.getTime());
        return String(v).trim();
      };
      const buildKeyRow = (row) => claveIdxs.map(i => normalizar(row[i])).join('|');
      const buildKeyDato = (dato) => claveCampos.map(c => normalizar(dato[c])).join('|');

      // 3) Indice clave → rowIndex, deduplicando filas existentes en el proceso.
      //    Si la hoja ya tenía duplicados los fusiona (último valor no vacío gana).
      const indice = new Map();
      const claveVacia = claveCampos.map(() => '').join('|');
      const filasDedupe = [];
      for (let i = 0; i < filas.length; i++) {
        const k = buildKeyRow(filas[i]);
        if (!k || k === claveVacia) continue;
        if (indice.has(k)) {
          const idx = indice.get(k);
          for (let c = 0; c < filas[i].length; c++) {
            const v = filas[i][c];
            if (v !== '' && v !== null && v !== undefined) filasDedupe[idx][c] = v;
          }
        } else {
          indice.set(k, filasDedupe.length);
          filasDedupe.push(filas[i].slice());
        }
      }
      filas = filasDedupe;

      // 4) Aplicar upsert en memoria
      const stats = { nuevos: 0, actualizados: 0, errores: 0 };
      for (const dato of datos) {
        const k = buildKeyDato(dato);
        if (!k || k === claveVacia) { stats.errores++; continue; }

        if (indice.has(k)) {
          // Update merge-friendly: solo pisar columnas presentes en dato
          const row = filas[indice.get(k)];
          for (let c = 0; c < headers.length; c++) {
            const h = headers[c];
            if (dato[h] !== undefined && dato[h] !== null) row[c] = dato[h];
          }
          stats.actualizados++;
        } else {
          const nuevaFila = headers.map(h => (dato[h] === undefined || dato[h] === null) ? '' : dato[h]);
          indice.set(k, filas.length);
          filas.push(nuevaFila);
          stats.nuevos++;
        }
      }

      // 5) Reescribir el body en una sola operación
      if (filas.length > 0) {
        sheet.getRange(2, 1, filas.length, headers.length).setValues(filas);
      }
      // Eliminar filas sobrantes si la hoja quedó más corta (ej. tras deduplicación)
      const ultimaFila = sheet.getLastRow();
      if (ultimaFila > filas.length + 1) {
        sheet.deleteRows(filas.length + 2, ultimaFila - filas.length - 1);
      }

      return stats;
    } catch (error) {
      console.log(`❌ Error en guardar batch ${sheetName}: ${error.message}`);
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
    const config = SHEETS_CONFIG[sheet.getName().replace('_maestro', '')];
    const valores = this.objetoAArray(dato, config);
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

  /**
   * Elimina filas duplicadas de una hoja usando la clave definida en SHEETS_CONFIG.
   * Llama guardar() con un array vacío para forzar solo la deduplicación.
   */
  limpiarDuplicados(sheetName) {
    const sheet = SpreadsheetApp.openById(GOOGLE_IDS.spreadsheetId).getSheetByName(sheetName);
    if (!sheet) { console.log(`⚠️ Hoja "${sheetName}" no encontrada`); return; }
    const antes = sheet.getLastRow() - 1;
    this.guardar(sheetName, []); // sin datos nuevos → solo deduplica + trunca
    const despues = sheet.getLastRow() - 1;
    console.log(`🧹 ${sheetName}: ${antes} → ${despues} filas (eliminados ${antes - despues} duplicados)`);
  },

  limpiarLogsAntiguos(sheet) {
    const numRows = sheet.getLastRow();
    if (numRows > CONFIG.maxLogEntries) {
      const rowsToDelete = numRows - CONFIG.maxLogEntries;
      sheet.deleteRows(2, rowsToDelete);
    }
  }
};