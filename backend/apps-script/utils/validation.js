/**
 * Validaciones mínimas pero efectivas
 * Solo validar lo que previene errores graves
 */

const ValidationUtils = {
  /**
   * Validar datos de sesión
   * @param {Object} sesion - Datos de sesión
   * @returns {boolean} True si es válida
   */
  validarSesion(sesion) {
    return sesion && 
           sesion.numero && 
           sesion.fecha &&
           sesion.estado;
  },

  /**
   * Validar datos de proyecto
   * @param {Object} proyecto - Datos de proyecto
   * @returns {boolean} True si es válido
   */
  validarProyecto(proyecto) {
    return proyecto && 
           proyecto.numero && 
           proyecto.titulo &&
           proyecto.estado;
  },

  /**
   * Limpiar texto básico
   * @param {string} texto - Texto a limpiar
   * @returns {string} Texto limpio
   */
  limpiarTexto(texto) {
    if (!texto) return '';
    return texto.toString().trim().replace(/\s+/g, ' ');
  },

  /**
   * Validar fecha
   * @param {any} fecha - Fecha a validar
   * @returns {boolean} True si es válida
   */
  esFechaValida(fecha) {
    if (!fecha) return false;
    const d = new Date(fecha);
    return d instanceof Date && !isNaN(d);
  }
};