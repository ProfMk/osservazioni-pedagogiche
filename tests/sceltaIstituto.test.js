'use strict';

/**
 * Iterazione 1, passo 6 — scelta dell'istituto dopo l'accesso.
 *
 * Un account che non è PLATFORM_ADMIN e ha esattamente una Membership attiva in un
 * tenant attivo entra direttamente nella sua scuola (tenant attivo impostato dal
 * login); con più scuole, nessuna, o per un PLATFORM_ADMIN, il tenant resta da
 * scegliere. /me porta, per ogni scuola disponibile, i ruoli dell'utente.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

require('./support/pglite').installa();
const { pool, transazione } = require('../server/db');
const { avviaServer, login, PASSWORD_SVILUPPO } = require('./support/http');
const { hashPassword, generaPasswordTemporanea } = require('../server/lib/password');

let srv;
test.before(async () => { srv = await avviaServer(); });
test.after(async () => {
  await srv.chiudi();
  await pool.end();
});

const idTenant = async (slug) => (await pool.query('SELECT id FROM tenants WHERE slug = $1', [slug])).rows[0].id;
const erroreDi = (r) => [r.status, r.corpo && r.corpo.errore];
const CAMBIO_RICHIESTO = [403, { codice: 'ERR_PASSWORD_CHANGE_REQUIRED', parametri: {} }];

/** Account di prova con la password di sviluppo (o una temporanea) e le Membership indicate. */
async function account(email, membership = [], { temporanea = false } = {}) {
  const password = temporanea ? generaPasswordTemporanea() : PASSWORD_SVILUPPO;
  const { rows: persona } = await pool.query("INSERT INTO people (nome, cognome) VALUES ('Prova', 'Istituto') RETURNING id");
  const { rows } = await pool.query(
    `INSERT INTO accounts (email, password_hash, person_id, deve_cambiare_password, password_temporanea_scade_il)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN now() + interval '7 days' END) RETURNING id`,
    [email, await hashPassword(password), persona[0].id, temporanea]
  );
  for (const [tenantId, stato] of membership) {
    await pool.query('INSERT INTO memberships (account_id, tenant_id, stato) VALUES ($1, $2, $3)', [rows[0].id, tenantId, stato]);
  }
  return { id: rows[0].id, email, password };
}

test('Una sola scuola: il login imposta il tenant attivo; le API del dominio rispondono senza switch-tenant', async () => {
  const alfa = await idTenant('alfa');
  const { sessione, risposta } = await login(srv.base, 'teacher.math.a@alfa.test');
  assert.equal(risposta.status, 200);
  assert.equal(risposta.corpo.activeTenantId, alfa);
  assert.ok(risposta.corpo.permessiNelTenantAttivo.includes('observation.create'), 'permessi già calcolati nel tenant');
  const teachings = await sessione.get('/teachings');
  assert.equal(teachings.status, 200);
  assert.ok(teachings.corpo.length > 0);
  assert.equal((await sessione.get('/auth/me')).corpo.activeTenantId, alfa);
  const { rows } = await pool.query(
    'SELECT active_tenant_id FROM sessions WHERE account_id = (SELECT id FROM accounts WHERE email = $1) ORDER BY id DESC LIMIT 1',
    ['teacher.math.a@alfa.test']
  );
  assert.equal(rows[0].active_tenant_id, alfa, 'salvato nella sessione, non solo nella risposta');
});

test('Una sola scuola con cambio password obbligatorio: tenant attivo dal login, API bloccate fino al cambio, poi accessibili', async () => {
  const alfa = await idTenant('alfa');
  const a = await account('scelta.temporanea@alfa.test', [[alfa, 'attiva']], { temporanea: true });
  const { sessione, risposta } = await login(srv.base, a.email, a.password);
  assert.deepEqual([risposta.corpo.activeTenantId, risposta.corpo.deveCambiarePassword], [alfa, true]);
  assert.deepEqual(erroreDi(await sessione.get('/teachings')), CAMBIO_RICHIESTO);
  const cambio = await sessione.post('/auth/password', { passwordAttuale: a.password, passwordNuova: 'una frase lunga e nuova' });
  assert.deepEqual([cambio.status, cambio.corpo.activeTenantId, cambio.corpo.deveCambiarePassword], [200, alfa, false]);
  assert.deepEqual([(await sessione.get('/teachings')).status], [200], 'nessuno switch-tenant necessario');
});

test('Due scuole (multitenant.user): nessun tenant attivo, lingua di piattaforma (P3); switch-tenant come prima', async () => {
  const { sessione, risposta } = await login(srv.base, 'multitenant.user@example.test');
  assert.equal(risposta.corpo.activeTenantId, null);
  assert.deepEqual([risposta.corpo.lingua.codice, risposta.corpo.lingua.lingueAbilitate], ['it', []], 'prima del tenant: P3');
  assert.deepEqual(erroreDi(await sessione.get('/teachings')), [403, { codice: 'ERR_TENANT_NOT_SELECTED', parametri: {} }]);
  for (const slug of ['beta', 'alfa']) {
    const r = await sessione.post('/auth/switch-tenant', { tenantId: await idTenant(slug) });
    assert.deepEqual([r.status, r.corpo.activeTenantId], [200, await idTenant(slug)]);
  }
});

test('PLATFORM_ADMIN: nessun tenant attivo; tra le scuole disponibili solo quelle attive', async () => {
  const sospeso = await transazione(async (client) => {
    const { rows } = await client.query(
      "INSERT INTO tenants (slug, nome, stato, lingua_predefinita, lingua_contenuti, regione) VALUES ('sospeso', 'Istituto Sospeso', 'sospeso', 'it', 'it', 'IT') RETURNING id"
    );
    await client.query("INSERT INTO tenant_languages (tenant_id, lingua) VALUES ($1, 'it')", [rows[0].id]);
    return rows[0].id;
  });
  const { risposta } = await login(srv.base, 'platform.admin@platform.test');
  assert.equal(risposta.corpo.activeTenantId, null);
  const slugs = risposta.corpo.tenantsDisponibiliPerSwitch.map((t) => t.slug);
  assert.ok(slugs.includes('alfa') && slugs.includes('beta'));
  assert.ok(!slugs.includes('sospeso'), 'un tenant sospeso non si può attivare, quindi non è proposto');
  assert.ok(risposta.corpo.tenantsDisponibiliPerSwitch.every((t) => t.stato === 'attivo' && Array.isArray(t.ruoli)));

  // Account con la sola Membership in quel tenant sospeso: nessuna selezione automatica.
  const inSospeso = await account('solo.sospeso@example.test', [[sospeso, 'attiva']]);
  const r = await login(srv.base, inSospeso.email);
  assert.deepEqual([r.risposta.status, r.risposta.corpo.activeTenantId, r.risposta.corpo.tenantsDisponibiliPerSwitch], [200, null, []]);
});

test('Membership sospesa: nessuna selezione automatica; con una attiva e una sospesa si entra in quella attiva', async () => {
  const alfa = await idTenant('alfa');
  const beta = await idTenant('beta');
  const sospesa = await account('membership.sospesa@alfa.test', [[alfa, 'sospesa']]);
  const r1 = await login(srv.base, sospesa.email);
  assert.deepEqual([r1.risposta.corpo.activeTenantId, r1.risposta.corpo.tenantsDisponibiliPerSwitch], [null, []]);

  const mista = await account('membership.mista@alfa.test', [[alfa, 'sospesa'], [beta, 'attiva']]);
  const r2 = await login(srv.base, mista.email);
  assert.equal(r2.risposta.corpo.activeTenantId, beta, 'una sola scuola disponibile');
});

test('Nessuna scuola: nessun tenant attivo, elenco vuoto, il dominio chiede un tenant', async () => {
  const senza = await account('nessuna.scuola@example.test');
  const { sessione, risposta } = await login(srv.base, senza.email);
  assert.deepEqual([risposta.status, risposta.corpo.activeTenantId, risposta.corpo.memberships, risposta.corpo.tenantsDisponibiliPerSwitch], [200, null, [], []]);
  assert.deepEqual(erroreDi(await sessione.get('/teachings')), [403, { codice: 'ERR_TENANT_NOT_SELECTED', parametri: {} }]);
});

test('/me: per ogni scuola disponibile, i ruoli dell\'utente in quella scuola', async () => {
  const ruoli = (elenco) => Object.fromEntries(elenco.map((t) => [t.slug, t.ruoli]));
  const multi = (await login(srv.base, 'multitenant.user@example.test')).sessione;
  const me = (await multi.get('/auth/me')).corpo;
  assert.deepEqual(ruoli(me.tenantsDisponibiliPerSwitch), { alfa: ['TEACHER'], beta: ['COORDINATOR'] });
  assert.deepEqual(ruoli(me.memberships), { alfa: ['TEACHER'], beta: ['COORDINATOR'] });
  assert.deepEqual(ruoli((await login(srv.base, 'tenant.admin.a@alfa.test')).risposta.corpo.tenantsDisponibiliPerSwitch), { alfa: ['TENANT_ADMIN'] });
  assert.deepEqual(ruoli((await login(srv.base, 'coordinator.a@alfa.test')).risposta.corpo.tenantsDisponibiliPerSwitch), { alfa: ['COORDINATOR'] });
  // PLATFORM_ADMIN: nessun ruolo legato a una scuola (il suo è di piattaforma).
  const piattaforma = (await login(srv.base, 'platform.admin@platform.test')).risposta.corpo;
  assert.ok(piattaforma.tenantsDisponibiliPerSwitch.every((t) => t.ruoli.length === 0));
});

test('La selezione automatica avviene solo al login: /me non cambia il tenant scelto', async () => {
  const { sessione } = await login(srv.base, 'multitenant.user@example.test');
  await sessione.post('/auth/switch-tenant', { tenantId: await idTenant('beta') });
  assert.equal((await sessione.get('/auth/me')).corpo.activeTenantId, await idTenant('beta'));
});
