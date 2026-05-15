import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

const KPI_DEFINITIONS = [
  { key: 'acuerdos_ponente', label: 'Acuerdos como ponente', icon: '⚖️', tipo: 'concejal' },
  { key: 'proyectos_ponente', label: 'Proyectos como ponente', icon: '📋', tipo: 'concejal' },
  { key: 'comisiones', label: 'Comisiones del periodo', icon: '👥', tipo: 'periodo' },
  { key: 'citaciones', label: 'Citaciones del periodo', icon: '📣', tipo: 'periodo' },
  { key: 'invitaciones', label: 'Invitaciones del periodo', icon: '✉️', tipo: 'periodo' },
];

export default function DashboardConcejales() {
  const [estado, setEstado] = useState({ cargando: true, error: null, data: null });
  const [periodo, setPeriodo] = useState('');
  const [concejal, setConcejal] = useState('');

  useEffect(() => {
    let cancelado = false;
    api.resumenConcejales().then((res) => {
      if (cancelado) return;
      if (!res.success) {
        setEstado({ cargando: false, error: res.error, data: null });
        return;
      }
      const data = res.data;
      const periodoInicial = data.periodo_actual || data.periodos[0];
      const concejalesIniciales = data.concejales_por_periodo[periodoInicial] || [];
      setPeriodo(periodoInicial);
      setConcejal(concejalesIniciales[0] || '');
      setEstado({ cargando: false, error: null, data });
    });
    return () => {
      cancelado = true;
    };
  }, []);

  const concejalesDelPeriodo = useMemo(() => {
    if (!estado.data || !periodo) return [];
    return estado.data.concejales_por_periodo[periodo] || [];
  }, [estado.data, periodo]);

  useEffect(() => {
    if (!concejalesDelPeriodo.length) {
      setConcejal('');
      return;
    }
    if (!concejalesDelPeriodo.includes(concejal)) {
      setConcejal(concejalesDelPeriodo[0]);
    }
  }, [concejalesDelPeriodo, concejal]);

  if (estado.cargando) {
    return <SkeletonDashboard />;
  }
  if (estado.error) {
    return <MensajeError mensaje={estado.error} />;
  }
  if (!estado.data) {
    return <MensajeError mensaje="Sin datos disponibles" />;
  }

  const kpisConcejal = concejal && periodo
    ? estado.data.kpis_concejal[`${concejal}|${periodo}`]
    : null;
  const kpisPeriodo = periodo ? estado.data.kpis_periodo[periodo] : null;

  return (
    <div className="space-y-6">
      <Filtros
        periodos={estado.data.periodos}
        periodo={periodo}
        onPeriodo={setPeriodo}
        concejales={concejalesDelPeriodo}
        concejal={concejal}
        onConcejal={setConcejal}
      />

      {!concejal ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-600">
          No hay concejales registrados en este periodo.
        </div>
      ) : (
        <>
          <Encabezado concejal={concejal} periodo={periodo} />
          <KpiGrid kpisConcejal={kpisConcejal} kpisPeriodo={kpisPeriodo} />
          {kpisConcejal && Object.keys(kpisConcejal.proyectos_por_estado || {}).length > 0 && (
            <ProyectosPorEstado data={kpisConcejal.proyectos_por_estado} />
          )}
          <NotaMetodologia />
        </>
      )}
    </div>
  );
}

function Filtros({ periodos, periodo, onPeriodo, concejales, concejal, onConcejal }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Periodo</span>
        <select
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          value={periodo}
          onChange={(e) => onPeriodo(e.target.value)}
        >
          {periodos.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Concejal · {concejales.length} en periodo
        </span>
        <select
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          value={concejal}
          onChange={(e) => onConcejal(e.target.value)}
          disabled={!concejales.length}
        >
          {concejales.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Encabezado({ concejal, periodo }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Desempeño</p>
      <h2 className="mt-1 text-2xl font-bold text-slate-900">{concejal}</h2>
      <p className="text-sm text-slate-600">Periodo {periodo}</p>
    </div>
  );
}

function KpiGrid({ kpisConcejal, kpisPeriodo }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {KPI_DEFINITIONS.map((def) => {
        let valor = 0;
        if (def.tipo === 'concejal') {
          valor = kpisConcejal ? (kpisConcejal[def.key] || 0) : 0;
        } else {
          valor = kpisPeriodo ? (kpisPeriodo[def.key] || 0) : 0;
        }
        return <KpiCard key={def.key} {...def} valor={valor} />;
      })}
    </div>
  );
}

function KpiCard({ label, valor, icon, tipo }) {
  const esConcejal = tipo === 'concejal';
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${esConcejal ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center justify-between">
        <span className="text-2xl" aria-hidden="true">{icon}</span>
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${esConcejal ? 'text-brand-700' : 'text-slate-400'}`}>
          {esConcejal ? 'del concejal' : 'del periodo'}
        </span>
      </div>
      <p className="mt-3 text-3xl font-bold text-slate-900">{valor.toLocaleString('es-CO')}</p>
      <p className="text-sm text-slate-600 mt-1">{label}</p>
    </div>
  );
}

function ProyectosPorEstado({ data }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((acc, [, v]) => acc + v, 0);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Proyectos por estado</h3>
      <p className="text-xs text-slate-500 mb-3">Distribución de los proyectos donde el concejal aparece como ponente</p>
      <div className="space-y-2">
        {entries.map(([estado, count]) => {
          const pct = total ? Math.round((count / total) * 100) : 0;
          return (
            <div key={estado}>
              <div className="flex justify-between text-sm">
                <span className="text-slate-700">{estado}</span>
                <span className="font-medium text-slate-900">{count} · {pct}%</span>
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

function NotaMetodologia() {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <strong>Nota:</strong> Acuerdos y proyectos cuentan solo filas con rol Ponente o Proponente.
      Comisiones, citaciones e invitaciones son totales del periodo (no hay vínculo concejal-nivel
      en los datos actuales).
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-24 rounded-lg bg-slate-100" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-32 rounded-lg bg-slate-100" />
        ))}
      </div>
    </div>
  );
}

function MensajeError({ mensaje }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <strong>Error cargando el dashboard:</strong> {mensaje}
    </div>
  );
}
