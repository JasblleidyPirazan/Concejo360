/**
 * Endpoint del dashboard de concejales.
 *
 * Devuelve un JSON pre-agregado que el frontend carga una vez y filtra
 * en memoria. Diseño híbrido: el backend hace los joins pesados
 * (acuerdos_concejales x acuerdos_detalle, proyectos_detalle x
 * proyectos_maestro) y devuelve solo conteos por (concejal, periodo).
 *
 * Solo cuenta filas cuyo rol sea PONENTE/PROPONENTE (mismo filtro que
 * usa AgregadorDerivados para la hoja `concejales`).
 *
 * Shape de la respuesta:
 * {
 *   periodos: ["2024-2027", ...],
 *   periodo_actual: "2024-2027",
 *   concejales_por_periodo: { "2024-2027": ["NOMBRE", ...] },
 *   kpis_concejal: { "NOMBRE|2024-2027": { acuerdos_ponente, proyectos_ponente, proyectos_por_estado } },
 *   kpis_periodo:  { "2024-2027": { citaciones, invitaciones, comisiones, acuerdos_total, proyectos_total } }
 * }
 */

const DashboardConcejales = {
  obtener() {
    const proyectos = SheetsUtils.obtener('proyectos_maestro');
    const proyectosDetalle = SheetsUtils.obtener('proyectos_detalle');
    const acuerdosDetalle = SheetsUtils.obtener('acuerdos_detalle');
    const acuerdosConcejales = SheetsUtils.obtener('acuerdos_concejales');
    const citaciones = SheetsUtils.obtener('citaciones_maestro');
    const invitaciones = SheetsUtils.obtener('invitaciones_maestro');
    const comisiones = SheetsUtils.obtener('comisiones_maestro');

    const proyectosIndex = this._indexar(proyectos, 'numero');
    const acuerdosIndex = this._indexar(acuerdosDetalle, 'no_acuerdo');

    const kpisConcejal = {};
    const concejalesPorPeriodo = {};

    this._procesarAcuerdos(acuerdosConcejales, acuerdosIndex, kpisConcejal, concejalesPorPeriodo);
    this._procesarProyectos(proyectosDetalle, proyectosIndex, kpisConcejal, concejalesPorPeriodo);

    const kpisPeriodo = this._calcularKpisPeriodo({
      proyectos,
      acuerdosDetalle,
      citaciones,
      invitaciones,
      comisiones
    });

    const periodos = PERIODOS.map(p => p.label);
    const conData = periodos.filter(p => concejalesPorPeriodo[p] && concejalesPorPeriodo[p].length > 0);
    const periodoActual = conData[0] || periodos[0];

    for (const p of periodos) {
      if (concejalesPorPeriodo[p]) {
        concejalesPorPeriodo[p] = Array.from(concejalesPorPeriodo[p]).sort();
      } else {
        concejalesPorPeriodo[p] = [];
      }
    }

    return {
      periodos,
      periodo_actual: periodoActual,
      concejales_por_periodo: concejalesPorPeriodo,
      kpis_concejal: kpisConcejal,
      kpis_periodo: kpisPeriodo,
      generado_en: new Date().toISOString()
    };
  },

  _procesarAcuerdos(detalle, acuerdosIndex, kpisConcejal, concejalesPorPeriodo) {
    for (const fila of detalle) {
      if (!this._esPonente(fila.rol)) continue;
      const nombre = ValidationUtils.normalizarNombre(fila.concejal);
      if (!nombre) continue;

      const maestro = acuerdosIndex.get(String(fila.numero || '').trim());
      const year = this._anoDesdeAcuerdo(maestro);
      const periodo = getPeriodo(year);
      if (!periodo) continue;

      this._registrarConcejalPeriodo(concejalesPorPeriodo, periodo, nombre);
      const key = `${nombre}|${periodo}`;
      const bucket = this._bucket(kpisConcejal, key);
      bucket.acuerdos_ponente++;
    }
  },

  _procesarProyectos(detalle, proyectosIndex, kpisConcejal, concejalesPorPeriodo) {
    for (const fila of detalle) {
      if (!this._esPonente(fila.rol)) continue;
      const nombre = ValidationUtils.normalizarNombre(fila.concejal);
      if (!nombre) continue;

      const maestro = proyectosIndex.get(String(fila.numero || '').trim());
      if (!maestro) continue;
      const year = this._anoDesdeFecha(maestro.fecha);
      const periodo = getPeriodo(year);
      if (!periodo) continue;

      this._registrarConcejalPeriodo(concejalesPorPeriodo, periodo, nombre);
      const key = `${nombre}|${periodo}`;
      const bucket = this._bucket(kpisConcejal, key);
      bucket.proyectos_ponente++;

      const estado = (maestro.estado || 'Sin estado').toString().trim() || 'Sin estado';
      bucket.proyectos_por_estado[estado] = (bucket.proyectos_por_estado[estado] || 0) + 1;
    }
  },

  _calcularKpisPeriodo({ proyectos, acuerdosDetalle, citaciones, invitaciones, comisiones }) {
    const out = {};
    for (const p of PERIODOS) out[p.label] = {
      acuerdos_total: 0, proyectos_total: 0,
      citaciones: 0, invitaciones: 0, comisiones: 0,
      proyectos_por_estado: {}
    };

    const sumar = (filas, campoFecha, key, campoAno) => {
      for (const fila of filas) {
        let year = null;
        if (campoAno && fila[campoAno]) {
          year = parseInt(fila[campoAno]);
          if (isNaN(year)) year = null;
        }
        if (!year) year = this._anoDesdeFecha(fila[campoFecha]);
        const periodo = getPeriodo(year);
        if (!periodo) continue;
        out[periodo][key]++;
      }
    };

    sumar(proyectos, 'fecha', 'proyectos_total');
    sumar(acuerdosDetalle, 'fecha_sancion', 'acuerdos_total', 'ano_sancion');
    sumar(citaciones, 'fecha', 'citaciones');
    sumar(invitaciones, 'fecha', 'invitaciones');
    sumar(comisiones, 'fecha_aprobacion', 'comisiones');

    for (const fila of proyectos) {
      const year = this._anoDesdeFecha(fila.fecha);
      const periodo = getPeriodo(year);
      if (!periodo) continue;
      const estado = (fila.estado || 'Sin estado').toString().trim() || 'Sin estado';
      out[periodo].proyectos_por_estado[estado] = (out[periodo].proyectos_por_estado[estado] || 0) + 1;
    }

    return out;
  },

  _bucket(kpis, key) {
    if (!kpis[key]) {
      kpis[key] = {
        acuerdos_ponente: 0,
        proyectos_ponente: 0,
        proyectos_por_estado: {}
      };
    }
    return kpis[key];
  },

  _registrarConcejalPeriodo(map, periodo, nombre) {
    if (!map[periodo]) map[periodo] = new Set();
    map[periodo].add(nombre);
  },

  _esPonente(rol) {
    if (!rol) return false;
    return ValidationUtils.normalizarNombre(rol).includes('PONENTE');
  },

  _indexar(filas, clave) {
    const m = new Map();
    for (const f of filas) {
      const k = f[clave];
      if (k !== undefined && k !== null && k !== '') {
        m.set(String(k).trim(), f);
      }
    }
    return m;
  },

  _anoDesdeFecha(fecha) {
    if (!fecha) return null;
    if (fecha instanceof Date) return fecha.getFullYear();
    const d = new Date(fecha);
    return isNaN(d.getTime()) ? null : d.getFullYear();
  },

  _anoDesdeAcuerdo(maestro) {
    if (!maestro) return null;
    if (maestro.ano_sancion) {
      const y = parseInt(maestro.ano_sancion);
      if (!isNaN(y)) return y;
    }
    return this._anoDesdeFecha(maestro.fecha_sancion);
  }
};

function obtenerResumenConcejales() {
  return DashboardConcejales.obtener();
}
