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
 * Parte 3: il PLATFORM_ADMIN crea una scuola e il suo primo TENANT_ADMIN (una
 * transazione), reimposta la password temporanea; nessuna password o hash
 * nell'audit (ultimo test del file: scandisce tutto l'audit prodotto).
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
/** Ogni password in chiaro vista nei test: l'ultimo test verifica che nessuna sia finita nell'audit. */
const PASSWORD_VISTE = [NUOVA_PASSWORD, 'un\'altra frase ancora', 'Sviluppo!2026'];

/**
 * Account con password temporanea creato direttamente nel database (la rotta di
 * creazione è provata nella parte 3): Membership in Alfa, nessun ruolo.
 */
async function accountTemporaneo(email, { scadeTra = "interval '7 days'" } = {}) {
  const password = generaPasswordTemporanea();
  PASSWORD_VISTE.push(password);
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
  assert.deepEqual(me.corpo.regolePassword, { minimo: 12, massimo: 128 }, 'regole per il client');
  assert.equal((await sessione.get('/i18n')).status, 200);

  // Tutto il resto è bloccato, prima ancora del permesso o del tenant attivo.
  assert.deepEqual(erroreDi(await sessione.post('/auth/switch-tenant', { tenantId: account.tenantId })), CAMBIO_RICHIESTO);
  assert.deepEqual(erroreDi(await sessione.get('/teachings')), CAMBIO_RICHIESTO);
  assert.deepEqual(erroreDi(await sessione.get('/platform/tenants')), CAMBIO_RICHIESTO);
  assert.deepEqual(erroreDi(await sessione.post('/platform/tenants', { slug: 'mai', nome: 'Mai' })), CAMBIO_RICHIESTO);
  assert.deepEqual(erroreDi(await sessione.put('/me/lingua', { lingua: 'it' })), CAMBIO_RICHIESTO);
  assert.deepEqual(erroreDi(await sessione.post('/role-assignments', {})), CAMBIO_RICHIESTO);
  assert.deepEqual(erroreDi(await sessione.get('/admin/traduzioni/completezza')), CAMBIO_RICHIESTO);
  const { rows } = await pool.query('SELECT active_tenant_id FROM sessions WHERE account_id = $1', [account.id]);
  assert.deepEqual(rows.map((r) => r.active_tenant_id), [account.tenantId], 'una sola scuola: tenant attivo impostato dal login (passo 6)');

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

// ===========================================================================
// CREAZIONE DI UNA SCUOLA E DEL SUO PRIMO AMMINISTRATORE
// ===========================================================================

const PLATFORM_ADMIN = 'platform.admin@platform.test';

async function sessionePiattaforma() {
  const { sessione, risposta } = await login(srv.base, PLATFORM_ADMIN);
  assert.equal(risposta.status, 200);
  return { sessione, adminId: risposta.corpo.account.id };
}

async function creaScuola(sessione, slug, amministratore) {
  const r = await sessione.post('/platform/tenants', { slug, nome: `Istituto ${slug}`, amministratore });
  if (r.corpo && r.corpo.amministratore && r.corpo.amministratore.passwordTemporanea) PASSWORD_VISTE.push(r.corpo.amministratore.passwordTemporanea);
  return r;
}

async function conteggi() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM tenants)::int AS tenants, (SELECT count(*) FROM people)::int AS people,
            (SELECT count(*) FROM accounts)::int AS accounts, (SELECT count(*) FROM memberships)::int AS memberships,
            (SELECT count(*) FROM role_assignments)::int AS ruoli, (SELECT count(*) FROM audit_log)::int AS audit`
  );
  return rows[0];
}

test('Nuova scuola + amministratore: 201, persona senza tenant, account con obbligo di cambio, membership, TENANT_ADMIN, audit in ordine', async () => {
  const { sessione, adminId } = await sessionePiattaforma();
  const r = await creaScuola(sessione, 'delta', { nome: ' Daria ', cognome: 'Delta', email: '  Daria.Delta@Delta.TEST ' });
  assert.equal(r.status, 201);
  // Compatibile con il formato precedente: i campi del tenant restano al primo livello.
  assert.deepEqual([r.corpo.slug, r.corpo.nome, r.corpo.stato], ['delta', 'Istituto delta', 'attivo']);
  const { account, accountEsistente, passwordTemporanea, passwordTemporaneaScadeIl } = r.corpo.amministratore;
  assert.deepEqual([account.email, account.nome, account.cognome, accountEsistente], ['daria.delta@delta.test', 'Daria', 'Delta', false]);
  assert.match(passwordTemporanea, new RegExp(`^[${ALFABETO_TEMPORANEA}]{16}$`));
  const giorni = (new Date(passwordTemporaneaScadeIl) - Date.now()) / 86400000;
  assert.ok(giorni > 6.99 && giorni <= 7, `scadenza a 7 giorni (${giorni})`);

  const { rows: [riga] } = await pool.query(
    `SELECT a.email, a.stato, a.deve_cambiare_password, a.password_changed_at, a.password_hash, p.tenant_id AS persona_tenant, p.nome, p.cognome
     FROM accounts a JOIN people p ON p.id = a.person_id WHERE a.id = $1`, [account.id]
  );
  assert.deepEqual(
    [riga.email, riga.stato, riga.deve_cambiare_password, riga.password_changed_at, riga.persona_tenant, riga.nome, riga.cognome],
    ['daria.delta@delta.test', 'attivo', true, null, null, 'Daria', 'Delta']
  );
  assert.match(riga.password_hash, /^\$argon2id\$/);
  assert.ok(!riga.password_hash.includes(passwordTemporanea));

  const { rows: membership } = await pool.query('SELECT stato FROM memberships WHERE account_id = $1 AND tenant_id = $2', [account.id, r.corpo.id]);
  assert.deepEqual(membership.map((m) => m.stato), ['attiva']);
  const { rows: ruoli } = await pool.query(
    `SELECT ro.codice, r.scope_type, r.tenant_id, r.scope_tenant_id, r.created_by_account_id
     FROM role_assignments r JOIN roles ro ON ro.id = r.role_id WHERE r.account_id = $1`, [account.id]
  );
  assert.deepEqual(ruoli, [{ codice: 'TENANT_ADMIN', scope_type: 'TENANT', tenant_id: r.corpo.id, scope_tenant_id: r.corpo.id, created_by_account_id: adminId }]);

  const { rows: audit } = await pool.query('SELECT azione, risorsa, actor_account_id, dopo FROM audit_log WHERE tenant_id = $1 ORDER BY id', [r.corpo.id]);
  assert.deepEqual(audit.map((a) => a.azione), ['tenant.create', 'account.create', 'membership.create', 'role_assignment.create']);
  assert.ok(audit.every((a) => a.actor_account_id === adminId));
  assert.deepEqual(Object.keys(audit[1].dopo).sort(), ['cognome', 'deveCambiarePassword', 'email', 'id', 'nome', 'passwordTemporaneaScadeIl', 'personId', 'stato']);

  // La password compare una sola volta: l'elenco delle scuole non la ripete.
  const elenco = await sessione.get('/platform/tenants');
  assert.ok(!JSON.stringify(elenco.corpo).includes(passwordTemporanea));
  const delta = elenco.corpo.find((t) => t.slug === 'delta');
  assert.deepEqual(delta.amministratori, [{ account_id: account.id, email: 'daria.delta@delta.test', stato: 'attivo', nome: 'Daria', cognome: 'Delta' }]);
  assert.ok(elenco.corpo.find((t) => t.slug === 'alfa').amministratori.some((a) => a.email === 'tenant.admin.a@alfa.test'));
});

test('Rollback: slug già usato -> 409 e non resta nulla (né tenant, né persona, né account)', async () => {
  const { sessione } = await sessionePiattaforma();
  const prima = await conteggi();
  const r = await creaScuola(sessione, 'alfa', { nome: 'Rino', cognome: 'Rollback', email: 'rino.rollback@example.test' });
  assert.deepEqual(erroreDi(r), [409, { codice: 'ERR_TENANT_SLUG_TAKEN', parametri: { slug: 'alfa' } }]);
  assert.deepEqual(await conteggi(), prima);
  const { rows } = await pool.query("SELECT 1 FROM accounts WHERE email = 'rino.rollback@example.test'");
  assert.equal(rows.length, 0);
});

test('Rollback: un guasto all\'ultimo passo (ruolo) annulla tenant, persona, account, membership e audit', async () => {
  const { sessione } = await sessionePiattaforma();
  // Guasto simulato: un trigger di prova (solo in questo database) rifiuta il ruolo del tenant «guasto».
  const amministrazione = await pool.connect();
  await amministrazione.query('RESET ROLE');
  await amministrazione.query(`CREATE FUNCTION fn_test_guasto() RETURNS trigger AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM tenants WHERE id = NEW.tenant_id AND slug = 'guasto') THEN RAISE EXCEPTION 'guasto di prova'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await amministrazione.query('CREATE TRIGGER trg_test_guasto BEFORE INSERT ON role_assignments FOR EACH ROW EXECUTE FUNCTION fn_test_guasto()');
  await amministrazione.query('SET ROLE app_role');
  amministrazione.release();
  const prima = await conteggi();
  const errori = [];
  const originale = console.error;
  console.error = (...a) => errori.push(a.join(' '));
  let r;
  try {
    r = await creaScuola(sessione, 'guasto', { nome: 'Gino', cognome: 'Guasto', email: 'gino.guasto@example.test' });
  } finally {
    console.error = originale;
    const pulizia = await pool.connect();
    await pulizia.query('RESET ROLE');
    await pulizia.query('DROP TRIGGER trg_test_guasto ON role_assignments');
    await pulizia.query('DROP FUNCTION fn_test_guasto()');
    await pulizia.query('SET ROLE app_role');
    pulizia.release();
  }
  assert.deepEqual(erroreDi(r), [500, { codice: 'ERR_INTERNAL', parametri: {} }]);
  assert.equal(errori.length, 1);
  assert.ok(errori[0].includes('guasto di prova'));
  assert.deepEqual(await conteggi(), prima, 'nessuna riga rimasta in nessuna tabella');
  const { rows } = await pool.query("SELECT 1 FROM tenants WHERE slug = 'guasto' UNION ALL SELECT 1 FROM people WHERE cognome = 'Guasto'");
  assert.equal(rows.length, 0);
});

test('Email già esistente (anche con altre maiuscole): solo membership e ruolo, password intatta e mai mostrata', async () => {
  const { sessione } = await sessionePiattaforma();
  const { rows: [primaRiga] } = await pool.query(
    "SELECT a.id, a.password_hash, a.person_id, p.nome, p.cognome FROM accounts a JOIN people p ON p.id = a.person_id WHERE email = 'teacher.math.b@beta.test'"
  );
  const r = await creaScuola(sessione, 'epsilon', { nome: 'Altro', cognome: 'Nome', email: 'Teacher.Math.B@BETA.test' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.corpo.amministratore, {
    account: { id: primaRiga.id, email: 'teacher.math.b@beta.test', nome: primaRiga.nome, cognome: primaRiga.cognome },
    accountEsistente: true,
  });
  assert.ok(!('passwordTemporanea' in r.corpo.amministratore));
  const { rows: [dopoRiga] } = await pool.query('SELECT password_hash, person_id, deve_cambiare_password FROM accounts WHERE id = $1', [primaRiga.id]);
  assert.deepEqual(dopoRiga, { password_hash: primaRiga.password_hash, person_id: primaRiga.person_id, deve_cambiare_password: false });
  const { rows: audit } = await pool.query('SELECT azione FROM audit_log WHERE tenant_id = $1 ORDER BY id', [r.corpo.id]);
  assert.deepEqual(audit.map((a) => a.azione), ['tenant.create', 'membership.create', 'role_assignment.create']);
  // Stesse credenziali di prima; ora può scegliere anche la nuova scuola, da amministratore.
  const s = await login(srv.base, 'teacher.math.b@beta.test');
  assert.deepEqual([s.risposta.status, s.risposta.corpo.deveCambiarePassword], [200, false]);
  assert.deepEqual(s.risposta.corpo.memberships.map((m) => m.slug).sort(), ['beta', 'epsilon']);
  const sw = await s.sessione.post('/auth/switch-tenant', { tenantId: r.corpo.id });
  assert.ok(sw.corpo.permessiNelTenantAttivo.includes('tenant.manage_users'));
});

test('Email con maiuscole: salvata minuscola; un secondo account con la stessa email in altre maiuscole -> 409', async () => {
  const { sessione } = await sessionePiattaforma();
  const r = await creaScuola(sessione, 'zeta', { nome: 'Zoe', cognome: 'Zeta', email: 'ZOE.Zeta@Zeta.Test' });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.amministratore.account.email, 'zoe.zeta@zeta.test');
  const { rows } = await pool.query("SELECT email FROM accounts WHERE lower(email) = 'zoe.zeta@zeta.test'");
  assert.deepEqual(rows, [{ email: 'zoe.zeta@zeta.test' }]);
  // Un secondo account con la stessa email in altre maiuscole è rifiutato dal database (indice della 005)...
  const { rows: persona } = await pool.query("INSERT INTO people (nome, cognome) VALUES ('Zoe', 'Doppia') RETURNING id");
  const errore = await pool.query('INSERT INTO accounts (email, person_id) VALUES ($1, $2)', ['Zoe.ZETA@zeta.test', persona[0].id]).catch((e) => e);
  assert.equal(errore.code, '23505');
  // ...e il backend traduce quel rifiuto in 409.
  let risposta;
  gestoreErrori(errore, { method: 'POST', originalUrl: '/api/platform/tenants' }, {
    status(stato) { risposta = { stato }; return this; }, json(corpo) { risposta.corpo = corpo; return this; },
  }, () => {});
  assert.deepEqual(risposta, { stato: 409, corpo: { errore: { codice: 'ERR_CONFLICT', parametri: {} } } });
});

test('Account disabilitato con quella email -> 409 ERR_ACCOUNT_DISABLED, nessuna scuola creata', async () => {
  const { sessione } = await sessionePiattaforma();
  await pool.query("UPDATE accounts SET stato = 'disabilitato' WHERE email = 'teacher.italian.a@alfa.test'");
  try {
    const prima = await conteggi();
    const r = await creaScuola(sessione, 'eta', { nome: 'Ida', cognome: 'Italiano', email: 'TEACHER.italian.a@alfa.test' });
    assert.deepEqual(erroreDi(r), [409, { codice: 'ERR_ACCOUNT_DISABLED', parametri: {} }]);
    assert.deepEqual(await conteggi(), prima);
  } finally {
    await pool.query("UPDATE accounts SET stato = 'attivo' WHERE email = 'teacher.italian.a@alfa.test'");
  }
});

test('Dati dell\'amministratore non validi -> 400 con il campo; nessuna scuola creata', async () => {
  const { sessione } = await sessionePiattaforma();
  const prima = await conteggi();
  const casi = [
    [{ nome: 'A', cognome: 'B', email: 'non-una-email' }, { codice: 'ERR_EMAIL_INVALID', parametri: {} }],
    [{ nome: 'A', cognome: 'B', email: 'due@@x.it' }, { codice: 'ERR_EMAIL_INVALID', parametri: {} }],
    [{ nome: 'A', cognome: 'B' }, { codice: 'ERR_EMAIL_INVALID', parametri: {} }],
    [{ nome: '  ', cognome: 'B', email: 'a@b.it' }, { codice: 'ERR_REQUIRED_FIELD', parametri: { campo: 'UI_FIELD_ADMIN_NAME' } }],
    [{ nome: 'A', email: 'a@b.it' }, { codice: 'ERR_REQUIRED_FIELD', parametri: { campo: 'UI_FIELD_ADMIN_SURNAME' } }],
    [{ nome: 'A', cognome: 'x'.repeat(101), email: 'a@b.it' }, { codice: 'ERR_FIELD_TOO_LONG', parametri: { campo: 'UI_FIELD_ADMIN_SURNAME', massimo: 100 } }],
    ['testo', { codice: 'ERR_INVALID_INPUT', parametri: {} }],
  ];
  for (const [amministratore, atteso] of casi) {
    assert.deepEqual(erroreDi(await creaScuola(sessione, 'theta', amministratore)), [400, atteso], JSON.stringify(amministratore));
  }
  // Stesso ordine del modulo: prima i campi della scuola, poi quelli dell'amministratore.
  assert.deepEqual(erroreDi(await creaScuola(sessione, 'Non Valido', { nome: '' })), [400, { codice: 'ERR_TENANT_SLUG_INVALID', parametri: {} }]);
  assert.deepEqual(erroreDi(await sessione.post('/platform/tenants', { slug: 'x'.repeat(61), nome: 'Lungo' })),
    [400, { codice: 'ERR_FIELD_TOO_LONG', parametri: { campo: 'UI_FIELD_SLUG', massimo: 60 } }]);
  assert.deepEqual(await conteggi(), prima);
});

test('Solo PLATFORM_ADMIN: TENANT_ADMIN e docente -> 403 su creazione e reimpostazione', async () => {
  const { rows: [alfa] } = await pool.query("SELECT id FROM tenants WHERE slug = 'alfa'");
  const { rows: [adminAlfa] } = await pool.query("SELECT id FROM accounts WHERE email = 'tenant.admin.a@alfa.test'");
  const prima = await conteggi();
  for (const email of ['tenant.admin.a@alfa.test', 'teacher.math.a@alfa.test']) {
    const { sessione, risposta } = await login(srv.base, email);
    await sessione.post('/auth/switch-tenant', { tenantId: risposta.corpo.tenantsDisponibiliPerSwitch[0].tenant_id });
    const atteso = [403, { codice: 'ERR_PERMISSION_MISSING', parametri: { permesso: 'PERMISSION_PLATFORM_MANAGE_TENANTS' } }];
    assert.deepEqual(erroreDi(await creaScuola(sessione, 'iota', { nome: 'I', cognome: 'O', email: 'iota@example.test' })), atteso, email);
    assert.deepEqual(erroreDi(await sessione.post(`/platform/tenants/${alfa.id}/admins/${adminAlfa.id}/reset-password`)), atteso, email);
  }
  assert.deepEqual(await conteggi(), prima);
});

test('Il nuovo TENANT_ADMIN entra, cambia la password e vede solo la propria scuola (altre: 404 sulle risorse, 403 sul cambio)', async () => {
  const { sessione: piattaforma } = await sessionePiattaforma();
  const creata = await creaScuola(piattaforma, 'kappa', { nome: 'Katia', cognome: 'Kappa', email: 'katia.kappa@kappa.test' });
  const { passwordTemporanea } = creata.corpo.amministratore;

  const { sessione, risposta } = await login(srv.base, 'katia.kappa@kappa.test', passwordTemporanea);
  assert.deepEqual([risposta.status, risposta.corpo.deveCambiarePassword], [200, true]);
  assert.deepEqual(erroreDi(await sessione.post('/auth/switch-tenant', { tenantId: creata.corpo.id })), CAMBIO_RICHIESTO);
  const cambio = await sessione.post('/auth/password', { passwordAttuale: passwordTemporanea, passwordNuova: NUOVA_PASSWORD });
  assert.equal(cambio.status, 200);
  assert.deepEqual(cambio.corpo.tenantsDisponibiliPerSwitch.map((t) => t.slug), ['kappa']);

  const sw = await sessione.post('/auth/switch-tenant', { tenantId: creata.corpo.id });
  assert.equal(sw.status, 200);
  assert.deepEqual(sw.corpo.ruoliNelTenantAttivo.map((r) => r.ruolo), ['TENANT_ADMIN']);
  ['tenant.manage_users', 'tenant.manage_roles', 'tenant.manage_config'].forEach((p) => assert.ok(sw.corpo.permessiNelTenantAttivo.includes(p), p));
  assert.equal((await sessione.get('/admin/traduzioni/completezza')).status, 200);
  assert.deepEqual((await sessione.get('/teachings')).corpo, []);

  // Risorse di Alfa dal contesto della nuova scuola: 404, come se non esistessero.
  const { rows: [classeAlfa] } = await pool.query("SELECT c.id FROM classes c JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = 'alfa' AND c.nome = '2A'");
  const { rows: [teachingAlfa] } = await pool.query("SELECT te.id FROM teachings te JOIN tenants t ON t.id = te.tenant_id WHERE t.slug = 'alfa' LIMIT 1");
  const { rows: [livelloAlfa] } = await pool.query("SELECT l.id FROM school_levels l JOIN tenants t ON t.id = l.tenant_id WHERE t.slug = 'alfa' LIMIT 1");
  for (const percorso of [`/classes/${classeAlfa.id}/students`, `/classes/${classeAlfa.id}/teachings`,
    `/teachings/${teachingAlfa.id}/pedagogical-units`, `/school-levels/${livelloAlfa.id}/classes`]) {
    const r = await sessione.get(percorso);
    assert.deepEqual([r.status, r.corpo.errore.codice], [404, 'ERR_NOT_FOUND'], percorso);
  }
  // Un'altra scuola non si può nemmeno attivare; l'amministrazione della piattaforma resta vietata.
  const { rows: [alfa] } = await pool.query("SELECT id FROM tenants WHERE slug = 'alfa'");
  assert.deepEqual(erroreDi(await sessione.post('/auth/switch-tenant', { tenantId: alfa.id })),
    [403, { codice: 'ERR_TENANT_MEMBERSHIP_INVALID', parametri: {} }]);
  assert.equal((await sessione.get('/platform/tenants')).status, 403);
});

test('Reimpostazione: nuova temporanea, sessioni revocate, obbligo di cambio di nuovo attivo, audit senza valori', async () => {
  const { sessione: piattaforma } = await sessionePiattaforma();
  const creata = await creaScuola(piattaforma, 'lambda', { nome: 'Lia', cognome: 'Lambda', email: 'lia.lambda@lambda.test' });
  const { account, passwordTemporanea: prima } = creata.corpo.amministratore;
  const { sessione } = await login(srv.base, account.email, prima);
  await sessione.post('/auth/password', { passwordAttuale: prima, passwordNuova: NUOVA_PASSWORD });
  const { sessione: seconda } = await login(srv.base, account.email, NUOVA_PASSWORD);

  const r = await piattaforma.post(`/platform/tenants/${creata.corpo.id}/admins/${account.id}/reset-password`);
  assert.equal(r.status, 200);
  const nuova = r.corpo.passwordTemporanea;
  PASSWORD_VISTE.push(nuova);
  assert.deepEqual(r.corpo.account, account);
  assert.match(nuova, new RegExp(`^[${ALFABETO_TEMPORANEA}]{16}$`));
  assert.notEqual(nuova, prima);

  // Tutte le sessioni dell'account sono revocate.
  assert.equal((await sessione.get('/auth/me')).status, 401);
  assert.equal((await seconda.get('/auth/me')).status, 401);
  const { rows: aperte } = await pool.query('SELECT 1 FROM sessions WHERE account_id = $1 AND revoked_at IS NULL', [account.id]);
  assert.equal(aperte.length, 0);

  // Vale solo la nuova temporanea, con l'obbligo di cambio.
  assert.equal((await login(srv.base, account.email, NUOVA_PASSWORD)).risposta.status, 401);
  const conNuova = await login(srv.base, account.email, nuova);
  assert.deepEqual([conNuova.risposta.status, conNuova.risposta.corpo.deveCambiarePassword], [200, true]);
  assert.deepEqual(erroreDi(await conNuova.sessione.get('/teachings')), CAMBIO_RICHIESTO);
  const { rows: [riga] } = await pool.query('SELECT deve_cambiare_password, password_temporanea_scade_il FROM accounts WHERE id = $1', [account.id]);
  assert.equal(riga.deve_cambiare_password, true);
  assert.ok(new Date(riga.password_temporanea_scade_il) > new Date(Date.now() + 6.99 * 86400000));

  const { rows: audit } = await pool.query("SELECT * FROM audit_log WHERE azione = 'account.password_reset' AND risorsa_id = $1", [account.id]);
  assert.equal(audit.length, 1);
  assert.deepEqual([audit[0].tenant_id, audit[0].risorsa, audit[0].prima, audit[0].dopo], [creata.corpo.id, 'account', null, null]);
});

test('Reimpostazione: scuola inesistente, account che non ne è amministratore, identificativi non validi -> 404/400', async () => {
  const { sessione } = await sessionePiattaforma();
  const { rows: [alfa] } = await pool.query("SELECT id FROM tenants WHERE slug = 'alfa'");
  const { rows: [beta] } = await pool.query("SELECT id FROM tenants WHERE slug = 'beta'");
  const id = async (email) => (await pool.query('SELECT id FROM accounts WHERE email = $1', [email])).rows[0].id;
  const reimposta = (t, a) => sessione.post(`/platform/tenants/${t}/admins/${a}/reset-password`).then(erroreDi);
  const account404 = [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_ACCOUNT' } }];
  assert.deepEqual(await reimposta(alfa.id, await id('teacher.math.a@alfa.test')), account404, 'docente, non amministratore');
  assert.deepEqual(await reimposta(beta.id, await id('tenant.admin.a@alfa.test')), account404, 'amministratore di un\'altra scuola');
  assert.deepEqual(await reimposta(alfa.id, 999999), account404);
  assert.deepEqual(await reimposta(999999, await id('tenant.admin.a@alfa.test')), [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_TENANT' } }]);
  assert.deepEqual(await reimposta('abc', 1), [400, { codice: 'ERR_INVALID_IDENTIFIER', parametri: { campo: 'UI_FIELD_TENANT_ID' } }]);
  assert.deepEqual(await reimposta(alfa.id, 0), [400, { codice: 'ERR_INVALID_IDENTIFIER', parametri: { campo: 'UI_FIELD_ACCOUNT_ID' } }]);
  const { rows } = await pool.query("SELECT 1 FROM audit_log WHERE azione = 'account.password_reset' AND tenant_id IN ($1, $2)", [alfa.id, beta.id]);
  assert.equal(rows.length, 0);
});

// ===========================================================================
// ULTIMO: NESSUNA PASSWORD NÉ HASH NELL'AUDIT
// ===========================================================================

test('Audit: nessuna riga contiene una password (temporanea o scelta) o un hash, in nessun campo prima/dopo', async () => {
  const { rows: audit } = await pool.query('SELECT id, azione, prima::text AS prima, dopo::text AS dopo FROM audit_log');
  const { rows: hash } = await pool.query('SELECT password_hash FROM accounts WHERE password_hash IS NOT NULL');
  assert.ok(audit.length > 0 && hash.length > 0);
  assert.ok(PASSWORD_VISTE.length >= 12, `password raccolte dai test: ${PASSWORD_VISTE.length}`);
  const azioni = new Set(audit.map((a) => a.azione));
  ['tenant.create', 'account.create', 'membership.create', 'role_assignment.create', 'account.password_change', 'account.password_reset']
    .forEach((a) => assert.ok(azioni.has(a), `audit di ${a} presente`));
  for (const riga of audit) {
    for (const campo of [riga.prima, riga.dopo]) {
      if (campo === null) continue;
      assert.ok(!/argon2|password_hash|passwordHash|"password"|passwordTemporanea"/i.test(campo), `audit ${riga.id} (${riga.azione}): ${campo}`);
      PASSWORD_VISTE.forEach((p) => assert.ok(!campo.includes(p), `audit ${riga.id} (${riga.azione}) contiene una password`));
      hash.forEach((h) => assert.ok(!campo.includes(h.password_hash), `audit ${riga.id} (${riga.azione}) contiene un hash`));
    }
  }
});
