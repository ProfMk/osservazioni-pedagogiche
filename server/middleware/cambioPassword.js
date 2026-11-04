'use strict';

/**
 * Cambio password obbligatorio (iterazione 1, decisione 2). Va dopo
 * autenticazione (serve req.accountId). Finché l'account ha
 * deve_cambiare_password = true (password temporanea), ogni API protetta da
 * questo middleware risponde 403 ERR_PASSWORD_CHANGE_REQUIRED.
 *
 * Restano raggiungibili SOLO, perché non lo montano: GET /api/auth/me,
 * POST /api/auth/password, POST /api/auth/logout e GET /api/i18n (vedi
 * server/routes/index.js e server/routes/auth.js). Il login resta possibile:
 * è ciò che permette di arrivare al cambio.
 */
const { pool } = require('../db');
const { deveCambiarePassword } = require('../queries/account');
const { vietato } = require('../lib/erroreApplicativo');

async function richiedePasswordAggiornata(req, res, next) {
  try {
    if (await deveCambiarePassword(pool, req.accountId)) throw vietato('ERR_PASSWORD_CHANGE_REQUIRED');
    next();
  } catch (errore) {
    next(errore);
  }
}

module.exports = { richiedePasswordAggiornata };
