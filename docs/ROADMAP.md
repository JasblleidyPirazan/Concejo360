# Roadmap — Concejo 360

## Estado actual (mayo 2026)

✅ **MVP funcional**:

- Scrapers automáticos de sesiones, proyectos, acuerdos, comisiones, citaciones, invitaciones.
- Dashboard global con KPIs por periodo (proyectos, acuerdos, comisiones, citaciones, invitaciones).
- Rankings de top 10 ponentes (proyectos, acuerdos) por periodo.
- Página individual `/concejales?nombre=X` con KPIs por concejal y distribución de proyectos por estado.
- Filtro de entidades no-humanas (excluye ALCALDE, SECRETARIA *, etc.).
- Paleta institucional morado `#7010A6` + amarillo `#FCD700`.
- Deploy automático: Netlify para frontend, Apps Script para backend.

❌ **Faltante para visión completa**: las 6 páginas conceptuales descritas a continuación, asistencia, bancadas, fotos, NLP temático.

## Visión completa — 6 páginas

> **Audiencia primaria**: ciudadanía sin conocimiento técnico-legislativo.
> **Audiencia secundaria**: periodistas, veedurías, investigadores académicos, militancia política.
>
> **Principio rector**: una persona sin contexto debe poder responder en 30 segundos "¿este concejal vale la pena?" sin que el dashboard tome partido — la respuesta sale de los datos.

### Navegación persistente

Barra superior con 6 tabs en todas las páginas:

```
🏛️ Concejo  →  👤 Concejal  →  📜 Producción  →  🎯 Control político  →  ⚖️ Comparativo  →  🔍 Buscador
```

### Filtros globales (persisten en toda la sesión)

- **Periodo constitucional**: dropdown (2020-2023, 2024-2027). Default = vigente.
- **Año**: slider o pills.
- **Comisión**: Primera (Plan y Tierras), Segunda (Hacienda), Tercera (General), todas.
- **Bancada / partido**: multi-select.

---

### Página 1 — Vista Concejo (panorama institucional)

**Pregunta**: ¿qué hace el Concejo en su conjunto y cómo se compara con periodos anteriores?

**Es la página de aterrizaje**. Contextualiza antes de juzgar a un concejal individual: si el Concejo solo sancionó 30 acuerdos en un año, no se le puede exigir a un solo concejal 20.

**KPIs superiores** (tarjetas con delta vs. mismo corte del periodo anterior, flecha verde/roja con %):
- Sesiones realizadas en el periodo filtrado.
- Proyectos de acuerdo radicados vs. sancionados (con tasa de conversión).
- Citaciones a control político realizadas.
- Comisiones accidentales conformadas.

**Gráficos**:
- **Línea temporal de sesiones por mes** — barras apiladas (ordinarias vs. extraordinarias). Detecta picos que coinciden con presupuesto o crisis.
- **Embudo de proyectos de acuerdo** — funnel con los 16 estados agrupados en 5 etapas: Radicado → Con ponentes → Primer debate → Segundo debate → Sancionado/Archivado. Revela dónde mueren los proyectos.
- **Mapa de calor comisión × mes** — qué comisión produce y cuándo. La Tercera concentra ~62% según datos crudos; eso debe ser visible.
- **Top 10 temas más debatidos** — nube de palabras o ranking de los campos `temas` y `descripcion` de citaciones (tokenización simple). Distingue agenda real vs. agenda discursiva.

**Insight automático abajo**: caja con texto generado tipo *"Durante 2026 se realizaron X sesiones, Y% más/menos que el mismo corte de 2025. La Comisión Tercera concentró el Z% de la producción legislativa."*

---

### Página 2 — Perfil del Concejal (página estrella)

**Pregunta**: ¿quién es este concejal y qué ha hecho?

Pensada para que cualquier ciudadano abra el dashboard, busque a "su" concejal y entienda en un minuto qué tipo de representante tiene.

**Header card**:
- Foto + nombre completo.
- Bancada y partido.
- Comisión (Primera/Segunda/Tercera).
- Declaración: oposición / gobierno / independiente (dato público pero no en SIMI, requiere sembrar manualmente).
- Curul (número o sector electoral si aplica).
- Botones de contacto (correo institucional, redes sociales).

**Selector**: buscador con autocompletar (combo de `acuerdos_concejales.concejal` filtrado por `_esConcejalReal`).

#### Sección A — Asistencia y disciplina ⚠️
**Depende de fuente externa al SIMI** (archivo del despacho de cada concejal).

- % de asistencia total al periodo. Donut con color verde si ≥95%, amarillo 85-95%, rojo <85%.
- Inasistencias detalladas (tabla): fecha, tema, justificada/no justificada, radicado de excusa.
- Sesiones extraordinarias asistidas (las más decisivas: presupuesto, traslados).

Si el despacho no publica, mostrar **"Información no disponible"**. No inventar.

#### Sección B — Producción legislativa (núcleo del perfil)

Cuatro tarjetas:
- Proyectos como **Proponente** (autor principal).
- Proyectos como **Ponente** (designado por mesa directiva).
- Proyectos como **Coordinador ponente**.
- Proyectos que terminaron en **Acuerdo sancionado** (tasa de éxito).

Tabla expandible con cada proyecto: número, título, rol, estado, fecha, comisión, link al texto oficial (campo `link_astrea` cuando exista).

Gráfico de evolución temporal: dos series — proyectos radicados como proponente por mes vs. acuerdos sancionados como proponente por mes.

#### Sección C — Control político

- Citaciones a debate firmadas por su bancada (advertir que el dato individual no existe en la base).
- Cuestionarios adicionales radicados (segunda bancada citante).
- Casos donde fue cabeza visible — campo procesado por NLP/regex sobre descripción: cuando aparece "en cabeza del concejal X" se marca como protagonista.

#### Sección D — Comisiones accidentales

- Listado donde figura como **proponente** (de `comisiones_detalle`).
- Listado donde figura como **integrante** (de `comisiones_detalle_integrantes`).
- Diferenciar visualmente: proponer = iniciativa propia; integrar = acompaña.

#### Sección E — Agenda temática

Nube de temas o treemap desde títulos de proyectos + citaciones + comisiones. Permite ver si es monotemático o de agenda amplia.

Categorías sugeridas (clasificación manual o por keywords): Mujeres y género · Niñez y juventud · Educación · Salud · Movilidad · Medio ambiente · Vivienda y POT · Trabajo · Seguridad · Cultura · Servicios públicos · Hacienda · Paz y DDHH · Discapacidad · LGBTI · Comunidades étnicas.

#### Sección F — Compartir perfil

Botón que genera una tarjeta-imagen descargable con resumen del concejal (asistencia, proyectos, top temas) lista para redes. Clave para difusión ciudadana.

---

### Página 3 — Producción legislativa

**Pregunta**: ¿qué proyectos hay vivos, quiénes los empujan, y dónde están atascados?

Para periodistas y veedurías que hacen seguimiento legislativo.

**Filtros laterales**: estado, comisión, bancada, concejal proponente, rango de fechas, materia.

**Vistas**:
- Tabla principal con búsqueda y filtro multicriterio.
- Línea de tiempo (Gantt simplificado): barra por proyecto con estados sucesivos. Detecta proyectos meses sin movimiento.
- Diagrama Sankey: flujo bancada proponente → comisión → estado final. Qué bancadas logran convertir vs. solo radican.

**Métricas destacadas**:
- Tasa de conversión por bancada (radicados/sancionados). El partido del alcalde tendrá tasa alta; las oposiciones, baja. Eso cuenta una historia política.
- Días promedio de un proyecto en estudio antes de primer debate.

---

### Página 4 — Control político y comisiones

**Pregunta**: ¿quién vigila a la administración y sobre qué temas?

**Vistas**:
- Cronología de citaciones (timeline): cada citación es un punto coloreado por bancada citante.
- Heatmap **bancada × tema**: matriz con bancadas en filas, temas en columnas, intensidad = citaciones. Revela perfiles.
- Top 10 secretarías más citadas.
- Comisiones accidentales activas vs. archivadas: stacked bar por año. ~98% están archivadas, pregunta legítima: ¿son herramienta real o ruido protocolario?

**Filtros**: bancada citante, concejal (cuando identifique como cabeza), tipo (citación/invitación/comisión), estado (aprobada/realizada/archivada).

---

### Página 5 — Comparativo

**Pregunta**: ¿este concejal está por encima o por debajo del promedio?

⚠️ **Página más sensible políticamente**. Comparar mal hecho es injusto: un concejal de oposición con 0 acuerdos sancionados puede ser excelente; uno del partido del alcalde con 20 puede ser solo ratificador del ejecutivo.

**Vista 1 — Tabla rankeable** con columnas configurables: % asistencia, proyectos como proponente, acuerdos sancionados, tasa de éxito, citaciones, comisiones propuestas, temas únicos. Sin "puntaje global" agregado — eso sería tendencioso.

**Vista 2 — Gráfico radar/araña** comparando hasta 3 concejales en 6 ejes (asistencia, producción, control político, trabajo en comisiones, diversidad temática, tasa de éxito). Cada eje normalizado al máximo del periodo. Marca de oposición/gobierno.

**Vista 3 — Scatterplot "Producción vs. Control"**: eje X = proyectos propuestos, eje Y = citaciones firmadas, color por bancada. Cuadrantes:
- Superior izquierdo: alta vigilancia, baja producción (oposición pura).
- Superior derecho: ambas (concejales completos).
- Inferior derecho: producción sin control (gobiernistas).
- Inferior izquierdo: bajo perfil general.

**Advertencia metodológica permanente** en la página: *"Los acuerdos sancionados dependen del trabajo individual Y de la correlación de fuerzas en el Concejo. Un concejal de oposición con baja tasa de sanción puede estar haciendo control político riguroso. Compare con cautela."*

---

### Página 6 — Buscador transversal

**Pregunta**: ¿qué se ha hecho sobre X tema?

Búsqueda libre que cruza títulos de proyectos, descripciones de citaciones, temas de sesiones, títulos de comisiones. Resultados agrupados por tipo, con concejales relacionados y fechas.

Lo más útil para periodistas y veedurías: *"¿qué se ha hecho sobre Hidroituango?"*, *"¿qué se ha discutido sobre el POT?"*.

---

## Componentes transversales (todas las páginas)

- **Última actualización**: fecha visible en footer (de `fecha_extraccion` en `sesiones_maestro` o `logs_ejecucion`).
- **Botón "Descargar CSV"**: open data efectivo, no decorativo.
- **Tooltip glosario**: definiciones de términos legislativos (proponente, ponente, coordinador, primer debate) al hover. La mitad de la ciudadanía no sabe qué es un ponente.
- **Modo oscuro / claro**.
- **Versión móvil priorizada**: KPI tiles y perfil del concejal deben ser plenamente usables en celular — es donde realmente lo van a abrir.

---

## Orden sugerido de implementación

1. **Sembrar datos faltantes** (preludio sin código): tabla `concejales_periodo_maestro` con los 21 concejales reales + bancada + comisión + oposición/gobierno + foto + contactos. Hacer manualmente para 2024-2027 primero.
2. **Página 1 — Vista Concejo**: extiende lo que ya hay; solo agregar embudo de proyectos + mapa de calor + line chart sesiones. Endpoint nuevo: `?action=panorama-concejo&periodo=X`.
3. **Página 2 — Perfil expandido**: la actual ya tiene la base. Agregar tabla de proyectos, evolución temporal, comisiones, agenda temática.
4. **Página 6 — Buscador transversal**: alto valor para periodistas, técnicamente simple (búsqueda en strings, frontend filtering).
5. **Página 3 — Producción legislativa**: requiere Sankey (library nueva, ej. `visx` o `d3-sankey`) y Gantt.
6. **Página 4 — Control político**: heatmap, requiere clasificación temática (NLP o keywords manuales).
7. **Página 5 — Comparativo**: la más delicada políticamente, dejar para cuando ya haya feedback ciudadano sobre las otras 5.

Cada página = 1 PR independiente. La barra de navegación de 6 tabs se agrega en el PR de la página 1 con los otros 5 tabs como placeholders.

## Dependencias de datos no resueltas

| Dato | Fuente | Estado |
|---|---|---|
| 21 concejales canónicos por periodo | Sembrar manual (Wikipedia + sitio Concejo) | Falta |
| Bancada / partido | Sembrar manual | Falta |
| Oposición / gobierno / independiente | Sembrar manual (declaración pública) | Falta |
| Foto + contactos | Sitio del Concejo / redes oficiales | Falta |
| Comisión a la que pertenece | Sitio del Concejo | Falta |
| **Asistencia a sesiones** | Despacho de cada concejal (archivo de la oficina) | Falta, no scrapeable |
| Clasificación temática de proyectos/citaciones | NLP o keywords manuales | Falta |
| Bancada citante | Está en SIMI pero requiere parsing adicional | Parcial |
| "Cabeza visible" de citación | Regex sobre descripción ("en cabeza del concejal X") | Falta |

## Posible integración con Looker Studio

Como complemento, no reemplazo:
- Concejo 360 = portal público con narrativa y marca propia.
- Looker Studio = "Explorar datos crudos" para usuarios técnicos que quieren cortar la data a su antojo.

Si se quiere ir por este camino: conectar Looker al mismo Google Sheet, armar 2-3 reportes, embeber como link desde el portal.
