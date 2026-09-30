'use strict';

/**
 * Sessioni server-side (sez. 10/11). Il browser riceve solo un token opaco
 * casuale (32 byte, 256 bit di entropia, sez. 11); nel database si salva
 * SOLO il suo hash SHA-256 (colonna token_hash): il lookup avviene sempre
 * tramite l'hash, mai confrontando il token in chiaro con quanto salvato.
 */
const crypto = require('crypto');

const MINUTI_IDLE_TIMEOUT = Number.parseInt(process.env.SESSION_IDLE_TIMEOUT_MINUTES, 10) || 30;
const ORE_ABSOLUTE_TIMEOUT = Number.parseInt(process.env.SESSION_ABSOLUTE_TIMEOUT_HOURS, 10) || 12;

/** Token opaco casuale ad alta entropia (256 bit), URL/cookie-safe. */
function generaToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Hash del token per il lookup/salvataggio nel database: mai il token in chiaro. */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Crea una nuova sessione per l'account autenticato con successo.
 * Nessun activeTenantId iniziale (sez. 8): va selezionato esplicitamente,
 * anche se l'account ha una sola Membership.
 */
async function creaSessione(client, { accountId, userAgent, ip }) {
  const token = generaToken();
  const scade = new Date(Date.now() + ORE_ABSOLUTE_TIMEOUT * 3600 * 1000);
  const { rows } = await client.query(
    `INSERT INTO sessions (account_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, account_id, active_tenant_id, expires_at`,
    [accountId, hashToken(token), scade, userAgent || null, ip || null]
  );
  return { token, sessione: rows[0] };
}

/**
 * Cerca una sessione valida a partire dal token in chiaro ricevuto dal
 * cookie. Applica sia il timeout assoluto (expires_at) sia quello di
 * inattività (last_seen_at + idle timeout): una sessione scaduta per
 * inattività viene qui anche revocata esplicitamente (non solo ignorata),
 * così un'eventuale query diretta su sessions la trova coerentemente chiusa.
 * Se valida, aggiorna last_seen_at (touch).
 */
async function trovaSessioneValida(client, token) {
  if (!token) return null;
  const { rows } = await client.query(
    `SELECT id, account_id, active_tenant_id, created_at, last_seen_at, expires_at, revoked_at
     FROM sessions WHERE token_hash = $1`,
    [hashToken(token)]
  );
  const sessione = rows[0];
  if (!sessione) return null;
  if (sessione.revoked_at) return null;
  const ora = Date.now();
  if (new Date(sessione.expires_at).getTime() <= ora) return null;
  const scadutaPerInattivita = new Date(sessione.last_seen_at).getTime() + MINUTI_IDLE_TIMEOUT * 60 * 1000 <= ora;
  if (scadutaPerInattivita) {
    await revocaSessione(client, sessione.id, 'idle_timeout');
    return null;
  }
  await client.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [sessione.id]);
  return sessione;
}

/** Imposta il tenant attivo della sessione. La validità della Membership è verificata dal chiamante. */
async function impostaTenantAttivo(client, sessioneId, tenantId) {
  await client.query('UPDATE sessions SET active_tenant_id = $1 WHERE id = $2', [tenantId, sessioneId]);
}

/** Revoca una singola sessione (logout). */
async function revocaSessione(client, sessioneId, motivo = 'logout') {
  await client.query(
    'UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL',
    [sessioneId, motivo]
  );
}

/** Invalidazione globale (sez. 11): tutte le sessioni di un account, es. dopo cambio password. */
async function revocaTutteLeSessioni(client, accountId, motivo = 'invalidazione_globale') {
  await client.query(
    'UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE account_id = $1 AND revoked_at IS NULL',
    [accountId, motivo]
  );
}

/**
 * Rotazione del token (sez. 11): stessa riga di sessione, nuovo token
 * opaco. Usata subito dopo il login per prevenire session fixation.
 */
async function ruotaToken(client, sessioneId) {
  const token = generaToken();
  await client.query('UPDATE sessions SET token_hash = $1 WHERE id = $2', [hashToken(token), sessioneId]);
  return token;
}

module.exports = {
  MINUTI_IDLE_TIMEOUT,
  ORE_ABSOLUTE_TIMEOUT,
  generaToken,
  hashToken,
  creaSessione,
  trovaSessioneValida,
  impostaTenantAttivo,
  revocaSessione,
  revocaTutteLeSessioni,
  ruotaToken,
};
