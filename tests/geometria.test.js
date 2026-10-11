'use strict';

/**
 * Geometria del disco (V2.1 rev. 2, §6 e C4): settori di uguale ampiezza, raggio = valore,
 * ordine dei settori nel verso di lettura (specchio in RTL). Modulo solo presentazionale.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../public/js/geometria');

const vicino = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

test('1 settore = cerchio intero senza separazioni', () => {
  const [s] = G.settori(1);
  vicino(s.ampiezza, 2 * Math.PI, 'ampiezza');
  assert.match(G.corona(10, 20, s.a0, s.a1, false), /A20 20 0 1 1 -20 0/);
});

test('2, 3, 4 e 6 settori hanno tutti la stessa ampiezza, qualunque sia il valore', () => {
  [2, 3, 4, 6].forEach((n) => {
    const elenco = G.settori(n);
    assert.equal(elenco.length, n);
    elenco.forEach((s) => vicino(s.ampiezza, elenco[0].ampiezza, `${n} settori`));
  });
  vicino(G.settori(2)[0].ampiezza + 0.035, Math.PI, 'due semicerchi');
});

test('il raggio rappresenta il valore: 0% al bordo interno, 100% al bordo esterno, lineare', () => {
  assert.equal(G.raggio(40, 100, 0), 40);
  assert.equal(G.raggio(40, 100, 100), 100);
  assert.equal(G.raggio(40, 100, 50), 70);
});

test('il primo settore parte dall\'alto nel verso di lettura e si specchia in RTL', () => {
  const [primo] = G.settori(3);
  const [xLtr] = G.punto(50, primo.medio, false);
  const [xRtl, yRtl] = G.punto(50, primo.medio, true);
  assert.ok(xLtr > 0, 'LTR: verso destra (inizio della riga di lettura)');
  assert.ok(xRtl < 0, 'RTL: verso sinistra (inizio della riga di lettura)');
  vicino(yRtl, G.punto(50, primo.medio, false)[1], 'stessa altezza');
  assert.equal(G.lato(xLtr), 'start');
  assert.equal(G.lato(xRtl), 'end');
});

test('C5: oltre 6 settori niente disco', () => {
  assert.equal(G.MASSIMO_SETTORI, 6);
});
