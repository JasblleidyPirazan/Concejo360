/**
 * Utilidades para operaciones con Google Drive
 * Solo para manejo de PDFs de actas
 */

const DriveUtils = {
  /**
   * Verificar si un archivo PDF ya existe
   * @param {string} nombreArchivo - Nombre del archivo a verificar
   * @returns {boolean} True si existe
   */
  existeArchivo(nombreArchivo) {
    try {
      const folder = DriveApp.getFolderById(GOOGLE_IDS.driveFolder);
      const files = folder.getFilesByName(nombreArchivo);
      return files.hasNext();
    } catch (error) {
      console.log(`❌ Error verificando archivo: ${error.message}`);
      return false;
    }
  },

  /**
   * Obtener URL de un archivo PDF
   * @param {string} nombreArchivo - Nombre del archivo
   * @returns {string|null} URL del archivo o null
   */
  obtenerUrlArchivo(nombreArchivo) {
    try {
      const folder = DriveApp.getFolderById(GOOGLE_IDS.driveFolder);
      const files = folder.getFilesByName(nombreArchivo);
      
      if (files.hasNext()) {
        return files.next().getUrl();
      }
      return null;
    } catch (error) {
      console.log(`❌ Error obteniendo URL: ${error.message}`);
      return null;
    }
  },

  /**
   * Listar archivos PDF recientes
   * @param {number} dias - Días hacia atrás
   * @returns {Array} Lista de archivos
   */
  obtenerArchivosRecientes(dias = 30) {
    try {
      const folder = DriveApp.getFolderById(GOOGLE_IDS.driveFolder);
      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - dias);
      
      const files = folder.getFiles();
      const archivos = [];
      
      while (files.hasNext()) {
        const file = files.next();
        if (file.getDateCreated() >= fechaLimite) {
          archivos.push({
            nombre: file.getName(),
            fecha: file.getDateCreated(),
            url: file.getUrl(),
            tamaño: file.getSize()
          });
        }
      }
      
      return archivos.sort((a, b) => b.fecha - a.fecha);
    } catch (error) {
      console.log(`❌ Error listando archivos: ${error.message}`);
      return [];
    }
  }
};