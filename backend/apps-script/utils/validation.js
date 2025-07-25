/**
 * Utilidades de Validación - Concejal360
 * Validaciones mínimas pero efectivas para prevenir errores graves
 * Siguiendo principio: solo validar lo esencial
 */

const ValidationUtils = {
  /**
   * Valida que una sesión tenga los campos mínimos requeridos
   * @param {Object} sesion - Datos de sesión a validar
   * @returns {boolean} True si es válida, false si no
   */
  validarSesion(sesion) {
    if (!sesion) return false;
    
    // Campos obligatorios mínimos
    if (!sesion.numero || sesion.numero.trim() === '') return false;
    if (!sesion.estado || sesion.estado.trim() === '') return false;
    
    // Fecha opcional pero si existe debe ser válida
    if (sesion.fecha && !this.esFechaValida(sesion.fecha)) return false;
    
    return true;
  },

  /**
   * Valida que un proyecto tenga los campos mínimos requeridos
   * @param {Object} proyecto - Datos de proyecto a validar
   * @returns {boolean} True si es válido, false si no
   */
  validarProyecto(proyecto) {
    if (!proyecto) return false;
    
    // Campos obligatorios mínimos
    if (!proyecto.numero || proyecto.numero.trim() === '') return false;
    if (!proyecto.titulo || proyecto.titulo.trim() === '') return false;
    if (!proyecto.estado || proyecto.estado.trim() === '') return false;
    
    return true;
  },

  /**
   * Valida que un acuerdo tenga los campos mínimos requeridos
   * @param {Object} acuerdo - Datos de acuerdo a validar
   * @returns {boolean} True si es válido, false si no
   */
  validarAcuerdo(acuerdo) {
    if (!acuerdo) return false;
    
    // Campos obligatorios mínimos
    if (!acuerdo.numero || acuerdo.numero.trim() === '') return false;
    if (!acuerdo.titulo || acuerdo.titulo.trim() === '') return false;
    
    return true;
  },

  /**
   * Limpia texto eliminando espacios extra y caracteres problemáticos
   * @param {any} texto - Texto a limpiar (puede ser cualquier tipo)
   * @returns {string} Texto limpio
   */
  limpiarTexto(texto) {
    if (!texto) return '';
    
    return texto.toString()
               .trim()                    // Eliminar espacios al inicio/final
               .replace(/\s+/g, ' ')      // Múltiples espacios -> uno solo
               .replace(/&nbsp;/g, ' ')   // HTML non-breaking space
               .replace(/[\r\n\t]/g, ' '); // Saltos de línea y tabs
  },

  /**
   * Valida que una fecha sea válida
   * @param {any} fecha - Fecha a validar (Date, string, etc.)
   * @returns {boolean} True si es una fecha válida
   */
  esFechaValida(fecha) {
    if (!fecha) return false;
    
    // Si ya es un Date object
    if (fecha instanceof Date) {
      return !isNaN(fecha.getTime());
    }
    
    // Si es string, intentar convertir
    try {
      const d = new Date(fecha);
      return d instanceof Date && !isNaN(d.getTime());
    } catch (error) {
      return false;
    }
  },

  /**
   * Valida número de documento/expediente
   * @param {string} numero - Número a validar
   * @returns {boolean} True si tiene formato válido
   */
  validarNumero(numero) {
    if (!numero) return false;
    
    const numeroLimpio = this.limpiarTexto(numero);
    
    // Debe tener al menos 1 carácter y no estar vacío
    return numeroLimpio.length > 0 && numeroLimpio !== '';
  },

  /**
   * Valida email básico
   * @param {string} email - Email a validar
   * @returns {boolean} True si tiene formato válido
   */
  validarEmail(email) {
    if (!email) return false;
    
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(email.trim());
  },

  /**
   * Valida URL básica
   * @param {string} url - URL a validar
   * @returns {boolean} True si tiene formato válido
   */
  validarUrl(url) {
    if (!url) return false;
    
    try {
      new URL(url);
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * Sanitiza texto para evitar problemas en Sheets
   * @param {string} texto - Texto a sanitizar
   * @returns {string} Texto sanitizado
   */
  sanitizarTexto(texto) {
    if (!texto) return '';
    
    return this.limpiarTexto(texto)
               .replace(/['"]/g, '')      // Eliminar comillas
               .replace(/[<>]/g, '')      // Eliminar < >
               .substring(0, 500);        // Limitar longitud
  },

  /**
   * Normaliza estado para consistencia
   * @param {string} estado - Estado a normalizar
   * @returns {string} Estado normalizado
   */
  normalizarEstado(estado) {
    if (!estado) return 'Desconocido';
    
    const estadoLimpio = this.limpiarTexto(estado).toLowerCase();
    
    // Mapear estados comunes
    const mapeoEstados = {
      'programada': 'Programada',
      'realizada': 'Realizada',
      'pendiente': 'Pendiente',
      'aprobado': 'Aprobado',
      'rechazado': 'Rechazado',
      'en_tramite': 'En Trámite',
      'archivado': 'Archivado'
    };
    
    return mapeoEstados[estadoLimpio] || this.limpiarTexto(estado);
  }
};

// === FUNCIONES DE TEST PARA VALIDACIONES ===

/**
 * Test completo de todas las validaciones
 */
function testValidacionesCompletas() {
  console.log("🧪 === TEST VALIDACIONES COMPLETAS ===");
  
  let testsPasados = 0;
  let testsTotal = 0;
  
  // Test 1: Sesión válida
  testsTotal++;
  const sesionValida = {
    numero: "296",
    fecha: new Date("2025-07-31"),
    estado: "Programada"
  };
  
  if (ValidationUtils.validarSesion(sesionValida)) {
    console.log("✅ Test 1: Sesión válida PASÓ");
    testsPasados++;
  } else {
    console.log("❌ Test 1: Sesión válida FALLÓ");
  }
  
  // Test 2: Sesión inválida (sin número)
  testsTotal++;
  const sesionInvalida = {
    fecha: new Date(),
    estado: "Programada"
  };
  
  if (!ValidationUtils.validarSesion(sesionInvalida)) {
    console.log("✅ Test 2: Sesión inválida correctamente rechazada");
    testsPasados++;
  } else {
    console.log("❌ Test 2: Sesión inválida incorrectamente aceptada");
  }
  
  // Test 3: Limpieza de texto
  testsTotal++;
  const textoSucio = "   Texto  con   espacios&nbsp;extra   ";
  const textoLimpio = ValidationUtils.limpiarTexto(textoSucio);
  
  if (textoLimpio === "Texto con espacios extra") {
    console.log("✅ Test 3: Limpieza de texto PASÓ");
    testsPasados++;
  } else {
    console.log(`❌ Test 3: Limpieza falló. Esperado: "Texto con espacios extra", Obtenido: "${textoLimpio}"`);
  }
  
  // Test 4: Validación de fecha
  testsTotal++;
  const fechaValida = new Date("2025-07-31");
  
  if (ValidationUtils.esFechaValida(fechaValida)) {
    console.log("✅ Test 4: Fecha válida PASÓ");
    testsPasados++;
  } else {
    console.log("❌ Test 4: Fecha válida FALLÓ");
  }
  
  // Test 5: Fecha inválida
  testsTotal++;
  const fechaInvalida = new Date("fecha-inválida");
  
  if (!ValidationUtils.esFechaValida(fechaInvalida)) {
    console.log("✅ Test 5: Fecha inválida correctamente rechazada");
    testsPasados++;
  } else {
    console.log("❌ Test 5: Fecha inválida incorrectamente aceptada");
  }
  
  // Test 6: Proyecto válido
  testsTotal++;
  const proyectoValido = {
    numero: "PA-123-2025",
    titulo: "Proyecto de Acuerdo sobre transparencia",
    estado: "En Trámite"
  };
  
  if (ValidationUtils.validarProyecto(proyectoValido)) {
    console.log("✅ Test 6: Proyecto válido PASÓ");
    testsPasados++;
  } else {
    console.log("❌ Test 6: Proyecto válido FALLÓ");
  }
  
  // Resumen
  console.log(`\n📊 RESUMEN: ${testsPasados}/${testsTotal} tests pasados`);
  
  if (testsPasados === testsTotal) {
    console.log("🎉 ¡Todas las validaciones funcionan correctamente!");
  } else {
    console.log("⚠️ Algunas validaciones necesitan corrección");
  }
  
  return {
    success: testsPasados === testsTotal,
    pasados: testsPasados,
    total: testsTotal,
    porcentaje: Math.round((testsPasados / testsTotal) * 100)
  };
}

/**
 * Test específico para datos reales de sesiones
 */
function testValidacionSesionesReales() {
  console.log("🧪 === TEST VALIDACIÓN SESIONES REALES ===");
  
  // Datos que simularían venir del scraper real
  const sesionesTest = [
    {
      numero: "296",
      fecha: "jueves, 31 de julio de 2025", // String antes de procesar
      hora: "09:00 a.m.",
      temas: ["Citación"],
      lugar: "Recinto de sesiones",
      estado: "Programada",
      tiene_acta: false
    },
    {
      numero: "", // Número vacío - debe fallar
      fecha: "viernes, 25 de julio de 2025",
      estado: "Programada"
    },
    {
      numero: "295",
      fecha: null, // Fecha nula - debe pasar (es opcional)
      estado: "Pendiente"
    }
  ];
  
  let validaciones = 0;
  
  for (let i = 0; i < sesionesTest.length; i++) {
    const sesion = sesionesTest[i];
    const esValida = ValidationUtils.validarSesion(sesion);
    
    console.log(`📋 Sesión ${i + 1}:`);
    console.log(`  Número: "${sesion.numero}"`);
    console.log(`  Estado: "${sesion.estado}"`);
    console.log(`  ¿Es válida? ${esValida}`);
    
    if (esValida) validaciones++;
  }
  
  console.log(`\n✅ ${validaciones}/${sesionesTest.length} sesiones pasaron validación`);
  
  return {
    validadas: validaciones,
    total: sesionesTest.length
  };
}