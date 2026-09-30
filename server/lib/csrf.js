'use strict';

/**
 * Protezione CSRF (sez. 14): l'autenticazione è cookie-based, quindi ogni
 * mutazione (POST/PUT/PATCH/DELETE) richiede un token CSRF derivato dalla
 * sessione, che un sito terzo non può conoscere (il cookie non è leggibile
 * da JavaScript di un'altra origine, ma verrebbe comunque inviato in
 * automatico dal browser: il token, inviato invece in un header esplicito
 * dal nostro frontend, è ciò che un attaccante non può riprodurre).
 */
const crypto = require('crypto');

const SEGRETO = process.env.SESSION_SECRET;
if (!SEGRETO) {
  // eslint-disable-next-line no-console
  console.error('Variabile d\'ambiente SESSION_SECRET non impostata. Impostarla prima di avviare il server.');
  process.exit(1);
}

/** csrfToken = HMAC-SHA256(serverSecret, sessionId), esadecimale. */
function generaTokenCsrf(sessioneId) {
  return crypto.createHmac('sha256', SEGRETO).update(String(sessioneId)).digest('hex');
}

/** Confronto a tempo costante: evita che il tempo di risposta riveli il token corretto. */
function tokenCsrfValido(sessioneId, tokenRicevuto) {
  if (!tokenRicevuto || typeof tokenRicevuto !== 'string') return false;
  const atteso = Buffer.from(generaTokenCsrf(sessioneId), 'hex');
  const ricevuto = Buffer.from(tokenRicevuto, 'hex');
  if (atteso.length !== ricevuto.length) return false;
  return crypto.timingSafeEqual(atteso, ricevuto);
}

module.exports = { generaTokenCsrf, tokenCsrfValido };
