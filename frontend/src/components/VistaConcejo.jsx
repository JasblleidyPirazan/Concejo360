import { useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { api } from '../lib/api';
import { formatMes } from '../lib/stats.ts';
import { descargarCsv } from '../lib/csv.ts';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// Espejo de PERIODOS en backend/apps-script/utils/constants.js
const PERIODOS = [
  { label: '2024-2027', desde: 2024, hasta: 2027 },
  { label: '2020-2023', desde: 2020, hasta: 2023 },
  { label: '2016-2019', desde: 2016, hasta: 2019 },
  { label: '2012-2015', desde: 2012, hasta: 2015 },
  { label: '2008-2011', desde: 2008, hasta: 2011 },
];

const KPI_DEFS = [
  {
    key: 'sesiones',
    label: 'Sesiones realizadas',
    icon: '🏛️',
    ayuda: 'Plenarias y debates con estado "Realizada" en la ventana seleccionada.',
  },
  {
    key: 'proyectos_radicados',
    label: 'Proyectos radicados',
    icon: '📋',
    ayuda: 'Proyectos de acuerdo presentados ante el Concejo, sin importar su estado actual.',
  },
  {
    key: 'acuerdos_sancionados',
    label: 'Acuerdos sancionados',
    icon: '⚖️',
    ayuda: 'Proyectos que completaron el trámite y fueron sancionados como acuerdo municipal.',
  },
  {
    key: 'tasa_conversion',
    label: 'Tasa de conversión',
    icon: '🎯',
    sufijo: '%',
    sinDelta: true,
    ayuda: 'Acuerdos sancionados ÷ proyectos radicados. Qué porcentaje de lo radicado llega a ser norma.',
  },
  {
    key: 'citaciones',
    label: 'Citaciones a control',
    icon: '📣',
    ayuda: 'Debates de control político citados por las bancadas a la administración.',
  },
  {
    key: 'comisiones_accidentales',
    label: 'Comisiones accidentales',
    icon: '👥',
    ayuda: 'Comisiones temporales conformadas para estudiar un asunto específico.',
  },
];

const AYUDA_ETAPAS = {
  Radicado: 'Proyecto presentado, aún sin trámite avanzado.',
  'Con ponentes': 'La mesa directiva ya designó concejales ponentes para estudiarlo.',
  'Primer debate': 'En estudio o aprobado en primer debate (comisión).',
  'Segundo debate': 'En estudio o aprobado en segundo debate (plenaria).',
  'Sancionado/Archivado': 'Terminó su trámite: se convirtió en acuerdo o fue archivado/retirado.',
};

export default function VistaConcejo() {
  const [periodo, setPeriodo] = useState(PERIODOS[0].label);
  const [anio, setAnio] = useState(null);
  const [panorama, setPanorama] = useState({ cargando: true, error: null, data: null });
  const [resumen, setResumen] = useState(null);

  useEffect(() => {
    let cancelado = false;
    setPanorama((prev) => ({ ...prev, cargando: true, error: null }));
    api.panoramaConcejo(periodo, anio ?? undefined).then((res) => {
      if (cancelado) return;
      if (!res.success) {
        setPanorama((prev) => ({ ...prev, cargando: false, error: res.error }));
        return;
      }
      setPanorama({ cargando: false, error: null, data: res.data });
    });
    return () => {
      cancelado = true;
    };
  }, [periodo, anio]);

  useEffect(() => {
    let cancelado = false;
    api.resumenConcejales().then((res) => {
      if (!cancelado && res.success) setResumen(res.data);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  const rankings = useMemo(() => {
    if (!resumen) return null;
    const concejales = resumen.concejales_por_periodo[periodo] || [];
    return construirRankings(resumen.kpis_concejal, periodo, concejales);
  }, [resumen, periodo]);

  if (panorama.cargando && !panorama.data) return <SkeletonVista />;
  if (panorama.error && !panorama.data) return <ErrorBanner mensaje={panorama.error} />;

  const data = panorama.data;

  return (
    <div className="space-y-8">
      <BarraFiltros
        periodo={periodo}
        anio={anio}
        onPeriodo={(p) => {
          setPeriodo(p);
          setAnio(null);
        }}
        onAnio={setAnio}
        generadoEn={data.generado_en}
      />

      <div className={`space-y-8 transition-opacity ${panorama.cargando ? 'opacity-50 pointer-events-none' : ''}`}>
        {panorama.error && <ErrorBanner mensaje={panorama.error} />}

        <KpiDeltaRow data={data} />

        {data.insight && <InsightBox texto={data.insight} />}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SesionesPorMes data={data} />
          <Embudo data={data} />
        </div>

        <HeatmapComisionMes data={data} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <TopTemas data={data} />
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
            <RankingPonentes
              titulo="Top 10 ponentes de proyectos"
              subtitulo="Todo el periodo (no aplica filtro de año)"
              campo="proyectos"
              items={rankings?.proyectos}
            />
            <RankingPonentes
              titulo="Top 10 ponentes de acuerdos"
              subtitulo="Todo el periodo (no aplica filtro de año)"
              campo="acuerdos"
              items={rankings?.acuerdos}
            />
          </div>
        </div>

        <CtaConcejal />
      </div>
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
  const top = (campo) =>
    [...filas]
      .filter((f) => f[campo] > 0)
      .sort((a, b) => b[campo] - a[campo])
      .slice(0, 10);
  return { proyectos: top('proyectos'), acuerdos: top('acuerdos') };
}

function BarraFiltros({ periodo, anio, onPeriodo, onAnio, generadoEn }) {
  const def = PERIODOS.find((p) => p.label === periodo) || PERIODOS[0];
  const anioActual = new Date().getFullYear();
  const anios = [];
  for (let y = def.desde; y <= Math.min(def.hasta, anioActual); y++) anios.push(y);

  const fecha = generadoEn ? new Date(generadoEn) : null;
  const fechaTxt = fecha && !isNaN(fecha.getTime())
    ? fecha.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <label className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Periodo</span>
          <select
            value={periodo}
            onChange={(e) => onPeriodo(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {PERIODOS.map((p) => (
              <option key={p.label} value={p.label}>{p.label}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Año</span>
          <PillAnio activo={anio === null} onClick={() => onAnio(null)}>Todo el periodo</PillAnio>
          {anios.map((y) => (
            <PillAnio key={y} activo={anio === y} onClick={() => onAnio(y)}>{y}</PillAnio>
          ))}
        </div>
      </div>
      <span className="text-xs text-slate-500">Datos al {fechaTxt}</span>
    </div>
  );
}

function PillAnio({ activo, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        activo
          ? 'bg-brand-600 text-white shadow-sm'
          : 'bg-slate-100 text-slate-600 hover:bg-brand-100 hover:text-brand-800'
      }`}
    >
      {children}
    </button>
  );
}

function KpiDeltaRow({ data }) {
  const refTxt = data.anio
    ? `vs. ${data.anio - 1}`
    : data.periodo_anterior
      ? `vs. mismo corte ${data.periodo_anterior}`
      : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {KPI_DEFS.map((def) => {
        const valor = data.kpis?.[def.key] ?? 0;
        const delta = !def.sinDelta && data.deltas ? data.deltas[def.key] : null;
        const anterior = data.kpis_anterior?.[def.key];
        return (
          <div key={def.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-2xl" aria-hidden="true">{def.icon}</span>
              {delta != null && <DeltaBadge delta={delta} />}
            </div>
            <p className="mt-3 text-3xl font-bold tabular-nums text-slate-900">
              {valor.toLocaleString('es-CO')}
              {def.sufijo || ''}
            </p>
            <p className="mt-1 text-xs font-medium text-slate-600">
              <Glosario texto={def.label} ayuda={def.ayuda} />
            </p>
            {refTxt && (
              <p className="mt-1 text-[10px] text-slate-400">
                {refTxt}
                {def.sinDelta && anterior != null ? `: ${anterior}${def.sufijo || ''}` : ''}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DeltaBadge({ delta }) {
  const positivo = delta >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
        positivo ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
      }`}
    >
      {positivo ? '▲' : '▼'} {Math.abs(delta).toLocaleString('es-CO')}%
    </span>
  );
}

function Glosario({ texto, ayuda }) {
  return (
    <span title={ayuda} className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-2">
      {texto}
    </span>
  );
}

function InsightBox({ texto }) {
  return (
    <div className="rounded-xl border border-accent-600/30 bg-accent-400/15 p-4 flex items-start gap-3">
      <span className="text-xl" aria-hidden="true">💡</span>
      <p className="text-sm text-slate-800">{texto}</p>
    </div>
  );
}

function CardHeader({ titulo, subtitulo, csv }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{titulo}</h3>
        {csv && (
          <button
            type="button"
            onClick={() => descargarCsv(csv.nombre, csv.filas)}
            className="shrink-0 text-[11px] font-medium text-brand-700 hover:text-brand-900 hover:underline"
          >
            ⬇ CSV
          </button>
        )}
      </div>
      {subtitulo && <p className="text-xs text-slate-500 mt-0.5">{subtitulo}</p>}
    </div>
  );
}

function SesionesPorMes({ data }) {
  const serie = data.sesiones_por_mes || [];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <CardHeader
        titulo="Sesiones por mes"
        subtitulo="Sesiones realizadas: ordinarias vs. extraordinarias. Los picos suelen coincidir con presupuesto o coyunturas."
        csv={{ nombre: `sesiones-por-mes-${data.periodo}`, filas: serie }}
      />
      {serie.length === 0 ? (
        <SinDatos />
      ) : (
        <ChartSesiones serie={serie} />
      )}
    </div>
  );
}

function ChartSesiones({ serie }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-72" />;

  const chartData = {
    labels: serie.map((d) => formatMes(d.mes)),
    datasets: [
      { label: 'Ordinarias', data: serie.map((d) => d.ordinarias), backgroundColor: '#7010a6' },
      { label: 'Extraordinarias', data: serie.map((d) => d.extraordinarias), backgroundColor: '#fcd700' },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12 } },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { stacked: true, grid: { display: false } },
      y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
    },
  };
  return (
    <div className="h-72">
      <Bar data={chartData} options={options} />
    </div>
  );
}

function Embudo({ data }) {
  const etapas = data.embudo || [];
  const total = etapas.reduce((acc, e) => acc + e.total, 0);
  const max = Math.max(1, ...etapas.map((e) => e.total));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <CardHeader
        titulo="Embudo de proyectos de acuerdo"
        subtitulo={`En qué etapa del trámite está cada proyecto radicado (${total.toLocaleString('es-CO')} en total). Revela dónde se atascan.`}
        csv={{ nombre: `embudo-proyectos-${data.periodo}`, filas: etapas }}
      />
      {total === 0 ? (
        <SinDatos />
      ) : (
        <div className="space-y-3 py-2">
          {etapas.map((e, idx) => {
            const pct = total ? (e.total / total) * 100 : 0;
            const ancho = Math.max(8, (e.total / max) * 100);
            return (
              <div key={e.etapa} title={AYUDA_ETAPAS[e.etapa] || e.etapa}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-700">
                    <Glosario texto={e.etapa} ayuda={AYUDA_ETAPAS[e.etapa] || ''} />
                  </span>
                  <span className="font-medium tabular-nums text-slate-900">
                    {e.total.toLocaleString('es-CO')} · {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-center">
                  <div
                    className="h-7 rounded-md bg-gradient-to-r from-brand-500 to-brand-700 transition-all duration-500"
                    style={{ width: `${ancho}%`, opacity: 0.55 + 0.45 * (idx / Math.max(1, etapas.length - 1)) }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HeatmapComisionMes({ data }) {
  const celdas = data.heatmap_comision_mes || [];
  const { comisiones, meses, valores, max } = useMemo(() => {
    const porComision = {};
    const mesesSet = new Set();
    let maxVal = 0;
    for (const c of celdas) {
      mesesSet.add(c.mes);
      if (!porComision[c.comision]) porComision[c.comision] = { total: 0, celdas: {} };
      porComision[c.comision].celdas[c.mes] = c.total;
      porComision[c.comision].total += c.total;
      if (c.total > maxVal) maxVal = c.total;
    }
    return {
      comisiones: Object.entries(porComision)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([nombre, v]) => ({ nombre, ...v })),
      meses: [...mesesSet].sort(),
      valores: porComision,
      max: Math.max(1, maxVal),
    };
  }, [celdas]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <CardHeader
        titulo="Producción legislativa: comisión × mes"
        subtitulo="Cuántos proyectos radicados estudia cada comisión por mes. Más oscuro = más proyectos."
        csv={{ nombre: `heatmap-comision-mes-${data.periodo}`, filas: celdas }}
      />
      {celdas.length === 0 ? (
        <SinDatos />
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-separate" style={{ borderSpacing: 2 }}>
            <thead>
              <tr>
                <th className="sticky left-0 bg-white pr-2 text-left font-medium text-slate-500">Comisión</th>
                {meses.map((m) => (
                  <th key={m} className="px-1 pb-1 font-normal text-slate-400 whitespace-nowrap">{formatMes(m)}</th>
                ))}
                <th className="pl-2 text-right font-medium text-slate-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {comisiones.map((c) => (
                <tr key={c.nombre}>
                  <td className="sticky left-0 bg-white pr-2 py-0.5 font-medium text-slate-700 whitespace-nowrap max-w-[14rem] truncate" title={c.nombre}>
                    {c.nombre}
                  </td>
                  {meses.map((m) => {
                    const v = c.celdas[m] || 0;
                    const alpha = v === 0 ? 0.04 : 0.15 + 0.85 * (v / max);
                    return (
                      <td
                        key={m}
                        title={`${c.nombre} · ${formatMes(m)}: ${v} proyecto${v === 1 ? '' : 's'}`}
                        className="h-7 w-9 min-w-[2.25rem] rounded text-center tabular-nums align-middle"
                        style={{
                          backgroundColor: `rgba(112, 16, 166, ${alpha})`,
                          color: alpha > 0.55 ? '#fff' : '#475569',
                        }}
                      >
                        {v || ''}
                      </td>
                    );
                  })}
                  <td className="pl-2 text-right font-semibold tabular-nums text-slate-900">{c.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TopTemas({ data }) {
  const temas = data.top_temas || [];
  const max = Math.max(1, ...temas.map((t) => t.count));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <CardHeader
        titulo="Temas más debatidos"
        subtitulo="Palabras más frecuentes en citaciones y comisiones del periodo filtrado."
        csv={{ nombre: `top-temas-${data.periodo}`, filas: temas }}
      />
      {temas.length === 0 ? (
        <SinDatos />
      ) : (
        <ol className="space-y-2">
          {temas.map((t, idx) => (
            <li key={t.tema} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-right text-xs font-semibold text-slate-400 tabular-nums">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <a
                    href={`/buscador?q=${encodeURIComponent(t.tema)}`}
                    className="capitalize text-slate-800 hover:text-brand-700 hover:underline"
                    title={`Buscar "${t.tema}" en todos los datos`}
                  >
                    {t.tema}
                  </a>
                  <span className="ml-2 text-xs font-semibold tabular-nums text-slate-900">{t.count}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-accent-500" style={{ width: `${(t.count / max) * 100}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RankingPonentes({ titulo, subtitulo, campo, items }) {
  const filas = items || [];
  const max = Math.max(1, ...filas.map((i) => i[campo]));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <CardHeader titulo={titulo} subtitulo={subtitulo} />
      {filas.length === 0 ? (
        <SinDatos />
      ) : (
        <ol className="space-y-2">
          {filas.map((item, idx) => (
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
                  <span className="ml-2 text-xs font-semibold tabular-nums text-slate-900">{item[campo]}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-brand-500" style={{ width: `${(item[campo] / max) * 100}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function CtaConcejal() {
  return (
    <a
      href="/concejales"
      className="block rounded-xl border border-brand-200 bg-brand-50 p-6 shadow-sm hover:bg-brand-100 transition-colors"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-brand-900">Ver desempeño individual</h3>
          <p className="text-sm text-brand-800 mt-1">
            Busca a tu concejal y revisa sus acuerdos y proyectos como ponente, con el contexto del periodo.
          </p>
        </div>
        <span className="text-brand-700 text-xl" aria-hidden="true">→</span>
      </div>
    </a>
  );
}

function SinDatos() {
  return <p className="text-sm text-slate-500 italic">Sin datos para el filtro seleccionado.</p>;
}

function SkeletonVista() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-16 rounded-xl bg-slate-100" />
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-slate-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-96 rounded-xl bg-slate-100" />
        <div className="h-96 rounded-xl bg-slate-100" />
      </div>
      <div className="h-64 rounded-xl bg-slate-100" />
    </div>
  );
}

function ErrorBanner({ mensaje }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <strong>Error cargando el panorama:</strong> {mensaje}
    </div>
  );
}
