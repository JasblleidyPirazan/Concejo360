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
  pagination?: { page: number; limit: number; total: number; pages: number };
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

export interface PanoramaKpis {
  sesiones: number;
  proyectos_radicados: number;
  acuerdos_sancionados: number;
  tasa_conversion: number;
  citaciones: number;
  comisiones_accidentales: number;
}

export interface PanoramaConcejo {
  periodo: string;
  anio: number | null;
  periodo_anterior: string | null;
  corte_dias: number;
  kpis: PanoramaKpis;
  kpis_anterior: PanoramaKpis | null;
  deltas: Record<keyof Omit<PanoramaKpis, 'tasa_conversion'>, number> | null;
  sesiones_por_mes: Array<{ mes: string; ordinarias: number; extraordinarias: number; total: number }>;
  embudo: Array<{ etapa: string; total: number }>;
  heatmap_comision_mes: Array<{ comision: string; mes: string; total: number }>;
  top_temas: Array<{ tema: string; count: number }>;
  insight: string;
  generado_en: string;
}

export type TipoDato =
  | 'sesiones'
  | 'proyectos'
  | 'acuerdos'
  | 'comisiones'
  | 'invitaciones'
  | 'citaciones';

export type FilaDato = Record<string, string | number | boolean | null>;

export const api = {
  sesiones: (limit = 500) => call<Sesion[]>({ action: 'data', tipo: 'sesiones', limit }),
  datos: (tipo: TipoDato, limit = 10000) => call<FilaDato[]>({ action: 'data', tipo, limit }),
  status: () => call<unknown>({ action: 'status' }),
  health: () => call<unknown>({ action: 'health' }),
  resumenConcejales: () => call<ResumenConcejales>({ action: 'resumen-concejales' }),
  panoramaConcejo: (periodo?: string, anio?: number) =>
    call<PanoramaConcejo>({ action: 'panorama-concejo', periodo, anio }),
};
