'use strict';

/**
 * Test di integrazione eseguiti su un PostgreSQL LOCALE con lo schema
 * migrato (001_vincoli_osservazioni.sql applicata) e dati equivalenti a
 * quelli di Access/Neon, NON sul database Neon reale (questo ambiente
 * non ha accesso di rete a Neon — vedi README).
 *
 * Richiede: PGTEST_URL puntato a un database Postgres locale con lo
 * schema del progetto già migrato (vedi README per come prepararlo).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// IMPORTANTE: uso lo stesso modulo di connessione del server (server/db.js),
// non un Pool creato a parte, per verificare esattamente lo stesso codice
// che gira in produzione (inclusa la conversione dei bigint in numeri:
// un Pool creato qui separatamente NON erediterebbe quella correzione,
// perché è un side-effect globale innescato dal solo require di server/db).
if (!process.env.PGTEST_URL) {
  throw new Error('Impostare PGTEST_URL (es. postgres://.../dbe) prima di eseguire questi test.');
}
process.env.DATABASE_URL = process.env.PGTEST_URL;
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
const ISCRIZIONE_ALTRA_CLASSE = 3; // classe 3B (persona 5): per il caso K3
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

test('Caso I: due inserimenti concorrenti della stessa osservazione non creano un duplicato', async () => {
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
