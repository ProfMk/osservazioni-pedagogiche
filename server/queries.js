'use strict';

const { calcolaEsito, isPunteggioValido, valoreMassimo } = require('./config/valutazione');
const { datiNonValidi, nonTrovato } = require('./lib/erroreApplicativo');
const {
  verificaAttivitaDelDocente,
  verificaIscrizioneCoerente,
  verificaCriterioDelNucleo,
} = require('./lib/autorizzazione');

/** Criteri del nucleo di un'attività, nell'ordine configurato (Q1). */
async function getCriteriDelNucleo(client, attivitaInfo) {
  const { rows } = await client.query(
    `SELECT id AS criterio_id, ordine, nome
     FROM criteri_osservazione
     WHERE nucleo_tematico_id = $1
     ORDER BY ordine`,
    [attivitaInfo.nucleo_tematico_id]
  );
  return rows; // 0 righe = "griglia non configurata" (R12): il chiamante decide come segnalarlo.
}

/**
 * Griglia di classe per un'attività (Q2): una riga per alunno iscritto,
 * una colonna per ciascun criterio del nucleo. Nessun criterio è mai
 * inventato: se il nucleo non ne ha, l'elenco criteri è vuoto.
 */
async function getGrigliaAttivita(client, attivitaId, docenteId) {
  const attivitaInfo = await verificaAttivitaDelDocente(client, attivitaId, docenteId);
  const criteri = await getCriteriDelNucleo(client, attivitaInfo);

  const { rows: alunni } = await client.query(
    `SELECT s.id AS iscrizione_id, s.persona_id, p.cognome, p.nome
     FROM iscrizioni s
     JOIN persone p ON p.id = s.persona_id
     WHERE s.classe_id = $1 AND s.anno_scolastico_id = $2 AND s.attiva
     ORDER BY p.cognome, p.nome, s.id`,
    [attivitaInfo.classe_id, attivitaInfo.anno_scolastico_id]
  );

  const { rows: osservazioni } = await client.query(
    `SELECT id AS osservazione_id, iscrizione_id, note
     FROM osservazioni WHERE attivita_id = $1`,
    [attivitaId]
  );
  const osservazionePerIscrizione = new Map(osservazioni.map((o) => [o.iscrizione_id, o]));

  const idOsservazioni = osservazioni.map((o) => o.osservazione_id);
  let valutazioni = [];
  if (idOsservazioni.length > 0) {
    const { rows } = await client.query(
      `SELECT osservazione_id, criterio_id, punteggio
       FROM valutazioni_criteri WHERE osservazione_id = ANY($1::bigint[])`,
      [idOsservazioni]
    );
    valutazioni = rows;
  }
  const punteggioPerCella = new Map(
    valutazioni.map((v) => [`${v.osservazione_id}:${v.criterio_id}`, v.punteggio])
  );

  const righe = alunni.map((alunno) => {
    const osservazione = osservazionePerIscrizione.get(alunno.iscrizione_id) || null;
    const celle = criteri.map((c) => {
      const punteggio = osservazione
        ? punteggioPerCella.get(`${osservazione.osservazione_id}:${c.criterio_id}`)
        : undefined;
      return { criterioId: c.criterio_id, punteggio: punteggio === undefined ? null : punteggio };
    });
    const punteggiPresenti = celle.filter((c) => c.punteggio !== null).map((c) => c.punteggio);
    return {
      iscrizioneId: alunno.iscrizione_id,
      personaId: alunno.persona_id,
      cognome: alunno.cognome,
      nome: alunno.nome,
      osservazioneId: osservazione ? osservazione.osservazione_id : null,
      nota: osservazione ? osservazione.note : null,
      celle,
      valutazionePresenti: punteggiPresenti.length,
      valutazioniTotali: criteri.length,
      esito: calcolaEsito(punteggiPresenti),
    };
  });

  return {
    attivita: { id: attivitaInfo.id, nome: attivitaInfo.nome, dataAttivita: attivitaInfo.data_attivita },
    nucleoTematicoId: attivitaInfo.nucleo_tematico_id,
    annoScolasticoId: attivitaInfo.anno_scolastico_id,
    criteri: criteri.map((c) => ({ id: c.criterio_id, nome: c.nome, ordine: c.ordine })),
    grigliaNonConfigurata: criteri.length === 0, // R12
    righe,
  };
}

/**
 * Salva (o elimina) la valutazione di un criterio per un alunno in un'attività (Q8).
 * punteggio === null  -> "Non valutato": elimina la riga se esiste, nessun errore se non esiste.
 * punteggio 0/1/2     -> crea/aggiorna la riga (upsert), creando l'osservazione se non esiste.
 * Any altro valore     -> rifiutato (400).
 */
async function salvaValutazione(client, { attivitaId, iscrizioneId, criterioId, punteggio, docenteId, dataOsservazione }) {
  const attivitaInfo = await verificaAttivitaDelDocente(client, attivitaId, docenteId);
  await verificaIscrizioneCoerente(client, attivitaInfo, iscrizioneId, true);
  await verificaCriterioDelNucleo(client, attivitaInfo, criterioId);

  if (punteggio !== null && !isPunteggioValido(punteggio)) {
    throw datiNonValidi(`Punteggio non valido: ${punteggio}. Ammessi: 0, 1, 2 oppure null (non valutato).`);
  }

  // Trova l'osservazione, se esiste già (senza crearla se il punteggio è null: non serve).
  const { rows: esistenti } = await client.query(
    'SELECT id FROM osservazioni WHERE attivita_id = $1 AND iscrizione_id = $2',
    [attivitaId, iscrizioneId]
  );

  if (punteggio === null) {
    if (esistenti.length === 0) return { osservazioneId: null, eliminato: false };
    const osservazioneId = esistenti[0].id;
    await client.query(
      'DELETE FROM valutazioni_criteri WHERE osservazione_id = $1 AND criterio_id = $2',
      [osservazioneId, criterioId]
    );
    return { osservazioneId, eliminato: true };
  }

  // Crea l'osservazione se non esiste (idempotente grazie a UNIQUE(attivita_id, iscrizione_id)),
  // altrimenti ne recupera l'id: RETURNING funziona anche in caso di conflitto grazie a DO UPDATE.
  const { rows: oss } = await client.query(
    `INSERT INTO osservazioni (attivita_id, iscrizione_id, docente_id, data_osservazione)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (attivita_id, iscrizione_id)
       DO UPDATE SET attivita_id = EXCLUDED.attivita_id
     RETURNING id`,
    [attivitaId, iscrizioneId, docenteId, dataOsservazione || attivitaInfo.data_attivita]
  );
  const osservazioneId = oss[0].id;

  await client.query(
    `INSERT INTO valutazioni_criteri (osservazione_id, criterio_id, punteggio)
     VALUES ($1, $2, $3)
     ON CONFLICT (osservazione_id, criterio_id) DO UPDATE SET punteggio = EXCLUDED.punteggio`,
    [osservazioneId, criterioId, punteggio]
  );

  return { osservazioneId, eliminato: false };
}

/** Aggiorna (o imposta) la nota facoltativa di un'osservazione, creandola se necessario. */
async function aggiornaNota(client, { attivitaId, iscrizioneId, nota, docenteId, dataOsservazione }) {
  const attivitaInfo = await verificaAttivitaDelDocente(client, attivitaId, docenteId);
  await verificaIscrizioneCoerente(client, attivitaInfo, iscrizioneId, true);

  const { rows } = await client.query(
    `INSERT INTO osservazioni (attivita_id, iscrizione_id, docente_id, data_osservazione, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (attivita_id, iscrizione_id) DO UPDATE SET note = EXCLUDED.note
     RETURNING id, note`,
    [attivitaId, iscrizioneId, docenteId, dataOsservazione || attivitaInfo.data_attivita, nota]
  );
  return rows[0];
}

/** Scheda individuale (Q6): stessi record della griglia, filtrati su un solo alunno. */
async function getSchedaAlunno(client, { attivitaId, iscrizioneId, docenteId }) {
  const attivitaInfo = await verificaAttivitaDelDocente(client, attivitaId, docenteId);
  const iscrizione = await verificaIscrizioneCoerente(client, attivitaInfo, iscrizioneId, false);

  const { rows: persona } = await client.query(
    `SELECT p.cognome, p.nome, cl.nome AS classe, an.nome AS anno_scolastico, n.nome AS nucleo
     FROM persone p, classi cl, anni_scolastici an, nuclei_tematici n
     WHERE p.id = $1 AND cl.id = $2 AND an.id = $3 AND n.id = $4`,
    [iscrizione.persona_id, iscrizione.classe_id, iscrizione.anno_scolastico_id, attivitaInfo.nucleo_tematico_id]
  );

  const criteri = await getCriteriDelNucleo(client, attivitaInfo);
  const { rows: osservazioneRows } = await client.query(
    'SELECT id, note, data_osservazione FROM osservazioni WHERE attivita_id = $1 AND iscrizione_id = $2',
    [attivitaId, iscrizioneId]
  );
  const osservazione = osservazioneRows[0] || null;

  let punteggioPerCriterio = new Map();
  if (osservazione) {
    const { rows } = await client.query(
      'SELECT criterio_id, punteggio FROM valutazioni_criteri WHERE osservazione_id = $1',
      [osservazione.id]
    );
    punteggioPerCriterio = new Map(rows.map((r) => [r.criterio_id, r.punteggio]));
  }

  const celle = criteri.map((c) => ({
    criterioId: c.criterio_id,
    nome: c.nome,
    ordine: c.ordine,
    punteggio: punteggioPerCriterio.has(c.criterio_id) ? punteggioPerCriterio.get(c.criterio_id) : null,
  }));
  const punteggiPresenti = celle.filter((c) => c.punteggio !== null).map((c) => c.punteggio);

  return {
    alunno: { cognome: persona[0].cognome, nome: persona[0].nome },
    personaId: iscrizione.persona_id,
    nucleoTematicoId: attivitaInfo.nucleo_tematico_id,
    annoScolasticoId: iscrizione.anno_scolastico_id,
    classe: persona[0].classe,
    annoScolastico: persona[0].anno_scolastico,
    attivita: { id: attivitaInfo.id, nome: attivitaInfo.nome, dataAttivita: attivitaInfo.data_attivita },
    nucleo: persona[0].nucleo,
    dataOsservazione: osservazione ? osservazione.data_osservazione : null,
    nota: osservazione ? osservazione.note : null,
    grigliaNonConfigurata: criteri.length === 0,
    criteri: celle,
    esito: calcolaEsito(punteggiPresenti),
  };
}

/**
 * Sviluppo cumulativo di UN criterio per un alunno, in un anno scolastico,
 * attraverso tutte le attività del nucleo (Q4). Solo le attività del
 * docente autenticato (A3): un docente vede lo storico solo sulle proprie
 * attività, non su quelle di altri docenti nella stessa classe.
 */
async function getStoricoCriterio(client, { personaId, annoScolasticoId, nucleoId, criterioId, docenteId }) {
  const { rows } = await client.query(
    `SELECT v.punteggio
     FROM iscrizioni s
     JOIN osservazioni o          ON o.iscrizione_id = s.id
     JOIN attivita a              ON a.id = o.attivita_id AND a.nucleo_tematico_id = $3
     JOIN insegnamenti i          ON i.id = a.insegnamento_id AND i.docente_id = $5
                                  AND i.classe_id = s.classe_id AND i.anno_scolastico_id = s.anno_scolastico_id
     JOIN valutazioni_criteri v   ON v.osservazione_id = o.id AND v.criterio_id = $4
     JOIN criteri_osservazione c  ON c.id = v.criterio_id AND c.nucleo_tematico_id = a.nucleo_tematico_id
     WHERE s.persona_id = $1 AND s.anno_scolastico_id = $2`,
    [personaId, annoScolasticoId, nucleoId, criterioId, docenteId]
  );
  return calcolaEsito(rows.map((r) => r.punteggio));
}

/**
 * Risultato cumulativo del nucleo per un alunno, in un anno scolastico (Q5),
 * attraverso TUTTE le valutazioni realmente presenti sulle attività del
 * docente autenticato. Non usa mai il numero teorico di criteri o attività.
 */
async function getRiepilogoNucleo(client, { personaId, annoScolasticoId, nucleoId, docenteId }) {
  const { rows } = await client.query(
    `SELECT v.punteggio
     FROM iscrizioni s
     JOIN osservazioni o          ON o.iscrizione_id = s.id
     JOIN attivita a              ON a.id = o.attivita_id AND a.nucleo_tematico_id = $3
     JOIN insegnamenti i          ON i.id = a.insegnamento_id AND i.docente_id = $4
                                  AND i.classe_id = s.classe_id AND i.anno_scolastico_id = s.anno_scolastico_id
     JOIN valutazioni_criteri v   ON v.osservazione_id = o.id
     JOIN criteri_osservazione c  ON c.id = v.criterio_id AND c.nucleo_tematico_id = a.nucleo_tematico_id
     WHERE s.persona_id = $1 AND s.anno_scolastico_id = $2`,
    [personaId, annoScolasticoId, nucleoId, docenteId]
  );
  return calcolaEsito(rows.map((r) => r.punteggio));
}

/** Insegnamenti del docente autenticato (per la navigazione iniziale). */
async function getInsegnamentiDelDocente(client, docenteId) {
  const { rows } = await client.query(
    `SELECT i.id AS insegnamento_id, m.nome AS materia, cl.nome AS classe,
            an.id AS anno_scolastico_id, an.nome AS anno_scolastico
     FROM insegnamenti i
     JOIN materie m ON m.id = i.materia_id
     JOIN classi cl ON cl.id = i.classe_id
     JOIN anni_scolastici an ON an.id = i.anno_scolastico_id
     WHERE i.docente_id = $1
     ORDER BY an.nome DESC, m.nome, cl.nome`,
    [docenteId]
  );
  return rows;
}

/** Attività di un insegnamento del docente autenticato (verifica la proprietà). */
async function getAttivitaDellInsegnamento(client, insegnamentoId, docenteId) {
  const { rows: ins } = await client.query(
    'SELECT id FROM insegnamenti WHERE id = $1 AND docente_id = $2',
    [insegnamentoId, docenteId]
  );
  if (ins.length === 0) return null; // il chiamante traduce in 404 (R2)
  const { rows } = await client.query(
    `SELECT a.id AS attivita_id, a.nome, a.data_attivita, n.nome AS nucleo
     FROM attivita a JOIN nuclei_tematici n ON n.id = a.nucleo_tematico_id
     WHERE a.insegnamento_id = $1
     ORDER BY a.data_attivita DESC, a.id DESC`,
    [insegnamentoId]
  );
  return rows;
}

/**
 * Nuclei tematici disponibili per la materia di un insegnamento del docente
 * autenticato: sono le uniche opzioni che il docente può scegliere quando
 * crea una nuova attività (mai un elenco scritto nel frontend, R2/§4).
 */
async function getNucleiDellaMateria(client, insegnamentoId, docenteId) {
  const { rows: ins } = await client.query(
    'SELECT materia_id FROM insegnamenti WHERE id = $1 AND docente_id = $2',
    [insegnamentoId, docenteId]
  );
  if (ins.length === 0) return null;
  const { rows } = await client.query(
    'SELECT id AS nucleo_id, nome FROM nuclei_tematici WHERE materia_id = $1 ORDER BY nome',
    [ins[0].materia_id]
  );
  return rows;
}

/**
 * Crea una nuova attività su un insegnamento del docente autenticato.
 * Il nucleo scelto deve appartenere alla materia dell'insegnamento (stesso
 * controllo R4 già usato in lettura): non ci si fida del nucleo_tematico_id
 * ricevuto dal client oltre a verificarne l'appartenenza alla materia giusta.
 * I criteri NON si toccano qui: derivano automaticamente dal nucleo scelto,
 * quando l'attività verrà aperta (Q1/R12).
 */
async function creaAttivita(client, { insegnamentoId, docenteId, nome, dataAttivita, nucleoTematicoId }) {
  const { rows: ins } = await client.query(
    'SELECT id, materia_id FROM insegnamenti WHERE id = $1 AND docente_id = $2',
    [insegnamentoId, docenteId]
  );
  if (ins.length === 0) throw nonTrovato('Insegnamento non trovato o non accessibile.');

  if (!nome || !nome.trim()) throw datiNonValidi('Il nome dell\'attività è obbligatorio.');
  if (!dataAttivita) throw datiNonValidi('La data dell\'attività è obbligatoria.');

  const { rows: nucleo } = await client.query(
    'SELECT id FROM nuclei_tematici WHERE id = $1 AND materia_id = $2',
    [nucleoTematicoId, ins[0].materia_id]
  );
  if (nucleo.length === 0) {
    throw datiNonValidi('Il nucleo tematico scelto non appartiene alla materia di questo insegnamento.');
  }

  const { rows } = await client.query(
    `INSERT INTO attivita (insegnamento_id, nucleo_tematico_id, nome, data_attivita)
     VALUES ($1, $2, $3, $4)
     RETURNING id AS attivita_id, nome, data_attivita`,
    [insegnamentoId, nucleoTematicoId, nome.trim(), dataAttivita]
  );
  return rows[0];
}

module.exports = {
  getCriteriDelNucleo,
  getGrigliaAttivita,
  salvaValutazione,
  aggiornaNota,
  getSchedaAlunno,
  getStoricoCriterio,
  getRiepilogoNucleo,
  getInsegnamentiDelDocente,
  getAttivitaDellInsegnamento,
  getNucleiDellaMateria,
  creaAttivita,
  valoreMassimo,
};
