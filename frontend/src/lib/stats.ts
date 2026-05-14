import type { Sesion } from './api';

const ESTADOS = ['Programada', 'Realizada', 'Pendiente'] as const;
export type EstadoCanonico = (typeof ESTADOS)[number];

const toDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const canonicalEstado = (raw: string): EstadoCanonico | 'Otro' => {
  const v = (raw || '').trim().toLowerCase();
  if (v.startsWith('progr')) return 'Programada';
  if (v.startsWith('real')) return 'Realizada';
  if (v.startsWith('pend')) return 'Pendiente';
  return 'Otro';
};

export function porEstado(rows: Sesion[]): Record<EstadoCanonico | 'Otro', number> {
  const out: Record<string, number> = { Programada: 0, Realizada: 0, Pendiente: 0, Otro: 0 };
  for (const r of rows) out[canonicalEstado(r.estado)]++;
  return out as Record<EstadoCanonico | 'Otro', number>;
}

export interface MesAgregado {
  mes: string;
  total: number;
  Programada: number;
  Realizada: number;
  Pendiente: number;
}

export function porMes(rows: Sesion[], n = 12): MesAgregado[] {
  const map = new Map<string, MesAgregado>();
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, { mes: key, total: 0, Programada: 0, Realizada: 0, Pendiente: 0 });
  }
  for (const r of rows) {
    const d = toDate(r.fecha);
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const bucket = map.get(key);
    if (!bucket) continue;
    bucket.total++;
    const e = canonicalEstado(r.estado);
    if (e !== 'Otro') bucket[e]++;
  }
  return [...map.values()];
}

export function topLugares(rows: Sesion[], n = 3): Array<{ lugar: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const l = (r.lugar || '').trim() || 'Sin especificar';
    counts.set(l, (counts.get(l) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([lugar, count]) => ({ lugar, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

export function porcentajeConActa(rows: Sesion[]): number {
  if (rows.length === 0) return 0;
  const con = rows.filter((r) => r.tiene_acta === true).length;
  return Math.round((con / rows.length) * 100);
}

export function ultimas(rows: Sesion[], n = 5): Sesion[] {
  return [...rows]
    .filter((r) => toDate(r.fecha) !== null)
    .sort((a, b) => (toDate(b.fecha)!.getTime() - toDate(a.fecha)!.getTime()))
    .slice(0, n);
}

export function formatFecha(value: string | null): string {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatMes(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
}
