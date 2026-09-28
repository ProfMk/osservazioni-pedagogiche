'use strict';

const express = require('express');
const { transazione, pool } = require('../db');
const q = require('../queries');
const { ErroreApplicativo } = require('../lib/erroreApplicativo');

const router = express.Router();

/**
 * Avvolge un handler async e inoltra gli errori a Express (evita try/catch ripetuti).
 * Cattura qui, non nel gestore errori finale, i parametri e il corpo della
 * richiesta: in Express 5 `req.params` (e in alcuni casi `req.body`) non
 * sono affidabili quando l'errore raggiunge un middleware di gestione errori
 * a livello di router — risultano vuoti anche se la rotta li aveva popolati.
 * Verificato con un caso isolato prima di questa correzione.
 */
function asincrono(handler) {
  return (req, res, next) => {
    handler(req, res, next).catch((errore) => {
      errore.diagnosticaRichiesta = { parametri: { ...req.params }, corpo: req.body };
      next(errore);
    });
  };
}

// GET /api/insegnamenti — insegnamenti del docente autenticato (navigazione iniziale)
router.get('/insegnamenti', asincrono(async (req, res) => {
  const righe = await q.getInsegnamentiDelDocente(pool, req.docenteId);
  res.json(righe);
}));

// GET /api/insegnamenti/:insegnamentoId/attivita — attività di un proprio insegnamento
router.get('/insegnamenti/:insegnamentoId/attivita', asincrono(async (req, res) => {
  const righe = await q.getAttivitaDellInsegnamento(pool, Number(req.params.insegnamentoId), req.docenteId);
  if (righe === null) return res.status(404).json({ errore: 'Insegnamento non trovato o non accessibile.' });
  res.json(righe);
}));

// GET /api/insegnamenti/:insegnamentoId/nuclei — nuclei della materia di questo insegnamento
router.get('/insegnamenti/:insegnamentoId/nuclei', asincrono(async (req, res) => {
  const righe = await q.getNucleiDellaMateria(pool, Number(req.params.insegnamentoId), req.docenteId);
  if (righe === null) return res.status(404).json({ errore: 'Insegnamento non trovato o non accessibile.' });
  res.json(righe);
}));

// GET /api/insegnamenti/:insegnamentoId/studenti — iscritti attivi della classe/anno, con progresso complessivo
router.get('/insegnamenti/:insegnamentoId/studenti', asincrono(async (req, res) => {
  const esito = await q.getStudentiDellInsegnamento(pool, Number(req.params.insegnamentoId), req.docenteId);
  res.json(esito);
}));

// GET /api/insegnamenti/:insegnamentoId/studenti/:iscrizioneId/progresso — nuclei, criteri e livelli osservati
router.get('/insegnamenti/:insegnamentoId/studenti/:iscrizioneId/progresso', asincrono(async (req, res) => {
  const esito = await q.getProgressoStudente(pool, {
    insegnamentoId: Number(req.params.insegnamentoId),
    iscrizioneId: Number(req.params.iscrizioneId),
    docenteId: req.docenteId,
  });
  res.json(esito);
}));

// POST /api/insegnamenti/:insegnamentoId/attivita — crea una nuova attività
// body: { nome: string, dataAttivita: 'YYYY-MM-DD', nucleoTematicoId: number }
router.post('/insegnamenti/:insegnamentoId/attivita', asincrono(async (req, res) => {
  const insegnamentoId = Number(req.params.insegnamentoId);
  const { nome, dataAttivita, nucleoTematicoId } = req.body;
  const risultato = await transazione((client) =>
    q.creaAttivita(client, { insegnamentoId, docenteId: req.docenteId, nome, dataAttivita, nucleoTematicoId })
  );
  res.status(201).json(risultato);
}));

// GET /api/attivita/:attivitaId/griglia — tabella di classe (Q2)
router.get('/attivita/:attivitaId/griglia', asincrono(async (req, res) => {
  const attivitaId = Number(req.params.attivitaId);
  const griglia = await q.getGrigliaAttivita(pool, attivitaId, req.docenteId);
  res.json(griglia);
}));

// GET /api/attivita/:attivitaId/report-classe — report di classe per questa attività
// (fotografia della sola attività: niente media mobile, niente altre attività)
router.get('/attivita/:attivitaId/report-classe', asincrono(async (req, res) => {
  const attivitaId = Number(req.params.attivitaId);
  const report = await q.getReportClasseAttivita(pool, attivitaId, req.docenteId);
  res.json(report);
}));

// PUT /api/attivita/:attivitaId/iscrizioni/:iscrizioneId/criteri/:criterioId
// body: { punteggio: 0|1|2|null }
router.put('/attivita/:attivitaId/iscrizioni/:iscrizioneId/criteri/:criterioId', asincrono(async (req, res) => {
  const attivitaId = Number(req.params.attivitaId);
  const iscrizioneId = Number(req.params.iscrizioneId);
  const criterioId = Number(req.params.criterioId);
  const { punteggio } = req.body;
  if (punteggio !== null && typeof punteggio !== 'number') {
    return res.status(400).json({ errore: 'Il campo punteggio deve essere 0, 1, 2 oppure null.' });
  }
  const risultato = await transazione((client) =>
    q.salvaValutazione(client, {
      attivitaId, iscrizioneId, criterioId, punteggio,
      docenteId: req.docenteId, dataOsservazione: req.body.dataOsservazione,
    })
  );
  res.json(risultato);
}));

// PUT /api/attivita/:attivitaId/iscrizioni/:iscrizioneId/nota  body: { nota: string|null }
router.put('/attivita/:attivitaId/iscrizioni/:iscrizioneId/nota', asincrono(async (req, res) => {
  const attivitaId = Number(req.params.attivitaId);
  const iscrizioneId = Number(req.params.iscrizioneId);
  const risultato = await transazione((client) =>
    q.aggiornaNota(client, {
      attivitaId, iscrizioneId, nota: req.body.nota ?? null,
      docenteId: req.docenteId, dataOsservazione: req.body.dataOsservazione,
    })
  );
  res.json(risultato);
}));

// GET /api/attivita/:attivitaId/iscrizioni/:iscrizioneId/scheda — scheda individuale (Q6)
router.get('/attivita/:attivitaId/iscrizioni/:iscrizioneId/scheda', asincrono(async (req, res) => {
  const attivitaId = Number(req.params.attivitaId);
  const iscrizioneId = Number(req.params.iscrizioneId);
  const scheda = await q.getSchedaAlunno(pool, { attivitaId, iscrizioneId, docenteId: req.docenteId });
  res.json(scheda);
}));

// GET /api/alunni/:personaId/anni/:annoScolasticoId/nuclei/:nucleoId/criteri/:criterioId/storico (Q4)
router.get('/alunni/:personaId/anni/:annoScolasticoId/nuclei/:nucleoId/criteri/:criterioId/storico', asincrono(async (req, res) => {
  const esito = await q.getStoricoCriterio(pool, {
    personaId: Number(req.params.personaId),
    annoScolasticoId: Number(req.params.annoScolasticoId),
    nucleoId: Number(req.params.nucleoId),
    criterioId: Number(req.params.criterioId),
    docenteId: req.docenteId,
  });
  res.json(esito);
}));

// GET /api/alunni/:personaId/anni/:annoScolasticoId/nuclei/:nucleoId/riepilogo (Q5)
router.get('/alunni/:personaId/anni/:annoScolasticoId/nuclei/:nucleoId/riepilogo', asincrono(async (req, res) => {
  const esito = await q.getRiepilogoNucleo(pool, {
    personaId: Number(req.params.personaId),
    annoScolasticoId: Number(req.params.annoScolasticoId),
    nucleoId: Number(req.params.nucleoId),
    docenteId: req.docenteId,
  });
  res.json(esito);
}));

// Gestore errori del router: traduce ErroreApplicativo nello stato HTTP corretto
// e, per qualunque altro errore, stampa una diagnosi utile in console (SOLO in
// console: al client arriva sempre e solo un messaggio generico).
// eslint-disable-next-line no-unused-vars
router.use((errore, req, res, next) => {
  if (errore instanceof ErroreApplicativo) {
    return res.status(errore.stato).json({ errore: errore.message });
  }

  // Traduzione dei codici PostgreSQL noti in risposte più chiare (difesa in
  // profondità: il livello applicativo dovrebbe già aver intercettato questi
  // casi, ma un vincolo del database che scatta comunque non deve risultare
  // in un generico 500 se il codice lo rende riconoscibile).
  // 23514 = check_violation (es. punteggio fuori scala 0/1/2)
  // 23505 = unique_violation (es. due richieste concorrenti sulla stessa cella)
  // 42P10 = ON CONFLICT senza un vincolo UNIQUE corrispondente (migration mancante)
  const traduzioni = {
    23514: { stato: 400, messaggio: 'Valore non ammesso dal database (vincolo CHECK).' },
    23505: { stato: 409, messaggio: 'Conflitto: il dato è già stato modificato, riprovare.' },
    '42P10': { stato: 500, messaggio: 'Configurazione del database incompleta (vincolo mancante): contattare chi amministra il sistema.' },
  };
  const nota = errore.code && traduzioni[errore.code];

  // Diagnosi in console per chi sviluppa: endpoint, parametri NON sensibili,
  // codice e messaggio PostgreSQL. MAI credenziali: non si legge mai
  // process.env.DATABASE_URL né altre variabili d'ambiente qui, solo campi
  // dell'errore Postgres (che non contengono la stringa di connessione) e
  // dati della richiesta (parametri di percorso e corpo, che per questa API
  // non contengono mai una password). I parametri vengono da
  // errore.diagnosticaRichiesta (catturati da asincrono()), non da req
  // direttamente: vedi il commento su asincrono() per il perché.
  const diagnostica = errore.diagnosticaRichiesta || {};
  // eslint-disable-next-line no-console
  console.error('[errore]', JSON.stringify({
    metodo: req.method,
    endpoint: req.originalUrl,
    parametriPercorso: diagnostica.parametri,
    corpo: diagnostica.corpo,
    docenteId: req.docenteId,
    codicePostgres: errore.code || null,
    messaggioPostgres: errore.code ? errore.message : undefined,
    messaggio: errore.code ? undefined : errore.message,
  }));

  res.status(nota ? nota.stato : 500).json({ errore: nota ? nota.messaggio : 'Errore interno.' });
});

module.exports = router;
