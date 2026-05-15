import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import MonthlyChart from './MonthlyChart.jsx';
import { porMes } from '../lib/stats.ts';

const KPI_TILES = [
  { key: 'proyectos_total', label: 'Proyectos', icon: '📋', accent: 'bg-blue-50 border-blue-200 text-blue-900' },
  { key: 'acuerdos_total', label: 'Acuerdos', icon: '⚖️', accent: 'bg-violet-50 border-violet-200 text-violet-900' },
  { key: 'comisiones', label: 'Comisiones', icon: '👥', accent: 'bg-emerald-50 border-emerald-200 text-emerald-900' },
  { key: 'citaciones', label: 'Citaciones', icon: '📣', accent: 'bg-amber-50 border-amber-200 text-amber-900' },
  { key: 'invitaciones', label: 'Invitaciones', icon: '✉️', accent: 'bg-rose-50 border-rose-200 text-rose-900' },
];

export default function GlobalDashboard() {
  const [resumen, setResumen] = useState({ loading: true, error: null, data: null });
  const [sesiones, setSesiones] = useState({ loading: true, error: null, rows: [], total: 0 });
  const [periodo, setPeriodo] = useState('');

  useEffect(() => {
    let cancelado = false;

    api.resumenConcejales().then((res) => {
      if (cancelado) return;
      if (!res.success) {
        setResumen({ loading: false, error: res.error, data: null });
        return;
      }
      setResumen({ loading: false, error: null, data: res.data });
      setPeriodo(res.data.periodo_actual || res.data.periodos[0]);
    });

    fetch('/.netlify/functions/api?action=data&tipo=sesiones&limit=10000', {
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((body) => {
        if (cancelado) return;
        if (!body || body.success !== true) {
          setSesiones({ loading: false, error: body?.error || 'Error', rows: [], total: 0 });
          return;
        }
        const rows = Array.isArray(body.data) ? body.data : [];
        setSesiones({
          loading: false,
          error: null,
          rows,
          total: body.pagination?.total ?? rows.length,
        });
      })
      .catch((err) => {
        if (cancelado) return;
        setSesiones({ loading: false, error: err?.message || 'Error de red', rows: [], total: 0 });
      });

    return () => {
      cancelado = true;
    };
  }, []);

  const datosPeriodo = useMemo(() => {
    if (!resumen.data || !periodo) return null;
    const concejales = resumen.data.concejales_por_periodo[periodo] || [];
    const kpis = resumen.data.kpis_periodo[periodo];
    const rankings = construirRankings(resumen.data.kpis_concejal, periodo, concejales);
    return { concejales, kpis, rankings };
  }, [resumen.data, periodo]);

  if (resumen.loading) {
    return <SkeletonGlobal />;
  }
  if (resumen.error) {
    return <ErrorBanner mensaje={resumen.error} />;
  }
  if (!resumen.data) {
    return <ErrorBanner mensaje="Sin datos disponibles" />;
  }

  return (
    <div className="space-y-8">
      <BarraFiltro
        periodos={resumen.data.periodos}
        periodo={periodo}
        setPeriodo={setPeriodo}
        totalConcejales={datosPeriodo?.concejales.length ?? 0}
        generadoEn={resumen.data.generado_en}
      />

      <KpiRow kpis={datosPeriodo?.kpis} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Ranking
          titulo="Top 10 ponentes de Proyectos"
          subtitulo="Concejales que más figuran como ponente o proponente"
          icon="📋"
          items={datosPeriodo?.rankings.proyectos ?? []}
        />
        <Ranking
          titulo="Top 10 ponentes de Acuerdos"
          subtitulo="Concejales con más acuerdos sancionados como ponente"
          icon="⚖️"
          items={datosPeriodo?.rankings.acuerdos ?? []}
        />
      </div>

      <ProyectosPorEstado
        data={datosPeriodo?.kpis?.proyectos_por_estado || {}}
        total={datosPeriodo?.kpis?.proyectos_total || 0}
      />

      <BloqueSesiones state={sesiones} />

      <CtaIndividual />
    </div>
  );
}

function construirRankings(kpisConcejal, periodo, concejales) {
  const filas = concejales.map((nombre) => {
    const k = kpisConcejal[`${nombre}|${periodo}`] || {};
    return {
      nombre,
      proyectos: k.proyectos_ponente || 0,
      acuerdos: k.acuerdos_ponente || 0,
    };
  });
  const top = (campo, n) =>
    [...filas]
      .filter((f) => f[campo] > 0)
      .sort((a, b) => b[campo] - a[campo])
      .slice(0, n);
  return {
    proyectos: top('proyectos', 10),
    acuerdos: top('acuerdos', 10),
  };
}

function BarraFiltro({ periodos, periodo, setPeriodo, totalConcejales, generadoEn }) {
  const fecha = generadoEn ? new Date(generadoEn) : null;
  const fechaTxt = fecha && !isNaN(fecha.getTime())
    ? fecha.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Periodo</span>
        <select
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {periodos.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6 text-xs text-slate-500">
        <span><strong className="text-slate-900 text-sm">{totalConcejales}</strong> concejales con actividad</span>
        <span>Datos al {fechaTxt}</span>
      </div>
    </div>
  );
}

function KpiRow({ kpis }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {KPI_TILES.map((tile) => {
        const valor = kpis?.[tile.key] ?? 0;
        return (
          <div key={tile.key} className={`rounded-xl border p-4 shadow-sm ${tile.accent}`}>
            <div className="flex items-center justify-between">
              <span className="text-2xl" aria-hidden="true">{tile.icon}</span>
            </div>
            <p className="mt-3 text-3xl font-bold tabular-nums">{valor.toLocaleString('es-CO')}</p>
            <p className="text-xs font-medium uppercase tracking-wide opacity-80 mt-1">{tile.label}</p>
          </div>
        );
      })}
    </div>
  );
}

function Ranking({ titulo, subtitulo, icon, items }) {
  const max = items.length ? Math.max(...items.map((i) => i.proyectos || i.acuerdos)) : 1;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <span aria-hidden="true">{icon}</span>
          {titulo}
        </h3>
      </div>
      <p className="text-xs text-slate-500 mb-4">{subtitulo}</p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 italic">Sin datos para el periodo seleccionado.</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item, idx) => {
            const valor = item.proyectos || item.acuerdos;
            const pct = (valor / max) * 100;
            return (
              <li key={item.nombre} className="flex items-center gap-3 text-sm">
                <span className="w-5 text-right text-xs font-semibold text-slate-400 tabular-nums">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1">
                    <a
                      href={`/concejales?nombre=${encodeURIComponent(item.nombre)}`}
                      className="truncate text-slate-800 hover:text-brand-700 hover:underline"
                    >
                      {item.nombre}
                    </a>
                    <span className="ml-2 text-xs font-semibold tabular-nums text-slate-900">{valor}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function ProyectosPorEstado({ data, total }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-slate-900">Proyectos del periodo por estado</h3>
      <p className="text-xs text-slate-500 mb-4">Total: {total.toLocaleString('es-CO')} proyectos</p>
      <div className="space-y-3">
        {entries.map(([estado, count]) => {
          const pct = total ? (count / total) * 100 : 0;
          return (
            <div key={estado}>
              <div className="flex justify-between text-sm">
                <span className="text-slate-700">{estado}</span>
                <span className="font-medium text-slate-900 tabular-nums">
                  {count.toLocaleString('es-CO')} · {pct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BloqueSesiones({ state }) {
  if (state.loading) {
    return <div className="h-64 rounded-xl border border-slate-200 bg-white p-5 shadow-sm animate-pulse" />;
  }
  if (state.error) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-slate-900 mb-1">Sesiones del Concejo</h3>
        <p className="text-sm text-rose-700">No se pudieron cargar las sesiones: {state.error}</p>
      </div>
    );
  }
  const mensual = porMes(state.rows, 12);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="font-semibold text-slate-900">Sesiones del Concejo</h3>
        <span className="text-xs text-slate-500">
          {state.total.toLocaleString('es-CO')} sesiones registradas
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Últimos 12 meses, segmentado por estado (no filtra por periodo).
      </p>
      <MonthlyChart data={mensual} />
    </div>
  );
}

function CtaIndividual() {
  return (
    <a
      href="/concejales"
      className="block rounded-xl border border-brand-200 bg-brand-50 p-6 shadow-sm hover:bg-brand-100 transition-colors"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-brand-900">Ver desempeño individual</h3>
          <p className="text-sm text-brand-800 mt-1">
            Analiza los indicadores de cada concejal: acuerdos y proyectos como ponente,
            distribución de estados y contexto del periodo.
          </p>
        </div>
        <span className="text-brand-700 text-xl" aria-hidden="true">→</span>
      </div>
    </a>
  );
}

function SkeletonGlobal() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-16 rounded-xl bg-slate-100" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-80 rounded-xl bg-slate-100" />
        <div className="h-80 rounded-xl bg-slate-100" />
      </div>
      <div className="h-48 rounded-xl bg-slate-100" />
    </div>
  );
}

function ErrorBanner({ mensaje }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <strong>Error cargando el dashboard:</strong> {mensaje}
    </div>
  );
}
