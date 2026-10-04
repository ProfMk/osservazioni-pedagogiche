'use strict';

/**
 * Pipeline delle API (sez. 14):
 *   Request -> Session -> Authentication -> CSRF -> Tenant context -> Authorization -> Resource validation -> Database
 *
 * /i18n è pubblico in sola lettura: catalogo nella lingua di piattaforma senza
 * sessione, catalogo C2 del tenant attivo con sessione (vedi routes/i18n.js).
 * /auth è pubblico (login) e gestisce da sé autenticazione/CSRF sulle
 * proprie rotte protette (logout, me, switch-tenant), perché login non può
 * richiedere una sessione che ancora non esiste.
 * /platform richiede autenticazione+CSRF ma NON un tenant attivo: le
 * operazioni di piattaforma (sez. 9) non sono delimitate da un tenant.
 * Tutto il resto (dominio operativo) richiede anche il contesto tenant.
 */
const express = require('express');
const { autenticazione } = require('../middleware/autenticazione');
const { richiedeCsrf } = require('../middleware/csrf');
const { contestoTenant } = require('../middleware/contestoTenant');
const { ErroreApplicativo } = require('../lib/erroreApplicativo');

const router = express.Router();

router.use('/i18n', require('./i18n'));
router.use('/auth', require('./auth'));
router.use('/platform', autenticazione, richiedeCsrf, require('./tenant'));
router.use('/', autenticazione, richiedeCsrf, contestoTenant, require('./dominio'));

// Gestore errori centrale: ErroreApplicativo -> stato HTTP + { codice, parametri };
// per qualunque altro errore, diagnosi in console (mai al client, sez. 68) e ERR_INTERNAL.
// eslint-disable-next-line no-unused-vars
router.use((errore, req, res, next) => {
  if (errore instanceof ErroreApplicativo) {
    return res.status(errore.stato).json({ errore: { codice: errore.codice, parametri: errore.parametri } });
  }

  // Traduzione dei codici PostgreSQL noti in codici semantici (mai frasi, V2 §17).
  // 23503 = foreign_key_violation (combinazione incoerente: cross-tenant, cross-anno, cross-classe, cross-materia).
  // 23505 = unique_violation (conflitto, es. due richieste concorrenti sulla stessa cella).
  // 23514 = check_violation.
  // 42501 = insufficient_privilege (app_role ha rifiutato un'operazione: mai atteso da codice corretto).
  const traduzioni = {
    23503: { stato: 400, codice: 'ERR_REFERENCES_INCONSISTENT' },
    23505: { stato: 409, codice: 'ERR_CONFLICT' },
    23514: { stato: 400, codice: 'ERR_VALUE_NOT_ALLOWED' },
    42501: { stato: 500, codice: 'ERR_DATABASE_PRIVILEGES' },
  };
  const nota = errore.code && traduzioni[errore.code];

  const diagnostica = errore.diagnosticaRichiesta || {};
  // eslint-disable-next-line no-console
  console.error('[errore]', JSON.stringify({
    metodo: req.method,
    endpoint: req.originalUrl,
    parametriPercorso: diagnostica.parametri,
    corpo: diagnostica.corpo,
    accountId: req.accountId || null,
    tenantId: req.tenantId || null,
    codicePostgres: errore.code || null,
    messaggioPostgres: errore.code ? errore.message : undefined,
    messaggio: errore.code ? undefined : errore.message,
  }));

  res.status(nota ? nota.stato : 500).json({ errore: { codice: nota ? nota.codice : 'ERR_INTERNAL', parametri: {} } });
});

module.exports = router;
