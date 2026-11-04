'use strict';

/** Account/Person/Membership (sez. 6): identità e appartenenze ai tenant. */

const { datiNonValidi } = require('../lib/erroreApplicativo');

/** Email normalizzata (minuscole, senza spazi ai lati): forma unica salvata e cercata. */
function normalizzaEmail(email) {
  return String(email === undefined || email === null ? '' : email).trim().toLowerCase();
}

// Controllo volutamente minimo (un solo @, niente spazi, un punto nel dominio):
// la verifica vera è che la persona riceva e usi le credenziali.
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email normalizzata e valida, altrimenti 400 ERR_EMAIL_INVALID. */
function emailValida(email) {
  const normalizzata = normalizzaEmail(email);
  if (!FORMATO_EMAIL.test(normalizzata) || normalizzata.length > 255) throw datiNonValidi('ERR_EMAIL_INVALID');
  return normalizzata;
}

/**
 * Account per email, senza distinzione di maiuscole (indice univoco su
 * lower(email), migration 005). `email` deve essere già normalizzata.
 * Contiene password_hash: solo per la verifica delle credenziali, mai da
 * restituire al client né da scrivere nell'audit.
 */
async function trovaAccountPerEmail(client, email) {
  const { rows } = await client.query(
    `SELECT a.id, a.email, a.password_hash, a.stato, a.person_id, a.deve_cambiare_password,
            a.password_temporanea_scade_il, p.nome, p.cognome
     FROM accounts a JOIN people p ON p.id = a.person_id
     WHERE lower(a.email) = $1`,
    [email]
  );
  return rows[0] || null;
}

async function getAccountById(client, accountId) {
  const { rows } = await client.query(
    `SELECT a.id, a.email, a.stato, a.deve_cambiare_password, p.nome, p.cognome
     FROM accounts a JOIN people p ON p.id = a.person_id
     WHERE a.id = $1`,
    [accountId]
  );
  return rows[0] || null;
}

/** true se l'account deve cambiare la password prima di usare le API (migration 005). */
async function deveCambiarePassword(client, accountId) {
  const { rows } = await client.query('SELECT deve_cambiare_password FROM accounts WHERE id = $1', [accountId]);
  return rows.length > 0 && rows[0].deve_cambiare_password === true;
}

/** Account con l'hash della password, bloccato fino alla fine della transazione (cambio password). */
async function getCredenzialiPerAggiornamento(client, accountId) {
  const { rows } = await client.query(
    `SELECT id, password_hash, stato, deve_cambiare_password, password_temporanea_scade_il
     FROM accounts WHERE id = $1 FOR UPDATE`,
    [accountId]
  );
  return rows[0] || null;
}

/** Password scelta dall'utente: fine dell'obbligo di cambio e della password temporanea. */
async function aggiornaPassword(client, accountId, passwordHash) {
  await client.query(
    `UPDATE accounts
     SET password_hash = $2, password_changed_at = now(), deve_cambiare_password = false, password_temporanea_scade_il = NULL
     WHERE id = $1`,
    [accountId, passwordHash]
  );
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

module.exports = {
  normalizzaEmail,
  emailValida,
  trovaAccountPerEmail,
  getAccountById,
  deveCambiarePassword,
  getCredenzialiPerAggiornamento,
  aggiornaPassword,
  getMembershipsDiAccount,
  haMembershipAttiva,
};
