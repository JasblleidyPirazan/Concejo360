/**
 * Endpoint de rendición de cuentas de UN concejal.
 *
 * GET ?action=rendicion-concejal&nombre=JOSE LUIS MARIN MORA&bancada=PACTO HISTORICO&periodo=2024-2027
 *
 * El nombre se compara por tokens (todas las palabras deben aparecer, sin
 * tildes ni mayúsculas) porque SIMI no escribe igual el nombre en todas las
 * fuentes ("MARIN MORA JOSE LUIS", "José Luis Marín Mora", etc.).
 *
 * Citaciones e invitaciones: SIMI solo registra la BANCADA proponente, no el
 * concejal. Por eso se atribuyen por bancada y cada fila lleva
 * `atribucion: 'bancada'`. Si algún día SIMI pone nombres en esa tabla,
 * el match por nombre los marca como `atribucion: 'concejal'`.
 */

const RendicionConcejal = {
  obtener(params) {
    const tokens = this._tokens(params.nombre);
    if (tokens.length === 0) throw new Error('Falta el parámetro "nombre"');
    const tokensBancada = this._tokens(params.bancada);
    const periodo = params.periodo || PERIODOS[0].label;

    const ctx = { tokens, tokensBancada, periodo, nombres: new Set(), bancadas: new Set() };

    const proyectos = this._proyectos(ctx);
    const acuerdos = this._acuerdos(ctx);
    const citaciones = this._proposiciones(ctx, 'citaciones_maestro', 'citaciones_detalleBa');
    const invitaciones = this._proposiciones(ctx, 'invitaciones_maestro', 'invitaciones_detalleBa');
    const comisiones = this._comisiones(ctx);

    return {
      nombre_consultado: params.nombre,
      bancada_consultada: params.bancada || null,
      periodo,
      kpis: {
        ponencias: proyectos.ponencias.length,
        proyectos_proponente: proyectos.proponente.length,
        acuerdos: acuerdos.length,
        citaciones: citaciones.length,
        invitaciones: invitaciones.length,
        comisiones_accidentales: comisiones.length,
        comisiones_coordinadas: comisiones.filter(c => c.roles.indexOf('Coordinador') >= 0).length
      },
      ponencias: proyectos.ponencias,
      proyectos_proponente: proyectos.proponente,
      acuerdos,
      citaciones,
      invitaciones,
      comisiones_accidentales: comisiones,
      diagnostico: {
        nombres_encontrados: Array.from(ctx.nombres).sort(),
        bancadas_encontradas: Array.from(ctx.bancadas).sort()
      },
      generado_en: new Date().toISOString()
    };
  },

  _proyectos(ctx) {
    const maestro = this._indexar(SheetsUtils.obtener('proyectos_maestro'), 'numero');
    const porRol = { PONENTE: new Map(), PROPONENTE: new Map() };

    for (const fila of SheetsUtils.obtener('proyectos_detalle')) {
      const rol = this._norm(fila.rol);
      if (!porRol[rol] || !this._esElConcejal(fila.concejal, ctx)) continue;
      const numero = String(fila.numero || '').trim();
      const m = maestro.get(numero) || {};
      if (!this._enPeriodo(m.fecha, ctx.periodo)) continue;
      porRol[rol].set(numero, {
        numero,
        titulo: m.titulo || fila.titulo || '',
        estado: m.estado || '',
        fecha: this._fecha(m.fecha),
        comision: m.comision || ''
      });
    }
    return {
      ponencias: this._ordenar(Array.from(porRol.PONENTE.values())),
      proponente: this._ordenar(Array.from(porRol.PROPONENTE.values()))
    };
  },

  _acuerdos(ctx) {
    const detalle = this._indexar(SheetsUtils.obtener('acuerdos_detalle'), 'no_acuerdo');
    const porNumero = new Map();

    for (const fila of SheetsUtils.obtener('acuerdos_concejales')) {
      if (!this._esElConcejal(fila.concejal, ctx)) continue;
      const numero = String(fila.numero || '').trim();
      const d = detalle.get(numero) || {};
      const fechaRef = d.fecha_sancion || (d.ano_sancion ? new Date(Number(d.ano_sancion), 0, 1) : null);
      if (!this._enPeriodo(fechaRef, ctx.periodo)) continue;
      const item = porNumero.get(numero) || {
        numero,
        titulo: d.titulo || fila.titulo || '',
        fecha: this._fecha(d.fecha_sancion),
        link: d.link_astrea || '',
        roles: []
      };
      const rol = String(fila.rol || '').trim();
      if (rol && item.roles.indexOf(rol) < 0) item.roles.push(rol);
      porNumero.set(numero, item);
    }
    return this._ordenar(Array.from(porNumero.values()));
  },

  _proposiciones(ctx, hojaMaestro, hojaDetalle) {
    const maestro = this._indexar(SheetsUtils.obtener(hojaMaestro), 'consecutivo');
    const porConsecutivo = new Map();

    for (const fila of SheetsUtils.obtener(hojaDetalle)) {
      const quien = fila.bancadas;
      let atribucion = null;
      if (this._esElConcejal(quien, ctx)) atribucion = 'concejal';
      else if (this._esLaBancada(quien, ctx)) atribucion = 'bancada';
      if (!atribucion) continue;

      const consecutivo = String(fila.consecutivo || '').trim();
      const m = maestro.get(consecutivo) || {};
      if (!this._enPeriodo(m.fecha, ctx.periodo)) continue;
      const previo = porConsecutivo.get(consecutivo);
      if (previo && previo.atribucion === 'concejal') continue;
      porConsecutivo.set(consecutivo, {
        consecutivo,
        titulo: m.titulo || fila.titulo || '',
        descripcion: m.descripcion || '',
        estado: m.estado || '',
        fecha: this._fecha(m.fecha),
        atribucion
      });
    }
    return this._ordenar(Array.from(porConsecutivo.values()));
  },

  _comisiones(ctx) {
    const maestroFilas = SheetsUtils.obtener('comisiones_maestro');
    const maestro = this._indexar(maestroFilas, 'consecutivo');
    const roles = new Map();
    const marcar = (consecutivo, rol) => {
      const k = String(consecutivo || '').trim();
      if (!roles.has(k)) roles.set(k, []);
      if (roles.get(k).indexOf(rol) < 0) roles.get(k).push(rol);
    };

    for (const f of maestroFilas) {
      if (this._esElConcejal(f.coordinador, ctx)) marcar(f.consecutivo, 'Coordinador');
    }
    for (const f of SheetsUtils.obtener('comisiones_detalle')) {
      if (this._esElConcejal(f.concejal_proponente, ctx)) marcar(f.consecutivo, 'Proponente');
    }
    for (const f of SheetsUtils.obtener('comisiones_detalle_integrantes')) {
      if (this._esElConcejal(f.integrantes, ctx)) marcar(f.consecutivo, 'Integrante');
    }

    const out = [];
    roles.forEach((rolesComision, consecutivo) => {
      const m = maestro.get(consecutivo) || {};
      if (!this._enPeriodo(m.fecha, ctx.periodo)) return;
      out.push({
        consecutivo,
        titulo: m.titulo || '',
        descripcion: m.descripcion || '',
        estado: m.estado || '',
        coordinador: m.coordinador || '',
        fecha: this._fecha(m.fecha),
        roles: rolesComision
      });
    });
    return this._ordenar(out);
  },

  _esElConcejal(valor, ctx) {
    const n = this._norm(valor);
    if (!n) return false;
    const ok = ctx.tokens.every(t => n.indexOf(t) >= 0);
    if (ok) ctx.nombres.add(String(valor).trim());
    return ok;
  },

  _esLaBancada(valor, ctx) {
    if (ctx.tokensBancada.length === 0) return false;
    const n = this._norm(valor);
    const ok = ctx.tokensBancada.every(t => n.indexOf(t) >= 0);
    if (ok) ctx.bancadas.add(String(valor).trim());
    return ok;
  },

  _enPeriodo(fecha, periodo) {
    if (periodo === 'todos') return true;
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (!fecha || isNaN(d.getTime())) return false;
    return getPeriodo(d.getFullYear()) === periodo;
  },

  _fecha(valor) {
    if (!valor) return null;
    const d = valor instanceof Date ? valor : new Date(valor);
    return isNaN(d.getTime()) ? null : Utilities.formatDate(d, 'America/Bogota', 'yyyy-MM-dd');
  },

  _ordenar(lista) {
    return lista.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  },

  _tokens(texto) {
    return this._norm(texto).split(/\s+/).filter(t => t.length > 1);
  },

  _norm(texto) {
    return String(texto || '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  },

  _indexar(filas, clave) {
    const m = new Map();
    for (const f of filas) {
      const k = f[clave];
      if (k !== undefined && k !== null && k !== '') m.set(String(k).trim(), f);
    }
    return m;
  }
};

function obtenerRendicionConcejal(params) {
  return RendicionConcejal.obtener(params || {});
}
