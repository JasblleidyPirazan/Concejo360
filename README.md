# Concejal360 🏛️

> Sistema de transparencia y monitoreo del Concejo de Medellín con arquitectura cloud moderna

## 🎯 Visión del Proyecto

**Objetivo**: Democratizar el acceso a la información del Concejo de Medellín mediante un sistema automatizado que extraiga, procese y presente datos de manera ciudadana-céntrica.

**Principios Fundamentales**:
- ✅ **Código limpio y funcional** - Sin complejidad innecesaria
- ✅ **Arquitectura modular** - Cada componente tiene una responsabilidad específica
- ✅ **Cero costos** de infraestructura utilizando Google Workspace
- ✅ **Ciudadanía primero** - Interfaz intuitiva para uso público
- ✅ **Transparencia total** - Código abierto y datos accesibles

## 🏗️ Arquitectura del Sistema

### **Stack Tecnológico**
```
Frontend: Next.js + React + Tailwind CSS
Backend: Google Apps Script (JavaScript)
Database: Google Sheets API
Storage: Google Drive API
Deploy: Netlify (Frontend) + Google Cloud (Backend)
CI/CD: GitHub Actions
```

### **Flujo de Datos**
```
Sitio SIMI → Apps Script Scrapers → Google Sheets → REST API → Frontend React → Ciudadanos
                     ↓
                Google Drive (PDFs)
```

## 📋 Reglas del Sistema

### **🚫 NUNCA Incluir**
- Screenshots o archivos de imagen para debugging
- Logging excesivo (solo errores críticos y métricas)
- Campos redundantes en base de datos
- Funciones que no aporten valor directo al usuario final
- Dependencias pesadas o complejas
- Código duplicado entre módulos

### **✅ SIEMPRE Mantener**
- Funciones puras y pequeñas (máximo 20 líneas)
- Nombres descriptivos y en español para variables de negocio
- Separación clara entre extracción, transformación y almacenamiento
- Validación mínima pero efectiva
- Manejo de errores sin detener el flujo completo
- Documentación inline para lógica compleja

### **🎯 Principios de Código Limpio**
1. **Una responsabilidad por función**
2. **Máximo 3 parámetros por función**
3. **Retorno consistente (siempre objeto con success/error)**
4. **Sin anidación mayor a 3 niveles**
5. **Comentarios solo para "por qué", no para "qué"**

## 🏢 Estructura Modular

### **Backend Structure**
```
backend/apps-script/
├── main.js                 # Orquestador principal y endpoints
├── utils/
│   ├── constants.js        # URLs, configuraciones
│   ├── sheets.js          # Operaciones Google Sheets
│   ├── drive.js           # Operaciones Google Drive  
│   └── validation.js      # Validaciones comunes
├── scrapers/
│   ├── sesiones.js        # Extractor de sesiones
│   ├── proyectos.js       # Extractor de proyectos
│   ├── acuerdos.js        # Extractor de acuerdos
│   ├── comisiones.js      # Extractor de comisiones
│   ├── invitaciones.js    # Extractor de invitaciones
│   └── citaciones.js      # Extractor de citaciones
└── tests/
    └── test-*.js          # Tests unitarios por módulo
```

### **Frontend Structure**
```
frontend/src/
├── components/
│   ├── admin/             # Componentes administrativos
│   ├── citizen/           # Componentes ciudadanos
│   └── shared/            # Componentes reutilizables
├── pages/
│   ├── admin/             # Páginas de administración
│   └── citizen/           # Páginas públicas
└── utils/
    ├── api.js             # Cliente API
    └── helpers.js         # Funciones auxiliares
```

## 🔧 Lógica Modular

### **Patrón de Scraper**
Cada scraper sigue la misma estructura:

```javascript
// Estructura estándar de scraper
const ScraperModulo = {
  // Configuración
  config: {
    url: 'https://sitio-objetivo.com',
    sheetName: 'nombre_hoja',
    campos: ['campo1', 'campo2', 'campo3']
  },

  // Función principal
  ejecutar() {
    try {
      const datos = this.extraer();
      const procesados = this.procesar(datos);
      const guardados = this.guardar(procesados);
      return this.resultado(guardados);
    } catch (error) {
      return this.error(error);
    }
  },

  // Extracción de datos del sitio web
  extraer() {
    // Solo lógica de extracción
    // Retorna array de objetos raw
  },

  // Procesamiento y limpieza
  procesar(datos) {
    // Solo transformaciones
    // Retorna array de objetos limpios
  },

  // Almacenamiento en Sheets
  guardar(datos) {
    // Solo operaciones de guardado
    // Retorna estadísticas
  },

  // Respuesta consistente
  resultado(stats) {
    return {
      success: true,
      procesados: stats.total,
      nuevos: stats.nuevos,
      actualizados: stats.actualizados,
      timestamp: new Date()
    };
  },

  error(error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date()
    };
  }
};
```

### **Patrón de Utilidades**
```javascript
// Utils siguen patrón funcional puro
const SheetsUtils = {
  // Operaciones CRUD básicas
  obtener(sheetName, filtros = {}) { },
  guardar(sheetName, datos) { },
  actualizar(sheetName, id, cambios) { },
  eliminar(sheetName, id) { },
  
  // Operaciones específicas del negocio
  buscarPorNumero(sheetName, numero) { },
  obtenerRecientes(sheetName, dias = 30) { },
  contarPorEstado(sheetName) { }
};
```

## 📊 Estructura de Datos

### **Google Sheets como Database**
```javascript
// Configuración de hojas
const SHEETS_CONFIG = {
  sesiones: {
    nombre: 'sesiones_maestro',
    campos: ['numero', 'fecha', 'hora', 'temas', 'lugar', 'estado'],
    tipos: ['string', 'date', 'string', 'array', 'string', 'string']
  },
  proyectos: {
    nombre: 'proyectos_maestro', 
    campos: ['numero', 'titulo', 'proponentes', 'estado', 'fecha'],
    tipos: ['string', 'string', 'array', 'string', 'date']
  },
  // ... otros módulos
};
```

### **Respuestas API Estándar**
```javascript
// Respuesta exitosa
{
  success: true,
  data: [...],
  pagination: {
    page: 1,
    limit: 50,
    total: 150
  },
  timestamp: "2025-01-24T10:30:00Z"
}

// Respuesta de error
{
  success: false,
  error: "Descripción del error",
  code: "ERROR_CODE",
  timestamp: "2025-01-24T10:30:00Z"
}
```

## 🎯 Criterios de Calidad

### **Para Cualquier Pull Request**
- [ ] Función no excede 20 líneas
- [ ] Nombres descriptivos en español para variables de negocio
- [ ] Sin logging innecesario (solo errores y métricas)
- [ ] Tests unitarios incluidos
- [ ] Documentación actualizada si es necesario
- [ ] Sin duplicación de código

### **Para Scrapers Específicamente**
- [ ] Sigue el patrón estándar (extraer → procesar → guardar)
- [ ] Maneja errores sin romper flujo completo
- [ ] Retorna estadísticas útiles
- [ ] No incluye screenshots o archivos temporales
- [ ] Validación mínima pero efectiva

### **Para Componentes Frontend**
- [ ] Componente reutilizable o específico (ubicación correcta)
- [ ] Props tipadas con PropTypes o TypeScript
- [ ] Estados locales mínimos
- [ ] Accesibilidad básica (ARIA labels)
- [ ] Responsive design

## 🚀 Comandos de Desarrollo

### **Setup Inicial**
```bash
# Clonar y configurar
git clone https://github.com/usuario/concejal360.git
cd concejal360
npm run setup

# Configurar Apps Script
cd backend/apps-script
npm install -g @google/clasp
clasp login
clasp create --type webapp --title "Concejal360"
```

### **Desarrollo**
```bash
# Backend (Apps Script)
npm run dev:backend    # Push cambios a Apps Script
npm run test:backend   # Ejecutar tests
npm run logs:backend   # Ver logs de ejecución

# Frontend
npm run dev:frontend   # Servidor desarrollo local
npm run build:frontend # Build para producción
```

### **Deploy**
```bash
npm run deploy:gas      # Deploy Apps Script
npm run deploy:frontend # Deploy a Netlify (automático con push)
```

## 📋 Workflow de Desarrollo

### **Para Nuevas Funcionalidades**
1. **Branch**: `git checkout -b feature/nombre-descriptivo`
2. **Desarrollar**: Seguir patrones establecidos
3. **Test**: Probar localmente
4. **PR**: Pull Request con descripción clara
5. **Review**: Verificar criterios de calidad
6. **Merge**: Solo después de review aprobado

### **Para Nuevos Scrapers**
1. Copiar template de scraper existente
2. Adaptar URLs y selectores
3. Definir estructura de datos en constants.js
4. Crear tests básicos
5. Probar extracción manual
6. Integrar con sistema principal

### **Para Bugs**
1. **Branch**: `git checkout -b fix/descripcion-bug`
2. **Reproducir**: Crear test que falle
3. **Corregir**: Mínimo cambio necesario
4. **Verificar**: Test pasa + funcionalidad completa
5. **PR**: Con explicación del problema y solución

## 🔍 Debugging y Monitoreo

### **Logs Útiles (Solo estos)**
```javascript
// ✅ SÍ - Métricas importantes
console.log(`✅ Procesadas ${total} sesiones: ${nuevas} nuevas, ${actualizadas} actualizadas`);

// ✅ SÍ - Errores accionables  
console.log(`❌ Error en sesión ${numero}: ${error.message}`);

// ✅ SÍ - Estados del sistema
console.log(`📊 Sistema: ${scrapers.length} scrapers activos, último run: ${ultimaEjecucion}`);

// ❌ NO - Logs verbosos
console.log("Procesando fila 1...");
console.log("Procesando fila 2...");
```

### **Métricas Clave**
- Tiempo de ejecución de scrapers
- Tasa de éxito por scraper  
- Cantidad de datos nuevos vs actualizados
- Errores críticos que requieren atención
- Uso de cuota de Google APIs

## 📞 Contacto y Contribución

**Maintainer**: [Tu nombre]
**Repositorio**: https://github.com/usuario/concejal360
**Issues**: Reportar bugs y solicitar features
**Discusiones**: Para preguntas arquitecturales

### **Contribuidores Bienvenidos**
- Desarrolladores JavaScript/React
- Diseñadores UX/UI
- Especialistas en datos públicos
- Ciudadanos interesados en transparencia

---

**🎯 Recuerda**: Este README es tu guía para mantener el proyecto limpio, funcional y enfocado en agregar valor real a la ciudadanía de Medellín.
