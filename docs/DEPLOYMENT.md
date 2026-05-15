# Deployment

El sistema tiene dos despliegues independientes que deben ir sincronizados:

```
┌─ Frontend ──┐        ┌─ Backend ─────────────────┐
│             │        │                            │
│  Netlify    │ ─HTTP→ │  Apps Script Web App       │
│  (Astro)    │        │  (Google Cloud)            │
│             │        │                            │
└─────────────┘        └────────────────────────────┘
       │                          │
       └─────── git push ─────────┘
       │       (mismo repo)       │
       │                          │
   auto-deploy                  clasp push + new version
   (Netlify CI)                 (manual desde tu máquina)
```

## Backend: Apps Script

### Paso 1 — Subir el código

```cmd
cd backend\apps-script
clasp push -f
```

Esto sube TODOS los archivos `.js` y `.json` al proyecto Apps Script remoto. Los cambios quedan visibles en el editor (https://script.google.com), pero **no están en producción todavía**.

### Paso 2 — Crear nueva versión del deployment

En el editor de Apps Script (en el navegador):

1. **Implementar → Administrar implementaciones**
2. Click en el ✏️ (lápiz) del deployment activo (el que sirve como Web App)
3. **Versión → Nueva versión**
4. Click **Implementar**

**Crítico**: Si en vez de editar el existente elegís **"Nueva implementación"**, se genera una URL nueva del Web App. En ese caso hay que actualizar `GAS_URL` en Netlify (ver más abajo) y redeployar el frontend. Si solo creás una nueva versión del deployment existente, la URL queda igual.

### Paso 3 — Verificar

Abrir en el navegador la URL del Web App + `?action=health`:

```
https://script.google.com/macros/s/<deploymentId>/exec?action=health
```

Debe devolver JSON `{"success":true,"status":"OK",...}`. Si devuelve "valor de retorno no admitido" significa que `ContentService.createTextOutput` no se aplicó — revisar `main.js` `doGet/doPost`.

Otras acciones útiles para smoke test:
- `?action=resumen-concejales` → JSON con dashboard agregado
- `?action=data&tipo=sesiones&limit=10` → 10 sesiones

## Frontend: Netlify

### Auto-deploy

Netlify está conectado al repo (rama `main`). Cada push a main dispara un build automático. Tiempo típico: 1-2 minutos.

Estado del último deploy: https://app.netlify.com → site Concejo360 → Deploys.

### Variable de entorno crítica

**GAS_URL** debe contener la URL **completa** del Web App de Apps Script:

```
https://script.google.com/macros/s/AKfyc.../exec
```

⚠️ Tiene que empezar con `https://`. Si pegás solo el ID + `/exec`, `fetch()` falla con "Failed to parse URL" y el dashboard muestra "Error cargando el dashboard".

Configuración en Netlify:
1. **Site settings → Environment variables → GAS_URL → Options → Edit**
2. Pegar URL completa
3. **Save**
4. Cambiar env vars NO triggerea redeploy. Hay que **Deploys → Trigger deploy → Clear cache and deploy site**.

### Verificar

Después del deploy:

1. Abrir el site con Ctrl+F5 (limpia caché del browser).
2. Inspeccionar Network tab del devtools → buscar el request a `/.netlify/functions/api?action=resumen-concejales`. Debe responder 200 con JSON.
3. Si responde 502/500: revisar logs en Netlify → Functions → api.

## Checklist completo de deploy (cuando hay cambios backend Y frontend)

1. ✅ `git push origin main` — sube todo al repo
2. ✅ Netlify auto-deploya el frontend (esperar el verde)
3. ✅ `cd backend\apps-script && clasp push -f`
4. ✅ Apps Script editor → Administrar implementaciones → ✏️ → Nueva versión → Implementar
5. ✅ Verificar URL del Web App con `?action=health`
6. ✅ Si la URL cambió: actualizar `GAS_URL` en Netlify + redeploy
7. ✅ Ctrl+F5 en el site público

## Gotchas conocidas

### "Valor de retorno no admitido"

`doGet`/`doPost` deben devolver `ContentService.createTextOutput(...)`. Devolver un objeto JS plano falla. Ver `main.js:82-86` (`_jsonResponse`).

### "Endpoint no encontrado" en el dashboard

El backend recibió un request pero el `action` no está en el switch de `_handleGet` (`main.js:61-72`). Verificar que el deploy del Apps Script tiene la versión que incluye la action.

### "Failed to parse URL from ..."

`GAS_URL` en Netlify no tiene `https://` adelante. Editar y redeployar.

### "Sin datos disponibles" pero el JSON sí responde

Mismatch de shape entre lo que devuelve Apps Script y lo que espera el frontend. El frontend espera `{ success, timestamp, data: <payload> }`. Si Apps Script devuelve los campos en el root (`{ success, timestamp, periodos, ... }`), `res.data` es `undefined`. Envolver el payload con `respuestaExitosa({ data: payload })`.

### Branches feature acumulándose

Trabajamos sobre `main` directamente. Si por workflow externo aparecen branches `claude/*`, borrar después de merge:

```cmd
git push origin --delete <branchName>
git branch -D <branchName>
```
