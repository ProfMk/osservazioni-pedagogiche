'use strict';

/**
 * Dominio operativo: Teaching -> Activity -> Observation -> Report classe,
 * più la creazione di RoleAssignment (sez. 28-34, 16).
 *
 * Ogni endpoint che legge/scrive una risorsa del dominio risolve PRIMA
 * l'intera catena di scope della risorsa (tenant/schoolLevel/class/teaching)
 * a partire SOLO dall'id ricevuto (mai dai valori inviati dal client per
 * l'ambito) e la passa a richiedePermesso: così un TEACHER (scope TEACHING),
 * un COORDINATOR (scope SCHOOL_LEVEL) e un TENANT_ADMIN (scope TENANT)
 * risultano tutti autorizzati dalla stessa chiamata, senza casi speciali.
 */
const express = require('express');
const { pool, transazione } = require('../db');
const { richiedePermesso } = require('../lib/autorizzazione');
const { registraAudit } = require('../lib/audit');
const dominio = require('../queries/dominio');
const progresso = require('../queries/progresso');
const { getSchoolLevels } = require('../queries/configurazione');
const { creaRoleAssignment } = require('../queries/rbac');
const { datiNonValidi } = require('../lib/erroreApplicativo');
const { lingueAbilitate, risolviLinguaTenant, aggiornaLinguaSessione } = require('../lib/lingua');
const { CAMPI, salvaTraduzione, completezzaTraduzioni } = require('../lib/contenuti');
const { traduttoreDi } = require('../lib/pubblicazione');
const { asincrono } = require('../lib/asincrono');

const router = express.Router();

// GET /api/teachings — Teaching del percorso unico (P15): propri e leggibili per scope (classe/livello/tenant/piattaforma).
router.get('/teachings', asincrono(async (req, res) => {
  res.json(await dominio.getTeachingsPropri(pool, { accountId: req.accountId, tenantId: req.tenantId, lingua: req.lingua }));
}));

// GET /api/teachings/:teachingId/pedagogical-units — unità pedagogiche della materia del Teaching.
router.get('/teachings/:teachingId/pedagogical-units', asincrono(async (req, res) => {
  const teachingId = Number(req.params.teachingId);
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'teaching.read', tenantId: req.tenantId,
    ...(await scopeDiTeaching(teachingId, req.tenantId)),
  });
  res.json(await dominio.getPedagogicalUnitsDiTeaching(pool, teachingId, req.tenantId, req.lingua));
}));

async function scopeDiTeaching(teachingId, tenantId) {
  const teaching = await dominio.verificaTeachingNelTenant(pool, teachingId, tenantId);
  return { schoolLevelId: teaching.school_level_id, classId: teaching.class_id, teachingId: teaching.id };
}

// GET /api/teachings/:teachingId/activities
router.get('/teachings/:teachingId/activities', asincrono(async (req, res) => {
  const teachingId = Number(req.params.teachingId);
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'activity.read', tenantId: req.tenantId,
    ...(await scopeDiTeaching(teachingId, req.tenantId)),
  });
  res.json(await dominio.getActivitiesDiTeaching(pool, teachingId, req.tenantId, req.lingua));
}));

// POST /api/teachings/:teachingId/activities  body: { nome, dataAttivita: 'YYYY-MM-DD', pedagogicalUnitId }
router.post('/teachings/:teachingId/activities', asincrono(async (req, res) => {
  const teachingId = Number(req.params.teachingId);
  const { nome, dataAttivita, pedagogicalUnitId } = req.body || {};
  const risultato = await transazione(async (client) => {
    const teaching = await dominio.verificaTeachingNelTenant(client, teachingId, req.tenantId);
    await richiedePermesso(client, {
      accountId: req.accountId, permesso: 'activity.create', tenantId: req.tenantId,
      schoolLevelId: teaching.school_level_id, classId: teaching.class_id, teachingId,
    });
    return dominio.creaActivity(client, {
      teachingId, tenantId: req.tenantId, nome, dataAttivita, pedagogicalUnitId: Number(pedagogicalUnitId),
      // Contenuto d'autore: registrato nella lingua della sessione in cui è scritto (B).
      linguaContenuto: req.lingua.lingua,
    });
  });
  res.status(201).json(risultato);
}));

// GET /api/teachings/:teachingId/students — roster della classe del Teaching (pagina "Studenti" del docente).
router.get('/teachings/:teachingId/students', asincrono(async (req, res) => {
  const teachingId = Number(req.params.teachingId);
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'observation.read', tenantId: req.tenantId,
    ...(await scopeDiTeaching(teachingId, req.tenantId)),
  });
  res.json(await dominio.getStudentiDiTeaching(pool, teachingId, req.tenantId));
}));

// GET /api/teachings/:teachingId/students/:enrollmentId/progress — avanzamento pedagogico dello studente
// (storico per criterio + media mobile delle ultime 3 osservazioni). Stesso permesso/scope del roster:
// l'iscrizione è poi verificata lato server contro classe/anno/tenant del Teaching.
router.get('/teachings/:teachingId/students/:enrollmentId/progress', asincrono(async (req, res) => {
  const teachingId = Number(req.params.teachingId);
  const enrollmentId = Number(req.params.enrollmentId);
  if (!Number.isInteger(teachingId)) throw datiNonValidi('ERR_INVALID_IDENTIFIER', { campo: 'UI_FIELD_TEACHING_ID' });
  if (!Number.isInteger(enrollmentId)) throw datiNonValidi('ERR_INVALID_IDENTIFIER', { campo: 'UI_FIELD_ENROLLMENT_ID' });
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'observation.read', tenantId: req.tenantId,
    ...(await scopeDiTeaching(teachingId, req.tenantId)),
  });
  res.json(await progresso.getProgressoStudenteDiTeaching(pool, { teachingId, enrollmentId, tenantId: req.tenantId, lingua: req.lingua }));
}));

// GET /api/teachings/:teachingId/class-overview — quadro classe (VIEW_CLASS_OVERVIEW, P11).
router.get('/teachings/:teachingId/class-overview', asincrono(async (req, res) => {
  const teachingId = Number(req.params.teachingId);
  if (!Number.isInteger(teachingId)) throw datiNonValidi('ERR_INVALID_IDENTIFIER', { campo: 'UI_FIELD_TEACHING_ID' });
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'report.read', tenantId: req.tenantId,
    ...(await scopeDiTeaching(teachingId, req.tenantId)),
  });
  res.json(await progresso.getQuadroClasse(pool, { teachingId, tenantId: req.tenantId, lingua: req.lingua }));
}));

// GET /api/teachings/:teachingId/students-matrix — matrice alunni × nuclei (VIEW_STUDENTS, P12).
router.get('/teachings/:teachingId/students-matrix', asincrono(async (req, res) => {
  const teachingId = Number(req.params.teachingId);
  if (!Number.isInteger(teachingId)) throw datiNonValidi('ERR_INVALID_IDENTIFIER', { campo: 'UI_FIELD_TEACHING_ID' });
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'observation.read', tenantId: req.tenantId,
    ...(await scopeDiTeaching(teachingId, req.tenantId)),
  });
  res.json(await progresso.getMatriceStudenti(pool, { teachingId, tenantId: req.tenantId, lingua: req.lingua }));
}));

// GET /api/teachings/:teachingId/assessments — VIEW_ASSESSMENT: timbro, periodo, autore, evidenza del periodo (P13).
router.get('/teachings/:teachingId/assessments', asincrono(async (req, res) => {
  const teachingId = Number(req.params.teachingId);
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'assessment.read', tenantId: req.tenantId,
    ...(await scopeDiTeaching(teachingId, req.tenantId)),
  });
  res.json(await progresso.getValutazioniDiTeaching(pool, { teachingId, tenantId: req.tenantId, lingua: req.lingua }));
}));

// GET /api/school-levels — livelli scolastici del tenant attivo (ingresso "Classi" per Coordinatore/Tenant Admin).
// Nessun permesso specifico richiesto oltre a sessione+tenant attivo (già applicati dalla pipeline, vedi
// routes/index.js): sono solo nomi/id di configurazione, non dati protetti — un Coordinatore scoped a UN
// SOLO livello (es. school_level_id=3) non avrebbe altrimenti alcun modo di scoprire nemmeno il proprio,
// dato che il permesso class.read è concesso solo con lo scope di quello specifico livello. L'accesso alle
// risorse vere (classi/studenti di un livello) resta interamente gated al passo successivo.
router.get('/school-levels', asincrono(async (req, res) => {
  const tr = await traduttoreDi(pool, req.lingua);
  res.json((await getSchoolLevels(pool, req.tenantId)).map((l) => ({ ...l, nome: tr.testo('school_levels.nome', l.id, l.nome) })));
}));

// GET /api/school-levels/:schoolLevelId/classes — classi di un livello scolastico.
router.get('/school-levels/:schoolLevelId/classes', asincrono(async (req, res) => {
  const schoolLevelId = Number(req.params.schoolLevelId);
  await dominio.verificaSchoolLevelNelTenant(pool, schoolLevelId, req.tenantId); // 404 prima di 403: coerente col resto delle rotte
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'class.read', tenantId: req.tenantId, schoolLevelId,
  });
  res.json(await dominio.getClassiDelloSchoolLevel(pool, schoolLevelId, req.tenantId));
}));

// GET /api/classes/:classId/students — roster di una classe (Coordinatore/Tenant Admin).
router.get('/classes/:classId/students', asincrono(async (req, res) => {
  const classId = Number(req.params.classId);
  const classe = await dominio.verificaClasseNelTenant(pool, classId, req.tenantId);
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'class.read', tenantId: req.tenantId, schoolLevelId: classe.school_level_id, classId,
  });
  res.json(await dominio.getStudentiDellaClasse(pool, classId, req.tenantId));
}));

// GET /api/classes/:classId/teachings — Teaching attivi su una classe, qualunque docente (Coordinatore/Tenant Admin).
router.get('/classes/:classId/teachings', asincrono(async (req, res) => {
  const classId = Number(req.params.classId);
  const classe = await dominio.verificaClasseNelTenant(pool, classId, req.tenantId);
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'class.read', tenantId: req.tenantId, schoolLevelId: classe.school_level_id, classId,
  });
  res.json(await dominio.getTeachingsDellaClasse(pool, classId, req.tenantId, req.lingua));
}));

// GET /api/activities/:activityId/griglia — tabella di classe della singola attività.
router.get('/activities/:activityId/griglia', asincrono(async (req, res) => {
  const activityId = Number(req.params.activityId);
  const activityInfo = await dominio.verificaActivityNelTenant(pool, activityId, req.tenantId);
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'observation.read', tenantId: req.tenantId,
    schoolLevelId: activityInfo.school_level_id, classId: activityInfo.class_id, teachingId: activityInfo.teaching_id,
  });
  res.json(await dominio.getGrigliaActivity(pool, { activityId, tenantId: req.tenantId, lingua: req.lingua }));
}));

// GET /api/activities/:activityId/report-classe — esito dell'attività (VIEW_ACTIVITY_OUTCOME): niente media mobile.
router.get('/activities/:activityId/report-classe', asincrono(async (req, res) => {
  const activityId = Number(req.params.activityId);
  const activityInfo = await dominio.verificaActivityNelTenant(pool, activityId, req.tenantId);
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'report.read', tenantId: req.tenantId,
    schoolLevelId: activityInfo.school_level_id, classId: activityInfo.class_id, teachingId: activityInfo.teaching_id,
  });
  res.json(await dominio.getReportClasseActivity(pool, { activityId, tenantId: req.tenantId, lingua: req.lingua }));
}));

// PUT /api/activities/:activityId/enrollments/:enrollmentId/criteria/:criterionId  body: { valore: number|null }
router.put('/activities/:activityId/enrollments/:enrollmentId/criteria/:criterionId', asincrono(async (req, res) => {
  const activityId = Number(req.params.activityId);
  const enrollmentId = Number(req.params.enrollmentId);
  const criterionId = Number(req.params.criterionId);
  const valore = req.body ? req.body.valore : undefined;
  if (valore !== null && typeof valore !== 'number') {
    throw datiNonValidi('ERR_OBSERVATION_VALUE_INVALID');
  }

  const risultato = await transazione(async (client) => {
    const activityInfo = await dominio.verificaActivityNelTenant(client, activityId, req.tenantId);
    await richiedePermesso(client, {
      accountId: req.accountId, permesso: 'observation.create', tenantId: req.tenantId,
      schoolLevelId: activityInfo.school_level_id, classId: activityInfo.class_id, teachingId: activityInfo.teaching_id,
    });

    const { rows: primaRows } = await client.query(
      'SELECT valore FROM observations WHERE activity_id = $1 AND enrollment_id = $2 AND criterion_id = $3',
      [activityId, enrollmentId, criterionId]
    );
    const prima = primaRows[0] ? { valore: primaRows[0].valore } : null;

    const esito = await dominio.salvaObservation(client, {
      activityId, enrollmentId, criterionId, valore, tenantId: req.tenantId,
      accountId: req.accountId, dataOsservazione: req.body.dataOsservazione,
    });

    // Audit transazionale (sez. 40/42): stessa transazione della mutazione, prima e dopo salvati come JSON.
    await registraAudit(client, {
      tenantId: req.tenantId,
      actorAccountId: req.accountId,
      azione: esito.eliminato ? 'observation.delete' : 'observation.upsert',
      risorsa: 'observation',
      risorsaId: esito.observationId || (primaRows[0] ? enrollmentId : null),
      prima,
      dopo: esito.eliminato ? null : { valore },
    });
    return esito;
  });
  res.json(risultato);
}));

// POST /api/role-assignments  body: { accountId, roleCodice, scopeType, tenantId, scopeIds }
// L'autorizzazione ("non si può concedere più di quanto si possiede", sez. 16) è
// interamente in queries/rbac.js: qui si aggiunge solo la registrazione in audit.
router.post('/role-assignments', asincrono(async (req, res) => {
  const { accountId, roleCodice, scopeType, tenantId, scopeIds } = req.body || {};
  const risultato = await transazione(async (client) => {
    const creato = await creaRoleAssignment(client, {
      creatoreAccountId: req.accountId, accountId: Number(accountId), roleCodice, scopeType,
      tenantId: tenantId ? Number(tenantId) : null, scopeIds: scopeIds || {},
    });
    await registraAudit(client, {
      tenantId: tenantId ? Number(tenantId) : null,
      actorAccountId: req.accountId,
      azione: 'role_assignment.create',
      risorsa: 'role_assignment',
      risorsaId: creato.id,
      dopo: { accountId, roleCodice, scopeType, tenantId, scopeIds },
    });
    return creato;
  });
  res.status(201).json(risultato);
}));

// PUT /api/me/lingua  body: { lingua } — preferenza linguistica dell'utente per il tenant attivo (C2).
// Non è un parametro di richiesta: è una preferenza persistente, accettata solo se la lingua è abilitata
// nel tenant. La lingua della sessione viene subito rivalutata dal server.
router.put('/me/lingua', asincrono(async (req, res) => {
  const lingua = req.body ? req.body.lingua : undefined;
  const abilitate = (await lingueAbilitate(pool, req.tenantId)).map((l) => l.codice);
  if (typeof lingua !== 'string' || !abilitate.includes(lingua)) throw datiNonValidi('ERR_LANGUAGE_NOT_ENABLED');
  const risultato = await transazione(async (client) => {
    const { rowCount } = await client.query(
      "UPDATE memberships SET lingua_preferita = $1 WHERE account_id = $2 AND tenant_id = $3 AND stato = 'attiva'",
      [lingua, req.accountId, req.tenantId]
    );
    if (rowCount === 0) throw datiNonValidi('ERR_LANGUAGE_PREFERENCE_UNAVAILABLE');
    const contesto = await risolviLinguaTenant(client, { accountId: req.accountId, tenantId: req.tenantId });
    await aggiornaLinguaSessione(client, req.sessione.id, contesto.lingua);
    return { lingua: contesto.lingua, direzione: contesto.direzione, locale: contesto.locale };
  });
  res.json(risultato);
}));

// GET /api/admin/traduzioni/completezza — completezza delle traduzioni dei contenuti per lingua abilitata (B-6).
router.get('/admin/traduzioni/completezza', asincrono(async (req, res) => {
  await richiedePermesso(pool, { accountId: req.accountId, permesso: 'tenant.manage_config', tenantId: req.tenantId });
  const lingue = (await lingueAbilitate(pool, req.tenantId)).map((l) => l.codice);
  res.json({
    linguaOrigine: req.lingua.linguaOrigine,
    lingue: await completezzaTraduzioni(pool, { tenantId: req.tenantId, linguaOrigine: req.lingua.linguaOrigine, lingue }),
  });
}));

// PUT /api/admin/traduzioni  body: { campo, riferimento, lingua, testo } — traduzione di un contenuto
// pedagogico (B). Sottoposta ad audit nella stessa transazione (B-5). Isolamento: le FK composte di
// content_translations rifiutano qualunque riferimento a un oggetto di un altro tenant.
router.put('/admin/traduzioni', asincrono(async (req, res) => {
  const { campo, riferimento, lingua, testo } = req.body || {};
  if (!CAMPI[campo]) throw datiNonValidi('ERR_TRANSLATION_FIELD_UNKNOWN');
  const valori = [].concat(riferimento);
  if (valori.length !== CAMPI[campo].colonne.length || !valori.every((v) => Number.isInteger(v))) {
    throw datiNonValidi('ERR_INVALID_IDENTIFIER', { campo: 'UI_FIELD_RIFERIMENTO' });
  }
  if (typeof testo !== 'string' || testo.trim() === '') throw datiNonValidi('ERR_REQUIRED_FIELD', { campo: 'UI_FIELD_TESTO' });
  const abilitate = (await lingueAbilitate(pool, req.tenantId)).map((l) => l.codice);
  if (!abilitate.includes(lingua) || lingua === req.lingua.linguaOrigine) throw datiNonValidi('ERR_LANGUAGE_NOT_ENABLED');
  const risultato = await transazione(async (client) => {
    await richiedePermesso(client, { accountId: req.accountId, permesso: 'tenant.manage_config', tenantId: req.tenantId });
    const salvata = await salvaTraduzione(client, {
      tenantId: req.tenantId, lingua, campo, riferimento: valori, testo: testo.trim(), accountId: req.accountId,
    });
    await registraAudit(client, {
      tenantId: req.tenantId,
      actorAccountId: req.accountId,
      azione: salvata.prima ? 'content_translation.update' : 'content_translation.create',
      risorsa: 'content_translation',
      risorsaId: salvata.id,
      prima: salvata.prima,
      dopo: { campo, riferimento: valori, lingua, testo: testo.trim() },
    });
    return { id: salvata.id };
  });
  res.json(risultato);
}));

module.exports = router;
