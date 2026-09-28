'use strict';

const {
  calcolaEsito, isPunteggioValido, valoreMassimo, etichettaPunteggio,
  ordinaCronologicamente, risultatoCorrenteCriterio, aggregaRisultatiCorrenti,
} = require('./config/valutazione');
const { datiNonValidi, nonTrovato } = require('./lib/erroreApplicativo');
const {
  verificaInsegnamentoDelDocente,
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

// Filtri ammessi da getValutazioniNellAmbito: nome del filtro -> colonna SQL.
// Elenco chiuso: i nomi di colonna non arrivano mai dall'esterno, i valori
// passano sempre come parametri ($n).
const FILTRI_VALUTAZIONI = Object.freeze({
  personaId: 's.persona_id',
  annoScolasticoId: 's.anno_scolastico_id',
  iscrizioneId: 's.id',
  nucleoId: 'a.nucleo_tematico_id',
  criterioId: 'v.criterio_id',
  insegnamentoId: 'i.id',
});

/**
 * Valutazioni REALMENTE presenti (mai placeholder per "non valutato"),
 * nell'ambito delle attività del docente autenticato (A3).
 *
 * È l'UNICA implementazione della catena di ambito e coerenza usata da Q4
 * (storico di un criterio), Q5 (riepilogo di un nucleo) e dal progresso
 * complessivo degli studenti di una classe: cambiano solo i filtri.
 *
 * Catena: iscrizione -> osservazioni -> valutazioni_criteri -> criterio,
 * con attività e insegnamento usati SOLO per l'ambito (attività del docente,
 * stessa classe/anno dell'iscrizione) e per la coerenza criterio/nucleo.
 *
 * @param {object} filtri - almeno un filtro tra le chiavi di FILTRI_VALUTAZIONI.
 */
async function getValutazioniNellAmbito(client, docenteId, filtri) {
  const parametri = [docenteId];
  const condizioni = Object.entries(filtri).map(([nome, valore]) => {
    const colonna = FILTRI_VALUTAZIONI[nome];
    if (!colonna) throw new Error(`Filtro non previsto in getValutazioniNellAmbito: ${nome}`);
    parametri.push(valore);
    return `${colonna} = $${parametri.length}`;
  });
  if (condizioni.length === 0) throw new Error('getValutazioniNellAmbito richiede almeno un filtro.');

  const { rows } = await client.query(
    `SELECT s.id AS iscrizione_id, a.nucleo_tematico_id AS nucleo_id, v.criterio_id, v.punteggio,
            a.id AS attivita_id, a.nome AS attivita, a.data_attivita
     FROM iscrizioni s
     JOIN osservazioni o          ON o.iscrizione_id = s.id
     JOIN attivita a              ON a.id = o.attivita_id
     JOIN insegnamenti i          ON i.id = a.insegnamento_id AND i.docente_id = $1
                                  AND i.classe_id = s.classe_id AND i.anno_scolastico_id = s.anno_scolastico_id
     JOIN valutazioni_criteri v   ON v.osservazione_id = o.id
     JOIN criteri_osservazione c  ON c.id = v.criterio_id AND c.nucleo_tematico_id = a.nucleo_tematico_id
     WHERE ${condizioni.join(' AND ')}
     ORDER BY a.data_attivita, a.id`,
    parametri
  );
  return rows;
}

/**
 * Valutazione di UN criterio a partire dalle sue righe (getValutazioniNellAmbito):
 * - risultatoCorrente: media delle ultime osservazioni (risultatoCorrenteCriterio);
 * - cumulativoDaInizioAnno: tutte le osservazioni, informazione secondaria;
 * - osservazioni: lo storico COMPLETO in ordine cronologico, ciascuna marcata
 *   con inRisultatoCorrente se fa parte della finestra del risultato corrente.
 * Punto unico usato da Q4, Q5 e dal progresso degli studenti.
 */
function valutaCriterio(righe) {
  const storico = ordinaCronologicamente(righe.map((v) => ({
    attivitaId: v.attivita_id,
    attivita: v.attivita,
    dataAttivita: v.data_attivita,
    punteggio: v.punteggio,
    etichetta: etichettaPunteggio(v.punteggio),
  })));
  const risultatoCorrente = risultatoCorrenteCriterio(storico);
  const considerate = new Set(risultatoCorrente.attivitaConsiderate);
  return {
    risultatoCorrente,
    cumulativoDaInizioAnno: calcolaEsito(storico.map((o) => o.punteggio)),
    osservazioni: storico.map((o) => ({ ...o, inRisultatoCorrente: considerate.has(o.attivitaId) })),
  };
}

/**
 * Valutazione di un insieme di criteri (nucleo o materia): il risultato
 * corrente è la media, a pesi uguali, dei risultati correnti dei criteri
 * valutati; il cumulativo da inizio anno resta calcolato su tutte le righe.
 */
function valutaInsiemeDiCriteri(criteriValutati, righe) {
  return {
    risultatoCorrente: aggregaRisultatiCorrenti(criteriValutati.map((c) => c.risultatoCorrente)),
    cumulativoDaInizioAnno: calcolaEsito(righe.map((r) => r.punteggio)),
  };
}

function raggruppaPerCriterio(righe) {
  const gruppi = new Map();
  righe.forEach((r) => {
    if (!gruppi.has(r.criterio_id)) gruppi.set(r.criterio_id, []);
    gruppi.get(r.criterio_id).push(r);
  });
  return gruppi;
}

/**
 * Risultato di UN criterio per un alunno, in un anno scolastico, attraverso
 * tutte le attività del nucleo (Q4): risultato corrente (ultime osservazioni)
 * più il cumulativo da inizio anno. Solo le attività del docente autenticato
 * (A3): un docente non vede le attività di altri docenti nella stessa classe.
 */
async function getStoricoCriterio(client, { personaId, annoScolasticoId, nucleoId, criterioId, docenteId }) {
  const righe = await getValutazioniNellAmbito(client, docenteId, {
    personaId, annoScolasticoId, nucleoId, criterioId,
  });
  const criterio = valutaCriterio(righe);
  return { ...criterio.risultatoCorrente, cumulativoDaInizioAnno: criterio.cumulativoDaInizioAnno };
}

/**
 * Risultato del nucleo per un alunno, in un anno scolastico (Q5): media dei
 * risultati correnti dei criteri valutati, più il cumulativo da inizio anno
 * su tutte le valutazioni presenti sulle attività del docente autenticato.
 */
async function getRiepilogoNucleo(client, { personaId, annoScolasticoId, nucleoId, docenteId }) {
  const righe = await getValutazioniNellAmbito(client, docenteId, {
    personaId, annoScolasticoId, nucleoId,
  });
  const criteri = [...raggruppaPerCriterio(righe).values()].map(valutaCriterio);
  const nucleo = valutaInsiemeDiCriteri(criteri, righe);
  return { ...nucleo.risultatoCorrente, cumulativoDaInizioAnno: nucleo.cumulativoDaInizioAnno };
}

/**
 * Iscrizioni ATTIVE della classe/anno di un insegnamento, con i dati della
 * persona. La fonte degli studenti è solo `iscrizioni`: nessuna attività
 * è coinvolta, quindi compare anche chi non ha alcuna osservazione.
 * Con `iscrizioneId` restituisce al massimo quella sola iscrizione.
 */
async function getIscrizioniAttiveDellaClasse(client, insegnamentoInfo, iscrizioneId = null) {
  const { rows } = await client.query(
    `SELECT s.id AS iscrizione_id, s.persona_id, p.cognome, p.nome,
            cl.nome AS classe, an.nome AS anno_scolastico
     FROM iscrizioni s
     JOIN persone p          ON p.id = s.persona_id
     JOIN classi cl          ON cl.id = s.classe_id
     JOIN anni_scolastici an ON an.id = s.anno_scolastico_id
     WHERE s.classe_id = $1 AND s.anno_scolastico_id = $2 AND s.attiva = true
       AND ($3::bigint IS NULL OR s.id = $3)
     ORDER BY p.cognome, p.nome, s.id`,
    [insegnamentoInfo.classe_id, insegnamentoInfo.anno_scolastico_id, iscrizioneId]
  );
  return rows;
}

/**
 * Nuclei tematici della materia con i rispettivi criteri, nell'ordine
 * configurato. Un nucleo senza criteri resta nell'elenco con criteri = []
 * ("griglia non configurata", R12).
 */
async function getStrutturaMateria(client, materiaId) {
  const { rows } = await client.query(
    `SELECT n.id AS nucleo_id, n.nome AS nucleo, c.id AS criterio_id, c.nome AS criterio, c.ordine
     FROM nuclei_tematici n
     LEFT JOIN criteri_osservazione c ON c.nucleo_tematico_id = n.id
     WHERE n.materia_id = $1
     ORDER BY n.nome, n.id, c.ordine`,
    [materiaId]
  );
  const nuclei = new Map();
  rows.forEach((r) => {
    if (!nuclei.has(r.nucleo_id)) nuclei.set(r.nucleo_id, { id: r.nucleo_id, nome: r.nucleo, criteri: [] });
    if (r.criterio_id !== null) {
      nuclei.get(r.nucleo_id).criteri.push({ id: r.criterio_id, nome: r.criterio, ordine: r.ordine });
    }
  });
  return [...nuclei.values()];
}

/**
 * Progresso di UNO studente a partire dalle sue valutazioni (righe di
 * getValutazioniNellAmbito), con la stessa logica di Q4 e Q5:
 * osservazioni -> risultato corrente del criterio -> nucleo (media dei
 * criteri valutati) -> materia (media di tutti i criteri valutati).
 */
function costruisciProgresso(struttura, valutazioni) {
  const nuclei = struttura.map((nucleo) => {
    const righeNucleo = valutazioni.filter((v) => v.nucleo_id === nucleo.id);
    const criteri = nucleo.criteri.map((criterio) => ({
      ...criterio,
      ...valutaCriterio(righeNucleo.filter((v) => v.criterio_id === criterio.id)),
    }));
    return {
      id: nucleo.id,
      nome: nucleo.nome,
      grigliaNonConfigurata: criteri.length === 0,
      ...valutaInsiemeDiCriteri(criteri, righeNucleo),
      criteriValutati: criteri.filter((c) => c.osservazioni.length > 0).length,
      criteriTotali: criteri.length,
      criteri,
    };
  });
  return {
    complessivo: {
      ...valutaInsiemeDiCriteri(nuclei.flatMap((n) => n.criteri), valutazioni),
      criteriValutati: nuclei.reduce((totale, n) => totale + n.criteriValutati, 0),
      criteriTotali: nuclei.reduce((totale, n) => totale + n.criteriTotali, 0),
    },
    nuclei,
  };
}

function descriviInsegnamento(ins) {
  return { id: ins.id, materia: ins.materia, classe: ins.classe, annoScolastico: ins.anno_scolastico };
}

/**
 * Studenti della classe di un insegnamento del docente (iscrizioni attive),
 * ciascuno con il progresso complessivo e per nucleo. Il dettaglio dei
 * criteri è omesso qui: lo restituisce getProgressoStudente.
 */
async function getStudentiDellInsegnamento(client, insegnamentoId, docenteId) {
  const ins = await verificaInsegnamentoDelDocente(client, insegnamentoId, docenteId);
  const studenti = await getIscrizioniAttiveDellaClasse(client, ins);
  const struttura = await getStrutturaMateria(client, ins.materia_id);
  const valutazioni = await getValutazioniNellAmbito(client, docenteId, { insegnamentoId: ins.id });

  const valutazioniPerIscrizione = new Map();
  valutazioni.forEach((v) => {
    if (!valutazioniPerIscrizione.has(v.iscrizione_id)) valutazioniPerIscrizione.set(v.iscrizione_id, []);
    valutazioniPerIscrizione.get(v.iscrizione_id).push(v);
  });

  return {
    insegnamento: descriviInsegnamento(ins),
    nuclei: struttura.map((n) => ({ id: n.id, nome: n.nome, criteriTotali: n.criteri.length })),
    studenti: studenti.map((s) => {
      const progresso = costruisciProgresso(struttura, valutazioniPerIscrizione.get(s.iscrizione_id) || []);
      return {
        iscrizioneId: s.iscrizione_id,
        personaId: s.persona_id,
        cognome: s.cognome,
        nome: s.nome,
        complessivo: progresso.complessivo,
        nuclei: progresso.nuclei.map(({ criteri, ...riepilogo }) => riepilogo),
      };
    }),
  };
}

/**
 * Progresso complessivo di uno studente (iscrizione attiva della classe
 * dell'insegnamento): complessivo -> nuclei -> criteri -> livelli osservati.
 */
async function getProgressoStudente(client, { insegnamentoId, iscrizioneId, docenteId }) {
  const ins = await verificaInsegnamentoDelDocente(client, insegnamentoId, docenteId);
  const [studente] = await getIscrizioniAttiveDellaClasse(client, ins, iscrizioneId);
  if (!studente) throw nonTrovato('Studente non trovato tra gli iscritti attivi di questa classe.');
  const struttura = await getStrutturaMateria(client, ins.materia_id);
  const valutazioni = await getValutazioniNellAmbito(client, docenteId, {
    insegnamentoId: ins.id, iscrizioneId: studente.iscrizione_id,
  });
  return {
    insegnamento: descriviInsegnamento(ins),
    iscrizioneId: studente.iscrizione_id,
    personaId: studente.persona_id,
    alunno: { cognome: studente.cognome, nome: studente.nome },
    ...costruisciProgresso(struttura, valutazioni),
  };
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
  getStudentiDellInsegnamento,
  getProgressoStudente,
  getInsegnamentiDelDocente,
  getAttivitaDellInsegnamento,
  getNucleiDellaMateria,
  creaAttivita,
  valoreMassimo,
};
