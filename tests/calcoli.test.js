'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calcolaEsito, calcolaGiudizio, isPunteggioValido } = require('../server/config/valutazione');

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
