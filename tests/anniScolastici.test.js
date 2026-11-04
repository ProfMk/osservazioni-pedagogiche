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

// ===========================================================================
// CALENDARIO: ROTTE DEGLI ANNI E DEI PERIODI
// ===========================================================================

const ADMIN_ALFA = 'tenant.admin.a@alfa.test';

async function idAlfa() { return (await uno(pool, "SELECT id FROM tenants WHERE slug = 'alfa'")).id; }
async function annoSeedAlfa() { return (await uno(pool, "SELECT id FROM school_years WHERE tenant_id = $1 AND nome = '2026/2027'", [await idAlfa()])).id; }

/** Dopo ogni test del calendario: via gli anni creati (con i loro periodi), l'anno del seed di nuovo attivo. */
async function ripristinaCalendario() {
  const alfa = await idAlfa();
  const seed = await annoSeedAlfa();
  const { rows } = await pool.query('SELECT id FROM school_years WHERE tenant_id = $1 AND id <> $2', [alfa, seed]);
  for (const { id } of rows) {
    await pool.query('DELETE FROM content_translations WHERE assessment_period_id IN (SELECT id FROM assessment_periods WHERE school_year_id = $1)', [id]);
    await pool.query('DELETE FROM assessment_periods WHERE school_year_id = $1', [id]);
    await pool.query('DELETE FROM school_years WHERE id = $1', [id]);
  }
  await pool.query("UPDATE school_years SET stato = 'attivo' WHERE id = $1", [seed]);
}

async function auditDi(azione, risorsaId) {
  const { rows } = await pool.query(
    'SELECT actor_account_id, tenant_id, prima, dopo, correlation_id FROM audit_log WHERE azione = $1 AND risorsa_id = $2 ORDER BY id', [azione, risorsaId]
  );
  return rows;
}

const ANNO_NUOVO = { nome: '2027/2028', dataInizio: '2027-09-01', dataFine: '2028-06-30' };

test('Calendario: un nuovo anno nasce in preparazione, con audit; azioni e anno di lavoro decisi dal server', async () => {
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const prima = (await admin.get('/admin/school-years')).corpo;
    assert.deepEqual(prima.anni.map((a) => [a.nome, a.stato, a.azioni]), [['2026/2027', 'attivo', ['chiudi']]]);
    assert.equal(prima.annoDiLavoro, await annoSeedAlfa());
    assert.equal(prima.passaggio, null);

    const r = await admin.post('/admin/school-years', { ...ANNO_NUOVO, nome: '  2027/2028 ' });
    assert.equal(r.status, 201);
    assert.deepEqual({ ...r.corpo, id: undefined }, { id: undefined, nome: '2027/2028', stato: 'in_preparazione', dataInizio: '2027-09-01', dataFine: '2028-06-30' });
    const [riga] = await auditDi('school_year.create', r.corpo.id);
    assert.equal(riga.tenant_id, await idAlfa());
    assert.deepEqual(riga.dopo, r.corpo);

    const dopo = (await admin.get('/admin/school-years')).corpo;
    assert.deepEqual(dopo.anni.map((a) => [a.nome, a.stato, a.azioni]), [
      ['2027/2028', 'in_preparazione', ['passa', 'elimina']],
      ['2026/2027', 'attivo', ['chiudi']],
    ]);
    assert.equal(dopo.annoDiLavoro, await annoSeedAlfa(), 'l\'anno attivo resta l\'anno di lavoro');
    assert.deepEqual([dopo.passaggio.daAnno.nome, dopo.passaggio.aAnno.nome], ['2026/2027', '2027/2028']);
  } finally {
    await ripristinaCalendario();
  }
});

test('Calendario: validazione del nuovo anno (campi, date, sovrapposizioni, nome unico, un solo anno in preparazione)', async () => {
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const prova = async (corpo) => erroreDi(await admin.post('/admin/school-years', corpo));
    assert.deepEqual(await prova({ ...ANNO_NUOVO, nome: ' ' }), [400, { codice: 'ERR_REQUIRED_FIELD', parametri: { campo: 'UI_FIELD_NOME' } }]);
    assert.deepEqual(await prova({ ...ANNO_NUOVO, nome: 'x'.repeat(21) }), [400, { codice: 'ERR_TEXT_TOO_LONG', parametri: { campo: 'UI_FIELD_NOME', massimo: 20 } }]);
    assert.deepEqual(await prova({ ...ANNO_NUOVO, dataInizio: '2027-02-30' }), [400, { codice: 'ERR_DATE_INVALID', parametri: { campo: 'UI_FIELD_DATA_INIZIO' } }]);
    assert.deepEqual(await prova({ ...ANNO_NUOVO, dataFine: undefined }), [400, { codice: 'ERR_REQUIRED_FIELD', parametri: { campo: 'UI_FIELD_DATA_FINE' } }]);
    assert.deepEqual(await prova({ ...ANNO_NUOVO, dataFine: '2027-09-01' }), [400, { codice: 'ERR_DATE_RANGE_INVALID', parametri: { campo: 'UI_FIELD_DATA_FINE' } }]);
    assert.deepEqual(await prova({ ...ANNO_NUOVO, dataInizio: '2027-06-30' }), [409, {
      codice: 'ERR_SCHOOL_YEAR_OVERLAP', parametri: { anno: '2026/2027', inizio: '2026-09-01', fine: '2027-06-30', campo: 'UI_FIELD_DATA_INIZIO' },
    }], 'un giorno in comune basta');
    assert.deepEqual(await prova({ ...ANNO_NUOVO, nome: '2026/2027' }), [409, { codice: 'ERR_SCHOOL_YEAR_NAME_TAKEN', parametri: { nome: '2026/2027', campo: 'UI_FIELD_NOME' } }]);
    assert.equal((await admin.post('/admin/school-years', ANNO_NUOVO)).status, 201);
    assert.deepEqual(await prova({ nome: '2028/2029', dataInizio: '2028-09-01', dataFine: '2029-06-30' }),
      [409, { codice: 'ERR_SCHOOL_YEAR_IN_PREPARATION_EXISTS', parametri: { anno: '2027/2028' } }]);
    const { n } = await uno(pool, 'SELECT count(*)::int AS n FROM school_years WHERE tenant_id = $1', [await idAlfa()]);
    assert.equal(n, 2, 'nessun anno creato dalle richieste rifiutate');
  } finally {
    await ripristinaCalendario();
  }
});

test('Calendario: transizioni con esito e audit — attiva (409 se c\'è un attivo), passa al nuovo anno, chiudi, riapri (409 se c\'è un attivo), elimina', async () => {
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const seed = await annoSeedAlfa();
    const nuovo = (await admin.post('/admin/school-years', ANNO_NUOVO)).corpo.id;
    const statoDi = async (id) => (await uno(pool, 'SELECT stato FROM school_years WHERE id = $1', [id])).stato;

    assert.deepEqual(erroreDi(await admin.post(`/admin/school-years/${nuovo}/activate`)), [409, { codice: 'ERR_SCHOOL_YEAR_ACTIVE_EXISTS', parametri: { anno: '2026/2027' } }]);
    assert.deepEqual(erroreDi(await admin.post(`/admin/school-years/${nuovo}/close`)),
      [409, { codice: 'ERR_SCHOOL_YEAR_TRANSITION_NOT_ALLOWED', parametri: { anno: '2027/2028', stato: 'STATUS_SCHOOL_YEAR_IN_PREPARAZIONE' } }]);
    assert.deepEqual(erroreDi(await admin.del(`/admin/school-years/${seed}`)),
      [409, { codice: 'ERR_SCHOOL_YEAR_NOT_DELETABLE', parametri: { anno: '2026/2027', stato: 'STATUS_SCHOOL_YEAR_ATTIVO' } }]);

    // Passa al nuovo anno: chiude l'attivo e attiva quello in preparazione, con due righe d'audit collegate.
    const passa = await admin.post(`/admin/school-years/${nuovo}/switch-to`);
    assert.equal(passa.status, 200);
    assert.deepEqual([passa.corpo.chiuso.stato, passa.corpo.attivato.stato], ['chiuso', 'attivo']);
    assert.deepEqual([await statoDi(seed), await statoDi(nuovo)], ['chiuso', 'attivo']);
    const [auditChiuso] = await auditDi('school_year.switch', seed);
    const [auditAttivato] = await auditDi('school_year.switch', nuovo);
    assert.deepEqual([auditChiuso.prima, auditChiuso.dopo], [{ stato: 'attivo' }, { stato: 'chiuso', nuovoAnnoId: nuovo }]);
    assert.deepEqual([auditAttivato.prima, auditAttivato.dopo], [{ stato: 'in_preparazione' }, { stato: 'attivo', annoChiusoId: seed }]);
    assert.ok(auditChiuso.correlation_id && auditChiuso.correlation_id === auditAttivato.correlation_id);
    assert.deepEqual(erroreDi(await admin.post(`/admin/school-years/${nuovo}/switch-to`)),
      [409, { codice: 'ERR_SCHOOL_YEAR_TRANSITION_NOT_ALLOWED', parametri: { anno: '2027/2028', stato: 'STATUS_SCHOOL_YEAR_ATTIVO' } }]);

    // Riapri l'anno precedente mentre il nuovo è attivo: 409 dedicato (caso aperto, vedi resoconto).
    assert.deepEqual(erroreDi(await admin.post(`/admin/school-years/${seed}/reopen`)), [409, { codice: 'ERR_SCHOOL_YEAR_ACTIVE_EXISTS', parametri: { anno: '2027/2028' } }]);
    const elenco = (await admin.get('/admin/school-years')).corpo;
    assert.deepEqual(elenco.anni.map((a) => [a.nome, a.azioni]), [['2027/2028', ['chiudi']], ['2026/2027', []]]);

    // Chiudi il nuovo, riapri il precedente.
    assert.equal((await admin.post(`/admin/school-years/${nuovo}/close`)).status, 200);
    assert.deepEqual((await auditDi('school_year.close', nuovo)).map((a) => [a.prima, a.dopo]), [[{ stato: 'attivo' }, { stato: 'chiuso' }]]);
    assert.equal((await admin.get('/admin/school-years')).corpo.annoDiLavoro, nuovo, 'nessun attivo né in preparazione: l\'ultimo per data');
    const riapri = await admin.post(`/admin/school-years/${seed}/reopen`);
    assert.deepEqual([riapri.status, riapri.corpo.stato], [200, 'attivo']);
    assert.deepEqual((await auditDi('school_year.reopen', seed)).map((a) => [a.prima, a.dopo]), [[{ stato: 'chiuso' }, { stato: 'attivo' }]]);
    assert.deepEqual(erroreDi(await admin.post(`/admin/school-years/${seed}/reopen`)),
      [409, { codice: 'ERR_SCHOOL_YEAR_TRANSITION_NOT_ALLOWED', parametri: { anno: '2026/2027', stato: 'STATUS_SCHOOL_YEAR_ATTIVO' } }]);

    // Un anno in preparazione si attiva direttamente quando non c'è un anno attivo.
    await pool.query('DELETE FROM school_years WHERE id = $1', [nuovo]);
    const terzo = (await admin.post('/admin/school-years', ANNO_NUOVO)).corpo.id;
    assert.equal((await admin.post(`/admin/school-years/${seed}/close`)).status, 200);
    assert.deepEqual((await admin.get('/admin/school-years')).corpo.anni.find((a) => a.id === terzo).azioni, ['attiva', 'elimina']);
    assert.deepEqual(erroreDi(await admin.post(`/admin/school-years/${terzo}/switch-to`)), [409, { codice: 'ERR_SCHOOL_YEAR_NO_ACTIVE', parametri: { anno: '2027/2028' } }]);
    assert.equal((await admin.post(`/admin/school-years/${terzo}/activate`)).status, 200);
    assert.deepEqual((await auditDi('school_year.activate', terzo)).map((a) => [a.prima, a.dopo]), [[{ stato: 'in_preparazione' }, { stato: 'attivo' }]]);
  } finally {
    await ripristinaCalendario();
  }
});

test('Calendario: «passa al nuovo anno» è atomico — se l\'attivazione fallisce, l\'anno attivo resta attivo e nessun audit è scritto', async () => {
  const c = await pool.connect();
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const seed = await annoSeedAlfa();
    const nuovo = (await admin.post('/admin/school-years', ANNO_NUOVO)).corpo.id;
    const auditPrima = (await auditDi('school_year.switch', seed)).length;
    // Guasto simulato DOPO la chiusura dell'anno attivo: un trigger rifiuta l'attivazione del nuovo.
    await c.query('RESET ROLE');
    await c.query(`CREATE FUNCTION fn_guasto_di_prova() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'guasto di prova'; END; $$ LANGUAGE plpgsql`);
    await c.query(`CREATE TRIGGER trg_guasto_di_prova BEFORE UPDATE ON school_years FOR EACH ROW
      WHEN (NEW.id = ${Number(nuovo)} AND NEW.stato = 'attivo') EXECUTE FUNCTION fn_guasto_di_prova()`);
    try {
      const r = await admin.post(`/admin/school-years/${nuovo}/switch-to`);
      assert.deepEqual(erroreDi(r), [500, { codice: 'ERR_INTERNAL', parametri: {} }]);
    } finally {
      await c.query('RESET ROLE');
      await c.query('DROP TRIGGER trg_guasto_di_prova ON school_years');
      await c.query('DROP FUNCTION fn_guasto_di_prova()');
    }
    const stati = (await pool.query('SELECT id, stato FROM school_years WHERE id IN ($1, $2) ORDER BY id', [seed, nuovo])).rows.map((r) => r.stato);
    assert.deepEqual(stati, ['attivo', 'in_preparazione'], 'nulla è cambiato');
    assert.deepEqual([(await auditDi('school_year.switch', seed)).length, (await auditDi('school_year.switch', nuovo)).length], [auditPrima, 0]);
    // Senza guasto la stessa azione riesce.
    assert.equal((await admin.post(`/admin/school-years/${nuovo}/switch-to`)).status, 200);
  } finally {
    c.release();
    await ripristinaCalendario();
  }
});

test('Calendario: eliminazione di un anno — senza dati riesce (audit), con un periodo -> 409 ERR_SCHOOL_YEAR_IN_USE, mai 500', async () => {
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const nuovo = (await admin.post('/admin/school-years', ANNO_NUOVO)).corpo.id;
    const periodo = await admin.post(`/admin/school-years/${nuovo}/periods`, { nome: 'Primo quadrimestre', dataInizio: '2027-09-01', dataFine: '2028-01-31' });
    assert.equal(periodo.status, 201);
    assert.deepEqual((await admin.get('/admin/school-years')).corpo.anni.find((a) => a.id === nuovo).azioni, ['passa'], 'con dati: niente «elimina»');
    assert.deepEqual(erroreDi(await admin.del(`/admin/school-years/${nuovo}`)), [409, { codice: 'ERR_SCHOOL_YEAR_IN_USE', parametri: { anno: '2027/2028' } }]);
    // Anche con dati che l'elenco non considera (es. una materia), mai un 500.
    assert.equal((await admin.del(`/admin/periods/${periodo.corpo.id}`)).status, 204);
    const livello = (await uno(pool, "SELECT id FROM school_levels WHERE tenant_id = $1 AND nome = 'Primaria'", [await idAlfa()])).id;
    const materia = (await uno(pool, "INSERT INTO subjects (tenant_id, school_level_id, school_year_id, nome) VALUES ($1, $2, $3, 'Prova') RETURNING id", [await idAlfa(), livello, nuovo])).id;
    assert.deepEqual(erroreDi(await admin.del(`/admin/school-years/${nuovo}`)), [409, { codice: 'ERR_SCHOOL_YEAR_IN_USE', parametri: { anno: '2027/2028' } }]);
    await pool.query('DELETE FROM subjects WHERE id = $1', [materia]);
    const r = await admin.del(`/admin/school-years/${nuovo}`);
    assert.equal(r.status, 204);
    assert.equal((await pool.query('SELECT 1 FROM school_years WHERE id = $1', [nuovo])).rows.length, 0);
    const [riga] = await auditDi('school_year.delete', nuovo);
    assert.deepEqual([riga.prima.nome, riga.prima.stato, riga.dopo], ['2027/2028', 'in_preparazione', null]);
  } finally {
    await ripristinaCalendario();
  }
});

test('Calendario: periodi — dentro l\'anno, sovrapposti ammessi, nome unico nell\'anno, modifica ed eliminazione con audit; con giudizi -> 409', async () => {
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const nuovo = (await admin.post('/admin/school-years', ANNO_NUOVO)).corpo.id;
    const crea = (corpo) => admin.post(`/admin/school-years/${nuovo}/periods`, corpo);
    const primo = await crea({ nome: 'Primo quadrimestre', dataInizio: '2027-09-01', dataFine: '2028-01-31' });
    assert.equal(primo.status, 201, 'su un anno in preparazione la configurazione è permessa');
    assert.deepEqual(primo.corpo.nome, { testo: 'Primo quadrimestre', lingua: 'it' }, 'nome nella lingua dei contenuti del tenant');
    const sovrapposto = await crea({ nome: 'Pagellino', dataInizio: '2027-11-01', dataFine: '2028-02-15' });
    assert.equal(sovrapposto.status, 201, 'sovrapposizioni ammesse');
    assert.deepEqual(erroreDi(await crea({ nome: 'Fuori', dataInizio: '2027-08-31', dataFine: '2027-12-31' })),
      [400, { codice: 'ERR_PERIOD_OUTSIDE_YEAR', parametri: { anno: '2027/2028', inizio: '2027-09-01', fine: '2028-06-30', campo: 'UI_FIELD_DATA_INIZIO' } }]);
    assert.deepEqual(erroreDi(await crea({ nome: 'Fuori', dataInizio: '2028-02-01', dataFine: '2028-07-01' })),
      [400, { codice: 'ERR_PERIOD_OUTSIDE_YEAR', parametri: { anno: '2027/2028', inizio: '2027-09-01', fine: '2028-06-30', campo: 'UI_FIELD_DATA_FINE' } }]);
    assert.deepEqual(erroreDi(await crea({ nome: 'Primo quadrimestre', dataInizio: '2028-02-01', dataFine: '2028-06-30' })),
      [409, { codice: 'ERR_PERIOD_NAME_TAKEN', parametri: { nome: 'Primo quadrimestre', campo: 'UI_FIELD_NOME' } }]);
    assert.deepEqual(erroreDi(await crea({ nome: 'x'.repeat(51), dataInizio: '2028-02-01', dataFine: '2028-06-30' })),
      [400, { codice: 'ERR_TEXT_TOO_LONG', parametri: { campo: 'UI_FIELD_NOME', massimo: 50 } }]);
    assert.deepEqual((await auditDi('assessment_period.create', primo.corpo.id))[0].dopo,
      { nome: 'Primo quadrimestre', dataInizio: '2027-09-01', dataFine: '2028-01-31', schoolYearId: nuovo });

    const elenco = (await admin.get(`/admin/school-years/${nuovo}/periods`)).corpo;
    assert.equal(elenco.modificabile, true);
    assert.deepEqual(elenco.periodi.map((p) => [p.nome.testo, p.dataInizio, p.dataFine, p.eliminabile]), [
      ['Primo quadrimestre', '2027-09-01', '2028-01-31', true],
      ['Pagellino', '2027-11-01', '2028-02-15', true],
    ]);

    // Modifica: nome e date; il nome di un altro periodo resta occupato.
    const modifica = await admin.put(`/admin/periods/${sovrapposto.corpo.id}`, { nome: 'Secondo quadrimestre', dataInizio: '2028-02-01', dataFine: '2028-06-30' });
    assert.deepEqual([modifica.status, modifica.corpo.nome.testo, modifica.corpo.dataInizio], [200, 'Secondo quadrimestre', '2028-02-01']);
    assert.deepEqual((await auditDi('assessment_period.update', sovrapposto.corpo.id)).map((a) => [a.prima.nome, a.dopo.nome]), [['Pagellino', 'Secondo quadrimestre']]);
    assert.deepEqual(erroreDi(await admin.put(`/admin/periods/${sovrapposto.corpo.id}`, { nome: 'Primo quadrimestre', dataInizio: '2028-02-01', dataFine: '2028-06-30' })),
      [409, { codice: 'ERR_PERIOD_NAME_TAKEN', parametri: { nome: 'Primo quadrimestre', campo: 'UI_FIELD_NOME' } }]);
    assert.equal((await admin.put(`/admin/periods/${sovrapposto.corpo.id}`, { nome: 'Secondo quadrimestre', dataInizio: '2028-02-01', dataFine: '2028-06-30' })).status, 200,
      'lo stesso nome del periodo stesso è ammesso');

    // Eliminazione: con un giudizio -> 409; senza -> 204, con le traduzioni.
    // Il giudizio va su un periodo dell'anno del seed, dove esistono insegnamenti e iscrizioni.
    const seed = await annoSeedAlfa();
    const periodoSeed = (await admin.post(`/admin/school-years/${seed}/periods`, { nome: 'Pagellino di prova', dataInizio: '2026-10-01', dataFine: '2026-11-30' })).corpo.id;
    const conGiudizio = await uno(pool,
      `INSERT INTO assessments (tenant_id, school_year_id, teaching_id, class_id, subject_id, enrollment_id, assessment_period_id, giudizio, recorded_by_account_id, lingua_contenuto)
       SELECT t.tenant_id, t.school_year_id, t.id, t.class_id, t.subject_id, e.id, $1, 'Giudizio di prova', t.account_id, 'it'
       FROM teachings t JOIN enrollments e ON e.class_id = t.class_id AND e.school_year_id = t.school_year_id
       WHERE t.school_year_id = $2 LIMIT 1 RETURNING id`, [periodoSeed, seed]);
    try {
      assert.equal((await admin.get(`/admin/school-years/${seed}/periods`)).corpo.periodi.find((p) => p.id === periodoSeed).eliminabile, false);
      assert.deepEqual(erroreDi(await admin.del(`/admin/periods/${periodoSeed}`)), [409, { codice: 'ERR_PERIOD_IN_USE', parametri: { nome: 'Pagellino di prova' } }]);
    } finally {
      await pool.query('DELETE FROM assessments WHERE id = $1', [conGiudizio.id]);
    }
    assert.equal((await admin.del(`/admin/periods/${periodoSeed}`)).status, 204);

    await pool.query("INSERT INTO languages (codice, direzione) VALUES ('ar-XB', 'rtl') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO tenant_languages (tenant_id, lingua) VALUES ($1, 'ar-XB') ON CONFLICT DO NOTHING", [await idAlfa()]);
    await pool.query(
      "INSERT INTO content_translations (tenant_id, lingua, campo, assessment_period_id, testo) VALUES ($1, 'ar-XB', 'assessment_periods.nome', $2, 'ترجمة')",
      [await idAlfa(), primo.corpo.id]
    );
    assert.equal((await admin.del(`/admin/periods/${primo.corpo.id}`)).status, 204, 'le traduzioni del periodo non lo bloccano');
    assert.equal((await pool.query('SELECT 1 FROM content_translations WHERE assessment_period_id = $1', [primo.corpo.id])).rows.length, 0);
    assert.equal((await auditDi('assessment_period.delete', primo.corpo.id))[0].prima.nome, 'Primo quadrimestre');
  } finally {
    await ripristinaCalendario();
  }
});

test('Calendario: su un anno chiuso nessuna scrittura (periodi 409, docenti 409); dopo «riapri» le scritture tornano possibili', async () => {
  const seed = await annoSeedAlfa();
  let periodo = null;
  let attivita = null;
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const docente = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
    const tn = (await docente.get('/teachings')).corpo.find((t) => t.proprio);
    const unita = (await docente.get(`/teachings/${tn.teaching_id}/pedagogical-units`)).corpo[0];
    const nuovaAttivita = { nome: 'Dopo la riapertura', dataAttivita: '2026-11-03', pedagogicalUnitId: unita.id };
    const nuovoPeriodo = { nome: 'Periodo di prova', dataInizio: '2026-09-01', dataFine: '2026-12-31' };

    assert.equal((await admin.post(`/admin/school-years/${seed}/close`)).status, 200);
    const CHIUSO = [409, { codice: 'ERR_SCHOOL_YEAR_CLOSED', parametri: {} }];
    assert.deepEqual(erroreDi(await admin.post(`/admin/school-years/${seed}/periods`, nuovoPeriodo)), CHIUSO);
    const periodoEsistente = (await uno(pool, 'SELECT id FROM assessment_periods WHERE school_year_id = $1 LIMIT 1', [seed]));
    if (periodoEsistente) {
      assert.deepEqual(erroreDi(await admin.put(`/admin/periods/${periodoEsistente.id}`, nuovoPeriodo)), CHIUSO);
      assert.deepEqual(erroreDi(await admin.del(`/admin/periods/${periodoEsistente.id}`)), CHIUSO);
    }
    assert.equal((await admin.get(`/admin/school-years/${seed}/periods`)).corpo.modificabile, false, 'lettura libera, ma in sola lettura');
    assert.deepEqual(erroreDi(await docente.post(`/teachings/${tn.teaching_id}/activities`, nuovaAttivita)), CHIUSO);
    assert.equal((await docente.get('/teachings')).corpo.some((t) => t.teaching_id === tn.teaching_id), true, 'un anno chiuso resta leggibile');

    assert.equal((await admin.post(`/admin/school-years/${seed}/reopen`)).status, 200);
    const p = await admin.post(`/admin/school-years/${seed}/periods`, nuovoPeriodo);
    assert.equal(p.status, 201);
    periodo = p.corpo.id;
    const a = await docente.post(`/teachings/${tn.teaching_id}/activities`, nuovaAttivita);
    assert.equal(a.status, 201);
    attivita = a.corpo.activity_id;
  } finally {
    if (attivita) await pool.query('DELETE FROM activities WHERE id = $1', [attivita]);
    if (periodo) await pool.query('DELETE FROM assessment_periods WHERE id = $1', [periodo]);
    await ripristinaCalendario();
  }
});

test('Calendario: isolamento — un TENANT_ADMIN non legge né modifica anni e periodi di un\'altra scuola (404); docente e coordinatore -> 403', async () => {
  try {
    const adminAlfa = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const nuovo = (await adminAlfa.post('/admin/school-years', ANNO_NUOVO)).corpo.id;
    const periodo = (await adminAlfa.post(`/admin/school-years/${nuovo}/periods`, { nome: 'P1', dataInizio: '2027-09-01', dataFine: '2027-12-31' })).corpo.id;
    const adminBeta = await loginESwitch(srv.base, 'tenant.admin.b@beta.test', 'beta');
    const NON_TROVATO_ANNO = [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_SCHOOL_YEAR' } }];
    const NON_TROVATO_PERIODO = [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_ASSESSMENT_PERIOD' } }];
    assert.ok(!(await adminBeta.get('/admin/school-years')).corpo.anni.some((a) => a.id === nuovo));
    assert.deepEqual(erroreDi(await adminBeta.get(`/admin/school-years/${nuovo}/periods`)), NON_TROVATO_ANNO);
    for (const azione of ['activate', 'close', 'reopen', 'switch-to']) {
      assert.deepEqual(erroreDi(await adminBeta.post(`/admin/school-years/${nuovo}/${azione}`)), NON_TROVATO_ANNO, azione);
    }
    assert.deepEqual(erroreDi(await adminBeta.del(`/admin/school-years/${nuovo}`)), NON_TROVATO_ANNO);
    assert.deepEqual(erroreDi(await adminBeta.post(`/admin/school-years/${nuovo}/periods`, { nome: 'X', dataInizio: '2027-09-01', dataFine: '2027-12-31' })), NON_TROVATO_ANNO);
    assert.deepEqual(erroreDi(await adminBeta.put(`/admin/periods/${periodo}`, { nome: 'X', dataInizio: '2027-09-01', dataFine: '2027-12-31' })), NON_TROVATO_PERIODO);
    assert.deepEqual(erroreDi(await adminBeta.del(`/admin/periods/${periodo}`)), NON_TROVATO_PERIODO);
    assert.deepEqual((await uno(pool, 'SELECT nome, stato FROM school_years WHERE id = $1', [nuovo])), { nome: '2027/2028', stato: 'in_preparazione' });
    assert.equal((await uno(pool, 'SELECT nome FROM assessment_periods WHERE id = $1', [periodo])).nome, 'P1');

    const PERMESSO = [403, { codice: 'ERR_PERMISSION_MISSING', parametri: { permesso: 'PERMISSION_TENANT_MANAGE_CONFIG' } }];
    for (const email of ['teacher.math.a@alfa.test', 'coordinator.a@alfa.test']) {
      const s = await loginESwitch(srv.base, email, 'alfa');
      const richieste = [
        s.get('/admin/school-years'), s.post('/admin/school-years', { nome: '2030/2031', dataInizio: '2030-09-01', dataFine: '2031-06-30' }),
        s.post(`/admin/school-years/${nuovo}/activate`), s.post(`/admin/school-years/${nuovo}/switch-to`), s.post(`/admin/school-years/${nuovo}/close`),
        s.post(`/admin/school-years/${nuovo}/reopen`), s.del(`/admin/school-years/${nuovo}`), s.get(`/admin/school-years/${nuovo}/periods`),
        s.post(`/admin/school-years/${nuovo}/periods`, { nome: 'X', dataInizio: '2027-09-01', dataFine: '2027-12-31' }),
        s.put(`/admin/periods/${periodo}`, { nome: 'X', dataInizio: '2027-09-01', dataFine: '2027-12-31' }), s.del(`/admin/periods/${periodo}`),
      ];
      (await Promise.all(richieste)).forEach((r, i) => assert.deepEqual(erroreDi(r), PERMESSO, `${email}, richiesta ${i}`));
    }
  } finally {
    await ripristinaCalendario();
  }
});
