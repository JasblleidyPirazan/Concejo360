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
    maestro: 'acuerdos_maestro',
    claveDetalle: ['numero', 'acuerdo_numero', 'numero_acuerdo'],
    claveMaestro: 'numero',
    campoFecha: 'fecha_aprobacion',
    campoNombre: ['concejal', 'nombre', 'concejales']
  },
  {
    detalle: 'proyectos_detalle',
    maestro: 'proyectos_maestro',
    claveDetalle: ['numero', 'proyecto_numero', 'numero_proyecto'],
    claveMaestro: 'numero',
    campoFecha: 'fecha',
    campoNombre: ['proponente', 'concejal', 'nombre', 'proponentes']
  },
  {
    detalle: 'comisiones_detalle_integrantes',
    maestro: 'comisiones_maestro',
    claveDetalle: ['consecutivo', 'comision_consecutivo', 'numero'],
    claveMaestro: 'consecutivo',
    campoFecha: 'fecha_aprobacion',
    campoNombre: ['integrante', 'concejal', 'nombre']
  }
];

const FUENTES_BANCADAS = [
  {
    detalle: 'citaciones_detalleBa',
    maestro: 'citaciones_maestro',
    claveDetalle: ['consecutivo', 'citacion_consecutivo', 'numero'],
    claveMaestro: 'consecutivo',
    campoFecha: 'fecha',
    campoNombre: ['bancada', 'nombre']
  },
  {
    detalle: 'invitaciones_detalleBa',
    maestro: 'invitaciones_maestro',
    claveDetalle: ['consecutivo', 'invitacion_consecutivo', 'numero'],
    claveMaestro: 'consecutivo',
    campoFecha: 'fecha',
    campoNombre: ['bancada', 'nombre']
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
    let descartadasSinFecha = 0;
    let descartadasFueraDeRango = 0;

    for (const fuente of fuentes) {
      const detalle = SheetsUtils.obtener(fuente.detalle);
      if (!detalle || detalle.length === 0) {
        console.log(`⚠️ Hoja vacía o ausente: ${fuente.detalle}`);
        continue;
      }

      const maestroIndex = this._indexarMaestro(fuente.maestro, fuente.claveMaestro);

      for (const fila of detalle) {
        const clave = this._primerValor(fila, fuente.claveDetalle);
        if (!clave) continue;

        const maestroFila = maestroIndex.get(String(clave).trim());
        const fecha = maestroFila ? maestroFila[fuente.campoFecha] : null;
        if (!fecha) { descartadasSinFecha++; continue; }

        const year = this._extraerAno(fecha);
        const periodo = getPeriodo(year);
        if (!periodo) { descartadasFueraDeRango++; continue; }

        const nombresRaw = this._extraerNombres(fila, fuente.campoNombre);
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

    console.log(`📊 Tuplas únicas: ${set.size} | sin fecha: ${descartadasSinFecha} | fuera de rango: ${descartadasFueraDeRango}`);
    return Array.from(set.values());
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

  _primerValor(fila, candidatos) {
    for (const c of candidatos) {
      if (fila[c] !== undefined && fila[c] !== null && fila[c] !== '') return fila[c];
    }
    return null;
  },

  _extraerNombres(fila, candidatos) {
    const valor = this._primerValor(fila, candidatos);
    if (!valor) return [];
    if (Array.isArray(valor)) return valor;
    const s = String(valor);
    if (s.includes(',') || s.includes(';') || s.includes('|')) {
      return s.split(/[,;|]/);
    }
    return [s];
  },

  _extraerAno(fecha) {
    if (fecha instanceof Date) return fecha.getFullYear();
    const d = new Date(fecha);
    return isNaN(d.getTime()) ? null : d.getFullYear();
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
