const ALLOWED_ACTIONS = new Set(['data', 'status', 'health', 'resumen-concejales', 'panorama-concejo', 'rendicion-concejal']);
const ALLOWED_TIPOS = new Set([
  'sesiones',
  'proyectos',
  'acuerdos',
  'comisiones',
  'invitaciones',
  'citaciones',
]);

const json = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=60',
    ...extraHeaders,
  },
  body: JSON.stringify(body),
});

const errorBody = (error, code) => ({
  success: false,
  error,
  code,
  timestamp: new Date().toISOString(),
});

export async function handler(event) {
  const gasUrl = process.env.GAS_URL;
  if (!gasUrl) {
    return json(500, errorBody('GAS_URL no configurada', 'CONFIG_MISSING'));
  }

  const params = event.queryStringParameters || {};
  const action = params.action || 'health';

  if (!ALLOWED_ACTIONS.has(action)) {
    return json(403, errorBody(`Acción "${action}" no permitida`, 'FORBIDDEN_ACTION'));
  }

  if (action === 'data') {
    if (!params.tipo || !ALLOWED_TIPOS.has(params.tipo)) {
      return json(400, errorBody('Parámetro "tipo" inválido o ausente', 'BAD_TIPO'));
    }
  }

  if (action === 'rendicion-concejal' && !params.nombre) {
    return json(400, errorBody('Parámetro "nombre" ausente', 'BAD_NOMBRE'));
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) search.set(key, String(value));
  }
  const target = `${gasUrl}?${search.toString()}`;

  try {
    const upstream = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: { Accept: 'application/json' },
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return json(502, errorBody(`Upstream ${upstream.status}`, 'UPSTREAM_ERROR'));
    }
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=60',
      },
      body: text,
    };
  } catch (err) {
    return json(502, errorBody(err?.message || 'Fallo de red', 'UPSTREAM_FETCH'));
  }
}
