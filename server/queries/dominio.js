'use strict';

/**
 * Dominio operativo (sez. 28-34): Teaching, Activity, Observation, e il
 * Report classe (fotografia di una singola attività, senza media mobile —
 * stessa scelta già validata nel prototipo, qui riportata sul nuovo schema
 * multi-tenant). L'avanzamento pedagogico del singolo studente nel tempo
 * (media mobile delle ultime osservazioni per criterio) è separato e vive in
 * server/queries/progresso.js.
 */

const { nonTrovato, datiNonValidi } = require('../lib/erroreApplicativo');
const { getCriteria, getScalaApplicabile, getBandeGiudizio } = require('./configurazione');
const { calcolaEsito, mediaSemplicePercentuali } = require('../lib/calcoloEsiti');
const { preparaBande, giudizioDi } = require('../lib/calcoloProgresso');

/** I Teaching di cui l'account è titolare (account_id sul Teaching stesso), in un tenant. */
async function getTeachingsPropri(client, { accountId, tenantId }) {
  const { rows } = await client.query(
    `SELECT t.id AS teaching_id, cl.nome AS classe, s.nome AS materia, sy.nome AS anno_scolastico, cl.id AS class_id, s.id AS subject_id
     FROM teachings t
     JOIN classes cl ON cl.id = t.class_id
     JOIN subjects s ON s.id = t.subject_id
     JOIN school_years sy ON sy.id = t.school_year_id
     WHERE t.account_id = $1 AND t.tenant_id = $2 AND t.stato = 'attivo'
     ORDER BY sy.nome DESC, s.nome, cl.nome`,
    [accountId, tenantId]
  );
  return rows;
}

/** Tutti i Teaching di un tenant (per COORDINATOR/TENANT_ADMIN, dopo aver verificato il permesso 'teaching.read'). */
async function getTeachingsDelTenant(client, tenantId) {
  const { rows } = await client.query(
    `SELECT t.id AS teaching_id, cl.nome AS classe, s.nome AS materia, sy.nome AS anno_scolastico,
            p.nome AS docente_nome, p.cognome AS docente_cognome
     FROM teachings t
     JOIN classes cl ON cl.id = t.class_id
     JOIN subjects s ON s.id = t.subject_id
     JOIN school_years sy ON sy.id = t.school_year_id
     JOIN accounts a ON a.id = t.account_id
     JOIN people p ON p.id = a.person_id
     WHERE t.tenant_id = $1 AND t.stato = 'attivo'
     ORDER BY sy.nome DESC, s.nome, cl.nome`,
    [tenantId]
  );
  return rows;
}

/** Verifica che il Teaching appartenga al tenant indicato (mai fidarsi solo dell'id ricevuto dal client). */
async function verificaTeachingNelTenant(client, teachingId, tenantId) {
  const { rows } = await client.query(
    `SELECT t.id, t.tenant_id, t.school_year_id, t.class_id, t.subject_id, t.account_id, cl.school_level_id,
            s.nome AS materia, cl.nome AS classe
     FROM teachings t JOIN subjects s ON s.id = t.subject_id JOIN classes cl ON cl.id = t.class_id
     WHERE t.id = $1 AND t.tenant_id = $2`,
    [teachingId, tenantId]
  );
  if (rows.length === 0) throw nonTrovato('Teaching non trovato o non accessibile in questo tenant.');
  return rows[0];
}

/** Unità pedagogiche disponibili per la materia di un Teaching (uniche opzioni per creare un'Activity, sez. 29). */
async function getPedagogicalUnitsDiTeaching(client, teachingId, tenantId) {
  const teaching = await verificaTeachingNelTenant(client, teachingId, tenantId);
  const { rows } = await client.query(
    "SELECT id, nome, ordine FROM pedagogical_units WHERE subject_id = $1 AND stato = 'attiva' ORDER BY ordine, nome",
    [teaching.subject_id]
  );
  return rows;
}

async function getActivitiesDiTeaching(client, teachingId, tenantId) {
  await verificaTeachingNelTenant(client, teachingId, tenantId);
  const { rows } = await client.query(
    `SELECT a.id AS activity_id, a.nome, a.data_attivita, pu.nome AS unita_pedagogica
     FROM activities a JOIN pedagogical_units pu ON pu.id = a.pedagogical_unit_id
     WHERE a.teaching_id = $1
     ORDER BY a.data_attivita DESC, a.id DESC`,
    [teachingId]
  );
  return rows;
}

/**
 * Crea un'Activity su un Teaching. pedagogicalUnitId deve appartenere alla
 * materia del Teaching: il database lo garantisce comunque (FK composta,
 * sez. 29/34), qui si dà solo un messaggio applicativo più chiaro di una
 * violazione di vincolo generica.
 */
async function creaActivity(client, { teachingId, tenantId, nome, dataAttivita, pedagogicalUnitId }) {
  const teaching = await verificaTeachingNelTenant(client, teachingId, tenantId);
  if (!nome || !nome.trim()) throw datiNonValidi("Il nome dell'attività è obbligatorio.");
  if (!dataAttivita) throw datiNonValidi("La data dell'attività è obbligatoria.");

  const { rows: unita } = await client.query(
    'SELECT id FROM pedagogical_units WHERE id = $1 AND subject_id = $2',
    [pedagogicalUnitId, teaching.subject_id]
  );
  if (unita.length === 0) {
    throw datiNonValidi("L'unità pedagogica scelta non appartiene alla materia di questo Teaching.");
  }

  const { rows } = await client.query(
    `INSERT INTO activities (tenant_id, school_year_id, teaching_id, class_id, subject_id, pedagogical_unit_id, nome, data_attivita)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id AS activity_id, nome, data_attivita`,
    [tenantId, teaching.school_year_id, teachingId, teaching.class_id, teaching.subject_id, pedagogicalUnitId, nome.trim(), dataAttivita]
  );
  return rows[0];
}

/** Studenti iscritti a un Teaching (classe/anno del Teaching), per la pagina "Studenti" del docente. */
async function getStudentiDiTeaching(client, teachingId, tenantId) {
  const teaching = await verificaTeachingNelTenant(client, teachingId, tenantId);
  return getEnrollmentsDellaClasse(client, { classId: teaching.class_id, tenantId, schoolYearId: teaching.school_year_id });
}

/**
 * Assessment registrati su un Teaching (sez. 33/34): distinti dalle
 * Observation, elenco di sola lettura in questa V1 (nessuna scrittura
 * esposta: manca ancora una gestione degli AssessmentPeriod lato UI/API,
 * vedi nota nella risposta finale).
 */
async function getAssessmentsDiTeaching(client, teachingId, tenantId) {
  await verificaTeachingNelTenant(client, teachingId, tenantId);
  const { rows } = await client.query(
    `SELECT ass.id, p.nome, p.cognome, ap.nome AS periodo, c.descrizione AS criterio, ass.giudizio, ass.updated_at
     FROM assessments ass
     JOIN enrollments e ON e.id = ass.enrollment_id
     JOIN people p ON p.id = e.student_person_id
     JOIN assessment_periods ap ON ap.id = ass.assessment_period_id
     LEFT JOIN criteria c ON c.id = ass.criterion_id
     WHERE ass.teaching_id = $1
     ORDER BY p.cognome, p.nome, ap.data_inizio`,
    [teachingId]
  );
  return rows;
}

/** Verifica che il livello scolastico appartenga al tenant indicato. */
async function verificaSchoolLevelNelTenant(client, schoolLevelId, tenantId) {
  const { rows } = await client.query(
    'SELECT id, nome FROM school_levels WHERE id = $1 AND tenant_id = $2',
    [schoolLevelId, tenantId]
  );
  if (rows.length === 0) throw nonTrovato('Livello scolastico non trovato o non accessibile in questo tenant.');
  return rows[0];
}

/** Classi di un livello scolastico (per Coordinatore/Tenant Admin: sez. "Classi"). */
async function getClassiDelloSchoolLevel(client, schoolLevelId, tenantId) {
  await verificaSchoolLevelNelTenant(client, schoolLevelId, tenantId);
  const { rows } = await client.query(
    "SELECT id, nome FROM classes WHERE school_level_id = $1 AND tenant_id = $2 AND stato = 'attiva' ORDER BY nome",
    [schoolLevelId, tenantId]
  );
  return rows;
}

/** Verifica che la classe appartenga al tenant indicato; restituisce anche il suo school_level_id (per lo scope). */
async function verificaClasseNelTenant(client, classId, tenantId) {
  const { rows } = await client.query(
    'SELECT id, nome, school_level_id FROM classes WHERE id = $1 AND tenant_id = $2',
    [classId, tenantId]
  );
  if (rows.length === 0) throw nonTrovato('Classe non trovata o non accessibile in questo tenant.');
  return rows[0];
}

/** Studenti iscritti (attivi, anno corrente) di una classe: per Coordinatore/Tenant Admin. */
async function getStudentiDellaClasse(client, classId, tenantId) {
  const classe = await verificaClasseNelTenant(client, classId, tenantId);
  const schoolYearId = await getAnnoScolasticoCorrente(client, tenantId);
  return { classe, studenti: await getEnrollmentsDellaClasse(client, { classId, tenantId, schoolYearId }) };
}

/** Teaching attivi su una classe (qualunque docente): per Coordinatore/Tenant Admin. */
async function getTeachingsDellaClasse(client, classId, tenantId) {
  await verificaClasseNelTenant(client, classId, tenantId);
  const { rows } = await client.query(
    `SELECT t.id AS teaching_id, s.nome AS materia, sy.nome AS anno_scolastico, p.nome AS docente_nome, p.cognome AS docente_cognome
     FROM teachings t
     JOIN subjects s ON s.id = t.subject_id
     JOIN school_years sy ON sy.id = t.school_year_id
     JOIN accounts a ON a.id = t.account_id
     JOIN people p ON p.id = a.person_id
     WHERE t.class_id = $1 AND t.tenant_id = $2 AND t.stato = 'attivo'
     ORDER BY sy.nome DESC, s.nome`,
    [classId, tenantId]
  );
  return rows;
}

/** Activity con l'ambito completo (tenant/anno/classe/materia/unità), verificata nel tenant richiesto. */
async function verificaActivityNelTenant(client, activityId, tenantId) {
  const { rows } = await client.query(
    `SELECT a.id, a.nome, a.data_attivita, a.teaching_id, a.class_id, a.subject_id, a.pedagogical_unit_id,
            a.tenant_id, a.school_year_id, cl.school_level_id, cl.nome AS classe, pu.nome AS unita_pedagogica
     FROM activities a
     JOIN classes cl ON cl.id = a.class_id
     JOIN pedagogical_units pu ON pu.id = a.pedagogical_unit_id
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [activityId, tenantId]
  );
  if (rows.length === 0) throw nonTrovato('Attività non trovata o non accessibile in questo tenant.');
  return rows[0];
}

async function verificaEnrollmentCoerente(client, activityInfo, enrollmentId) {
  const { rows } = await client.query(
    `SELECT id, student_person_id, class_id FROM enrollments
     WHERE id = $1 AND class_id = $2 AND tenant_id = $3 AND school_year_id = $4 AND attiva`,
    [enrollmentId, activityInfo.class_id, activityInfo.tenant_id, activityInfo.school_year_id]
  );
  if (rows.length === 0) throw nonTrovato('Alunno non trovato in questa classe/anno per questa attività.');
  return rows[0];
}

async function verificaCriterionDiActivity(client, activityInfo, criterionId) {
  const { rows } = await client.query(
    'SELECT id, codice, descrizione, ordine FROM criteria WHERE id = $1 AND pedagogical_unit_id = $2',
    [criterionId, activityInfo.pedagogical_unit_id]
  );
  if (rows.length === 0) throw nonTrovato("Criterio non appartenente all'unità pedagogica di questa attività.");
  return rows[0];
}

/** Iscrizioni attive di una classe/anno, con i dati della persona. Punto unico riusato da griglia/roster. */
async function getEnrollmentsDellaClasse(client, { classId, tenantId, schoolYearId }) {
  const { rows } = await client.query(
    `SELECT e.id AS enrollment_id, e.student_person_id, p.nome, p.cognome
     FROM enrollments e JOIN people p ON p.id = e.student_person_id
     WHERE e.class_id = $1 AND e.tenant_id = $2 AND e.school_year_id = $3 AND e.attiva
     ORDER BY p.cognome, p.nome, e.id`,
    [classId, tenantId, schoolYearId]
  );
  return rows;
}

/** Anno scolastico corrente di un tenant (usato quando non si parte già da un'Activity/Teaching con anno noto). */
async function getAnnoScolasticoCorrente(client, tenantId) {
  const { rows } = await client.query(
    "SELECT id FROM school_years WHERE tenant_id = $1 AND stato = 'attivo' ORDER BY data_inizio DESC LIMIT 1",
    [tenantId]
  );
  if (rows.length === 0) throw nonTrovato('Nessun anno scolastico attivo configurato per questo tenant.');
  return rows[0].id;
}

/** Griglia di classe per un'attività: una riga per alunno iscritto, una colonna per criterio. */
async function getGrigliaActivity(client, { activityId, tenantId }) {
  const activityInfo = await verificaActivityNelTenant(client, activityId, tenantId);
  const criteri = await getCriteria(client, activityInfo.pedagogical_unit_id);
  const alunni = await getEnrollmentsDellaClasse(client, {
    classId: activityInfo.class_id, tenantId: activityInfo.tenant_id, schoolYearId: activityInfo.school_year_id,
  });
  const scala = await getScalaApplicabile(client, { tenantId, schoolLevelId: activityInfo.school_level_id });
  const bande = preparaBande(await getBandeGiudizio(client, { tenantId, schoolLevelId: activityInfo.school_level_id }));

  const { rows: osservazioni } = await client.query(
    'SELECT id AS observation_id, enrollment_id, criterion_id, valore, note FROM observations WHERE activity_id = $1',
    [activityId]
  );
  const perCella = new Map(osservazioni.map((o) => [`${o.enrollment_id}:${o.criterion_id}`, o]));

  const righe = alunni.map((alunno) => {
    const celle = criteri.map((c) => {
      const oss = perCella.get(`${alunno.enrollment_id}:${c.id}`);
      return { criterionId: c.id, valore: oss ? oss.valore : null, note: oss ? oss.note : null };
    });
    const presenti = celle.filter((c) => c.valore !== null).map((c) => c.valore);
    const esito = calcolaEsito(presenti, scala.valoreMassimo);
    return {
      enrollmentId: alunno.enrollment_id,
      studentPersonId: alunno.student_person_id,
      cognome: alunno.cognome,
      nome: alunno.nome,
      celle,
      valutazionePresenti: presenti.length,
      valutazioniTotali: criteri.length,
      esito: { ...esito, giudizio: giudizioDi(esito.percentualeEsatta, bande).giudizio },
    };
  });

  return {
    activity: { id: activityInfo.id, nome: activityInfo.nome, dataAttivita: activityInfo.data_attivita },
    pedagogicalUnitId: activityInfo.pedagogical_unit_id,
    unitaPedagogica: activityInfo.unita_pedagogica,
    scala: { id: scala.id, nome: scala.nome, valori: scala.valori, valoreMassimo: scala.valoreMassimo },
    criteri: criteri.map((c) => ({ id: c.id, codice: c.codice, descrizione: c.descrizione, ordine: c.ordine })),
    grigliaNonConfigurata: criteri.length === 0,
    righe,
  };
}

/**
 * Salva (o elimina) l'osservazione di un criterio per un alunno in
 * un'attività. valore === null -> elimina la riga se esiste. Altrimenti fa
 * un upsert; il valore deve esistere nella scala applicabile: lo garantisce
 * la FK (scale_id, valore) -> observation_scale_values (sez. 27), qui si dà
 * solo un errore applicativo più chiaro se il valore non è nemmeno un intero.
 */
async function salvaObservation(client, { activityId, enrollmentId, criterionId, valore, tenantId, accountId, dataOsservazione }) {
  const activityInfo = await verificaActivityNelTenant(client, activityId, tenantId);
  await verificaEnrollmentCoerente(client, activityInfo, enrollmentId);
  await verificaCriterionDiActivity(client, activityInfo, criterionId);

  if (valore === null) {
    const { rowCount } = await client.query(
      'DELETE FROM observations WHERE activity_id = $1 AND enrollment_id = $2 AND criterion_id = $3',
      [activityId, enrollmentId, criterionId]
    );
    return { eliminato: rowCount > 0 };
  }
  if (!Number.isInteger(valore)) throw datiNonValidi(`Valore non valido: ${valore}.`);

  const scala = await getScalaApplicabile(client, { tenantId, schoolLevelId: activityInfo.school_level_id });
  const { rows } = await client.query(
    `INSERT INTO observations (
       tenant_id, school_year_id, activity_id, enrollment_id, class_id, criterion_id,
       pedagogical_unit_id, scale_id, valore, recorded_by_account_id, data_osservazione
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (activity_id, enrollment_id, criterion_id)
       DO UPDATE SET valore = EXCLUDED.valore, updated_at = now(), recorded_by_account_id = EXCLUDED.recorded_by_account_id
     RETURNING id`,
    [
      tenantId, activityInfo.school_year_id, activityId, enrollmentId, activityInfo.class_id, criterionId,
      activityInfo.pedagogical_unit_id, scala.id, valore, accountId, dataOsservazione || activityInfo.data_attivita,
    ]
  );
  return { observationId: rows[0].id, eliminato: false };
}

/**
 * Report classe (fotografia di UNA attività, sez. "Report classe" del
 * prototipo, riportata sul nuovo dominio): organizzato per unità
 * pedagogica (oggi sempre una sola, perché un'Activity appartiene a una
 * sola PedagogicalUnit). Risultato del criterio: calcolaEsito sui soli
 * punteggi presenti in questa attività. Risultato di unità/attività: media
 * aritmetica semplice dei risultati percentuali dei criteri valutati, MAI
 * media mobile, MAI dati di altre attività.
 */
async function getReportClasseActivity(client, { activityId, tenantId }) {
  const griglia = await getGrigliaActivity(client, { activityId, tenantId });
  const bande = preparaBande(await getBandeGiudizio(client, {
    tenantId,
    schoolLevelId: (await client.query('SELECT school_level_id FROM classes WHERE id = (SELECT class_id FROM activities WHERE id = $1)', [activityId])).rows[0].school_level_id,
  }));

  if (griglia.grigliaNonConfigurata) {
    return {
      activity: griglia.activity,
      grigliaNonConfigurata: true,
      totaleAlunni: griglia.righe.length,
      complessivo: { percentuale: null, giudizio: '', criteriConsiderati: 0 },
      unitaPedagogiche: [],
    };
  }

  const valoreMassimo = griglia.scala.valoreMassimo;
  const criteriConDettaglio = griglia.criteri.map((c) => {
    const punteggi = griglia.righe
      .map((r) => r.celle.find((cella) => cella.criterionId === c.id))
      .filter((cella) => cella && cella.valore !== null)
      .map((cella) => cella.valore);
    const distribuzione = {};
    griglia.scala.valori.forEach((v) => { distribuzione[v.valore] = 0; });
    punteggi.forEach((p) => { distribuzione[p] += 1; });
    const esito = calcolaEsito(punteggi, valoreMassimo);
    return {
      id: c.id, codice: c.codice, descrizione: c.descrizione, ordine: c.ordine,
      valutati: punteggi.length,
      nonValutati: griglia.righe.length - punteggi.length,
      distribuzione,
      esito: { ...esito, giudizio: giudizioDi(esito.percentualeEsatta, bande).giudizio },
    };
  });

  const esitiValutati = criteriConDettaglio.filter((c) => c.valutati > 0).map((c) => c.esito);
  const media = mediaSemplicePercentuali(esitiValutati);
  const risultato = { percentuale: media.percentuale, giudizio: giudizioDi(media.percentualeEsatta, bande).giudizio, criteriConsiderati: media.criteriConsiderati };

  return {
    activity: griglia.activity,
    grigliaNonConfigurata: false,
    totaleAlunni: griglia.righe.length,
    complessivo: risultato,
    unitaPedagogiche: [
      { id: griglia.pedagogicalUnitId, nome: griglia.unitaPedagogica, risultato, criteri: criteriConDettaglio },
    ],
  };
}

module.exports = {
  getTeachingsPropri, getTeachingsDelTenant, verificaTeachingNelTenant, getPedagogicalUnitsDiTeaching,
  getActivitiesDiTeaching, creaActivity, verificaActivityNelTenant, getGrigliaActivity, salvaObservation,
  getReportClasseActivity, getStudentiDiTeaching, getAssessmentsDiTeaching,
  verificaSchoolLevelNelTenant, getClassiDelloSchoolLevel, verificaClasseNelTenant,
  getStudentiDellaClasse, getTeachingsDellaClasse,
};
