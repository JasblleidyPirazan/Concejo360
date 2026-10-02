import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { descargarCsv } from '../lib/csv.ts';

// Valores por defecto: se pueden cambiar desde el enlace sin tocar código, ej.
// /rendicion?nombre=...&bancada=...&titulo=...&color=c8102e&periodo=todos
const DEFAULTS = {
  nombre: 'JOSE LUIS MARIN MORA',
  titulo: 'José Luis Marín Mora',
  bancada: 'PACTO HISTORICO',
  periodo: '2024-2027',
  color: '7010a6',
};

const SECCIONES = [
  {
    clave: 'ponencias',
    etiqueta: 'Ponencias',
    explicacion: 'Proyectos de acuerdo en los que fue designado ponente: estudió el proyecto y presentó el informe para su debate.',
    tipo: 'proyecto',
  },
  {
    clave: 'proyectos_proponente',
    etiqueta: 'Proyectos propuestos',
    explicacion: 'Proyectos de acuerdo que presentó o firmó como proponente.',
    tipo: 'proyecto',
  },
  {
    clave: 'acuerdos',
    etiqueta: 'Acuerdos aprobados',
    explicacion: 'Acuerdos municipales sancionados en los que figura como ponente o proponente.',
    tipo: 'acuerdo',
  },
  {
    clave: 'citaciones',
    etiqueta: 'Citaciones',
    explicacion: 'Debates de control político en los que se cita a funcionarios de la Administración a responder ante el Concejo.',
    tipo: 'proposicion',
    porBancada: true,
  },
  {
    clave: 'invitaciones',
    etiqueta: 'Invitaciones',
    explicacion: 'Sesiones a las que se invita a entidades o personas a informar sobre un tema.',
    tipo: 'proposicion',
    porBancada: true,
  },
  {
    clave: 'comisiones_accidentales',
    etiqueta: 'Comisiones accidentales',
    explicacion: 'Comisiones temporales creadas para hacer seguimiento a un asunto concreto. Se indica si las propuso, las coordina o las integra.',
    tipo: 'comision',
  },
];

const POR_PAGINA = 15;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function leerParametros() {
  const qs = new URLSearchParams(window.location.search);
  const color = (qs.get('color') || DEFAULTS.color).replace('#', '');
  return {
    nombre: qs.get('nombre') || DEFAULTS.nombre,
    titulo: qs.get('titulo') || (qs.get('nombre') ? qs.get('nombre') : DEFAULTS.titulo),
    bancada: qs.get('bancada') ?? DEFAULTS.bancada,
    periodo: qs.get('periodo') || DEFAULTS.periodo,
    color: /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : `#${DEFAULTS.color}`,
    diagnostico: qs.get('diagnostico') === '1',
  };
}

function fechaCorta(iso) {
  if (!iso) return 'Sin fecha';
  const [a, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES[m - 1]} ${a}`;
}

const normalizar = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function textoBuscable(item) {
  return normalizar([item.numero, item.consecutivo, item.titulo, item.descripcion, item.estado, item.comision].join(' '));
}

export default function RendicionCuentas() {
  const [cfg, setCfg] = useState(null);
  const [periodo, setPeriodo] = useState(null);
  const [estado, setEstado] = useState({ cargando: true, error: null, datos: null });
  const [activa, setActiva] = useState('ponencias');
  const [busqueda, setBusqueda] = useState('');
  const [visibles, setVisibles] = useState(POR_PAGINA);

  useEffect(() => {
    const p = leerParametros();
    setCfg(p);
    setPeriodo(p.periodo);
  }, []);

  useEffect(() => {
    if (!cfg || !periodo) return;
    setEstado((s) => ({ ...s, cargando: true, error: null }));
    api.rendicionConcejal(cfg.nombre, cfg.bancada || undefined, periodo).then((res) => {
      if (res.success) setEstado({ cargando: false, error: null, datos: res.data });
      else setEstado({ cargando: false, error: res.error, datos: null });
    });
  }, [cfg, periodo]);

  useEffect(() => {
    setVisibles(POR_PAGINA);
  }, [activa, busqueda, periodo]);

  const seccion = SECCIONES.find((s) => s.clave === activa);
  const items = estado.datos ? estado.datos[activa] || [] : [];
  const filtrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return q ? items.filter((it) => textoBuscable(it).includes(q)) : items;
  }, [items, busqueda]);

  if (!cfg) return null;
  const estiloAcento = { '--acento': cfg.color };

  return (
    <div style={estiloAcento} className="mx-auto max-w-5xl px-4 py-6 md:py-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm text-slate-600">Rendición de cuentas en el Concejo de Medellín</p>
          <h1 className="font-titulo mt-1 text-3xl font-extrabold leading-tight text-slate-900 md:text-4xl">
            {cfg.titulo}
          </h1>
        </div>
        <div role="group" aria-label="Periodo" className="inline-flex rounded-full border border-slate-300 p-1 text-sm">
          {[
            { v: DEFAULTS.periodo, t: `Periodo ${DEFAULTS.periodo}` },
            { v: 'todos', t: 'Toda su trayectoria' },
          ].map((op) => (
            <button
              key={op.v}
              type="button"
              onClick={() => setPeriodo(op.v)}
              aria-pressed={periodo === op.v}
              className={`rounded-full px-4 py-1.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                periodo === op.v ? 'text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
              style={periodo === op.v ? { background: 'var(--acento)' } : undefined}
            >
              {op.t}
            </button>
          ))}
        </div>
      </header>

      {estado.error && (
        <p className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          No se pudieron cargar los datos ({estado.error}). Recarga la página en unos minutos.
        </p>
      )}

      <nav
        aria-label="Tipo de actividad"
        className="mt-8 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-3 lg:grid-cols-6"
      >
        {SECCIONES.map((s) => {
          const n = estado.datos ? (estado.datos[s.clave] || []).length : null;
          const on = s.clave === activa;
          return (
            <button
              key={s.clave}
              type="button"
              onClick={() => setActiva(s.clave)}
              aria-pressed={on}
              className={`relative flex flex-col items-start justify-start px-3 py-4 text-left transition-colors focus:outline-none focus-visible:bg-slate-100 ${
                on ? 'bg-white' : 'hover:bg-slate-50'
              }`}
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-3 top-0 h-1 rounded-b"
                style={{ background: on ? 'var(--acento)' : 'transparent' }}
              />
              <span
                className="font-titulo block text-4xl font-extrabold tabular-nums leading-none"
                style={{ color: on ? 'var(--acento)' : '#1c1b22' }}
              >
                {n === null ? '–' : n}
              </span>
              <span className="mt-2 block text-sm leading-snug text-slate-700">{s.etiqueta}</span>
            </button>
          );
        })}
      </nav>

      <section className="mt-8" aria-live="polite">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-2xl">
            <h2 className="font-titulo text-xl font-bold text-slate-900">{seccion.etiqueta}</h2>
            <p className="mt-1 text-sm text-slate-600">{seccion.explicacion}</p>
            {seccion.porBancada && (
              <p className="mt-3 border-l-4 pl-3 text-sm text-slate-700" style={{ borderColor: 'var(--acento)' }}>
                El SIMI registra estas proposiciones por bancada y no por concejal. Aquí aparecen las presentadas por
                la bancada {estado.datos?.diagnostico?.bancadas_encontradas?.[0] || cfg.bancada}, de la que hace parte.
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <label className="sr-only" htmlFor="buscar">Buscar en {seccion.etiqueta}</label>
            <input
              id="buscar"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por tema o número"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 md:w-64"
            />
            <button
              type="button"
              disabled={!filtrados.length}
              onClick={() => descargarCsv(`${activa}-${normalizar(cfg.titulo).replace(/\s+/g, '-')}`, filtrados.map(aFilaCsv))}
              className="shrink-0 whitespace-nowrap rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2"
            >
              Descargar CSV
            </button>
          </div>
        </div>

        {estado.cargando ? (
          <p className="mt-8 text-sm text-slate-500">Cargando datos del SIMI…</p>
        ) : filtrados.length === 0 ? (
          <p className="mt-8 text-sm text-slate-600">
            {busqueda
              ? `Ningún registro coincide con «${busqueda}». Prueba con otra palabra.`
              : 'No hay registros de este tipo en el periodo seleccionado.'}
          </p>
        ) : (
          <>
            <ol className="mt-6 divide-y divide-slate-200 border-y border-slate-200">
              {filtrados.slice(0, visibles).map((it) => (
                <Fila key={it.numero || it.consecutivo} item={it} tipo={seccion.tipo} />
              ))}
            </ol>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>
                Mostrando {Math.min(visibles, filtrados.length)} de {filtrados.length}
              </span>
              {visibles < filtrados.length && (
                <button
                  type="button"
                  onClick={() => setVisibles((v) => v + POR_PAGINA)}
                  className="rounded-md px-3 py-2 font-medium hover:bg-slate-100 focus:outline-none focus-visible:ring-2"
                  style={{ color: 'var(--acento)' }}
                >
                  Mostrar {Math.min(POR_PAGINA, filtrados.length - visibles)} más
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <footer className="mt-10 text-xs text-slate-500">
        Fuente: Sistema de Información Municipal (SIMI) del Concejo de Medellín, procesado por{' '}
        <a href="https://concejo360.netlify.app" target="_blank" rel="noopener" className="underline">
          Concejo 360
        </a>
        .{estado.datos && ` Datos actualizados el ${fechaCorta(estado.datos.generado_en.slice(0, 10))}.`}
      </footer>

      {cfg.diagnostico && estado.datos && (
        <pre className="mt-6 overflow-x-auto rounded bg-slate-100 p-3 text-xs">
          {JSON.stringify(estado.datos.diagnostico, null, 2)}
        </pre>
      )}
    </div>
  );
}

function Fila({ item, tipo }) {
  const numero = item.numero || item.consecutivo;
  const prefijo = { proyecto: 'Proyecto', acuerdo: 'Acuerdo', proposicion: 'Proposición', comision: 'Comisión' }[tipo];
  return (
    <li className="grid gap-1 py-4 md:grid-cols-[7.5rem_1fr] md:gap-6">
      <time className="text-sm tabular-nums text-slate-500" dateTime={item.fecha || undefined}>
        {fechaCorta(item.fecha)}
      </time>
      <div>
        <p className="text-[15px] leading-relaxed text-slate-900">{item.titulo || 'Sin título registrado'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          <span>
            {prefijo} {numero}
          </span>
          {item.estado && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{item.estado}</span>}
          {item.comision && <span>{item.comision}</span>}
          {(item.roles || []).map((r) => (
            <span key={r} className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--acento)', color: 'var(--acento)' }}>
              {r}
            </span>
          ))}
          {item.atribucion === 'concejal' && (
            <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--acento)', color: 'var(--acento)' }}>
              Firmada por el concejal
            </span>
          )}
          {item.link && (
            <a href={item.link} target="_blank" rel="noopener" className="underline" style={{ color: 'var(--acento)' }}>
              Ver texto del acuerdo
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function aFilaCsv(it) {
  return {
    numero: it.numero || it.consecutivo,
    fecha: it.fecha || '',
    titulo: it.titulo,
    estado: it.estado || '',
    comision: it.comision || '',
    roles: (it.roles || []).join(' | '),
    atribucion: it.atribucion || '',
    enlace: it.link || '',
  };
}
