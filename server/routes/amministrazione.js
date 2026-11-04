'use strict';

/**
 * Amministrazione dell'istituto (iterazione 2A), montata su /api/admin dentro il dominio
 * (sessione, CSRF, password aggiornata e tenant attivo già verificati dalla pipeline).
 *
 * Permessi (decisione 15): calendario, livelli e quadro con tenant.manage_config; classi
 * con class.manage. Il permesso si verifica PRIMA di cercare la risorsa per calendario,
 * livelli e quadro (permesso di tenant: un docente riceve sempre 403); per le classi si
 * risolve prima la classe nel tenant (404) e poi il permesso nel suo ambito, come le rotte
 * di lettura delle classi. Una risorsa di un altro tenant non si trova mai: 404.
 *
 * Ogni scrittura: una transazione, con l'audit nella stessa transazione.
 */
const express = require('express');
const { pool, transazione } = require('../db');
const { richiedePermesso } = require('../lib/autorizzazione');
const { traduttoreDi } = require('../lib/pubblicazione');
const { asincrono } = require('../lib/asincrono');
const { idDiPercorso } = require('../lib/validazione');
const calendario = require('../queries/calendario');

const router = express.Router();

const ctxDi = (req) => ({ tenantId: req.tenantId, accountId: req.accountId });
const permessoConfigurazione = (client, req) => richiedePermesso(client, {
  accountId: req.accountId, permesso: 'tenant.manage_config', tenantId: req.tenantId,
});
const idAnno = (req) => idDiPercorso(req.params.annoId, 'UI_RESOURCE_SCHOOL_YEAR');

/** Scrittura di configurazione: permesso, poi la funzione, tutto nella stessa transazione. */
const scritturaConfigurazione = (fn, stato = 200) => asincrono(async (req, res) => {
  const risultato = await transazione(async (client) => {
    await permessoConfigurazione(client, req);
    return fn(client, req);
  });
  if (risultato === undefined) res.status(204).end();
  else res.status(stato).json(risultato);
});

// --- Calendario: anni scolastici ------------------------------------------------------

// GET /api/admin/school-years -> { anni: [{ id, nome, stato, dataInizio, dataFine, azioni }], annoDiLavoro, passaggio }
router.get('/school-years', asincrono(async (req, res) => {
  await permessoConfigurazione(pool, req);
  res.json(await calendario.elencoAnni(pool, req.tenantId));
}));

// POST /api/admin/school-years  body: { nome, dataInizio, dataFine } -> 201, anno 'in_preparazione'
router.post('/school-years', scritturaConfigurazione((client, req) => calendario.creaAnno(client, ctxDi(req), req.body || {}), 201));

// POST /api/admin/school-years/:annoId/activate | close | reopen | switch-to ; DELETE /api/admin/school-years/:annoId
const TRANSIZIONI = {
  activate: calendario.attivaAnno,
  close: calendario.chiudiAnno,
  reopen: calendario.riapriAnno,
  'switch-to': calendario.passaAlNuovoAnno,
};
Object.entries(TRANSIZIONI).forEach(([azione, fn]) => {
  router.post(`/school-years/:annoId/${azione}`, scritturaConfigurazione((client, req) => fn(client, ctxDi(req), idAnno(req))));
});
router.delete('/school-years/:annoId', scritturaConfigurazione((client, req) => calendario.eliminaAnno(client, ctxDi(req), idAnno(req))));

// --- Calendario: periodi di valutazione -----------------------------------------------

// GET /api/admin/school-years/:annoId/periods -> { anno, modificabile, periodi: [{ id, nome: { testo, lingua }, dataInizio, dataFine, eliminabile }] }
router.get('/school-years/:annoId/periods', asincrono(async (req, res) => {
  await permessoConfigurazione(pool, req);
  res.json(await calendario.elencoPeriodi(pool, ctxDi(req), idAnno(req), await traduttoreDi(pool, req.lingua)));
}));

// POST /api/admin/school-years/:annoId/periods  body: { nome, dataInizio, dataFine } -> 201
router.post('/school-years/:annoId/periods', scritturaConfigurazione(async (client, req) => calendario.creaPeriodo(
  client, ctxDi(req), idAnno(req), req.body || {}, await traduttoreDi(client, req.lingua)
), 201));

// PUT /api/admin/periods/:periodoId  body: { nome, dataInizio, dataFine }
router.put('/periods/:periodoId', scritturaConfigurazione(async (client, req) => calendario.modificaPeriodo(
  client, ctxDi(req), idDiPercorso(req.params.periodoId, 'UI_RESOURCE_ASSESSMENT_PERIOD'), req.body || {}, await traduttoreDi(client, req.lingua)
)));

// DELETE /api/admin/periods/:periodoId -> 204
router.delete('/periods/:periodoId', scritturaConfigurazione((client, req) => calendario.eliminaPeriodo(
  client, ctxDi(req), idDiPercorso(req.params.periodoId, 'UI_RESOURCE_ASSESSMENT_PERIOD')
)));

module.exports = router;
