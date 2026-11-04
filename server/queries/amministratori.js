'use strict';

/**
 * Amministratori di istituto creati dalla piattaforma (iterazione 1).
 *
 * Il PLATFORM_ADMIN crea una scuola e il suo primo TENANT_ADMIN nella STESSA
 * transazione del tenant (server/routes/tenant.js): persona, account,
 * membership, ruolo e le rispettive righe di audit. Se qualcosa fallisce non
 * resta nulla.
 *
 * Credenziali: password temporanea generata dal sistema (server/lib/password.js),
 * restituita UNA sola volta al chiamante, mai salvata in chiaro, mai nell'audit
 * (né lei né il suo hash). Cambio obbligatorio al primo accesso.
 */
const { conflitto, datiNonValidi, nonTrovato } = require('../lib/erroreApplicativo');
const { hashPassword, generaPasswordTemporanea, scadenzaPasswordTemporanea } = require('../lib/password');
const { registraAudit } = require('../lib/audit');
const { revocaTutteLeSessioni } = require('../lib/sessioni');
const { creaRoleAssignment } = require('./rbac');
const { emailValida } = require('./account');

const LUNGHEZZA_NOME_PERSONA = 100; // people.nome / people.cognome varchar(100)

function testoObbligatorio(valore, campo, massimo) {
  const testo = typeof valore === 'string' ? valore.trim() : '';
  if (!testo) throw datiNonValidi('ERR_REQUIRED_FIELD', { campo });
  if (Array.from(testo).length > massimo) throw datiNonValidi('ERR_FIELD_TOO_LONG', { campo, massimo });
  return testo;
}

/** Dati dell'amministratore validati e normalizzati (email minuscola, senza spazi). */
function validaAmministratore(dati) {
  if (!dati || typeof dati !== 'object' || Array.isArray(dati)) throw datiNonValidi('ERR_INVALID_INPUT');
  return {
    nome: testoObbligatorio(dati.nome, 'UI_FIELD_ADMIN_NAME', LUNGHEZZA_NOME_PERSONA),
    cognome: testoObbligatorio(dati.cognome, 'UI_FIELD_ADMIN_SURNAME', LUNGHEZZA_NOME_PERSONA),
    email: emailValida(dati.email),
  };
}

async function accountPerEmailBloccato(client, email) {
  const { rows } = await client.query(
    `SELECT a.id, a.email, a.stato, p.nome, p.cognome
     FROM accounts a JOIN people p ON p.id = a.person_id
     WHERE lower(a.email) = $1 FOR UPDATE OF a`,
    [email]
  );
  return rows[0] || null;
}

/**
 * Primo TENANT_ADMIN di un tenant appena creato, nella transazione del chiamante.
 * Account già esistente (persona che lavora in più scuole): solo membership e
 * ruolo, password intatta e nessuna password restituita. Account disabilitato: 409.
 */
async function creaPrimoAmministratore(client, { actorAccountId, tenantId, amministratore }) {
  const { nome, cognome, email } = amministratore;
  let account = await accountPerEmailBloccato(client, email);
  let passwordTemporanea = null;
  let scadenza = null;

  if (account && account.stato !== 'attivo') throw conflitto('ERR_ACCOUNT_DISABLED');
  const accountEsistente = !!account;

  if (!accountEsistente) {
    passwordTemporanea = generaPasswordTemporanea();
    scadenza = scadenzaPasswordTemporanea();
    // Persona del personale: identità globale, senza tenant (come il personale dei seed).
    const { rows: persona } = await client.query(
      'INSERT INTO people (tenant_id, nome, cognome) VALUES (NULL, $1, $2) RETURNING id', [nome, cognome]
    );
    const { rows } = await client.query(
      `INSERT INTO accounts (email, password_hash, person_id, deve_cambiare_password, password_temporanea_scade_il)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id, email, stato, person_id, password_temporanea_scade_il`,
      [email, await hashPassword(passwordTemporanea), persona[0].id, scadenza]
    );
    account = { ...rows[0], nome, cognome };
    await registraAudit(client, {
      tenantId, actorAccountId, azione: 'account.create', risorsa: 'account', risorsaId: account.id,
      dopo: {
        id: account.id, email: account.email, stato: account.stato, personId: account.person_id, nome, cognome,
        deveCambiarePassword: true, passwordTemporaneaScadeIl: account.password_temporanea_scade_il,
      },
    });
  }

  const { rows: membership } = await client.query(
    'INSERT INTO memberships (account_id, tenant_id) VALUES ($1, $2) RETURNING id, account_id, tenant_id, stato',
    [account.id, tenantId]
  );
  await registraAudit(client, {
    tenantId, actorAccountId, azione: 'membership.create', risorsa: 'membership', risorsaId: membership[0].id,
    dopo: { id: membership[0].id, accountId: account.id, tenantId, stato: membership[0].stato },
  });

  // Stessa logica (e stessi controlli) di POST /api/role-assignments.
  const ruolo = { accountId: account.id, roleCodice: 'TENANT_ADMIN', scopeType: 'TENANT', tenantId, scopeIds: {} };
  const creato = await creaRoleAssignment(client, { creatoreAccountId: actorAccountId, ...ruolo });
  await registraAudit(client, {
    tenantId, actorAccountId, azione: 'role_assignment.create', risorsa: 'role_assignment', risorsaId: creato.id, dopo: ruolo,
  });

  const esito = {
    account: { id: account.id, email: account.email, nome: account.nome, cognome: account.cognome },
    accountEsistente,
  };
  if (!accountEsistente) {
    esito.passwordTemporanea = passwordTemporanea;
    esito.passwordTemporaneaScadeIl = scadenza;
  }
  return esito;
}

/** Amministratori di istituto (TENANT_ADMIN con scope TENANT, non revocati), per tenant. */
async function getAmministratoriPerTenant(client) {
  const { rows } = await client.query(
    `SELECT r.tenant_id, a.id AS account_id, a.email, a.stato, p.nome, p.cognome
     FROM role_assignments r
     JOIN roles ro ON ro.id = r.role_id AND ro.codice = 'TENANT_ADMIN'
     JOIN accounts a ON a.id = r.account_id
     JOIN people p ON p.id = a.person_id
     WHERE r.scope_type = 'TENANT' AND r.revoked_at IS NULL
     ORDER BY r.tenant_id, p.cognome, p.nome, a.id`
  );
  const perTenant = new Map();
  rows.forEach(({ tenant_id: tenantId, ...amministratore }) => {
    if (!perTenant.has(tenantId)) perTenant.set(tenantId, []);
    perTenant.get(tenantId).push(amministratore);
  });
  return perTenant;
}

/**
 * Nuova password temporanea per un TENANT_ADMIN del tenant indicato (decisione 10):
 * obbligo di cambio riattivato, tutte le sessioni dell'account revocate, audit
 * account.password_reset senza valori. Tenant inesistente o account che non ne è
 * amministratore: 404. Account disabilitato: 409.
 */
async function reimpostaPasswordAmministratore(client, { actorAccountId, tenantId, accountId }) {
  const { rows: tenant } = await client.query('SELECT id FROM tenants WHERE id = $1', [tenantId]);
  if (tenant.length === 0) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_TENANT' });
  const { rows } = await client.query(
    `SELECT a.id, a.email, a.stato, p.nome, p.cognome
     FROM accounts a JOIN people p ON p.id = a.person_id
     WHERE a.id = $1 AND EXISTS (
       SELECT 1 FROM role_assignments r JOIN roles ro ON ro.id = r.role_id
       WHERE r.account_id = a.id AND ro.codice = 'TENANT_ADMIN' AND r.scope_type = 'TENANT'
         AND r.tenant_id = $2 AND r.revoked_at IS NULL)
     FOR UPDATE OF a`,
    [accountId, tenantId]
  );
  const account = rows[0];
  if (!account) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_ACCOUNT' });
  if (account.stato !== 'attivo') throw conflitto('ERR_ACCOUNT_DISABLED');

  const passwordTemporanea = generaPasswordTemporanea();
  const scadenza = scadenzaPasswordTemporanea();
  await client.query(
    `UPDATE accounts SET password_hash = $2, deve_cambiare_password = true, password_temporanea_scade_il = $3 WHERE id = $1`,
    [account.id, await hashPassword(passwordTemporanea), scadenza]
  );
  await revocaTutteLeSessioni(client, account.id, 'reimpostazione_password');
  await registraAudit(client, {
    tenantId, actorAccountId, azione: 'account.password_reset', risorsa: 'account', risorsaId: account.id,
  });
  return {
    account: { id: account.id, email: account.email, nome: account.nome, cognome: account.cognome },
    passwordTemporanea,
    passwordTemporaneaScadeIl: scadenza,
  };
}

module.exports = {
  validaAmministratore, creaPrimoAmministratore, getAmministratoriPerTenant, reimpostaPasswordAmministratore,
};
