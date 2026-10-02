# API Reference

## Topología

El frontend NUNCA llama directamente al Apps Script. Siempre va a través de la Netlify Function `api`:

```
Browser → /.netlify/functions/api?action=X
            ↓ (proxy + cache 15min)
        Apps Script Web App ?action=X
            ↓
        Google Sheets
```

Razón: ocultar la URL del Web App (que de otra forma quedaría hardcodeada en el bundle de Astro), centralizar caché y validar `action` contra una allowlist.

## Endpoint base

```
GET /.netlify/functions/api?action=<action>&...
```

Implementación: `frontend/netlify/functions/api.mjs`.

## Acciones soportadas

Allowlist actual (`api.mjs`):

```js
const ALLOWED_ACTIONS = new Set([
  'data', 'status', 'health', 'resumen-concejales', 'panorama-concejo'
]);
```

Agregar una acción nueva requiere:
1. Implementarla en `backend/apps-script/main.js` → `_handleGet` switch.
2. Agregarla al `ALLOWED_ACTIONS` set en `api.mjs`.
3. Si necesita parámetros (como `data` que requiere `tipo`), validarlos.

### `?action=health`

Smoke test.

```json
{
  "success": true,
  "status": "OK",
  "timestamp": "2026-05-15T15:32:54.745Z"
}
```

### `?action=resumen-concejales`

Dashboard pre-agregado. Esta es la llamada principal de la landing y de la página de concejal individual.

Response:

```json
{
  "success": true,
  "timestamp": "...",
  "data": {
    "periodos": ["2024-2027", "2020-2023", ...],
    "periodo_actual": "2024-2027",
    "concejales_por_periodo": {
      "2024-2027": ["NOMBRE 1", "NOMBRE 2", ...]
    },
    "kpis_concejal": {
      "NOMBRE|2024-2027": {
        "acuerdos_ponente": 3,
        "proyectos_ponente": 12,
        "proyectos_por_estado": { "Sancionado": 2, "Archivado": 1, ... }
      }
    },
    "kpis_periodo": {
      "2024-2027": {
        "acuerdos_total": 32,
        "proyectos_total": 336,
        "citaciones": 89,
        "invitaciones": 45,
        "comisiones": 12,
        "proyectos_por_estado": { ... }
      }
    },
    "generado_en": "2026-05-15T15:32:54.745Z"
  }
}
```

⚠️ **Shape crítico**: el frontend (`api.ts` `ApiOk<T>`) espera el payload bajo `data`. Si se devuelve flat al root, `res.data` es `undefined` y el dashboard muestra "Sin datos disponibles".

Implementación: `backend/apps-script/api/dashboardConcejales.js` (`DashboardConcejales.obtener`).

### `?action=panorama-concejo&periodo=<label>&anio=<yyyy>`

Panorama institucional (Hoja 1 / Vista Concejo, landing del portal). Ambos parámetros opcionales:
`periodo` default = vigente; sin `anio` el delta compara contra el mismo corte del periodo anterior,
con `anio` compara contra `anio - 1`.

Response (bajo `data`):

```json
{
  "periodo": "2024-2027",
  "anio": null,
  "periodo_anterior": "2020-2023",
  "corte_dias": 893,
  "kpis": { "sesiones": 0, "proyectos_radicados": 0, "acuerdos_sancionados": 0, "tasa_conversion": 0, "citaciones": 0, "comisiones_accidentales": 0 },
  "kpis_anterior": { },
  "deltas": { "sesiones": 6.2, "...": "% de cambio (sin tasa_conversion)" },
  "sesiones_por_mes": [{ "mes": "2026-05", "ordinarias": 8, "extraordinarias": 2, "total": 10 }],
  "embudo": [{ "etapa": "Radicado", "total": 96 }],
  "heatmap_comision_mes": [{ "comision": "...", "mes": "2026-05", "total": 4 }],
  "top_temas": [{ "tema": "seguridad", "count": 87 }],
  "insight": "Durante 2026 se realizaron...",
  "generado_en": "..."
}
```

Implementación: `backend/apps-script/api/panoramaConcejo.js`. Consumido por `frontend/src/components/VistaConcejo.jsx`.

### `?action=rendicion-concejal&nombre=<nombre>&bancada=<bancada>&periodo=<periodo|todos>`

Actividad de un concejal: `ponencias`, `proyectos_proponente`, `acuerdos`, `citaciones`, `invitaciones`, `comisiones_accidentales`, más `kpis` con los conteos y `diagnostico` (variantes de nombre y bancada encontradas). `nombre` es obligatorio (el proxy responde 400 `BAD_NOMBRE` si falta); se compara por palabras, sin tildes ni mayúsculas. Citaciones e invitaciones se atribuyen por bancada (`atribucion: 'bancada'`) porque SIMI no registra el concejal. `periodo` por defecto es el actual.

Implementación: `backend/apps-script/api/rendicionConcejal.js`. Consumido por `frontend/src/components/RendicionCuentas.jsx` (página `/rendicion`).

### `?action=data&tipo=<tipo>&page=<n>&limit=<n>`

Paginación de cualquier hoja maestro. `tipo` debe estar en `ALLOWED_TIPOS`:

```js
['sesiones', 'proyectos', 'acuerdos', 'comisiones', 'invitaciones', 'citaciones']
```

Response:

```json
{
  "success": true,
  "timestamp": "...",
  "data": [ /* filas paginadas */ ],
  "pagination": { "page": 1, "limit": 50, "total": 1532, "pages": 31 }
}
```

### `?action=status`

Estado del sistema (scrapers disponibles, accesos OK). Útil para healthchecks operativos.

## Formato estándar de respuesta

### Éxito

```json
{
  "success": true,
  "timestamp": "2026-05-15T15:32:54.745Z",
  "data": <payload>,
  ...metadata
}
```

`data` es **opcional pero recomendado**. Endpoints históricos (como `dashboard`, `data`) spread-eaban campos al root. Para endpoints nuevos, envolver el payload bajo `data` para alinearse con el tipo `ApiOk<T>` del frontend.

### Error

```json
{
  "success": false,
  "error": "Descripción humana",
  "code": "CODIGO_MAQUINA",
  "timestamp": "..."
}
```

Códigos usados:

| Código | Causa |
|---|---|
| `CONFIG_MISSING` | `GAS_URL` no está en Netlify env vars |
| `FORBIDDEN_ACTION` | Action no está en allowlist del proxy |
| `BAD_TIPO` | Falta `tipo` o no está en allowlist |
| `UPSTREAM_ERROR` | Apps Script devolvió status != 200 |
| `UPSTREAM_FETCH` | Fallo de red al llamar Apps Script |
| `ENDPOINT_NOT_FOUND` | Action válida en proxy pero no en switch de Apps Script |
| `INVALID_DATA_TYPE` | `tipo` válido en proxy pero no en `SHEETS_CONFIG` |
| `DASHBOARD_ERROR`, `DATA_ERROR`, `GET_ERROR` | Excepciones en backend |

## Wrapping de la respuesta en Apps Script

```js
function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

⚠️ Apps Script rechaza con "valor de retorno no admitido" si `doGet/doPost` devuelven un objeto JS plano. Siempre envolver con `ContentService`. Ver `main.js:82-86`.

## Caché

La Netlify Function setea:

```
Cache-Control: public, s-maxage=900, stale-while-revalidate=60
```

= 15 min en el CDN de Netlify, 60s adicionales sirviendo stale mientras refresca. El browser no cachea (no hay `max-age`). Los scrapers corren diariamente; el TTL de 15min es razonable para datos legislativos.

Para forzar refresh inmediato después de un cambio: redeploy del frontend (limpia la caché del CDN).

## Cliente frontend

`frontend/src/lib/api.ts` exporta:

```ts
api.sesiones(limit?)              // GET data?tipo=sesiones
api.datos(tipo, limit?)           // GET data?tipo=X (cualquier tipo de la allowlist)
api.status()                      // GET status
api.health()                      // GET health
api.resumenConcejales()           // GET resumen-concejales
api.panoramaConcejo(periodo?, anio?)  // GET panorama-concejo
```

Tipos:

```ts
type ApiResponse<T> = ApiOk<T> | ApiError;
type ApiOk<T> = { success: true; timestamp: string; data: T; total?: number; ... };
type ApiError = { success: false; error: string; code: string; timestamp: string };
```

Para añadir una llamada nueva: extender `api` con otra función que llame a `call<T>({ action: 'nueva-action' })`.
