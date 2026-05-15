/**
 * Concejal360 - Sistema de Monitoreo del Concejo de Medellín
 * Archivo principal de Google Apps Script
 * Siguiendo principios: funciones cortas, manejo de errores, código limpio
 */

// Mapa de scrapers disponibles
const SCRAPERS = {
  sesiones: () => ScraperSesiones.ejecutar(),
  proyectos: () => ScraperProyectos.ejecutar(),
  acuerdos: () => ScraperAcuerdos.ejecutar(),
  comisiones: () => ScraperComisiones.ejecutar(),
  invitaciones: () => ScraperInvitaciones.ejecutar(),
  citaciones: () => ScraperCitaciones.ejecutar()
};

/**
 * Maneja requests POST desde el frontend
 * @param {Object} e - Event object con postData
 * @returns {Object} Respuesta JSON
 */
function doPost(e) {
  return _jsonResponse(_handlePost(e));
}

function _handlePost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const { action, type, params } = data;

    switch(action) {
      case 'scrape':
        return ejecutarScraping(type, params);
      case 'scrape_all':
        return ejecutarScrapingCompleto();
      case 'test':
        return ejecutarTest(type);
      case 'status':
        return obtenerEstadoSistema();
      default:
        return respuestaError('Acción no válida', 'INVALID_ACTION');
    }
  } catch (error) {
    return respuestaError(`Error procesando request: ${error.message}`, 'REQUEST_ERROR');
  }
}

/**
 * Maneja requests GET para datos y dashboard
 * @param {Object} e - Event object con parameters
 * @returns {GoogleAppsScript.Content.TextOutput} Respuesta JSON envuelta para Apps Script
 */
function doGet(e) {
  return _jsonResponse(_handleGet(e));
}

function _handleGet(e) {
  const action = e.parameter.action || 'dashboard';

  try {
    switch(action) {
      case 'dashboard':
        return obtenerDashboard();
      case 'data':
        return obtenerDatos(e.parameter);
      case 'resumen-concejales':
        return respuestaExitosa(obtenerResumenConcejales());
      case 'health':
        return respuestaExitosa({ status: 'OK', timestamp: new Date() });
      default:
        return respuestaError('Endpoint no encontrado', 'ENDPOINT_NOT_FOUND');
    }
  } catch (error) {
    return respuestaError(`Error en GET: ${error.message}`, 'GET_ERROR');
  }
}

/**
 * Envuelve cualquier objeto JS en una respuesta JSON valida para Apps Script.
 * Sin esto, doGet/doPost devuelven el error "el valor de retorno no es admitido".
 */
function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Ejecuta scraping de un tipo específico
 * @param {string} tipo - Tipo de scraper a ejecutar
 * @param {Object} params - Parámetros adicionales
 * @returns {Object} Resultado del scraping
 */
function ejecutarScraping(tipo, params = {}) {
  if (!SCRAPERS[tipo]) {
    return respuestaError(`Scraper '${tipo}' no encontrado`, 'SCRAPER_NOT_FOUND');
  }
  
  const inicio = new Date();
  console.log(`🚀 Iniciando scraping: ${tipo}`);
  
  try {
    const resultado = SCRAPERS[tipo]();
    const fin = new Date();
    const duracion = (fin - inicio) / 1000;
    
    const response = {
      success: true,
      tipo: tipo,
      inicio: inicio,
      fin: fin,
      duracion: duracion,
      ...resultado
    };
    
    // Guardar log de ejecución
    SheetsUtils.guardarLogEjecucion(response);
    console.log(`✅ ${tipo} completado: ${resultado.procesados || 0} procesados, ${resultado.nuevos || 0} nuevos`);
    
    return response;
    
  } catch (error) {
    const errorResponse = respuestaError(`Error en scraper ${tipo}: ${error.message}`, 'SCRAPER_ERROR');
    SheetsUtils.guardarLogEjecucion({...errorResponse, tipo: tipo, duracion: (new Date() - inicio) / 1000});
    return errorResponse;
  }
}

/**
 * Ejecuta todos los scrapers en secuencia
 * @returns {Object} Resultados consolidados
 */
function ejecutarScrapingCompleto() {
  const inicio = new Date();
  const resultados = [];
  const tipos = Object.keys(SCRAPERS);
  
  console.log(`🚀 Iniciando scraping completo: ${tipos.length} scrapers`);
  
  for (const tipo of tipos) {
    try {
      const resultado = ejecutarScraping(tipo);
      resultados.push(resultado);
      
      // Pequeña pausa entre scrapers
      Utilities.sleep(1000);
      
    } catch (error) {
      resultados.push({
        tipo: tipo,
        success: false,
        error: error.message,
        timestamp: new Date()
      });
    }
  }
  
  try {
    const derivados = AgregadorDerivados.actualizarTodo();
    resultados.push(derivados);
  } catch (error) {
    resultados.push({ tipo: 'derivados', success: false, error: error.message, timestamp: new Date() });
  }

  const resumen = calcularResumen(resultados);
  const fin = new Date();

  console.log(`✅ Scraping completo finalizado: ${resumen.exitosos}/${tipos.length} exitosos`);
  
  return {
    success: true,
    tipo: 'completo',
    inicio: inicio,
    fin: fin,
    duracion: (fin - inicio) / 1000,
    resultados: resultados,
    resumen: resumen
  };
}

/**
 * Obtiene dashboard con métricas del sistema
 * @returns {Object} Datos del dashboard
 */
function obtenerDashboard() {
  try {
    const metricas = {};
    
    // Obtener métricas de cada tipo
    Object.keys(SHEETS_CONFIG).forEach(tipo => {
      try {
        const datos = SheetsUtils.obtener(`${tipo}_maestro`);
        metricas[tipo] = {
          total: datos.length,
          ultima_actualizacion: obtenerUltimaActualizacion(tipo)
        };
      } catch (error) {
        metricas[tipo] = { total: 0, error: error.message };
      }
    });
    
    return respuestaExitosa({
      metricas: metricas,
      sistema: {
        scrapers_disponibles: Object.keys(SCRAPERS).length,
        ultima_ejecucion: obtenerUltimaEjecucion()
      }
    });
    
  } catch (error) {
    return respuestaError(`Error obteniendo dashboard: ${error.message}`, 'DASHBOARD_ERROR');
  }
}

/**
 * Obtiene datos específicos con filtros y paginación
 * @param {Object} params - Parámetros de consulta
 * @returns {Object} Datos solicitados
 */
function obtenerDatos(params) {
  try {
    const { tipo, page = 1, limit = 50, filtros = {} } = params;
    
    if (!tipo || !SHEETS_CONFIG[tipo]) {
      return respuestaError('Tipo de datos no válido', 'INVALID_DATA_TYPE');
    }
    
    const datos = SheetsUtils.obtener(`${tipo}_maestro`, filtros);
    const paginados = aplicarPaginacion(datos, page, limit);
    
    return respuestaExitosa({
      data: paginados.data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: datos.length,
        pages: Math.ceil(datos.length / limit)
      }
    });
    
  } catch (error) {
    return respuestaError(`Error obteniendo datos: ${error.message}`, 'DATA_ERROR');
  }
}

/**
 * Obtiene el estado actual del sistema
 * @returns {Object} Estado del sistema
 */
function obtenerEstadoSistema() {
  try {
    const estado = {
      timestamp: new Date(),
      scrapers: {},
      storage: {}
    };
    
    // Verificar cada scraper
    Object.keys(SCRAPERS).forEach(tipo => {
      estado.scrapers[tipo] = {
        disponible: true,
        ultima_ejecucion: obtenerUltimaEjecucion(tipo)
      };
    });
    
    // Verificar almacenamiento
    estado.storage.sheets = verificarAccesoSheets();
    estado.storage.drive = verificarAccesoDrive();
    
    return respuestaExitosa(estado);
    
  } catch (error) {
    return respuestaError(`Error verificando estado: ${error.message}`, 'STATUS_ERROR');
  }
}

/**
 * Ejecuta test básico de un scraper
 * @param {string} tipo - Tipo de scraper a testear
 * @returns {Object} Resultado del test
 */
function ejecutarTest(tipo) {
  if (!SCRAPERS[tipo]) {
    return respuestaError(`Scraper '${tipo}' no encontrado`, 'SCRAPER_NOT_FOUND');
  }
  
  try {
    // Test básico sin guardar datos
    console.log(`🧪 Ejecutando test: ${tipo}`);
    const resultado = { success: true, test: true, tipo: tipo };
    
    return respuestaExitosa(resultado);
    
  } catch (error) {
    return respuestaError(`Test fallido para ${tipo}: ${error.message}`, 'TEST_FAILED');
  }
}

// === Funciones auxiliares ===

/**
 * Crea respuesta exitosa estándar
 * @param {Object} data - Datos de respuesta
 * @returns {Object} Respuesta formateada
 */
function respuestaExitosa(data) {
  return {
    success: true,
    timestamp: new Date(),
    ...data
  };
}

/**
 * Crea respuesta de error estándar
 * @param {string} mensaje - Mensaje de error
 * @param {string} codigo - Código de error
 * @returns {Object} Respuesta de error formateada
 */
function respuestaError(mensaje, codigo = 'UNKNOWN_ERROR') {
  console.log(`❌ Error ${codigo}: ${mensaje}`);
  return {
    success: false,
    error: mensaje,
    code: codigo,
    timestamp: new Date()
  };
}

/**
 * Calcula resumen de resultados de scraping
 * @param {Array} resultados - Array de resultados
 * @returns {Object} Resumen calculado
 */
function calcularResumen(resultados) {
  return {
    total: resultados.length,
    exitosos: resultados.filter(r => r.success).length,
    fallidos: resultados.filter(r => !r.success).length,
    total_procesados: resultados.reduce((sum, r) => sum + (r.procesados || 0), 0),
    total_nuevos: resultados.reduce((sum, r) => sum + (r.nuevos || 0), 0),
    total_actualizados: resultados.reduce((sum, r) => sum + (r.actualizados || 0), 0)
  };
}

/**
 * Aplica paginación a un array de datos
 * @param {Array} datos - Datos a paginar
 * @param {number} page - Página actual
 * @param {number} limit - Límite por página
 * @returns {Object} Datos paginados
 */
function aplicarPaginacion(datos, page, limit) {
  const offset = (page - 1) * limit;
  return {
    data: datos.slice(offset, offset + limit),
    hasMore: offset + limit < datos.length
  };
}

/**
 * Obtiene la fecha de última actualización de un tipo
 * @param {string} tipo - Tipo de datos
 * @returns {Date|null} Última actualización
 */
function obtenerUltimaActualizacion(tipo) {
  try {
    const logs = SheetsUtils.obtener('logs_ejecucion', { tipo: tipo });
    if (logs.length > 0) {
      return logs[0].timestamp;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Obtiene la última ejecución general o de un tipo específico
 * @param {string} tipo - Tipo específico (opcional)
 * @returns {Date|null} Última ejecución
 */
function obtenerUltimaEjecucion(tipo = null) {
  try {
    const filtros = tipo ? { tipo: tipo } : {};
    const logs = SheetsUtils.obtener('logs_ejecucion', filtros);
    return logs.length > 0 ? logs[0].timestamp : null;
  } catch (error) {
    return null;
  }
}

/**
 * Verifica acceso a Google Sheets
 * @returns {boolean} True si hay acceso
 */
function verificarAccesoSheets() {
  try {
    SpreadsheetApp.openById(GOOGLE_IDS.spreadsheetId);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Verifica acceso a Google Drive
 * @returns {boolean} True si hay acceso
 */
function verificarAccesoDrive() {
  try {
    DriveApp.getFolderById(GOOGLE_IDS.driveFolder);
    return true;
  } catch (error) {
    return false;
  }
}