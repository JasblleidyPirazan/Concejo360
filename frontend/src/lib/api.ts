export type Estado = 'Programada' | 'Realizada' | 'Pendiente' | string;

export interface Sesion {
  numero: string;
  fecha: string | null;
  hora: string;
  temas: string[] | string;
  lugar: string;
  estado: Estado;
  tiene_acta: boolean;
}

export interface ApiOk<T> {
  success: true;
  timestamp: string;
  data: T;
  total?: number;
  page?: number;
  pages?: number;
}

export interface ApiError {
  success: false;
  error: string;
  code: string;
  timestamp: string;
}

export type ApiResponse<T> = ApiOk<T> | ApiError;

export interface StatusResponse {
  success: true;
  timestamp: string;
  scrapers: Record<string, { disponible: boolean; ultima_ejecucion: string | null }>;
  storage: { sheets: boolean; drive: boolean };
}

const BASE = '/.netlify/functions/api';

async function call<T>(qs: Record<string, string | number | undefined>): Promise<ApiResponse<T>> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined) search.set(k, String(v));
  }
  try {
    const res = await fetch(`${BASE}?${search.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const body = (await res.json()) as ApiResponse<T>;
    return body;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Error de red',
      code: 'NETWORK',
      timestamp: new Date().toISOString(),
    };
  }
}

export interface KpisConcejal {
  acuerdos_ponente: number;
  proyectos_ponente: number;
  proyectos_por_estado: Record<string, number>;
}

export interface KpisPeriodo {
  acuerdos_total: number;
  proyectos_total: number;
  citaciones: number;
  invitaciones: number;
  comisiones: number;
  proyectos_por_estado: Record<string, number>;
}

export interface ResumenConcejales {
  periodos: string[];
  periodo_actual: string;
  concejales_por_periodo: Record<string, string[]>;
  kpis_concejal: Record<string, KpisConcejal>;
  kpis_periodo: Record<string, KpisPeriodo>;
  generado_en: string;
}

export const api = {
  sesiones: (limit = 500) => call<Sesion[]>({ action: 'data', tipo: 'sesiones', limit }),
  status: () => call<unknown>({ action: 'status' }),
  health: () => call<unknown>({ action: 'health' }),
  resumenConcejales: () => call<ResumenConcejales>({ action: 'resumen-concejales' }),
};
