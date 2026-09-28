'use strict';

/**
 * Test di integrazione su un database di PROVA con lo schema migrato
 * (001_vincoli_osservazioni.sql applicata), MAI sul database Neon reale.
 *
 * - Senza PGTEST_URL: PGlite in memoria (tests/support/pglite.js), database
 *   ricreato da zero a ogni esecuzione; nessuna installazione richiesta.
 * - Con PGTEST_URL: un PostgreSQL reale già preparato.
 * Dati e istruzioni: tests/README_DATI_DI_PROVA.md
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// IMPORTANTE: uso lo stesso modulo di connessione del server (server/db.js),
// non un Pool creato a parte, per verificare esattamente lo stesso codice
// che gira in produzione (inclusa la conversione dei bigint in numeri:
// un Pool creato qui separatamente NON erediterebbe quella correzione,
// perché è un side-effect globale innescato dal solo require di server/db).
const SU_PGLITE = !process.env.PGTEST_URL;
if (SU_PGLITE) {
  require('./support/pglite').installa();
} else {
  // Alcuni test fanno COMMIT (Caso I): non devono mai toccare il database reale.
  if (/neon\.tech/i.test(process.env.PGTEST_URL)) {
    throw new Error('PGTEST_URL punta a Neon: i test vanno eseguiti solo su un database di prova.');
  }
  process.env.DATABASE_URL = process.env.PGTEST_URL;
}
const { pool } = require('../server/db');
const q = require('../server/queries');
const { verificaAttivitaDelDocente } = require('../server/lib/autorizzazione');

async function conTransazioneDiProva(fn) {
  // Ogni test lavora dentro una transazione che viene sempre annullata
  // (ROLLBACK) alla fine, così i test non lasciano tracce nel database
  // di prova e sono ripetibili.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

// --- Dati noti nel database di prova (vedi tests/README_DATI_DI_PROVA.md) ---
const DOCENTE_ID = 1;
const DOCENTE_ESTRANEO_ID = 4; // nessun insegnamento
const INSEGNAMENTO_ID = 1; // insegnamento del docente 1 (Matematica, 3A)
const ATTIVITA_ID = 1; // nucleo 1 (Numeri), insegnamento del docente 1
const ISCRIZIONE_CLASSE_CORRETTA = 1; // classe 3A, stessa classe/anno dell'insegnamento
const ISCRIZIONE_ALTRA_CLASSE = 3; // classe 3B (persona 4): per il caso K3
const CRITERIO_NUCLEO_1 = 1; // "Correttezza numerica", nucleo dell'attività 1
const CRITERIO_NUCLEO_2 = 7; // "Orientamento e relazioni spaziali", nucleo 2 (estraneo all'attività 1)

test('Round-trip: salva un punteggio, lo aggiorna, poi lo elimina (Non valutato)', async () => {
  await conTransazioneDiProva(async (client) => {
    const r1 = await q.salvaValutazione(client, {
      attivitaId: ATTIVITA_ID, iscrizioneId: ISCRIZIONE_CLASSE_CORRETTA, criterioId: CRITERIO_NUCLEO_1,
      punteggio: 1, docenteId: DOCENTE_ID,
    });
    assert.ok(r1.osservazioneId);

    // Stesso criterio, valore aggiornato: non deve creare una seconda riga (UNIQUE osservazione+criterio).
    await q.salvaValutazione(client, {
      attivitaId: ATTIVITA_ID, iscrizioneId: ISCRIZIONE_CLASSE_CORRETTA, criterioId: CRITERIO_NUCLEO_1,
      punteggio: 2, docenteId: DOCENTE_ID,
    });
    const { rows: dopoAggiornamento } = await client.query(
      'SELECT punteggio FROM valutazioni_criteri WHERE osservazione_id = $1 AND criterio_id = $2',
      [r1.osservazioneId, CRITERIO_NUCLEO_1]
    );
    assert.equal(dopoAggiornamento.length, 1);
    assert.equal(dopoAggiornamento[0].punteggio, 2);

    // "Non valutato": la riga deve sparire, non diventare 0 o NULL.
    const r2 = await q.salvaValutazione(client, {
      attivitaId: ATTIVITA_ID, iscrizioneId: ISCRIZIONE_CLASSE_CORRETTA, criterioId: CRITERIO_NUCLEO_1,
      punteggio: null, docenteId: DOCENTE_ID,
    });
    assert.equal(r2.eliminato, true);
    const { rows: dopoEliminazione } = await client.query(
      'SELECT * FROM valutazioni_criteri WHERE osservazione_id = $1 AND criterio_id = $2',
      [r1.osservazioneId, CRITERIO_NUCLEO_1]
    );
    assert.equal(dopoEliminazione.length, 0);
  });
});

test('Caso F: punteggio 3 è rifiutato dal livello applicativo', async () => {
  await conTransazioneDiProva(async (client) => {
    await assert.rejects(
      () => q.salvaValutazione(client, {
        attivitaId: ATTIVITA_ID, iscrizioneId: ISCRIZIONE_CLASSE_CORRETTA, criterioId: CRITERIO_NUCLEO_1,
        punteggio: 3, docenteId: DOCENTE_ID,
      }),
      /Punteggio non valido/
    );
  });
});

test('Caso F (seconda linea di difesa): il database rifiuta punteggio=3 anche bypassando il livello applicativo', async () => {
  await conTransazioneDiProva(async (client) => {
    // Uso l'osservazione 2 (attivita 1, iscrizione 2) e il criterio 3, MAI
    // valutato nei dati di prova per questa osservazione: così l'errore
    // atteso è certamente il CHECK sul punteggio, non un vincolo UNIQUE
    // per una coppia (osservazione, criterio) già esistente nei dati seme.
    const { rows } = await client.query(
      'SELECT id FROM osservazioni WHERE attivita_id=$1 AND iscrizione_id=$2', [ATTIVITA_ID, 2]
    );
    await assert.rejects(
      () => client.query(
        'INSERT INTO valutazioni_criteri (osservazione_id, criterio_id, punteggio) VALUES ($1,$2,3)',
        [rows[0].id, 3]
      ),
      (errore) => errore.code === '23514' // check_violation
    );
  });
});

test('Caso G: un criterio di un altro nucleo viene rifiutato', async () => {
  await conTransazioneDiProva(async (client) => {
    await assert.rejects(
      () => q.salvaValutazione(client, {
        attivitaId: ATTIVITA_ID, iscrizioneId: ISCRIZIONE_CLASSE_CORRETTA, criterioId: CRITERIO_NUCLEO_2,
        punteggio: 2, docenteId: DOCENTE_ID,
      }),
      /non appartenente al nucleo/
    );
  });
});

// --- Casi A-J richiesti nella correzione funzionale (mappatura nel README/riepilogo finale) ---

test('Casi B/C/D: 0, 1 e 2 sono tutti accettati e distinti tra loro e da "non valutato"', async () => {
  await conTransazioneDiProva(async (client) => {
    for (const valore of [0, 1, 2]) {
      const r = await q.salvaValutazione(client, {
        attivitaId: ATTIVITA_ID, iscrizioneId: ISCRIZIONE_CLASSE_CORRETTA, criterioId: CRITERIO_NUCLEO_1,
        punteggio: valore, docenteId: DOCENTE_ID,
      });
      const { rows } = await client.query(
        'SELECT punteggio FROM valutazioni_criteri WHERE osservazione_id=$1 AND criterio_id=$2',
        [r.osservazioneId, CRITERIO_NUCLEO_1]
      );
      assert.equal(rows.length, 1, `il valore ${valore} deve produrre esattamente una riga`);
      assert.equal(rows[0].punteggio, valore, `la riga deve contenere esattamente il punteggio ${valore}, non un altro valore`);
    }
  });
});

test('Caso G (esplicito): un criterio del nucleo corretto viene accettato', async () => {
  await conTransazioneDiProva(async (client) => {
    const r = await q.salvaValutazione(client, {
      attivitaId: ATTIVITA_ID, iscrizioneId: ISCRIZIONE_CLASSE_CORRETTA, criterioId: CRITERIO_NUCLEO_1,
      punteggio: 2, docenteId: DOCENTE_ID,
    });
    assert.ok(r.osservazioneId, 'un criterio del nucleo giusto deve essere accettato senza errori');
  });
});

test('Caso J: la griglia restituisce il NOME di ciascun criterio, non solo l\'ordine numerico', async () => {
  await conTransazioneDiProva(async (client) => {
    const griglia = await q.getGrigliaAttivita(client, ATTIVITA_ID, DOCENTE_ID);
    assert.equal(griglia.criteri.length, 6);
    griglia.criteri.forEach((c) => {
      assert.equal(typeof c.nome, 'string');
      assert.ok(c.nome.length > 3, 'il nome del criterio deve essere un testo descrittivo, non un numero');
      assert.notEqual(c.nome, String(c.ordine));
    });
    // Nomi reali attesi per il nucleo "Numeri" (dati di prova).
    const nomi = griglia.criteri.map((c) => c.nome);
    assert.deepEqual(nomi, [
      'Correttezza numerica', 'Valore posizionale', 'Relazioni quantitative',
      'Calcolo', 'Autonomia', 'Linguaggio matematico',
    ]);
  });
});

test('Nuova attività: i nuclei proposti sono solo quelli della materia dell\'insegnamento', async () => {
  await conTransazioneDiProva(async (client) => {
    const nuclei = await q.getNucleiDellaMateria(client, INSEGNAMENTO_ID, DOCENTE_ID);
    assert.equal(nuclei.length, 3);
    assert.deepEqual(nuclei.map((n) => n.nome).sort(), [
      'Numeri', 'Relazioni, dati e previsioni', 'Spazio e figure',
    ]);
  });
});

test('Nuova attività: creazione con un nucleo della materia giusta riesce', async () => {
  await conTransazioneDiProva(async (client) => {
    const risultato = await q.creaAttivita(client, {
      insegnamentoId: INSEGNAMENTO_ID, docenteId: DOCENTE_ID,
      nome: 'Prova di creazione', dataAttivita: '2025-11-10', nucleoTematicoId: 1,
    });
    assert.ok(risultato.attivita_id);
    const { rows } = await client.query('SELECT nucleo_tematico_id FROM attivita WHERE id=$1', [risultato.attivita_id]);
    assert.equal(rows[0].nucleo_tematico_id, 1);
  });
});

test('Nuova attività: creazione con un nucleo di un\'altra materia è rifiutata (400)', async () => {
  await conTransazioneDiProva(async (client) => {
    // Creo, dentro la transazione di prova, una materia e un nucleo estranei a Matematica.
    const { rows: materia } = await client.query("INSERT INTO materie (nome) VALUES ('Italiano (prova)') RETURNING id");
    const { rows: nucleo } = await client.query(
      'INSERT INTO nuclei_tematici (materia_id, nome) VALUES ($1, $2) RETURNING id',
      [materia[0].id, 'Lettura (prova)']
    );
    await assert.rejects(
      () => q.creaAttivita(client, {
        insegnamentoId: INSEGNAMENTO_ID, docenteId: DOCENTE_ID,
        nome: 'Prova errata', dataAttivita: '2025-11-10', nucleoTematicoId: nucleo[0].id,
      }),
      (errore) => errore.stato === 400
    );
  });
});

test('Nuova attività: creazione su un insegnamento non proprio è rifiutata (404)', async () => {
  await conTransazioneDiProva(async (client) => {
    await assert.rejects(
      () => q.creaAttivita(client, {
        insegnamentoId: INSEGNAMENTO_ID, docenteId: DOCENTE_ESTRANEO_ID,
        nome: 'Prova', dataAttivita: '2025-11-10', nucleoTematicoId: 1,
      }),
      (errore) => errore.stato === 404
    );
  });
});

test('Caso H: un docente non può leggere/scrivere un\'attività che non è sua', async () => {
  await conTransazioneDiProva(async (client) => {
    await assert.rejects(
      () => verificaAttivitaDelDocente(client, ATTIVITA_ID, DOCENTE_ESTRANEO_ID),
      (errore) => errore.stato === 404
    );
    await assert.rejects(
      () => q.salvaValutazione(client, {
        attivitaId: ATTIVITA_ID, iscrizioneId: ISCRIZIONE_CLASSE_CORRETTA, criterioId: CRITERIO_NUCLEO_1,
        punteggio: 2, docenteId: DOCENTE_ESTRANEO_ID,
      }),
      (errore) => errore.stato === 404
    );
  });
});

test('K3: un alunno di un\'altra classe non può essere valutato in questa attività', async () => {
  await conTransazioneDiProva(async (client) => {
    await assert.rejects(
      () => q.salvaValutazione(client, {
        attivitaId: ATTIVITA_ID, iscrizioneId: ISCRIZIONE_ALTRA_CLASSE, criterioId: CRITERIO_NUCLEO_1,
        punteggio: 2, docenteId: DOCENTE_ID,
      }),
      (errore) => errore.stato === 404
    );
  });
});

test('Caso I: due inserimenti concorrenti della stessa osservazione non creano un duplicato', {
  skip: SU_PGLITE && 'PGlite ha una sola sessione: la concorrenza richiede un PostgreSQL reale (PGTEST_URL). Verifica NON eseguita.',
}, async () => {
  // Test SUL VINCOLO DEL DATABASE: due connessioni distinte, transazioni reali
  // (non nella transazione di prova annullabile, perché qui serve il commit
  // per osservare la reale concorrenza). Uso l'iscrizione 4 (classe 3B, dati
  // aggiuntivi): nessuna osservazione preesistente per questa coppia, quindi
  // il conflitto che osserviamo è generato SOLO da questo test.
  const ISCRIZIONE_LIBERA = ISCRIZIONE_ALTRA_CLASSE;
  const c1 = await pool.connect();
  const c2 = await pool.connect();
  try {
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      await c1.query(
        'INSERT INTO osservazioni (attivita_id, iscrizione_id, docente_id, data_osservazione) VALUES ($1,$2,$3,CURRENT_DATE)',
        [ATTIVITA_ID, ISCRIZIONE_LIBERA, DOCENTE_ID]
      );
      // c2 tenta lo stesso inserimento mentre c1 non ha ancora fatto COMMIT: deve attendere, poi fallire.
      const c2Promise = c2.query(
        'INSERT INTO osservazioni (attivita_id, iscrizione_id, docente_id, data_osservazione) VALUES ($1,$2,$3,CURRENT_DATE)',
        [ATTIVITA_ID, ISCRIZIONE_LIBERA, DOCENTE_ID]
      ).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e.code }));

      await new Promise((r) => setTimeout(r, 100)); // lascia che c2 si metta in attesa del lock
      await c1.query('COMMIT');
      const esitoC2 = await c2Promise;
      assert.equal(esitoC2.ok, false);
      assert.equal(esitoC2.code, '23505'); // unique_violation: il vincolo ha impedito il duplicato
    } finally {
      await c1.query('ROLLBACK').catch(() => {});
      await c2.query('ROLLBACK').catch(() => {});
      // La riga inserita da c1 è stata comunque committata (era prima del COMMIT sopra):
      // la rimuovo esplicitamente per non sporcare il database di prova tra un'esecuzione e l'altra.
      await pool.query(
        'DELETE FROM osservazioni WHERE attivita_id=$1 AND iscrizione_id=$2 AND docente_id=$3 '
        + 'AND NOT EXISTS (SELECT 1 FROM valutazioni_criteri v WHERE v.osservazione_id = osservazioni.id)',
        [ATTIVITA_ID, ISCRIZIONE_LIBERA, DOCENTE_ID]
      ).catch(() => {});
    }
  } finally {
    c1.release();
    c2.release();
  }
});

test('Griglia dell\'attività: struttura e "Non valutato" reso come null, non come 0', async () => {
  await conTransazioneDiProva(async (client) => {
    const griglia = await q.getGrigliaAttivita(client, ATTIVITA_ID, DOCENTE_ID);
    assert.equal(griglia.grigliaNonConfigurata, false);
    assert.equal(griglia.criteri.length, 6);
    const alunno1 = griglia.righe.find((r) => r.iscrizioneId === 1);
    assert.ok(alunno1, 'l\'alunno con iscrizione 1 deve comparire in griglia');
    // Nei dati di prova l'osservazione 1 ha 6 criteri valutati: 0,2,1,1,2,2
    assert.equal(alunno1.valutazionePresenti, 6);
    assert.equal(alunno1.esito.percentuale, 66.67);
    assert.equal(alunno1.esito.giudizio, 'DISCRETO');
    const alunno2 = griglia.righe.find((r) => r.iscrizioneId === 2);
    // L'alunno 2 ha un solo criterio valutato (2): le altre celle devono essere null, non 0.
    const celleNonValutate = alunno2.celle.filter((c) => c.criterioId !== CRITERIO_NUCLEO_1);
    assert.ok(celleNonValutate.every((c) => c.punteggio === null));
  });
});

test('Sviluppo cumulativo del criterio: due attività diverse si sommano (Caso E con dati reali)', async () => {
  await conTransazioneDiProva(async (client) => {
    // Nei dati di prova: persona 2 (iscrizione 1) ha criterio 1 valutato 0
    // nell'attività 1 e 1 nell'attività 2 (stesso nucleo, stessa persona).
    const esito = await q.getStoricoCriterio(client, {
      personaId: 2, annoScolasticoId: 1, nucleoId: 1, criterioId: CRITERIO_NUCLEO_1, docenteId: DOCENTE_ID,
    });
    assert.equal(esito.punteggioOttenuto, 1);
    assert.equal(esito.punteggioMassimo, 4);
    assert.equal(esito.percentuale, 25);
  });
});

test('Nessuna valutazione presente: percentuale nulla e giudizio vuoto (Caso D con dati reali)', async () => {
  await conTransazioneDiProva(async (client) => {
    // Nucleo 2: nei dati di prova non esiste alcuna attività su questo nucleo,
    // quindi nessuna valutazione può esistere per costruzione (non solo per assenza di dati).
    const esito = await q.getStoricoCriterio(client, {
      personaId: 2, annoScolasticoId: 1, nucleoId: 2, criterioId: CRITERIO_NUCLEO_2, docenteId: DOCENTE_ID,
    });
    assert.equal(esito.percentuale, null);
    assert.equal(esito.giudizio, '');
  });
});

// --- Studenti della classe e progresso complessivo -------------------------
//
// Dati creati DENTRO la transazione di prova (annullata alla fine), a partire
// solo dalla struttura di base: insegnamento 1 (docente 1, Matematica, 3A,
// anno 1), nuclei 1-3 con criteri 1-6 (nucleo 1) e 7-12 (nucleo 2).

const NUCLEO_1 = 1;
const NUCLEO_2 = 2;
const NUCLEO_3 = 3;
const CRITERIO_2_NUCLEO_1 = 2;

async function creaPersona(client, nome, cognome) {
  const { rows } = await client.query(
    'INSERT INTO persone (nome, cognome) VALUES ($1, $2) RETURNING id', [nome, cognome]
  );
  return rows[0].id;
}

async function creaIscrizione(client, personaId, { classeId, annoScolasticoId, attiva = true }) {
  const { rows } = await client.query(
    `INSERT INTO iscrizioni (persona_id, classe_id, anno_scolastico_id, attiva)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [personaId, classeId, annoScolasticoId, attiva]
  );
  return rows[0].id;
}

/**
 * Scenario:
 * - "Senzavoti": iscritto attivo in 3A, nessuna valutazione.
 * - "Multi": iscritto attivo in 3A, valutato dal docente 1 su due attività
 *   del nucleo 1 (criterio 1: 0 poi 2; criterio 2: 2) e una del nucleo 2
 *   (criterio 7: 1).
 * - Valutazioni di "Multi" FUORI ambito, che non devono mai essere contate:
 *   un altro docente sulla stessa classe/materia (criterio 1: 2) e il
 *   docente 1 su un'altra materia (Scienze, prova).
 * - "Ritirato": iscrizione NON attiva in 3A.
 */
async function preparaScenarioStudenti(client) {
  const { rows: [ins] } = await client.query(
    'SELECT materia_id, classe_id, anno_scolastico_id FROM insegnamenti WHERE id = $1', [INSEGNAMENTO_ID]
  );
  const classe = { classeId: ins.classe_id, annoScolasticoId: ins.anno_scolastico_id };

  const personaSenzaVoti = await creaPersona(client, 'Zeno', 'Senzavoti');
  const iscrizioneSenzaVoti = await creaIscrizione(client, personaSenzaVoti, classe);
  const personaMulti = await creaPersona(client, 'Marta', 'Multi');
  const iscrizioneMulti = await creaIscrizione(client, personaMulti, classe);
  const personaRitirata = await creaPersona(client, 'Rita', 'Ritirato');
  const iscrizioneRitirata = await creaIscrizione(client, personaRitirata, { ...classe, attiva: false });

  const nuovaAttivita = async (insegnamentoId, docenteId, nome, data, nucleoTematicoId) => (
    await q.creaAttivita(client, { insegnamentoId, docenteId, nome, dataAttivita: data, nucleoTematicoId })
  ).attivita_id;
  const valuta = (attivitaId, docenteId, criterioId, punteggio) => q.salvaValutazione(client, {
    attivitaId, iscrizioneId: iscrizioneMulti, criterioId, punteggio, docenteId,
  });

  // Ambito corretto: docente 1, insegnamento 1.
  const attivitaN1a = await nuovaAttivita(INSEGNAMENTO_ID, DOCENTE_ID, 'Prova N1 (a)', '2025-11-03', NUCLEO_1);
  const attivitaN1b = await nuovaAttivita(INSEGNAMENTO_ID, DOCENTE_ID, 'Prova N1 (b)', '2025-11-17', NUCLEO_1);
  const attivitaN2 = await nuovaAttivita(INSEGNAMENTO_ID, DOCENTE_ID, 'Prova N2', '2025-11-10', NUCLEO_2);
  await valuta(attivitaN1a, DOCENTE_ID, CRITERIO_NUCLEO_1, 0);
  await valuta(attivitaN1a, DOCENTE_ID, CRITERIO_2_NUCLEO_1, 2);
  await valuta(attivitaN1b, DOCENTE_ID, CRITERIO_NUCLEO_1, 2);
  await valuta(attivitaN2, DOCENTE_ID, CRITERIO_NUCLEO_2, 1);

  // Fuori ambito (1): un altro docente, stessa materia e stessa classe/anno.
  const altroDocente = await creaPersona(client, 'Altro', 'Docente');
  const { rows: [altroIns] } = await client.query(
    `INSERT INTO insegnamenti (docente_id, materia_id, classe_id, anno_scolastico_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [altroDocente, ins.materia_id, ins.classe_id, ins.anno_scolastico_id]
  );
  const attivitaAltroDocente = await nuovaAttivita(altroIns.id, altroDocente, 'Prova altro docente', '2025-11-05', NUCLEO_1);
  await valuta(attivitaAltroDocente, altroDocente, CRITERIO_NUCLEO_1, 2);

  // Fuori ambito (2): stesso docente, altra materia sulla stessa classe/anno.
  const { rows: [scienze] } = await client.query("INSERT INTO materie (nome) VALUES ('Scienze (prova)') RETURNING id");
  const { rows: [nucleoScienze] } = await client.query(
    "INSERT INTO nuclei_tematici (materia_id, nome) VALUES ($1, 'Viventi (prova)') RETURNING id", [scienze.id]
  );
  const { rows: [criterioScienze] } = await client.query(
    "INSERT INTO criteri_osservazione (nucleo_tematico_id, nome, ordine) VALUES ($1, 'Osservazione (prova)', 1) RETURNING id",
    [nucleoScienze.id]
  );
  const { rows: [insScienze] } = await client.query(
    `INSERT INTO insegnamenti (docente_id, materia_id, classe_id, anno_scolastico_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [DOCENTE_ID, scienze.id, ins.classe_id, ins.anno_scolastico_id]
  );
  const attivitaScienze = await nuovaAttivita(insScienze.id, DOCENTE_ID, 'Prova Scienze', '2025-11-06', nucleoScienze.id);
  await valuta(attivitaScienze, DOCENTE_ID, criterioScienze.id, 0);

  return {
    annoScolasticoId: ins.anno_scolastico_id,
    personaMulti, iscrizioneMulti, iscrizioneSenzaVoti, iscrizioneRitirata,
    altroDocente, altroInsegnamentoId: altroIns.id,
    attivitaN1a, attivitaN1b,
  };
}

const trovaNucleo = (progresso, id) => progresso.nuclei.find((n) => n.id === id);
const trovaCriterio = (nucleo, id) => nucleo.criteri.find((c) => c.id === id);

test('Studenti: la lista viene da iscrizioni attive e include chi non ha alcuna valutazione (Non valutato)', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioStudenti(client);
    const dati = await q.getStudentiDellInsegnamento(client, INSEGNAMENTO_ID, DOCENTE_ID);

    const senzaVoti = dati.studenti.find((x) => x.iscrizioneId === s.iscrizioneSenzaVoti);
    assert.ok(senzaVoti, 'lo studente senza valutazioni deve comparire nella lista');
    assert.equal(senzaVoti.cognome, 'Senzavoti');
    assert.equal(senzaVoti.complessivo.risultatoCorrente.percentuale, null);
    assert.equal(senzaVoti.complessivo.risultatoCorrente.giudizio, '');
    assert.equal(senzaVoti.complessivo.cumulativoDaInizioAnno.percentuale, null);
    assert.equal(senzaVoti.complessivo.criteriValutati, 0);
    assert.equal(senzaVoti.complessivo.criteriTotali, 18);
    assert.equal(senzaVoti.nuclei.length, 3);
    assert.ok(senzaVoti.nuclei.every((n) => n.risultatoCorrente.percentuale === null && n.criteriValutati === 0));

    const dettaglio = await q.getProgressoStudente(client, {
      insegnamentoId: INSEGNAMENTO_ID, iscrizioneId: s.iscrizioneSenzaVoti, docenteId: DOCENTE_ID,
    });
    dettaglio.nuclei.forEach((n) => n.criteri.forEach((c) => {
      assert.deepEqual(c.osservazioni, []);
      assert.equal(c.risultatoCorrente.percentuale, null);
      assert.equal(c.risultatoCorrente.media, null);
    }));

    // Le iscrizioni non attive e quelle di altre classi non compaiono.
    assert.ok(!dati.studenti.some((x) => x.iscrizioneId === s.iscrizioneRitirata), 'iscrizione non attiva esclusa');
    assert.ok(!dati.studenti.some((x) => x.iscrizioneId === ISCRIZIONE_ALTRA_CLASSE), 'altra classe esclusa');
    // L'identificativo dello studente nel report è iscrizioni.id.
    assert.equal(dettaglio.iscrizioneId, s.iscrizioneSenzaVoti);
  });
});

test('Studenti: un criterio valutato in più attività mostra tutta la storia e il risultato corrente', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioStudenti(client);
    const p = await q.getProgressoStudente(client, {
      insegnamentoId: INSEGNAMENTO_ID, iscrizioneId: s.iscrizioneMulti, docenteId: DOCENTE_ID,
    });
    const criterio = trovaCriterio(trovaNucleo(p, NUCLEO_1), CRITERIO_NUCLEO_1);
    assert.deepEqual(
      criterio.osservazioni.map((o) => [o.attivitaId, o.attivita, o.punteggio, o.etichetta, o.inRisultatoCorrente]),
      [
        [s.attivitaN1a, 'Prova N1 (a)', 0, 'Non manifestato', true],
        [s.attivitaN1b, 'Prova N1 (b)', 2, 'Autonomo', true],
      ],
      'storia completa, in ordine di data, senza la valutazione dell\'altro docente'
    );
    assert.ok(criterio.osservazioni.every((o) => o.dataAttivita), 'ogni livello osservato riporta la data');
    // Due osservazioni (meno della finestra): il risultato corrente è la media di entrambe.
    assert.equal(criterio.risultatoCorrente.media, 1);
    assert.equal(criterio.risultatoCorrente.percentuale, 50);
    assert.equal(criterio.risultatoCorrente.giudizio, 'SUFFICIENTE');
    assert.equal(criterio.risultatoCorrente.osservazioniConsiderate, 2);
    assert.equal(criterio.cumulativoDaInizioAnno.percentuale, 50);
  });
});

test('Studenti: con più di 3 osservazioni il risultato corrente usa le ultime 3, lo storico le mostra tutte', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioStudenti(client);
    const nuovaAttivita = async (nome, data) => (await q.creaAttivita(client, {
      insegnamentoId: INSEGNAMENTO_ID, docenteId: DOCENTE_ID, nome, dataAttivita: data, nucleoTematicoId: NUCLEO_1,
    })).attivita_id;
    // Create volutamente in ordine NON cronologico: l'ordine deve venire dalla data, non dall'inserimento.
    const ottobre = await nuovaAttivita('Altra attività (ottobre)', '2025-10-15');
    const novembre = await nuovaAttivita('Altra attività (novembre)', '2025-11-20');
    const addizioni = await nuovaAttivita('Addizioni e sottrazioni', '2025-09-21');
    const decimali = await nuovaAttivita('Numeri decimali', '2025-09-21'); // stessa data, id maggiore
    const valuta = (attivitaId, punteggio) => q.salvaValutazione(client, {
      attivitaId, iscrizioneId: s.iscrizioneSenzaVoti, criterioId: CRITERIO_2_NUCLEO_1, punteggio, docenteId: DOCENTE_ID,
    });
    // Storico: 0 (addizioni, 21/09), 1 (decimali, 21/09), 2 (15/10), 2 (20/11).
    await valuta(addizioni, 0);
    await valuta(decimali, 1);
    await valuta(ottobre, 2);
    await valuta(novembre, 2);

    const { rows: [prima] } = await client.query('SELECT COUNT(*)::int AS n FROM valutazioni_criteri');
    const p = await q.getProgressoStudente(client, {
      insegnamentoId: INSEGNAMENTO_ID, iscrizioneId: s.iscrizioneSenzaVoti, docenteId: DOCENTE_ID,
    });
    const criterio = trovaCriterio(trovaNucleo(p, NUCLEO_1), CRITERIO_2_NUCLEO_1);

    // Storico completo, in ordine cronologico; a parità di data decide l'id dell'attività.
    assert.deepEqual(
      criterio.osservazioni.map((o) => [o.attivitaId, o.punteggio, o.inRisultatoCorrente]),
      [[addizioni, 0, false], [decimali, 1, true], [ottobre, 2, true], [novembre, 2, true]]
    );
    // Risultato corrente: (1 + 2 + 2) / 3 = 1,67 -> 83,33% DISTINTO (non (0+1+2+2)/4).
    assert.equal(criterio.risultatoCorrente.media, 1.67);
    assert.equal(criterio.risultatoCorrente.percentuale, 83.33);
    assert.equal(criterio.risultatoCorrente.giudizio, 'DISTINTO');
    assert.equal(criterio.risultatoCorrente.osservazioniConsiderate, 3);
    assert.equal(criterio.risultatoCorrente.osservazioniTotali, 4);
    // Cumulativo da inizio anno ancora disponibile: 5/8 = 62,5%.
    assert.equal(criterio.cumulativoDaInizioAnno.punteggioOttenuto, 5);
    assert.equal(criterio.cumulativoDaInizioAnno.punteggioMassimo, 8);

    // Q4 restituisce lo stesso risultato corrente.
    const q4 = await q.getStoricoCriterio(client, {
      personaId: p.personaId, annoScolasticoId: s.annoScolasticoId, nucleoId: NUCLEO_1,
      criterioId: CRITERIO_2_NUCLEO_1, docenteId: DOCENTE_ID,
    });
    assert.equal(q4.media, 1.67);
    assert.equal(q4.percentuale, 83.33);

    // Il calcolo è solo in lettura: nessuna osservazione cancellata o aggiunta.
    const { rows: [dopo] } = await client.query('SELECT COUNT(*)::int AS n FROM valutazioni_criteri');
    assert.equal(dopo.n, prima.n);
    const { rows: [nelDb] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM valutazioni_criteri v JOIN osservazioni o ON o.id = v.osservazione_id
       WHERE o.iscrizione_id = $1 AND v.criterio_id = $2`,
      [s.iscrizioneSenzaVoti, CRITERIO_2_NUCLEO_1]
    );
    assert.equal(criterio.osservazioni.length, nelDb.n, 'lo storico mostra tutte le osservazioni presenti nel database');
  });
});

test('Studenti: i nuclei restano separati; nucleo e materia sono la media dei risultati correnti dei criteri', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioStudenti(client);
    const p = await q.getProgressoStudente(client, {
      insegnamentoId: INSEGNAMENTO_ID, iscrizioneId: s.iscrizioneMulti, docenteId: DOCENTE_ID,
    });
    const n1 = trovaNucleo(p, NUCLEO_1);
    const n2 = trovaNucleo(p, NUCLEO_2);
    const n3 = trovaNucleo(p, NUCLEO_3);
    // Nucleo 1: criterio 1 media 1 (0, 2), criterio 2 media 2 -> (1 + 2) / 2 = 1,5 -> 75% BUONO.
    // (Mettendo insieme i punteggi sarebbe stato 4/6 = 66,67%: il criterio 1 peserebbe il doppio.)
    assert.equal(n1.risultatoCorrente.media, 1.5);
    assert.equal(n1.risultatoCorrente.percentuale, 75);
    assert.equal(n1.risultatoCorrente.giudizio, 'BUONO');
    assert.equal(n1.risultatoCorrente.criteriConsiderati, 2);
    assert.equal(n1.cumulativoDaInizioAnno.percentuale, 66.67);
    assert.equal(n1.criteriValutati, 2);
    assert.equal(n1.criteriTotali, 6);
    // Nucleo 2: solo il criterio 7 (1); nessuna valutazione del nucleo 1 vi confluisce.
    assert.equal(n2.risultatoCorrente.media, 1);
    assert.equal(n2.risultatoCorrente.percentuale, 50);
    assert.equal(n2.criteriValutati, 1);
    assert.deepEqual(trovaCriterio(n2, CRITERIO_NUCLEO_2).osservazioni.map((o) => o.punteggio), [1]);
    // Nucleo 3: nessuna attività -> Non valutato.
    assert.equal(n3.risultatoCorrente.percentuale, null);
    assert.equal(n3.criteriValutati, 0);
    // Materia: media dei 3 criteri valutati, a pesi uguali: (1 + 2 + 1) / 3 = 1,33 -> 66,67% DISCRETO.
    assert.equal(p.complessivo.risultatoCorrente.media, 1.33);
    assert.equal(p.complessivo.risultatoCorrente.percentuale, 66.67);
    assert.equal(p.complessivo.risultatoCorrente.giudizio, 'DISCRETO');
    assert.equal(p.complessivo.risultatoCorrente.criteriConsiderati, 3);
    // Cumulativo da inizio anno (tutte le valutazioni): 5/8 = 62,5%.
    assert.equal(p.complessivo.cumulativoDaInizioAnno.percentuale, 62.5);
    assert.equal(p.complessivo.criteriValutati, 3);
    assert.equal(p.complessivo.criteriTotali, 18);

    // La lista riporta gli stessi valori del dettaglio.
    const lista = await q.getStudentiDellInsegnamento(client, INSEGNAMENTO_ID, DOCENTE_ID);
    const riga = lista.studenti.find((x) => x.iscrizioneId === s.iscrizioneMulti);
    assert.deepEqual(riga.complessivo, p.complessivo);
    assert.deepEqual(riga.nuclei, p.nuclei.map(({ criteri, ...resto }) => resto));
  });
});

test('Studenti: le attività di altri insegnamenti (altro docente o altra materia) sono escluse', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioStudenti(client);
    const p = await q.getProgressoStudente(client, {
      insegnamentoId: INSEGNAMENTO_ID, iscrizioneId: s.iscrizioneMulti, docenteId: DOCENTE_ID,
    });
    // Solo i 3 nuclei di Matematica: il nucleo di Scienze non compare.
    assert.deepEqual(p.nuclei.map((n) => n.id).sort(), [NUCLEO_1, NUCLEO_2, NUCLEO_3]);
    // Il 2 dato dall'altro docente sul criterio 1 non entra né nella storia né nei risultati.
    const criterio1 = trovaCriterio(trovaNucleo(p, NUCLEO_1), CRITERIO_NUCLEO_1);
    assert.equal(criterio1.osservazioni.length, 2);
    assert.equal(criterio1.risultatoCorrente.media, 1);
    assert.equal(p.complessivo.cumulativoDaInizioAnno.punteggioMassimo, 8);

    // Specularmente, l'altro docente vede solo la propria valutazione.
    const pAltro = await q.getProgressoStudente(client, {
      insegnamentoId: s.altroInsegnamentoId, iscrizioneId: s.iscrizioneMulti, docenteId: s.altroDocente,
    });
    assert.equal(pAltro.complessivo.risultatoCorrente.media, 2);
    assert.equal(pAltro.complessivo.cumulativoDaInizioAnno.punteggioOttenuto, 2);
    assert.equal(pAltro.complessivo.cumulativoDaInizioAnno.punteggioMassimo, 2);
  });
});

test('Studenti: autorizzazione del docente e coerenza iscrizione/classe (404 uniforme)', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioStudenti(client);
    await assert.rejects(
      () => q.getStudentiDellInsegnamento(client, INSEGNAMENTO_ID, DOCENTE_ESTRANEO_ID),
      (errore) => errore.stato === 404
    );
    await assert.rejects(
      () => q.getProgressoStudente(client, {
        insegnamentoId: INSEGNAMENTO_ID, iscrizioneId: s.iscrizioneMulti, docenteId: DOCENTE_ESTRANEO_ID,
      }),
      (errore) => errore.stato === 404
    );
    // L'altro docente non può aprire l'insegnamento del docente 1, anche se insegna nella stessa classe.
    await assert.rejects(
      () => q.getProgressoStudente(client, {
        insegnamentoId: INSEGNAMENTO_ID, iscrizioneId: s.iscrizioneMulti, docenteId: s.altroDocente,
      }),
      (errore) => errore.stato === 404
    );
    // Iscrizione di un'altra classe o non attiva: 404.
    for (const iscrizioneId of [ISCRIZIONE_ALTRA_CLASSE, s.iscrizioneRitirata]) {
      await assert.rejects(
        () => q.getProgressoStudente(client, { insegnamentoId: INSEGNAMENTO_ID, iscrizioneId, docenteId: DOCENTE_ID }),
        (errore) => errore.stato === 404
      );
    }
  });
});

test('Studenti: 0 (Non manifestato) resta distinto da Non valutato, anche dopo la rimozione di un punteggio', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioStudenti(client);
    // Criterio 2 del nucleo 1 portato a 0 nell'attività (a); criterio 3 mai valutato.
    await q.salvaValutazione(client, {
      attivitaId: s.attivitaN1a, iscrizioneId: s.iscrizioneMulti, criterioId: CRITERIO_2_NUCLEO_1,
      punteggio: 0, docenteId: DOCENTE_ID,
    });
    let n1 = trovaNucleo(await q.getProgressoStudente(client, {
      insegnamentoId: INSEGNAMENTO_ID, iscrizioneId: s.iscrizioneMulti, docenteId: DOCENTE_ID,
    }), NUCLEO_1);
    const zero = trovaCriterio(n1, CRITERIO_2_NUCLEO_1);
    assert.deepEqual(zero.osservazioni.map((o) => [o.punteggio, o.etichetta]), [[0, 'Non manifestato']]);
    assert.equal(zero.risultatoCorrente.media, 0);
    assert.equal(zero.risultatoCorrente.percentuale, 0);
    assert.equal(zero.risultatoCorrente.giudizio, 'NON SUFFICIENTE');
    const maiValutato = trovaCriterio(n1, 3);
    assert.deepEqual(maiValutato.osservazioni, []);
    assert.equal(maiValutato.risultatoCorrente.percentuale, null);
    assert.equal(n1.criteriValutati, 2, 'un criterio valutato 0 conta come valutato');
    // Il criterio a 0 entra nella media del nucleo: (1 + 0) / 2 = 0,5 -> 25%.
    assert.equal(n1.risultatoCorrente.media, 0.5);
    assert.equal(n1.risultatoCorrente.percentuale, 25);

    // "Non valutato" (punteggio null) elimina la valutazione: sparisce dalla storia, non diventa 0.
    await q.salvaValutazione(client, {
      attivitaId: s.attivitaN1a, iscrizioneId: s.iscrizioneMulti, criterioId: CRITERIO_2_NUCLEO_1,
      punteggio: null, docenteId: DOCENTE_ID,
    });
    n1 = trovaNucleo(await q.getProgressoStudente(client, {
      insegnamentoId: INSEGNAMENTO_ID, iscrizioneId: s.iscrizioneMulti, docenteId: DOCENTE_ID,
    }), NUCLEO_1);
    assert.deepEqual(trovaCriterio(n1, CRITERIO_2_NUCLEO_1).osservazioni, []);
    assert.equal(trovaCriterio(n1, CRITERIO_2_NUCLEO_1).risultatoCorrente.percentuale, null);
    assert.equal(n1.criteriValutati, 1);
    // Resta solo il criterio 1 (media 1): il criterio non valutato è escluso, non conta come 0.
    assert.equal(n1.risultatoCorrente.media, 1);
    assert.equal(n1.risultatoCorrente.percentuale, 50);
    assert.equal(n1.cumulativoDaInizioAnno.punteggioMassimo, 4, 'solo le 2 valutazioni rimaste del criterio 1');
  });
});

test('Studenti: nuclei e criteri coincidono con Q5 (getRiepilogoNucleo) e Q4 (getStoricoCriterio)', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioStudenti(client);
    const lista = await q.getStudentiDellInsegnamento(client, INSEGNAMENTO_ID, DOCENTE_ID);
    // Tutti gli studenti della classe (dati di base compresi), non solo quelli dello scenario.
    for (const studente of lista.studenti) {
      const p = await q.getProgressoStudente(client, {
        insegnamentoId: INSEGNAMENTO_ID, iscrizioneId: studente.iscrizioneId, docenteId: DOCENTE_ID,
      });
      for (const nucleo of p.nuclei) {
        const q5 = await q.getRiepilogoNucleo(client, {
          personaId: p.personaId, annoScolasticoId: s.annoScolasticoId, nucleoId: nucleo.id, docenteId: DOCENTE_ID,
        });
        assert.deepEqual(
          q5, { ...nucleo.risultatoCorrente, cumulativoDaInizioAnno: nucleo.cumulativoDaInizioAnno },
          `nucleo ${nucleo.id}, iscrizione ${studente.iscrizioneId}: diverso da Q5`
        );
        for (const criterio of nucleo.criteri) {
          const q4 = await q.getStoricoCriterio(client, {
            personaId: p.personaId, annoScolasticoId: s.annoScolasticoId, nucleoId: nucleo.id,
            criterioId: criterio.id, docenteId: DOCENTE_ID,
          });
          assert.deepEqual(
            q4, { ...criterio.risultatoCorrente, cumulativoDaInizioAnno: criterio.cumulativoDaInizioAnno },
            `criterio ${criterio.id}, iscrizione ${studente.iscrizioneId}: diverso da Q4`
          );
        }
      }
    }
  });
});

test('Esito della singola attività invariato: la griglia usa solo le valutazioni di quell\'attività', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioStudenti(client);
    // Attività (b): per "Multi" c'è solo il criterio 1 = 2 -> esito dell'attività 2/2 = 100%,
    // anche se il risultato corrente del criterio (media di 0 e 2) è 50%.
    const griglia = await q.getGrigliaAttivita(client, s.attivitaN1b, DOCENTE_ID);
    const riga = griglia.righe.find((r) => r.iscrizioneId === s.iscrizioneMulti);
    assert.equal(riga.valutazionePresenti, 1);
    assert.deepEqual(riga.esito, { punteggioOttenuto: 2, punteggioMassimo: 2, percentuale: 100, giudizio: 'OTTIMO' });
    const scheda = await q.getSchedaAlunno(client, {
      attivitaId: s.attivitaN1b, iscrizioneId: s.iscrizioneMulti, docenteId: DOCENTE_ID,
    });
    assert.deepEqual(scheda.esito, riga.esito);
  });
});

// --- Report classe (fotografia di una singola attività) --------------------
//
// Scenario dedicato: una nuova attività (A) del nucleo 1 con punteggi 0/1/2
// misti sul criterio 1, un secondo criterio valutato da un solo alunno, un
// terzo criterio mai valutato in A, più due attività successive (B, C) sullo
// stesso nucleo per verificare che il report ignori sia le altre attività
// sia la media mobile. Il roster di 3A comprende anche Anna e Luca (dati di
// base, vedi tests/README_DATI_DI_PROVA.md), mai valutati in queste attività.

const CRITERIO_3_NUCLEO_1 = 3; // "Relazioni quantitative", nucleo 1: mai valutato in questo scenario

async function preparaScenarioReportClasse(client) {
  const { rows: [ins] } = await client.query(
    'SELECT materia_id, classe_id, anno_scolastico_id FROM insegnamenti WHERE id = $1', [INSEGNAMENTO_ID]
  );
  const classe = { classeId: ins.classe_id, annoScolasticoId: ins.anno_scolastico_id };

  const personaZero = await creaPersona(client, 'Zeta', 'Zero');
  const iscrizioneZero = await creaIscrizione(client, personaZero, classe);
  const personaUno = await creaPersona(client, 'Ugo', 'Uno');
  const iscrizioneUno = await creaIscrizione(client, personaUno, classe);
  const personaDue = await creaPersona(client, 'Dario', 'Due');
  const iscrizioneDue = await creaIscrizione(client, personaDue, classe);
  const personaSenza = await creaPersona(client, 'Sandra', 'Senzapunteggio');
  const iscrizioneSenza = await creaIscrizione(client, personaSenza, classe);

  const nuovaAttivita = async (nome, data) => (await q.creaAttivita(client, {
    insegnamentoId: INSEGNAMENTO_ID, docenteId: DOCENTE_ID, nome, dataAttivita: data, nucleoTematicoId: NUCLEO_1,
  })).attivita_id;
  const attivitaA = await nuovaAttivita('Report — prova A', '2025-12-01');
  const attivitaB = await nuovaAttivita('Report — prova B', '2025-12-08');
  const attivitaC = await nuovaAttivita('Report — prova C', '2025-12-15');

  const valuta = (attivitaId, iscrizioneId, criterioId, punteggio) => q.salvaValutazione(client, {
    attivitaId, iscrizioneId, criterioId, punteggio, docenteId: DOCENTE_ID,
  });

  // Attività A: quella sotto test. Criterio 1 misto 0/1/2, criterio 2 valutato da un solo alunno, criterio 3 mai.
  await valuta(attivitaA, iscrizioneZero, CRITERIO_NUCLEO_1, 0);
  await valuta(attivitaA, iscrizioneUno, CRITERIO_NUCLEO_1, 1);
  await valuta(attivitaA, iscrizioneDue, CRITERIO_NUCLEO_1, 2);
  await valuta(attivitaA, iscrizioneDue, CRITERIO_2_NUCLEO_1, 2);

  // Attività B/C: successive, stesso nucleo/criterio, MAI devono comparire nel report di A.
  await valuta(attivitaB, iscrizioneSenza, CRITERIO_NUCLEO_1, 2);
  await valuta(attivitaB, iscrizioneZero, CRITERIO_NUCLEO_1, 2);
  await valuta(attivitaC, iscrizioneZero, CRITERIO_NUCLEO_1, 2);

  return { iscrizioneZero, iscrizioneUno, iscrizioneDue, iscrizioneSenza, attivitaA, attivitaB, attivitaC };
}

test('Report classe: criterio con punteggi 0/1/2 misti, distribuzione e percentuale corrette', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioReportClasse(client);
    const report = await q.getReportClasseAttivita(client, s.attivitaA, DOCENTE_ID);
    assert.equal(report.grigliaNonConfigurata, false);
    // Roster: Anna e Luca (seed) + Zero, Uno, Due, Senza = 6 alunni attivi in 3A.
    assert.equal(report.totaleAlunni, 6);
    const nucleo = report.nuclei.find((n) => n.id === NUCLEO_1);
    const c1 = nucleo.criteri.find((c) => c.id === CRITERIO_NUCLEO_1);
    assert.equal(c1.valutati, 3);
    assert.equal(c1.nonValutati, 3);
    assert.deepEqual(c1.distribuzione, { 0: 1, 1: 1, 2: 1 });
    assert.equal(c1.esito.punteggioOttenuto, 3);
    assert.equal(c1.esito.punteggioMassimo, 6);
    assert.equal(c1.esito.percentuale, 50);
    assert.equal(c1.esito.giudizio, 'SUFFICIENTE');
  });
});

test('Report classe: un criterio con alcuni alunni non valutati non li conta come 0', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioReportClasse(client);
    const report = await q.getReportClasseAttivita(client, s.attivitaA, DOCENTE_ID);
    const nucleo = report.nuclei.find((n) => n.id === NUCLEO_1);
    const c2 = nucleo.criteri.find((c) => c.id === CRITERIO_2_NUCLEO_1);
    assert.equal(c2.valutati, 1);
    assert.equal(c2.nonValutati, 5);
    assert.deepEqual(c2.distribuzione, { 0: 0, 1: 0, 2: 1 });
    assert.equal(c2.esito.percentuale, 100);
    assert.equal(c2.esito.giudizio, 'OTTIMO');
  });
});

test('Report classe: un criterio mai valutato in questa attività è "Non valutato", non 0%', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioReportClasse(client);
    const report = await q.getReportClasseAttivita(client, s.attivitaA, DOCENTE_ID);
    const nucleo = report.nuclei.find((n) => n.id === NUCLEO_1);
    const c3 = nucleo.criteri.find((c) => c.id === CRITERIO_3_NUCLEO_1);
    assert.equal(c3.valutati, 0);
    assert.equal(c3.nonValutati, 6);
    assert.deepEqual(c3.distribuzione, { 0: 0, 1: 0, 2: 0 });
    assert.equal(c3.esito.percentuale, null);
    assert.equal(c3.esito.giudizio, '');
  });
});

test('Report classe: il risultato del nucleo è la media semplice dei risultati percentuali dei criteri valutati, non il pool di tutti i punteggi', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioReportClasse(client);
    const report = await q.getReportClasseAttivita(client, s.attivitaA, DOCENTE_ID);
    const nucleo = report.nuclei.find((n) => n.id === NUCLEO_1);
    // Criterio 1: 50%, criterio 2: 100% -> media (50+100)/2 = 75%, non il pool (0+1+2+2)/(4*2) = 62,5%.
    assert.equal(nucleo.risultato.criteriConsiderati, 2);
    assert.equal(nucleo.risultato.percentuale, 75);
    assert.equal(nucleo.risultato.giudizio, 'BUONO');
    assert.notEqual(nucleo.risultato.percentuale, 62.5);
    // Un'attività appartiene a un solo nucleo tematico: il complessivo coincide col nucleo.
    assert.deepEqual(report.complessivo, nucleo.risultato);
  });
});

test('Report classe: i dati di un\'altra attività sono completamente esclusi', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioReportClasse(client);
    const report = await q.getReportClasseAttivita(client, s.attivitaA, DOCENTE_ID);
    const nucleo = report.nuclei.find((n) => n.id === NUCLEO_1);
    const c1 = nucleo.criteri.find((c) => c.id === CRITERIO_NUCLEO_1);
    // "Senza" ha un punteggio SOLO nell'attività B (criterio 1 = 2): non deve comparire nel report di A.
    assert.equal(c1.valutati, 3, 'il punteggio di "Senza" in un\'altra attività non deve contare');
    assert.equal(c1.distribuzione[2], 1, 'solo "Due" contribuisce al punteggio 2 in questa attività');
  });
});

test('Report classe: la media mobile è completamente esclusa', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioReportClasse(client);
    // "Zero" ha punteggio 0 nell'attività A, poi 2 in B e 2 in C sullo stesso criterio: la
    // media mobile (ultime 3) sarebbe (0+2+2)/3 = 1,33 (66,67%), ma il report di A deve
    // riflettere solo lo 0 di questa attività.
    const report = await q.getReportClasseAttivita(client, s.attivitaA, DOCENTE_ID);
    const nucleo = report.nuclei.find((n) => n.id === NUCLEO_1);
    const c1 = nucleo.criteri.find((c) => c.id === CRITERIO_NUCLEO_1);
    assert.deepEqual(c1.distribuzione, { 0: 1, 1: 1, 2: 1 });
    assert.equal(c1.esito.percentuale, 50);
    assert.notEqual(c1.esito.percentuale, 66.67);
  });
});

test('Report classe: un docente estraneo riceve 404', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioReportClasse(client);
    await assert.rejects(
      () => q.getReportClasseAttivita(client, s.attivitaA, DOCENTE_ESTRANEO_ID),
      (errore) => errore.stato === 404
    );
  });
});

test('Report classe: attività senza alcuna valutazione', async () => {
  await conTransazioneDiProva(async (client) => {
    const vuota = (await q.creaAttivita(client, {
      insegnamentoId: INSEGNAMENTO_ID, docenteId: DOCENTE_ID,
      nome: 'Report — nessuna valutazione', dataAttivita: '2025-12-20', nucleoTematicoId: NUCLEO_1,
    })).attivita_id;
    const report = await q.getReportClasseAttivita(client, vuota, DOCENTE_ID);
    assert.equal(report.totaleAlunni, 2); // Anna e Luca, i soli iscritti attivi di 3A nei dati di base
    report.nuclei[0].criteri.forEach((c) => {
      assert.equal(c.valutati, 0);
      assert.equal(c.nonValutati, 2);
      assert.equal(c.esito.percentuale, null);
    });
    assert.equal(report.complessivo.percentuale, null);
    assert.equal(report.complessivo.giudizio, '');
  });
});

test('Report classe: coerente con la griglia della stessa attività (stessa fonte dati)', async () => {
  await conTransazioneDiProva(async (client) => {
    const s = await preparaScenarioReportClasse(client);
    const report = await q.getReportClasseAttivita(client, s.attivitaA, DOCENTE_ID);
    const griglia = await q.getGrigliaAttivita(client, s.attivitaA, DOCENTE_ID);
    const sommaGriglia = griglia.righe.reduce(
      (totale, r) => totale + r.celle.filter((c) => c.punteggio !== null).reduce((t, c) => t + c.punteggio, 0), 0
    );
    const sommaReport = report.nuclei[0].criteri.reduce((totale, c) => totale + (c.esito.punteggioOttenuto || 0), 0);
    assert.equal(sommaReport, sommaGriglia);
    assert.equal(report.totaleAlunni, griglia.righe.length);
  });
});

test('Studenti: le rotte HTTP rispondono 200 al docente titolare e 404 a un docente estraneo', async () => {
  const express = require('express');
  const routeAttivita = require('../server/routes/attivita');
  const { identificaDocente } = require('../server/auth');
  const app = express();
  app.use(express.json());
  app.use('/api', identificaDocente, routeAttivita);

  await new Promise((risolvi, rifiuta) => {
    const server = app.listen(0, async () => {
      try {
        const base = `http://127.0.0.1:${server.address().port}/api/insegnamenti/${INSEGNAMENTO_ID}/studenti`;
        const titolare = await fetch(base, { headers: { 'X-Docente-Id': String(DOCENTE_ID) } });
        assert.equal(titolare.status, 200);
        const corpo = await titolare.json();
        assert.ok(Array.isArray(corpo.studenti) && corpo.studenti.length > 0);
        const dettaglio = await fetch(`${base}/${corpo.studenti[0].iscrizioneId}/progresso`, {
          headers: { 'X-Docente-Id': String(DOCENTE_ID) },
        });
        assert.equal(dettaglio.status, 200);
        const estraneo = await fetch(base, { headers: { 'X-Docente-Id': String(DOCENTE_ESTRANEO_ID) } });
        assert.equal(estraneo.status, 404);
        risolvi();
      } catch (errore) {
        rifiuta(errore);
      } finally {
        server.close();
      }
    });
  });
});

test('Regressione: il server rifiuta di avviarsi se la migration 001 non è applicata (causa reale di "Errore interno")', { skip: !process.env.PGTEST_URL_SENZA_MIGRATION && 'PGTEST_URL_SENZA_MIGRATION non impostata: verifica NON eseguita, non dare per superata.' }, async () => {
  const { verificaVincoliRichiesti } = require('../server/db');
  const poolSenzaMigration = new (require('pg').Pool)({ connectionString: process.env.PGTEST_URL_SENZA_MIGRATION });
  try {
    await assert.rejects(() => verificaVincoliRichiesti(poolSenzaMigration), /Migration non applicata/);
  } finally {
    await poolSenzaMigration.end();
  }
});

test('Regressione: la diagnostica di un errore inatteso include endpoint, parametri e codice PostgreSQL (bug reale trovato e corretto)', async () => {
  const express = require('express');
  const routeAttivita = require('../server/routes/attivita');
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => { req.docenteId = DOCENTE_ID; next(); }, routeAttivita);

  await new Promise((risolvi) => {
    const server = app.listen(0, async () => {
      const porta = server.address().port;
      const originale = console.error;
      let catturato = '';
      console.error = (...pezzi) => { catturato += pezzi.join(' '); };
      try {
        // ID non numerico: genera un errore Postgres inatteso (non un ErroreApplicativo),
        // esattamente lo scenario in cui il bug si manifestava.
        await fetch(`http://127.0.0.1:${porta}/api/attivita/abc/griglia`);
      } finally {
        console.error = originale;
        server.close(() => risolvi());
      }
      const diagnostica = JSON.parse(catturato.replace('[errore] ', ''));
      assert.equal(diagnostica.endpoint, '/api/attivita/abc/griglia');
      assert.deepEqual(diagnostica.parametriPercorso, { attivitaId: 'abc' }); // prima della correzione: {}
      assert.ok(diagnostica.codicePostgres, 'deve riportare il codice PostgreSQL');
    });
  });
});

test.after(async () => {
  await pool.end();
});
