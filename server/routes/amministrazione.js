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
const struttura = require('../queries/struttura');
const { quadroIstituto } = require('../queries/quadro');

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

// --- Quadro dell'istituto ----------------------------------------------------------------

// GET /api/admin/overview?anno=<id> -> { anno, daFare: [{ codice, parametri, collegamento }], riepilogo: [...] }
// Senza ?anno: l'anno di lavoro predefinito (deciso dal server).
router.get('/overview', asincrono(async (req, res) => {
  await permessoConfigurazione(pool, req);
  const anno = req.query.anno === undefined || req.query.anno === '' ? undefined : idDiPercorso(req.query.anno, 'UI_RESOURCE_SCHOOL_YEAR');
  res.json(await quadroIstituto(pool, { tenantId: req.tenantId, annoId: anno, tr: await traduttoreDi(pool, req.lingua) }));
}));

// --- Calendario: anni scolastici ------------------------------------------------------

// GET /api/admin/school-years -> { anni: [{ id, nome, stato, dataInizio, dataFine, azioni }], annoDiLavoro, passaggio }
router.get('/school-years', asincrono(async (req, res) => {
  await permessoConfigurazione(pool, req);
  res.json(await calendario.elencoAnni(pool, req.tenantId));
}));

// POST /api/admin/school-years  body: { nome, dataInizio, dataFine } -> 201, anno 'in_preparazione'
router.post('/school-years', scritturaConfigurazione((client, req) => calendario.creaAnno(client, ctxDi(req), req.body || {}), 201));

// PUT /api/admin/school-years/:annoId  body: { nome } -> anno rinominato (le date non cambiano)
router.put('/school-years/:annoId', scritturaConfigurazione((client, req) => calendario.rinominaAnno(client, ctxDi(req), idAnno(req), req.body || {})));

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

// --- Livelli scolastici (tenant.manage_config) ------------------------------------------

const idLivello = (req) => idDiPercorso(req.params.livelloId, 'UI_RESOURCE_SCHOOL_LEVEL');
const conTraduttore = (fn) => async (client, req) => fn(client, req, await traduttoreDi(client, req.lingua));

// GET /api/admin/school-levels -> [{ id, nome: { testo, lingua }, ordine, stato, classiAttive, azioni }]
router.get('/school-levels', asincrono(async (req, res) => {
  await permessoConfigurazione(pool, req);
  res.json(await struttura.elencoLivelli(pool, ctxDi(req), await traduttoreDi(pool, req.lingua)));
}));

// POST /api/admin/school-levels  body: { nome, ordine? } -> 201
router.post('/school-levels', scritturaConfigurazione(conTraduttore((client, req, tr) => struttura.creaLivello(client, ctxDi(req), req.body || {}, tr)), 201));

// PUT /api/admin/school-levels/:livelloId  body: { nome?, ordine? } (rinomina, riordina)
router.put('/school-levels/:livelloId', scritturaConfigurazione(conTraduttore((client, req, tr) => struttura.modificaLivello(
  client, ctxDi(req), idLivello(req), req.body || {}, tr
))));

// POST /api/admin/school-levels/:livelloId/deactivate | reactivate ; DELETE /api/admin/school-levels/:livelloId -> 204
router.post('/school-levels/:livelloId/deactivate', scritturaConfigurazione(conTraduttore((client, req, tr) => struttura.disattivaLivello(client, ctxDi(req), idLivello(req), tr))));
router.post('/school-levels/:livelloId/reactivate', scritturaConfigurazione(conTraduttore((client, req, tr) => struttura.riattivaLivello(client, ctxDi(req), idLivello(req), tr))));
router.delete('/school-levels/:livelloId', scritturaConfigurazione((client, req) => struttura.eliminaLivello(client, ctxDi(req), idLivello(req))));

// --- Classi (class.manage, nell'ambito del livello e della classe) ----------------------

const permessoClassi = (client, req, livelloId, classeId = null) => richiedePermesso(client, {
  accountId: req.accountId, permesso: 'class.manage', tenantId: req.tenantId, schoolLevelId: livelloId, classId: classeId,
});

/** Livello del tenant (404), poi il permesso sulle classi di quel livello (403). */
async function livelloPerClassi(client, req) {
  const livello = await struttura.livelloDelTenant(client, ctxDi(req), idLivello(req));
  await permessoClassi(client, req, livello.id);
  return livello;
}

/** Classe del tenant (404, bloccata per la scrittura), poi il permesso (403); con il suo livello. */
async function classePerScrittura(client, req) {
  const classe = await struttura.classeDelTenant(client, ctxDi(req), idDiPercorso(req.params.classeId, 'UI_RESOURCE_CLASS'), { blocca: true });
  await permessoClassi(client, req, classe.school_level_id, classe.id);
  const livello = await struttura.livelloDelTenant(client, ctxDi(req), classe.school_level_id);
  return { classe, livello };
}

const scritturaClassi = (fn, stato = 200) => asincrono(async (req, res) => {
  const risultato = await transazione((client) => fn(client, req));
  if (risultato === undefined) res.status(204).end();
  else res.status(stato).json(risultato);
});

// GET /api/admin/school-levels/:livelloId/classes -> { livello, classi: [{ id, nome, stato, azioni }] }
router.get('/school-levels/:livelloId/classes', asincrono(async (req, res) => {
  const livello = await livelloPerClassi(pool, req);
  const tr = await traduttoreDi(pool, req.lingua);
  res.json({
    livello: { id: livello.id, nome: tr.testo('school_levels.nome', livello.id, livello.nome), stato: livello.stato },
    classi: await struttura.elencoClassi(pool, ctxDi(req), livello),
  });
}));

// POST /api/admin/school-levels/:livelloId/classes  body: { nome } -> 201
router.post('/school-levels/:livelloId/classes', scritturaClassi(async (client, req) => {
  const livello = await livelloPerClassi(client, req);
  return struttura.creaClasse(client, ctxDi(req), livello, req.body || {});
}, 201));

// PUT /api/admin/classes/:classeId  body: { nome } (solo il nome: nessuno spostamento di livello)
router.put('/classes/:classeId', scritturaClassi(async (client, req) => {
  const { classe, livello } = await classePerScrittura(client, req);
  return struttura.rinominaClasse(client, ctxDi(req), classe, livello, req.body || {});
}));

// POST /api/admin/classes/:classeId/deactivate | reactivate ; DELETE /api/admin/classes/:classeId -> 204
router.post('/classes/:classeId/deactivate', scritturaClassi(async (client, req) => {
  const { classe, livello } = await classePerScrittura(client, req);
  return struttura.disattivaClasse(client, ctxDi(req), classe, livello);
}));
router.post('/classes/:classeId/reactivate', scritturaClassi(async (client, req) => {
  const { classe, livello } = await classePerScrittura(client, req);
  return struttura.riattivaClasse(client, ctxDi(req), classe, livello);
}));
router.delete('/classes/:classeId', scritturaClassi(async (client, req) => {
  const { classe } = await classePerScrittura(client, req);
  return struttura.eliminaClasse(client, ctxDi(req), classe);
}));

module.exports = router;
