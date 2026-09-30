'use strict';

/**
 * Pipeline delle API (sez. 14):
 *   Request -> Session -> Authentication -> CSRF -> Tenant context -> Authorization -> Resource validation -> Database
 *
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

router.use('/auth', require('./auth'));
router.use('/platform', autenticazione, richiedeCsrf, require('./tenant'));
router.use('/', autenticazione, richiedeCsrf, contestoTenant, require('./dominio'));

// Gestore errori centrale: traduce ErroreApplicativo nello stato HTTP corretto;
// per qualunque altro errore, stampa una diagnosi in console (mai al client, sez. 68).
// eslint-disable-next-line no-unused-vars
router.use((errore, req, res, next) => {
  if (errore instanceof ErroreApplicativo) {
    return res.status(errore.stato).json({ errore: errore.message });
  }

  // Traduzione dei codici PostgreSQL noti in risposte più chiare.
  // 23503 = foreign_key_violation (una FK composta ha rifiutato una combinazione incoerente:
  //         cross-tenant, cross-anno, cross-classe, cross-materia — sez. 35/36/31/34).
  // 23505 = unique_violation (conflitto, es. due richieste concorrenti sulla stessa cella).
  // 23514 = check_violation.
  // 42501 = insufficient_privilege (app_role ha rifiutato un'operazione: mai atteso da codice
  //         applicativo corretto, es. un tentativo di UPDATE/DELETE su audit_log).
  const traduzioni = {
    23503: { stato: 400, messaggio: 'Combinazione di riferimenti non valida (tenant, anno, classe o materia incoerenti).' },
    23505: { stato: 409, messaggio: 'Conflitto: il dato è già stato modificato, riprovare.' },
    23514: { stato: 400, messaggio: 'Valore non ammesso dal database (vincolo CHECK).' },
    42501: { stato: 500, messaggio: 'Operazione non consentita dai privilegi del database: contattare chi amministra il sistema.' },
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

  res.status(nota ? nota.stato : 500).json({ errore: nota ? nota.messaggio : 'Errore interno.' });
});

module.exports = router;
