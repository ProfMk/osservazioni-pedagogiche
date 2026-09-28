'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcolaEsito, calcolaGiudizio, isPunteggioValido,
  FINESTRA_RISULTATO_CORRENTE, risultatoCorrenteCriterio, aggregaRisultatiCorrenti,
} = require('../server/config/valutazione');

// Caso A: 6 criteri, 0,2,1,1,2,2 -> 8/12, 66,67%.
// ATTENZIONE: il documento originale indicava BUONO (soglie 60-74=BUONO).
// Con le soglie corrette confermate dall'utente (70-79=BUONO, 60-69=DISCRETO),
// 66,67% ricade in 60-69: il giudizio corretto è DISCRETO. Il calcolo del
// punteggio non cambia, cambia solo l'etichetta del giudizio.
test('Caso A: griglia completa mista', () => {
  const r = calcolaEsito([0, 2, 1, 1, 2, 2]);
  assert.equal(r.punteggioOttenuto, 8);
  assert.equal(r.punteggioMassimo, 12);
  assert.equal(r.percentuale, 66.67);
  assert.equal(r.giudizio, 'DISCRETO');
});

// Caso B: solo 2 criteri valutati, entrambi 2 -> 4/4, 100%, OTTIMO (non 4/12, 33%)
test('Caso B: griglia parziale, non deve usare il numero teorico di criteri', () => {
  const r = calcolaEsito([2, 2]);
  assert.equal(r.punteggioOttenuto, 4);
  assert.equal(r.punteggioMassimo, 4);
  assert.equal(r.percentuale, 100);
  assert.equal(r.giudizio, 'OTTIMO');
  assert.notEqual(r.punteggioMassimo, 12);
});

// Caso C: un solo criterio valutato, valore 0 -> 0/2, 0%, NON SUFFICIENTE (lo 0 conta nel denominatore)
test('Caso C: un solo criterio valutato a 0 non è "non valutato"', () => {
  const r = calcolaEsito([0]);
  assert.equal(r.punteggioOttenuto, 0);
  assert.equal(r.punteggioMassimo, 2);
  assert.equal(r.percentuale, 0);
  assert.equal(r.giudizio, 'NON SUFFICIENTE');
});

// Caso D: nessuna valutazione presente -> percentuale nulla, giudizio vuoto
test('Caso D: nessuna valutazione presente', () => {
  const r = calcolaEsito([]);
  assert.equal(r.punteggioOttenuto, null);
  assert.equal(r.punteggioMassimo, null);
  assert.equal(r.percentuale, null);
  assert.equal(r.giudizio, '');
});

// Caso E: sviluppo cumulativo di un criterio su 2 attività: 0 poi 1 -> 1/4, 25%
test('Caso E: sviluppo cumulativo di un criterio su più attività', () => {
  const r = calcolaEsito([0, 1]); // le due valutazioni dello stesso criterio, da attività diverse
  assert.equal(r.punteggioOttenuto, 1);
  assert.equal(r.punteggioMassimo, 4);
  assert.equal(r.percentuale, 25);
});

// Caso F (parte di validazione applicativa, non di calcolo): punteggio 3 non ammesso dalla scala
test('Caso F: 3 non è un punteggio valido nella scala attuale', () => {
  assert.equal(isPunteggioValido(3), false);
  assert.equal(isPunteggioValido(-1), false);
  assert.equal(isPunteggioValido(0), true);
  assert.equal(isPunteggioValido(1), true);
  assert.equal(isPunteggioValido(2), true);
});

// Soglie esatte del giudizio (valori corretti forniti dall'utente: 90/80/70/60/50)
test('Soglie del giudizio: limiti esatti di ciascuna fascia', () => {
  assert.equal(calcolaGiudizio(100), 'OTTIMO');
  assert.equal(calcolaGiudizio(90), 'OTTIMO');
  assert.equal(calcolaGiudizio(89.99), 'DISTINTO');
  assert.equal(calcolaGiudizio(80), 'DISTINTO');
  assert.equal(calcolaGiudizio(79.99), 'BUONO');
  assert.equal(calcolaGiudizio(70), 'BUONO');
  assert.equal(calcolaGiudizio(69.99), 'DISCRETO');
  assert.equal(calcolaGiudizio(60), 'DISCRETO');
  assert.equal(calcolaGiudizio(59.99), 'SUFFICIENTE');
  assert.equal(calcolaGiudizio(50), 'SUFFICIENTE');
  assert.equal(calcolaGiudizio(49.99), 'NON SUFFICIENTE');
  assert.equal(calcolaGiudizio(0), 'NON SUFFICIENTE');
  assert.equal(calcolaGiudizio(null), '');
});

// Il giudizio deve usare la percentuale ESATTA, non quella arrotondata per la presentazione
test('Il giudizio usa il valore esatto, non arrotondato', () => {
  // 89.996% arrotonderebbe a "90.00%" in visualizzazione, ma il giudizio resta DISTINTO
  assert.equal(calcolaGiudizio(89.996), 'DISTINTO');
});

// --- Risultato corrente: media delle ultime 3 osservazioni del criterio ---

// Osservazioni di prova: una al giorno, in ordine, con id attività crescenti.
function osservazioni(...punteggi) {
  return punteggi.map((punteggio, i) => ({
    punteggio, attivitaId: i + 1, dataAttivita: `2025-10-${String(i + 1).padStart(2, '0')}`,
  }));
}

test('Risultato corrente: una sola osservazione -> è quella osservazione', () => {
  const r = risultatoCorrenteCriterio(osservazioni(2));
  assert.equal(r.media, 2);
  assert.equal(r.percentuale, 100);
  assert.equal(r.giudizio, 'OTTIMO');
  assert.equal(r.osservazioniConsiderate, 1);
});

test('Risultato corrente: due osservazioni -> media delle due', () => {
  const r = risultatoCorrenteCriterio(osservazioni(1, 2));
  assert.equal(r.media, 1.5);
  assert.equal(r.percentuale, 75);
  assert.equal(r.osservazioniConsiderate, 2);
});

test('Risultato corrente: 0,1,2,2 -> media delle ultime tre (1,67), non di tutte (1,25)', () => {
  const r = risultatoCorrenteCriterio(osservazioni(0, 1, 2, 2));
  assert.equal(FINESTRA_RISULTATO_CORRENTE, 3);
  assert.equal(r.media, 1.67);
  assert.equal(r.punteggioOttenuto, 5);
  assert.equal(r.punteggioMassimo, 6);
  assert.equal(r.percentuale, 83.33);
  assert.equal(r.giudizio, 'DISTINTO');
  assert.equal(r.osservazioniConsiderate, 3);
  assert.equal(r.osservazioniTotali, 4);
  assert.deepEqual(r.attivitaConsiderate, [2, 3, 4]);
  // Il cumulativo di tutte le osservazioni resta calcolabile come prima (informazione secondaria).
  assert.equal(calcolaEsito([0, 1, 2, 2]).percentuale, 62.5);
});

test('Risultato corrente: lo 0 è una valutazione reale e resta nella media (0,2,2 -> 1,33)', () => {
  const r = risultatoCorrenteCriterio(osservazioni(0, 2, 2));
  assert.equal(r.media, 1.33);
  assert.equal(r.percentuale, 66.67);
  assert.equal(r.giudizio, 'DISCRETO');
});

test('Risultato corrente: nessuna osservazione -> Non valutato (null), non 0', () => {
  const r = risultatoCorrenteCriterio([]);
  assert.equal(r.media, null);
  assert.equal(r.percentuale, null);
  assert.equal(r.giudizio, '');
  assert.equal(r.osservazioniConsiderate, 0);
});

test('Risultato corrente: ordine deterministico per data e poi id attività, indipendente dall\'ordine in ingresso', () => {
  // Due attività nella stessa data: esce dalla finestra quella con id minore (7), non quella arrivata per prima.
  const elenco = [
    { punteggio: 2, attivitaId: 20, dataAttivita: '2025-11-20' },
    { punteggio: 1, attivitaId: 9, dataAttivita: '2025-09-21' },
    { punteggio: 2, attivitaId: 15, dataAttivita: '2025-10-15' },
    { punteggio: 0, attivitaId: 7, dataAttivita: '2025-09-21' },
  ];
  const r = risultatoCorrenteCriterio(elenco);
  assert.deepEqual(r.attivitaConsiderate, [9, 15, 20]);
  assert.equal(r.media, 1.67);
  assert.deepEqual(risultatoCorrenteCriterio([...elenco].reverse()), r);
});

test('Nucleo/materia: media a pesi uguali dei risultati correnti dei soli criteri valutati', () => {
  const criteri = [
    risultatoCorrenteCriterio(osservazioni(0, 2)), // media 1 (2 osservazioni)
    risultatoCorrenteCriterio(osservazioni(2)), // media 2 (1 osservazione): pesa quanto il precedente
    risultatoCorrenteCriterio([]), // Non valutato: escluso
  ];
  const r = aggregaRisultatiCorrenti(criteri);
  assert.equal(r.media, 1.5);
  assert.equal(r.percentuale, 75);
  assert.equal(r.giudizio, 'BUONO');
  assert.equal(r.criteriConsiderati, 2);
});

test('Nucleo/materia: un criterio con media 0 è incluso; nessun criterio valutato -> Non valutato', () => {
  const r = aggregaRisultatiCorrenti([risultatoCorrenteCriterio(osservazioni(0)), risultatoCorrenteCriterio(osservazioni(2))]);
  assert.equal(r.media, 1);
  assert.equal(r.percentuale, 50);
  const vuoto = aggregaRisultatiCorrenti([risultatoCorrenteCriterio([])]);
  assert.equal(vuoto.percentuale, null);
  assert.equal(vuoto.giudizio, '');
});

test('Nucleo/materia: soglia esatta raggiunta con medie non intere (nessun errore di arrotondamento)', () => {
  // Tre medie da 1/3 (in virgola mobile 0,333...) con due medie da 1: (1/3 x 3 + 2) / 5 = 0,6 -> 30% esatto.
  const unTerzo = risultatoCorrenteCriterio(osservazioni(0, 0, 1));
  const r = aggregaRisultatiCorrenti([unTerzo, unTerzo, unTerzo, risultatoCorrenteCriterio(osservazioni(1)), risultatoCorrenteCriterio(osservazioni(1))]);
  assert.equal(r.percentuale, 30);
  // Medie 5/3, 5/3, 2, 2, 5/3 -> somma 9 su 5 criteri = 1,8 -> esattamente la soglia del 90%.
  const soglia = aggregaRisultatiCorrenti([
    risultatoCorrenteCriterio(osservazioni(2, 2, 1)), // 5/3
    risultatoCorrenteCriterio(osservazioni(2, 2, 1)), // 5/3
    risultatoCorrenteCriterio(osservazioni(2, 2, 2)), // 2
    risultatoCorrenteCriterio(osservazioni(2, 2, 2)), // 2
    risultatoCorrenteCriterio(osservazioni(1, 2, 2)), // 5/3
  ]);
  assert.equal(soglia.percentuale, 90);
  assert.equal(soglia.giudizio, 'OTTIMO', 'esattamente 90% deve essere OTTIMO, non DISTINTO per un errore di virgola mobile');
});
