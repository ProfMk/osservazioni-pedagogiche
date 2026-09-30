'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calcolaEsito, calcolaGiudizio, mediaSemplicePercentuali } = require('../server/lib/calcoloEsiti');

// Bande di giudizio di esempio (Tenant Alfa nel seed): 90/80/70/60/50.
const BANDE_ALFA = [
  { soglia_minima: 90, etichetta: 'OTTIMO' },
  { soglia_minima: 80, etichetta: 'DISTINTO' },
  { soglia_minima: 70, etichetta: 'BUONO' },
  { soglia_minima: 60, etichetta: 'DISCRETO' },
  { soglia_minima: 50, etichetta: 'SUFFICIENTE' },
  { soglia_minima: 0, etichetta: 'NON SUFFICIENTE' },
];

test('calcolaEsito: griglia completa mista, scala massimo 2', () => {
  const r = calcolaEsito([0, 2, 1, 1, 2, 2], 2);
  assert.equal(r.punteggioOttenuto, 8);
  assert.equal(r.punteggioMassimo, 12);
  assert.equal(r.percentuale, 66.67);
  assert.equal(calcolaGiudizio(r.percentualeEsatta, BANDE_ALFA), 'DISCRETO');
});

test('calcolaEsito: griglia parziale non usa il numero teorico di criteri', () => {
  const r = calcolaEsito([2, 2], 2);
  assert.equal(r.punteggioOttenuto, 4);
  assert.equal(r.punteggioMassimo, 4);
  assert.equal(r.percentuale, 100);
  assert.notEqual(r.punteggioMassimo, 12);
});

test('calcolaEsito: un solo valore a 0 non è "non valutato"', () => {
  const r = calcolaEsito([0], 2);
  assert.equal(r.punteggioOttenuto, 0);
  assert.equal(r.percentuale, 0);
  assert.equal(calcolaGiudizio(r.percentualeEsatta, BANDE_ALFA), 'NON SUFFICIENTE');
});

test('calcolaEsito: nessun valore presente -> percentuale nulla, giudizio vuoto', () => {
  const r = calcolaEsito([], 2);
  assert.equal(r.punteggioOttenuto, null);
  assert.equal(r.punteggioMassimo, null);
  assert.equal(r.percentuale, null);
  assert.equal(calcolaGiudizio(r.percentualeEsatta, BANDE_ALFA), '');
});

test('calcolaEsito: scala diversa da 0-2 (Tenant Beta, valore massimo 4)', () => {
  const r = calcolaEsito([4, 2], 4);
  assert.equal(r.punteggioOttenuto, 6);
  assert.equal(r.punteggioMassimo, 8);
  assert.equal(r.percentuale, 75);
});

test('calcolaGiudizio: soglie esatte, valori confini', () => {
  assert.equal(calcolaGiudizio(100, BANDE_ALFA), 'OTTIMO');
  assert.equal(calcolaGiudizio(90, BANDE_ALFA), 'OTTIMO');
  assert.equal(calcolaGiudizio(89.99, BANDE_ALFA), 'DISTINTO');
  assert.equal(calcolaGiudizio(50, BANDE_ALFA), 'SUFFICIENTE');
  assert.equal(calcolaGiudizio(49.99, BANDE_ALFA), 'NON SUFFICIENTE');
  assert.equal(calcolaGiudizio(null, BANDE_ALFA), '');
});

test('calcolaGiudizio: bande diverse per tenant diverso (Beta) danno esiti diversi dalla stessa percentuale', () => {
  const BANDE_BETA = [
    { soglia_minima: 85, etichetta: 'ECCELLENTE' },
    { soglia_minima: 70, etichetta: 'BUONO' },
    { soglia_minima: 55, etichetta: 'SUFFICIENTE' },
    { soglia_minima: 0, etichetta: 'INSUFFICIENTE' },
  ];
  // 75%: BUONO per Alfa e per Beta, ma le soglie sono strutturalmente diverse (85 vs 90/80).
  assert.equal(calcolaGiudizio(75, BANDE_ALFA), 'BUONO');
  assert.equal(calcolaGiudizio(75, BANDE_BETA), 'BUONO');
  // 82%: DISTINTO per Alfa (>=80), ma solo BUONO per Beta (<85): la configurazione conta davvero.
  assert.equal(calcolaGiudizio(82, BANDE_ALFA), 'DISTINTO');
  assert.equal(calcolaGiudizio(82, BANDE_BETA), 'BUONO');
});

test('mediaSemplicePercentuali: media dei risultati dei criteri, non pool di tutti i punteggi', () => {
  const criterio1 = calcolaEsito([0, 2], 2); // 2/4 = 50%
  const criterio2 = calcolaEsito([2], 2); // 2/2 = 100%
  const media = mediaSemplicePercentuali([criterio1, criterio2]);
  assert.equal(media.percentuale, 75); // (50+100)/2, non (0+2+2)/(3*2)=66.67
  assert.equal(media.criteriConsiderati, 2);
});

test('mediaSemplicePercentuali: nessun criterio valutato -> percentuale nulla', () => {
  const media = mediaSemplicePercentuali([]);
  assert.equal(media.percentuale, null);
  assert.equal(media.criteriConsiderati, 0);
});
