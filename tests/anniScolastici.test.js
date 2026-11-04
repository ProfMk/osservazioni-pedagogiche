'use strict';

/**
 * Iterazione 2, passo A — anni scolastici.
 *
 * Parte 1: migration 006 (stato «in_preparazione», un solo anno attivo e uno solo
 *          in preparazione per tenant, controllo preventivo, rieseguibilità).
 * Parte 2: regola dell'anno — scritture dei docenti solo su «attivo», scritture di
 *          configurazione su «attivo» e «in_preparazione», anni in preparazione
 *          esclusi dal percorso degli insegnamenti.
 * Parte 3: rotte del calendario (anni e periodi), con transizioni e audit.
 *
 * Database proprio di questo file (un processo per file): i test possono cambiare
 * gli anni del seed, ma ognuno lascia lo stato com'era.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

require('./support/pglite').installa();
const { pool } = require('../server/db');

const RADICE = path.join(__dirname, '..');
const leggi = (relativo) => fs.readFileSync(path.join(RADICE, relativo), 'utf8');
const MIGRATION_006 = 'migrations/006_anni_in_preparazione.sql';

const uno = async (db, sql, parametri) => (await db.query(sql, parametri)).rows[0];

// ===========================================================================
// MIGRATION 006
// ===========================================================================

/** Database PGlite isolato con lo schema base (000) e un tenant, per provare la 006 da sola. */
async function databaseConSchemaBase() {
  const db = await PGlite.create();
  await db.exec(leggi('migrations/000_schema_base.sql'));
  await db.exec("INSERT INTO tenants (slug, nome) VALUES ('uno', 'Uno'), ('due', 'Due')");
  return db;
}

const anno = (db, slug, nome, inizio, fine, stato) => db.query(
  `INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine${stato ? ', stato' : ''})
   VALUES ((SELECT id FROM tenants WHERE slug = $1), $2, $3, $4${stato ? ', $5' : ''})`,
  stato ? [slug, nome, inizio, fine, stato] : [slug, nome, inizio, fine]
);

async function vincoliStato(db) {
  const { rows } = await db.query(
    `SELECT conname, pg_get_constraintdef(oid) AS definizione FROM pg_constraint
     WHERE conrelid = 'school_years'::regclass AND contype = 'c' ORDER BY conname`
  );
  return rows.filter((r) => /stato/.test(r.definizione));
}

async function indici006(db) {
  const { rows } = await db.query(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'school_years' AND indexname LIKE 'uq_school_years_%' ORDER BY indexname"
  );
  return rows.map((r) => r.indexname);
}

test('006: nella catena dei test lo stato ammette in_preparazione; un solo CHECK sullo stato', async () => {
  const vincoli = await vincoliStato(pool);
  assert.deepEqual(vincoli.map((v) => v.conname), ['ck_school_years_stato']);
  assert.match(vincoli[0].definizione, /attivo.*in_preparazione.*chiuso/);
  assert.deepEqual(await indici006(pool), ['uq_school_years_un_attivo', 'uq_school_years_una_preparazione']);
  await assert.rejects(
    () => pool.query("INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine, stato) VALUES ((SELECT id FROM tenants WHERE slug = 'alfa'), 'X', '2090-09-01', '2091-06-30', 'sospeso')"),
    (e) => e.code === '23514'
  );
});

test('006: al più un anno attivo e al più uno in preparazione per tenant (indici); due tenant hanno ognuno il proprio', async () => {
  const db = await databaseConSchemaBase();
  await db.exec(leggi(MIGRATION_006));
  await anno(db, 'uno', '2026/2027', '2026-09-01', '2027-06-30', 'attivo');
  await anno(db, 'uno', '2027/2028', '2027-09-01', '2028-06-30', 'in_preparazione');
  await anno(db, 'uno', '2025/2026', '2025-09-01', '2026-06-30', 'chiuso');
  await anno(db, 'uno', '2024/2025', '2024-09-01', '2025-06-30', 'chiuso');
  // L'altro tenant ha i propri: nessun conflitto.
  await anno(db, 'due', '2026/2027', '2026-09-01', '2027-06-30', 'attivo');
  await anno(db, 'due', '2027/2028', '2027-09-01', '2028-06-30', 'in_preparazione');
  await assert.rejects(() => anno(db, 'uno', '2028/2029', '2028-09-01', '2029-06-30', 'attivo'), (e) => e.code === '23505' && /uq_school_years_un_attivo/.test(e.message));
  await assert.rejects(() => anno(db, 'uno', '2029/2030', '2029-09-01', '2030-06-30', 'in_preparazione'), (e) => e.code === '23505' && /uq_school_years_una_preparazione/.test(e.message));
  // Anche un UPDATE che porterebbe a due anni attivi è rifiutato.
  await assert.rejects(() => db.query("UPDATE school_years SET stato = 'attivo' WHERE nome = '2025/2026' AND tenant_id = (SELECT id FROM tenants WHERE slug = 'uno')"), (e) => e.code === '23505');
  // Il DEFAULT resta 'attivo' (seed e dati esistenti).
  await assert.rejects(() => anno(db, 'due', '2030/2031', '2030-09-01', '2031-06-30'), (e) => e.code === '23505');
  await db.close();
});

test('006: rieseguibile (seconda esecuzione senza errori, un solo CHECK, gli stessi due indici)', async () => {
  const db = await databaseConSchemaBase();
  await anno(db, 'uno', '2026/2027', '2026-09-01', '2027-06-30');
  await db.exec(leggi(MIGRATION_006));
  await anno(db, 'uno', '2027/2028', '2027-09-01', '2028-06-30', 'in_preparazione');
  await db.exec(leggi(MIGRATION_006));
  assert.deepEqual((await vincoliStato(db)).map((v) => v.conname), ['ck_school_years_stato']);
  assert.deepEqual(await indici006(db), ['uq_school_years_un_attivo', 'uq_school_years_una_preparazione']);
  const { rows } = await db.query('SELECT nome, stato FROM school_years ORDER BY nome');
  assert.deepEqual(rows, [{ nome: '2026/2027', stato: 'attivo' }, { nome: '2027/2028', stato: 'in_preparazione' }]);
  await db.close();
});

test('006: con un tenant con due anni attivi si ferma con un messaggio chiaro e non applica nulla', async () => {
  const db = await databaseConSchemaBase();
  await anno(db, 'uno', '2025/2026', '2025-09-01', '2026-06-30');
  await anno(db, 'uno', '2026/2027', '2026-09-01', '2027-06-30');
  await assert.rejects(
    () => db.exec(leggi(MIGRATION_006)),
    (e) => /^006: 1 tenant con più di un anno scolastico attivo/.test(e.message)
  );
  await db.exec('ROLLBACK').catch(() => {});
  assert.deepEqual(await indici006(db), [], 'nessun indice creato');
  const vincoli = await vincoliStato(db);
  assert.equal(vincoli.length, 1);
  assert.notEqual(vincoli[0].conname, 'ck_school_years_stato', 'il CHECK della 000 è ancora lì');
  assert.doesNotMatch(vincoli[0].definizione, /in_preparazione/);
  await db.close();
});


// ===========================================================================
// REGOLA DELL'ANNO
// ===========================================================================

const { avviaServer, loginESwitch } = require('./support/http');
const dominio = require('../server/queries/dominio');

let srv;
test.before(async () => { srv = await avviaServer(); });
test.after(async () => {
  await srv.chiudi();
  await pool.end();
});

const erroreDi = (r) => [r.status, r.corpo && r.corpo.errore];

/**
 * Anno 2027/2028 'in_preparazione' in Alfa con un insegnamento di teacher.math.a (ruolo
 * TEACHING), un alunno iscritto e un'attività (creata con SQL: dall'applicazione non si
 * può). Restituisce gli id e una funzione che rimuove tutto.
 */
async function annoInPreparazioneConInsegnamento() {
  const q = (sql, p) => uno(pool, sql, p);
  const X = {};
  X.alfa = (await q("SELECT id FROM tenants WHERE slug = 'alfa'")).id;
  X.docente = (await q("SELECT id FROM accounts WHERE email = 'teacher.math.a@alfa.test'")).id;
  const livello = (await q("SELECT id FROM school_levels WHERE tenant_id = $1 AND nome = 'Primaria'", [X.alfa])).id;
  X.classe = (await q("SELECT id FROM classes WHERE tenant_id = $1 AND nome = '2A'", [X.alfa])).id;
  const alunno = (await q("SELECT id FROM people WHERE tenant_id = $1 AND nome = 'A-Student-01'", [X.alfa])).id;
  const scala = (await q('SELECT id FROM observation_scales WHERE tenant_id = $1 AND school_level_id IS NULL', [X.alfa])).id;
  X.anno = (await q(
    "INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine, stato) VALUES ($1, '2027/2028', '2027-09-01', '2028-06-30', 'in_preparazione') RETURNING id", [X.alfa]
  )).id;
  X.materia = (await q("INSERT INTO subjects (tenant_id, school_level_id, school_year_id, nome) VALUES ($1, $2, $3, 'Matematica nuova') RETURNING id", [X.alfa, livello, X.anno])).id;
  X.unita = (await q("INSERT INTO pedagogical_units (tenant_id, school_year_id, subject_id, nome) VALUES ($1, $2, $3, 'Numeri') RETURNING id", [X.alfa, X.anno, X.materia])).id;
  X.criterio = (await q(
    "INSERT INTO criteria (tenant_id, school_year_id, pedagogical_unit_id, codice, descrizione, ordine) VALUES ($1, $2, $3, 'NUM-1', 'Criterio anno nuovo', 1) RETURNING id",
    [X.alfa, X.anno, X.unita]
  )).id;
  X.iscrizione = (await q('INSERT INTO enrollments (tenant_id, school_year_id, class_id, student_person_id) VALUES ($1, $2, $3, $4) RETURNING id', [X.alfa, X.anno, X.classe, alunno])).id;
  X.teaching = (await q('INSERT INTO teachings (tenant_id, school_year_id, class_id, subject_id, account_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [X.alfa, X.anno, X.classe, X.materia, X.docente])).id;
  X.ruolo = (await q(
    "INSERT INTO role_assignments (account_id, role_id, scope_type, tenant_id, scope_teaching_id) VALUES ($1, (SELECT id FROM roles WHERE codice = 'TEACHER'), 'TEACHING', $2, $3) RETURNING id",
    [X.docente, X.alfa, X.teaching]
  )).id;
  X.attivita = (await q(
    `INSERT INTO activities (tenant_id, school_year_id, teaching_id, class_id, subject_id, pedagogical_unit_id, nome, data_attivita, lingua_contenuto)
     VALUES ($1, $2, $3, $4, $5, $6, 'Attività dell''anno nuovo', '2027-10-10', 'it') RETURNING id`,
    [X.alfa, X.anno, X.teaching, X.classe, X.materia, X.unita]
  )).id;
  X.scala = scala;
  X.rimuovi = async () => {
    await pool.query('DELETE FROM observations WHERE activity_id = $1', [X.attivita]);
    await pool.query('DELETE FROM activities WHERE teaching_id = $1', [X.teaching]);
    await pool.query('DELETE FROM role_assignments WHERE id = $1', [X.ruolo]);
    await pool.query('DELETE FROM teachings WHERE id = $1', [X.teaching]);
    await pool.query('DELETE FROM enrollments WHERE id = $1', [X.iscrizione]);
    await pool.query('DELETE FROM criteria WHERE pedagogical_unit_id = $1', [X.unita]);
    await pool.query('DELETE FROM pedagogical_units WHERE id = $1', [X.unita]);
    await pool.query('DELETE FROM subjects WHERE id = $1', [X.materia]);
    await pool.query('DELETE FROM assessment_periods WHERE school_year_id = $1', [X.anno]);
    await pool.query('DELETE FROM school_years WHERE id = $1', [X.anno]);
  };
  return X;
}

/** Porta l'anno del seed a 'chiuso' e quello nuovo ad 'attivo' (SQL), poi ripristina. */
async function conAnnoNuovoAttivo(X, fn) {
  const annoSeed = (await uno(pool, "SELECT id FROM school_years WHERE tenant_id = $1 AND stato = 'attivo'", [X.alfa])).id;
  await pool.query("UPDATE school_years SET stato = 'chiuso' WHERE id = $1", [annoSeed]);
  await pool.query("UPDATE school_years SET stato = 'attivo' WHERE id = $1", [X.anno]);
  try {
    return await fn();
  } finally {
    await pool.query("UPDATE school_years SET stato = 'in_preparazione' WHERE id = $1", [X.anno]);
    await pool.query("UPDATE school_years SET stato = 'attivo' WHERE id = $1", [annoSeed]);
  }
}

test('Regola dell\'anno: il docente non vede gli insegnamenti di un anno in preparazione (elenco e viste: 404); li vede quando l\'anno diventa attivo', async () => {
  const X = await annoInPreparazioneConInsegnamento();
  try {
    const docente = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
    const elenco = async () => (await docente.get('/teachings')).corpo.map((t) => t.teaching_id);
    const prima = await elenco();
    assert.ok(prima.length > 0, 'gli insegnamenti dell\'anno attivo restano');
    assert.ok(!prima.includes(X.teaching), 'nessun insegnamento dell\'anno in preparazione');
    const NON_TROVATO = [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_TEACHING' } }];
    for (const vista of ['activities', 'pedagogical-units', 'students', 'class-overview', 'students-matrix', 'assessments']) {
      assert.deepEqual(erroreDi(await docente.get(`/teachings/${X.teaching}/${vista}`)), NON_TROVATO, vista);
    }
    assert.deepEqual(erroreDi(await docente.get(`/teachings/${X.teaching}/students/${X.iscrizione}/progress`)), NON_TROVATO);
    for (const vista of ['griglia', 'report-classe']) {
      assert.deepEqual(erroreDi(await docente.get(`/activities/${X.attivita}/${vista}`)),
        [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_ACTIVITY' } }], vista);
    }
    // Anche le altre vie verso gli insegnamenti (amministratore, insegnamenti di una classe) lo escludono.
    const admin = await loginESwitch(srv.base, 'tenant.admin.a@alfa.test', 'alfa');
    assert.ok(!(await admin.get('/teachings')).corpo.some((t) => t.teaching_id === X.teaching), 'per tutti i ruoli');
    const dellaClasse = (await admin.get(`/classes/${X.classe}/teachings`)).corpo;
    assert.ok(dellaClasse.length > 0 && !dellaClasse.some((t) => t.teaching_id === X.teaching));

    await conAnnoNuovoAttivo(X, async () => {
      assert.ok((await elenco()).includes(X.teaching), 'anno attivo: l\'insegnamento compare');
      assert.equal((await docente.get(`/teachings/${X.teaching}/activities`)).status, 200);
      assert.equal((await docente.get(`/activities/${X.attivita}/griglia`)).status, 200);
    });
    assert.ok(!(await elenco()).includes(X.teaching), 'di nuovo in preparazione: sparisce');
  } finally {
    await X.rimuovi();
  }
});

test('Regola dell\'anno: scritture dei docenti su un anno in preparazione -> 409 ERR_SCHOOL_YEAR_IN_PREPARATION, nessun dato scritto; riuscite quando è attivo', async () => {
  const X = await annoInPreparazioneConInsegnamento();
  try {
    const docente = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
    const IN_PREPARAZIONE = [409, { codice: 'ERR_SCHOOL_YEAR_IN_PREPARATION', parametri: {} }];
    const nuovaAttivita = { nome: 'Nuova', dataAttivita: '2027-10-12', pedagogicalUnitId: X.unita };
    assert.deepEqual(erroreDi(await docente.post(`/teachings/${X.teaching}/activities`, nuovaAttivita)), IN_PREPARAZIONE);
    const cella = `/activities/${X.attivita}/enrollments/${X.iscrizione}/criteria/${X.criterio}`;
    assert.deepEqual(erroreDi(await docente.put(cella, { valore: 1 })), IN_PREPARAZIONE);
    assert.deepEqual(erroreDi(await docente.put(cella, { valore: null })), IN_PREPARAZIONE, 'anche la cancellazione');
    const contaAttivita = async () => (await uno(pool, 'SELECT count(*)::int AS n FROM activities WHERE teaching_id = $1', [X.teaching])).n;
    const contaOsservazioni = async () => (await uno(pool, 'SELECT count(*)::int AS n FROM observations WHERE activity_id = $1', [X.attivita])).n;
    assert.deepEqual([await contaAttivita(), await contaOsservazioni()], [1, 0]);

    await conAnnoNuovoAttivo(X, async () => {
      assert.equal((await docente.post(`/teachings/${X.teaching}/activities`, nuovaAttivita)).status, 201);
      assert.equal((await docente.put(cella, { valore: 1 })).status, 200);
      assert.deepEqual([await contaAttivita(), await contaOsservazioni()], [2, 1]);
    });
  } finally {
    await X.rimuovi();
  }
});

test('Regola dell\'anno: scritture di configurazione consentite su attivo e in preparazione, 409 su chiuso, 404 per l\'anno di un altro tenant', async () => {
  const X = await annoInPreparazioneConInsegnamento();
  try {
    const annoSeed = (await uno(pool, "SELECT id FROM school_years WHERE tenant_id = $1 AND stato = 'attivo'", [X.alfa])).id;
    const beta = (await uno(pool, "SELECT id FROM tenants WHERE slug = 'beta'")).id;
    const annoBeta = (await uno(pool, 'SELECT id FROM school_years WHERE tenant_id = $1', [beta])).id;
    const chiuso = (await uno(pool,
      "INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine, stato) VALUES ($1, '2020/2021', '2020-09-01', '2021-06-30', 'chiuso') RETURNING id", [X.alfa])).id;
    try {
      assert.equal((await dominio.verificaAnnoScolasticoConfigurabile(pool, annoSeed, X.alfa)).stato, 'attivo');
      const prep = await dominio.verificaAnnoScolasticoConfigurabile(pool, X.anno, X.alfa);
      assert.deepEqual([prep.stato, prep.data_inizio, prep.data_fine], ['in_preparazione', '2027-09-01', '2028-06-30']);
      await assert.rejects(() => dominio.verificaAnnoScolasticoConfigurabile(pool, chiuso, X.alfa),
        (e) => e.stato === 409 && e.codice === 'ERR_SCHOOL_YEAR_CLOSED');
      await assert.rejects(() => dominio.verificaAnnoScolasticoConfigurabile(pool, annoBeta, X.alfa),
        (e) => e.stato === 404 && e.codice === 'ERR_NOT_FOUND');
      // La regola dei docenti resta quella di prima: solo 'attivo'.
      await dominio.verificaAnnoScolasticoAttivo(pool, annoSeed, X.alfa);
      await assert.rejects(() => dominio.verificaAnnoScolasticoAttivo(pool, chiuso, X.alfa), (e) => e.codice === 'ERR_SCHOOL_YEAR_CLOSED');
      await assert.rejects(() => dominio.verificaAnnoScolasticoAttivo(pool, X.anno, X.alfa), (e) => e.codice === 'ERR_SCHOOL_YEAR_IN_PREPARATION');
    } finally {
      await pool.query('DELETE FROM school_years WHERE id = $1', [chiuso]);
    }
  } finally {
    await X.rimuovi();
  }
});
