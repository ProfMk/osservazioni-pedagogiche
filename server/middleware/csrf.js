'use strict';

/** Verifica il token CSRF su ogni mutazione (sez. 14). Va dopo autenticazione (serve req.sessione). */
const { tokenCsrfValido } = require('../lib/csrf');
const { vietato } = require('../lib/erroreApplicativo');

const METODI_MUTANTI = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function richiedeCsrf(req, res, next) {
  if (!METODI_MUTANTI.has(req.method)) return next();
  const token = req.header('X-CSRF-Token');
  if (!req.sessione || !tokenCsrfValido(req.sessione.id, token)) {
    return next(vietato('Token CSRF mancante o non valido.'));
  }
  next();
}

module.exports = { richiedeCsrf };
