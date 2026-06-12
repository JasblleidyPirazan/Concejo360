import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatFecha } from '../lib/stats.ts';
import { descargarCsv } from '../lib/csv.ts';

const FUENTES = [
  {
    id: 'proyectos',
    label: 'Proyectos de acuerdo',
    icon: '📋',
    buscables: ['numero', 'titulo', 'proponentes', 'estado', 'comision'],
    titulo: (r) => r.titulo || `Proyecto ${r.numero}`,
    meta: (r) => [r.numero, r.comision, r.proponentes].filter(Boolean).join(' · '),
  },
  {
    id: 'acuerdos',
    label: 'Acuerdos municipales',
    icon: '⚖️',
    buscables: ['no_acuerdo', 'no_proyecto_acuerdo', 'titulo', 'estado'],
    titulo: (r) => r.titulo || `Acuerdo ${r.no_acuerdo}`,
    meta: (r) => [r.no_acuerdo && `Acuerdo ${r.no_acuerdo}`, r.no_proyecto_acuerdo && `Proyecto ${r.no_proyecto_acuerdo}`].filter(Boolean).join(' · '),
  },
  {
    id: 'citaciones',
    label: 'Citaciones a control político',
    icon: '📣',
    buscables: ['consecutivo', 'titulo', 'descripcion', 'integrantes', 'estado'],
    titulo: (r) => r.titulo || r.descripcion || `Citación ${r.consecutivo}`,
    meta: (r) => recortar(r.descripcion, 160),
  },
  {
    id: 'invitaciones',
    label: 'Invitaciones',
    icon: '✉️',
    buscables: ['consecutivo', 'titulo', 'descripcion', 'estado'],
    titulo: (r) => r.titulo || r.descripcion || `Invitación ${r.consecutivo}`,
    meta: (r) => recortar(r.descripcion, 160),
  },
  {
    id: 'comisiones',
    label: 'Comisiones accidentales',
    icon: '👥',
    buscables: ['consecutivo', 'titulo', 'descripcion', 'coordinador', 'estado'],
    titulo: (r) => r.titulo || `Comisión ${r.consecutivo}`,
    meta: (r) => [r.coordinador && `Coordina: ${r.coordinador}`, recortar(r.descripcion, 120)].filter(Boolean).join(' · '),
  },
  {
    id: 'sesiones',
    label: 'Sesiones',
    icon: '🏛️',
    buscables: ['numero', 'temas', 'detalle', 'lugar', 'estado'],
    titulo: (r) => textoTemas(r.temas) || r.detalle || `Sesión ${r.numero}`,
    meta: (r) => [r.numero && `Sesión ${r.numero}`, r.lugar].filter(Boolean).join(' · '),
  },
];

const VISIBLES_INICIAL = 10;

function recortar(texto, n) {
  if (!texto) return '';
  const s = String(texto);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function textoTemas(temas) {
  if (Array.isArray(temas)) return temas.join(' · ');
  return temas ? String(temas) : '';
}

const normalizar = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export default function BuscadorTransversal() {
  const [consulta, setConsulta] = useState('');
  const [consultaActiva, setConsultaActiva] = useState('');
  const [fuentesActivas, setFuentesActivas] = useState(() => new Set(FUENTES.map((f) => f.id)));
  const [datasets, setDatasets] = useState({});
  const [errores, setErrores] = useState({});
  const debounceRef = useRef(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) {
      setConsulta(q);
      setConsultaActiva(q);
    }

    let cancelado = false;
    for (const fuente of FUENTES) {
      api.datos(fuente.id).then((res) => {
        if (cancelado) return;
        if (res.success) {
          setDatasets((prev) => ({ ...prev, [fuente.id]: Array.isArray(res.data) ? res.data : [] }));
        } else {
          setErrores((prev) => ({ ...prev, [fuente.id]: res.error }));
        }
      });
    }
    return () => {
      cancelado = true;
    };
  }, []);

  const onConsulta = (valor) => {
    setConsulta(valor);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setConsultaActiva(valor), 250);
  };

  const cargadas = Object.keys(datasets).length;
  const totalRegistros = useMemo(
    () => Object.values(datasets).reduce((acc, rows) => acc + rows.length, 0),
    [datasets]
  );

  const palabras = useMemo(
    () => normalizar(consultaActiva).split(/\s+/).filter((p) => p.length >= 2),
    [consultaActiva]
  );

  const resultados = useMemo(() => {
    if (!palabras.length) return null;
    return FUENTES.filter((f) => fuentesActivas.has(f.id)).map((fuente) => {
      const rows = datasets[fuente.id] || [];
      const matches = rows.filter((row) => {
        const blob = normalizar(fuente.buscables.map((c) => (c === 'temas' ? textoTemas(row[c]) : row[c])).join(' '));
        return palabras.every((p) => blob.includes(p));
      });
      matches.sort((a, b) => {
        const fa = a.fecha ? new Date(a.fecha).getTime() : 0;
        const fb = b.fecha ? new Date(b.fecha).getTime() : 0;
        return fb - fa;
      });
      return { fuente, matches };
    });
  }, [palabras, fuentesActivas, datasets]);

  const totalResultados = resultados ? resultados.reduce((acc, g) => acc + g.matches.length, 0) : 0;

  const exportar = () => {
    if (!resultados) return;
    const filas = resultados.flatMap(({ fuente, matches }) =>
      matches.map((r) => ({
        tipo: fuente.label,
        numero: r.numero || r.no_acuerdo || r.consecutivo || '',
        fecha: r.fecha ? formatFecha(r.fecha) : '',
        titulo: fuente.titulo(r),
        estado: r.estado || '',
        detalle: fuente.meta(r),
      }))
    );
    descargarCsv(`busqueda-${normalizar(consultaActiva).replace(/\s+/g, '-')}`, filas);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <label className="block">
          <span className="sr-only">Buscar en todos los datos</span>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">🔍</span>
            <input
              type="search"
              value={consulta}
              onChange={(e) => onConsulta(e.target.value)}
              placeholder='Ej: "Hidroituango", "POT", "metro", "seguridad alimentaria"…'
              autoFocus
              className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-4 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {FUENTES.map((f) => {
            const activa = fuentesActivas.has(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() =>
                  setFuentesActivas((prev) => {
                    const next = new Set(prev);
                    if (next.has(f.id)) next.delete(f.id);
                    else next.add(f.id);
                    return next;
                  })
                }
                aria-pressed={activa}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activa
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                <span aria-hidden="true">{f.icon}</span>
                {f.label}
                {datasets[f.id] && (
                  <span className={`tabular-nums ${activa ? 'text-brand-100' : 'text-slate-400'}`}>
                    {datasets[f.id].length.toLocaleString('es-CO')}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-slate-500">
          {cargadas < FUENTES.length
            ? `Cargando datos… ${cargadas}/${FUENTES.length} fuentes listas`
            : `${totalRegistros.toLocaleString('es-CO')} registros indexados. La búsqueda ignora tildes y mayúsculas.`}
        </p>
      </div>

      {Object.entries(errores).map(([id, err]) => (
        <div key={id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          No se pudo cargar <strong>{id}</strong>: {err}
        </div>
      ))}

      {!resultados ? (
        <EstadoVacio />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              <strong className="text-slate-900">{totalResultados.toLocaleString('es-CO')}</strong> resultados para{' '}
              <em>"{consultaActiva}"</em>
            </p>
            {totalResultados > 0 && (
              <button
                type="button"
                onClick={exportar}
                className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-100"
              >
                ⬇ Descargar resultados (CSV)
              </button>
            )}
          </div>

          {totalResultados === 0 && cargadas === FUENTES.length && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-8 text-center text-slate-600">
              Nada encontrado. Probá con menos palabras o sinónimos (ej. "vivienda" en vez de "déficit habitacional").
            </div>
          )}

          {resultados.map(({ fuente, matches }) =>
            matches.length > 0 ? (
              <GrupoResultados key={fuente.id} fuente={fuente} matches={matches} palabras={palabras} />
            ) : null
          )}
        </>
      )}
    </div>
  );
}

function GrupoResultados({ fuente, matches, palabras }) {
  const [visibles, setVisibles] = useState(VISIBLES_INICIAL);
  useEffect(() => setVisibles(VISIBLES_INICIAL), [matches]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <span aria-hidden="true">{fuente.icon}</span>
        <h2 className="font-semibold text-slate-900">{fuente.label}</h2>
        <span className="ml-auto rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-brand-700">
          {matches.length.toLocaleString('es-CO')}
        </span>
      </header>
      <ul className="divide-y divide-slate-100">
        {matches.slice(0, visibles).map((row, idx) => (
          <li key={idx} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-slate-800">
                <Resaltado texto={String(fuente.titulo(row))} palabras={palabras} />
              </p>
              {row.estado && <EstadoBadge estado={String(row.estado)} />}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {[row.fecha ? formatFecha(row.fecha) : null, fuente.meta(row)].filter(Boolean).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
      {matches.length > visibles && (
        <button
          type="button"
          onClick={() => setVisibles((v) => v + 25)}
          className="w-full border-t border-slate-100 py-2.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
        >
          Mostrar más ({(matches.length - visibles).toLocaleString('es-CO')} restantes)
        </button>
      )}
    </section>
  );
}

function Resaltado({ texto, palabras }) {
  if (!palabras.length) return texto;
  const partes = [];
  const normalizado = normalizar(texto);
  let cursor = 0;
  // Busca cada palabra sobre el texto normalizado pero corta el original (misma longitud char a char)
  while (cursor < texto.length) {
    let mejorInicio = -1;
    let mejorLargo = 0;
    for (const p of palabras) {
      const i = normalizado.indexOf(p, cursor);
      if (i !== -1 && (mejorInicio === -1 || i < mejorInicio)) {
        mejorInicio = i;
        mejorLargo = p.length;
      }
    }
    if (mejorInicio === -1) {
      partes.push(texto.slice(cursor));
      break;
    }
    if (mejorInicio > cursor) partes.push(texto.slice(cursor, mejorInicio));
    partes.push(
      <mark key={mejorInicio} className="rounded bg-accent-400/60 px-0.5">
        {texto.slice(mejorInicio, mejorInicio + mejorLargo)}
      </mark>
    );
    cursor = mejorInicio + mejorLargo;
  }
  return partes;
}

function EstadoBadge({ estado }) {
  const v = normalizar(estado);
  let clases = 'bg-slate-100 text-slate-600';
  if (/realizad|sancionad|aprobad/.test(v)) clases = 'bg-emerald-50 text-emerald-700';
  else if (/programad|estudio|tramite|debate|ponen/.test(v)) clases = 'bg-brand-50 text-brand-700';
  else if (/pendiente/.test(v)) clases = 'bg-accent-400/30 text-amber-800';
  else if (/archivad|retirad|cancelad|hundid/.test(v)) clases = 'bg-rose-50 text-rose-700';
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${clases}`}>
      {estado}
    </span>
  );
}

function EstadoVacio() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-center">
      <p className="text-3xl mb-3" aria-hidden="true">🔍</p>
      <p className="text-slate-700 font-medium">¿Qué se ha hecho sobre un tema?</p>
      <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
        Escribí un tema y buscamos en proyectos, acuerdos, citaciones, invitaciones, comisiones
        accidentales y sesiones al mismo tiempo.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {['Hidroituango', 'POT', 'metro', 'presupuesto participativo', 'mujeres'].map((s) => (
          <a
            key={s}
            href={`/buscador?q=${encodeURIComponent(s)}`}
            className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
          >
            {s}
          </a>
        ))}
      </div>
    </div>
  );
}
