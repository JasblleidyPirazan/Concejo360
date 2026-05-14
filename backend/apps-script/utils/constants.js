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