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
const { pool, transazione } = require('../server/db');
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

test('Isolamento tenant (scrittura): una Observation di Alfa non può essere modificata dal contesto Beta, nemmeno passando enrollmentId/criterionId reali di Alfa', async () => {
  const sessioneA = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  const teachings = await sessioneA.get('/teachings');
  const teachingAlfa = teachings.corpo[0].teaching_id;
  const activities = await sessioneA.get(`/teachings/${teachingAlfa}/activities`);
  const activityAlfa = activities.corpo[0].activity_id;
  const grigliaAlfa = await sessioneA.get(`/activities/${activityAlfa}/griglia`);
  const enrollmentAlfa = grigliaAlfa.corpo.righe[0].enrollmentId;
  const criterionAlfa = grigliaAlfa.corpo.criteri[0].id;

  const { rows: primaRows } = await pool.query(
    'SELECT valore FROM observations WHERE activity_id = $1 AND enrollment_id = $2 AND criterion_id = $3',
    [activityAlfa, enrollmentAlfa, criterionAlfa]
  );

  // Stesso account con Membership in entrambi i tenant, ma tenant attivo = Beta: il PUT
  // deve fallire con 404 (attività non trovata nel tenant attivo), non con una scrittura silenziosa.
  const sessioneMulti = await loginESwitch('multitenant.user@example.test', 'beta');
  const rScritturaNegata = await sessioneMulti.put(
    `/activities/${activityAlfa}/enrollments/${enrollmentAlfa}/criteria/${criterionAlfa}`, { valore: 0 }
  );
  assert.equal(rScritturaNegata.status, 404, "un'osservazione di Alfa non deve essere scrivibile dal contesto Beta");

  const { rows: dopoRows } = await pool.query(
    'SELECT valore FROM observations WHERE activity_id = $1 AND enrollment_id = $2 AND criterion_id = $3',
    [activityAlfa, enrollmentAlfa, criterionAlfa]
  );
  assert.deepEqual(dopoRows, primaRows, 'il tentativo di scrittura cross-tenant non deve aver modificato la riga (nessun effetto collaterale)');
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
// SEZIONE E-BIS — NAVIGAZIONE V1 UI (school-levels/classes/students/assessments)
// ===========================================================================

test('/auth/me espone i RoleAssignment dell\'account nel tenant attivo, con gli scope esatti (teaching_id/school_level_id)', async () => {
  const { sessione, risposta } = await login('multitenant.user@example.test');
  assert.deepEqual(risposta.corpo.ruoliNelTenantAttivo, [], 'nessun tenant attivo: nessun ruolo esposto ancora');

  const alfa = risposta.corpo.memberships.find((m) => m.slug === 'alfa');
  const rAlfa = await sessione.post('/auth/switch-tenant', { tenantId: alfa.tenant_id });
  const ruoloAlfa = rAlfa.corpo.ruoliNelTenantAttivo.find((r) => r.ruolo === 'TEACHER');
  assert.ok(ruoloAlfa, 'deve comparire il RoleAssignment TEACHER in Alfa');
  assert.equal(ruoloAlfa.scope_type, 'TEACHING');
  const teachingIdAtteso = (await pool.query(
    `SELECT t.id FROM teachings t JOIN accounts a ON a.id=t.account_id
     WHERE a.email='multitenant.user@example.test' AND t.tenant_id=$1`, [alfa.tenant_id]
  )).rows[0].id;
  assert.equal(ruoloAlfa.scope_teaching_id, teachingIdAtteso);

  const beta = risposta.corpo.memberships.find((m) => m.slug === 'beta');
  const rBeta = await sessione.post('/auth/switch-tenant', { tenantId: beta.tenant_id });
  const ruoloBeta = rBeta.corpo.ruoliNelTenantAttivo.find((r) => r.ruolo === 'COORDINATOR');
  assert.ok(ruoloBeta, 'deve comparire il RoleAssignment COORDINATOR in Beta');
  assert.equal(ruoloBeta.scope_type, 'SCHOOL_LEVEL');
  const schoolLevelIdAtteso = (await pool.query(
    "SELECT id FROM school_levels WHERE tenant_id=$1 AND nome='Primary'", [beta.tenant_id]
  )).rows[0].id;
  assert.equal(ruoloBeta.scope_school_level_id, schoolLevelIdAtteso);
  // Nessun ruolo di Alfa deve "trapelare" nella vista di Beta.
  assert.ok(!rBeta.corpo.ruoliNelTenantAttivo.some((r) => r.scope_teaching_id === teachingIdAtteso));
});

test('Docente: GET /teachings/:id/students mostra il roster del proprio Teaching; fuori scope -> 403', async () => {
  const sessioneMath = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  const teachings = await sessioneMath.get('/teachings');
  const teaching2A = teachings.corpo.find((t) => t.classe === '2A').teaching_id;
  const rOk = await sessioneMath.get(`/teachings/${teaching2A}/students`);
  assert.equal(rOk.status, 200);
  assert.ok(rOk.corpo.length >= 2, 'la 2A di Alfa ha almeno 2 studenti nel seed');
  assert.ok(rOk.corpo[0].nome && rOk.corpo[0].cognome);

  const teachingItaliano = (await pool.query(
    "SELECT t.id FROM teachings t JOIN accounts a ON a.id=t.account_id WHERE a.email='teacher.italian.a@alfa.test'"
  )).rows[0].id;
  const rNegato = await sessioneMath.get(`/teachings/${teachingItaliano}/students`);
  assert.equal(rNegato.status, 403);
});

test('Docente: GET /teachings/:id/assessments mostra gli Assessment del proprio Teaching; fuori scope -> 403', async () => {
  const sessioneMath = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  const teachings = await sessioneMath.get('/teachings');
  const teaching2A = teachings.corpo.find((t) => t.classe === '2A').teaching_id;
  const r = await sessioneMath.get(`/teachings/${teaching2A}/assessments`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.corpo));
  assert.ok(r.corpo.some((a) => a.giudizio === 'DISTINTO'), 'l\'Assessment seminato per Matematica 2A deve comparire');

  const teachingItaliano = (await pool.query(
    "SELECT t.id FROM teachings t JOIN accounts a ON a.id=t.account_id WHERE a.email='teacher.italian.a@alfa.test'"
  )).rows[0].id;
  const rNegato = await sessioneMath.get(`/teachings/${teachingItaliano}/assessments`);
  assert.equal(rNegato.status, 403);
});

test('Docente: NON ha il permesso class.read, quindi /classes/:id/students e /classes/:id/teachings restano riservati a Coordinatore/Tenant Admin', async () => {
  const sessioneMath = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  // /school-levels è solo un elenco di nomi/id (nessun dato protetto): resta leggibile da chiunque
  // sia autenticato nel tenant, anche senza class.read — la vera protezione è al passo successivo.
  const rLivelli = await sessioneMath.get('/school-levels');
  assert.equal(rLivelli.status, 200);

  const classe2A = (await pool.query(
    "SELECT id FROM classes WHERE nome='2A' AND tenant_id=(SELECT id FROM tenants WHERE slug='alfa')"
  )).rows[0].id;
  const rClasse = await sessioneMath.get(`/classes/${classe2A}/students`);
  assert.equal(rClasse.status, 403);
  const rTeachingsClasse = await sessioneMath.get(`/classes/${classe2A}/teachings`);
  assert.equal(rTeachingsClasse.status, 403);
});

test('Coordinatore (Beta, scope SCHOOL_LEVEL=Primary): naviga school-level -> classi -> studenti/teachings del proprio livello', async () => {
  const sessioneCoord = await loginESwitch('multitenant.user@example.test', 'beta');

  const rLivelli = await sessioneCoord.get('/school-levels');
  assert.equal(rLivelli.status, 200);
  const primary = rLivelli.corpo.find((l) => l.nome === 'Primary');
  const middleSchool = rLivelli.corpo.find((l) => l.nome === 'Middle School');
  assert.ok(primary && middleSchool, 'Beta ha entrambi i livelli nel seed');

  const rClassiOk = await sessioneCoord.get(`/school-levels/${primary.id}/classes`);
  assert.equal(rClassiOk.status, 200);
  const classe2A = rClassiOk.corpo.find((c) => c.nome === '2A');
  assert.ok(classe2A, 'la 2A di Beta appartiene al livello Primary');

  const rStudenti = await sessioneCoord.get(`/classes/${classe2A.id}/students`);
  assert.equal(rStudenti.status, 200);
  assert.equal(rStudenti.corpo.classe.nome, '2A');
  assert.ok(rStudenti.corpo.studenti.length >= 2, 'la 2A di Beta ha almeno 2 studenti nel seed');

  const rTeachings = await sessioneCoord.get(`/classes/${classe2A.id}/teachings`);
  assert.equal(rTeachings.status, 200);
  assert.ok(rTeachings.corpo.some((t) => t.materia === 'Matematica e Logica'));

  // Confine di scope: Middle School esiste DAVVERO nello stesso tenant, ma il
  // Coordinatore è scope_school_level_id=Primary, non Middle School -> 403.
  const rNegato = await sessioneCoord.get(`/school-levels/${middleSchool.id}/classes`);
  assert.equal(rNegato.status, 403, 'un livello scolastico diverso, anche nello stesso tenant, deve restare fuori scope');
});

test('Coordinatore: non può leggere classi/studenti di un ALTRO tenant passando classId/schoolLevelId di Alfa mentre il tenant attivo è Beta', async () => {
  const classeAlfa = (await pool.query(
    "SELECT id FROM classes WHERE nome='2A' AND tenant_id=(SELECT id FROM tenants WHERE slug='alfa')"
  )).rows[0].id;
  const livelloAlfa = (await pool.query(
    "SELECT id FROM school_levels WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Primaria'"
  )).rows[0].id;

  const sessioneCoord = await loginESwitch('multitenant.user@example.test', 'beta');
  const rClasse = await sessioneCoord.get(`/classes/${classeAlfa}/students`);
  assert.equal(rClasse.status, 404, 'la classe di Alfa non esiste nel contesto Beta');
  const rLivello = await sessioneCoord.get(`/school-levels/${livelloAlfa}/classes`);
  assert.equal(rLivello.status, 404, 'il livello scolastico di Alfa non esiste nel contesto Beta');
});

test('Cambio tenant: i dati (classId/teachingId) del tenant precedente restano inaccessibili dopo lo switch, anche per lo stesso account', async () => {
  const sessione = await loginESwitch('multitenant.user@example.test', 'alfa');
  const teachingAlfa = (await sessione.get('/teachings')).corpo[0].teaching_id;
  const rPrimaOk = await sessione.get(`/teachings/${teachingAlfa}/students`);
  assert.equal(rPrimaOk.status, 200, 'nel tenant corretto, il proprio Teaching è leggibile');

  await sessione.post('/auth/switch-tenant', { tenantId: (await pool.query("SELECT id FROM tenants WHERE slug='beta'")).rows[0].id });
  const rDopoSwitch = await sessione.get(`/teachings/${teachingAlfa}/students`);
  assert.equal(rDopoSwitch.status, 404, 'lo stesso teachingId, dopo lo switch a Beta, non deve più essere raggiungibile');
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
// SEZIONE F-BIS — INIZIALIZZAZIONE DELLA CONNESSIONE (server/db.js)
//
// SET ROLE app_role deve essere completato PRIMA che una connessione sia
// utilizzabile dall'applicazione (sez. 41): usa onConnect (opzione del
// costruttore di pg.Pool, attesa da pg-pool prima di consegnare la
// connessione), non l'evento 'connect' (fire-and-forget, non atteso).
// ===========================================================================

test('server/db.js: una query diretta su pool ha sempre current_role = app_role, mai il ruolo di connessione', async () => {
  const { rows } = await pool.query('SELECT current_role AS ruolo, session_user AS utente_di_connessione');
  assert.equal(rows[0].ruolo, 'app_role');
  assert.notEqual(rows[0].ruolo, rows[0].utente_di_connessione, 'session_user resta il ruolo con cui ci si è connessi: SET ROLE cambia solo current_role');
});

test('server/db.js: una connessione ottenuta con pool.connect() (usata da transazione()) ha già current_role = app_role, senza bisogno di attendere altro', async () => {
  await transazione(async (client) => {
    const { rows } = await client.query('SELECT current_role AS ruolo');
    assert.equal(rows[0].ruolo, 'app_role');
  });
});

test('server/db.js: transazione() con ROLLBACK resta comunque sotto app_role (il comportamento delle transazioni non è cambiato dalla correzione)', async () => {
  await assert.rejects(
    () => transazione(async (client) => {
      const { rows } = await client.query('SELECT current_role AS ruolo');
      assert.equal(rows[0].ruolo, 'app_role');
      throw new Error('rollback intenzionale');
    }),
    /rollback intenzionale/
  );
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

// ===========================================================================
// SEZIONE J — AVANZAMENTO PEDAGOGICO DELLO STUDENTE (storico + media mobile ultime 3)
// ===========================================================================

async function contestoProgressoAlfa2A() {
  const sessione = await loginESwitch('teacher.math.a@alfa.test', 'alfa');
  const teachings = await sessione.get('/teachings');
  const teaching2A = teachings.corpo.find((t) => t.classe === '2A').teaching_id;
  const studenti = await sessione.get(`/teachings/${teaching2A}/students`);
  return { sessione, teaching2A, studenti: studenti.corpo };
}

function criterioNum1(progresso) {
  return progresso.nuclei.find((n) => n.nome === 'Numeri').criteri.find((c) => c.codice === 'NUM-1');
}

test('Progresso studente: il docente vede l\'avanzamento di uno studente del proprio Teaching (nuclei, criteri, storico)', async () => {
  const { sessione, teaching2A, studenti } = await contestoProgressoAlfa2A();
  const s1 = studenti.find((s) => s.nome === 'A-Student-01');
  const r = await sessione.get(`/teachings/${teaching2A}/students/${s1.enrollment_id}/progress`);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.alunno.nome, 'A-Student-01');
  assert.deepEqual(r.corpo.regola, { tipo: 'media_mobile', finestra: 3 });
  const num1 = criterioNum1(r.corpo);
  // Seed: la prima osservazione su NUM-1 è un 2 del 2026-10-06 (test precedenti possono averne aggiunte altre allo stesso studente).
  assert.equal(num1.osservazioni[0].valore, 2);
  assert.equal(num1.osservazioni[0].dataOsservazione, '2026-10-06');
  assert.equal(num1.risultatoCorrente.osservazioniTotali, num1.osservazioni.length);
  assert.equal(num1.risultatoCorrente.osservazioniConsiderate, Math.min(3, num1.osservazioni.length));
  // I criteri senza osservazioni compaiono comunque, come non valutati.
  const num2 = r.corpo.nuclei.find((n) => n.nome === 'Numeri').criteri.find((c) => c.codice === 'NUM-2');
  assert.equal(num2.risultatoCorrente.percentuale, null);
  assert.deepEqual(num2.osservazioni, []);
  // Le osservazioni di Italiano (altro Teaching) non entrano nel progresso di Matematica.
  assert.ok(!r.corpo.nuclei.some((n) => n.criteri.some((c) => c.codice === 'LET-1')));
});

test('Progresso studente: un docente non può vedere lo studente di un altro Teaching (403) né di un\'altra classe (404)', async () => {
  const { sessione, teaching2A, studenti } = await contestoProgressoAlfa2A();
  const teachingItaliano = (await pool.query(
    "SELECT t.id FROM teachings t JOIN accounts a ON a.id=t.account_id WHERE a.email='teacher.italian.a@alfa.test'"
  )).rows[0].id;
  const s1 = studenti.find((s) => s.nome === 'A-Student-01');
  // Stesso studente, ma tramite un Teaching su cui il docente di Matematica non ha alcun ruolo.
  const r403 = await sessione.get(`/teachings/${teachingItaliano}/students/${s1.enrollment_id}/progress`);
  assert.equal(r403.status, 403);
  // Teaching proprio (2A) ma iscrizione di uno studente della 2B: non appartiene alla classe del Teaching.
  const enrollment2B = (await pool.query(
    'SELECT e.id FROM enrollments e JOIN people p ON p.id = e.student_person_id WHERE p.nome = $1', ['A-Student-03']
  )).rows[0].id;
  const r404 = await sessione.get(`/teachings/${teaching2A}/students/${enrollment2B}/progress`);
  assert.equal(r404.status, 404);
  const rNonNumerico = await sessione.get(`/teachings/${teaching2A}/students/abc/progress`);
  assert.equal(rNonNumerico.status, 400, 'identificativo non numerico rifiutato');
});

test('Progresso studente: un utente con tenant attivo diverso non vede studente/Teaching di Alfa (404)', async () => {
  const { teaching2A, studenti } = await contestoProgressoAlfa2A();
  const s1 = studenti.find((s) => s.nome === 'A-Student-01');
  const sessioneBeta = await loginESwitch('teacher.math.b@beta.test', 'beta');
  const r = await sessioneBeta.get(`/teachings/${teaching2A}/students/${s1.enrollment_id}/progress`);
  assert.equal(r.status, 404);
  const sessioneMulti = await loginESwitch('multitenant.user@example.test', 'beta');
  const rMulti = await sessioneMulti.get(`/teachings/${teaching2A}/students/${s1.enrollment_id}/progress`);
  assert.equal(rMulti.status, 404);
});

test('Progresso studente: media mobile delle ultime 3 (0,1,2,2 -> 1,67), ordine cronologico, storico completo; report attività separato', async () => {
  const { sessione, teaching2A, studenti } = await contestoProgressoAlfa2A();
  const s2 = studenti.find((s) => s.nome === 'A-Student-02'); // seed: NUM-1 = 0 il 2026-10-06
  const unita = (await sessione.get(`/teachings/${teaching2A}/pedagogical-units`)).corpo.find((u) => u.nome === 'Numeri');

  // Create volutamente fuori ordine cronologico: l'ordine deve dipendere dalla data, non dall'inserimento.
  const nuove = {};
  for (const [nome, data, valore] of [['Prova C', '2026-10-27', 2], ['Prova A', '2026-10-13', 1], ['Prova B', '2026-10-20', 2]]) {
    const a = await sessione.post(`/teachings/${teaching2A}/activities`, { nome, dataAttivita: data, pedagogicalUnitId: unita.id });
    assert.equal(a.status, 201);
    const griglia = await sessione.get(`/activities/${a.corpo.activity_id}/griglia`);
    const num1 = griglia.corpo.criteri.find((c) => c.codice === 'NUM-1');
    const w = await sessione.put(`/activities/${a.corpo.activity_id}/enrollments/${s2.enrollment_id}/criteria/${num1.id}`, { valore });
    assert.equal(w.status, 200);
    nuove[nome] = a.corpo.activity_id;
  }

  const r = await sessione.get(`/teachings/${teaching2A}/students/${s2.enrollment_id}/progress`);
  assert.equal(r.status, 200);
  const num1 = criterioNum1(r.corpo);
  // Storico COMPLETO, in ordine cronologico (lo 0 del seed, poi 1, 2, 2).
  assert.deepEqual(num1.osservazioni.map((o) => o.valore), [0, 1, 2, 2]);
  assert.deepEqual(num1.osservazioni.map((o) => o.dataOsservazione), ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
  assert.deepEqual(num1.osservazioni.map((o) => o.inRisultatoCorrente), [false, true, true, true]);
  // Valore corrente: ultime 3 = 1, 2, 2 -> 5/3 = 1,67 (83,33%); lo 0 resta nello storico ma non nella media.
  assert.equal(num1.risultatoCorrente.media, 1.67);
  assert.equal(num1.risultatoCorrente.osservazioniConsiderate, 3);
  assert.equal(num1.risultatoCorrente.osservazioniTotali, 4);
  assert.equal(num1.risultatoCorrente.percentuale, 83.33);
  assert.equal(num1.risultatoCorrente.giudizio, 'DISTINTO');
  // Nucleo e complessivo: un solo criterio valutato -> coincidono con il criterio.
  assert.equal(r.corpo.nuclei.find((n) => n.nome === 'Numeri').risultatoCorrente.percentuale, 83.33);
  assert.equal(r.corpo.complessivo.percentuale, 83.33);
  assert.equal(r.corpo.complessivo.criteriValutati, 1);

  // Lo storico non è stato sostituito dalla media: 4 righe reali nel database.
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM observations WHERE enrollment_id = $1 AND criterion_id = $2', [s2.enrollment_id, num1.id]
  );
  assert.equal(rows[0].n, 4);

  // Il report della SINGOLA attività usa solo i dati di quell'attività (niente media mobile, niente altre attività).
  const reportB = await sessione.get(`/activities/${nuove['Prova B']}/report-classe`);
  assert.equal(reportB.status, 200);
  const n1 = reportB.corpo.unitaPedagogiche[0].criteri.find((c) => c.codice === 'NUM-1');
  assert.equal(n1.valutati, 1);
  assert.deepEqual(n1.distribuzione, { 0: 0, 1: 0, 2: 1 });
  assert.equal(n1.esito.percentuale, 100, 'solo il 2 di questa attività: 100%, non 83,33 (media mobile)');
  const grigliaB = await sessione.get(`/activities/${nuove['Prova B']}/griglia`);
  const riga = grigliaB.corpo.righe.find((x) => x.enrollmentId === s2.enrollment_id);
  assert.deepEqual(riga.celle.filter((c) => c.valore !== null).map((c) => c.valore), [2]);
});

// ===========================================================================
// SEZIONE K — REPORT PEDAGOGICO DELLO STUDENTE, specifica v2.7 (Fase 2)
//
// L'endpoint legge i dati e li passa al motore puro server/lib/calcoloProgresso.js.
// I dati che il seed non contiene (attività/criterio disattivati, scala diversa,
// secondo livello scolastico) sono creati qui nel database di prova e ripristinati.
// ===========================================================================

const motoreProgresso = require('../server/lib/calcoloProgresso');

function criterioDi(progresso, nomeNucleo, codice) {
  return progresso.nuclei.find((n) => n.nome === nomeNucleo).criteri.find((c) => c.codice === codice);
}

/** Crea un'attività sul Teaching e registra un valore per uno studente su un criterio (via API). */
async function registraOsservazione(sessione, teachingId, { nome, data, unita, codice, enrollmentId, valore }) {
  const a = await sessione.post(`/teachings/${teachingId}/activities`, { nome, dataAttivita: data, pedagogicalUnitId: unita.id });
  assert.equal(a.status, 201);
  const griglia = await sessione.get(`/activities/${a.corpo.activity_id}/griglia`);
  const criterio = griglia.corpo.criteri.find((c) => c.codice === codice);
  const w = await sessione.put(`/activities/${a.corpo.activity_id}/enrollments/${enrollmentId}/criteria/${criterio.id}`, { valore });
  assert.equal(w.status, 200);
  return { activityId: a.corpo.activity_id, criterionId: criterio.id };
}

test('Report studente v2.7: struttura completa (teaching, scala, bande, nuclei, criteri non osservati, nucleo senza criteri)', async () => {
  const { sessione, teaching2A, studenti } = await contestoProgressoAlfa2A();
  const s1 = studenti.find((s) => s.nome === 'A-Student-01');
  const materia = (await pool.query(
    "SELECT s.id, s.tenant_id, s.school_year_id FROM subjects s JOIN tenants t ON t.id = s.tenant_id WHERE t.slug = 'alfa' AND s.nome = 'Matematica'"
  )).rows[0];
  const vuoto = (await pool.query(
    "INSERT INTO pedagogical_units (tenant_id, school_year_id, subject_id, nome, ordine) VALUES ($1, $2, $3, 'Nucleo senza criteri (test)', 99) RETURNING id",
    [materia.tenant_id, materia.school_year_id, materia.id]
  )).rows[0];
  try {
    const r = await sessione.get(`/teachings/${teaching2A}/students/${s1.enrollment_id}/progress`);
    assert.equal(r.status, 200);
    const p = r.corpo;
    assert.deepEqual([p.teaching.materia, p.teaching.classe, p.teaching.annoScolastico], ['Matematica', '2A', '2026/2027']);
    assert.deepEqual([p.alunno.nome, p.alunno.enrollmentId], ['A-Student-01', s1.enrollment_id]);
    // Scala e bande: quelle configurate per il tenant Alfa, nessun valore fisso nel codice.
    assert.deepEqual([p.scala.valoreMinimo, p.scala.valoreMassimo], [0, 2]);
    assert.deepEqual(p.scala.valori.map((v) => v.valore), [0, 1, 2]);
    assert.deepEqual(p.bande.map((b) => [b.etichetta, b.sogliaMinima, b.livello]), [
      ['OTTIMO', 90, 5], ['DISTINTO', 80, 4], ['BUONO', 70, 3], ['DISCRETO', 60, 2], ['SUFFICIENTE', 50, 1], ['NON SUFFICIENTE', 0, 0],
    ]);
    // Nuclei attivi della materia, nell'ordine configurato; ciascuno con tutti i criteri attivi.
    assert.deepEqual(p.nuclei.map((n) => n.nome), ['Numeri', 'Spazio e figure', 'Relazioni, dati e previsioni', 'Nucleo senza criteri (test)']);
    assert.deepEqual(p.nuclei[0].criteri.map((c) => c.codice), ['NUM-1', 'NUM-2', 'NUM-3', 'NUM-4']);
    // Criterio senza osservazioni: visibile, nullo, mai zero.
    const num4 = criterioDi(p, 'Numeri', 'NUM-4');
    assert.deepEqual([num4.risultatoCorrente.percentuale, num4.risultatoCorrente.media, num4.cumulativo.percentuale], [null, null, null]);
    assert.deepEqual([num4.livelloCopertura, num4.osservazioni.length], [0, 0]);
    // Nucleo senza alcuna osservazione: non valutato, nessun punto sul radar, nessuno zero artificiale.
    const relazioni = p.nuclei.find((n) => n.nome === 'Relazioni, dati e previsioni');
    assert.deepEqual([relazioni.risultatoCorrente.percentuale, relazioni.radar.posizioneRadar, relazioni.confrontoConComplessivo], [null, null, null]);
    assert.equal(relazioni.risultatoCorrente.criteriValutati, 0);
    // Nucleo senza criteri configurati.
    const senzaCriteri = p.nuclei.find((n) => n.id === vuoto.id);
    assert.deepEqual([senzaCriteri.grigliaNonConfigurata, senzaCriteri.criteri.length, senzaCriteri.risultatoCorrente.percentuale], [true, 0, null]);
    assert.deepEqual(p.criteriNonPiuAttivi, []);
  } finally {
    await pool.query('DELETE FROM pedagogical_units WHERE id = $1', [vuoto.id]);
  }
});

test('Report studente v2.7: 0,1,2,2 -> corrente 83,33% (media 1,67), cumulativo 62,5%; attività disattivata esclusa ma conservata nello storico', async () => {
  const { sessione, teaching2A, studenti } = await contestoProgressoAlfa2A();
  const s2 = studenti.find((s) => s.nome === 'A-Student-02');
  const unita = (await sessione.get(`/teachings/${teaching2A}/pedagogical-units`)).corpo.find((u) => u.nome === 'Numeri');
  const prove = [];
  for (const [nome, data, valore] of [['F2 quarta', '2026-11-24', 2], ['F2 prima', '2026-11-03', 0], ['F2 terza', '2026-11-17', 2], ['F2 seconda', '2026-11-10', 1]]) {
    prove.push({ nome, ...(await registraOsservazione(sessione, teaching2A, { nome, data, unita, codice: 'NUM-2', enrollmentId: s2.enrollment_id, valore })) });
  }
  const leggi = async () => (await sessione.get(`/teachings/${teaching2A}/students/${s2.enrollment_id}/progress`)).corpo;

  const num2 = criterioDi(await leggi(), 'Numeri', 'NUM-2');
  assert.deepEqual(num2.osservazioni.map((o) => o.valore), [0, 1, 2, 2], 'ordine per data, non per inserimento');
  assert.deepEqual(num2.osservazioni.map((o) => o.inRisultatoCorrente), [false, true, true, true]);
  assert.ok(num2.osservazioni.every((o) => o.conteggiata && o.motivoEsclusione === null));
  assert.deepEqual([num2.risultatoCorrente.media, num2.risultatoCorrente.percentuale, num2.risultatoCorrente.giudizio], [1.67, 83.33, 'DISTINTO']);
  assert.deepEqual([num2.cumulativo.percentuale, num2.cumulativo.punteggioOttenuto, num2.cumulativo.punteggioMassimo], [62.5, 5, 8]);
  assert.equal(num2.livelloCopertura, 3);

  // Disattivo l'ultima attività: la finestra diventa 0,1,2 e il cumulativo 3/6; la riga resta nello storico e nel database.
  const quarta = prove.find((x) => x.nome === 'F2 quarta');
  await pool.query("UPDATE activities SET stato = 'disattivata' WHERE id = $1", [quarta.activityId]);
  try {
    const dopo = criterioDi(await leggi(), 'Numeri', 'NUM-2');
    assert.deepEqual([dopo.risultatoCorrente.media, dopo.risultatoCorrente.percentuale, dopo.risultatoCorrente.osservazioniTotali], [1, 50, 3]);
    assert.equal(dopo.cumulativo.percentuale, 50);
    assert.equal(dopo.osservazioni.length, 4, 'lo storico resta completo');
    const esclusa = dopo.osservazioni.find((o) => o.activityId === quarta.activityId);
    assert.deepEqual([esclusa.conteggiata, esclusa.motivoEsclusione, esclusa.inRisultatoCorrente], [false, 'attivita_disattivata', false]);
    assert.deepEqual(dopo.osservazioni.filter((o) => o.conteggiata).map((o) => o.inRisultatoCorrente), [true, true, true]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM observations WHERE activity_id = $1', [quarta.activityId]);
    assert.equal(rows[0].n, 1, "l'osservazione non è stata cancellata");
    // Il report della singola attività resta consultabile e invariato.
    const report = await sessione.get(`/activities/${quarta.activityId}/report-classe`);
    assert.equal(report.status, 200);
    assert.equal(report.corpo.unitaPedagogiche[0].criteri.find((c) => c.codice === 'NUM-2').esito.percentuale, 100);
  } finally {
    await pool.query("UPDATE activities SET stato = 'attiva' WHERE id = $1", [quarta.activityId]);
  }
  assert.equal(criterioDi(await leggi(), 'Numeri', 'NUM-2').risultatoCorrente.percentuale, 83.33);
});

test('Report studente v2.7: nucleo e complessivo = media semplice dei criteri valutati; il risultato coincide con il motore puro', async () => {
  const { sessione, teaching2A, studenti } = await contestoProgressoAlfa2A();
  const s2 = studenti.find((s) => s.nome === 'A-Student-02');
  const p = (await sessione.get(`/teachings/${teaching2A}/students/${s2.enrollment_id}/progress`)).corpo;

  const scala = { valoreMinimo: p.scala.valoreMinimo, valoreMassimo: p.scala.valoreMassimo };
  const bande = motoreProgresso.preparaBande(p.bande.map((b) => ({ soglia_minima: b.sogliaMinima, etichetta: b.etichetta })));
  const attesiPerNucleo = p.nuclei.map((n) => n.criteri.map(
    (c) => motoreProgresso.risultatoCriterioStudente(c.osservazioni.filter((o) => o.conteggiata).map((o) => o.valore), scala, bande)
  ));
  p.nuclei.forEach((n, i) => {
    n.criteri.forEach((c, j) => {
      const atteso = attesiPerNucleo[i][j];
      assert.deepEqual(
        [c.risultatoCorrente.media, c.risultatoCorrente.percentuale, c.risultatoCorrente.giudizio, c.cumulativo.percentuale, c.livelloCopertura],
        [atteso.media, atteso.percentuale, atteso.giudizio, atteso.cumulativo.percentuale, atteso.livelloCopertura],
        `criterio ${c.codice}`
      );
    });
    const nucleoAtteso = motoreProgresso.aggregaCriteriStudente(attesiPerNucleo[i], scala, bande);
    assert.deepEqual(
      [n.risultatoCorrente.percentuale, n.risultatoCorrente.giudizio, n.cumulativo.percentuale, n.radar.posizioneRadar, n.radar.puntoPieno, n.copertura],
      [nucleoAtteso.percentuale, nucleoAtteso.giudizio, nucleoAtteso.cumulativo.percentuale, nucleoAtteso.posizioneRadar, nucleoAtteso.puntoPieno, nucleoAtteso.copertura],
      `nucleo ${n.nome}`
    );
  });
  const complessivoAtteso = motoreProgresso.aggregaCriteriStudente(attesiPerNucleo.flat(), scala, bande);
  assert.deepEqual(
    [p.complessivo.percentuale, p.complessivo.giudizio, p.complessivo.criteriValutati, p.complessivo.criteriTotali, p.complessivo.cumulativo.percentuale],
    [complessivoAtteso.percentuale, complessivoAtteso.giudizio, complessivoAtteso.criteriValutati, complessivoAtteso.criteriTotali, complessivoAtteso.cumulativo.percentuale]
  );

  // Valori noti: NUM-1 e NUM-2 valgono entrambi 83,33% (0,1,2,2), gli altri 6 criteri della materia non sono valutati.
  const numeri = p.nuclei.find((n) => n.nome === 'Numeri');
  assert.deepEqual([numeri.risultatoCorrente.percentuale, numeri.risultatoCorrente.criteriValutati, numeri.risultatoCorrente.criteriTotali], [83.33, 2, 4]);
  assert.equal(numeri.radar.puntoPieno, false, 'due criteri su quattro non sono valutati');
  assert.deepEqual([p.complessivo.percentuale, p.complessivo.criteriValutati, p.complessivo.criteriTotali], [83.33, 2, 8],
    'i criteri non valutati non entrano nel denominatore: 2 valutati su 8 (4 + 2 + 2)');
  assert.equal(numeri.confrontoConComplessivo, 'nella_norma');
});

test('Report studente v2.7: criterio disattivato fuori dal calcolo corrente, storico conservato e distinguibile', async () => {
  const { sessione, teaching2A, studenti } = await contestoProgressoAlfa2A();
  const s2 = studenti.find((s) => s.nome === 'A-Student-02');
  const leggi = async () => (await sessione.get(`/teachings/${teaching2A}/students/${s2.enrollment_id}/progress`)).corpo;
  const prima = await leggi();
  const num2 = criterioDi(prima, 'Numeri', 'NUM-2');
  assert.equal(num2.osservazioni.length, 4);

  await pool.query("UPDATE criteria SET stato = 'disattivato' WHERE id = $1", [num2.id]);
  try {
    const dopo = await leggi();
    const numeri = dopo.nuclei.find((n) => n.nome === 'Numeri');
    assert.deepEqual(numeri.criteri.map((c) => c.codice), ['NUM-1', 'NUM-3', 'NUM-4'], 'non è più tra i criteri valutabili');
    assert.deepEqual([numeri.risultatoCorrente.criteriValutati, numeri.risultatoCorrente.criteriTotali], [1, 3]);
    assert.equal(dopo.complessivo.criteriTotali, prima.complessivo.criteriTotali - 1);
    assert.equal(dopo.criteriNonPiuAttivi.length, 1);
    const storico = dopo.criteriNonPiuAttivi[0];
    assert.deepEqual([storico.codice, storico.nucleo, storico.osservazioni.length], ['NUM-2', 'Numeri', 4]);
    assert.ok(storico.osservazioni.every((o) => !o.conteggiata && o.motivoEsclusione === 'criterio_non_attivo'));
    assert.equal(storico.risultatoCorrente, undefined, 'nessun risultato per un criterio non attivo');
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM observations WHERE criterion_id = $1 AND enrollment_id = $2', [num2.id, s2.enrollment_id]
    );
    assert.equal(rows[0].n, 4, 'le osservazioni storiche restano nel database');
  } finally {
    await pool.query("UPDATE criteria SET stato = 'attivo' WHERE id = $1", [num2.id]);
  }
  assert.deepEqual((await leggi()).criteriNonPiuAttivi, []);
});

test('Report studente v2.7: scala configurata dal tenant (Beta 1-4) -> percentuale pedagogica e posizioneRadar distinte, nulla di fisso', async () => {
  const sessione = await loginESwitch('teacher.math.b@beta.test', 'beta');
  const teachingId = (await sessione.get('/teachings')).corpo[0].teaching_id;
  const studenti = (await sessione.get(`/teachings/${teachingId}/students`)).corpo;
  const progressi = [];
  for (const s of studenti) {
    const r = await sessione.get(`/teachings/${teachingId}/students/${s.enrollment_id}/progress`);
    assert.equal(r.status, 200);
    progressi.push(r.corpo);
  }
  const p0 = progressi[0];
  assert.deepEqual([p0.scala.valoreMinimo, p0.scala.valoreMassimo], [1, 4]);
  assert.deepEqual(p0.scala.valori.map((v) => v.valore), [1, 2, 3, 4]);
  assert.deepEqual(p0.bande.map((b) => [b.etichetta, b.sogliaMinima, b.posizioneRadar]), [
    ['ECCELLENTE', 85, 80], ['BUONO', 70, 60], ['SUFFICIENTE', 55, 40], ['INSUFFICIENTE', 0, null],
  ], 'anelli del radar derivati dalle bande del tenant con la trasformazione minimo->massimo');

  // Seed Beta: "Conteggio fino a 20", NUM-1 = 2 per uno studente e 4 per l'altro.
  const nucleiValutati = progressi.map((p) => p.nuclei.find((n) => n.risultatoCorrente.percentuale !== null));
  const [basso, alto] = nucleiValutati.sort((a, b) => a.risultatoCorrente.percentuale - b.risultatoCorrente.percentuale);
  assert.deepEqual([basso.risultatoCorrente.percentuale, basso.risultatoCorrente.giudizio, basso.radar.posizioneRadar], [50, 'INSUFFICIENTE', 33.33],
    'valore 2 su scala 1-4: 50% per il giudizio (soglie di Beta), 33,33 solo come posizione grafica');
  assert.deepEqual([alto.risultatoCorrente.percentuale, alto.risultatoCorrente.giudizio, alto.radar.posizioneRadar], [100, 'ECCELLENTE', 100]);
  const criterio = basso.criteri.find((c) => c.osservazioni.length > 0);
  assert.deepEqual([criterio.osservazioni[0].valore, criterio.osservazioni[0].etichetta], [2, 'Base'], 'etichette della scala di Beta');
});

test('Report studente v2.7: osservazione registrata con una scala non compatibile -> segnalata e non conteggiata', async () => {
  const { sessione, teaching2A, studenti } = await contestoProgressoAlfa2A();
  const s2 = studenti.find((s) => s.nome === 'A-Student-02');
  const unita = (await sessione.get(`/teachings/${teaching2A}/pedagogical-units`)).corpo.find((u) => u.nome === 'Numeri');
  const { activityId, criterionId } = await registraOsservazione(sessione, teaching2A, {
    nome: 'F2 scala', data: '2026-12-01', unita, codice: 'NUM-3', enrollmentId: s2.enrollment_id, valore: 2,
  });
  const leggi = async () => criterioDi((await sessione.get(`/teachings/${teaching2A}/students/${s2.enrollment_id}/progress`)).corpo, 'Numeri', 'NUM-3');
  assert.deepEqual([(await leggi()).risultatoCorrente.percentuale, (await leggi()).livelloCopertura], [100, 1]);

  // Una seconda scala dello stesso tenant, legata a un livello scolastico diverso da quello della classe.
  const alfa = (await pool.query("SELECT id FROM tenants WHERE slug = 'alfa'")).rows[0].id;
  const livello = (await pool.query(
    "INSERT INTO school_levels (tenant_id, nome, ordine) VALUES ($1, 'Livello scala test', 90) RETURNING id", [alfa]
  )).rows[0].id;
  const altraScala = (await pool.query(
    "INSERT INTO observation_scales (tenant_id, school_level_id, nome) VALUES ($1, $2, 'Scala test 1-5') RETURNING id", [alfa, livello]
  )).rows[0].id;
  await pool.query(
    "INSERT INTO observation_scale_values (scale_id, valore, etichetta, ordine) VALUES ($1, 2, 'Due su cinque', 1), ($1, 5, 'Cinque', 2)", [altraScala]
  );
  const scalaOriginale = (await pool.query('SELECT scale_id FROM observations WHERE activity_id = $1', [activityId])).rows[0].scale_id;
  await pool.query('UPDATE observations SET scale_id = $1 WHERE activity_id = $2', [altraScala, activityId]);
  try {
    const num3 = await leggi();
    assert.deepEqual([num3.risultatoCorrente.percentuale, num3.livelloCopertura], [null, 0], 'non conteggiata: il criterio torna non valutato');
    assert.equal(num3.osservazioni.length, 1);
    assert.deepEqual([num3.osservazioni[0].conteggiata, num3.osservazioni[0].motivoEsclusione], [false, 'scala_non_compatibile']);
  } finally {
    await pool.query('UPDATE observations SET scale_id = $1 WHERE activity_id = $2', [scalaOriginale, activityId]);
  }
  assert.equal((await leggi()).risultatoCorrente.percentuale, 100);
  assert.ok(criterionId);
});

test('Report studente v2.7: autorizzazione (docente, altro Teaching, altro tenant, co-docenza, parametri non validi)', async () => {
  const { sessione, teaching2A, studenti } = await contestoProgressoAlfa2A();
  const s1 = studenti.find((s) => s.nome === 'A-Student-01');
  assert.equal((await sessione.get(`/teachings/${teaching2A}/students/${s1.enrollment_id}/progress`)).status, 200);

  // Docente di Italiano: l'accesso dipende SOLO dai suoi RoleAssignment reali. Un test precedente gli assegna
  // il ruolo TEACHER su UNO dei Teaching di Matematica: lì è consentito, sull'altro (nessun ruolo) è negato.
  const sessioneItaliano = await loginESwitch('teacher.italian.a@alfa.test', 'alfa');
  const matematica = (await sessione.get('/teachings')).corpo;
  const { rows: assegnati } = await pool.query(
    `SELECT r.scope_teaching_id FROM role_assignments r JOIN accounts a ON a.id = r.account_id
     WHERE a.email = 'teacher.italian.a@alfa.test' AND r.scope_type = 'TEACHING' AND r.revoked_at IS NULL`
  );
  const conRuolo = new Set(assegnati.map((r) => String(r.scope_teaching_id)));
  const senzaRuolo = matematica.filter((t) => !conRuolo.has(String(t.teaching_id)));
  assert.ok(senzaRuolo.length >= 1, 'almeno un Teaching di Matematica su cui il docente di Italiano non ha alcun ruolo');
  for (const t of matematica) {
    const iscritto = (await sessione.get(`/teachings/${t.teaching_id}/students`)).corpo[0];
    const r = await sessioneItaliano.get(`/teachings/${t.teaching_id}/students/${iscritto.enrollment_id}/progress`);
    assert.equal(r.status, conRuolo.has(String(t.teaching_id)) ? 200 : 403, `Teaching ${t.classe}`);
  }
  // Sul proprio Teaching vede solo le osservazioni di Italiano, non quelle di Matematica.
  const teachingItaliano = (await sessioneItaliano.get('/teachings')).corpo[0].teaching_id;
  const italiano = await sessioneItaliano.get(`/teachings/${teachingItaliano}/students/${s1.enrollment_id}/progress`);
  assert.equal(italiano.status, 200);
  assert.deepEqual(italiano.corpo.nuclei.map((n) => n.nome), ['Lettura e comprensione']);
  assert.ok(!JSON.stringify(italiano.corpo).includes('NUM-1'));

  // Altro tenant: il Teaching di Alfa non esiste nel contesto Beta, per nessun account.
  for (const email of ['teacher.math.b@beta.test', 'multitenant.user@example.test', 'tenant.admin.b@beta.test']) {
    const sessioneBeta = await loginESwitch(email, 'beta');
    assert.equal((await sessioneBeta.get(`/teachings/${teaching2A}/students/${s1.enrollment_id}/progress`)).status, 404, email);
  }
  // Senza sessione: 401.
  assert.equal((await new SessioneHttp().get(`/teachings/${teaching2A}/students/${s1.enrollment_id}/progress`)).status, 401);
  // Parametri non validi: 400.
  assert.equal((await sessione.get(`/teachings/abc/students/${s1.enrollment_id}/progress`)).status, 400);
  assert.equal((await sessione.get(`/teachings/${teaching2A}/students/abc/progress`)).status, 400);

  // Co-docenza su Matematica 2B: due Teaching distinti, ciascuno con le sole proprie osservazioni.
  const teachings = (await sessione.get('/teachings')).corpo;
  const teaching2B = teachings.find((t) => t.classe === '2B').teaching_id;
  const sessioneCo = await loginESwitch('multitenant.user@example.test', 'alfa');
  const teachingCo = (await sessioneCo.get('/teachings')).corpo[0].teaching_id;
  assert.notEqual(teachingCo, teaching2B);
  const s3 = (await sessione.get(`/teachings/${teaching2B}/students`)).corpo.find((s) => s.nome === 'A-Student-03');
  const titolare = await sessione.get(`/teachings/${teaching2B}/students/${s3.enrollment_id}/progress`);
  assert.equal(criterioDi(titolare.corpo, 'Numeri', 'NUM-1').osservazioni.length, 1, 'seed: una osservazione del titolare');
  const coDocente = await sessioneCo.get(`/teachings/${teachingCo}/students/${s3.enrollment_id}/progress`);
  assert.equal(coDocente.status, 200);
  assert.equal(criterioDi(coDocente.corpo, 'Numeri', 'NUM-1').osservazioni.length, 0, "le osservazioni dell'altro Teaching non vengono aggregate");
  assert.equal(coDocente.corpo.complessivo.percentuale, null);
  // Il co-docente non può leggere attraverso il Teaching del collega, e viceversa.
  assert.equal((await sessioneCo.get(`/teachings/${teaching2B}/students/${s3.enrollment_id}/progress`)).status, 403);
  assert.equal((await sessione.get(`/teachings/${teachingCo}/students/${s3.enrollment_id}/progress`)).status, 403);
});

test('Report studente v2.7: Coordinatore — consentito nel proprio livello scolastico, negato fuori scope', async () => {
  const { teaching2A, studenti } = await contestoProgressoAlfa2A();
  const s1 = studenti.find((s) => s.nome === 'A-Student-01');
  const coordinatore = await loginESwitch('coordinator.a@alfa.test', 'alfa');
  const consentito = await coordinatore.get(`/teachings/${teaching2A}/students/${s1.enrollment_id}/progress`);
  assert.equal(consentito.status, 200, 'scope SCHOOL_LEVEL = Primaria, la 2A è una classe della Primaria');
  assert.equal(consentito.corpo.alunno.nome, 'A-Student-01');

  // Un Teaching dello stesso tenant ma di un ALTRO livello scolastico: fuori dallo scope del Coordinatore.
  const alfa = (await pool.query("SELECT id FROM tenants WHERE slug = 'alfa'")).rows[0].id;
  const anno = (await pool.query("SELECT id FROM school_years WHERE tenant_id = $1 AND nome = '2026/2027'", [alfa])).rows[0].id;
  const docente = (await pool.query("SELECT id FROM accounts WHERE email = 'teacher.math.a@alfa.test'")).rows[0].id;
  const livello = (await pool.query(
    "INSERT INTO school_levels (tenant_id, nome, ordine) VALUES ($1, 'Secondaria (test scope)', 91) RETURNING id", [alfa]
  )).rows[0].id;
  const classe = (await pool.query(
    "INSERT INTO classes (tenant_id, school_level_id, nome) VALUES ($1, $2, '1S') RETURNING id", [alfa, livello]
  )).rows[0].id;
  const materia = (await pool.query(
    "INSERT INTO subjects (tenant_id, school_level_id, school_year_id, nome, ordine) VALUES ($1, $2, $3, 'Matematica secondaria', 1) RETURNING id",
    [alfa, livello, anno]
  )).rows[0].id;
  const teachingFuori = (await pool.query(
    'INSERT INTO teachings (tenant_id, school_year_id, class_id, subject_id, account_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [alfa, anno, classe, materia, docente]
  )).rows[0].id;
  const negato = await coordinatore.get(`/teachings/${teachingFuori}/students/${s1.enrollment_id}/progress`);
  assert.equal(negato.status, 403, 'il livello del Teaching non è quello dello scope del Coordinatore');

  // Il Tenant Admin (scope TENANT) può leggere entrambi; l'iscrizione però deve appartenere alla classe del Teaching.
  const admin = await loginESwitch('tenant.admin.a@alfa.test', 'alfa');
  assert.equal((await admin.get(`/teachings/${teaching2A}/students/${s1.enrollment_id}/progress`)).status, 200);
  assert.equal((await admin.get(`/teachings/${teachingFuori}/students/${s1.enrollment_id}/progress`)).status, 404,
    "A-Student-01 non è iscritto alla classe di quel Teaching");
});

test('Coerenza del giudizio: report attività e report studente applicano la stessa regola di soglia sul caso limite (49,99999999999999 = 50)', async () => {
  const { sessione, teaching2A, studenti } = await contestoProgressoAlfa2A();
  const [s1, s2] = ['A-Student-01', 'A-Student-02'].map((nome) => studenti.find((s) => s.nome === nome));
  // Terzo iscritto alla 2A, solo per questo test: con tre studenti i criteri possono valere 100%, 33,33% e 16,67%.
  const alfa = (await pool.query("SELECT id FROM tenants WHERE slug = 'alfa'")).rows[0].id;
  const classe = (await pool.query('SELECT class_id, school_year_id FROM teachings WHERE id = $1', [teaching2A])).rows[0];
  const persona = (await pool.query(
    "INSERT INTO people (tenant_id, nome, cognome) VALUES ($1, 'A-Student-Terzo', 'Alfa') RETURNING id", [alfa]
  )).rows[0].id;
  const terzo = (await pool.query(
    'INSERT INTO enrollments (tenant_id, school_year_id, class_id, student_person_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [alfa, classe.school_year_id, classe.class_id, persona]
  )).rows[0].id;
  try {
    const unita = (await sessione.get(`/teachings/${teaching2A}/pedagogical-units`)).corpo.find((u) => u.nome === 'Numeri');
    const attivita = await sessione.post(`/teachings/${teaching2A}/activities`, { nome: 'Caso limite soglia', dataAttivita: '2026-12-15', pedagogicalUnitId: unita.id });
    const activityId = attivita.corpo.activity_id;
    const criteri = (await sessione.get(`/activities/${activityId}/griglia`)).corpo.criteri;
    const id = (codice) => criteri.find((c) => c.codice === codice).id;
    // NUM-1: 2/2 = 100% · NUM-2: 2/6 = 33,33% · NUM-3: 1/6 = 16,67% -> media dei criteri = 50% esatto.
    const valori = [
      [s1.enrollment_id, 'NUM-1', 2],
      [s1.enrollment_id, 'NUM-2', 1], [s2.enrollment_id, 'NUM-2', 1], [terzo, 'NUM-2', 0],
      [s1.enrollment_id, 'NUM-3', 1], [s2.enrollment_id, 'NUM-3', 0], [terzo, 'NUM-3', 0],
    ];
    for (const [enrollmentId, codice, valore] of valori) {
      const w = await sessione.put(`/activities/${activityId}/enrollments/${enrollmentId}/criteria/${id(codice)}`, { valore });
      assert.equal(w.status, 200);
    }
    const report = (await sessione.get(`/activities/${activityId}/report-classe`)).corpo;
    assert.deepEqual(report.unitaPedagogiche[0].criteri.slice(0, 3).map((c) => c.esito.percentuale), [100, 33.33, 16.67]);
    assert.equal(report.complessivo.percentuale, 50);
    assert.equal(report.complessivo.giudizio, 'SUFFICIENTE', 'soglia 50 raggiunta: senza tolleranza sarebbe NON SUFFICIENTE');

    // Lo stesso valore, passato al motore dei report pedagogici con le bande reali del tenant, dà lo stesso giudizio.
    const bande = motoreProgresso.preparaBande(
      (await pool.query('SELECT soglia_minima, etichetta FROM judgment_bands WHERE tenant_id = $1 AND school_level_id IS NULL', [alfa])).rows
    );
    const esattaDelReport = (100 + (2 / 6) * 100 + (1 / 6) * 100) / 3;
    assert.equal(esattaDelReport, 49.99999999999999);
    assert.equal(motoreProgresso.giudizioDi(esattaDelReport, bande).giudizio, report.complessivo.giudizio);
  } finally {
    await pool.query('UPDATE enrollments SET attiva = false WHERE id = $1', [terzo]);
  }
});
