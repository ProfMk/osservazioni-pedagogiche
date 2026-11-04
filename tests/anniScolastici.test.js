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

