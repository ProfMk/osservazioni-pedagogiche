'use strict';

/**
 * Chiusura V1.1, decisioni 2 e 4: immutabilità dei riferimenti strutturali
 * (migrations/004_immutabilita_strutturale.sql) e scritture solo su anno
 * scolastico attivo (server/queries/dominio.js).
 *
 * I test sul database lavorano dentro una transazione annullata alla fine
 * (fixture creata nel test, seed invariato), sempre come app_role (server/db.js).
 * I test HTTP sull'anno chiuso creano una fixture confermata e la rimuovono.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

require('./support/pglite').installa();
const { pool } = require('../server/db');
const { gestoreErrori } = require('../server/routes/index');
const { avviaServer, loginESwitch } = require('./support/http');

let srv;
test.before(async () => { srv = await avviaServer(); });
test.after(async () => { await srv.chiudi(); await pool.end(); });

const uno = async (client, sql, parametri) => (await client.query(sql, parametri)).rows[0];

// --- Transazione di prova e punti di salvataggio --------------------------

let contatoreSavepoint = 0;

/** Esegue fn in un savepoint e lo annulla sempre: lo stato della fixture resta quello di prima. */
async function inSavepoint(client, fn) {
  const nome = `sp_${(contatoreSavepoint += 1)}`;
  await client.query(`SAVEPOINT ${nome}`);
  try {
    return await fn();
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${nome}`);
    await client.query(`RELEASE SAVEPOINT ${nome}`);
  }
}

async function riuscita(client, sql, parametri, descrizione) {
  await inSavepoint(client, async () => {
    const r = await client.query(sql, parametri);
    assert.equal(r.rowCount, 1, `${descrizione}: attesa una riga modificata`);
  });
}

async function rifiutata(client, sql, parametri, descrizione) {
  await inSavepoint(client, async () => {
    await assert.rejects(() => client.query(sql, parametri), (e) => {
      assert.equal(e.code, '23001', `${descrizione}: atteso 23001, ricevuto ${e.code} (${e.message})`);
      return true;
    }, descrizione);
  });
}

/**
 * Fixture minima nel tenant alfa, dentro una transazione annullata alla fine.
 * Due livelli, due anni, tre materie (S1 e S2 nell'anno Y1, S3 nell'anno Y2), due classi,
 * due alunni, un periodo di valutazione; nuclei, criteri e righe figlie si creano su richiesta.
 */
async function conFixture(fn) {
  const c = await pool.connect();
  await c.query('BEGIN');
  try {
    const F = {};
    F.ruolo = (await uno(c, 'SELECT current_role AS r')).r;
    F.alfa = (await uno(c, "SELECT id FROM tenants WHERE slug = 'alfa'")).id;
    F.beta = (await uno(c, "SELECT id FROM tenants WHERE slug = 'beta'")).id;
    F.docente1 = (await uno(c, "SELECT id FROM accounts WHERE email = 'teacher.math.a@alfa.test'")).id;
    F.docente2 = (await uno(c, "SELECT id FROM accounts WHERE email = 'teacher.italian.a@alfa.test'")).id;
    F.scala = (await uno(c, 'SELECT id FROM observation_scales WHERE tenant_id = $1 AND school_level_id IS NULL', [F.alfa])).id;
    const livello = async (nome) => (await uno(c, 'INSERT INTO school_levels (tenant_id, nome) VALUES ($1, $2) RETURNING id', [F.alfa, nome])).id;
    F.L1 = await livello('Fixture L1');
    F.L2 = await livello('Fixture L2');
    const anno = async (nome, inizio, fine) => (await uno(c,
      'INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine) VALUES ($1, $2, $3, $4) RETURNING id',
      [F.alfa, nome, inizio, fine])).id;
    F.Y1 = await anno('2090/2091', '2090-09-01', '2091-06-30');
    F.Y2 = await anno('2091/2092', '2091-09-01', '2092-06-30');
    const materia = async (nome, annoId) => (await uno(c,
      'INSERT INTO subjects (tenant_id, school_level_id, school_year_id, nome) VALUES ($1, $2, $3, $4) RETURNING id',
      [F.alfa, F.L1, annoId, nome])).id;
    F.S1 = await materia('Fixture S1', F.Y1);
    F.S2 = await materia('Fixture S2', F.Y1);
    F.S3 = await materia('Fixture S3', F.Y2);
    const classe = async (nome) => (await uno(c, 'INSERT INTO classes (tenant_id, school_level_id, nome) VALUES ($1, $2, $3) RETURNING id', [F.alfa, F.L1, nome])).id;
    F.K1 = await classe('FX1');
    F.K2 = await classe('FX2');
    const persona = async (nome) => (await uno(c, "INSERT INTO people (tenant_id, nome, cognome) VALUES ($1, $2, 'Fixture') RETURNING id", [F.alfa, nome])).id;
    F.P1 = await persona('Alunno 1');
    F.P2 = await persona('Alunno 2');
    F.AP1 = (await uno(c,
      "INSERT INTO assessment_periods (tenant_id, school_year_id, nome, data_inizio, data_fine) VALUES ($1, $2, 'Fixture periodo', '2090-09-01', '2091-01-31') RETURNING id",
      [F.alfa, F.Y1])).id;

    // Costruttori delle righe figlie (sempre nell'anno Y1, materia S1 salvo indicazione).
    F.unita = async (subjectId, nome = `U-${(contatoreSavepoint += 1)}`) => (await uno(c,
      'INSERT INTO pedagogical_units (tenant_id, school_year_id, subject_id, nome) SELECT tenant_id, school_year_id, id, $2 FROM subjects WHERE id = $1 RETURNING id',
      [subjectId, nome])).id;
    F.criterio = async (unitId, codice = `C-${(contatoreSavepoint += 1)}`) => (await uno(c,
      `INSERT INTO criteria (tenant_id, school_year_id, pedagogical_unit_id, codice, descrizione, ordine)
       SELECT tenant_id, school_year_id, id, $2, 'Criterio di prova', (SELECT count(*) + 1 FROM criteria WHERE pedagogical_unit_id = $1)
       FROM pedagogical_units WHERE id = $1 RETURNING id`,
      [unitId, codice])).id;
    F.teaching = async ({ classe: classId = F.K1, materia: subjectId = F.S1, account = F.docente1 } = {}) => (await uno(c,
      'INSERT INTO teachings (tenant_id, school_year_id, class_id, subject_id, account_id) SELECT tenant_id, school_year_id, $2, id, $3 FROM subjects WHERE id = $1 RETURNING id',
      [subjectId, classId, account])).id;
    F.enrollment = async ({ classe: classId = F.K1, persona: personId = F.P1, anno: annoId = F.Y1 } = {}) => (await uno(c,
      'INSERT INTO enrollments (tenant_id, school_year_id, class_id, student_person_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [F.alfa, annoId, classId, personId])).id;
    F.activity = async (teachingId, unitId) => (await uno(c,
      `INSERT INTO activities (tenant_id, school_year_id, teaching_id, class_id, subject_id, pedagogical_unit_id, nome, data_attivita, lingua_contenuto)
       SELECT tenant_id, school_year_id, id, class_id, subject_id, $2, 'Attività di prova', '2090-10-01', 'it' FROM teachings WHERE id = $1 RETURNING id`,
      [teachingId, unitId])).id;
    F.observation = async (activityId, enrollmentId, criterionId) => (await uno(c,
      `INSERT INTO observations (tenant_id, school_year_id, activity_id, enrollment_id, class_id, criterion_id, pedagogical_unit_id, scale_id, valore, recorded_by_account_id, data_osservazione)
       SELECT a.tenant_id, a.school_year_id, a.id, $2, a.class_id, $3, a.pedagogical_unit_id, $4, 2, $5, a.data_attivita FROM activities a WHERE a.id = $1 RETURNING id`,
      [activityId, enrollmentId, criterionId, F.scala, F.docente1])).id;
    F.assessment = async (teachingId, enrollmentId, { criterio = null, unita = null } = {}) => (await uno(c,
      `INSERT INTO assessments (tenant_id, school_year_id, teaching_id, class_id, subject_id, enrollment_id, assessment_period_id,
                                criterion_id, pedagogical_unit_id, giudizio, recorded_by_account_id, lingua_contenuto)
       SELECT tenant_id, school_year_id, id, class_id, subject_id, $2, $3, $4, $5, 'Giudizio di prova', $6, 'it' FROM teachings WHERE id = $1 RETURNING id`,
      [teachingId, enrollmentId, F.AP1, criterio, unita, F.docente1])).id;

    return await fn(c, F);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

/**
 * Regola 2 per una tabella: ogni modifica riesce senza figli; con almeno un figlio di
 * CIASCUN tipo (creato da solo, in un savepoint) ogni modifica è rifiutata con 23001.
 */
async function provaRegola2(c, tabella, modifiche, figli) {
  for (const [colonna, sql, parametri] of modifiche) {
    await riuscita(c, sql, parametri, `${tabella}.${colonna} senza figli`);
  }
  for (const [figlio, crea] of Object.entries(figli)) {
    await inSavepoint(c, async () => {
      await crea();
      for (const [colonna, sql, parametri] of modifiche) {
        await rifiutata(c, sql, parametri, `${tabella}.${colonna} con un figlio in ${figlio}`);
      }
    });
  }
}

// --- Regola 2: immutabili quando esistono righe figlie ----------------------

test('Regola 2 — teachings: account_id, class_id, subject_id, school_year_id; figli activities, assessments', () => conFixture(async (c, F) => {
  assert.equal(F.ruolo, 'app_role', 'i trigger operano sotto app_role');
  const t = await F.teaching();
  await provaRegola2(c, 'teachings', [
    ['account_id', 'UPDATE teachings SET account_id = $2 WHERE id = $1', [t, F.docente2]],
    ['class_id', 'UPDATE teachings SET class_id = $2 WHERE id = $1', [t, F.K2]],
    ['subject_id', 'UPDATE teachings SET subject_id = $2 WHERE id = $1', [t, F.S2]],
    // school_year_id con la materia dell'altro anno: la FK composta verso subjects lo richiede.
    ['school_year_id', 'UPDATE teachings SET school_year_id = $2, subject_id = $3 WHERE id = $1', [t, F.Y2, F.S3]],
  ], {
    activities: async () => F.activity(t, await F.unita(F.S1)),
    assessments: async () => F.assessment(t, await F.enrollment()),
  });
}));

test('Regola 2 — enrollments: student_person_id, class_id, school_year_id; figli observations, assessments', () => conFixture(async (c, F) => {
  const e = await F.enrollment();
  await provaRegola2(c, 'enrollments', [
    ['student_person_id', 'UPDATE enrollments SET student_person_id = $2 WHERE id = $1', [e, F.P2]],
    ['class_id', 'UPDATE enrollments SET class_id = $2 WHERE id = $1', [e, F.K2]],
    ['school_year_id', 'UPDATE enrollments SET school_year_id = $2 WHERE id = $1', [e, F.Y2]],
  ], {
    observations: async () => {
      const u = await F.unita(F.S1);
      await F.observation(await F.activity(await F.teaching(), u), e, await F.criterio(u));
    },
    assessments: async () => F.assessment(await F.teaching(), e),
  });
}));

test('Regola 2 — classes: school_level_id; figli teachings, enrollments', () => conFixture(async (c, F) => {
  await provaRegola2(c, 'classes', [
    ['school_level_id', 'UPDATE classes SET school_level_id = $2 WHERE id = $1', [F.K1, F.L2]],
  ], {
    teachings: () => F.teaching({ classe: F.K1 }),
    enrollments: () => F.enrollment({ classe: F.K1 }),
  });
}));

test('Regola 2 — subjects: school_level_id; figli pedagogical_units', () => conFixture(async (c, F) => {
  await provaRegola2(c, 'subjects', [
    ['school_level_id', 'UPDATE subjects SET school_level_id = $2 WHERE id = $1', [F.S1, F.L2]],
  ], {
    pedagogical_units: () => F.unita(F.S1),
  });
}));

test('Regola 2 — pedagogical_units: subject_id; figli criteria, activities', () => conFixture(async (c, F) => {
  const u = await F.unita(F.S1, 'U1');
  await provaRegola2(c, 'pedagogical_units', [
    ['subject_id', 'UPDATE pedagogical_units SET subject_id = $2 WHERE id = $1', [u, F.S2]],
  ], {
    criteria: () => F.criterio(u),
    activities: async () => F.activity(await F.teaching(), u),
  });
}));

test('Regola 2 — criteria: pedagogical_unit_id; figli observations, assessments', () => conFixture(async (c, F) => {
  const u1 = await F.unita(F.S1, 'U1');
  const u2 = await F.unita(F.S1, 'U2');
  const cr = await F.criterio(u1, 'C1');
  await provaRegola2(c, 'criteria', [
    ['pedagogical_unit_id', 'UPDATE criteria SET pedagogical_unit_id = $2 WHERE id = $1', [cr, u2]],
  ], {
    observations: async () => F.observation(await F.activity(await F.teaching(), u1), await F.enrollment(), cr),
    assessments: async () => F.assessment(await F.teaching(), await F.enrollment(), { criterio: cr, unita: u1 }),
  });
}));

test('Regola 2: il messaggio nomina tabella, riga e motivo; colonne non strutturali restano modificabili con figli', () => conFixture(async (c, F) => {
  const t = await F.teaching();
  await F.activity(t, await F.unita(F.S1));
  await inSavepoint(c, async () => {
    await assert.rejects(() => c.query('UPDATE teachings SET account_id = $2 WHERE id = $1', [t, F.docente2]), (e) => {
      assert.equal(e.code, '23001');
      assert.match(e.message, new RegExp(`^teachings id ${t} ha già righe in activities: .*immutabili`));
      assert.equal(e.table, 'teachings');
      return true;
    });
  });
  await riuscita(c, "UPDATE teachings SET stato = 'disattivato' WHERE id = $1", [t], 'teachings.stato con figli');
  // Riscrivere lo stesso valore non è una modifica.
  await riuscita(c, 'UPDATE teachings SET account_id = account_id, class_id = class_id WHERE id = $1', [t], 'stessi valori');
}));

// --- Regola 1: immutabili sempre -------------------------------------------

test('Regola 1 — tenant_id: ogni tabella tenant-owned ha il trigger e rifiuta la modifica, anche senza figli', () => conFixture(async (c, F) => {
  // Almeno una riga di alfa in ogni tabella dell'elenco (le due tabelle vuote nel seed le riempie la fixture).
  const t = await F.teaching();
  const u = await F.unita(F.S1);
  const e = await F.enrollment();
  await F.observation(await F.activity(t, u), e, await F.criterio(u));
  await F.assessment(t, e);
  await c.query("INSERT INTO content_translations (tenant_id, lingua, campo, subject_id, testo) VALUES ($1, 'it', 'subjects.nome', $2, 'Prova')", [F.alfa, F.S1]);
  await c.query("INSERT INTO catalog_overrides (tenant_id, lingua, chiave, valore) VALUES ($1, 'it', 'ERR_INTERNAL', '\"Prova\"')", [F.alfa]);

  const attese = (await c.query(
    `SELECT c.table_name FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
       AND c.table_name NOT IN ('tenants', 'audit_log')
     ORDER BY 1`
  )).rows.map((r) => r.table_name);
  const conTrigger = (await c.query(
    "SELECT tgrelid::regclass::text AS tabella FROM pg_trigger WHERE tgname LIKE 'trg\\_%\\_riferimenti\\_immutabili' AND NOT tgisinternal ORDER BY 1"
  )).rows.map((r) => r.tabella);
  assert.deepEqual(conTrigger, attese);
  assert.deepEqual(attese, [
    'activities', 'assessment_periods', 'assessments', 'catalog_overrides', 'classes', 'content_translations', 'criteria',
    'enrollments', 'judgment_bands', 'memberships', 'observation_scales', 'observations', 'pedagogical_units', 'people',
    'role_assignments', 'school_levels', 'school_years', 'subjects', 'teachings', 'tenant_languages',
  ]);

  for (const tabella of attese) {
    await rifiutata(c,
      `UPDATE ${tabella} SET tenant_id = $1 WHERE ctid = (SELECT ctid FROM ${tabella} WHERE tenant_id = $2 LIMIT 1)`,
      [F.beta, F.alfa], `${tabella}.tenant_id`);
  }

  // Righe senza alcun figlio: il rifiuto non dipende dai figli.
  for (const [tabella, id] of [['classes', F.K2], ['subjects', F.S2], ['school_years', F.Y2], ['school_levels', F.L2], ['people', F.P2]]) {
    await rifiutata(c, `UPDATE ${tabella} SET tenant_id = $2 WHERE id = $1`, [id, F.beta], `${tabella}.tenant_id senza figli`);
  }
  await rifiutata(c, 'UPDATE teachings SET tenant_id = $2 WHERE id = $1', [await F.teaching({ classe: F.K2 }), F.beta], 'teachings.tenant_id senza figli');
  await rifiutata(c, 'UPDATE enrollments SET tenant_id = $2 WHERE id = $1', [await F.enrollment({ persona: F.P2 }), F.beta], 'enrollments.tenant_id senza figli');
  // Anche una persona "globale" (tenant_id NULL, identità di un account) non può essere assegnata a un tenant.
  await rifiutata(c, 'UPDATE people SET tenant_id = $2 WHERE id = (SELECT person_id FROM accounts WHERE id = $1)', [F.docente1, F.alfa], 'people.tenant_id da NULL');
}));

test('Regola 1 — school_year_id: rifiutato sempre su subjects, pedagogical_units, criteria, activities, observations, assessments, assessment_periods', () => conFixture(async (c, F) => {
  // Righe senza figli per le tre tabelle di configurazione e per il periodo.
  const u = await F.unita(F.S1);
  const cr = await F.criterio(u);
  await rifiutata(c, 'UPDATE subjects SET school_year_id = $2 WHERE id = $1', [F.S2, F.Y2], 'subjects.school_year_id senza figli');
  await rifiutata(c, 'UPDATE pedagogical_units SET school_year_id = $2 WHERE id = $1', [await F.unita(F.S2), F.Y2], 'pedagogical_units.school_year_id senza figli');
  await rifiutata(c, 'UPDATE criteria SET school_year_id = $2 WHERE id = $1', [cr, F.Y2], 'criteria.school_year_id senza figli');
  await rifiutata(c, 'UPDATE assessment_periods SET school_year_id = $2 WHERE id = $1', [F.AP1, F.Y2], 'assessment_periods.school_year_id senza figli');

  const t = await F.teaching();
  const e = await F.enrollment();
  const a = await F.activity(t, u);
  const o = await F.observation(a, e, cr);
  const as = await F.assessment(t, e);
  await rifiutata(c, 'UPDATE activities SET school_year_id = $2 WHERE id = $1', [a, F.Y2], 'activities.school_year_id');
  await rifiutata(c, 'UPDATE observations SET school_year_id = $2 WHERE id = $1', [o, F.Y2], 'observations.school_year_id');
  await rifiutata(c, 'UPDATE assessments SET school_year_id = $2 WHERE id = $1', [as, F.Y2], 'assessments.school_year_id');
}));

// --- Movimenti degli alunni ------------------------------------------------

test('Movimenti: disattivare un\'iscrizione con osservazioni riesce; le osservazioni restano leggibili e invariate', () => conFixture(async (c, F) => {
  const u = await F.unita(F.S1);
  const e = await F.enrollment();
  await F.observation(await F.activity(await F.teaching(), u), e, await F.criterio(u));
  await F.observation(await F.activity(await F.teaching({ classe: F.K1, materia: F.S1, account: F.docente2 }), u), e, await F.criterio(u));
  const leggi = async () => (await c.query('SELECT * FROM observations WHERE enrollment_id = $1 ORDER BY id', [e])).rows;
  const prima = await leggi();
  assert.equal(prima.length, 2);

  const r = await c.query('UPDATE enrollments SET attiva = false WHERE id = $1', [e]);
  assert.equal(r.rowCount, 1);
  assert.equal((await uno(c, 'SELECT attiva FROM enrollments WHERE id = $1', [e])).attiva, false);
  assert.deepEqual(await leggi(), prima);
}));

// --- Traduzione 23001 -> 409 ----------------------------------------------

function rispostaFinta() {
  return {
    stato: null,
    corpo: null,
    status(s) { this.stato = s; return this; },
    json(b) { this.corpo = b; return this; },
  };
}

test('Gestore errori: 23001 -> 409 ERR_IMMUTABLE_REFERENCE (errore finto e errore reale del trigger), mai 500', async () => {
  const finta = rispostaFinta();
  gestoreErrori(Object.assign(new Error('finto'), { code: '23001' }), { method: 'PUT', originalUrl: '/finto' }, finta, () => {});
  assert.deepEqual([finta.stato, finta.corpo], [409, { errore: { codice: 'ERR_IMMUTABLE_REFERENCE', parametri: {} } }]);

  const reale = await conFixture(async (c, F) => {
    const t = await F.teaching();
    await F.activity(t, await F.unita(F.S1));
    return c.query('UPDATE teachings SET class_id = $2 WHERE id = $1', [t, F.K2]).then(() => null, (err) => err);
  });
  assert.equal(reale.code, '23001');
  const r = rispostaFinta();
  gestoreErrori(reale, { method: 'PUT', originalUrl: '/finto' }, r, () => {});
  assert.deepEqual([r.stato, r.corpo], [409, { errore: { codice: 'ERR_IMMUTABLE_REFERENCE', parametri: {} } }]);
});

// --- Anno attivo (decisione 4) ---------------------------------------------

/** Anno 'chiuso' nel tenant alfa con Teaching di teacher.math.a, attività, iscrizione e un'osservazione. Confermata: va rimossa. */
async function creaAnnoChiuso() {
  const q = (sql, p) => uno(pool, sql, p);
  const alfa = (await q("SELECT id FROM tenants WHERE slug = 'alfa'")).id;
  const docente = (await q("SELECT id FROM accounts WHERE email = 'teacher.math.a@alfa.test'")).id;
  const livello = (await q("SELECT id FROM school_levels WHERE tenant_id = $1 AND nome = 'Primaria'", [alfa])).id;
  const classe = (await q("SELECT id FROM classes WHERE tenant_id = $1 AND nome = '2A'", [alfa])).id;
  const alunno = (await q("SELECT id FROM people WHERE tenant_id = $1 AND nome = 'A-Student-01'", [alfa])).id;
  const scala = (await q('SELECT id FROM observation_scales WHERE tenant_id = $1 AND school_level_id IS NULL', [alfa])).id;
  const X = { alfa, docente };
  X.anno = (await q(
    "INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine, stato) VALUES ($1, '2024/2025', '2024-09-01', '2025-06-30', 'chiuso') RETURNING id", [alfa]
  )).id;
  X.materia = (await q("INSERT INTO subjects (tenant_id, school_level_id, school_year_id, nome) VALUES ($1, $2, $3, 'Matematica') RETURNING id", [alfa, livello, X.anno])).id;
  X.unita = (await q("INSERT INTO pedagogical_units (tenant_id, school_year_id, subject_id, nome) VALUES ($1, $2, $3, 'Numeri') RETURNING id", [alfa, X.anno, X.materia])).id;
  X.criteri = [];
  for (const [codice, ordine] of [['NUM-1', 1], ['NUM-2', 2]]) {
    X.criteri.push((await q(
      "INSERT INTO criteria (tenant_id, school_year_id, pedagogical_unit_id, codice, descrizione, ordine) VALUES ($1, $2, $3, $4, 'Criterio anno chiuso', $5) RETURNING id",
      [alfa, X.anno, X.unita, codice, ordine]
    )).id);
  }
  X.iscrizione = (await q('INSERT INTO enrollments (tenant_id, school_year_id, class_id, student_person_id) VALUES ($1, $2, $3, $4) RETURNING id', [alfa, X.anno, classe, alunno])).id;
  X.teaching = (await q('INSERT INTO teachings (tenant_id, school_year_id, class_id, subject_id, account_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [alfa, X.anno, classe, X.materia, docente])).id;
  X.ruolo = (await q(
    "INSERT INTO role_assignments (account_id, role_id, scope_type, tenant_id, scope_teaching_id) VALUES ($1, (SELECT id FROM roles WHERE codice = 'TEACHER'), 'TEACHING', $2, $3) RETURNING id",
    [docente, alfa, X.teaching]
  )).id;
  X.attivita = (await q(
    `INSERT INTO activities (tenant_id, school_year_id, teaching_id, class_id, subject_id, pedagogical_unit_id, nome, data_attivita, lingua_contenuto)
     VALUES ($1, $2, $3, $4, $5, $6, 'Attività dell''anno chiuso', '2025-03-10', 'it') RETURNING id`,
    [alfa, X.anno, X.teaching, classe, X.materia, X.unita]
  )).id;
  X.osservazione = (await q(
    `INSERT INTO observations (tenant_id, school_year_id, activity_id, enrollment_id, class_id, criterion_id, pedagogical_unit_id, scale_id, valore, recorded_by_account_id, data_osservazione)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, '2025-03-10') RETURNING id`,
    [alfa, X.anno, X.attivita, X.iscrizione, classe, X.criteri[0], X.unita, scala, docente]
  )).id;
  return X;
}

async function rimuoviAnnoChiuso(X) {
  await pool.query('DELETE FROM observations WHERE activity_id = $1', [X.attivita]);
  await pool.query('DELETE FROM activities WHERE teaching_id = $1', [X.teaching]);
  await pool.query('DELETE FROM role_assignments WHERE id = $1', [X.ruolo]);
  await pool.query('DELETE FROM teachings WHERE id = $1', [X.teaching]);
  await pool.query('DELETE FROM enrollments WHERE id = $1', [X.iscrizione]);
  await pool.query('DELETE FROM criteria WHERE pedagogical_unit_id = $1', [X.unita]);
  await pool.query('DELETE FROM pedagogical_units WHERE id = $1', [X.unita]);
  await pool.query('DELETE FROM subjects WHERE id = $1', [X.materia]);
  await pool.query('DELETE FROM school_years WHERE id = $1', [X.anno]);
}

test('Anno chiuso: creazione di attività, salvataggio e cancellazione di osservazioni -> 409 ERR_SCHOOL_YEAR_CLOSED; lettura 200 con dati invariati', async () => {
  const X = await creaAnnoChiuso();
  try {
    const docente = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
    const leggiTutto = async () => {
      const griglia = await docente.get(`/activities/${X.attivita}/griglia`);
      const report = await docente.get(`/activities/${X.attivita}/report-classe`);
      const attivita = await docente.get(`/teachings/${X.teaching}/activities`);
      const osservazioni = (await pool.query('SELECT * FROM observations WHERE activity_id = $1 ORDER BY id', [X.attivita])).rows;
      return { griglia, report, attivita, osservazioni };
    };
    const prima = await leggiTutto();
    assert.deepEqual([prima.griglia.status, prima.report.status, prima.attivita.status], [200, 200, 200]);
    assert.equal(prima.osservazioni.length, 1);
    assert.equal(prima.attivita.corpo.length, 1);
    const audit = async () => (await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
    const auditPrima = await audit();

    const atteso = { codice: 'ERR_SCHOOL_YEAR_CLOSED', parametri: {} };
    const crea = await docente.post(`/teachings/${X.teaching}/activities`, { nome: 'Nuova', dataAttivita: '2025-04-01', pedagogicalUnitId: X.unita });
    assert.deepEqual([crea.status, crea.corpo.errore], [409, atteso], 'creazione di attività');
    const cella = (criterio) => `/activities/${X.attivita}/enrollments/${X.iscrizione}/criteria/${criterio}`;
    const nuova = await docente.put(cella(X.criteri[1]), { valore: 2 });
    assert.deepEqual([nuova.status, nuova.corpo.errore], [409, atteso], 'osservazione nuova');
    const modifica = await docente.put(cella(X.criteri[0]), { valore: 2 });
    assert.deepEqual([modifica.status, modifica.corpo.errore], [409, atteso], 'modifica di un\'osservazione esistente');
    const cancella = await docente.put(cella(X.criteri[0]), { valore: null });
    assert.deepEqual([cancella.status, cancella.corpo.errore], [409, atteso], 'cancellazione (valore null)');

    const dopo = await leggiTutto();
    assert.deepEqual([dopo.griglia.status, dopo.report.status, dopo.attivita.status], [200, 200, 200]);
    assert.deepEqual(dopo.griglia.corpo, prima.griglia.corpo);
    assert.deepEqual(dopo.report.corpo, prima.report.corpo);
    assert.deepEqual(dopo.attivita.corpo, prima.attivita.corpo);
    assert.deepEqual(dopo.osservazioni, prima.osservazioni);
    assert.equal(await audit(), auditPrima, 'nessuna scrittura, nessun audit');
    assert.equal(dopo.griglia.corpo.righe[0].celle[0].valore, 1);
  } finally {
    await rimuoviAnnoChiuso(X);
  }
});

test('Anno attivo: salvataggio e cancellazione (valore null) di un\'osservazione riescono', async () => {
  // La creazione di attività su anno attivo è coperta da integration.test.js («Report classe: i dati di
  // un'altra attività...», POST 201) e da lingua.test.js («B: il nome di un'attività...»); il salvataggio
  // da integration.test.js («Teacher: può leggere/scrivere sulle proprie Activity...»). Qui la cancellazione.
  const docente = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
  const teaching = (await docente.get('/teachings')).corpo.find((t) => t.classe === '2A').teaching_id;
  const unita = (await docente.get(`/teachings/${teaching}/pedagogical-units`)).corpo[0];
  const attivita = await docente.post(`/teachings/${teaching}/activities`, { nome: 'Anno attivo', dataAttivita: '2026-11-20', pedagogicalUnitId: unita.id });
  assert.equal(attivita.status, 201);
  const griglia = (await docente.get(`/activities/${attivita.corpo.activity_id}/griglia`)).corpo;
  const cella = `/activities/${attivita.corpo.activity_id}/enrollments/${griglia.righe[0].enrollmentId}/criteria/${griglia.criteri[0].id}`;
  const salva = await docente.put(cella, { valore: 1 });
  assert.deepEqual([salva.status, salva.corpo.eliminato], [200, false]);
  const cancella = await docente.put(cella, { valore: null });
  assert.deepEqual([cancella.status, cancella.corpo], [200, { eliminato: true }]);
});
