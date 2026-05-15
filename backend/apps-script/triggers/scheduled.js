/**
 * Triggers programados - Concejal360
 *
 * Ejecutar desde el editor de Apps Script:
 *   setupTriggerSesiones12h()  → instala el trigger cada 12h
 *   listarTriggers()           → muestra los triggers activos
 *   removerTriggerSesiones()   → elimina todos los triggers de runSesiones12h
 *   runSesiones12h()           → función que dispara el trigger (también ejecutable manual)
 */

const TRIGGER_HANDLER_SESIONES = 'runSesiones12h';

/**
 * Instala (o reinstala) un time-driven trigger que corre el scraper de sesiones cada 12 horas.
 * Idempotente: elimina cualquier trigger previo del mismo handler antes de crear el nuevo.
 */
function setupTriggerSesiones12h() {
  removerTriggerSesiones();

  const trigger = ScriptApp.newTrigger(TRIGGER_HANDLER_SESIONES)
    .timeBased()
    .everyHours(12)
    .create();

  console.log(`✅ Trigger instalado: ${TRIGGER_HANDLER_SESIONES} cada 12 horas (id=${trigger.getUniqueId()})`);
  return { handler: TRIGGER_HANDLER_SESIONES, intervaloHoras: 12, id: trigger.getUniqueId() };
}

/**
 * Elimina todos los triggers asociados al handler de sesiones.
 */
function removerTriggerSesiones() {
  const triggers = ScriptApp.getProjectTriggers();
  let eliminados = 0;
  for (const t of triggers) {
    if (t.getHandlerFunction() === TRIGGER_HANDLER_SESIONES) {
      ScriptApp.deleteTrigger(t);
      eliminados++;
    }
  }
  if (eliminados > 0) console.log(`🧹 ${eliminados} trigger(s) previo(s) eliminado(s)`);
  return { eliminados };
}

/**
 * Lista todos los triggers del proyecto para diagnóstico.
 */
function listarTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  console.log(`📋 ${triggers.length} trigger(s) activos`);
  return triggers.map(t => {
    const info = {
      handler: t.getHandlerFunction(),
      tipo: String(t.getEventType()),
      id: t.getUniqueId()
    };
    console.log(`  - ${info.handler} | ${info.tipo} | ${info.id}`);
    return info;
  });
}

/**
 * Handler del trigger. Apps Script lo invoca cada 12h.
 * También puede ejecutarse manualmente desde el editor para forzar un run.
 */
function runSesiones12h() {
  console.log('⏰ Trigger 12h → ejecutando ScraperSesiones');
  return ejecutarScraping('sesiones');
}
