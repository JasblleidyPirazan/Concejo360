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
import { formatFecha } from '../lib/stats.ts';
import { descargarCsv } from '../lib/csv.ts';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// Espejo de MAPEO_ESTADO_ETAPA del backend (panoramaConcejo.js)
const ETAPAS = ['Radicado', 'Con ponentes', 'Primer debate', 'Segundo debate', 'Sancionado/Archivado'];
const MAPEO_ETAPA = [
  { etapa: 'Sancionado/Archivado', kw: ['sancion', 'archiv', 'retir', 'hundi'] },
  { etapa: 'Segundo debate', kw: ['segundo debate', 'aprobado en segundo', 'aprobado segundo'] },
  { etapa: 'Primer debate', kw: ['primer debate', 'aprobado en primer', 'aprobado primer', 'ponencia presentada'] },
  { etapa: 'Con ponentes', kw: ['ponente', 'ponencia'] },
];
const COLORES_ETAPA = {
  'Radicado': '#94a3b8',
  'Con ponentes': '#818cf8',
  'Primer debate': '#60a5fa',
  'Segundo debate': '#34d399',
  'Sancionado/Archivado': '#7010a6',
};
const DIAS_ESPERA = 180;
const POR_PAGINA = 25;

function clasificarEtapa(estado) {
  const s = String(estado || '').toLowerCase();
  for (const r of MAPEO_ETAPA) {
    if (r.kw.some((k) => s.includes(k))) return r.etapa;
  }
  return 'Radicado';
}

function parsearProponentes(str) {
  if (!str) return [];
  return String(str)
    .split(/[;,|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

function anioDeStr(fecha) {
  if (!fecha) return null;
  const f = new Date(fecha);
  return isNaN(f.getTime()) ? null : f.getFullYear();
}

function diasDesdeHoy(fecha) {
  if (!fecha) return null;
  const f = new Date(fecha);
  if (isNaN(f.getTime())) return null;
  return Math.floor((Date.now() - f.getTime()) / 86400000);
}

const normalizar = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const abreviarComision = (com) => {
  if (!com) return 'Sin comisión';
  const s = String(com).trim();
  const m = s.match(/^(Primera|Segunda|Tercera)/i);
  if (m) return m[1];
  return s.length > 25 ? `${s.slice(0, 25)}…` : s;
};

export default function ProduccionLegislativa() {
  const [estado, setEstado] = useState({ cargando: true, error: null, rows: [] });
  const [filtroAnio, setFiltroAnio] = useState(null);
  const [filtroComision, setFiltroComision] = useState('');
  const [filtroEtapa, setFiltroEtapa] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [pagina, setPagina] = useState(1);

  useEffect(() => {
    let cancelado = false;
    api.datos('proyectos').then((res) => {
      if (cancelado) return;
      if (!res.success) {
        setEstado({ cargando: false, error: res.error, rows: [] });
        return;
      }
      const rows = (Array.isArray(res.data) ? res.data : []).map((r) => ({
        ...r,
        _etapa: clasificarEtapa(r.estado),
        _anio: anioDeStr(r.fecha),
        _dias: diasDesdeHoy(r.fecha),
        _props: parsearProponentes(r.proponentes),
      }));
      setEstado({ cargando: false, error: null, rows });
    });
    return () => {
      cancelado = true;
    };
  }, []);

  const anios = useMemo(() => {
    const set = new Set(estado.rows.map((r) => r._anio).filter(Boolean));
    return [...set].sort((a, b) => b - a);
  }, [estado.rows]);

  const comisionesList = useMemo(() => {
    const set = new Set(
      estado.rows.map((r) => String(r.comision || '').trim() || 'Sin comisión')
    );
    return [...set].sort();
  }, [estado.rows]);

  const filtrados = useMemo(() => {
    const txt = normalizar(filtroTexto);
    return estado.rows
      .filter((r) => {
        if (filtroAnio && r._anio !== filtroAnio) return false;
        if (filtroComision) {
          const c = String(r.comision || '').trim() || 'Sin comisión';
          if (c !== filtroComision) return false;
        }
        if (filtroEtapa && r._etapa !== filtroEtapa) return false;
        if (txt) {
          const blob = normalizar(r.titulo) + ' ' + normalizar(r.proponentes);
          if (!blob.includes(txt)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const fa = a.fecha ? new Date(a.fecha).getTime() : 0;
        const fb = b.fecha ? new Date(b.fecha).getTime() : 0;
        return fb - fa;
      });
  }, [estado.rows, filtroAnio, filtroComision, filtroEtapa, filtroTexto]);

  useEffect(() => setPagina(1), [filtroAnio, filtroComision, filtroEtapa, filtroTexto]);

  const kpis = useMemo(() => {
    const total = filtrados.length;
    let sancionados = 0;
    let archivados = 0;
    for (const r of filtrados) {
      if (r._etapa === 'Sancionado/Archivado') {
        if (/sancion/.test(String(r.estado || '').toLowerCase())) sancionados++;
        else archivados++;
      }
    }
    const enTramite = total - sancionados - archivados;
    const enEspera = filtrados.filter(
      (r) => ['Radicado', 'Con ponentes'].includes(r._etapa) && (r._dias || 0) > DIAS_ESPERA
    ).length;
    const tasa = total > 0 ? Math.round((sancionados / total) * 1000) / 10 : 0;
    return { total, sancionados, archivados, enTramite, enEspera, tasa };
  }, [filtrados]);

  const distribucion = useMemo(() => {
    const mapa = {};
    for (const r of filtrados) {
      const com = String(r.comision || '').trim() || 'Sin comisión';
      if (!mapa[com]) mapa[com] = Object.fromEntries(ETAPAS.map((e) => [e, 0]));
      mapa[com][r._etapa]++;
    }
    return Object.entries(mapa)
      .map(([com, counts]) => ({
        com,
        counts,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [filtrados]);

  const topProponentes = useMemo(() => {
    const conteo = {};
    for (const r of filtrados) {
      for (const p of r._props) {
        conteo[p] = (conteo[p] || 0) + 1;
      }
    }
    return Object.entries(conteo)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([nombre, count]) => ({ nombre, count }));
  }, [filtrados]);

  if (estado.cargando) return <Skeleton />;
  if (estado.error) return <ErrorBanner mensaje={estado.error} />;

  const filasPagina = filtrados.slice(0, pagina * POR_PAGINA);

  return (
    <div className="space-y-8">
      <Filtros
        anios={anios}
        comisiones={comisionesList}
        filtroAnio={filtroAnio}
        filtroComision={filtroComision}
        filtroEtapa={filtroEtapa}
        filtroTexto={filtroTexto}
        onAnio={setFiltroAnio}
        onComision={setFiltroComision}
        onEtapa={setFiltroEtapa}
        onTexto={setFiltroTexto}
        totalFiltrados={filtrados.length}
        total={estado.rows.length}
      />

      <KpiRow kpis={kpis} />

      {kpis.enEspera > 0 && !filtroEtapa && (
        <AlertaEspera
          count={kpis.enEspera}
          onVerlos={() => {
            setFiltroEtapa('Radicado');
          }}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DistribucionChart datos={distribucion} />
        </div>
        <TopProponentes items={topProponentes} />
      </div>

      <TablaProyectos
        filas={filasPagina}
        totalFiltrados={filtrados.length}
        hayMas={filasPagina.length < filtrados.length}
        onMas={() => setPagina((p) => p + 1)}
        onCsv={() =>
          descargarCsv(
            'proyectos-produccion-legislativa',
            filtrados.map((r) => ({
              numero: r.numero,
              titulo: r.titulo,
              proponentes: r.proponentes,
              estado: r.estado,
              etapa: r._etapa,
              fecha: formatFecha(r.fecha),
              comision: r.comision,
              dias_desde_radicacion: r._dias,
            }))
          )
        }
      />

      <NotaMetodologia />
    </div>
  );
}

function Filtros({
  anios, comisiones, filtroAnio, filtroComision, filtroEtapa, filtroTexto,
  onAnio, onComision, onEtapa, onTexto, totalFiltrados, total,
}) {
  const hayFiltros = filtroAnio || filtroComision || filtroEtapa || filtroTexto;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden="true">🔍</span>
          <input
            type="search"
            value={filtroTexto}
            onChange={(e) => onTexto(e.target.value)}
            placeholder="Buscar por título o proponente…"
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <label className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Comisión</span>
          <select
            value={filtroComision}
            onChange={(e) => onComision(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Todas</option>
            {comisiones.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Año</span>
        <Pill activa={!filtroAnio} onClick={() => onAnio(null)}>Todos</Pill>
        {anios.map((a) => (
          <Pill key={a} activa={filtroAnio === a} onClick={() => onAnio(a)}>{a}</Pill>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Etapa</span>
        <Pill activa={!filtroEtapa} onClick={() => onEtapa('')}>Todas</Pill>
        {ETAPAS.map((e) => (
          <Pill key={e} activa={filtroEtapa === e} onClick={() => onEtapa(e)} color={COLORES_ETAPA[e]}>
            {e}
          </Pill>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {hayFiltros ? (
            <>
              <strong className="text-slate-900">{totalFiltrados.toLocaleString('es-CO')}</strong> de{' '}
              {total.toLocaleString('es-CO')} proyectos
            </>
          ) : (
            <>
              <strong className="text-slate-900">{total.toLocaleString('es-CO')}</strong> proyectos en total
            </>
          )}
        </span>
        {hayFiltros && (
          <button
            type="button"
            onClick={() => { onAnio(null); onComision(''); onEtapa(''); onTexto(''); }}
            className="text-brand-700 hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>
    </div>
  );
}

function Pill({ activa, onClick, children, color }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={activa && color ? { backgroundColor: color, color: '#fff' } : undefined}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        activa && !color
          ? 'bg-brand-600 text-white shadow-sm'
          : !activa
          ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          : 'shadow-sm'
      }`}
    >
      {children}
    </button>
  );
}

const KPI_DEFS = [
  { key: 'total', label: 'Total proyectos', icon: '📋' },
  { key: 'enTramite', label: 'En trámite activo', icon: '⚙️' },
  { key: 'sancionados', label: 'Sancionados como acuerdo', icon: '✅' },
  { key: 'archivados', label: 'Archivados / retirados', icon: '🗂️' },
  { key: 'tasa', label: 'Tasa de conversión', icon: '🎯', sufijo: '%' },
  { key: 'enEspera', label: 'Sin avance > 6 meses', icon: '⏳', alerta: true },
];

function KpiRow({ kpis }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {KPI_DEFS.map(({ key, label, icon, sufijo, alerta }) => (
        <div
          key={key}
          className={`rounded-xl border p-4 shadow-sm ${
            alerta && kpis[key] > 0
              ? 'border-amber-200 bg-amber-50'
              : 'border-slate-200 bg-white'
          }`}
        >
          <span className="text-2xl" aria-hidden="true">{icon}</span>
          <p className="mt-3 text-3xl font-bold tabular-nums text-slate-900">
            {kpis[key].toLocaleString('es-CO')}{sufijo || ''}
          </p>
          <p className="mt-1 text-xs font-medium text-slate-600">{label}</p>
        </div>
      ))}
    </div>
  );
}

function AlertaEspera({ count, onVerlos }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="text-xl mt-0.5" aria-hidden="true">⏳</span>
        <div>
          <p className="text-sm font-semibold text-amber-900">
            {count.toLocaleString('es-CO')} proyecto{count !== 1 ? 's' : ''} con más de 6 meses sin avanzar de etapa
          </p>
          <p className="text-xs text-amber-800 mt-0.5">
            Radicados o con ponentes asignados, pero sin debate registrado desde hace más de 180 días desde su radicación.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onVerlos}
        className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
      >
        Verlos
      </button>
    </div>
  );
}

function DistribucionChart({ datos }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-slate-900 mb-1">Distribución por comisión y etapa</h3>
      <p className="text-xs text-slate-500 mb-4">
        Qué proporción de proyectos llega a debate en cada comisión. Más gris ("Radicado") = más proyectos sin tramitar.
      </p>
      {datos.length === 0 ? (
        <p className="text-sm text-slate-500 italic">Sin datos para el filtro seleccionado.</p>
      ) : !mounted ? (
        <div className="h-72" />
      ) : (
        <div className="h-72">
          <Bar
            data={{
              labels: datos.map((d) => abreviarComision(d.com)),
              datasets: ETAPAS.map((e) => ({
                label: e,
                data: datos.map((d) => d.counts[e] || 0),
                backgroundColor: COLORES_ETAPA[e],
                borderRadius: 2,
              })),
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              indexAxis: 'y',
              plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { mode: 'index', intersect: false },
              },
              scales: {
                x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
                y: { stacked: true, grid: { display: false } },
              },
            }}
          />
        </div>
      )}
    </div>
  );
}

function TopProponentes({ items }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-slate-900 mb-1">Top proponentes</h3>
      <p className="text-xs text-slate-500 mb-4">
        Concejales con más proyectos radicados en el filtro actual.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 italic">Sin datos.</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item, idx) => (
            <li key={item.nombre} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-right text-xs font-semibold text-slate-400 tabular-nums">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <a
                    href={`/concejales?nombre=${encodeURIComponent(item.nombre)}`}
                    className="truncate text-xs text-slate-800 hover:text-brand-700 hover:underline"
                    title={item.nombre}
                  >
                    {item.nombre}
                  </a>
                  <span className="ml-2 text-xs font-semibold tabular-nums text-slate-900">
                    {item.count}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-brand-500"
                    style={{ width: `${(item.count / max) * 100}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TablaProyectos({ filas, totalFiltrados, hayMas, onMas, onCsv }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div>
          <h3 className="font-semibold text-slate-900">Proyectos de acuerdo</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {totalFiltrados.toLocaleString('es-CO')} proyectos · más recientes primero · ⚠ = más de 6 meses sin avance
          </p>
        </div>
        <button
          type="button"
          onClick={onCsv}
          className="shrink-0 text-xs font-medium text-brand-700 hover:text-brand-900 hover:underline"
        >
          ⬇ CSV
        </button>
      </div>

      {filas.length === 0 ? (
        <p className="px-5 py-8 text-sm text-slate-500 italic text-center">
          Sin proyectos para el filtro seleccionado.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100">
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 whitespace-nowrap">N.°</th>
                  <th className="px-4 py-3">Título</th>
                  <th className="px-4 py-3 whitespace-nowrap">Proponente(s)</th>
                  <th className="px-4 py-3 whitespace-nowrap">Comisión</th>
                  <th className="px-4 py-3 whitespace-nowrap">Etapa</th>
                  <th className="px-4 py-3 whitespace-nowrap">Radicado</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Días</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.map((r, i) => {
                  const atascado =
                    ['Radicado', 'Con ponentes'].includes(r._etapa) &&
                    (r._dias || 0) > DIAS_ESPERA;
                  return (
                    <tr
                      key={String(r.numero) || i}
                      className={`hover:bg-slate-50 ${atascado ? 'bg-amber-50/40' : ''}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">
                        {r.numero}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <a
                          href={`/buscador?q=${encodeURIComponent(String(r.numero || ''))}`}
                          className="truncate block text-slate-800 hover:text-brand-700 hover:underline"
                          title={String(r.titulo || '')}
                        >
                          {r.titulo || '—'}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-[11rem]">
                        <span className="truncate block" title={String(r.proponentes || '')}>
                          {r._props.slice(0, 2).join(', ') || '—'}
                          {r._props.length > 2 && (
                            <span className="text-slate-400"> +{r._props.length - 2}</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {abreviarComision(r.comision || '')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <EtapaBadge etapa={r._etapa} />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {formatFecha(r.fecha)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right text-xs tabular-nums whitespace-nowrap font-medium ${
                          atascado ? 'text-amber-700' : 'text-slate-400'
                        }`}
                      >
                        {r._dias != null ? r._dias.toLocaleString('es-CO') : '—'}
                        {atascado && ' ⚠'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hayMas && (
            <button
              type="button"
              onClick={onMas}
              className="w-full border-t border-slate-100 py-3 text-sm font-medium text-brand-700 hover:bg-brand-50"
            >
              Mostrar más ({(totalFiltrados - filas.length).toLocaleString('es-CO')} proyectos más)
            </button>
          )}
        </>
      )}
    </div>
  );
}

function EtapaBadge({ etapa }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
      style={{ backgroundColor: COLORES_ETAPA[etapa] || '#94a3b8' }}
    >
      {etapa}
    </span>
  );
}

function NotaMetodologia() {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <strong>Nota metodológica:</strong>
      <ul className="mt-1 list-disc list-inside space-y-0.5">
        <li>"Días" cuenta desde la fecha de radicación hasta hoy, no el tiempo en cada etapa.</li>
        <li>"Sin avance &gt; 6 meses" son proyectos en etapas iniciales radicados hace más de 180 días — es una señal, no un diagnóstico.</li>
        <li>El campo bancada no está en la fuente SIMI; el diagrama Sankey bancada → comisión → estado se activará cuando ese dato esté disponible.</li>
        <li>Los títulos enlazan al buscador para cruzar con citaciones y comisiones sobre el mismo proyecto.</li>
      </ul>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-36 rounded-xl bg-slate-100" />
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-80 rounded-xl bg-slate-100" />
        <div className="h-80 rounded-xl bg-slate-100" />
      </div>
      <div className="h-96 rounded-xl bg-slate-100" />
    </div>
  );
}

function ErrorBanner({ mensaje }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <strong>Error cargando los proyectos:</strong> {mensaje}
    </div>
  );
}
