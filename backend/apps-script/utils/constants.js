/**
 * Constantes del sistema - URLs y configuraciones
 * Siguiendo principio: Una sola fuente de verdad
 */

// URLs del sitio SIMI
const URLS = {
  sesiones: 'https://simi.concejodemedellin.gov.co/simi3/invitados/plenaria/debates.xhtml',
  proyectos: 'https://simi.concejodemedellin.gov.co/simi3/invitados/proyectos/proyectos.xhtml',
  acuerdos: 'https://simi.concejodemedellin.gov.co/simi3/invitados/proyectos/acuerdos.xhtml',
  comisiones: 'https://simi.concejodemedellin.gov.co/simi3/invitados/proposiciones/comisiones.xhtml',
  invitaciones: 'https://simi.concejodemedellin.gov.co/simi3/invitados/proposiciones/invitaciones.xhtml',
  citaciones: 'https://simi.concejodemedellin.gov.co/simi3/invitados/proposiciones/citaciones.xhtml'
};

// Configuración de Google Sheets
const SHEETS_CONFIG = {
  sesiones: {
    nombre: 'sesiones_maestro',
    campos: ['numero', 'fecha', 'hora', 'temas', 'detalle', 'lugar', 'estado', 'fecha_extraccion'],
    tipos: ['string', 'date', 'string', 'string', 'string', 'string', 'string', 'date'],
    // numero NO es unico (se resetea por año/período en SIMI). Composite key con fecha.
    claveUnica: ['numero', 'fecha']
  },
  sesiones_cambios: {
    nombre: 'sesiones_cambios',
    campos: ['numero', 'estado_anterior', 'estado_nuevo', 'fecha_cambio', 'tipo_cambio'],
    tipos: ['string', 'string', 'string', 'date', 'string']
  },
  proyectos: {
    nombre: 'proyectos_maestro',
    campos: ['numero', 'titulo', 'proponentes', 'estado', 'fecha', 'comision'],
    tipos: ['string', 'string', 'string', 'string', 'date', 'string'],
    // numero ya incluye año (ej. "89-2026") asi que es unico
    claveUnica: ['numero']
  },
  proyectos_detalle: {
    nombre: 'proyectos_detalle',
    campos: ['numero', 'titulo', 'rol', 'concejal'],
    tipos: ['string', 'string', 'string', 'string'],
    // Cada combinacion (proyecto, rol, concejal) es unica
    claveUnica: ['numero', 'rol', 'concejal']
  },
  acuerdos: {
    nombre: 'acuerdos_maestro',
    campos: ['no_acuerdo', 'no_proyecto_acuerdo', 'titulo', 'estado'],
    tipos: ['string', 'string', 'string', 'string'],
    // no_acuerdo incluye año (ej "58-2026") asi que es unico
    claveUnica: ['no_acuerdo']
  },
  acuerdos_detalle: {
    nombre: 'acuerdos_detalle',
    campos: ['no_acuerdo', 'titulo', 'fecha_sancion', 'ano_sancion', 'link_astrea', 'comision'],
    tipos: ['string', 'string', 'date', 'string', 'string', 'string'],
    claveUnica: ['no_acuerdo']
  },
  acuerdos_concejales: {
    nombre: 'acuerdos_concejales',
    campos: ['numero', 'titulo', 'rol', 'concejal'],
    tipos: ['string', 'string', 'string', 'string'],
    claveUnica: ['numero', 'rol', 'concejal']
  },
  acuerdos_tiempos: {
    nombre: 'acuerdos_tiempos',
    campos: ['id_acuerdo', 'acuerdo', 'actividad', 'fecha', 'fecha_extraccion'],
    tipos: ['string', 'string', 'string', 'date', 'date'],
    claveUnica: ['id_acuerdo', 'actividad']
  },
  comisiones: {
    nombre: 'comisiones_maestro',
    campos: ['fecha', 'acta', 'consecutivo', 'titulo', 'estado', 'descripcion', 'coordinador'],
    tipos: ['date', 'string', 'string', 'string', 'string', 'string', 'string'],
    claveUnica: ['consecutivo']
  },
  invitaciones: {
    nombre: 'invitaciones_maestro',
    campos: ['fecha', 'acta_aprobacion', 'consecutivo', 'titulo', 'descripcion', 'estado'],
    tipos: ['date', 'string', 'string', 'string', 'string', 'string'],
    claveUnica: ['consecutivo']
  },
  invitaciones_detalleBa: {
    nombre: 'invitaciones_detalleBa',
    campos: ['consecutivo', 'titulo', 'bancadas'],
    tipos: ['string', 'string', 'string'],
    claveUnica: ['consecutivo', 'bancadas']
  },
  citaciones: {
    nombre: 'citaciones_maestro',
    campos: ['fecha', 'acta_aprobacion', 'consecutivo', 'titulo', 'descripcion', 'integrantes', 'estado'],
    tipos: ['date', 'string', 'string', 'string', 'string', 'string', 'string'],
    claveUnica: ['consecutivo']
  },
  citaciones_detalleBa: {
    nombre: 'citaciones_detalleBa',
    campos: ['consecutivo', 'titulo', 'bancadas'],
    tipos: ['string', 'string', 'string'],
    claveUnica: ['consecutivo', 'bancadas']
  },
  concejales: {
    nombre: 'concejales',
    campos: ['concejal', 'ano', 'periodo'],
    tipos: ['string', 'number', 'string'],
    claveUnica: ['concejal', 'ano']
  },
  bancadas: {
    nombre: 'bancadas',
    campos: ['bancada', 'ano', 'periodo'],
    tipos: ['string', 'number', 'string'],
    claveUnica: ['bancada', 'ano']
  }
};

// IDs de Google Drive y Sheets (configurar después)
const GOOGLE_IDS = {
  spreadsheetId: '16cSMD3-ymX6vTPkjUBNcJhUgnvSQY6A3faAWI5cvYF8', // ID del Google Sheet principal
  driveFolder: '1_y-0IbCNqaoDb23xJfkvjNx5YsUVFjk6',   // ID de la carpeta en Drive para PDFs
  logSheet: 'logs_ejecucion'       // ID del sheet para logs
};

// Configuraciones del sistema
const CONFIG = {
  maxRetries: 3,
  delayBetweenRequests: 1000,
  maxLogEntries: 1000
};

// Periodos del Concejo de Medellín (rango inclusivo)
const PERIODOS = [
  { label: '2024-2027', desde: 2024, hasta: 2027 },
  { label: '2020-2023', desde: 2020, hasta: 2023 },
  { label: '2016-2019', desde: 2016, hasta: 2019 },
  { label: '2012-2015', desde: 2012, hasta: 2015 },
  { label: '2008-2011', desde: 2008, hasta: 2011 }
];

/**
 * Devuelve el label del periodo para un año, o null si está fuera de rango.
 * @param {number} year
 * @returns {string|null}
 */
function getPeriodo(year) {
  if (!year || isNaN(year)) return null;
  const y = parseInt(year);
  const p = PERIODOS.find(p => y >= p.desde && y <= p.hasta);
  return p ? p.label : null;
}
