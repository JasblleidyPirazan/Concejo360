import { useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Scatter, Radar } from 'react-chartjs-2';
import { api } from '../lib/api';
import { descargarCsv } from '../lib/csv.ts';

ChartJS.register(
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

const MAX_COMPARAR = 3;
const COLORES_SEL = ['#7010a6', '#14b8a6', '#f59e0b'];

const COLUMNAS = [
  { key: 'proyectos', label: 'Proyectos', ayuda: 'Proyectos de acuerdo donde figura como ponente' },
  { key: 'acuerdos', label: 'Acuerdos', ayuda: 'Acuerdos sancionados donde figura como ponente' },
  { key: 'sancionados', label: 'Sancionados', ayuda: 'Sus proyectos que llegaron a acuerdo' },
  { key: 'archivados', label: 'Archivados', ayuda: 'Sus proyectos archivados o retirados' },
  { key: 'efectividad', label: 'Efectividad', ayuda: '% de sus proyectos que terminó sancionado', sufijo: '%' },
];

const EJES_RADAR = ['proyectos', 'acuerdos', 'sancionados', 'efectividad'];
const EJES_RADAR_LABEL = { proyectos: 'Proyectos', acuerdos: 'Acuerdos', sancionados: 'Sancionados', efectividad: 'Efectividad' };

const normalizar = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

function metricasDe(kpi) {
  const proyectos = kpi ? kpi.proyectos_ponente || 0 : 0;
  const acuerdos = kpi ? kpi.acuerdos_ponente || 0 : 0;
  const estados = (kpi && kpi.proyectos_por_estado) || {};
  let sancionados = 0;
  let archivados = 0;
  for (const [k, v] of Object.entries(estados)) {
    const s = normalizar(k);
    if (s.includes('sancion')) sancionados += v;
    else if (s.includes('archiv') || s.includes('retir') || s.includes('hundi')) archivados += v;
  }
  const efectividad = proyectos > 0 ? Math.round((sancionados / proyectos) * 1000) / 10 : 0;
  return { proyectos, acuerdos, sancionados, archivados, efectividad };
}

function mediana(nums) {
  if (!nums.length) return 0;
  const ord = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(ord.length / 2);
  return ord.length % 2 ? ord[mid] : (ord[mid - 1] + ord[mid]) / 2;
}

// Cruz de medianas dibujada sobre el scatter para separar los cuatro cuadrantes.
const pluginMedianas = {
  id: 'medianas',
  afterDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart;
    if (!opts || opts.x == null || opts.y == null) return;
    const px = scales.x.getPixelForValue(opts.x);
    const py = scales.y.getPixelForValue(opts.y);
    ctx.save();
    ctx.strokeStyle = '#cbd5e1';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, chartArea.top);
    ctx.lineTo(px, chartArea.bottom);
    ctx.moveTo(chartArea.left, py);
    ctx.lineTo(chartArea.right, py);
    ctx.stroke();
    ctx.restore();
  },
};

export default function ComparativoConcejales() {
  const [estado, setEstado] = useState({ cargando: true, error: null, data: null });
  const [periodo, setPeriodo] = useState('');
  const [orden, setOrden] = useState({ col: 'proyectos', dir: 'desc' });
  const [seleccionados, setSeleccionados] = useState([]);
  const [filtroTexto, setFiltroTexto] = useState('');

  useEffect(() => {
    let cancelado = false;
    api.resumenConcejales().then((res) => {
      if (cancelado) return;
      if (!res.success) {
        setEstado({ cargando: false, error: res.error, data: null });
        return;
      }
      setPeriodo(res.data.periodo_actual || res.data.periodos[0]);
      setEstado({ cargando: false, error: null, data: res.data });
    });
    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => setSeleccionados([]), [periodo]);

  const filas = useMemo(() => {
    if (!estado.data || !periodo) return [];
    const nombres = estado.data.concejales_por_periodo[periodo] || [];
    return nombres.map((nombre) => {
      const kpi = estado.data.kpis_concejal[`${nombre}|${periodo}`];
      return { nombre, ...metricasDe(kpi) };
    });
  }, [estado.data, periodo]);

  const filasFiltradas = useMemo(() => {
    const txt = normalizar(filtroTexto);
    const base = txt ? filas.filter((f) => normalizar(f.nombre).includes(txt)) : filas;
    return [...base].sort((a, b) => {
      const diff = (b[orden.col] || 0) - (a[orden.col] || 0);
      const signo = orden.dir === 'desc' ? 1 : -1;
      return diff !== 0 ? diff * signo : a.nombre.localeCompare(b.nombre);
    });
  }, [filas, filtroTexto, orden]);

  const medianas = useMemo(() => {
    return {
      proyectos: mediana(filas.map((f) => f.proyectos)),
      efectividad: mediana(filas.map((f) => f.efectividad)),
    };
  }, [filas]);

  const maximos = useMemo(() => {
    const m = {};
    for (const eje of EJES_RADAR) m[eje] = Math.max(1, ...filas.map((f) => f[eje] || 0));
    return m;
  }, [filas]);

  const toggleSeleccion = (nombre) => {
    setSeleccionados((prev) => {
      if (prev.includes(nombre)) return prev.filter((n) => n !== nombre);
      if (prev.length >= MAX_COMPARAR) return prev;
      return [...prev, nombre];
    });
  };

  if (estado.cargando) return <Skeleton />;
  if (estado.error) return <ErrorBanner mensaje={estado.error} />;
  if (!estado.data) return <ErrorBanner mensaje="Sin datos disponibles" />;

  const filasSeleccionadas = filas.filter((f) => seleccionados.includes(f.nombre));

  return (
    <div className="space-y-8">
      <AdvertenciaContexto />

      <Controles
        periodos={estado.data.periodos}
        periodo={periodo}
        onPeriodo={setPeriodo}
        filtroTexto={filtroTexto}
        onTexto={setFiltroTexto}
        totalConcejales={filas.length}
        seleccionados={seleccionados}
        onLimpiarSeleccion={() => setSeleccionados([])}
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <ScatterPerfil
            filas={filas}
            seleccionados={seleccionados}
            medianas={medianas}
            onToggle={toggleSeleccion}
          />
        </div>
        <div className="lg:col-span-2">
          <RadarComparacion
            filas={filasSeleccionadas}
            maximos={maximos}
          />
        </div>
      </div>

      <TablaRanking
        filas={filasFiltradas}
        orden={orden}
        onOrden={(col) =>
          setOrden((prev) =>
            prev.col === col ? { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' }
          )
        }
        seleccionados={seleccionados}
        onToggle={toggleSeleccion}
        medianas={medianas}
        onCsv={() => descargarCsv(`comparativo-${periodo}`, filasFiltradas)}
      />

      <NotaMetodologia />
    </div>
  );
}

function AdvertenciaContexto() {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 flex items-start gap-3">
      <span className="text-xl mt-0.5" aria-hidden="true">⚖️</span>
      <p>
        <strong>Comparar sin contexto es injusto.</strong> Un concejal de oposición con pocos acuerdos
        sancionados puede estar ejerciendo un control político riguroso. Esta vista mide{' '}
        <em>producción legislativa</em>, no la calidad ni la importancia política de la labor. No existe
        un "puntaje global" porque ponderar estos ejes sería una decisión editorial, no un dato.
      </p>
    </div>
  );
}

function Controles({
  periodos, periodo, onPeriodo, filtroTexto, onTexto, totalConcejales, seleccionados, onLimpiarSeleccion,
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
        <label className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Periodo</span>
          <select
            value={periodo}
            onChange={(e) => onPeriodo(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {periodos.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden="true">🔍</span>
          <input
            type="search"
            value={filtroTexto}
            onChange={(e) => onTexto(e.target.value)}
            placeholder="Buscar concejal en la tabla…"
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          <strong className="text-slate-900">{totalConcejales.toLocaleString('es-CO')}</strong> concejales en el periodo ·{' '}
          {seleccionados.length}/{MAX_COMPARAR} seleccionados para comparar
        </span>
        {seleccionados.length > 0 && (
          <button type="button" onClick={onLimpiarSeleccion} className="text-brand-700 hover:underline">
            Quitar selección
          </button>
        )}
      </div>
    </div>
  );
}

function ScatterPerfil({ filas, seleccionados, medianas, onToggle }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const noSel = filas.filter((f) => !seleccionados.includes(f.nombre));
  const sel = filas.filter((f) => seleccionados.includes(f.nombre));

  const punto = (f) => ({ x: f.proyectos, y: f.efectividad, nombre: f.nombre });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-slate-900 mb-1">Perfil: producción vs. efectividad</h3>
      <p className="text-xs text-slate-500 mb-4">
        Eje X = número de proyectos radicados (volumen). Eje Y = % que terminó sancionado (efectividad).
        Las líneas marcan la mediana del periodo. Haz clic en un punto para compararlo.
      </p>
      {filas.length === 0 ? (
        <p className="text-sm text-slate-500 italic">Sin concejales en el periodo.</p>
      ) : !mounted ? (
        <div className="h-80" />
      ) : (
        <div className="h-80">
          <Scatter
            data={{
              datasets: [
                {
                  label: 'Concejales',
                  data: noSel.map(punto),
                  backgroundColor: 'rgba(112,16,166,0.35)',
                  pointRadius: 6,
                  pointHoverRadius: 8,
                },
                {
                  label: 'Seleccionados',
                  data: sel.map(punto),
                  backgroundColor: '#f59e0b',
                  pointRadius: 8,
                  pointHoverRadius: 10,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              onClick: (_evt, elements, chart) => {
                if (!elements.length) return;
                const el = elements[0];
                const p = chart.data.datasets[el.datasetIndex].data[el.index];
                if (p && p.nombre) onToggle(p.nombre);
              },
              plugins: {
                legend: { display: false },
                medianas: { x: medianas.proyectos, y: medianas.efectividad },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const p = ctx.raw;
                      return `${p.nombre}: ${p.x} proyectos · ${p.y}% efectividad`;
                    },
                  },
                },
              },
              scales: {
                x: { title: { display: true, text: 'Proyectos radicados' }, beginAtZero: true, ticks: { precision: 0 } },
                y: { title: { display: true, text: 'Efectividad (%)' }, beginAtZero: true },
              },
            }}
            plugins={[pluginMedianas]}
          />
        </div>
      )}
    </div>
  );
}

function RadarComparacion({ filas, maximos }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-slate-900 mb-1">Comparación directa</h3>
      <p className="text-xs text-slate-500 mb-4">
        Hasta {MAX_COMPARAR} concejales en ejes normalizados (100 = el más alto del periodo en ese eje).
      </p>
      {filas.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          Selecciona concejales en el gráfico o la tabla para compararlos aquí.
        </p>
      ) : !mounted ? (
        <div className="h-80" />
      ) : (
        <div className="h-80">
          <Radar
            data={{
              labels: EJES_RADAR.map((e) => EJES_RADAR_LABEL[e]),
              datasets: filas.map((f, i) => {
                const color = COLORES_SEL[i % COLORES_SEL.length];
                return {
                  label: f.nombre.length > 22 ? `${f.nombre.slice(0, 22)}…` : f.nombre,
                  data: EJES_RADAR.map((e) => Math.round(((f[e] || 0) / maximos[e]) * 100)),
                  backgroundColor: `${color}22`,
                  borderColor: color,
                  borderWidth: 2,
                  pointBackgroundColor: color,
                };
              }),
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } },
              },
              scales: {
                r: { beginAtZero: true, max: 100, ticks: { display: false, stepSize: 25 } },
              },
            }}
          />
        </div>
      )}
    </div>
  );
}

function TablaRanking({ filas, orden, onOrden, seleccionados, onToggle, medianas, onCsv }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div>
          <h3 className="font-semibold text-slate-900">Ranking por producción legislativa</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Clic en una columna para ordenar · clic en una fila para compararla · valores sobre la mediana en negrita
          </p>
        </div>
        <button type="button" onClick={onCsv} className="shrink-0 text-xs font-medium text-brand-700 hover:text-brand-900 hover:underline">
          ⬇ CSV
        </button>
      </div>

      {filas.length === 0 ? (
        <p className="px-5 py-8 text-sm text-slate-500 italic text-center">Sin concejales para el filtro seleccionado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100">
              <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3">Concejal</th>
                {COLUMNAS.map((c) => (
                  <th key={c.key} className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onOrden(c.key)}
                      className="inline-flex items-center gap-1 hover:text-brand-700"
                      title={c.ayuda}
                    >
                      {c.label}
                      <span className="text-[10px]">
                        {orden.col === c.key ? (orden.dir === 'desc' ? '▼' : '▲') : '↕'}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.map((f, i) => {
                const activo = seleccionados.includes(f.nombre);
                return (
                  <tr
                    key={f.nombre}
                    onClick={() => onToggle(f.nombre)}
                    className={`cursor-pointer ${activo ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block h-4 w-4 rounded border ${
                          activo ? 'bg-brand-600 border-brand-600' : 'border-slate-300'
                        }`}
                        aria-hidden="true"
                      >
                        {activo && <span className="text-white text-[10px] leading-4">✓</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-400 text-xs tabular-nums mr-2">{i + 1}</span>
                      <a
                        href={`/concejales?nombre=${encodeURIComponent(f.nombre)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-slate-800 hover:text-brand-700 hover:underline"
                      >
                        {f.nombre}
                      </a>
                    </td>
                    {COLUMNAS.map((c) => {
                      const val = f[c.key] || 0;
                      const refMediana = c.key === 'proyectos' ? medianas.proyectos : c.key === 'efectividad' ? medianas.efectividad : null;
                      const destacar = refMediana != null && val > refMediana;
                      return (
                        <td
                          key={c.key}
                          className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${
                            destacar ? 'font-bold text-slate-900' : 'text-slate-600'
                          }`}
                        >
                          {val.toLocaleString('es-CO')}{c.sufijo || ''}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NotaMetodologia() {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <strong>Nota metodológica:</strong>
      <ul className="mt-1 list-disc list-inside space-y-0.5">
        <li>Proyectos y acuerdos cuentan solo las filas donde el concejal figura como ponente o proponente en SIMI.</li>
        <li>"Efectividad" = proyectos sancionados sobre proyectos radicados; depende de la correlación de fuerzas en el Concejo, no solo del concejal.</li>
        <li>Los ejes del radar se normalizan al máximo del periodo, así que comparan posición relativa, no magnitudes absolutas.</li>
        <li>No se incluyen bancada, asistencia ni control político individual porque esos datos no están en la fuente; sin ellos un "ranking de desempeño" sería tendencioso.</li>
      </ul>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-20 rounded-xl bg-slate-100" />
      <div className="h-20 rounded-xl bg-slate-100" />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 h-96 rounded-xl bg-slate-100" />
        <div className="lg:col-span-2 h-96 rounded-xl bg-slate-100" />
      </div>
      <div className="h-96 rounded-xl bg-slate-100" />
    </div>
  );
}

function ErrorBanner({ mensaje }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <strong>Error cargando el comparativo:</strong> {mensaje}
    </div>
  );
}
