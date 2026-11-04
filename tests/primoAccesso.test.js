'use strict';

/**
 * Iterazione 1 — creazione di una scuola, primo amministratore, password
 * temporanea e cambio obbligatorio al primo accesso.
 *
 * Parte 1: migration 005 (colonne, indice su lower(email), controllo dei
 * doppioni, rieseguibilità, privilegi di app_role).
 * Parte 2: primo accesso con password temporanea, blocco delle API finché non
 * è cambiata, POST /api/auth/password, scadenza della temporanea, nessuna
 * password nei log.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

require('./support/pglite').installa();
const { pool, transazione } = require('../server/db');
const { avviaServer, SessioneHttp, login } = require('./support/http');
const {
  hashPassword, generaPasswordTemporanea, validaPasswordNuova, ALFABETO_TEMPORANEA, LUNGHEZZA_TEMPORANEA,
} = require('../server/lib/password');
const { asincrono, senzaPassword, OMESSA } = require('../server/lib/asincrono');
const { gestoreErrori } = require('../server/routes/index');

const RADICE = path.join(__dirname, '..');
const leggi = (relativo) => fs.readFileSync(path.join(RADICE, relativo), 'utf8');
const MIGRATION_005 = 'migrations/005_account_primo_accesso.sql';

let srv;
test.before(async () => { srv = await avviaServer(); });
test.after(async () => {
  await srv.chiudi();
  await pool.end();
});

const NUOVA_PASSWORD = 'una frase lunga e nuova';

/**
 * Account con password temporanea creato direttamente nel database (la rotta di
 * creazione è provata nella parte 3): Membership in Alfa, nessun ruolo.
 */
async function accountTemporaneo(email, { scadeTra = "interval '7 days'" } = {}) {
  const password = generaPasswordTemporanea();
  const { rows: persona } = await pool.query("INSERT INTO people (nome, cognome) VALUES ('Prima', 'Volta') RETURNING id");
  const { rows } = await pool.query(
    `INSERT INTO accounts (email, password_hash, person_id, deve_cambiare_password, password_temporanea_scade_il)
     VALUES ($1, $2, $3, true, now() + ${scadeTra}) RETURNING id`,
    [email, await hashPassword(password), persona[0].id]
  );
  const { rows: alfa } = await pool.query("SELECT id FROM tenants WHERE slug = 'alfa'");
  await pool.query('INSERT INTO memberships (account_id, tenant_id) VALUES ($1, $2)', [rows[0].id, alfa[0].id]);
  return { id: rows[0].id, email, password, tenantId: alfa[0].id };
}

const erroreDi = (r) => [r.status, r.corpo && r.corpo.errore];
const CAMBIO_RICHIESTO = [403, { codice: 'ERR_PASSWORD_CHANGE_REQUIRED', parametri: {} }];

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

// ===========================================================================
// PASSWORD TEMPORANEA
// ===========================================================================

test('Password temporanea: 16 caratteri dall\'alfabeto senza ambigui (niente 0 O o 1 l I), ogni volta diversa', () => {
  assert.equal(LUNGHEZZA_TEMPORANEA, 16);
  for (const ambiguo of ['0', 'O', 'o', '1', 'l', 'I']) assert.ok(!ALFABETO_TEMPORANEA.includes(ambiguo), ambiguo);
  const generate = new Set();
  for (let i = 0; i < 200; i += 1) {
    const p = generaPasswordTemporanea();
    assert.equal(p.length, 16);
    assert.ok([...p].every((c) => ALFABETO_TEMPORANEA.includes(c)), p);
    generate.add(p);
  }
  assert.equal(generate.size, 200);
});

test('Password nuova: lunghezza in caratteri (non in unità UTF-16), tra 12 e 128, nessuna regola di composizione', () => {
  const codice = (f) => { try { f(); return null; } catch (e) { return e.codice; } };
  assert.equal(codice(() => validaPasswordNuova('😀'.repeat(11))), 'ERR_PASSWORD_TOO_SHORT', '11 caratteri (22 unità UTF-16)');
  assert.equal(codice(() => validaPasswordNuova('àèìòùàèìòùàè')), null, '12 caratteri accentati');
  assert.equal(codice(() => validaPasswordNuova('aaaaaaaaaaaa')), null, 'nessuna regola di composizione');
  assert.equal(codice(() => validaPasswordNuova('😀'.repeat(128))), null, '128 caratteri');
  assert.equal(codice(() => validaPasswordNuova('😀'.repeat(129))), 'ERR_PASSWORD_TOO_LONG');
  assert.equal(codice(() => validaPasswordNuova(undefined)), 'ERR_REQUIRED_FIELD');
  assert.equal(codice(() => validaPasswordNuova(123456789012)), 'ERR_REQUIRED_FIELD');
});

// ===========================================================================
// PRIMO ACCESSO: CAMBIO OBBLIGATORIO
// ===========================================================================

test('Primo accesso: login riuscito con deveCambiarePassword; ogni altra API -> 403 ERR_PASSWORD_CHANGE_REQUIRED', async () => {
  const account = await accountTemporaneo('primo.accesso@alfa.test');
  const { sessione, risposta } = await login(srv.base, account.email, account.password);
  assert.equal(risposta.status, 200);
  assert.equal(risposta.corpo.deveCambiarePassword, true);

  // Consentite: /auth/me e /i18n.
  const me = await sessione.get('/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.corpo.deveCambiarePassword, true);
  assert.equal((await sessione.get('/i18n')).status, 200);

  // Tutto il resto è bloccato, prima ancora del permesso o del tenant attivo.
  assert.deepEqual(erroreDi(await sessione.post('/auth/switch-tenant', { tenantId: account.tenantId })), CAMBIO_RICHIESTO);
  assert.deepEqual(erroreDi(await sessione.get('/teachings')), CAMBIO_RICHIESTO);
  assert.deepEqual(erroreDi(await sessione.get('/platform/tenants')), CAMBIO_RICHIESTO);
  assert.deepEqual(erroreDi(await sessione.post('/platform/tenants', { slug: 'mai', nome: 'Mai' })), CAMBIO_RICHIESTO);
  assert.deepEqual(erroreDi(await sessione.put('/me/lingua', { lingua: 'it' })), CAMBIO_RICHIESTO);
  assert.deepEqual(erroreDi(await sessione.post('/role-assignments', {})), CAMBIO_RICHIESTO);
  assert.deepEqual(erroreDi(await sessione.get('/admin/traduzioni/completezza')), CAMBIO_RICHIESTO);
  const { rows } = await pool.query("SELECT 1 FROM sessions WHERE account_id = $1 AND active_tenant_id IS NOT NULL", [account.id]);
  assert.equal(rows.length, 0, 'lo switch bloccato non ha impostato il tenant');

  // Consentito: logout.
  assert.equal((await sessione.post('/auth/logout')).status, 204);
  assert.equal((await sessione.get('/auth/me')).status, 401);
});

test('Cambio password: attuale errata, nuova troppo corta o lunga, nuova uguale alla temporanea, campi mancanti -> errori', async () => {
  const account = await accountTemporaneo('cambio.errori@alfa.test');
  const { sessione } = await login(srv.base, account.email, account.password);
  const prova = (corpo) => sessione.post('/auth/password', corpo).then(erroreDi);

  assert.deepEqual(await prova({ passwordAttuale: 'non-è-questa-123', passwordNuova: NUOVA_PASSWORD }),
    [400, { codice: 'ERR_PASSWORD_CURRENT_INVALID', parametri: {} }]);
  assert.deepEqual(await prova({ passwordAttuale: account.password, passwordNuova: 'corta-11ch' + 'x' }),
    [400, { codice: 'ERR_PASSWORD_TOO_SHORT', parametri: { minimo: 12 } }]);
  assert.deepEqual(await prova({ passwordAttuale: account.password, passwordNuova: 'x'.repeat(129) }),
    [400, { codice: 'ERR_PASSWORD_TOO_LONG', parametri: { massimo: 128 } }]);
  assert.deepEqual(await prova({ passwordAttuale: account.password, passwordNuova: account.password }),
    [400, { codice: 'ERR_PASSWORD_SAME_AS_TEMPORARY', parametri: {} }]);
  assert.deepEqual(await prova({ passwordNuova: NUOVA_PASSWORD }),
    [400, { codice: 'ERR_REQUIRED_FIELD', parametri: { campo: 'UI_FIELD_PASSWORD_CURRENT' } }]);
  assert.deepEqual(await prova({ passwordAttuale: account.password }),
    [400, { codice: 'ERR_REQUIRED_FIELD', parametri: { campo: 'UI_FIELD_PASSWORD_NEW' } }]);

  // Nessuna modifica: l'obbligo resta, la password resta la temporanea.
  const { rows } = await pool.query('SELECT deve_cambiare_password, password_changed_at FROM accounts WHERE id = $1', [account.id]);
  assert.deepEqual([rows[0].deve_cambiare_password, rows[0].password_changed_at], [true, null]);
  const { rows: audit } = await pool.query("SELECT 1 FROM audit_log WHERE azione = 'account.password_change' AND risorsa_id = $1", [account.id]);
  assert.equal(audit.length, 0);
});

test('Cambio password riuscito: altre sessioni revocate, token ruotato, API di nuovo accessibili, audit senza valori', async () => {
  const account = await accountTemporaneo('cambio.riuscito@alfa.test');
  const { sessione: altra } = await login(srv.base, account.email, account.password);
  const { sessione } = await login(srv.base, account.email, account.password);
  const tokenPrima = sessione.token;
  const idSessione = (await pool.query('SELECT id FROM sessions WHERE account_id = $1 ORDER BY id DESC LIMIT 1', [account.id])).rows[0].id;

  const r = await sessione.post('/auth/password', { passwordAttuale: account.password, passwordNuova: NUOVA_PASSWORD });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.deveCambiarePassword, false);
  assert.ok(!JSON.stringify(r.corpo).includes(NUOVA_PASSWORD) && !JSON.stringify(r.corpo).includes(account.password),
    'nessuna password nella risposta');

  // Token ruotato: nuovo cookie, il vecchio non vale più, la riga di sessione è la stessa.
  assert.ok(sessione.token && sessione.token !== tokenPrima, 'nuovo token nel cookie');
  const vecchio = new SessioneHttp(srv.base);
  vecchio.token = tokenPrima;
  assert.equal((await vecchio.get('/auth/me')).status, 401, 'il token precedente non è più valido');
  const { rows: sessioni } = await pool.query('SELECT id, revoked_at, revoked_reason FROM sessions WHERE account_id = $1 ORDER BY id', [account.id]);
  assert.deepEqual(sessioni.map((s) => [s.id === idSessione, s.revoked_at === null, s.revoked_reason]),
    [[false, false, 'cambio_password'], [true, true, null]]);
  assert.equal((await altra.get('/auth/me')).status, 401, "l'altra sessione è revocata");

  // Le API tornano accessibili con la sessione corrente (stesso csrfToken: dipende dall'id di sessione).
  assert.equal((await sessione.post('/auth/switch-tenant', { tenantId: account.tenantId })).status, 200);
  assert.equal((await sessione.get('/teachings')).status, 200);

  const { rows: dopo } = await pool.query(
    'SELECT deve_cambiare_password, password_temporanea_scade_il, password_changed_at FROM accounts WHERE id = $1', [account.id]
  );
  assert.equal(dopo[0].deve_cambiare_password, false);
  assert.equal(dopo[0].password_temporanea_scade_il, null);
  assert.ok(dopo[0].password_changed_at);

  const { rows: audit } = await pool.query("SELECT * FROM audit_log WHERE azione = 'account.password_change' AND risorsa_id = $1", [account.id]);
  assert.equal(audit.length, 1);
  assert.deepEqual([audit[0].risorsa, audit[0].actor_account_id, audit[0].prima, audit[0].dopo], ['account', account.id, null, null]);

  // Nuove credenziali: la nuova password entra senza obbligo, la temporanea non più.
  const conNuova = await login(srv.base, account.email, NUOVA_PASSWORD);
  assert.deepEqual([conNuova.risposta.status, conNuova.risposta.corpo.deveCambiarePassword], [200, false]);
  assert.equal((await login(srv.base, account.email, account.password)).risposta.status, 401);
});

test('Cambio password volontario: stessa rotta per chi non ha l\'obbligo; la nuova deve essere diversa dall\'attuale', async () => {
  const account = await accountTemporaneo('volontario@alfa.test');
  const { sessione } = await login(srv.base, account.email, account.password);
  assert.equal((await sessione.post('/auth/password', { passwordAttuale: account.password, passwordNuova: NUOVA_PASSWORD })).status, 200);
  assert.deepEqual(erroreDi(await sessione.post('/auth/password', { passwordAttuale: NUOVA_PASSWORD, passwordNuova: NUOVA_PASSWORD })),
    [400, { codice: 'ERR_PASSWORD_SAME_AS_CURRENT', parametri: {} }]);
  const r = await sessione.post('/auth/password', { passwordAttuale: NUOVA_PASSWORD, passwordNuova: 'un\'altra frase ancora' });
  assert.deepEqual([r.status, r.corpo.deveCambiarePassword], [200, false]);
  const { rows: audit } = await pool.query("SELECT 1 FROM audit_log WHERE azione = 'account.password_change' AND risorsa_id = $1", [account.id]);
  assert.equal(audit.length, 2);
});

test('Cambio password: senza sessione 401, senza CSRF 403', async () => {
  const anonimo = new SessioneHttp(srv.base);
  assert.equal((await anonimo.post('/auth/password', { passwordAttuale: 'x', passwordNuova: NUOVA_PASSWORD })).status, 401);
  const account = await accountTemporaneo('senza.csrf@alfa.test');
  const { sessione } = await login(srv.base, account.email, account.password);
  sessione.csrfToken = null;
  assert.deepEqual(erroreDi(await sessione.post('/auth/password', { passwordAttuale: account.password, passwordNuova: NUOVA_PASSWORD })),
    [403, { codice: 'ERR_CSRF_INVALID', parametri: {} }]);
});

test('Password temporanea scaduta: login fallito con lo stesso errore generico delle credenziali errate', async () => {
  const account = await accountTemporaneo('scaduta@alfa.test', { scadeTra: "interval '-1 minute'" });
  const scaduta = await login(srv.base, account.email, account.password);
  const errata = await login(srv.base, account.email, 'password-sbagliata');
  const inesistente = await login(srv.base, 'nessuno@alfa.test', 'qualunque');
  assert.equal(scaduta.risposta.status, 401);
  assert.deepEqual(scaduta.risposta.corpo, errata.risposta.corpo);
  assert.deepEqual(scaduta.risposta.corpo, inesistente.risposta.corpo);
  assert.deepEqual(scaduta.risposta.corpo.errore, { codice: 'ERR_CREDENTIALS_INVALID', parametri: {} });
  const { rows } = await pool.query('SELECT 1 FROM sessions WHERE account_id = $1', [account.id]);
  assert.equal(rows.length, 0, 'nessuna sessione creata');
});

test('Login: l\'email si confronta senza maiuscole e spazi', async () => {
  const { risposta } = await login(srv.base, '  Teacher.Math.A@ALFA.test ');
  assert.equal(risposta.status, 200);
  assert.equal(risposta.corpo.account.email, 'teacher.math.a@alfa.test');
});

test('Account dei seed: nessun obbligo di cambio, API accessibili', async () => {
  const { rows } = await pool.query("SELECT email FROM accounts WHERE email LIKE '%.test' AND password_hash LIKE '$argon2id$%' ORDER BY id LIMIT 8");
  assert.equal(rows.length, 8);
  for (const { email } of rows) {
    const { sessione, risposta } = await login(srv.base, email);
    assert.deepEqual([email, risposta.status, risposta.corpo.deveCambiarePassword], [email, 200, false]);
    const tenant = risposta.corpo.tenantsDisponibiliPerSwitch[0];
    if (tenant) assert.equal((await sessione.post('/auth/switch-tenant', { tenantId: tenant.tenant_id ?? tenant.id })).status, 200, email);
  }
});

// ===========================================================================
// NESSUNA PASSWORD NEI LOG
// ===========================================================================

test('Log: la diagnosi degli errori imprevisti non contiene mai una password (campi «*password*» omessi)', async () => {
  assert.deepEqual(
    senzaPassword({ email: 'a@b.c', password: 'p1', amministratore: { passwordTemporanea: 'p2', nome: 'N' }, elenco: [{ passwordNuova: 'p3' }] }),
    { email: 'a@b.c', password: OMESSA, amministratore: { passwordTemporanea: OMESSA, nome: 'N' }, elenco: [{ passwordNuova: OMESSA }] }
  );

  // Errore imprevisto in una rotta: asincrono() cattura il corpo, gestoreErrori lo scrive in console.
  const corpo = { passwordAttuale: 'segreto-attuale-1', passwordNuova: 'segreto-nuovo-123', altro: 'visibile' };
  const req = { params: {}, body: corpo, method: 'POST', originalUrl: '/api/auth/password' };
  const errore = await new Promise((risolvi) => asincrono(async () => { throw new Error('imprevisto'); })(req, {}, risolvi));
  const righe = [];
  const originale = console.error;
  console.error = (...argomenti) => righe.push(argomenti.join(' '));
  try {
    gestoreErrori(errore, req, { status() { return this; }, json() { return this; } }, () => {});
  } finally {
    console.error = originale;
  }
  assert.equal(righe.length, 1);
  assert.ok(righe[0].includes('visibile') && righe[0].includes(OMESSA));
  assert.ok(!righe[0].includes('segreto-attuale-1') && !righe[0].includes('segreto-nuovo-123'), righe[0]);
  assert.equal(req.body, corpo, 'il corpo della richiesta non è modificato');
});
