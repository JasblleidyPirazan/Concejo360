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
 * @returns {GoogleAppsScript.Content.TextOutput} Respuesta JSON
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const { action, type, params } = data;

    switch(action) {
      case 'scrape':
        return jsonOutput(ejecutarScraping(type, params));
      case 'scrape_all':
        return jsonOutput(ejecutarScrapingCompleto());
      case 'test':
        return jsonOutput(ejecutarTest(type));
      case 'status':
        return jsonOutput(obtenerEstadoSistema());
      default:
        return jsonOutput(respuestaError('Acción no válida', 'INVALID_ACTION'));
    }
  } catch (error) {
    return jsonOutput(respuestaError(`Error procesando request: ${error.message}`, 'REQUEST_ERROR'));
  }
}

/**
 * Maneja requests GET para datos y dashboard
 * @param {Object} e - Event object con parameters
 * @returns {GoogleAppsScript.Content.TextOutput} Respuesta JSON
 */
function doGet(e) {
  const action = e.parameter.action || 'dashboard';

  try {
    switch(action) {
      case 'dashboard':
        return jsonOutput(obtenerDashboard());
      case 'data':
        return jsonOutput(obtenerDatos(e.parameter));
      case 'health':
        return jsonOutput(respuestaExitosa({ status: 'OK', timestamp: new Date() }));
      default:
        return jsonOutput(respuestaError('Endpoint no encontrado', 'ENDPOINT_NOT_FOUND'));
    }
  } catch (error) {
    return jsonOutput(respuestaError(`Error en GET: ${error.message}`, 'GET_ERROR'));
  }
}

/**
 * Envuelve un payload como TextOutput JSON para web apps de Apps Script.
 * @param {Object} payload - Objeto a serializar
 * @returns {GoogleAppsScript.Content.TextOutput} Respuesta TextOutput
 */
function jsonOutput(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
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

// === Wrappers para ejecutar desde el editor (Run menu) ===

function testSesiones()      { return ejecutarScraping('sesiones'); }
function testProyectos()     { return ejecutarScraping('proyectos'); }
function testAcuerdos()      { return ejecutarScraping('acuerdos'); }
function testComisiones()    { return ejecutarScraping('comisiones'); }
function testInvitaciones()  { return ejecutarScraping('invitaciones'); }
function testCitaciones()    { return ejecutarScraping('citaciones'); }
function testScrapingCompleto() { return ejecutarScrapingCompleto(); }

// === Control del backfill de sesiones (resume entre corridas) ===

/**
 * Lee el resume offset actual de sesiones desde ScriptProperties.
 * Si > 0, la próxima corrida de testSesiones reanudará desde ahí.
 * Si = 0 (o no existe), la próxima corrida arranca desde la página 1.
 */
function verResumeOffsetSesiones() {
  const offset = ScraperSesiones.leerResumeOffset();
  console.log(`Resume offset sesiones = ${offset}`);
  return offset;
}

/**
 * Borra el resume offset. Usar cuando se quiere forzar a la próxima
 * corrida a empezar desde el principio (por ejemplo, tras vaciar el
 * sheet, o si se detecto que el offset quedo desactualizado).
 */
function resetSesionesBackfill() {
  ScraperSesiones.limpiarResumeOffset();
  console.log('🔄 Resume offset de sesiones reseteado a 0');
  return { reset: true };
}

// === Wrappers de trigger (visibles en el dropdown de main.gs) ===
// Las funciones reales viven en triggers/scheduled.js pero exponemos
// alias aquí para que aparezcan siempre en el selector de funciones.

function instalarTriggerSesiones12h() { return setupTriggerSesiones12h(); }
function quitarTriggerSesiones()      { return removerTriggerSesiones(); }
function verTriggers()                { return listarTriggers(); }

/**
 * Diagnostico: fetches la URL del scraper de sesiones y reporta
 * que HTML llega, IDs presentes, tablas, y si aparece la data esperada.
 * Ejecutar desde el editor para diagnosticar cuando el scraper trae 0 filas.
 */
function diagSesiones() {
  const url = URLS.sesiones;
  console.log('GET ' + url);

  const response = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9'
    },
    muteHttpExceptions: true,
    followRedirects: true
  });

  const code = response.getResponseCode();
  const html = response.getContentText();
  console.log('HTTP ' + code + ' | bytes: ' + html.length);

  const headers = response.getAllHeaders();
  console.log('Content-Type: ' + (headers['Content-Type'] || headers['content-type']));
  console.log('Set-Cookie: ' + (headers['Set-Cookie'] || headers['set-cookie'] || '(ninguna)'));

  const tablas = html.match(/<table[^>]*>/g) || [];
  console.log('Tablas encontradas: ' + tablas.length);
  tablas.slice(0, 10).forEach((t, i) => console.log('  [' + i + '] ' + t));

  const ids = [...new Set((html.match(/id="[^"]+"/g) || []))];
  console.log('IDs unicos: ' + ids.length);
  ids.filter(id => /dt|table|sesion|debate|proposicion/i.test(id))
     .slice(0, 20)
     .forEach(id => console.log('  ' + id));

  const tieneMarcadorDatos = /sesi[oó]n no\.|recinto de sesiones|domingo, 24 de mayo/i.test(html);
  console.log('Contiene datos visibles (texto de la pagina): ' + tieneMarcadorDatos);

  const viewState = html.match(/javax\.faces\.ViewState[^"]*"[^"]*"\s*value="([^"]+)"/);
  console.log('ViewState presente: ' + (viewState ? 'si' : 'no'));

  console.log('--- excerpt (primeros 1200 chars) ---');
  console.log(html.substring(0, 1200));
  console.log('--- excerpt (chars 1200-2400) ---');
  console.log(html.substring(1200, 2400));

  return { code: code, bytes: html.length, tablas: tablas.length };
}