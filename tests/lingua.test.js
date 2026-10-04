'use strict';

/**
 * Visual Grammar V2 — lingua (C2, P3), catalogo di sistema, errori come codici,
 * contenuto pedagogico multilingue (B-1…B-7). Database di prova: migrazioni
 * 000 -> 003 + seed (tests/support/pglite.js).
 *
 * Lingua RTL DI PROVA: 'ar-XB' (pseudo-lingua bidi, solo nei test, con un catalogo
 * minimo fornito come sovrascrittura del tenant): non è una lingua di prodotto.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

require('./support/pglite').installa();
const { pool } = require('../server/db');
const { avviaServer, SessioneHttp, login, loginESwitch } = require('./support/http');
const { hashToken } = require('../server/lib/sessioni');

let srv;
test.before(async () => { srv = await avviaServer(); });
test.after(async () => { await srv.chiudi(); await pool.end(); });

const idTenant = async (slug) => (await pool.query('SELECT id FROM tenants WHERE slug = $1', [slug])).rows[0].id;

/** Abilita la lingua RTL di prova in un tenant, con un catalogo minimo come sovrascrittura. */
async function abilitaRtlDiProva(slug) {
  await pool.query("INSERT INTO languages (codice, direzione) VALUES ('ar-XB', 'rtl') ON CONFLICT DO NOTHING");
  const tenantId = await idTenant(slug);
  await pool.query("INSERT INTO tenant_languages (tenant_id, lingua) VALUES ($1, 'ar-XB') ON CONFLICT DO NOTHING", [tenantId]);
  await pool.query(
    `INSERT INTO catalog_overrides (tenant_id, lingua, chiave, valore) VALUES ($1, 'ar-XB', 'ERR_CREDENTIALS_INVALID', '"‮ERR-TEST‬"')
     ON CONFLICT DO NOTHING`,
    [tenantId]
  );
  return tenantId;
}

test('P3: senza sessione il catalogo è nella lingua di piattaforma, senza dati di tenant', async () => {
  const r = await new SessioneHttp(srv.base).get('/i18n');
  assert.equal(r.status, 200);
  assert.deepEqual([r.corpo.lingua, r.corpo.direzione, r.corpo.locale], ['it', 'ltr', 'it-IT']);
  assert.equal(typeof r.corpo.testi.ERR_CREDENTIALS_INVALID, 'string');
  assert.deepEqual(r.corpo.mancanti, []);
});

test('Errori: sempre { codice, parametri } nominati, mai una frase; parametri semantici come identificatori', async () => {
  const anonimo = await new SessioneHttp(srv.base).get('/teachings');
  assert.deepEqual([anonimo.status, anonimo.corpo.errore], [401, { codice: 'ERR_SESSION_REQUIRED', parametri: {} }]);

  const docente = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
  const assente = await docente.get('/teachings/999999/activities');
  assert.deepEqual([assente.status, assente.corpo.errore], [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_TEACHING' } }]);

  const italiano = (await pool.query(
    "SELECT t.id FROM teachings t JOIN accounts a ON a.id = t.account_id WHERE a.email = 'teacher.italian.a@alfa.test'"
  )).rows[0].id;
  const vietato = await docente.get(`/teachings/${italiano}/activities`);
  assert.deepEqual([vietato.status, vietato.corpo.errore], [403, { codice: 'ERR_PERMISSION_MISSING', parametri: { permesso: 'PERMISSION_ACTIVITY_READ' } }]);

  const senzaCsrf = new SessioneHttp(srv.base);
  senzaCsrf.token = docente.token;
  const r = await senzaCsrf.post('/auth/switch-tenant', { tenantId: 1 });
  assert.deepEqual(r.corpo.errore, { codice: 'ERR_CSRF_INVALID', parametri: {} });
});

test('Errori: ogni codice ERR_* emesso dal server e ogni identificatore usato come parametro ha un testo nel catalogo di prova', () => {
  const catalogo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'i18n', 'catalogo', 'it.json'), 'utf8')).testi;
  const sorgenti = [];
  const visita = (cartella) => fs.readdirSync(cartella, { withFileTypes: true }).forEach((voce) => {
    const p = path.join(cartella, voce.name);
    if (voce.isDirectory()) visita(p);
    else if (p.endsWith('.js')) sorgenti.push(fs.readFileSync(p, 'utf8'));
  });
  visita(path.join(__dirname, '..', 'server'));
  const usati = new Set(sorgenti.join('\n').match(/'(ERR|UI|PERMISSION|ROLE)_[A-Z0-9_]+'/g).map((c) => c.slice(1, -1)));
  const mancanti = [...usati].filter((c) => !(c in catalogo));
  assert.deepEqual(mancanti, []);
  // I permessi di sistema hanno tutti il loro identificatore PERMISSION_*.
  const migrazione = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_ruoli_permessi_sistema.sql'), 'utf8');
  const permessi = [...migrazione.matchAll(/\('([a-z_]+\.[a-z_]+)',/g)].map((m) => `PERMISSION_${m[1].toUpperCase().replace(/[^A-Z0-9]/g, '_')}`);
  assert.equal(permessi.length, 17);
  assert.deepEqual(permessi.filter((c) => !(c in catalogo)), []);
});

test('C2: login -> lingua di piattaforma; cambio tenant -> predefinita del tenant; preferenza abilitata -> lingua della sessione', async () => {
  await abilitaRtlDiProva('alfa');
  const { sessione, risposta } = await login(srv.base, 'teacher.math.a@alfa.test');
  assert.deepEqual([risposta.corpo.lingua.codice, risposta.corpo.lingua.lingueAbilitate], ['it', []], 'prima del tenant: P3');

  const alfa = await idTenant('alfa');
  const dopoSwitch = await sessione.post('/auth/switch-tenant', { tenantId: alfa });
  assert.equal(dopoSwitch.corpo.lingua.codice, 'it', 'predefinita del tenant');
  assert.deepEqual(dopoSwitch.corpo.lingua.lingueAbilitate.map((l) => l.codice), ['ar-XB', 'it']);

  const pref = await sessione.put('/me/lingua', { lingua: 'ar-XB' });
  assert.deepEqual([pref.status, pref.corpo.lingua, pref.corpo.direzione], [200, 'ar-XB', 'rtl']);
  const me = (await sessione.get('/auth/me')).corpo;
  assert.deepEqual([me.lingua.codice, me.lingua.direzione, me.lingua.linguaPreferita, me.lingua.locale], ['ar-XB', 'rtl', 'ar-XB', 'ar-IT']);

  // Catalogo: sovrascrittura del tenant, poi default di prodotto in QUELLA lingua (assente), poi segnalazione.
  const cat = (await sessione.get('/i18n')).corpo;
  assert.equal(cat.lingua, 'ar-XB');
  assert.equal(cat.testi.ERR_CREDENTIALS_INVALID, '‮ERR-TEST‬');
  assert.equal(cat.testi.ERR_INTERNAL, undefined, 'mai un fallback alla lingua di piattaforma o a una lingua fissa');
  assert.ok(cat.mancanti.includes('ERR_INTERNAL'), 'il testo mancante è segnalato');

  // La lingua non è mai un parametro libero del client: header e query non hanno effetto.
  const tentativo = (await sessione.get('/i18n?lingua=it', { 'Accept-Language': 'it-IT' })).corpo;
  assert.equal(tentativo.lingua, 'ar-XB');

  // Preferenza per una lingua non abilitata: rifiutata.
  const rifiuto = await sessione.put('/me/lingua', { lingua: 'xx' });
  assert.deepEqual([rifiuto.status, rifiuto.corpo.errore.codice], [400, 'ERR_LANGUAGE_NOT_ENABLED']);

  // Disabilitazione della lingua: alla richiesta successiva la sessione torna alla predefinita.
  await pool.query("DELETE FROM tenant_languages WHERE tenant_id = $1 AND lingua = 'ar-XB'", [alfa]);
  try {
    await sessione.get('/teachings');
    const { rows } = await pool.query('SELECT lingua FROM sessions WHERE token_hash = $1', [hashToken(sessione.token)]);
    assert.equal(rows[0].lingua, 'it');
    const dopo = (await sessione.get('/auth/me')).corpo.lingua;
    assert.deepEqual([dopo.codice, dopo.linguaPreferita], ['it', 'ar-XB'], 'la preferenza resta ma non si applica');
  } finally {
    await pool.query("INSERT INTO tenant_languages (tenant_id, lingua) VALUES ($1, 'ar-XB') ON CONFLICT DO NOTHING", [alfa]);
    await pool.query("UPDATE memberships SET lingua_preferita = NULL WHERE tenant_id = $1", [alfa]);
  }
});

test('C2: le sovrascritture del catalogo sono isolate per tenant', async () => {
  await abilitaRtlDiProva('beta');
  const beta = await idTenant('beta');
  await pool.query(
    "INSERT INTO catalog_overrides (tenant_id, lingua, chiave, valore) VALUES ($1, 'it', 'ERR_INTERNAL', '\"Solo Beta\"') ON CONFLICT DO NOTHING",
    [beta]
  );
  const alfa = (await (await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa')).get('/i18n')).corpo;
  const betaCat = (await (await loginESwitch(srv.base, 'teacher.math.b@beta.test', 'beta')).get('/i18n')).corpo;
  assert.equal(betaCat.testi.ERR_INTERNAL, 'Solo Beta');
  assert.notEqual(alfa.testi.ERR_INTERNAL, 'Solo Beta');
  const anonimo = (await new SessioneHttp(srv.base).get('/i18n')).corpo;
  assert.notEqual(anonimo.testi.ERR_INTERNAL, 'Solo Beta', 'senza sessione nessun dato di tenant');
});

test('C2: platform admin senza Membership -> lingua predefinita del tenant attivo; nuovo tenant con configurazione linguistica', async () => {
  const admin = await loginESwitch(srv.base, 'platform.admin@platform.test', 'alfa');
  assert.equal((await admin.get('/auth/me')).corpo.lingua.codice, 'it');
  const creato = await admin.post('/platform/tenants', { slug: 'gamma-lingua', nome: 'Istituto Gamma' });
  assert.equal(creato.status, 201);
  const { rows } = await pool.query(
    `SELECT t.lingua_predefinita, t.lingua_contenuti, t.regione, array_agg(tl.lingua) AS abilitate
     FROM tenants t JOIN tenant_languages tl ON tl.tenant_id = t.id WHERE t.slug = 'gamma-lingua'
     GROUP BY t.lingua_predefinita, t.lingua_contenuti, t.regione`
  );
  assert.deepEqual(rows[0], { lingua_predefinita: 'it', lingua_contenuti: 'it', regione: 'IT', abilitate: ['it'] });
});

test('B: il nome di un\'attività è contenuto d\'autore registrato nella lingua della sessione', async () => {
  const docente = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
  const teaching = (await docente.get('/teachings')).corpo.find((t) => t.classe === '2A').teaching_id;
  const unita = (await docente.get(`/teachings/${teaching}/pedagogical-units`)).corpo[0];
  const a = await docente.post(`/teachings/${teaching}/activities`, { nome: 'Lingua autore', dataAttivita: '2026-11-02', pedagogicalUnitId: unita.id });
  assert.equal(a.status, 201);
  const { rows } = await pool.query('SELECT lingua_contenuto FROM activities WHERE id = $1', [a.corpo.activity_id]);
  assert.equal(rows[0].lingua_contenuto, 'it');
});

test('B-5/B-6: traduzione di un contenuto con audit; completezza per lingua; permessi e isolamento', async () => {
  const alfa = await abilitaRtlDiProva('alfa');
  const numeri = (await pool.query(
    "SELECT p.id FROM pedagogical_units p WHERE p.tenant_id = $1 AND p.nome = 'Numeri'", [alfa]
  )).rows[0].id;
  const admin = await loginESwitch(srv.base, 'tenant.admin.a@alfa.test', 'alfa');

  const prima = (await admin.get('/admin/traduzioni/completezza')).corpo;
  assert.equal(prima.linguaOrigine, 'it');
  const campoPrima = prima.lingue.find((l) => l.lingua === 'ar-XB').campi.find((c) => c.campo === 'pedagogical_units.nome');

  const r = await admin.put('/admin/traduzioni', { campo: 'pedagogical_units.nome', riferimento: numeri, lingua: 'ar-XB', testo: 'نوى' });
  assert.equal(r.status, 200);
  const audit = await pool.query("SELECT azione, dopo FROM audit_log WHERE risorsa = 'content_translation' AND risorsa_id = $1", [r.corpo.id]);
  assert.equal(audit.rows[0].azione, 'content_translation.create');
  const r2 = await admin.put('/admin/traduzioni', { campo: 'pedagogical_units.nome', riferimento: numeri, lingua: 'ar-XB', testo: 'نوى 2' });
  assert.equal(r2.corpo.id, r.corpo.id);
  const aggiornamento = await pool.query(
    "SELECT prima FROM audit_log WHERE risorsa = 'content_translation' AND risorsa_id = $1 AND azione = 'content_translation.update'", [r.corpo.id]
  );
  assert.deepEqual(aggiornamento.rows[0].prima, { testo: 'نوى' });

  const dopo = (await admin.get('/admin/traduzioni/completezza')).corpo;
  const campoDopo = dopo.lingue.find((l) => l.lingua === 'ar-XB').campi.find((c) => c.campo === 'pedagogical_units.nome');
  assert.equal(campoDopo.tradotti, campoPrima.tradotti + 1);

  // La lingua di origine non si "traduce"; un docente non ha tenant.manage_config.
  assert.equal((await admin.put('/admin/traduzioni', { campo: 'pedagogical_units.nome', riferimento: numeri, lingua: 'it', testo: 'x' })).corpo.errore.codice, 'ERR_LANGUAGE_NOT_ENABLED');
  const docente = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
  assert.equal((await docente.get('/admin/traduzioni/completezza')).status, 403);
  // Un oggetto di un altro tenant: rifiutato dalle FK composte.
  const unitaBeta = (await pool.query("SELECT p.id FROM pedagogical_units p JOIN tenants t ON t.id = p.tenant_id WHERE t.slug = 'beta' LIMIT 1")).rows[0].id;
  const cross = await admin.put('/admin/traduzioni', { campo: 'pedagogical_units.nome', riferimento: unitaBeta, lingua: 'ar-XB', testo: 'x' });
  assert.deepEqual([cross.status, cross.corpo.errore.codice], [400, 'ERR_REFERENCES_INCONSISTENT']);
});

test('Migrazione 003: app_role opera sulle nuove tabelle, audit_log resta append-only', async () => {
  const { rows } = await pool.query('SELECT current_role AS ruolo, count(*)::int AS n FROM languages GROUP BY current_role');
  assert.equal(rows[0].ruolo, 'app_role');
  await assert.rejects(() => pool.query('DELETE FROM audit_log'), (e) => e.code === '42501');
  await assert.rejects(() => pool.query("UPDATE audit_log SET azione = 'x'"), (e) => e.code === '42501');
});
