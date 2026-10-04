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
const { asincrono } = require('../lib/asincrono');

const router = express.Router();

// GET /api/teachings — i Teaching di cui l'account è titolare in questo tenant ("My Teaching").
router.get('/teachings', asincrono(async (req, res) => {
  res.json(await dominio.getTeachingsPropri(pool, { accountId: req.accountId, tenantId: req.tenantId }));
}));

// GET /api/teachings/:teachingId/pedagogical-units — unità pedagogiche della materia del Teaching.
router.get('/teachings/:teachingId/pedagogical-units', asincrono(async (req, res) => {
  const teachingId = Number(req.params.teachingId);
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'teaching.read', tenantId: req.tenantId,
    ...(await scopeDiTeaching(teachingId, req.tenantId)),
  });
  res.json(await dominio.getPedagogicalUnitsDiTeaching(pool, teachingId, req.tenantId));
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
  res.json(await dominio.getActivitiesDiTeaching(pool, teachingId, req.tenantId));
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
  if (!Number.isInteger(teachingId)) throw datiNonValidi('Identificativo Teaching non valido.');
  if (!Number.isInteger(enrollmentId)) throw datiNonValidi('Identificativo iscrizione non valido.');
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'observation.read', tenantId: req.tenantId,
    ...(await scopeDiTeaching(teachingId, req.tenantId)),
  });
  res.json(await progresso.getProgressoStudenteDiTeaching(pool, { teachingId, enrollmentId, tenantId: req.tenantId }));
}));

// GET /api/teachings/:teachingId/assessments — Assessment del Teaching (pagina "Valutazioni", sola lettura in V1).
router.get('/teachings/:teachingId/assessments', asincrono(async (req, res) => {
  const teachingId = Number(req.params.teachingId);
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'assessment.read', tenantId: req.tenantId,
    ...(await scopeDiTeaching(teachingId, req.tenantId)),
  });
  res.json(await dominio.getAssessmentsDiTeaching(pool, teachingId, req.tenantId));
}));

// GET /api/school-levels — livelli scolastici del tenant attivo (ingresso "Classi" per Coordinatore/Tenant Admin).
// Nessun permesso specifico richiesto oltre a sessione+tenant attivo (già applicati dalla pipeline, vedi
// routes/index.js): sono solo nomi/id di configurazione, non dati protetti — un Coordinatore scoped a UN
// SOLO livello (es. school_level_id=3) non avrebbe altrimenti alcun modo di scoprire nemmeno il proprio,
// dato che il permesso class.read è concesso solo con lo scope di quello specifico livello. L'accesso alle
// risorse vere (classi/studenti di un livello) resta interamente gated al passo successivo.
router.get('/school-levels', asincrono(async (req, res) => {
  res.json(await getSchoolLevels(pool, req.tenantId));
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
  res.json(await dominio.getTeachingsDellaClasse(pool, classId, req.tenantId));
}));

// GET /api/activities/:activityId/griglia — tabella di classe della singola attività.
router.get('/activities/:activityId/griglia', asincrono(async (req, res) => {
  const activityId = Number(req.params.activityId);
  const activityInfo = await dominio.verificaActivityNelTenant(pool, activityId, req.tenantId);
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'observation.read', tenantId: req.tenantId,
    schoolLevelId: activityInfo.school_level_id, classId: activityInfo.class_id, teachingId: activityInfo.teaching_id,
  });
  res.json(await dominio.getGrigliaActivity(pool, { activityId, tenantId: req.tenantId }));
}));

// GET /api/activities/:activityId/report-classe — fotografia della singola attività (niente media mobile).
router.get('/activities/:activityId/report-classe', asincrono(async (req, res) => {
  const activityId = Number(req.params.activityId);
  const activityInfo = await dominio.verificaActivityNelTenant(pool, activityId, req.tenantId);
  await richiedePermesso(pool, {
    accountId: req.accountId, permesso: 'report.read', tenantId: req.tenantId,
    schoolLevelId: activityInfo.school_level_id, classId: activityInfo.class_id, teachingId: activityInfo.teaching_id,
  });
  res.json(await dominio.getReportClasseActivity(pool, { activityId, tenantId: req.tenantId }));
}));

// PUT /api/activities/:activityId/enrollments/:enrollmentId/criteria/:criterionId  body: { valore: number|null }
router.put('/activities/:activityId/enrollments/:enrollmentId/criteria/:criterionId', asincrono(async (req, res) => {
  const activityId = Number(req.params.activityId);
  const enrollmentId = Number(req.params.enrollmentId);
  const criterionId = Number(req.params.criterionId);
  const valore = req.body ? req.body.valore : undefined;
  if (valore !== null && typeof valore !== 'number') {
    throw datiNonValidi('Il campo valore deve essere un numero oppure null (non valutato).');
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

module.exports = router;
