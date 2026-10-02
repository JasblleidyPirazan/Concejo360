import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { descargarCsv } from '../lib/csv.ts';
import { aMayusculaInicial } from '../lib/texto.ts';
import '../styles/rendicion.css';

// Valores por defecto: se pueden cambiar desde el enlace sin tocar código, ej.
// /rendicion?nombre=...&bancada=...&titulo=...&periodo=todos
const DEFAULTS = {
  nombre: 'JOSE LUIS MARIN MORA',
  titulo: 'José Luis Marín Mora',
  bancada: 'PACTO HISTORICO',
  periodo: '2024-2027',
};

const SECCIONES = [
  {
    clave: 'ponencias',
    etiqueta: 'Ponencias',
    sustantivo: 'ponencias',
    explicacion: 'Proyectos de acuerdo en los que fue ponente.',
    tipo: 'proyecto',
  },
  {
    clave: 'proyectos_proponente',
    etiqueta: 'Proyectos propuestos',
    sustantivo: 'proyectos',
    explicacion: 'Proyectos de acuerdo que radicó como autor.',
    tipo: 'proyecto',
  },
  {
    clave: 'acuerdos',
    etiqueta: 'Acuerdos aprobados',
    sustantivo: 'acuerdos',
    explicacion: 'Proyectos de acuerdo en los que participó y que el Concejo aprobó.',
    tipo: 'acuerdo',
  },
  {
    clave: 'citaciones',
    etiqueta: 'Citaciones',
    sustantivo: 'citaciones',
    explicacion: 'Debates de control político en los que citó a funcionarios de la Administración.',
    tipo: 'proposicion',
    porBancada: true,
  },
  {
    clave: 'invitaciones',
    etiqueta: 'Invitaciones',
    sustantivo: 'invitaciones',
    explicacion: 'Sesiones a las que invitó a entidades o personas a exponer ante el Concejo.',
    tipo: 'proposicion',
    porBancada: true,
  },
  {
    clave: 'comisiones_accidentales',
    etiqueta: 'Comisiones accidentales',
    sustantivo: 'comisiones',
    explicacion:
      'Comisiones temporales creadas para hacer seguimiento a un asunto concreto. Se indica si las propuso, las coordina o las integra.',
    tipo: 'comision',
  },
];

const ORDEN_ROLES = ['Proponente', 'Coordinador', 'Integrante', 'Ponente'];
const POR_PAGINA = 10;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function leerParametros() {
  const qs = new URLSearchParams(window.location.search);
  return {
    nombre: qs.get('nombre') || DEFAULTS.nombre,
    titulo: qs.get('titulo') || qs.get('nombre') || DEFAULTS.titulo,
    bancada: qs.get('bancada') ?? DEFAULTS.bancada,
    periodo: qs.get('periodo') || DEFAULTS.periodo,
    diagnostico: qs.get('diagnostico') === '1',
  };
}

function fechaCorta(iso) {
  if (!iso) return 'Sin fecha';
  const [a, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES[m - 1]} ${a}`;
}

const normalizar = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const capitalizar = (s) => {
  const t = String(s || '').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function prepararItem(item) {
  return {
    ...item,
    titulo: aMayusculaInicial(item.titulo),
    estado: aMayusculaInicial(item.estado),
    comision: aMayusculaInicial(item.comision),
    roles: (item.roles || []).map(capitalizar),
  };
}

function prepararDatos(datos) {
  const out = { ...datos };
  for (const s of SECCIONES) out[s.clave] = (datos[s.clave] || []).map(prepararItem);
  return out;
}

function textoBuscable(item) {
  return normalizar([item.numero, item.consecutivo, item.titulo, item.descripcion, item.estado, item.comision].join(' '));
}

function rolesDisponibles(items) {
  const presentes = new Set(items.flatMap((it) => it.roles || []));
  const ordenados = ORDEN_ROLES.filter((r) => presentes.has(r));
  return ordenados.concat([...presentes].filter((r) => !ORDEN_ROLES.includes(r)).sort());
}

// Comisiones usan las etiquetas del sistema de diseño; el resto conserva el texto de SIMI.
function clasificarEstado(estado, tipo) {
  const n = normalizar(estado);
  if (!n) return null;
  if (tipo === 'comision') {
    if (n.includes('archiv')) return { variante: 'archivada', texto: 'Archivada', icono: 'archivo' };
    if (n.includes('program')) return { variante: 'programada', texto: 'Reunión programada', icono: 'calendario' };
    return { variante: 'activa', texto: 'Activa', icono: 'check' };
  }
  if (/archiv|retir|negad|hundid|desist|devuelt/.test(n)) return { variante: 'archivada', texto: estado, icono: 'archivo' };
  if (/sancion|aprob/.test(n)) return { variante: 'activa', texto: estado, icono: 'check' };
  if (n.includes('program')) return { variante: 'programada', texto: estado, icono: 'calendario' };
  return { variante: 'programada', texto: estado, icono: 'punto' };
}

export default function RendicionCuentas() {
  const [cfg, setCfg] = useState(null);
  const [periodo, setPeriodo] = useState(null);
  const [estado, setEstado] = useState({ cargando: true, error: null, datos: null });
  const [activa, setActiva] = useState('ponencias');
  const [busqueda, setBusqueda] = useState('');
  const [rol, setRol] = useState('Todos');
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
      if (res.success) setEstado({ cargando: false, error: null, datos: prepararDatos(res.data) });
      else setEstado({ cargando: false, error: res.error, datos: null });
    });
  }, [cfg, periodo]);

  useEffect(() => {
    setRol('Todos');
  }, [activa]);

  useEffect(() => {
    setVisibles(POR_PAGINA);
  }, [activa, busqueda, rol, periodo]);

  const seccion = SECCIONES.find((s) => s.clave === activa);
  const items = estado.datos ? estado.datos[activa] || [] : [];
  const roles = useMemo(() => rolesDisponibles(items), [items]);
  const filtrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return items.filter(
      (it) => (rol === 'Todos' || (it.roles || []).includes(rol)) && (!q || textoBuscable(it).includes(q)),
    );
  }, [items, busqueda, rol]);

  if (!cfg) return null;

  const hayFiltros = busqueda.trim() !== '' || rol !== 'Todos';
  const limpiarFiltros = () => {
    setBusqueda('');
    setRol('Todos');
  };

  return (
    <div className="rc">
      <header className="rc-banda">
        <div className="rc-contenedor rc-banda-interior">
          <div>
            <p className="rc-etiqueta">Rendición de cuentas · Concejo de Medellín</p>
            <h1 className="rc-nombre">{cfg.titulo}</h1>
          </div>
          <div role="group" aria-label="Periodo de los datos" className="rc-periodo">
            {[
              { v: DEFAULTS.periodo, t: `Periodo ${DEFAULTS.periodo}` },
              { v: 'todos', t: 'Toda su trayectoria' },
            ].map((op) => (
              <button key={op.v} type="button" onClick={() => setPeriodo(op.v)} aria-pressed={periodo === op.v}>
                {op.t}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="rc-contenedor">
        <nav aria-label="Indicadores de gestión" className="rc-kpis">
          {SECCIONES.map((s) => {
            const n = estado.datos ? (estado.datos[s.clave] || []).length : null;
            return (
              <button
                key={s.clave}
                type="button"
                className="rc-kpi"
                onClick={() => setActiva(s.clave)}
                aria-pressed={s.clave === activa}
              >
                <span className="rc-kpi-cifra">{n === null ? '–' : n.toLocaleString('es-CO')}</span>
                <span className="rc-kpi-rotulo">{s.etiqueta}</span>
              </button>
            );
          })}
        </nav>

        <section className="rc-panel" aria-labelledby="titulo-seccion">
          <div className="rc-cabecera">
            <div>
              <h2 id="titulo-seccion" className="rc-titulo">
                {seccion.etiqueta}
              </h2>
              <div className="rc-filete" aria-hidden="true" />
              <p className="rc-descripcion">{seccion.explicacion}</p>
            </div>
            <div className="rc-herramientas">
              <div className="rc-buscador">
                <label htmlFor="buscar" className="rc-etiqueta">
                  Buscar
                </label>
                <div className="rc-buscador-campo">
                  <Icono nombre="lupa" tamano={18} />
                  <input
                    id="buscar"
                    type="search"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Tema o número, ej. CA-201"
                  />
                </div>
              </div>
              <button
                type="button"
                className="rc-boton"
                disabled={!filtrados.length}
                onClick={() =>
                  descargarCsv(`${activa}-${normalizar(cfg.titulo).replace(/\s+/g, '-')}`, filtrados.map(aFilaCsv))
                }
              >
                <Icono nombre="descarga" tamano={18} />
                Descargar CSV
              </button>
            </div>
          </div>

          {seccion.porBancada && (
            <div className="rc-nota">
              <Icono nombre="info" tamano={20} />
              <p>
                El SIMI registra estas proposiciones por bancada y no por concejal. Aquí aparecen las presentadas por la
                bancada {estado.datos?.diagnostico?.bancadas_encontradas?.[0] || cfg.bancada}, de la que hace parte.
              </p>
            </div>
          )}

          <div className="rc-filtros">
            {roles.length > 0 ? (
              <div role="group" aria-label="Filtrar por rol" className="rc-chips">
                <span className="rc-etiqueta">Rol</span>
                {['Todos', ...roles].map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="rc-chip"
                    onClick={() => setRol(r)}
                    aria-pressed={rol === r}
                  >
                    {rol === r && <Icono nombre="check" tamano={16} />}
                    {r}
                  </button>
                ))}
              </div>
            ) : (
              <span />
            )}
            <p className="rc-contador" aria-live="polite">
              {estado.cargando
                ? ''
                : `Mostrando ${Math.min(visibles, filtrados.length).toLocaleString('es-CO')} de ${filtrados.length.toLocaleString('es-CO')} ${seccion.sustantivo}`}
            </p>
          </div>

          {estado.error ? (
            <p className="rc-error" role="alert">
              No se pudieron cargar los datos ({estado.error}). Recarga la página en unos minutos.
            </p>
          ) : estado.cargando ? (
            <div className="rc-nota">
              <Icono nombre="info" tamano={20} />
              <p>Cargando datos del SIMI…</p>
            </div>
          ) : filtrados.length === 0 ? (
            <div className="rc-vacio">
              <p>
                {hayFiltros
                  ? `No hay ${seccion.sustantivo} que coincidan con tu búsqueda. Prueba con otro tema o número.`
                  : 'No hay registros de este tipo en el periodo seleccionado.'}
              </p>
              {hayFiltros && (
                <button type="button" className="rc-boton" onClick={limpiarFiltros}>
                  Limpiar filtros
                </button>
              )}
            </div>
          ) : (
            <ul className="rc-lista">
              {filtrados.slice(0, visibles).map((it) => (
                <Fila key={it.numero || it.consecutivo} item={it} tipo={seccion.tipo} />
              ))}
            </ul>
          )}

          <div className="rc-pie">
            <p>
              Fuente: Concejo de Medellín, Sistema de Información Municipal (SIMI), procesado por{' '}
              <a href="https://concejo360.netlify.app" target="_blank" rel="noopener" className="rc-enlace">
                Concejo 360
              </a>
              .{estado.datos && ` Fecha de corte: ${fechaCorta(estado.datos.generado_en.slice(0, 10))}.`}
            </p>
            {visibles < filtrados.length && (
              <button type="button" className="rc-mas" onClick={() => setVisibles((v) => v + POR_PAGINA)}>
                Ver {Math.min(POR_PAGINA, filtrados.length - visibles)} más
              </button>
            )}
          </div>
        </section>

        {cfg.diagnostico && estado.datos && (
          <pre className="rc-diagnostico">{JSON.stringify(estado.datos.diagnostico, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

function Fila({ item, tipo }) {
  const codigo = item.numero || item.consecutivo;
  const est = clasificarEstado(item.estado, tipo);
  const roles = [...(item.roles || [])];
  if (item.atribucion === 'concejal') roles.push('Firmada por el concejal');

  return (
    <li className="rc-fila">
      <time dateTime={item.fecha || undefined}>{fechaCorta(item.fecha)}</time>
      <div className="rc-fila-contenido">
        <h3>{item.titulo || 'Sin título registrado'}</h3>
        <div className="rc-meta">
          {codigo && <span className="rc-codigo">{codigo}</span>}
          {est && (
            <span className={`rc-pildora rc-estado-${est.variante}`}>
              <Icono nombre={est.icono} tamano={14} />
              {est.texto}
            </span>
          )}
          {item.comision && <span>{item.comision}</span>}
          {roles.length > 0 && <span className="rc-divisor" aria-hidden="true" />}
          {roles.map((r) => (
            <span key={r} className="rc-pildora rc-rol">
              {r}
            </span>
          ))}
          {item.link && (
            <a href={item.link} target="_blank" rel="noopener" className="rc-enlace">
              Ver texto del acuerdo
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

const TRAZOS = {
  lupa: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  descarga: <><path d="M12 4v11" /><path d="M7 10.5l5 5 5-5" /><path d="M5 19.5h14" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.5v.5" /></>,
  archivo: <><rect x="3.5" y="4.5" width="17" height="4" rx="1" /><path d="M5 8.5v10a1 1 0 001 1h12a1 1 0 001-1v-10" /><path d="M10 12.5h4" /></>,
  calendario: <><rect x="4" y="5.5" width="16" height="14.5" rx="1.5" /><path d="M4 10h16" /><path d="M8.5 3.5v4" /><path d="M15.5 3.5v4" /></>,
  punto: <circle cx="12" cy="12" r="4" fill="currentColor" />,
};

function Icono({ nombre, tamano }) {
  return (
    <svg className="rc-icono" width={tamano} height={tamano} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {TRAZOS[nombre]}
    </svg>
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
