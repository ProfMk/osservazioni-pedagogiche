'use strict';

/** Account/Person/Membership (sez. 6): identità e appartenenze ai tenant. */

async function trovaAccountPerEmail(client, email) {
  const { rows } = await client.query(
    `SELECT a.id, a.email, a.password_hash, a.stato, a.person_id, p.nome, p.cognome
     FROM accounts a JOIN people p ON p.id = a.person_id
     WHERE a.email = $1`,
    [email]
  );
  return rows[0] || null;
}

async function getAccountById(client, accountId) {
  const { rows } = await client.query(
    `SELECT a.id, a.email, a.stato, p.nome, p.cognome
     FROM accounts a JOIN people p ON p.id = a.person_id
     WHERE a.id = $1`,
    [accountId]
  );
  return rows[0] || null;
}

/** Membership ATTIVE di un account, coi dati del tenant: base per la scelta/switch del tenant attivo. */
async function getMembershipsDiAccount(client, accountId) {
  const { rows } = await client.query(
    `SELECT m.tenant_id, t.slug, t.nome, m.stato
     FROM memberships m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.account_id = $1 AND m.stato = 'attiva' AND t.stato = 'attivo'
     ORDER BY t.nome`,
    [accountId]
  );
  return rows;
}

/** true se esiste una Membership attiva dell'account in quel tenant (sez. 8: mai fidarsi del client). */
async function haMembershipAttiva(client, accountId, tenantId) {
  const { rows } = await client.query(
    "SELECT 1 FROM memberships WHERE account_id = $1 AND tenant_id = $2 AND stato = 'attiva'",
    [accountId, tenantId]
  );
  return rows.length > 0;
}

module.exports = { trovaAccountPerEmail, getAccountById, getMembershipsDiAccount, haMembershipAttiva };
