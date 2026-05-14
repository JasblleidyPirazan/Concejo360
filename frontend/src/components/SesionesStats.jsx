import { useEffect, useMemo, useState } from 'react';
import MonthlyChart from './MonthlyChart.jsx';
import {
  porEstado,
  porMes,
  topLugares,
  porcentajeConActa,
  ultimas,
  formatFecha,
} from '../lib/stats.ts';

const TONE_BORDER = {
  default: 'border-slate-200',
  success: 'border-green-200',
  warning: 'border-amber-200',
  info: 'border-blue-200',
};

function StatCard({ label, value, hint, tone = 'default' }) {
  return (
    <div className={`rounded-lg border bg-white p-5 shadow-sm ${TONE_BORDER[tone]}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

function EstadoBadge({ estado }) {
  const v = (estado || '').trim().toLowerCase();
  let cls = 'bg-slate-100 text-slate-700 ring-slate-200';
  let label = estado || 'Sin estado';
  if (v.startsWith('progr')) {
    cls = 'bg-blue-50 text-blue-700 ring-blue-200';
    label = 'Programada';
  } else if (v.startsWith('real')) {
    cls = 'bg-green-50 text-green-700 ring-green-200';
    label = 'Realizada';
  } else if (v.startsWith('pend')) {
    cls = 'bg-amber-50 text-amber-700 ring-amber-200';
    label = 'Pendiente';
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}`}>
      {label}
    </span>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-slate-200 bg-white p-5 h-28" />
        ))}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5 h-72" />
    </div>
  );
}

export default function SesionesStats() {
  const [state, setState] = useState({ status: 'loading', rows: [], error: null, ts: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/api?action=data&tipo=sesiones&limit=500', {
          headers: { Accept: 'application/json' },
        });
        const body = await res.json();
        if (cancelled) return;
        if (!body || body.success !== true) {
          setState({
            status: 'error',
            rows: [],
            error: body?.error || `HTTP ${res.status}`,
            ts: null,
          });
          return;
        }
        const rows = Array.isArray(body.data) ? body.data : [];
        setState({ status: 'ok', rows, error: null, ts: body.timestamp || null });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          rows: [],
          error: err?.message || 'Error de red',
          ts: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const view = useMemo(() => {
    const rows = state.rows;
    const total = rows.length;
    const estados = porEstado(rows);
    const conActa = porcentajeConActa(rows);
    const lugares = topLugares(rows, 3);
    const mensual = porMes(rows, 12);
    const recientes = ultimas(rows, 5);
    const pct = (n) => (total === 0 ? '0%' : `${Math.round((n / total) * 100)}%`);
    return { total, estados, conActa, lugares, mensual, recientes, pct };
  }, [state.rows]);

  if (state.status === 'loading') return <Skeleton />;

  if (state.status === 'error') {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-medium">No se pudieron cargar los datos en este momento.</p>
        <p className="mt-1 text-red-700">{state.error}</p>
        <p className="mt-2 text-red-600 text-xs">
          Verifica que la variable de entorno <code>GAS_URL</code> esté configurada en Netlify.
        </p>
      </div>
    );
  }

  if (view.total === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Aún no hay sesiones registradas. Cuando el scraper corra por primera vez, esta vista
        mostrará las estadísticas.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total de sesiones" value={view.total} tone="info" hint="Registros en el sistema" />
        <StatCard
          label="Realizadas"
          value={view.pct(view.estados.Realizada)}
          hint={`${view.estados.Realizada} de ${view.total}`}
          tone="success"
        />
        <StatCard
          label="Programadas"
          value={view.pct(view.estados.Programada)}
          hint={`${view.estados.Programada} de ${view.total}`}
          tone="info"
        />
        <StatCard
          label="Con acta publicada"
          value={`${view.conActa}%`}
          hint="Sesiones con PDF disponible"
          tone="warning"
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h3 className="font-semibold text-slate-900">Sesiones por mes</h3>
            <p className="text-sm text-slate-600">Últimos 12 meses, segmentado por estado.</p>
          </div>
        </div>
        <MonthlyChart data={view.mensual} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2">
          <h3 className="font-semibold text-slate-900 mb-3">Últimas sesiones</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Fecha</th>
                  <th className="py-2 pr-3 font-medium">Lugar</th>
                  <th className="py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {view.recientes.map((s, i) => (
                  <tr key={`${s.numero}-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3 font-medium text-slate-900">{s.numero}</td>
                    <td className="py-2 pr-3 text-slate-700">{formatFecha(s.fecha)}</td>
                    <td className="py-2 pr-3 text-slate-700">{s.lugar || '—'}</td>
                    <td className="py-2">
                      <EstadoBadge estado={s.estado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-900 mb-3">Lugares más frecuentes</h3>
          {view.lugares.length === 0 ? (
            <p className="text-sm text-slate-600">Sin datos.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {view.lugares.map((l) => (
                <li key={l.lugar} className="flex items-center justify-between">
                  <span className="text-slate-700 truncate pr-2">{l.lugar}</span>
                  <span className="tabular-nums text-slate-500">{l.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
