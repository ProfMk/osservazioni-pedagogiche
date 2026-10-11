'use strict';

/**
 * Regola B (Visual Grammar V2): un solo intero in centesimi, kc = floor((x + ε) × 100),
 * da cui derivano banda, valore del dettaglio, valore della sintesi e geometria.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TOLLERANZA_NUMERICA, centesimi, daCentesimi, centesimiDaDecimale, decimaliSintesi, raggiungeSoglia,
} = require('../server/lib/calcoloEsiti');
const { preparaBande, giudizioDi } = require('../server/lib/calcoloProgresso');

test('Regola B: ε è la tolleranza già adottata dal motore (1e-9), non un valore nuovo', () => {
  assert.equal(TOLLERANZA_NUMERICA, 1e-9);
});

test('Regola B: kc tronca, non arrotonda; i bordi di virgola mobile sono neutralizzati da ε', () => {
  assert.equal(centesimi((2 / 3) * 100), 6666);
  assert.equal(centesimi((1 / 6) * 100), 1666);
  assert.equal(centesimi(69.99999999999999), 7000, 'valore matematico 70: errore di virgola mobile neutralizzato');
  assert.equal(centesimi(69.999999), 6999, 'un milionesimo sotto è una differenza reale');
  assert.equal(centesimi(69.995), 6999, 'mai «70» per un valore sotto soglia');
  assert.equal(centesimi(null), null);
  assert.equal(centesimi(0), 0);
  assert.equal(centesimi(100), 10000);
});

test('Regola B: valore alla precisione semantica derivato da kc (dettaglio 2, sintesi 0/1/2)', () => {
  assert.deepEqual([daCentesimi(6666), daCentesimi(6666, 1), daCentesimi(6666, 0)], [66.66, 66.6, 66]);
  assert.deepEqual([daCentesimi(2916, 2), daCentesimi(2916, 0)], [29.16, 29]);
  assert.equal(daCentesimi(null), null);
});

test('Regola B: soglie convertite in centesimi dal decimale configurato, senza virgola mobile', () => {
  assert.deepEqual(['90.00', '66.67', '0.10', '55', 66.67, 0.29].map(centesimiDaDecimale), [9000, 6667, 10, 5500, 6667, 29]);
  assert.throws(() => centesimiDaDecimale('abc'));
});

test('Regola B: p_sintesi = massimo numero di decimali significativi delle soglie applicabili', () => {
  assert.equal(decimaliSintesi([9000, 8000, 0]), 0);
  assert.equal(decimaliSintesi([9050, 8000]), 1);
  assert.equal(decimaliSintesi([6667, 8000]), 2);
  assert.equal(decimaliSintesi([]), 0);
});

test('N-6: il numero mostrato raggiunge una soglia se e solo se la banda la raggiunge (dettaglio e sintesi)', () => {
  const insiemi = [
    [0, 50, 60, 70, 80, 90],
    [0, 55, 70, 85],
    [0, 33.3, 66.7],
    [0, 12.34, 50.01, 99.99],
  ];
  insiemi.forEach((soglie) => {
    const bande = preparaBande(soglie.map((s, i) => ({ soglia_minima: s, etichetta: `B${i}` })));
    const p = decimaliSintesi(bande.map((b) => b.sogliaCentesimi));
    const scarti = [-1e-6, -1e-9, -1e-12, 0, 1e-12, 1e-9, 1e-6, -0.005, 0.005, -0.0049, 0.0049];
    soglie.forEach((s) => scarti.forEach((d) => {
      const x = s + d;
      if (x < 0 || x > 100) return;
      const kc = centesimi(x);
      const banda = giudizioDi(x, bande);
      bande.forEach((b) => {
        const bandaRaggiunge = banda.livelloGiudizio >= b.livello;
        const dettaglioRaggiunge = Math.floor(kc) >= b.sogliaCentesimi;
        const passo = 10 ** (2 - p);
        const sintesiRaggiunge = Math.floor(kc / passo) * passo >= b.sogliaCentesimi;
        assert.equal(dettaglioRaggiunge, bandaRaggiunge, `dettaglio, x=${x}, soglia ${b.sogliaCentesimi}`);
        assert.equal(sintesiRaggiunge, bandaRaggiunge, `sintesi p=${p}, x=${x}, soglia ${b.sogliaCentesimi}`);
        assert.equal(raggiungeSoglia(kc, b.sogliaCentesimi), dettaglioRaggiunge);
      });
    }));
  });
});
