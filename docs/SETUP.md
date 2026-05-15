# Setup local

## Prerrequisitos

- **Node.js** 18+ (`node --version`)
- **npm** 9+
- **clasp** (CLI de Apps Script): `npm install -g @google/clasp`
- Cuenta Google con acceso al proyecto Apps Script y al Sheet de datos.

## Clonar y dependencias

```bash
git clone https://github.com/JasblleidyPirazan/Concejo360.git
cd Concejo360/frontend
npm install
```

## Frontend (Astro + React + Tailwind)

```bash
cd frontend
npm run dev
```

Abrir http://localhost:4321. Hot reload automático.

**Limitación**: el dev server local NO ejecuta Netlify Functions. Las llamadas a `/.netlify/functions/api?action=...` solo funcionan contra el sitio desplegado. Las páginas se ven (estados de loading/error renderean), pero los datos no cargan.

Para desarrollo full-stack local usar Netlify CLI (no configurado todavía):

```bash
npx netlify dev
```

Variable de entorno (solo necesaria para Netlify CLI local):

```
# frontend/.env  — no commitear, copiar de .env.example
GAS_URL=https://script.google.com/macros/s/AKfyc.../exec
```

## Backend (Google Apps Script vía clasp)

```bash
cd backend/apps-script
clasp login                # primera vez, abre OAuth en navegador
clasp pull                 # baja lo último del Apps Script remoto
# editar localmente
clasp push -f              # sube cambios
```

El proyecto Apps Script está vinculado vía `.clasp.json` (no commiteado). Si no existe:

```bash
clasp clone <scriptId>     # el ID está en la URL del editor de Apps Script
```

**Después de `clasp push`** los cambios están en el editor pero NO en producción. Hay que crear una nueva versión del deployment (ver `DEPLOYMENT.md`).

## Google Sheets

Los datos viven en un Sheet privado vinculado al Apps Script. El ID está en `backend/apps-script/utils/constants.js` (`GOOGLE_IDS.spreadsheetId`). Para inspeccionarlo necesitás permisos del owner.

Hojas principales:

| Hoja | Contenido |
|---|---|
| `sesiones_maestro` | Sesiones del Concejo (estado, fecha, temas) |
| `proyectos_maestro` | Proyectos de acuerdo (radicados) |
| `proyectos_detalle` | Concejales asociados a cada proyecto + rol |
| `acuerdos_detalle` | Acuerdos sancionados |
| `acuerdos_concejales` | Concejales asociados a cada acuerdo + rol |
| `citaciones_maestro` | Citaciones a control político |
| `invitaciones_maestro` | Invitaciones |
| `comisiones_maestro` | Comisiones accidentales |
| `comisiones_detalle` | Proponentes de cada comisión |
| `comisiones_detalle_integrantes` | Integrantes de cada comisión |
| `logs_ejecucion` | Logs de cada corrida de scrapers |

Schema completo en `backend/apps-script/utils/constants.js` → `SHEETS_CONFIG`.

## Tests

No hay test suite formal. Para probar un scraper aisladamente, ejecutar desde el editor de Apps Script (botón ▶︎) llamando a `ejecutarTest(tipo)` o `ejecutarScraping(tipo)`.
