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
import { formatFecha, formatMes } from '../lib/stats.ts';
import { descargarCsv } from '../lib/csv.ts';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// Las tres herramientas de control político del Concejo, de mayor a menor "dureza".
const TIPOS = ['Citación', 'Invitación', 'Comisión accidental'];
const COLORES_TIPO = {
  'Citación': '#7010a6',
  'Invitación': '#fcd700',
  'Comisión accidental': '#14b8a6',
};

// EDITORIAL: la fuente SIMI no trae la entidad citada en un campo propio; viene
// embebida en el título/descripción. Mapeo curado título→entidad, primer match gana.
// Orden importa: lo específico antes que lo genérico. Catch-all = "Sin identificar".
const ENTIDADES = [
  { entidad: 'EPM', kw: ['epm', 'empresas publicas', 'empresas públicas'] },
  { entidad: 'Metro de Medellín', kw: ['metro de medellin', 'metro de medellín', 'metroplus', 'metroplús'] },
  { entidad: 'Área Metropolitana', kw: ['area metropolitana', 'área metropolitana', 'amva'] },
  { entidad: 'EDU', kw: ['empresa de desarrollo urbano', 'edu'] },
  { entidad: 'INDER', kw: ['inder'] },
  { entidad: 'Sapiencia', kw: ['sapiencia'] },
  { entidad: 'Metrosalud', kw: ['metrosalud'] },
  { entidad: 'Telemedellín', kw: ['telemedellin', 'telemedellín'] },
  { entidad: 'Metroparques', kw: ['metroparques'] },
  { entidad: 'Personería', kw: ['personeria', 'personería'] },
  { entidad: 'Contraloría', kw: ['contraloria', 'contraloría'] },
  { entidad: 'Buen Comienzo', kw: ['buen comienzo'] },
  { entidad: 'Sec. Movilidad', kw: ['movilidad', 'transito', 'tránsito'] },
  { entidad: 'Sec. Salud', kw: ['salud'] },
  { entidad: 'Sec. Educación', kw: ['educacion', 'educación'] },
  { entidad: 'Sec. Seguridad', kw: ['seguridad', 'convivencia'] },
  { entidad: 'Sec. Infraestructura', kw: ['infraestructura'] },
  { entidad: 'Sec. Hacienda', kw: ['hacienda', 'tributaria', 'tributario'] },
  { entidad: 'Sec. Gobierno', kw: ['gobierno'] },
  { entidad: 'Sec. Medio Ambiente', kw: ['medio ambiente', 'ambiental'] },
  { entidad: 'Sec. de las Mujeres', kw: ['mujeres', 'mujer'] },
  { entidad: 'Sec. Cultura', kw: ['cultura ciudadana', 'cultura'] },
  { entidad: 'Sec. Inclusión Social', kw: ['inclusion', 'inclusión', 'familia'] },
  { entidad: 'Sec. Desarrollo Económico', kw: ['desarrollo economico', 'desarrollo económico'] },
  { entidad: 'Sec. Juventud', kw: ['juventud'] },
  { entidad: 'Sec. Participación', kw: ['participacion ciudadana', 'participación ciudadana'] },
  { entidad: 'Planeación / POT', kw: ['planeacion', 'planeación', 'pot', 'ordenamiento territorial', 'control territorial'] },
  { entidad: 'Comunicaciones', kw: ['comunicaciones'] },
];

const COLORES_ESTADO = {
  Realizada: '#16a34a',
  'En trámite': '#fcd700',
  Cerrada: '#94a3b8',
};

const POR_PAGINA = 25;

const normalizar = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

function detectarEntidad(titulo, descripcion) {
  const blob = normalizar(`${titulo || ''} ${descripcion || ''}`);
  for (const e of ENTIDADES) {
    if (e.kw.some((k) => blob.includes(k))) return e.entidad;
  }
  return 'Sin identificar';
}

// Tres buckets semánticos para el estado crudo de SIMI.
function clasificarEstado(estado) {
  const s = normalizar(estado);
  if (['realiz', 'aprob', 'evacu', 'finaliz', 'cumpl', 'contest', 'respond'].some((k) => s.includes(k)))
    return 'Realizada';
  if (['archiv', 'negad', 'retir', 'venc', 'cerrad', 'desist'].some((k) => s.includes(k)))
    return 'Cerrada';
  return 'En trámite';
}

function anioDeStr(fecha) {
  if (!fecha) return null;
  const f = new Date(fecha);
  return isNaN(f.getTime()) ? null : f.getFullYear();
}

function mesDeStr(fecha) {
  if (!fecha) return null;
  const f = new Date(fecha);
  if (isNaN(f.getTime())) return null;
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
}

export default function ControlPolitico() {
  const [estado, setEstado] = useState({ cargando: true, error: null, rows: [] });
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroAnio, setFiltroAnio] = useState(null);
  const [filtroEntidad, setFiltroEntidad] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [pagina, setPagina] = useState(1);

  useEffect(() => {
    let cancelado = false;
    Promise.all([
      api.datos('citaciones'),
      api.datos('invitaciones'),
      api.datos('comisiones'),
    ]).then(([cit, inv, com]) => {
      if (cancelado) return;
      const fallida = [cit, inv, com].find((r) => !r.success);
      if (fallida) {
        setEstado({ cargando: false, error: fallida.error, rows: [] });
        return;
      }
      const enriquecer = (r, tipo) => ({
        ...r,
        _tipo: tipo,
        _anio: anioDeStr(r.fecha),
        _mes: mesDeStr(r.fecha),
        _entidad: detectarEntidad(r.titulo, r.descripcion),
        _estado: clasificarEstado(r.estado),
      });
      const rows = [
        ...(Array.isArray(cit.data) ? cit.data : []).map((r) => enriquecer(r, 'Citación')),
        ...(Array.isArray(inv.data) ? inv.data : []).map((r) => enriquecer(r, 'Invitación')),
        ...(Array.isArray(com.data) ? com.data : []).map((r) => enriquecer(r, 'Comisión accidental')),
      ];
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

  const entidadesList = useMemo(() => {
    const conteo = {};
    for (const r of estado.rows) conteo[r._entidad] = (conteo[r._entidad] || 0) + 1;
    return Object.keys(conteo).sort((a, b) => conteo[b] - conteo[a]);
  }, [estado.rows]);

  const filtrados = useMemo(() => {
    const txt = normalizar(filtroTexto);
    return estado.rows
      .filter((r) => {
        if (filtroTipo && r._tipo !== filtroTipo) return false;
        if (filtroAnio && r._anio !== filtroAnio) return false;
        if (filtroEntidad && r._entidad !== filtroEntidad) return false;
        if (txt) {
          const blob = normalizar(r.titulo) + ' ' + normalizar(r.descripcion);
          if (!blob.includes(txt)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const fa = a.fecha ? new Date(a.fecha).getTime() : 0;
        const fb = b.fecha ? new Date(b.fecha).getTime() : 0;
        return fb - fa;
      });
  }, [estado.rows, filtroTipo, filtroAnio, filtroEntidad, filtroTexto]);

  useEffect(() => setPagina(1), [filtroTipo, filtroAnio, filtroEntidad, filtroTexto]);

  const kpis = useMemo(() => {
    const total = filtrados.length;
    const citaciones = filtrados.filter((r) => r._tipo === 'Citación').length;
    const invitaciones = filtrados.filter((r) => r._tipo === 'Invitación').length;
    const comisiones = filtrados.filter((r) => r._tipo === 'Comisión accidental').length;
    const entidades = new Set(
      filtrados.filter((r) => r._entidad !== 'Sin identificar').map((r) => r._entidad)
    ).size;
    const realizadas = filtrados.filter((r) => r._estado === 'Realizada').length;
    const tasa = total > 0 ? Math.round((realizadas / total) * 1000) / 10 : 0;
    return { total, citaciones, invitaciones, comisiones, entidades, tasa };
  }, [filtrados]);

  // Adaptativo: con un año seleccionado se desglosa por mes; sin filtro, por año.
  const granularidad = filtroAnio ? 'mes' : 'anio';

  const cronologia = useMemo(() => {
    const buckets = {};
    for (const r of filtrados) {
      const key = granularidad === 'mes' ? r._mes : r._anio ? String(r._anio) : null;
      if (!key) continue;
      if (!buckets[key]) buckets[key] = { key, Citación: 0, Invitación: 0, 'Comisión accidental': 0 };
      buckets[key][r._tipo]++;
    }
    return Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key));
  }, [filtrados, granularidad]);

  const topEntidades = useMemo(() => {
    const conteo = {};
    for (const r of filtrados) {
      if (r._entidad === 'Sin identificar') continue;
      conteo[r._entidad] = (conteo[r._entidad] || 0) + 1;
    }
    return Object.entries(conteo)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([entidad, count]) => ({ entidad, count }));
  }, [filtrados]);

  const comisionesPorAnio = useMemo(() => {
    const buckets = {};
    for (const r of filtrados) {
      if (r._tipo !== 'Comisión accidental' || !r._anio) continue;
      const k = String(r._anio);
      if (!buckets[k]) buckets[k] = { anio: k, Realizada: 0, 'En trámite': 0, Cerrada: 0 };
      buckets[k][r._estado]++;
    }
    return Object.values(buckets).sort((a, b) => a.anio.localeCompare(b.anio));
  }, [filtrados]);

  if (estado.cargando) return <Skeleton />;
  if (estado.error) return <ErrorBanner mensaje={estado.error} />;

  const filasPagina = filtrados.slice(0, pagina * POR_PAGINA);

  return (
    <div className="space-y-8">
      <Filtros
        anios={anios}
        entidades={entidadesList}
        filtroTipo={filtroTipo}
        filtroAnio={filtroAnio}
        filtroEntidad={filtroEntidad}
        filtroTexto={filtroTexto}
        onTipo={setFiltroTipo}
        onAnio={setFiltroAnio}
        onEntidad={setFiltroEntidad}
        onTexto={setFiltroTexto}
        totalFiltrados={filtrados.length}
        total={estado.rows.length}
      />

      <KpiRow kpis={kpis} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <CronologiaChart datos={cronologia} granularidad={granularidad} />
        </div>
        <TopEntidades items={topEntidades} onSelect={setFiltroEntidad} />
      </div>

      <ComisionesPorAnio
        datos={comisionesPorAnio}
        onVerComisiones={() => setFiltroTipo('Comisión accidental')}
      />

      <TablaControl
        filas={filasPagina}
        totalFiltrados={filtrados.length}
        hayMas={filasPagina.length < filtrados.length}
        onMas={() => setPagina((p) => p + 1)}
        onCsv={() =>
          descargarCsv(
            'control-politico',
            filtrados.map((r) => ({
              tipo: r._tipo,
              consecutivo: r.consecutivo,
              titulo: r.titulo,
              entidad: r._entidad,
              estado_original: r.estado,
              estado: r._estado,
              fecha: formatFecha(r.fecha),
            }))
          )
        }
      />

      <NotaMetodologia />
    </div>
  );
}

function Filtros({
  anios, entidades, filtroTipo, filtroAnio, filtroEntidad, filtroTexto,
  onTipo, onAnio, onEntidad, onTexto, totalFiltrados, total,
}) {
  const hayFiltros = filtroTipo || filtroAnio || filtroEntidad || filtroTexto;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden="true">🔍</span>
          <input
            type="search"
            value={filtroTexto}
            onChange={(e) => onTexto(e.target.value)}
            placeholder="Buscar por tema, entidad o asunto…"
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <label className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entidad</span>
          <select
            value={filtroEntidad}
            onChange={(e) => onEntidad(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Todas</option>
            {entidades.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tipo</span>
        <Pill activa={!filtroTipo} onClick={() => onTipo('')}>Todos</Pill>
        {TIPOS.map((t) => (
          <Pill key={t} activa={filtroTipo === t} onClick={() => onTipo(t)} color={COLORES_TIPO[t]}>
            {t}
          </Pill>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Año</span>
        <Pill activa={!filtroAnio} onClick={() => onAnio(null)}>Todos</Pill>
        {anios.map((a) => (
          <Pill key={a} activa={filtroAnio === a} onClick={() => onAnio(a)}>{a}</Pill>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {hayFiltros ? (
            <>
              <strong className="text-slate-900">{totalFiltrados.toLocaleString('es-CO')}</strong> de{' '}
              {total.toLocaleString('es-CO')} acciones de control
            </>
          ) : (
            <>
              <strong className="text-slate-900">{total.toLocaleString('es-CO')}</strong> acciones de control en total
            </>
          )}
        </span>
        {hayFiltros && (
          <button
            type="button"
            onClick={() => { onTipo(''); onAnio(null); onEntidad(''); onTexto(''); }}
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
  const claroAmarillo = color === '#fcd700';
  return (
    <button
      type="button"
      onClick={onClick}
      style={activa && color ? { backgroundColor: color, color: claroAmarillo ? '#422006' : '#fff' } : undefined}
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
  { key: 'total', label: 'Acciones de control', icon: '🛡️' },
  { key: 'citaciones', label: 'Citaciones', icon: '📣' },
  { key: 'invitaciones', label: 'Invitaciones', icon: '✉️' },
  { key: 'comisiones', label: 'Comisiones accidentales', icon: '🔎' },
  { key: 'entidades', label: 'Entidades vigiladas', icon: '🏛️' },
  { key: 'tasa', label: 'Tasa de realización', icon: '✅', sufijo: '%' },
];

function KpiRow({ kpis }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {KPI_DEFS.map(({ key, label, icon, sufijo }) => (
        <div key={key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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

function CronologiaChart({ datos, granularidad }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const etiqueta = (k) => (granularidad === 'mes' ? formatMes(k) : k);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-slate-900 mb-1">Cronología del control político</h3>
      <p className="text-xs text-slate-500 mb-4">
        Citaciones, invitaciones y comisiones accidentales {granularidad === 'mes' ? 'por mes' : 'por año'}.
        Selecciona un año para ver el detalle mensual.
      </p>
      {datos.length === 0 ? (
        <p className="text-sm text-slate-500 italic">Sin datos para el filtro seleccionado.</p>
      ) : !mounted ? (
        <div className="h-72" />
      ) : (
        <div className="h-72">
          <Bar
            data={{
              labels: datos.map((d) => etiqueta(d.key)),
              datasets: TIPOS.map((t) => ({
                label: t,
                data: datos.map((d) => d[t] || 0),
                backgroundColor: COLORES_TIPO[t],
                borderRadius: 2,
              })),
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { mode: 'index', intersect: false },
              },
              scales: {
                x: { stacked: true, grid: { display: false } },
                y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
              },
            }}
          />
        </div>
      )}
    </div>
  );
}

function TopEntidades({ items, onSelect }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-slate-900 mb-1">Entidades más vigiladas</h3>
      <p className="text-xs text-slate-500 mb-4">
        Secretarías y entes descentralizados con más citaciones e invitaciones.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 italic">Sin entidades identificadas en el filtro.</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item, idx) => (
            <li key={item.entidad} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-right text-xs font-semibold text-slate-400 tabular-nums">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <button
                    type="button"
                    onClick={() => onSelect(item.entidad)}
                    className="truncate text-xs text-slate-800 hover:text-brand-700 hover:underline text-left"
                    title={`Filtrar por ${item.entidad}`}
                  >
                    {item.entidad}
                  </button>
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

function ComisionesPorAnio({ datos, onVerComisiones }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ESTADOS = ['Realizada', 'En trámite', 'Cerrada'];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h3 className="font-semibold text-slate-900">Comisiones accidentales por año</h3>
        <button
          type="button"
          onClick={onVerComisiones}
          className="shrink-0 text-xs font-medium text-brand-700 hover:text-brand-900 hover:underline"
        >
          Ver solo comisiones
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        ¿Herramienta real de seguimiento o trámite que se archiva? Estado de cierre de las comisiones por año de creación.
      </p>
      {datos.length === 0 ? (
        <p className="text-sm text-slate-500 italic">No hay comisiones accidentales en el filtro seleccionado.</p>
      ) : !mounted ? (
        <div className="h-64" />
      ) : (
        <div className="h-64">
          <Bar
            data={{
              labels: datos.map((d) => d.anio),
              datasets: ESTADOS.map((e) => ({
                label: e,
                data: datos.map((d) => d[e] || 0),
                backgroundColor: COLORES_ESTADO[e],
                borderRadius: 2,
              })),
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { mode: 'index', intersect: false },
              },
              scales: {
                x: { stacked: true, grid: { display: false } },
                y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
              },
            }}
          />
        </div>
      )}
    </div>
  );
}

function TablaControl({ filas, totalFiltrados, hayMas, onMas, onCsv }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div>
          <h3 className="font-semibold text-slate-900">Acciones de control político</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {totalFiltrados.toLocaleString('es-CO')} registros · más recientes primero
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
          Sin acciones de control para el filtro seleccionado.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100">
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 whitespace-nowrap">Tipo</th>
                  <th className="px-4 py-3">Asunto</th>
                  <th className="px-4 py-3 whitespace-nowrap">Entidad</th>
                  <th className="px-4 py-3 whitespace-nowrap">Estado</th>
                  <th className="px-4 py-3 whitespace-nowrap">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.map((r, i) => (
                  <tr key={`${r._tipo}-${r.consecutivo || i}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <TipoBadge tipo={r._tipo} />
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      <a
                        href={`/buscador?q=${encodeURIComponent(String(r.titulo || '').slice(0, 40))}`}
                        className="line-clamp-2 block text-slate-800 hover:text-brand-700 hover:underline"
                        title={String(r.titulo || '')}
                      >
                        {r.titulo || '—'}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {r._entidad === 'Sin identificar' ? (
                        <span className="text-slate-400 italic">Sin identificar</span>
                      ) : (
                        <span className="text-slate-700">{r._entidad}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <EstadoBadge estado={r._estado} original={r.estado} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {formatFecha(r.fecha)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hayMas && (
            <button
              type="button"
              onClick={onMas}
              className="w-full border-t border-slate-100 py-3 text-sm font-medium text-brand-700 hover:bg-brand-50"
            >
              Mostrar más ({(totalFiltrados - filas.length).toLocaleString('es-CO')} registros más)
            </button>
          )}
        </>
      )}
    </div>
  );
}

function TipoBadge({ tipo }) {
  const color = COLORES_TIPO[tipo] || '#94a3b8';
  const claro = color === '#fcd700';
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: color, color: claro ? '#422006' : '#fff' }}
    >
      {tipo}
    </span>
  );
}

function EstadoBadge({ estado, original }) {
  const color = COLORES_ESTADO[estado] || '#94a3b8';
  const claro = color === '#fcd700';
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: color, color: claro ? '#422006' : '#fff' }}
      title={original ? `SIMI: ${original}` : undefined}
    >
      {estado}
    </span>
  );
}

function NotaMetodologia() {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <strong>Nota metodológica:</strong>
      <ul className="mt-1 list-disc list-inside space-y-0.5">
        <li>La "entidad vigilada" se infiere del texto del asunto, no de un campo estructurado de SIMI; registros sin coincidencia quedan como "Sin identificar".</li>
        <li>El estado se agrupa en tres categorías (Realizada, En trámite, Cerrada) a partir del estado crudo de SIMI; pasa el cursor sobre la etiqueta para ver el original.</li>
        <li>La bancada citante no está disponible en la fuente; el heatmap bancada × tema se activará cuando ese dato se incorpore.</li>
        <li>Cada asunto enlaza al buscador para cruzar la acción de control con proyectos y acuerdos relacionados.</li>
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
      <div className="h-72 rounded-xl bg-slate-100" />
      <div className="h-96 rounded-xl bg-slate-100" />
    </div>
  );
}

function ErrorBanner({ mensaje }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <strong>Error cargando el control político:</strong> {mensaje}
    </div>
  );
}
