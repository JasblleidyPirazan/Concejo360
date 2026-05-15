/**
 * Endpoint Panorama del Concejo (Hoja 1).
 *
 * Devuelve KPIs, deltas, series y agregados para la página de aterrizaje.
 * Parametros:
 *   periodo : label de PERIODOS (ej. "2024-2027"). Default = vigente segun fecha actual.
 *   anio    : opcional. Si se pasa, los KPIs se filtran a ese año y el delta compara con anio-1.
 *             Si no se pasa, el delta compara periodo vigente hasta hoy vs. periodo anterior
 *             en sus mismos N dias desde inicio ("mismo corte").
 *
 * Shape:
 * {
 *   periodo, anio, periodo_anterior, corte_dias,
 *   kpis:           { sesiones, proyectos_radicados, acuerdos_sancionados, tasa_conversion, citaciones, comisiones_accidentales },
 *   kpis_anterior:  { ...mismo shape... },
 *   deltas:         { sesiones, proyectos_radicados, acuerdos_sancionados, citaciones, comisiones_accidentales },  // % cambio
 *   sesiones_por_mes:    [{ mes: "2026-05", ordinarias, extraordinarias, total }],
 *   embudo:              [{ etapa, total }],   // 5 etapas
 *   heatmap_comision_mes:[{ comision, mes, total }],
 *   top_temas:           [{ tema, count }],    // top 10
 *   insight:             "Durante 2026 se realizaron X sesiones..."
 * }
 */

// EDITORIAL: mapeo de los 16 estados de SIMI a las 5 etapas del embudo.
// Match por substring case-insensitive. Orden importa (primero matchea, primero gana).
// El catch-all es "Radicado" porque un proyecto sin tramite avanzado nunca salio de radicacion.
const ETAPAS_EMBUDO = ['Radicado', 'Con ponentes', 'Primer debate', 'Segundo debate', 'Sancionado/Archivado'];
const MAPEO_ESTADO_ETAPA = [
  { etapa: 'Sancionado/Archivado', keywords: ['sancion', 'archiv', 'retir', 'hundi'] },
  { etapa: 'Segundo debate',       keywords: ['segundo debate', 'aprobado en segundo', 'aprobado segundo'] },
  { etapa: 'Primer debate',        keywords: ['primer debate', 'aprobado en primer', 'aprobado primer', 'ponencia presentada'] },
  { etapa: 'Con ponentes',         keywords: ['ponente', 'ponencia'] },
  // catch-all: cualquier otro estado (radicado, en estudio, sin estado, etc) cuenta como Radicado
];

// Stopwords minimas en español + dominio (lo evidente: concejo, proyecto, acuerdo...).
// MVP: si los resultados quedan ruidosos, ampliar esta lista.
const STOPWORDS_ES = new Set([
  'a','al','algo','algun','alguna','algunas','algunos','ante','antes','aqui','asi','aun','aunque',
  'cada','como','con','contra','cual','cuales','cuando','cuanto','de','del','desde','donde','dos',
  'el','ella','ellas','ellos','en','entre','era','eran','eras','eres','es','esa','esas','ese',
  'eso','esos','esta','estaba','estaban','estado','estados','estamos','estan','estar','estas',
  'este','esto','estos','estoy','etc','ex','fue','fueron','fui','fuimos','ha','habia','habian',
  'han','has','hasta','hay','haya','he','hemos','hizo','la','las','le','les','lo','los','mas',
  'me','mi','mis','mismo','mucho','muy','nada','ni','no','nos','nosotros','nuestra','nuestras',
  'nuestro','nuestros','o','os','otra','otras','otro','otros','para','pero','poco','por','porque',
  'que','quien','quienes','se','sea','sean','segun','ser','si','sido','siempre','sin','sobre',
  'sois','solo','somos','son','soy','su','sus','tal','tambien','tan','tanto','te','tenemos',
  'tener','tengo','ti','tiene','tienen','toda','todas','todo','todos','tras','tu','tus','un',
  'una','unas','uno','unos','usted','ustedes','va','vamos','van','vez','y','ya','yo',
  // dominio
  'concejo','medellin','medellín','proyecto','proyectos','acuerdo','acuerdos','citacion',
  'citacion','citaciones','comision','comisiones','sesion','sesiones','articulo','articulos',
  'concejal','concejales','bancada','bancadas','informe','informes','asunto','asuntos',
  'tema','temas','art','no','nro','num'
]);

const PanoramaConcejo = {
  obtener(params) {
    const todos = this._cargarDatos();
    const periodoSeleccionado = this._resolverPeriodo(params.periodo);
    const anio = params.anio ? parseInt(params.anio, 10) : null;
    const periodoAnterior = this._periodoAnterior(periodoSeleccionado);

    const ventanaActual = this._calcularVentana(periodoSeleccionado, anio, null);
    const ventanaAnterior = periodoAnterior
      ? this._calcularVentana(periodoAnterior, anio ? anio - 1 : null, ventanaActual.corte_dias)
      : null;

    const kpis = this._calcularKpis(todos, ventanaActual);
    const kpisAnterior = ventanaAnterior ? this._calcularKpis(todos, ventanaAnterior) : null;
    const deltas = this._calcularDeltas(kpis, kpisAnterior);

    const sesionesPorMes = this._sesionesPorMes(todos.sesiones, ventanaActual);
    const embudo = this._embudo(todos.proyectos, ventanaActual);
    const heatmap = this._heatmapComisionMes(todos.proyectos, ventanaActual);
    const topTemas = this._topTemas(todos, ventanaActual, 10);
    const insight = this._construirInsight({ ventanaActual, ventanaAnterior, kpis, kpisAnterior, heatmap });

    return {
      periodo: periodoSeleccionado.label,
      anio: anio,
      periodo_anterior: periodoAnterior ? periodoAnterior.label : null,
      corte_dias: ventanaActual.corte_dias,
      kpis,
      kpis_anterior: kpisAnterior,
      deltas,
      sesiones_por_mes: sesionesPorMes,
      embudo,
      heatmap_comision_mes: heatmap,
      top_temas: topTemas,
      insight,
      generado_en: new Date().toISOString()
    };
  },

  _cargarDatos() {
    return {
      sesiones: SheetsUtils.obtener('sesiones_maestro'),
      proyectos: SheetsUtils.obtener('proyectos_maestro'),
      acuerdos: SheetsUtils.obtener('acuerdos_detalle'),
      citaciones: SheetsUtils.obtener('citaciones_maestro'),
      comisiones: SheetsUtils.obtener('comisiones_maestro')
    };
  },

  _resolverPeriodo(label) {
    if (label) {
      const p = PERIODOS.find(x => x.label === label);
      if (p) return p;
    }
    const yearHoy = new Date().getFullYear();
    return PERIODOS.find(p => yearHoy >= p.desde && yearHoy <= p.hasta) || PERIODOS[0];
  },

  _periodoAnterior(periodo) {
    const idx = PERIODOS.findIndex(p => p.label === periodo.label);
    // PERIODOS esta ordenado del mas reciente al mas viejo
    return idx >= 0 && idx + 1 < PERIODOS.length ? PERIODOS[idx + 1] : null;
  },

  /**
   * Calcula la ventana temporal [desde, hasta] sobre la que se agregan los KPIs.
   * - Si hay anio: ventana = ese año entero (acotado al periodo).
   * - Si no, y el periodo es el vigente: ventana = inicio del periodo hasta hoy.
   * - Si no, y el periodo es pasado: ventana = periodo entero.
   * - Para el periodo anterior con corte_dias dado: ventana = inicio del periodo + corte_dias.
   */
  _calcularVentana(periodo, anio, corteAplicado) {
    const inicioPeriodo = new Date(periodo.desde, 0, 1);
    const finPeriodo = new Date(periodo.hasta, 11, 31, 23, 59, 59);
    const hoy = new Date();

    if (anio) {
      const desde = new Date(Math.max(inicioPeriodo.getTime(), new Date(anio, 0, 1).getTime()));
      const hasta = new Date(Math.min(finPeriodo.getTime(), new Date(anio, 11, 31, 23, 59, 59).getTime()));
      return { periodo, anio, desde, hasta, corte_dias: this._diffDias(desde, hasta) };
    }

    if (corteAplicado != null) {
      const hasta = new Date(inicioPeriodo.getTime() + corteAplicado * 86400000);
      const hastaAcotado = hasta.getTime() < finPeriodo.getTime() ? hasta : finPeriodo;
      return { periodo, anio: null, desde: inicioPeriodo, hasta: hastaAcotado, corte_dias: corteAplicado };
    }

    if (hoy >= inicioPeriodo && hoy <= finPeriodo) {
      return { periodo, anio: null, desde: inicioPeriodo, hasta: hoy, corte_dias: this._diffDias(inicioPeriodo, hoy) };
    }

    return { periodo, anio: null, desde: inicioPeriodo, hasta: finPeriodo, corte_dias: this._diffDias(inicioPeriodo, finPeriodo) };
  },

  _diffDias(a, b) {
    return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
  },

  _enVentana(fecha, ventana) {
    if (!fecha) return false;
    const f = fecha instanceof Date ? fecha : new Date(fecha);
    if (isNaN(f.getTime())) return false;
    return f.getTime() >= ventana.desde.getTime() && f.getTime() <= ventana.hasta.getTime();
  },

  _calcularKpis(todos, ventana) {
    const sesionesRealizadas = todos.sesiones.filter(s =>
      this._enVentana(s.fecha, ventana) && String(s.estado || '').trim().toLowerCase() === 'realizada'
    ).length;

    const proyectosRadicados = todos.proyectos.filter(p => this._enVentana(p.fecha, ventana)).length;

    const acuerdosSancionados = todos.acuerdos.filter(a => {
      const fecha = this._fechaAcuerdo(a);
      return this._enVentana(fecha, ventana);
    }).length;

    const citaciones = todos.citaciones.filter(c => this._enVentana(c.fecha, ventana)).length;
    const comisionesAccidentales = todos.comisiones.filter(c => this._enVentana(c.fecha, ventana)).length;

    return {
      sesiones: sesionesRealizadas,
      proyectos_radicados: proyectosRadicados,
      acuerdos_sancionados: acuerdosSancionados,
      tasa_conversion: proyectosRadicados > 0
        ? Math.round((acuerdosSancionados / proyectosRadicados) * 1000) / 10  // 1 decimal
        : 0,
      citaciones,
      comisiones_accidentales: comisionesAccidentales
    };
  },

  _fechaAcuerdo(acuerdo) {
    if (acuerdo.fecha_sancion) return acuerdo.fecha_sancion;
    if (acuerdo.ano_sancion) {
      const y = parseInt(acuerdo.ano_sancion, 10);
      // Falsa fecha mid-year solo para que caiga en el periodo correcto si no hay fecha exacta
      if (!isNaN(y)) return new Date(y, 6, 1);
    }
    return null;
  },

  _calcularDeltas(actual, anterior) {
    if (!anterior) return null;
    const pct = (a, b) => {
      if (!b) return a > 0 ? 100 : 0;
      return Math.round(((a - b) / b) * 1000) / 10;
    };
    return {
      sesiones: pct(actual.sesiones, anterior.sesiones),
      proyectos_radicados: pct(actual.proyectos_radicados, anterior.proyectos_radicados),
      acuerdos_sancionados: pct(actual.acuerdos_sancionados, anterior.acuerdos_sancionados),
      citaciones: pct(actual.citaciones, anterior.citaciones),
      comisiones_accidentales: pct(actual.comisiones_accidentales, anterior.comisiones_accidentales)
    };
  },

  _sesionesPorMes(sesiones, ventana) {
    const buckets = {};
    for (const s of sesiones) {
      if (!this._enVentana(s.fecha, ventana)) continue;
      if (String(s.estado || '').trim().toLowerCase() !== 'realizada') continue;
      const f = s.fecha instanceof Date ? s.fecha : new Date(s.fecha);
      const mes = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
      if (!buckets[mes]) buckets[mes] = { mes, ordinarias: 0, extraordinarias: 0, total: 0 };
      // Heuristica: la palabra "extraordinari" puede aparecer en detalle o temas
      const blob = `${s.detalle || ''} ${s.temas || ''}`.toLowerCase();
      if (/extraordinari/.test(blob)) buckets[mes].extraordinarias++;
      else buckets[mes].ordinarias++;
      buckets[mes].total++;
    }
    return Object.values(buckets).sort((a, b) => a.mes.localeCompare(b.mes));
  },

  _embudo(proyectos, ventana) {
    const conteo = {};
    for (const e of ETAPAS_EMBUDO) conteo[e] = 0;

    for (const p of proyectos) {
      if (!this._enVentana(p.fecha, ventana)) continue;
      const etapa = this._estadoAEtapa(p.estado);
      conteo[etapa]++;
    }

    return ETAPAS_EMBUDO.map(etapa => ({ etapa, total: conteo[etapa] }));
  },

  _estadoAEtapa(estado) {
    const s = String(estado || '').toLowerCase();
    for (const regla of MAPEO_ESTADO_ETAPA) {
      for (const kw of regla.keywords) {
        if (s.indexOf(kw) !== -1) return regla.etapa;
      }
    }
    return 'Radicado';
  },

  _heatmapComisionMes(proyectos, ventana) {
    const buckets = {};
    for (const p of proyectos) {
      if (!this._enVentana(p.fecha, ventana)) continue;
      const f = p.fecha instanceof Date ? p.fecha : new Date(p.fecha);
      if (isNaN(f.getTime())) continue;
      const mes = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
      const comision = String(p.comision || 'Sin comisión').trim() || 'Sin comisión';
      const key = `${comision}||${mes}`;
      if (!buckets[key]) buckets[key] = { comision, mes, total: 0 };
      buckets[key].total++;
    }
    return Object.values(buckets).sort((a, b) =>
      a.comision === b.comision ? a.mes.localeCompare(b.mes) : a.comision.localeCompare(b.comision)
    );
  },

  _topTemas(todos, ventana, n) {
    const conteo = {};
    const tokenizar = (texto) => {
      if (!texto) return;
      const tokens = String(texto)
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')  // quitar tildes
        .replace(/[^a-z0-9ñ\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 4 && !STOPWORDS_ES.has(t));
      for (const t of tokens) conteo[t] = (conteo[t] || 0) + 1;
    };

    for (const c of todos.citaciones) {
      if (!this._enVentana(c.fecha, ventana)) continue;
      tokenizar(c.descripcion);
      tokenizar(c.titulo);
    }
    for (const c of todos.comisiones) {
      if (!this._enVentana(c.fecha, ventana)) continue;
      tokenizar(c.titulo);
    }

    return Object.keys(conteo)
      .map(tema => ({ tema, count: conteo[tema] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  },

  _construirInsight({ ventanaActual, ventanaAnterior, kpis, kpisAnterior, heatmap }) {
    const partes = [];
    const periodoTxt = ventanaActual.anio
      ? `Durante ${ventanaActual.anio}`
      : `En el periodo ${ventanaActual.periodo.label} hasta la fecha`;
    partes.push(`${periodoTxt} se realizaron ${kpis.sesiones} sesiones`);

    if (kpisAnterior && kpisAnterior.sesiones > 0) {
      const diff = kpis.sesiones - kpisAnterior.sesiones;
      const pct = Math.round(Math.abs(diff / kpisAnterior.sesiones) * 100);
      const dir = diff >= 0 ? 'más' : 'menos';
      const refTxt = ventanaActual.anio
        ? `que en ${ventanaActual.anio - 1}`
        : `que en el mismo corte del periodo ${ventanaAnterior.periodo.label}`;
      partes.push(`(${pct}% ${dir} ${refTxt})`);
    }

    const top = this._comisionDominante(heatmap);
    if (top.total > 0) {
      partes.push(`. La ${top.comision} concentró el ${top.pct}% de la producción legislativa`);
    }

    return partes.join(' ') + '.';
  },

  _comisionDominante(heatmap) {
    const totales = {};
    let grandTotal = 0;
    for (const fila of heatmap) {
      totales[fila.comision] = (totales[fila.comision] || 0) + fila.total;
      grandTotal += fila.total;
    }
    let max = { comision: '', total: 0 };
    for (const c of Object.keys(totales)) {
      if (totales[c] > max.total) max = { comision: c, total: totales[c] };
    }
    return { ...max, pct: grandTotal > 0 ? Math.round((max.total / grandTotal) * 100) : 0 };
  }
};

function obtenerPanoramaConcejo(params) {
  return PanoramaConcejo.obtener(params || {});
}
