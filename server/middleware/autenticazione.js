'use strict';

/**
 * Identifica l'account a partire dal cookie di sessione (sez. 10-12). Il
 * cookie contiene SOLO il token opaco; la sessione viene cercata tramite il
 * suo hash (server/lib/sessioni.js). Nessun bearer token, nessun
 * localStorage: l'unico canale è il cookie HttpOnly.
 */
const cookie = require('cookie');
const { pool } = require('../db');
const { trovaSessioneValida } = require('../lib/sessioni');
const { nonAutenticato } = require('../lib/erroreApplicativo');

const NOME_COOKIE = 'session_token';

function leggiTokenDalCookie(req) {
  const intestazione = req.headers.cookie;
  if (!intestazione) return null;
  const analizzati = cookie.parse(intestazione);
  return analizzati[NOME_COOKIE] || null;
}

async function autenticazione(req, res, next) {
  try {
    const token = leggiTokenDalCookie(req);
    const sessione = await trovaSessioneValida(pool, token);
    if (!sessione) {
      throw nonAutenticato("Sessione mancante, scaduta o revocata. Effettuare di nuovo l'accesso.");
    }
    req.sessione = sessione;
    req.accountId = sessione.account_id;
    next();
  } catch (errore) {
    next(errore);
  }
}

module.exports = { autenticazione, leggiTokenDalCookie, NOME_COOKIE };
