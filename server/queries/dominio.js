'use strict';

/**
 * Dominio operativo (sez. 28-34): Teaching, Activity, Observation, griglia di
 * inserimento ed esito della singola attività (VIEW_ACTIVITY_OUTCOME: fotografia di
 * una attività, senza media mobile, senza storico ◇, senza finestra temporale).
 * I report pedagogici nel tempo vivono in server/queries/progresso.js.
 *
 * Contenuti dell'istituto come { testo, lingua } (B-2/B-3); contenuti d'autore nella
 * lingua registrata; date di calendario come dati 'YYYY-MM-DD' (V2 §17).
 */

const { nonTrovato, datiNonValidi } = require('../lib/erroreApplicativo');
const { getCriteria, getScalaApplicabile, getBandeGiudizio } = require('./configurazione');
const { calcolaEsito, mediaSemplicePercentuali } = require('../lib/calcoloEsiti');
const motore = require('../lib/calcoloProgresso');
const { pubblico, bandePubbliche, scalaPubblica, traduttoreDi } = require('../lib/pubblicazione');

/**
 * Teaching raggiungibili dall'account nel percorso unico (P15): i propri (titolare) e
 * quelli che l'account può leggere per scope di classe, livello, tenant o piattaforma
 * (stessa regola di RBAC delle rotte: permesso teaching.read). Ordine: materia nell'ordine
 * configurato, poi classe. Nessun ordinamento sul testo tradotto (B-4).
 */
async function getTeachingsPropri(client, { accountId, tenantId, lingua }) {
  const tr = await traduttoreDi(client, lingua);
  const { rows } = await client.query(
    `SELECT t.id AS teaching_id, t.account_id, cl.nome AS classe, cl.id AS class_id,
            s.id AS subject_id, s.nome AS materia, s.ordine AS materia_ordine, sy.nome AS anno_scolastico,
            p.nome AS docente_nome, p.cognome AS docente_cognome
     FROM teachings t
     JOIN classes cl ON cl.id = t.class_id
     JOIN subjects s ON s.id = t.subject_id
     JOIN school_years sy ON sy.id = t.school_year_id
     JOIN accounts a ON a.id = t.account_id
     JOIN people p ON p.id = a.person_id
     WHERE t.tenant_id = $2 AND t.stato = 'attivo' AND (
       t.account_id = $1
       OR EXISTS (
         SELECT 1 FROM role_assignments r
         JOIN role_permissions rp ON rp.role_id = r.role_id
         JOIN permissions pe ON pe.id = rp.permission_id
         WHERE r.account_id = $1 AND r.revoked_at IS NULL AND pe.codice = 'teaching.read' AND (
           r.scope_type = 'PLATFORM'
           OR (r.scope_type = 'TENANT' AND r.tenant_id = t.tenant_id)
           OR (r.scope_type = 'SCHOOL_LEVEL' AND r.scope_school_level_id = cl.school_level_id)
           OR (r.scope_type = 'CLASS' AND r.scope_class_id = t.class_id)
         )
       )
     )
     ORDER BY sy.nome DESC, s.ordine, s.id, cl.nome, t.id`,
    [accountId, tenantId]
  );
  return rows.map((r) => ({
    teaching_id: r.teaching_id,
    proprio: r.account_id === accountId,
    classe: r.classe,
    class_id: r.class_id,
    subject_id: r.subject_id,
    materia: tr.testo('subjects.nome', r.subject_id, r.materia),
    anno_scolastico: r.anno_scolastico,
    docente: { nome: r.docente_nome, cognome: r.docente_cognome },
  }));
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
  if (rows.length === 0) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_TEACHING' });
  return rows[0];
}

/** Nuclei (unità pedagogiche) della materia di un Teaching: uniche opzioni per creare un'Activity. */
async function getPedagogicalUnitsDiTeaching(client, teachingId, tenantId, lingua) {
  const teaching = await verificaTeachingNelTenant(client, teachingId, tenantId);
  const tr = await traduttoreDi(client, lingua);
  const { rows } = await client.query(
    "SELECT id, nome, ordine FROM pedagogical_units WHERE subject_id = $1 AND stato = 'attiva' ORDER BY ordine, nome",
    [teaching.subject_id]
  );
  return rows.map((r) => ({ id: r.id, ordine: r.ordine, nome: tr.testo('pedagogical_units.nome', r.id, r.nome) }));
}

async function getActivitiesDiTeaching(client, teachingId, tenantId, lingua) {
  await verificaTeachingNelTenant(client, teachingId, tenantId);
  const tr = await traduttoreDi(client, lingua);
  const { rows } = await client.query(
    `SELECT a.id AS activity_id, a.nome, a.lingua_contenuto, to_char(a.data_attivita, 'YYYY-MM-DD') AS data_attivita,
            pu.id AS unit_id, pu.nome AS unita_pedagogica
     FROM activities a JOIN pedagogical_units pu ON pu.id = a.pedagogical_unit_id
     WHERE a.teaching_id = $1
     ORDER BY a.data_attivita DESC, a.id DESC`,
    [teachingId]
  );
  return rows.map((r) => ({
    activity_id: r.activity_id,
    nome: tr.autore(r.nome, r.lingua_contenuto),
    data_attivita: r.data_attivita,
    unita_pedagogica: tr.testo('pedagogical_units.nome', r.unit_id, r.unita_pedagogica),
  }));
}

/**
 * Crea un'Activity su un Teaching. pedagogicalUnitId deve appartenere alla materia del
 * Teaching (il database lo garantisce comunque con FK composte). Il nome è contenuto
 * d'autore registrato nella lingua della sessione (B).
 */
async function creaActivity(client, { teachingId, tenantId, nome, dataAttivita, pedagogicalUnitId, linguaContenuto }) {
  const teaching = await verificaTeachingNelTenant(client, teachingId, tenantId);
  if (!nome || !nome.trim()) throw datiNonValidi('ERR_REQUIRED_FIELD', { campo: 'UI_FIELD_NOME' });
  if (!dataAttivita) throw datiNonValidi('ERR_REQUIRED_FIELD', { campo: 'UI_FIELD_DATA_ATTIVITA' });

  const { rows: unita } = await client.query(
    'SELECT id FROM pedagogical_units WHERE id = $1 AND subject_id = $2',
    [pedagogicalUnitId, teaching.subject_id]
  );
  if (unita.length === 0) throw datiNonValidi('ERR_UNIT_NOT_IN_SUBJECT');

  const { rows } = await client.query(
    `INSERT INTO activities (tenant_id, school_year_id, teaching_id, class_id, subject_id, pedagogical_unit_id, nome, data_attivita, lingua_contenuto)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id AS activity_id, nome, to_char(data_attivita, 'YYYY-MM-DD') AS data_attivita, lingua_contenuto`,
    [tenantId, teaching.school_year_id, teachingId, teaching.class_id, teaching.subject_id, pedagogicalUnitId, nome.trim(), dataAttivita, linguaContenuto]
  );
  const r = rows[0];
  return { activity_id: r.activity_id, nome: { testo: r.nome, lingua: r.lingua_contenuto }, data_attivita: r.data_attivita };
}

/** Studenti iscritti a un Teaching (classe/anno del Teaching), nell'ordine del registro. */
async function getStudentiDiTeaching(client, teachingId, tenantId) {
  const teaching = await verificaTeachingNelTenant(client, teachingId, tenantId);
  return getEnrollmentsDellaClasse(client, { classId: teaching.class_id, tenantId, schoolYearId: teaching.school_year_id });
}

/** Verifica che il livello scolastico appartenga al tenant indicato. */
async function verificaSchoolLevelNelTenant(client, schoolLevelId, tenantId) {
  const { rows } = await client.query('SELECT id, nome FROM school_levels WHERE id = $1 AND tenant_id = $2', [schoolLevelId, tenantId]);
  if (rows.length === 0) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_SCHOOL_LEVEL' });
  return rows[0];
}

/** Classi di un livello scolastico (classes.nome è un'identità: non si traduce). */
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
  const { rows } = await client.query('SELECT id, nome, school_level_id FROM classes WHERE id = $1 AND tenant_id = $2', [classId, tenantId]);
  if (rows.length === 0) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_CLASS' });
  return rows[0];
}

/** Studenti iscritti (attivi, anno corrente) di una classe. */
async function getStudentiDellaClasse(client, classId, tenantId) {
  const classe = await verificaClasseNelTenant(client, classId, tenantId);
  const schoolYearId = await getAnnoScolasticoCorrente(client, tenantId);
  return { classe, studenti: await getEnrollmentsDellaClasse(client, { classId, tenantId, schoolYearId }) };
}

/** Teaching attivi su una classe (qualunque docente). */
async function getTeachingsDellaClasse(client, classId, tenantId, lingua) {
  await verificaClasseNelTenant(client, classId, tenantId);
  const tr = await traduttoreDi(client, lingua);
  const { rows } = await client.query(
    `SELECT t.id AS teaching_id, s.id AS subject_id, s.nome AS materia, sy.nome AS anno_scolastico, p.nome AS docente_nome, p.cognome AS docente_cognome
     FROM teachings t
     JOIN subjects s ON s.id = t.subject_id
     JOIN school_years sy ON sy.id = t.school_year_id
     JOIN accounts a ON a.id = t.account_id
     JOIN people p ON p.id = a.person_id
     WHERE t.class_id = $1 AND t.tenant_id = $2 AND t.stato = 'attivo'
     ORDER BY sy.nome DESC, s.ordine, s.id`,
    [classId, tenantId]
  );
  return rows.map((r) => ({
    teaching_id: r.teaching_id,
    materia: tr.testo('subjects.nome', r.subject_id, r.materia),
    anno_scolastico: r.anno_scolastico,
    docente_nome: r.docente_nome,
    docente_cognome: r.docente_cognome,
  }));
}

/** Activity con l'ambito completo (tenant/anno/classe/materia/unità), verificata nel tenant richiesto. */
async function verificaActivityNelTenant(client, activityId, tenantId) {
  const { rows } = await client.query(
    `SELECT a.id, a.nome, a.lingua_contenuto, to_char(a.data_attivita, 'YYYY-MM-DD') AS data_attivita,
            a.teaching_id, a.class_id, a.subject_id, a.pedagogical_unit_id,
            a.tenant_id, a.school_year_id, cl.school_level_id, cl.nome AS classe, pu.nome AS unita_pedagogica
     FROM activities a
     JOIN classes cl ON cl.id = a.class_id
     JOIN pedagogical_units pu ON pu.id = a.pedagogical_unit_id
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [activityId, tenantId]
  );
  if (rows.length === 0) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_ACTIVITY' });
  return rows[0];
}

async function verificaEnrollmentCoerente(client, activityInfo, enrollmentId) {
  const { rows } = await client.query(
    `SELECT id, student_person_id, class_id FROM enrollments
     WHERE id = $1 AND class_id = $2 AND tenant_id = $3 AND school_year_id = $4 AND attiva`,
    [enrollmentId, activityInfo.class_id, activityInfo.tenant_id, activityInfo.school_year_id]
  );
  if (rows.length === 0) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_ENROLLMENT' });
  return rows[0];
}

async function verificaCriterionDiActivity(client, activityInfo, criterionId) {
  const { rows } = await client.query(
    'SELECT id, codice, descrizione, ordine FROM criteria WHERE id = $1 AND pedagogical_unit_id = $2',
    [criterionId, activityInfo.pedagogical_unit_id]
  );
  if (rows.length === 0) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_CRITERION' });
  return rows[0];
}

/** Iscrizioni attive di una classe/anno, con i dati della persona, nell'ordine del registro. */
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

/** Anno scolastico corrente di un tenant. */
async function getAnnoScolasticoCorrente(client, tenantId) {
  const { rows } = await client.query(
    "SELECT id FROM school_years WHERE tenant_id = $1 AND stato = 'attivo' ORDER BY data_inizio DESC LIMIT 1",
    [tenantId]
  );
  if (rows.length === 0) throw nonTrovato('ERR_SCHOOL_YEAR_NOT_CONFIGURED');
  return rows[0].id;
}

/** Contesto comune di griglia ed esito: attività, criteri, iscritti, scala, bande, osservazioni. */
async function caricaAttivita(client, { activityId, tenantId, lingua }) {
  const info = await verificaActivityNelTenant(client, activityId, tenantId);
  const tr = await traduttoreDi(client, lingua);
  const criteri = (await getCriteria(client, info.pedagogical_unit_id)).map((c) => ({
    id: c.id, codice: c.codice, ordine: c.ordine, descrizione: tr.testo('criteria.descrizione', c.id, c.descrizione),
  }));
  const alunni = await getEnrollmentsDellaClasse(client, { classId: info.class_id, tenantId: info.tenant_id, schoolYearId: info.school_year_id });
  const scala = await getScalaApplicabile(client, { tenantId, schoolLevelId: info.school_level_id });
  const bandeDb = await getBandeGiudizio(client, { tenantId, schoolLevelId: info.school_level_id });
  const bande = motore.preparaBande(bandeDb.map((b) => ({ ...b, etichetta: tr.testo('judgment_bands.etichetta', b.id, b.etichetta) })));
  const { rows: osservazioni } = await client.query(
    `SELECT o.id AS observation_id, o.enrollment_id, o.criterion_id, o.valore, o.note, o.lingua_nota, e.attiva AS iscrizione_attiva
     FROM observations o JOIN enrollments e ON e.id = o.enrollment_id
     WHERE o.activity_id = $1`,
    [activityId]
  );
  return {
    info,
    tr,
    criteri,
    alunni,
    scala,
    scalaPub: scalaPubblica(scala, tr),
    bande,
    osservazioni,
    attivita: {
      id: info.id,
      nome: tr.autore(info.nome, info.lingua_contenuto),
      dataAttivita: info.data_attivita,
      unitaPedagogica: { id: info.pedagogical_unit_id, nome: tr.testo('pedagogical_units.nome', info.pedagogical_unit_id, info.unita_pedagogica) },
    },
  };
}

/**
 * Griglia di inserimento di un'attività: una riga per alunno iscritto, una colonna per
 * criterio. Conserva la propria semantica (P14): esito per alunno = n/N, percentuale e banda
 * dei punteggi di QUESTA attività, con la Regola B.
 */
async function getGrigliaActivity(client, { activityId, tenantId, lingua }) {
  const d = await caricaAttivita(client, { activityId, tenantId, lingua });
  const perCella = new Map(d.osservazioni.map((o) => [`${o.enrollment_id}:${o.criterion_id}`, o]));

  const righe = d.alunni.map((alunno) => {
    const celle = d.criteri.map((c) => {
      const oss = perCella.get(`${alunno.enrollment_id}:${c.id}`);
      return { criterionId: c.id, valore: oss ? oss.valore : null, nota: oss ? d.tr.autore(oss.note || null, oss.lingua_nota) : null };
    });
    const presenti = celle.filter((c) => c.valore !== null).map((c) => c.valore);
    const esito = calcolaEsito(presenti, d.scala.valoreMassimo);
    const valore = motore.valoreDi(esito.percentualeEsatta, d.bande);
    return {
      enrollmentId: alunno.enrollment_id,
      studentPersonId: alunno.student_person_id,
      cognome: alunno.cognome,
      nome: alunno.nome,
      celle,
      valutazionePresenti: presenti.length,
      valutazioniTotali: d.criteri.length,
      esito: { ...pubblico(valore), base: { n: presenti.length, N: d.criteri.length } },
    };
  });

  return {
    activity: d.attivita,
    pedagogicalUnitId: d.info.pedagogical_unit_id,
    unitaPedagogica: d.attivita.unitaPedagogica.nome,
    precisione: motore.precisione(d.bande),
    bande: bandePubbliche(d.bande),
    scala: d.scalaPub,
    criteri: d.criteri,
    grigliaNonConfigurata: d.criteri.length === 0,
    righe,
  };
}

/**
 * Salva (o elimina) l'osservazione di un criterio per un alunno in un'attività.
 * valore === null -> elimina la riga se esiste. Il valore deve esistere nella scala
 * applicabile: lo garantisce la FK (scale_id, valore) -> observation_scale_values.
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
  if (!Number.isInteger(valore)) throw datiNonValidi('ERR_OBSERVATION_VALUE_INVALID');

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
 * ESITO DELL'ATTIVITÀ (VIEW_ACTIVITY_OUTCOME, P14): per criterio, distribuzione dei valori
 * della scala (barre, conteggi), base n/N e aggregato (n/N, percentuale, banda); per l'unità,
 * media semplice dei criteri valutati. Solo i punteggi di QUESTA attività: mai media mobile,
 * mai altre attività, nessuno storico ◇, nessuna finestra. Certezza dei valori di classe:
 * più della metà degli iscritti valutati (§7). Le osservazioni di iscrizioni non attive
 * sono escluse con il loro motivo.
 */
async function getReportClasseActivity(client, { activityId, tenantId, lingua }) {
  const d = await caricaAttivita(client, { activityId, tenantId, lingua });
  const testata = {
    activity: d.attivita,
    precisione: motore.precisione(d.bande),
    bande: bandePubbliche(d.bande),
    scala: d.scalaPub,
    totaleAlunni: d.alunni.length,
  };
  if (d.criteri.length === 0) {
    return { ...testata, grigliaNonConfigurata: true, complessivo: null, unitaPedagogiche: [], esclusioni: [] };
  }

  const attivi = new Set(d.alunni.map((a) => a.enrollment_id));
  const criteri = d.criteri.map((c) => {
    const punteggi = d.osservazioni.filter((o) => o.criterion_id === c.id && attivi.has(o.enrollment_id)).map((o) => o.valore);
    const esito = calcolaEsito(punteggi, d.scala.valoreMassimo);
    const { certezza, stato } = motore.coperturaDiClasse(punteggi.length, d.alunni.length);
    const valore = motore.valoreDi(esito.percentualeEsatta, d.bande);
    return {
      id: c.id,
      codice: c.codice,
      descrizione: c.descrizione,
      ordine: c.ordine,
      valutati: punteggi.length,
      nonValutati: d.alunni.length - punteggi.length,
      base: { n: punteggi.length, N: d.alunni.length },
      // Distribuzione dei valori REALI della scala (conteggi + quota in centesimi per la geometria).
      distribuzione: d.scalaPub.valori.map((v) => {
        const studenti = punteggi.filter((p) => p === v.valore).length;
        return { valore: v.valore, etichetta: v.etichetta, studenti, larghezza: motore.quota(studenti, punteggi.length) };
      }),
      percentualeEsatta: esito.percentualeEsatta,
      esito: {
        ...pubblico(valore),
        punteggioOttenuto: esito.punteggioOttenuto,
        punteggioMassimo: esito.punteggioMassimo,
        certezza,
        criticita: motore.criticitaDi(valore, certezza),
        // Esito attività: la regola del dominio aggrega tutti i criteri valutati (nessuna esclusione per copertura).
        stato: stato === motore.DATI.NON_OSSERVATO ? stato : null,
        base: { n: punteggi.length, N: d.alunni.length },
      },
    };
  });

  const valutati = criteri.filter((c) => c.valutati > 0);
  const media = mediaSemplicePercentuali(valutati.map((c) => ({ punteggioOttenuto: c.esito.punteggioOttenuto, punteggioMassimo: c.esito.punteggioMassimo })));
  const certezzaUnita = motore.certezzaMinima(valutati.map((c) => c.esito.certezza));
  const valoreUnita = motore.valoreDi(media.percentualeEsatta, d.bande);
  const risultato = {
    ...pubblico(valoreUnita),
    certezza: certezzaUnita,
    criticita: motore.criticitaDi(valoreUnita, certezzaUnita),
    stato: valutati.length === 0 ? motore.DATI.NON_OSSERVATO : null,
    criteriConsiderati: valutati.length,
    base: { n: valutati.length, N: criteri.length },
  };
  const esclusi = d.osservazioni.filter((o) => !o.iscrizione_attiva).length;

  return {
    ...testata,
    grigliaNonConfigurata: false,
    complessivo: risultato,
    unitaPedagogiche: [{
      id: d.attivita.unitaPedagogica.id,
      nome: d.attivita.unitaPedagogica.nome,
      risultato,
      criteri: criteri.map(({ percentualeEsatta, ...resto }) => resto),
    }],
    esclusioni: esclusi === 0 ? [] : [{ motivo: 'EXCLUSION_ENROLLMENT_INACTIVE', osservazioni: esclusi }],
  };
}

module.exports = {
  getTeachingsPropri, verificaTeachingNelTenant, getPedagogicalUnitsDiTeaching,
  getActivitiesDiTeaching, creaActivity, verificaActivityNelTenant, getGrigliaActivity, salvaObservation,
  getReportClasseActivity, getStudentiDiTeaching,
  verificaSchoolLevelNelTenant, getClassiDelloSchoolLevel, verificaClasseNelTenant,
  getStudentiDellaClasse, getTeachingsDellaClasse,
};
