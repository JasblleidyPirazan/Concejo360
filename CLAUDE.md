# CLAUDE.md — Guía para sesiones de Claude Code

> Documento operativo para que cualquier sesión de Claude trabajando sobre este repo arranque productiva en 2 minutos.

## Qué es esto

**Concejo 360** — portal de transparencia del Concejo de Medellín. MVP funcional. Audiencia: ciudadanía no técnica, periodistas, veedurías.

**Stack real** (el README dice Next.js, pero la realidad es):

- **Frontend**: Astro + React (islands) + Tailwind CSS, deployado en Netlify.
- **Backend**: Google Apps Script (JavaScript ES5/ES6, sin módulos ES). Vinculado a un Google Sheet vía Sheets API.
- **Proxy**: Netlify Function (`frontend/netlify/functions/api.mjs`) entre browser y Apps Script — oculta la URL del Web App y cachea 15min.
- **Scrapers**: corren en Apps Script, scrapean SIMI (`simi.concejodemedellin.gov.co`), almacenan en Sheets.

## Mapa de archivos críticos

```
backend/apps-script/
├── main.js                         # doGet/doPost, switch de actions
├── api/
│   ├── dashboardConcejales.js      # endpoint resumen-concejales (agregaciones)
│   └── panoramaConcejo.js          # endpoint panorama-concejo (Vista Concejo)
├── scrapers/
│   ├── sesiones.js, proyectos.js, acuerdos.js
│   └── comisiones.js, citaciones.js, invitaciones.js
└── utils/
    ├── constants.js                # SHEETS_CONFIG, PERIODOS, URLs
    ├── sheets.js                   # SheetsUtils.obtener/guardar
    └── validation.js               # ValidationUtils.normalizarNombre

frontend/
├── src/
│   ├── layouts/Layout.astro        # header + NavTabs + footer (max-w-7xl)
│   ├── pages/
│   │   ├── index.astro             # landing → VistaConcejo (panorama-concejo)
│   │   ├── concejales.astro        # individual → DashboardConcejales
│   │   ├── buscador.astro          # búsqueda transversal → BuscadorTransversal
│   │   └── produccion / control-politico / comparativo .astro  # placeholders (PaginaFutura)
│   ├── components/
│   │   ├── NavTabs.astro           # navegación persistente de 6 tabs
│   │   ├── VistaConcejo.jsx        # landing: KPIs+deltas, sesiones/mes, embudo, heatmap, temas, rankings
│   │   ├── BuscadorTransversal.jsx # búsqueda libre sobre las 6 fuentes, export CSV
│   │   ├── DashboardConcejales.jsx # detalle por concejal
│   │   ├── PaginaFutura.astro      # plantilla "En construcción" para tabs pendientes
│   │   ├── MonthlyChart.jsx, SesionesStats.jsx
│   ├── lib/
│   │   ├── api.ts                  # cliente, tipos ApiOk/ApiError
│   │   ├── stats.ts                # helpers (porMes, formatFecha, etc.)
│   │   └── csv.ts                  # descargarCsv (botones "⬇ CSV")
│   └── styles/global.css
├── netlify/functions/api.mjs       # proxy con allowlist
└── tailwind.config.cjs             # paleta brand (morado) + accent (amarillo)

docs/
├── SETUP.md                        # cómo correr local
├── DEPLOYMENT.md                   # cómo deployar (clasp + Netlify)
├── API.md                          # contrato del API
└── ROADMAP.md                      # visión de 6 páginas pendientes
```

## Git workflow

**Trabajamos directamente sobre `main`**. No hay branches feature por convención — fueron eliminadas en mayo 2026 para simplificar el flow.

```bash
git checkout main
git pull origin main
# editar
git add <files>
git commit -m "tipo(scope): mensaje"
git push origin main
```

Si por configuración externa (Claude Code en la web, agentes automatizados) aparecen branches `claude/*`, mergear a main vía PR y borrar.

**Commits**: español, prefijo tipo conventional commits (`fix(api):`, `feat(dashboard):`). El "qué" en el título, el "por qué" en el body.

## Deploy

Resumen (ver `docs/DEPLOYMENT.md` para detalles):

1. **Push a main** → Netlify auto-deploya el frontend en 1-2 min.
2. **Backend Apps Script** → manual:
   ```cmd
   cd backend\apps-script
   clasp push -f
   ```
   Después en https://script.google.com → **Implementar → Administrar implementaciones → ✏️ → Nueva versión → Implementar**.
3. Si la URL del Web App cambió (creaste deployment nuevo en vez de versión nueva del existente), actualizar `GAS_URL` en Netlify → Site settings → Environment variables, y redeployar Netlify.

## Gotchas que ya nos mordieron

| Síntoma | Causa | Fix |
|---|---|---|
| "valor de retorno no admitido" en Apps Script | `doGet/doPost` devolvió objeto JS plano | Envolver con `ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)`. Hay un helper `_jsonResponse` en `main.js`. |
| "Failed to parse URL from ..." en el dashboard | `GAS_URL` en Netlify no tiene `https://` adelante | Editar env var, agregar prefijo `https://`, redeployar Netlify (Clear cache and deploy) |
| "Endpoint no encontrado" | El `action` del request no está en el switch de `_handleGet` en `main.js` | Agregar el case y redeployar Apps Script |
| "Sin datos disponibles" pero JSON sí responde | Mismatch de shape: backend devuelve campos al root, frontend espera `res.data.X` | Envolver el payload con `respuestaExitosa({ data: payload })` |
| KPI muestra 0 cuando debería tener datos | Nombre de columna en el read no coincide con el que escribe el scraper | Verificar en `scrapers/<modulo>.js` (función `armarFila*`) qué columnas se escriben, alinear lectura en `api/*.js` y schema en `constants.js` |
| Lista de concejales incluye basura (ALCALDE, SECRETARIA *, PARTIDO *) | Esos textos vienen como "proponente" en los datos crudos de SIMI | Filtro `_esConcejalReal` ya aplicado en `dashboardConcejales.js`. Para agregar/quitar, editar `NOMBRES_NO_CONCEJAL` y `PREFIJOS_NO_CONCEJAL` al tope del archivo |

## Convenciones del código

- **Lenguaje**: variables, comentarios y commits en **español** para términos de negocio (concejal, periodo, ponente, sancionado). Inglés OK para términos técnicos genéricos (cache, parse, async).
- **Apps Script**: no soporta módulos ES (`import/export`). Todo es global. Para encapsular, usar objetos literales (ver `DashboardConcejales`, `ScraperComisiones`).
- **Estilo de funciones**: cortas, una responsabilidad. El README pide ≤20 líneas; en la práctica algunos scrapers son más largos por la complejidad de PrimeFaces. Aceptable si está bien estructurado.
- **Respuestas API**: siempre `{ success, timestamp, data?, error?, code? }`. Usar `respuestaExitosa({ data: payload })` para nuevos endpoints (mantiene shape `ApiOk<T>` esperado por frontend).
- **Sin comentarios "qué"**: el README pide *"Comentarios solo para 'por qué', no para 'qué'"*. Cumplir.
- **Sin tests formales por ahora**: probar scrapers ejecutando `ejecutarTest(tipo)` o `ejecutarScraping(tipo)` desde el editor de Apps Script.

## Paleta visual

```js
brand: {                  // morado institucional Medellín-Es
  50:  '#faf0ff',
  100: '#f0dafa',
  200: '#ddb4f0',
  500: '#9b33c7',
  600: '#7010a6',  // ⭐ base
  700: '#590884',
  800: '#420664',
  900: '#2b033e',
},
accent: {                 // amarillo institucional (acentos, highlights)
  400: '#ffdf33',
  500: '#fcd700',  // ⭐ base
  600: '#d6b600',
},
estado: {                 // semánticos (estados de actividades)
  programada: '#7010a6',  // morado
  realizada:  '#16a34a',  // verde (no se cambia, semántico)
  pendiente:  '#fcd700',  // amarillo
},
```

Layout: `max-w-7xl` (1280px) en Layout.astro. Para ampliar a futuro, cambiar las 3 ocurrencias en ese archivo (header, main, footer).

## Estado del MVP (junio 2026)

✅ Funciona:
- Navegación persistente de 6 tabs (Concejo, Concejal, Producción, Control político, Comparativo, Buscador).
- **Vista Concejo** (landing, Página 1 del roadmap): KPIs con deltas vs. mismo corte del periodo anterior (o año−1), sesiones por mes (ordinarias/extraordinarias), embudo de proyectos en 5 etapas, heatmap comisión × mes, top temas, insight automático. Filtros: periodo + año.
- Rankings top 10 ponentes (proyectos, acuerdos).
- Página individual `/concejales?nombre=X` con KPIs y estados.
- **Buscador transversal** (`/buscador?q=X`, Página 6 del roadmap): búsqueda libre sobre proyectos, acuerdos, citaciones, invitaciones, comisiones y sesiones; filtros por fuente, resaltado y descarga CSV.
- Botones "⬇ CSV" en cada gráfico de la Vista Concejo (open data).
- Scraping automático de SIMI.

❌ Pendiente (ver `docs/ROADMAP.md`):
- Páginas Producción, Control político y Comparativo (hoy placeholders con `PaginaFutura`).
- Perfil del concejal expandido (foto, bancada, tabla de proyectos, agenda temática, compartir).
- Datos no presentes: bancada, oposición/gobierno, foto, contactos, comisión donde el concejal participa formalmente, asistencia (depende del despacho), clasificación temática (NLP).
- Lista canónica de 21 concejales por periodo (hoy se infiere de los datos).

## Cómo arrancar productivo en una sesión nueva

1. Leer este CLAUDE.md (acabás).
2. Si el usuario pide un cambio sobre un área específica, leer el archivo correspondiente en el mapa de arriba.
3. Si el cambio toca el contrato API, leer `docs/API.md`.
4. Si el cambio es visual, mirar el componente en `frontend/src/components/` y la paleta arriba.
5. Para cambios grandes que toquen visión: leer `docs/ROADMAP.md` antes de proponer.
6. Para tocar deploys: leer `docs/DEPLOYMENT.md`.

**Antes de pushear**: confirmar con el usuario salvo cambios triviales. El usuario prefiere trabajar paso a paso con preview de cada cambio.

## Contactos / repo

- Repo: `JasblleidyPirazan/Concejo360`
- Branch única: `main`
- Owner: Jasblleidy Pirazán
