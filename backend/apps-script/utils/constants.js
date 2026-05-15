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
    campos: ['numero', 'fecha', 'hora', 'temas', 'lugar', 'estado', 'tiene_acta'],
    tipos: ['string', 'date', 'string', 'array', 'string', 'string', 'boolean']
  },
  proyectos: {
    nombre: 'proyectos_maestro',
    campos: ['numero', 'titulo', 'proponentes', 'estado', 'fecha', 'comision'],
    tipos: ['string', 'string', 'array', 'string', 'date', 'string']
  },
  acuerdos: {
    nombre: 'acuerdos_maestro', 
    campos: ['numero', 'titulo', 'estado', 'fecha_aprobacion', 'proponentes'],
    tipos: ['string', 'string', 'string', 'date', 'array']
  },
  comisiones: {
    nombre: 'comisiones_maestro',
    campos: ['consecutivo', 'titulo', 'estado', 'fecha_aprobacion', 'tipo'],
    tipos: ['string', 'string', 'string', 'date', 'string']
  },
  invitaciones: {
    nombre: 'invitaciones_maestro',
    campos: ['consecutivo', 'titulo', 'estado', 'fecha', 'bancadas'],
    tipos: ['string', 'string', 'string', 'date', 'array']
  },
  citaciones: {
    nombre: 'citaciones_maestro',
    campos: ['consecutivo', 'titulo', 'estado', 'fecha', 'descripcion'],
    tipos: ['string', 'string', 'string', 'date', 'string']
  },
  concejales: {
    nombre: 'concejales',
    campos: ['concejal', 'ano', 'periodo'],
    tipos: ['string', 'number', 'string']
  },
  bancadas: {
    nombre: 'bancadas',
    campos: ['bancada', 'ano', 'periodo'],
    tipos: ['string', 'number', 'string']
  }
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