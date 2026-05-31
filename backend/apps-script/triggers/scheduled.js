/**
 * Triggers programados - Concejal360
 *
 * Ejecutar desde el editor de Apps Script:
 *   setupTriggerSesiones12h()        → instala el trigger cada 12h
 *   setupTriggerAcuerdosTiempos()    → instala trigger cada 5 min hasta completar backfill
 *   removerTriggerAcuerdosTiempos()  → elimina el trigger de acuerdos_tiempos
 *   listarTriggers()                 → muestra los triggers activos
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

// ─── Backfill acuerdos_tiempos ────────────────────────────────────────────────
// Uso:
//   1) Ejecutar setupTriggerAcuerdosTiempos() UNA sola vez desde el editor.
//   2) El trigger corre runAcuerdosTiempos() cada 5 min automáticamente.
//   3) Cuando termina el backfill, el trigger se elimina solo.

const TRIGGER_HANDLER_ACUERDOS_TIEMPOS = 'runAcuerdosTiempos';

/**
 * Instala un trigger cada 5 min que corre el scraper de tiempos en cadena.
 * Llamar UNA sola vez; se auto-elimina al terminar el backfill.
 */
function setupTriggerAcuerdosTiempos() {
  removerTriggerAcuerdosTiempos();
  const trigger = ScriptApp.newTrigger(TRIGGER_HANDLER_ACUERDOS_TIEMPOS)
    .timeBased()
    .everyMinutes(5)
    .create();
  console.log(`✅ Trigger instalado: ${TRIGGER_HANDLER_ACUERDOS_TIEMPOS} cada 5 min (id=${trigger.getUniqueId()})`);
  return { handler: TRIGGER_HANDLER_ACUERDOS_TIEMPOS, intervaloMinutos: 5, id: trigger.getUniqueId() };
}

function removerTriggerAcuerdosTiempos() {
  const triggers = ScriptApp.getProjectTriggers();
  let eliminados = 0;
  for (const t of triggers) {
    if (t.getHandlerFunction() === TRIGGER_HANDLER_ACUERDOS_TIEMPOS) {
      ScriptApp.deleteTrigger(t);
      eliminados++;
    }
  }
  if (eliminados > 0) console.log(`🧹 ${eliminados} trigger(s) de acuerdos_tiempos eliminado(s)`);
  return { eliminados };
}

/**
 * Handler invocado por el trigger cada 5 min.
 * Corre el scraper y, si el backfill terminó (resume offset limpio), elimina el trigger.
 */
function runAcuerdosTiempos() {
  console.log('⏰ Trigger → ScraperAcuerdosTiempos');
  ScraperAcuerdosTiempos.ejecutar();

  const offsetPendiente = PropertiesService.getScriptProperties()
    .getProperty(ScraperAcuerdosTiempos.RESUME_KEY);
  if (!offsetPendiente) {
    console.log('🎉 Backfill acuerdos_tiempos completo — eliminando trigger');
    removerTriggerAcuerdosTiempos();
  } else {
    console.log(`⏳ Backfill continúa (offset=${offsetPendiente}) — próxima ejecución en 5 min`);
  }
}
