'use strict';

/**
 * Test di integrazione della V1 multi-tenant, su un database di prova
 * costruito da migrations/000-002 + seed/seed_multitenant.sql (vedi
 * tests/support/pglite.js). Copre: sessione/autenticazione, CSRF, contesto
 * tenant/switch, RBAC con scope, audit, integrità del database (FK
 * composte cross-tenant/anno/classe/materia), Report classe.
 *
 * Password di sviluppo per tutti gli account del seed: "Sviluppo!2026".
 */
const test = require('node:test');
const assert = require('node:assert/strict');

require('./support/pglite').installa();
const express = require('express');
const { pool } = require('../server/db');
const routeApi = require('../server/routes/index');
const dominio = require('../server/queries/dominio');
const { creaRoleAssignment } = require('../server/queries/rbac');
const { creaSessione, trovaSessioneValida, revocaSessione, revocaTutteLeSessioni } = require('../server/lib/sessioni');

const PASSWORD_SVILUPPO = 'Sviluppo!2026';

// --- Server HTTP di prova, condiviso da tutti i test -----------------------

let server;
let base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', routeApi);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

// --- Client HTTP con cookie jar minimale e CSRF ----------------------------

function estraiCookie(risposta, nome) {
  const grezzo = typeof risposta.headers.getSetCookie === 'function'
    ? risposta.headers.getSetCookie()
    : [risposta.headers.get('set-cookie')].filter(Boolean);
  for (const riga of grezzo) {
    const m = riga.match(new RegExp(`${nome}=([^;]*)`));
    if (m) return m[1];
  }
  return null;
}

class SessioneHttp {
  constructor() { this.token = null; this.csrfToken = null; }

  intestazioni(extra) {
    const h = { 'Content-Type': 'application/json', ...extra };
    if (this.token) h.Cookie = `session_token=${this.token}`;
    if (this.csrfToken) h['X-CSRF-Token'] = this.csrfToken;
    return h;
  }

  aggiornaCookie(risposta) {
    const t = estraiCookie(risposta, 'session_token');
    if (t !== null) this.token = t === '' ? null : t;
  }

  async richiesta(metodo, percorso, corpo, opzioni = {}) {
    const risposta = await fetch(base + percorso, {
      method: metodo,
      headers: this.intestazioni(opzioni.senzaCsrf ? { 'X-CSRF-Token': undefined } : {}),
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    this.aggiornaCookie(risposta);
    const corpoRisposta = risposta.status === 204 ? null : await risposta.json().catch(() => null);
    if (corpoRisposta && corpoRisposta.csrfToken) this.csrfToken = corpoRisposta.csrfToken;
    return { status: risposta.status, corpo: corpoRisposta };
  }

  get(percorso) { return this.richiesta('GET', percorso); }
  post(percorso, corpo, opzioni) { return this.richiesta('POST', percorso, corpo, opzioni); }
  put(percorso, corpo, opzioni) { return this.richiesta('PUT', percorso, corpo, opzioni); }
}

async function login(email, password = PASSWORD_SVILUPPO) {
  const s = new SessioneHttp();
  const r = await s.post('/auth/login', { email, password });
  return { sessione: s, risposta: r };
}

async function loginESwitch(email, tenantSlug) {
  const { sessione, risposta } = await login(email);
  assert.equal(risposta.status, 200, `login di ${email} deve riuscire`);
  const tenant = risposta.corpo.tenantsDisponibiliPerSwitch.find((t) => t.slug === tenantSlug);
  assert.ok(tenant, `${email} deve poter selezionare il tenant ${tenantSlug}`);
  const r2 = await sessione.post('/auth/switch-tenant', { tenantId: tenant.tenant_id ?? tenant.id });
  assert.equal(r2.status, 200, `switch a ${tenantSlug} deve riuscire per ${email}`);
  return sessione;
}

// ===========================================================================
// SEZIONE A — SESSIONE / AUTENTICAZIONE (sez. 61)
// ===========================================================================

test('Login: credenziali corrette creano una sessione con cookie HttpOnly e csrfToken', async () => {
  const { risposta } = await login('teacher.math.a@alfa.test');
  assert.equal(risposta.status, 200);
  assert.equal(risposta.corpo.account.email, 'teacher.math.a@alfa.test');
  assert.ok(risposta.corpo.csrfToken, 'la risposta di login deve includere un csrfToken');
  assert.equal(risposta.corpo.activeTenantId, null, 'nessun tenant attivo subito dopo il login (sez. 8)');
});

test('Login: password errata e account inesistente danno lo stesso 401 generico', async () => {
  const r1 = await login('teacher.math.a@alfa.test', 'password-sbagliata');
  assert.equal(r1.risposta.status, 401);
  const r2 = await login('non.esiste@alfa.test', 'qualunque');
  assert.equal(r2.risposta.status, 401);
  assert.equal(r1.risposta.corpo.errore, r2.risposta.corpo.errore, 'messaggio identico: non rivelare quale dei due è sbagliato');
});

test('GET /me senza cookie -> 401; con cookie valido -> 200', async () => {
  const anonimo = new SessioneHttp();
  const r1 = await anonimo.get('/auth/me');
  assert.equal(r1.status, 401);

  const { sessione } = await login('teacher.italian.a@alfa.test');
  const r2 = await sessione.get('/auth/me');
  assert.equal(r2.status, 200);
  assert.equal(r2.corpo.account.email, 'teacher.italian.a@alfa.test');
});

test('Logout revoca la sessione: dopo logout, /me torna 401', async () => {
  const { sessione } = await login('teacher.italian.a@alfa.test');
  const rLogout = await sessione.post('/auth/logout');
  assert.equal(rLogout.status, 204);
  const rMe = await sessione.get('/auth/me');
  assert.equal(rMe.status, 401);
});

test('Sessione scaduta (timeout assoluto) e sessione revocata sono entrambe rifiutate', async () => {
  const { sessione, risposta } = await login('teacher.math.a@alfa.test');
  const rMePrima = await sessione.get('/auth/me');
  assert.equal(rMePrima.status, 200);

  // Manipolazione diretta del DB per simulare il timeout assoluto (sez. 61).
  const { rows } = await pool.query(
    'SELECT id FROM sessions WHERE account_id = $1 ORDER BY id DESC LIMIT 1',
    [(await pool.query('SELECT id FROM accounts WHERE email = $1', ['teacher.math.a@alfa.test'])).rows[0].id]
  );
  await pool.query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = $1", [rows[0].id]);
  const rMeScaduta = await sessione.get('/auth/me');
  assert.equal(rMeScaduta.status, 401);

  // Sessione revocata esplicitamente.
  const { sessione: sessione2 } = await login('teacher.math.a@alfa.test');
  const idSessione2 = (await pool.query('SELECT id FROM sessions ORDER BY id DESC LIMIT 1')).rows[0].id;
  await revocaSessione(pool, idSessione2, 'test');
  const rMeRevocata = await sessione2.get('/auth/me');
  assert.equal(rMeRevocata.status, 401);
});

test('Sessione scaduta per inattività (idle timeout) viene rifiutata e marcata revocata', async () => {
  const { rows: account } = await pool.query('SELECT id FROM accounts WHERE email = $1', ['tenant.admin.b@beta.test']);
  const { token, sessione } = await creaSessione(pool, { accountId: account[0].id });
  await pool.query("UPDATE sessions SET last_seen_at = now() - interval '31 minutes' WHERE id = $1", [sessione.id]);
  const esito = await trovaSessioneValida(pool, token);
  assert.equal(esito, null, 'una sessione inattiva da più del timeout deve risultare invalida');
  const { rows: dopo } = await pool.query('SELECT revoked_at, revoked_reason FROM sessions WHERE id = $1', [sessione.id]);
  assert.ok(dopo[0].revoked_at, 'la sessione scaduta per inattività deve essere revocata esplicitamente');
  assert.equal(dopo[0].revoked_reason, 'idle_timeout');
});

test('Invalidazione globale (cambio password): revocaTutteLeSessioni chiude tutte le sessioni dell\'account', async () => {
  const { rows: account } = await pool.query('SELECT id FROM accounts WHERE email = $1', ['coordinator.a@alfa.test']);
  const s1 = await creaSessione(pool, { accountId: account[0].id });
  const s2 = await creaSessione(pool, { accountId: account[0].id });
  assert.ok(await trovaSessioneValida(pool, s1.token));
  await revocaTutteLeSessioni(pool, account[0].id, 'cambio_password');
  assert.equal(await trovaSessioneValida(pool, s1.token), null);
  assert.equal(await trovaSessioneValida(pool, s2.token), null);
});

test('Account disabilitato non può autenticarsi', async () => {
  await pool.query("UPDATE accounts SET stato = 'disabilitato' WHERE email = 'teacher.italian.a@alfa.test'");
  const { risposta } = await login('teacher.italian.a@alfa.test');
  assert.equal(risposta.status, 401);
  await pool.query("UPDATE accounts SET stato = 'attivo' WHERE email = 'teacher.italian.a@alfa.test'");
});

// ===========================================================================
// SEZIONE B — CSRF (sez. 62)
// ===========================================================================

test('CSRF: mutazione senza token, con token errato, con token corretto', async () => {
  const { sessione, risposta } = await login('teacher.math.a@alfa.test');
  const tenantId = risposta.corpo.tenantsDisponibiliPerSwitch[0].tenant_id;

  const senzaToken = await fetch(base + '/auth/switch-tenant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `session_token=${sessione.token}` },
    body: JSON.stringify({ tenantId }),
  });
  assert.equal(senzaToken.status, 403);

  const tokenErrato = await fetch(base + '/auth/switch-tenant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `session_token=${sessione.token}`, 'X-CSRF-Token': 'x'.repeat(64) },
    body: JSON.stringify({ tenantId }),
  });
  assert.equal(tokenErrato.status, 403);

  const rCorretto = await sessione.post('/auth/switch-tenant', { tenantId });
  assert.equal(rCorretto.status, 200);
});

// ===========================================================================
// SEZIONE C — TENANT ATTIVO / SWITCH (sez. 63) E ACCOUNT MULTI-TENANT (sez. 55)
// ===========================================================================

test('Utente multi-tenant: login -> nessun tenant attivo -> switch A -> switch B -> switch a un tenant senza Membership = 403', async () => {
  const { sessione, risposta } = await login('multitenant.user@example.test');
  assert.equal(risposta.corpo.activeTenantId, null);
  assert.equal(risposta.corpo.memberships.length, 2, 'deve avere Membership in due tenant (Alfa e Beta)');

  const alfa = risposta.corpo.memberships.find((m) => m.slug === 'alfa');
  const beta = risposta.corpo.memberships.find((m) => m.slug === 'beta');

  const rA = await sessione.post('/auth/switch-tenant', { tenantId: alfa.tenant_id });
  assert.equal(rA.status, 200);
  assert.equal(rA.corpo.activeTenantId, alfa.tenant_id);

  const rB = await sessione.post('/auth/switch-tenant', { tenantId: beta.tenant_id });
  assert.equal(rB.status, 200);
  assert.equal(rB.corpo.activeTenantId, beta.tenant_id);

  const rInesistente = await sessione.post('/auth/switch-tenant', { tenantId: 999999 });
  assert.equal(rInesistente.status, 403);
});

test('Isolamento tenant: una risorsa di Alfa non è raggiungibile con il tenant attivo impostato su Beta', async () => {
  const sessioneA = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  const teachings = await sessioneA.get('/teachings');
  const teachingAlfa = teachings.corpo[0].teaching_id;
  const activities = await sessioneA.get(`/teachings/${teachingAlfa}/activities`);
  const activityAlfa = activities.corpo[0].activity_id;
  const grigliaOk = await sessioneA.get(`/activities/${activityAlfa}/griglia`);
  assert.equal(grigliaOk.status, 200);

  // Stesso account, ma multitenant.user con tenant attivo Beta non deve MAI vedere risorse di Alfa:
  // usiamo qui lo stesso teachingId/activityId con un account che ha Membership in entrambi i tenant.
  const sessioneMulti = await loginESwitch('multitenant.user@example.test', 'beta');
  const rTeachingAltroTenant = await sessioneMulti.get(`/teachings/${teachingAlfa}/pedagogical-units`);
  assert.equal(rTeachingAltroTenant.status, 404, 'un Teaching di Alfa non deve esistere nel contesto Beta');
  const rGrigliaAltroTenant = await sessioneMulti.get(`/activities/${activityAlfa}/griglia`);
  assert.equal(rGrigliaAltroTenant.status, 404, "un'Activity di Alfa non deve esistere nel contesto Beta");
});

// ===========================================================================
// SEZIONE D — PLATFORM ADMIN (sez. 64)
// ===========================================================================

test('Platform admin: nessuna Membership, ma può impostare come tenant attivo qualunque tenant e vederli tutti', async () => {
  const { sessione, risposta } = await login('platform.admin@platform.test');
  assert.equal(risposta.corpo.memberships.length, 0, 'PLATFORM_ADMIN non ha Membership (sez. 7)');
  assert.equal(risposta.corpo.isPlatformAdmin, true);

  const rTenants = await sessione.get('/platform/tenants');
  assert.equal(rTenants.status, 200);
  const slugs = rTenants.corpo.map((t) => t.slug);
  assert.ok(slugs.includes('alfa') && slugs.includes('beta'));

  const alfaId = rTenants.corpo.find((t) => t.slug === 'alfa').id;
  const rSwitch = await sessione.post('/auth/switch-tenant', { tenantId: alfaId });
  assert.equal(rSwitch.status, 200, 'PLATFORM_ADMIN può attivare un tenant senza avervi Membership (sez. 9)');
});

test('Un account non-platform-admin non può amministrare i tenant', async () => {
  const sessione = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  const r = await sessione.get('/platform/tenants');
  assert.equal(r.status, 403);
});

// ===========================================================================
// SEZIONE E — SCOPE DEL DOCENTE (sez. 65)
// ===========================================================================

test('Teacher: vede solo i propri Teaching, non quelli di altri docenti dello stesso tenant', async () => {
  const sessione = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  const r = await sessione.get('/teachings');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.length, 2, 'teacher.math.a insegna su due Teaching (Matematica 2A e 2B)');
  assert.ok(r.corpo.every((t) => t.materia === 'Matematica'));
});

test('Teacher: può leggere/scrivere sulle proprie Activity, non su quelle di un altro Teaching', async () => {
  const sessioneMath = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  const teachingsMath = await sessioneMath.get('/teachings');
  const teaching2A = teachingsMath.corpo.find((t) => t.classe === '2A').teaching_id;
  const attivitaMath = await sessioneMath.get(`/teachings/${teaching2A}/activities`);
  const activityId = attivitaMath.corpo[0].activity_id;

  const griglia = await sessioneMath.get(`/activities/${activityId}/griglia`);
  assert.equal(griglia.status, 200);
  const enrollmentId = griglia.corpo.righe[0].enrollmentId;
  const criterionId = griglia.corpo.criteri[0].id;
  const rScrittura = await sessioneMath.put(`/activities/${activityId}/enrollments/${enrollmentId}/criteria/${criterionId}`, { valore: 2 });
  assert.equal(rScrittura.status, 200);

  // teacher.italian.a NON ha alcun RoleAssignment su questo Teaching di Matematica: deve ricevere 403.
  const sessioneItalian = await loginESwitch('teacher.italian.a@alfa.test', 'alfa');
  const rNegato = await sessioneItalian.get(`/activities/${activityId}/griglia`);
  assert.equal(rNegato.status, 403);
  const rScritturaNegata = await sessioneItalian.put(`/activities/${activityId}/enrollments/${enrollmentId}/criteria/${criterionId}`, { valore: 1 });
  assert.equal(rScritturaNegata.status, 403);
});

test('Teacher: non può assegnare a se stesso un ruolo di autorità superiore (TENANT_ADMIN)', async () => {
  const sessione = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  const me = await sessione.get('/auth/me');
  const r = await sessione.post('/role-assignments', {
    accountId: me.corpo.account.id, roleCodice: 'TENANT_ADMIN', scopeType: 'TENANT', tenantId: me.corpo.activeTenantId,
  });
  assert.equal(r.status, 403);
});

test('Tenant admin: può assegnare TEACHER/COORDINATOR nel proprio tenant (audit incluso)', async () => {
  const sessioneAdmin = await loginESwitch('tenant.admin.a@alfa.test', 'alfa');
  const me = await sessioneAdmin.get('/auth/me');
  const teachingsMath = await (await loginESwitch('teacher.math.a@alfa.test', 'alfa')).get('/teachings');
  const teachingId = teachingsMath.corpo[0].teaching_id;
  const r = await sessioneAdmin.post('/role-assignments', {
    accountId: (await pool.query("SELECT id FROM accounts WHERE email='teacher.italian.a@alfa.test'")).rows[0].id,
    roleCodice: 'TEACHER', scopeType: 'TEACHING', tenantId: me.corpo.activeTenantId, scopeIds: { teachingId },
  });
  assert.equal(r.status, 201);
  const { rows: audit } = await pool.query(
    "SELECT * FROM audit_log WHERE azione = 'role_assignment.create' AND risorsa_id = $1", [r.corpo.id]
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].tenant_id, me.corpo.activeTenantId);
});

// ===========================================================================
// SEZIONE F — REPORT CLASSE (fotografia di una singola attività)
// ===========================================================================

test('Report classe (Alfa, scala 0-2): numeri coerenti con i dati seminati', async () => {
  const sessione = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  const teachings = await sessione.get('/teachings');
  const teaching2A = teachings.corpo.find((t) => t.classe === '2A').teaching_id;
  const attivita = await sessione.get(`/teachings/${teaching2A}/activities`);
  const activityId = attivita.corpo.find((a) => a.nome === 'Numeri entro il cento').activity_id;

  const report = await sessione.get(`/activities/${activityId}/report-classe`);
  assert.equal(report.status, 200);
  assert.equal(report.corpo.totaleAlunni, 2);
  const unita = report.corpo.unitaPedagogiche[0];
  const num1 = unita.criteri.find((c) => c.codice === 'NUM-1');
  assert.equal(num1.valutati, 2);
  assert.equal(num1.nonValutati, 0);
  assert.deepEqual(num1.distribuzione, { 0: 1, 1: 0, 2: 1 });
  assert.equal(num1.esito.percentuale, 50);
  const num2 = unita.criteri.find((c) => c.codice === 'NUM-2');
  assert.equal(num2.valutati, 0);
  assert.equal(num2.esito.percentuale, null);
  assert.equal(unita.risultato.percentuale, 50, 'un solo criterio valutato: il risultato coincide con quello del criterio');
  assert.deepEqual(report.corpo.complessivo, unita.risultato, "un'attività ha una sola unità pedagogica");
});

test('Report classe (Beta, scala 1-4): distribuzione usa i valori REALI della scala, non 0/1/2', async () => {
  const sessione = await loginESwitch('teacher.math.b@beta.test', 'beta');
  const teachings = await sessione.get('/teachings');
  const attivita = await sessione.get(`/teachings/${teachings.corpo[0].teaching_id}/activities`);
  const activityId = attivita.corpo.find((a) => a.nome === 'Conteggio fino a 20').activity_id;

  const report = await sessione.get(`/activities/${activityId}/report-classe`);
  assert.equal(report.status, 200);
  const num1 = report.corpo.unitaPedagogiche[0].criteri.find((c) => c.codice === 'NUM-1');
  assert.deepEqual(num1.distribuzione, { 1: 0, 2: 1, 3: 0, 4: 1 }, 'chiavi della distribuzione = valori della scala di Beta (1-4)');
  assert.equal(num1.esito.punteggioOttenuto, 6);
  assert.equal(num1.esito.punteggioMassimo, 8);
  assert.equal(num1.esito.percentuale, 75);
  assert.equal(num1.esito.giudizio, 'BUONO', 'soglie di Beta: 85 ECCELLENTE/70 BUONO/55 SUFFICIENTE/0 INSUFFICIENTE');
});

test('Report classe: i dati di un\'altra attività sono completamente esclusi (niente media mobile, niente altre attività)', async () => {
  const sessione = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  const teachings = await sessione.get('/teachings');
  const teaching2A = teachings.corpo.find((t) => t.classe === '2A').teaching_id;
  const unita = await sessione.get(`/teachings/${teaching2A}/pedagogical-units`);
  const numeri = unita.corpo.find((u) => u.nome === 'Numeri');

  const nuovaAttivita = await sessione.post(`/teachings/${teaching2A}/activities`, {
    nome: 'Seconda prova', dataAttivita: '2026-11-01', pedagogicalUnitId: numeri.id,
  });
  assert.equal(nuovaAttivita.status, 201);
  const grigliaNuova = await sessione.get(`/activities/${nuovaAttivita.corpo.activity_id}/griglia`);
  const enrollmentId = grigliaNuova.corpo.righe[0].enrollmentId;
  const criterionId = grigliaNuova.corpo.criteri[0].id;
  await sessione.put(`/activities/${nuovaAttivita.corpo.activity_id}/enrollments/${enrollmentId}/criteria/${criterionId}`, { valore: 0 });

  const attivitaOriginali = await sessione.get(`/teachings/${teaching2A}/activities`);
  const originale = attivitaOriginali.corpo.find((a) => a.nome === 'Numeri entro il cento');
  const reportOriginale = await sessione.get(`/activities/${originale.activity_id}/report-classe`);
  const num1 = reportOriginale.corpo.unitaPedagogiche[0].criteri.find((c) => c.codice === 'NUM-1');
  assert.equal(num1.valutati, 2, 'il nuovo punteggio inserito in un\'altra attività non deve comparire qui');
  assert.deepEqual(num1.distribuzione, { 0: 1, 1: 0, 2: 1 });
});

// ===========================================================================
// SEZIONE G — AUDIT (sez. 40/42/66)
// ===========================================================================

test('Audit: creare/aggiornare una Observation produce una riga di audit con prima/dopo nella stessa transazione', async () => {
  const sessione = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  const teachings = await sessione.get('/teachings');
  const teaching2B = teachings.corpo.find((t) => t.classe === '2B').teaching_id;
  const attivita = await sessione.get(`/teachings/${teaching2B}/activities`);
  const activityId = attivita.corpo[0].activity_id;
  const griglia = await sessione.get(`/activities/${activityId}/griglia`);
  const enrollmentId = griglia.corpo.righe[0].enrollmentId;
  const criterionId = griglia.corpo.criteri.find((c) => griglia.corpo.righe[0].celle.every((cella) => cella.criterionId !== c.id) || true).id;

  const r1 = await sessione.put(`/activities/${activityId}/enrollments/${enrollmentId}/criteria/${criterionId}`, { valore: 1 });
  assert.equal(r1.status, 200);
  const r2 = await sessione.put(`/activities/${activityId}/enrollments/${enrollmentId}/criteria/${criterionId}`, { valore: 2 });
  assert.equal(r2.status, 200);

  const { rows: audit } = await pool.query(
    "SELECT * FROM audit_log WHERE risorsa = 'observation' AND azione = 'observation.upsert' ORDER BY id DESC LIMIT 2"
  );
  assert.equal(audit.length, 2);
  const [ultimo, precedente] = audit;
  assert.equal(JSON.parse(JSON.stringify(ultimo.dopo)).valore, 2);
  assert.equal(precedente.dopo.valore, 1);
  assert.equal(ultimo.prima.valore, 1, 'il secondo audit deve registrare come "prima" il valore impostato dal primo');
  assert.ok(ultimo.actor_account_id);
  assert.ok(ultimo.tenant_id);
  assert.ok(ultimo.created_at);
});

test('Audit: audit_log è realmente append-only per l\'applicazione (app_role non può UPDATE/DELETE)', async () => {
  const { rows } = await pool.query('SELECT id FROM audit_log LIMIT 1');
  await assert.rejects(
    () => pool.query('UPDATE audit_log SET azione = $1 WHERE id = $2', ['manomesso', rows[0].id]),
    (errore) => /permission denied/i.test(errore.message)
  );
  await assert.rejects(
    () => pool.query('DELETE FROM audit_log WHERE id = $1', [rows[0].id]),
    (errore) => /permission denied/i.test(errore.message)
  );
});

// ===========================================================================
// SEZIONE H — INTEGRITÀ DEL DATABASE (query dirette, FK composte, trigger)
// ===========================================================================

test('DB: slug di tenant duplicato è rifiutato (UNIQUE)', async () => {
  await assert.rejects(
    () => pool.query("INSERT INTO tenants (slug, nome) VALUES ('alfa', 'Duplicato')"),
    (e) => e.code === '23505'
  );
});

test('DB: due classi "2A" di tenant diversi coesistono come righe distinte e isolate', async () => {
  const { rows } = await pool.query("SELECT tenant_id, id FROM classes WHERE nome = '2A' ORDER BY tenant_id");
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].tenant_id, rows[1].tenant_id);
  assert.notEqual(rows[0].id, rows[1].id);
});

test('DB (cross-tenant): un\'Activity non può referenziare una PedagogicalUnit di un altro tenant', async () => {
  const teaching = (await pool.query(
    "SELECT t.id, t.tenant_id, t.school_year_id, t.class_id, t.subject_id FROM teachings t JOIN tenants te ON te.id = t.tenant_id WHERE te.slug = 'alfa' LIMIT 1"
  )).rows[0];
  const unitaBeta = (await pool.query(
    "SELECT p.id FROM pedagogical_units p JOIN tenants te ON te.id = p.tenant_id WHERE te.slug = 'beta' LIMIT 1"
  )).rows[0];
  await assert.rejects(
    () => pool.query(
      'INSERT INTO activities (tenant_id, school_year_id, teaching_id, class_id, subject_id, pedagogical_unit_id, nome, data_attivita) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [teaching.tenant_id, teaching.school_year_id, teaching.id, teaching.class_id, teaching.subject_id, unitaBeta.id, 'x', '2026-10-06']
    ),
    (e) => e.code === '23503'
  );
});

test('DB (cross-class): un\'Observation non può riferirsi a un Enrollment di una classe diversa da quella dell\'Activity', async () => {
  const activity2A = (await pool.query(
    "SELECT a.* FROM activities a JOIN classes c ON c.id = a.class_id WHERE c.nome = '2A' AND a.tenant_id = (SELECT id FROM tenants WHERE slug='alfa') LIMIT 1"
  )).rows[0];
  const enroll2B = (await pool.query(
    "SELECT e.* FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE c.nome = '2B' AND e.tenant_id = (SELECT id FROM tenants WHERE slug='alfa') LIMIT 1"
  )).rows[0];
  const criterio = (await pool.query('SELECT * FROM criteria WHERE tenant_id = $1 AND pedagogical_unit_id = $2 LIMIT 1', [activity2A.tenant_id, activity2A.pedagogical_unit_id])).rows[0];
  const scala = (await pool.query('SELECT id FROM observation_scales WHERE tenant_id = $1 AND school_level_id IS NULL', [activity2A.tenant_id])).rows[0];
  const docente = (await pool.query("SELECT id FROM accounts WHERE email = 'teacher.math.a@alfa.test'")).rows[0];
  await assert.rejects(
    () => pool.query(
      `INSERT INTO observations (tenant_id, school_year_id, activity_id, enrollment_id, class_id, criterion_id, pedagogical_unit_id, scale_id, valore, recorded_by_account_id, data_osservazione)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,2,$9,$10)`,
      [activity2A.tenant_id, activity2A.school_year_id, activity2A.id, enroll2B.id, enroll2B.class_id, criterio.id, criterio.pedagogical_unit_id, scala.id, docente.id, '2026-10-06']
    ),
    (e) => e.code === '23503'
  );
});

test('DB (fuori scala): un valore assente dalla scala applicabile è rifiutato dalla FK (scale_id, valore)', async () => {
  const activity = (await pool.query(
    "SELECT a.* FROM activities a JOIN tenants t ON t.id = a.tenant_id WHERE t.slug = 'alfa' AND a.nome = 'Numeri entro il cento' AND a.class_id = (SELECT id FROM classes WHERE nome='2A' AND tenant_id=(SELECT id FROM tenants WHERE slug='alfa')) LIMIT 1"
  )).rows[0];
  const enroll = (await pool.query('SELECT * FROM enrollments WHERE class_id = $1 LIMIT 1', [activity.class_id])).rows[0];
  const criterio = (await pool.query("SELECT * FROM criteria WHERE tenant_id = $1 AND pedagogical_unit_id = $2 AND codice = 'NUM-3'", [activity.tenant_id, activity.pedagogical_unit_id])).rows[0];
  const scala = (await pool.query('SELECT id FROM observation_scales WHERE tenant_id = $1 AND school_level_id IS NULL', [activity.tenant_id])).rows[0];
  const docente = (await pool.query("SELECT id FROM accounts WHERE email = 'teacher.math.a@alfa.test'")).rows[0];
  await assert.rejects(
    () => pool.query(
      `INSERT INTO observations (tenant_id, school_year_id, activity_id, enrollment_id, class_id, criterion_id, pedagogical_unit_id, scale_id, valore, recorded_by_account_id, data_osservazione)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,5,$9,$10)`,
      [activity.tenant_id, activity.school_year_id, activity.id, enroll.id, enroll.class_id, criterio.id, criterio.pedagogical_unit_id, scala.id, docente.id, '2026-10-06']
    ),
    (e) => e.code === '23503'
  );
});

test('DB: DELETE di una PedagogicalUnit referenziata da un\'Activity è rifiutato (RESTRICT, sez. 39)', async () => {
  const unita = (await pool.query(
    "SELECT id FROM pedagogical_units WHERE id = (SELECT pedagogical_unit_id FROM activities LIMIT 1)"
  )).rows[0];
  await assert.rejects(
    () => pool.query('DELETE FROM pedagogical_units WHERE id = $1', [unita.id]),
    (e) => e.code === '23503'
  );
});

test('DB: immutabilità strutturale di un Teaching dopo la creazione di un\'Activity (trigger, sez. 28/38)', async () => {
  const teaching = (await pool.query('SELECT teaching_id FROM activities LIMIT 1')).rows[0];
  const altraClasse = (await pool.query(
    'SELECT id FROM classes WHERE id <> (SELECT class_id FROM teachings WHERE id = $1) LIMIT 1', [teaching.teaching_id]
  )).rows[0];
  await assert.rejects(
    () => pool.query('UPDATE teachings SET class_id = $1 WHERE id = $2', [altraClasse.id, teaching.teaching_id]),
    (e) => /immutabili/i.test(e.message)
  );
  // Una colonna NON strutturale (stato) resta modificabile senza problemi.
  await pool.query("UPDATE teachings SET stato = 'attivo' WHERE id = $1", [teaching.teaching_id]);
});

test('DB (cross-year): un\'Activity non può usare una PedagogicalUnit di un anno scolastico diverso, anche nello stesso tenant', async () => {
  const alfa = (await pool.query("SELECT id FROM tenants WHERE slug = 'alfa'")).rows[0];
  const { rows: [nuovoAnno] } = await pool.query(
    "INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine) VALUES ($1, '2027/2028', '2027-09-01', '2028-06-30') RETURNING id",
    [alfa.id]
  );
  const livello = (await pool.query("SELECT id FROM school_levels WHERE tenant_id = $1 AND nome = 'Primaria'", [alfa.id])).rows[0];
  const { rows: [nuovaMateria] } = await pool.query(
    "INSERT INTO subjects (tenant_id, school_level_id, school_year_id, nome) VALUES ($1,$2,$3,'Matematica') RETURNING id",
    [alfa.id, livello.id, nuovoAnno.id]
  );
  const { rows: [nuovaUnita] } = await pool.query(
    'INSERT INTO pedagogical_units (tenant_id, school_year_id, subject_id, nome) VALUES ($1,$2,$3,\'Numeri\') RETURNING id',
    [alfa.id, nuovoAnno.id, nuovaMateria.id]
  );
  const teachingEsistente = (await pool.query(
    "SELECT id, tenant_id, school_year_id, class_id, subject_id FROM teachings WHERE tenant_id = $1 LIMIT 1", [alfa.id]
  )).rows[0];
  await assert.rejects(
    () => dominio.creaActivity(pool, {
      teachingId: teachingEsistente.id, tenantId: alfa.id, nome: 'Cross year', dataAttivita: '2026-10-06', pedagogicalUnitId: nuovaUnita.id,
    }),
    (e) => e.stato === 400
  );
});

test('DB (cross-subject): un\'Observation non può usare un Criterion di un\'unità pedagogica diversa da quella dell\'Activity', async () => {
  const alfa = (await pool.query("SELECT id FROM tenants WHERE slug = 'alfa'")).rows[0];
  const attivitaItaliano = (await pool.query(
    "SELECT id FROM activities WHERE tenant_id = $1 AND nome = 'Lettura silenziosa'", [alfa.id]
  )).rows[0];
  const criterioMatematica = (await pool.query(
    "SELECT id FROM criteria WHERE tenant_id = $1 AND codice = 'NUM-1'", [alfa.id]
  )).rows[0];
  const enrollment = (await pool.query(
    "SELECT id FROM enrollments WHERE tenant_id = $1 AND class_id = (SELECT class_id FROM activities WHERE id = $2) LIMIT 1",
    [alfa.id, attivitaItaliano.id]
  )).rows[0];
  const docente = (await pool.query("SELECT id FROM accounts WHERE email = 'teacher.italian.a@alfa.test'")).rows[0];
  await assert.rejects(
    () => dominio.salvaObservation(pool, {
      activityId: attivitaItaliano.id, enrollmentId: enrollment.id, criterionId: criterioMatematica.id,
      valore: 2, tenantId: alfa.id, accountId: docente.id,
    }),
    (e) => e.stato === 404
  );
});

test('DB (cross-class, livello applicativo): salvaObservation rifiuta un Enrollment di un\'altra classe con 404, non con un errore generico', async () => {
  const alfa = (await pool.query("SELECT id FROM tenants WHERE slug = 'alfa'")).rows[0];
  const attivita2A = (await pool.query(
    "SELECT id, pedagogical_unit_id FROM activities WHERE tenant_id = $1 AND nome = 'Numeri entro il cento' AND class_id = (SELECT id FROM classes WHERE nome='2A' AND tenant_id=$1)",
    [alfa.id]
  )).rows[0];
  const enrollment2B = (await pool.query(
    "SELECT id FROM enrollments WHERE tenant_id = $1 AND class_id = (SELECT id FROM classes WHERE nome='2B' AND tenant_id=$1) LIMIT 1", [alfa.id]
  )).rows[0];
  const criterio = (await pool.query('SELECT id FROM criteria WHERE pedagogical_unit_id = $1 LIMIT 1', [attivita2A.pedagogical_unit_id])).rows[0];
  const docente = (await pool.query("SELECT id FROM accounts WHERE email = 'teacher.math.a@alfa.test'")).rows[0];
  await assert.rejects(
    () => dominio.salvaObservation(pool, {
      activityId: attivita2A.id, enrollmentId: enrollment2B.id, criterionId: criterio.id, valore: 2,
      tenantId: alfa.id, accountId: docente.id,
    }),
    (e) => e.stato === 404
  );
});

// ===========================================================================
// SEZIONE I — PLATFORM: creazione tenant (sez. 46, con audit)
// ===========================================================================

test('Platform admin: crea un nuovo tenant (audit incluso)', async () => {
  const { sessione: sessioneAdmin, risposta } = await login('platform.admin@platform.test');
  const alfaId = risposta.corpo.tenantsDisponibiliPerSwitch.find((t) => t.slug === 'alfa').id;
  await sessioneAdmin.post('/auth/switch-tenant', { tenantId: alfaId });

  const r = await sessioneAdmin.post('/platform/tenants', { slug: 'gamma', nome: 'Istituto Comprensivo Gamma' });
  assert.equal(r.status, 201);
  const { rows: audit } = await pool.query(
    "SELECT * FROM audit_log WHERE azione = 'tenant.create' AND risorsa_id = $1", [r.corpo.id]
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_account_id, (await pool.query("SELECT id FROM accounts WHERE email='platform.admin@platform.test'")).rows[0].id);
});
