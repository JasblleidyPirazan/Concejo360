/**
 * Agregador de datos derivados.
 *
 * Construye las hojas `concejales` y `bancadas` a partir de las hojas
 * detalle ya scrapeadas, joineando con sus maestros para obtener la fecha
 * y mapeando año -> periodo.
 *
 * Es idempotente: reescribe ambas hojas en cada corrida.
 */

const FUENTES_CONCEJALES = [
  {
    detalle: 'acuerdos_concejales',
    maestro: 'acuerdos_detalle',
    claveDetalle: 'numero',
    claveMaestro: 'no_acuerdo',
    campoFecha: 'fecha_sancion',
    campoAno: 'ano_sancion',
    campoNombre: 'concejal',
    campoRol: 'rol'
  },
  {
    detalle: 'proyectos_detalle',
    maestro: 'proyectos_maestro',
    claveDetalle: 'numero',
    claveMaestro: 'numero',
    campoFecha: 'fecha',
    campoNombre: 'concejal',
    campoRol: 'rol'
  }
];

// Roles que cuentan como concejal real. Match por substring sobre el rol
// normalizado (uppercase + sin tildes). 'PONENTE' captura tambien
// 'PROPONENTE'. Se excluye 'COORDINADOR' porque en SIMI se usa para
// funcionarios de la administracion, no para concejales.
const ROLES_CONCEJAL = ['PONENTE'];

const FUENTES_BANCADAS = [
  {
    detalle: 'citaciones_detalleBa',
    maestro: 'citaciones_maestro',
    claveDetalle: 'consecutivo',
    claveMaestro: 'consecutivo',
    campoFecha: 'fecha',
    campoNombre: 'bancadas'
  },
  {
    detalle: 'invitaciones_detalleBa',
    maestro: 'invitaciones_maestro',
    claveDetalle: 'consecutivo',
    claveMaestro: 'consecutivo',
    campoFecha: 'fecha',
    campoNombre: 'bancadas'
  }
];

const AgregadorDerivados = {
  actualizarConcejales() {
    const tuplas = this._extraerTuplas(FUENTES_CONCEJALES);
    return this._escribirHoja('concejales', 'concejal', tuplas);
  },

  actualizarBancadas() {
    const tuplas = this._extraerTuplas(FUENTES_BANCADAS);
    return this._escribirHoja('bancadas', 'bancada', tuplas);
  },

  actualizarTodo() {
    const inicio = new Date();
    const concejales = this.actualizarConcejales();
    const bancadas = this.actualizarBancadas();
    return {
      success: true,
      tipo: 'derivados',
      duracion: (new Date() - inicio) / 1000,
      concejales,
      bancadas
    };
  },

  _extraerTuplas(fuentes) {
    const set = new Map();
    let descartadasSinAno = 0;
    let descartadasFueraDeRango = 0;
    let descartadasPorRol = 0;

    for (const fuente of fuentes) {
      const detalle = SheetsUtils.obtener(fuente.detalle);
      if (!detalle || detalle.length === 0) {
        console.log(`⚠️ Hoja vacía o ausente: ${fuente.detalle}`);
        continue;
      }

      const maestroIndex = this._indexarMaestro(fuente.maestro, fuente.claveMaestro);

      for (const fila of detalle) {
        const clave = fila[fuente.claveDetalle];
        if (clave === undefined || clave === null || clave === '') continue;

        if (fuente.campoRol && !this._rolEsConcejal(fila[fuente.campoRol])) {
          descartadasPorRol++;
          continue;
        }

        const maestroFila = maestroIndex.get(String(clave).trim());
        const year = this._resolverAno(maestroFila, fuente);
        if (!year) { descartadasSinAno++; continue; }

        const periodo = getPeriodo(year);
        if (!periodo) { descartadasFueraDeRango++; continue; }

        const nombresRaw = this._extraerNombres(fila[fuente.campoNombre]);
        for (const raw of nombresRaw) {
          const nombre = ValidationUtils.normalizarNombre(raw);
          if (!nombre) continue;
          const key = `${nombre}|${year}`;
          if (!set.has(key)) {
            set.set(key, { nombre, year, periodo });
          }
        }
      }
    }

    console.log(`📊 Tuplas únicas: ${set.size} | sin año: ${descartadasSinAno} | fuera de rango: ${descartadasFueraDeRango} | por rol: ${descartadasPorRol}`);
    return Array.from(set.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return a.nombre.localeCompare(b.nombre);
    });
  },

  _indexarMaestro(nombreHoja, clave) {
    const filas = SheetsUtils.obtener(nombreHoja);
    const index = new Map();
    for (const fila of filas) {
      const k = fila[clave];
      if (k !== undefined && k !== null && k !== '') {
        index.set(String(k).trim(), fila);
      }
    }
    return index;
  },

  _rolEsConcejal(rol) {
    if (!rol) return false;
    const norm = ValidationUtils.normalizarNombre(rol);
    return ROLES_CONCEJAL.some(r => norm.includes(r));
  },

  _resolverAno(maestroFila, fuente) {
    if (!maestroFila) return null;
    if (fuente.campoAno && maestroFila[fuente.campoAno]) {
      const y = parseInt(maestroFila[fuente.campoAno]);
      if (!isNaN(y)) return y;
    }
    const fecha = maestroFila[fuente.campoFecha];
    if (!fecha) return null;
    if (fecha instanceof Date) return fecha.getFullYear();
    const d = new Date(fecha);
    return isNaN(d.getTime()) ? null : d.getFullYear();
  },

  _extraerNombres(valor) {
    if (valor === undefined || valor === null || valor === '') return [];
    if (Array.isArray(valor)) return valor;
    const s = String(valor);
    if (s.includes(',') || s.includes(';') || s.includes('|')) {
      return s.split(/[,;|]/);
    }
    return [s];
  },

  _escribirHoja(nombreHoja, columnaNombre, tuplas) {
    const spreadsheet = SpreadsheetApp.openById(GOOGLE_IDS.spreadsheetId);
    let sheet = spreadsheet.getSheetByName(nombreHoja);
    if (!sheet) sheet = spreadsheet.insertSheet(nombreHoja);

    sheet.clearContents();
    sheet.getRange(1, 1, 1, 3).setValues([[columnaNombre, 'ano', 'periodo']]);

    if (tuplas.length > 0) {
      const filas = tuplas.map(t => [t.nombre, t.year, t.periodo]);
      sheet.getRange(2, 1, filas.length, 3).setValues(filas);
    }

    console.log(`✅ ${nombreHoja}: ${tuplas.length} filas escritas`);
    return { hoja: nombreHoja, filas: tuplas.length };
  }
};

function actualizarDerivados() {
  return AgregadorDerivados.actualizarTodo();
}
