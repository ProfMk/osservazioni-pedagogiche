'use strict';

/**
 * Iterazione 1 — creazione di una scuola, primo amministratore, password
 * temporanea e cambio obbligatorio al primo accesso.
 *
 * Parte 1: migration 005 (colonne, indice su lower(email), controllo dei
 * doppioni, rieseguibilità, privilegi di app_role).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

require('./support/pglite').installa();
const { pool, transazione } = require('../server/db');

const RADICE = path.join(__dirname, '..');
const leggi = (relativo) => fs.readFileSync(path.join(RADICE, relativo), 'utf8');
const MIGRATION_005 = 'migrations/005_account_primo_accesso.sql';

test.after(async () => {
  await pool.end();
});

/** Database PGlite isolato con lo schema base (000), per provare la 005 da sola. */
async function databaseConSchemaBase() {
  const db = await PGlite.create();
  await db.exec(leggi('migrations/000_schema_base.sql'));
  return db;
}

async function inserisciAccount(db, email) {
  const { rows } = await db.query("INSERT INTO people (nome, cognome) VALUES ('N', 'C') RETURNING id");
  await db.query('INSERT INTO accounts (email, person_id) VALUES ($1, $2)', [email, rows[0].id]);
}

async function colonneNuove(db) {
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'accounts' AND column_name IN ('deve_cambiare_password', 'password_temporanea_scade_il')
     ORDER BY column_name`
  );
  return rows.map((r) => r.column_name);
}

// ===========================================================================
// MIGRATION 005
// ===========================================================================

test('005: colonne nuove; gli account dei seed non hanno obbligo di cambio né scadenza', async () => {
  const { rows } = await pool.query(
    'SELECT email, deve_cambiare_password, password_temporanea_scade_il FROM accounts ORDER BY id'
  );
  assert.ok(rows.length >= 8, 'gli account del seed ci sono');
  rows.forEach((r) => {
    assert.equal(r.deve_cambiare_password, false, `${r.email}: nessun obbligo di cambio`);
    assert.equal(r.password_temporanea_scade_il, null, `${r.email}: nessuna password temporanea`);
  });
});

test('005: app_role legge e scrive le colonne nuove (privilegi di tabella della 002)', async () => {
  const { rows: ruolo } = await pool.query('SELECT current_role');
  assert.equal(ruolo[0].current_role, 'app_role');
  const { rows } = await pool.query(
    `SELECT c AS colonna,
            has_column_privilege('app_role', 'accounts', c, 'SELECT') AS lettura,
            has_column_privilege('app_role', 'accounts', c, 'UPDATE') AS scrittura,
            has_column_privilege('app_role', 'accounts', c, 'INSERT') AS inserimento
     FROM unnest(ARRAY['deve_cambiare_password', 'password_temporanea_scade_il']) AS c`
  );
  rows.forEach((r) => assert.deepEqual([r.lettura, r.scrittura, r.inserimento], [true, true, true], r.colonna));
  // Prova reale sotto app_role, annullata alla fine: nessuna traccia per gli altri test.
  const ANNULLA = new Error('annulla');
  await assert.rejects(() => transazione(async (client) => {
    await client.query(
      "UPDATE accounts SET deve_cambiare_password = true, password_temporanea_scade_il = now() WHERE email = 'teacher.math.a@alfa.test'"
    );
    const { rows: letti } = await client.query(
      "SELECT deve_cambiare_password, password_temporanea_scade_il FROM accounts WHERE email = 'teacher.math.a@alfa.test'"
    );
    assert.equal(letti[0].deve_cambiare_password, true);
    assert.ok(letti[0].password_temporanea_scade_il);
    throw ANNULLA;
  }), (e) => e === ANNULLA);
  const { rows: dopo } = await pool.query("SELECT deve_cambiare_password FROM accounts WHERE email = 'teacher.math.a@alfa.test'");
  assert.equal(dopo[0].deve_cambiare_password, false);
});

test('005: indice univoco su lower(email): la stessa email con altre maiuscole è rifiutata (23505)', async () => {
  const { rows: indice } = await pool.query(
    "SELECT indexdef FROM pg_indexes WHERE tablename = 'accounts' AND indexname = 'uq_accounts_email_lower'"
  );
  assert.equal(indice.length, 1);
  assert.match(indice[0].indexdef, /UNIQUE INDEX .* \(lower\(\(email\)::text\)\)/);
  const { rows: persona } = await pool.query("INSERT INTO people (nome, cognome) VALUES ('Doppio', 'Maiuscole') RETURNING id");
  await assert.rejects(
    () => pool.query('INSERT INTO accounts (email, person_id) VALUES ($1, $2)', ['Teacher.Math.A@Alfa.Test', persona[0].id]),
    (e) => e.code === '23505'
  );
});

test('005: rieseguibile (seconda esecuzione senza errori né modifiche)', async () => {
  const db = await databaseConSchemaBase();
  await inserisciAccount(db, 'uno@example.test');
  await db.exec(leggi(MIGRATION_005));
  await db.exec(leggi(MIGRATION_005));
  assert.deepEqual(await colonneNuove(db), ['deve_cambiare_password', 'password_temporanea_scade_il']);
  const { rows } = await db.query("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'uq_accounts_email_lower'");
  assert.equal(rows[0].n, 1);
  await db.close();
});

test('005: con email doppie a meno delle maiuscole si ferma con un messaggio chiaro e non applica nulla', async () => {
  const db = await databaseConSchemaBase();
  await inserisciAccount(db, 'mario.rossi@example.test');
  await inserisciAccount(db, 'Mario.Rossi@Example.test');
  await assert.rejects(
    () => db.exec(leggi(MIGRATION_005)),
    (e) => /^005: 1 gruppi di account con la stessa email a meno delle maiuscole/.test(e.message)
  );
  await db.exec('ROLLBACK').catch(() => {});
  assert.deepEqual(await colonneNuove(db), [], 'transazione annullata: nessuna colonna aggiunta');
  const { rows } = await db.query("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'uq_accounts_email_lower'");
  assert.equal(rows[0].n, 0, 'nessun indice creato');
  await db.close();
});
