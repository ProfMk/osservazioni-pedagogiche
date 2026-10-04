'use strict';

/**
 * Motore dei report pedagogici — test puri (nessun database). Stessi dataset e stessi
 * valori calcolati a mano della baseline (regole di calcolo invariate), rappresentati
 * secondo la Visual Grammar V2: Regola B, certezza, criticità, confronti, dati mancanti.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcolaEsito, mediaSemplicePercentuali, risultatoCorrenteMediaMobile } = require('../server/lib/calcoloEsiti');
const progresso = require('../server/lib/calcoloProgresso');

// Bande di giudizio di esempio (Tenant Alfa nel seed): 90/80/70/60/50/0.
const BANDE_ALFA = [
  { soglia_minima: 90, etichetta: 'OTTIMO' },
  { soglia_minima: 80, etichetta: 'DISTINTO' },
  { soglia_minima: 70, etichetta: 'BUONO' },
  { soglia_minima: 60, etichetta: 'DISCRETO' },
  { soglia_minima: 50, etichetta: 'SUFFICIENTE' },
  { soglia_minima: 0, etichetta: 'NON SUFFICIENTE' },
];
const P_ALFA = progresso.preparaBande(BANDE_ALFA);
const P_BETA = progresso.preparaBande([
  { soglia_minima: '85.00', etichetta: 'ECCELLENTE' },
  { soglia_minima: '70.00', etichetta: 'BUONO' },
  { soglia_minima: '55.00', etichetta: 'SUFFICIENTE' },
  { soglia_minima: '0.00', etichetta: 'INSUFFICIENTE' },
]);
const SCALA_ALFA = { valoreMinimo: 0, valoreMassimo: 2 };
const SCALA_BETA = { valoreMinimo: 1, valoreMassimo: 4 };
const { CERTEZZA, CRITICITA, CONFRONTO, DATI } = progresso;

/** Banda (etichetta) di una percentuale esatta: unica regola, Regola B. */
const banda = (x, bande = P_ALFA) => progresso.giudizioDi(x, bande).giudizio;
const criterioAlfa = (valori) => progresso.risultatoCriterioStudente(valori, SCALA_ALFA, P_ALFA);
const nucleoAlfa = (criteri) => progresso.aggregaCriteriStudente(criteri, SCALA_ALFA, P_ALFA, { nucleo: true });
const complessivoAlfa = (criteri) => progresso.aggregaCriteriStudente(criteri, SCALA_ALFA, P_ALFA);

// --- Esiti e soglie -------------------------------------------------------------

test('calcolaEsito: griglia completa mista, scala massimo 2 (Regola B: troncamento)', () => {
  const r = calcolaEsito([0, 2, 1, 1, 2, 2], 2);
  assert.deepEqual([r.punteggioOttenuto, r.punteggioMassimo, r.centesimi, r.percentuale], [8, 12, 6666, 66.66]);
  assert.equal(banda(r.percentualeEsatta), 'DISCRETO');
});

test('calcolaEsito: griglia parziale non usa il numero teorico di criteri; lo 0 è una valutazione', () => {
  const r = calcolaEsito([2, 2], 2);
  assert.deepEqual([r.punteggioOttenuto, r.punteggioMassimo, r.percentuale], [4, 4, 100]);
  const zero = calcolaEsito([0], 2);
  assert.deepEqual([zero.percentuale, banda(zero.percentualeEsatta)], [0, 'NON SUFFICIENTE']);
});

test('calcolaEsito: nessun valore -> tutto nullo; nessuna banda', () => {
  const r = calcolaEsito([], 2);
  assert.deepEqual([r.punteggioOttenuto, r.punteggioMassimo, r.percentuale, r.centesimi], [null, null, null, null]);
  assert.equal(banda(r.percentualeEsatta), null);
});

test('calcolaEsito: scala diversa da 0-2 (Tenant Beta, valore massimo 4)', () => {
  const r = calcolaEsito([4, 2], 4);
  assert.deepEqual([r.punteggioOttenuto, r.punteggioMassimo, r.percentuale], [6, 8, 75]);
});

test('Bande: soglie inclusive ai confini; bande diverse per tenant diverso', () => {
  assert.deepEqual([100, 90, 89.99, 50, 49.99].map((x) => banda(x)), ['OTTIMO', 'OTTIMO', 'DISTINTO', 'SUFFICIENTE', 'NON SUFFICIENTE']);
  assert.equal(banda(null), null);
  assert.deepEqual([banda(75), banda(75, P_BETA)], ['BUONO', 'BUONO']);
  assert.deepEqual([banda(82), banda(82, P_BETA)], ['DISTINTO', 'BUONO'], 'la configurazione conta davvero');
});

test('mediaSemplicePercentuali: media dei risultati dei criteri, non pool dei punteggi', () => {
  const media = mediaSemplicePercentuali([calcolaEsito([0, 2], 2), calcolaEsito([2], 2)]);
  assert.deepEqual([media.percentuale, media.criteriConsiderati], [75, 2]);
  assert.deepEqual([mediaSemplicePercentuali([]).percentuale, mediaSemplicePercentuali([]).criteriConsiderati], [null, 0]);
});

test('Media mobile: 0,1,2,2 -> ultime 3 = 1,2,2 -> 83,33%; con meno di 3 usa tutte; nessuna media in unità di scala', () => {
  const r = risultatoCorrenteMediaMobile([0, 1, 2, 2], 2);
  assert.deepEqual([r.percentuale, r.osservazioniConsiderate, r.osservazioniTotali, r.media], [83.33, 3, 4, undefined]);
  assert.equal(risultatoCorrenteMediaMobile([0, 2], 2).percentuale, 50);
  assert.equal(risultatoCorrenteMediaMobile([], 2).percentuale, null);
});

// --- Studente: criterio, nucleo, complessivo ---------------------------------------

test('U1 criterio: corrente 83,33% DISTINTO, cumulativo 62,5% DISCRETO; base = considerate/valide', () => {
  const r = criterioAlfa([0, 1, 2, 2]);
  assert.deepEqual([r.percentuale, r.giudizio, r.osservazioniConsiderate, r.osservazioniTotali], [83.33, 'DISTINTO', 3, 4]);
  assert.deepEqual([r.cumulativo.percentuale, r.cumulativo.giudizio, r.cumulativo.punteggioOttenuto, r.cumulativo.punteggioMassimo], [62.5, 'DISCRETO', 5, 8]);
  assert.deepEqual(r.base, { n: 3, N: 4 });
  assert.deepEqual([r.posizioneAsse, r.sintesi], [83.33, { valore: 83, decimali: 0 }], 'geometria e sintesi dallo stesso kc');
});

test('U2 certezza dello studente (§7): 0 assente, 1-2 parziale, 3+ sufficiente; copertura indicativa/provvisoria/consolidata', () => {
  const casi = [[[1], CERTEZZA.PARZIALE, 'STUDENT_COVERAGE_INDICATIVE'], [[2, 0], CERTEZZA.PARZIALE, 'STUDENT_COVERAGE_PROVISIONAL'],
    [[0, 1, 2], CERTEZZA.SUFFICIENTE, 'STUDENT_COVERAGE_CONSOLIDATED'], [[0, 1, 2, 2, 2], CERTEZZA.SUFFICIENTE, 'STUDENT_COVERAGE_CONSOLIDATED']];
  casi.forEach(([valori, certezza, copertura]) => {
    const r = criterioAlfa(valori);
    assert.deepEqual([r.certezza, r.copertura], [certezza, copertura], `${valori}`);
  });
  assert.deepEqual([criterioAlfa([1]).percentuale, criterioAlfa([1]).giudizio], [50, 'SUFFICIENTE']);
});

test('U3 criterio non osservato: NOT_OBSERVED, certezza assente, tutto nullo (mai 0), nessuna criticità', () => {
  const r = criterioAlfa([]);
  assert.deepEqual([r.percentuale, r.giudizio, r.livelloGiudizio, r.posizioneAsse, r.cumulativo.percentuale], [null, null, null, null, null]);
  assert.deepEqual([r.stato, r.certezza, r.criticita, r.livelloCopertura], [DATI.NON_OSSERVATO, CERTEZZA.ASSENTE, null, 0]);
  assert.deepEqual(r.base, { n: 0, N: 0 });
});

test('U4 nucleo parzialmente osservato: media dei criteri valutati; certezza H3; dati incompleti', () => {
  const criteri = [[0, 1, 2, 2], [2, 0], [1], []].map(criterioAlfa);
  const n = nucleoAlfa(criteri);
  assert.deepEqual([n.percentuale, n.giudizio, n.criteriValutati, n.criteriTotali], [61.11, 'DISCRETO', 3, 4]);
  assert.equal(n.cumulativo.percentuale, 54.16, '(62,5 + 50 + 50) / 3 = 54,166… -> 54,16 (Regola B)');
  assert.deepEqual(n.copertura, { consolidati: 1, provvisori: 1, indicativi: 1, nonValutati: 1 });
  assert.deepEqual([n.certezza, n.datiNucleo, n.base], [CERTEZZA.PARZIALE, 'NUCLEUS_DATA_INCOMPLETE', { n: 3, N: 4 }]);

  const h3 = nucleoAlfa([[2, 2, 2], [1, 2, 2, 2]].map(criterioAlfa));
  assert.deepEqual([h3.certezza, h3.datiNucleo], [CERTEZZA.SUFFICIENTE, 'NUCLEUS_DATA_COMPLETE'], 'H3: tutti valutati, ciascuno con 3+');
  const completoMaParziale = nucleoAlfa([[2, 2, 2], [2, 2]].map(criterioAlfa));
  assert.deepEqual([completoMaParziale.certezza, completoMaParziale.datiNucleo], [CERTEZZA.PARZIALE, 'NUCLEUS_DATA_COMPLETE'],
    'P6: COMPLETE e SUFFICIENT sono concetti distinti');

  const vuoto = nucleoAlfa([[], []].map(criterioAlfa));
  assert.deepEqual([vuoto.percentuale, vuoto.giudizio, vuoto.stato, vuoto.certezza], [null, null, DATI.NON_OSSERVATO, CERTEZZA.ASSENTE]);
  const senzaCriteri = nucleoAlfa([]);
  assert.deepEqual([senzaCriteri.stato, senzaCriteri.datiNucleo], [DATI.NON_CONFIGURATO, null]);
});

test('U5 complessivo studente: media dei criteri valutati della materia (non dei nuclei); certezza = minimo dei criteri valutati', () => {
  const numeri = [[0, 1, 2, 2], [2, 0], [1], []].map(criterioAlfa);
  const spazio = [[2, 2, 2, 1, 0], [], [], []].map(criterioAlfa);
  assert.deepEqual([nucleoAlfa(spazio).percentuale, nucleoAlfa(spazio).cumulativo.percentuale], [50, 70], 'studente in calo');
  const g = complessivoAlfa([...numeri, ...spazio]);
  assert.deepEqual([g.percentuale, g.giudizio, g.cumulativo.percentuale, g.criteriValutati, g.criteriTotali], [58.33, 'SUFFICIENTE', 58.12, 4, 8]);
  assert.equal(g.certezza, CERTEZZA.PARZIALE, 'due criteri valutati hanno meno di 3 osservazioni');
  const tuttiConsolidati = complessivoAlfa([[2, 2, 2], [], [1, 1, 1]].map(criterioAlfa));
  assert.equal(tuttiConsolidati.certezza, CERTEZZA.SUFFICIENTE, 'P6: minimo dei termini che lo producono (i criteri valutati)');
});

test('U6 scala 1-4: percentuale pedagogica = media/massimo; il minimo della scala vale 25%, anche sull\'asse', () => {
  const criterioBeta = (valori) => progresso.risultatoCriterioStudente(valori, SCALA_BETA, P_BETA);
  const a = criterioBeta([2, 4, 3, 4]);
  assert.deepEqual([a.percentuale, a.giudizio, a.cumulativo.percentuale], [91.66, 'ECCELLENTE', 81.25]);
  const b = criterioBeta([1]);
  assert.deepEqual([b.percentuale, b.giudizio, b.posizioneAsse], [25, 'INSUFFICIENTE', 25], 'geometria da kc: nessuna trasformazione min->max');
  const nucleo = progresso.aggregaCriteriStudente([a, b, criterioBeta([2, 3])], SCALA_BETA, P_BETA, { nucleo: true });
  assert.deepEqual([nucleo.percentuale, nucleo.giudizio, nucleo.cumulativo.percentuale], [59.72, 'SUFFICIENTE', 56.25]);
});

test('U7 bande: zone sull\'asse dalle soglie in centesimi; posizione; criticità solo della banda più bassa', () => {
  assert.deepEqual(P_BETA.map((b) => [b.livello, b.posizioneInizio, b.posizioneFine, b.critica]),
    [[3, 85, 100], [2, 70, 85], [1, 55, 70], [0, 0, 55]].map(([l, i, f]) => [l, i, f, l === 0]));
  assert.deepEqual(progresso.precisione(P_ALFA), { dettaglio: 2, sintesi: 0 });
  assert.deepEqual(progresso.precisione(progresso.preparaBande([{ soglia_minima: '66.67', etichetta: 'x' }, { soglia_minima: 0, etichetta: 'y' }])),
    { dettaglio: 2, sintesi: 2 });
});

// --- Classe: dataset di 8 studenti della specifica ------------------------------
const T = 100 / 3;
const CLASSE_8 = {
  C1: [100, 250 / 3, 100, 2 * T, 250 / 3, 100, 2 * T, 250 / 3],
  C2: [50, T, 2 * T, T / 2, 50, 50, T, null],
  C3: [250 / 3, 2 * T, 100, 250 / 3, 2 * T, 250 / 3, 50, 100],
  C4: [100, null, null, null, null, null, null, null],
};

function righeDa(matrice, numeroStudenti) {
  return Array.from({ length: numeroStudenti }, (_, s) => {
    const riga = new Map();
    Object.entries(matrice).forEach(([criterio, valori]) => {
      if (valori[s] !== null && valori[s] !== undefined) riga.set(criterio, { percentualeEsatta: valori[s], osservazioniTotali: 3 });
    });
    return riga;
  });
}

test('U9 classe: K(c) = media degli studenti valutati; nucleo = media dei soli criteri rappresentativi; certezza di classe', () => {
  const n = progresso.nucleoDiClasse(['C1', 'C2', 'C3', 'C4'], righeDa(CLASSE_8, 8), P_ALFA);
  const c = Object.fromEntries(n.criteri.map((x) => [x.id, x]));
  assert.deepEqual([c.C1.risultato.percentuale, c.C1.risultato.giudizio, c.C1.copertura.studentiValutati], [85.41, 'DISTINTO', 8]);
  assert.deepEqual([c.C2.risultato.percentuale, c.C2.risultato.giudizio, c.C2.copertura.studentiValutati], [42.85, 'NON SUFFICIENTE', 7]);
  assert.deepEqual([c.C3.risultato.percentuale, c.C3.risultato.giudizio, c.C3.copertura.studentiValutati], [79.16, 'BUONO', 8]);
  assert.deepEqual([c.C4.rappresentativo, c.C4.statoCopertura, c.C4.risultato.stato, c.C4.risultato.certezza],
    [false, 'CLASS_COVERAGE_UNDER_OBSERVED', DATI.INSUFFICIENTI, CERTEZZA.PARZIALE], '1 studente su 8');
  assert.deepEqual([c.C1.risultato.certezza, c.C1.statoCopertura, c.C1.risultato.base], [CERTEZZA.SUFFICIENTE, 'CLASS_COVERAGE_REPRESENTATIVE', { n: 8, N: 8 }]);
  assert.equal(n.risultato.percentuale, 69.14, 'C4 non entra (69,146… -> 69,14)');
  assert.deepEqual([n.risultato.giudizio, n.risultato.certezza, n.risultato.base], ['DISCRETO', CERTEZZA.SUFFICIENTE, { n: 3, N: 4 }]);
  assert.equal(c.C1.distribuzioneGiudizi.reduce((t, d) => t + d.studenti, 0), 8);
  const complessivo = progresso.complessivoDiClasse([n], P_ALFA);
  assert.deepEqual([complessivo.percentuale, complessivo.criteriRappresentativi, complessivo.criteriTotali], [69.14, 3, 4]);
});

test('U10 classe: esattamente metà non è rappresentativo; nessuno studente = non osservato; nessun rappresentativo = dati insufficienti', () => {
  const matrice = { C1: [100, 100, 100, 100], C2: [50, 50, null, null], C3: [50, 50, 50, null], C4: [null, null, null, null] };
  const n = progresso.nucleoDiClasse(['C1', 'C2', 'C3', 'C4'], righeDa(matrice, 4), P_ALFA);
  const c = Object.fromEntries(n.criteri.map((x) => [x.id, x]));
  assert.deepEqual([c.C2.rappresentativo, c.C2.statoCopertura], [false, 'CLASS_COVERAGE_UNDER_OBSERVED'], '2 su 4');
  assert.equal(c.C3.rappresentativo, true, '3 su 4');
  assert.deepEqual([c.C4.statoCopertura, c.C4.risultato.percentuale, c.C4.risultato.stato], ['CLASS_COVERAGE_NOT_OBSERVED', null, DATI.NON_OSSERVATO]);
  assert.equal(n.risultato.percentuale, 75, '(100 + 50) / 2: solo C1 e C3');

  const vuoto = progresso.nucleoDiClasse(['C1'], righeDa({ C1: [null, null] }, 2), P_ALFA);
  assert.deepEqual([vuoto.risultato.percentuale, vuoto.risultato.stato, vuoto.risultato.certezza], [null, DATI.NON_OSSERVATO, CERTEZZA.ASSENTE]);
  const insufficiente = progresso.nucleoDiClasse(['C1'], righeDa({ C1: [90, null, null] }, 3), P_ALFA);
  assert.deepEqual([insufficiente.risultato.percentuale, insufficiente.risultato.stato, insufficiente.risultato.certezza],
    [null, DATI.INSUFFICIENTI, CERTEZZA.PARZIALE]);
});

test('U11 classe: glifo criterio ↔ nucleo solo con almeno 6 confrontabili e 2/3 concordi (pari nel denominatore)', () => {
  const n = progresso.nucleoDiClasse(['C1', 'C2', 'C3', 'C4'], righeDa(CLASSE_8, 8), P_ALFA);
  const c = Object.fromEntries(n.criteri.map((x) => [x.id, x]));
  assert.deepEqual(c.C1.confronto, { confrontabili: 8, inferiori: 1, superiori: 7, pari: 0 });
  assert.deepEqual([c.C1.confrontoConNucleo.esito, c.C1.confrontoConNucleo.differenzaPunti], [CONFRONTO.SOPRA, 16.27]);
  assert.deepEqual(c.C2.confronto, { confrontabili: 7, inferiori: 7, superiori: 0, pari: 0 });
  assert.deepEqual([c.C2.confrontoConNucleo.esito, c.C2.confrontoConNucleo.differenzaPunti], [CONFRONTO.SOTTO, -26.29]);
  assert.deepEqual([c.C2.risultato.giudizio, c.C2.risultato.criticita], ['NON SUFFICIENTE', CRITICITA.BANDA], 'il livello assoluto resta accanto al confronto');
  assert.deepEqual(c.C3.confronto, { confrontabili: 8, inferiori: 0, superiori: 6, pari: 2 }, 'P1: pari = stesso kc');
  assert.deepEqual([c.C3.confrontoConNucleo.esito, c.C3.confrontoConNucleo.differenzaPunti], [CONFRONTO.SOPRA, 10.02]);
  assert.equal(c.C1.confrontoConNucleo.riferimento.posizioneAsse, 69.14, 'il riferimento è la tacca del nucleo');
  assert.deepEqual([c.C4.statoCopertura, c.C4.confrontoConNucleo], ['CLASS_COVERAGE_UNDER_OBSERVED', null], 'dati insufficienti: nessun confronto');
});

test('U12 classe: confronto non confermato (P8) con motivo; stessa banda = allineato', () => {
  const pochi = progresso.nucleoDiClasse(['C1', 'C2'], righeDa({ C1: [100, 100, 100, 100, 100], C2: [0, 0, 0, 0, 0] }, 5), P_ALFA);
  assert.deepEqual(pochi.criteri.map((x) => [x.confrontoConNucleo.esito, x.confrontoConNucleo.direzione, x.confrontoConNucleo.motivo]), [
    [CONFRONTO.NON_CONFERMATO, CONFRONTO.SOPRA, 'UNCONFIRMED_TOO_FEW_COMPARABLE'],
    [CONFRONTO.NON_CONFERMATO, CONFRONTO.SOTTO, 'UNCONFIRMED_TOO_FEW_COMPARABLE'],
  ]);
  assert.deepEqual([pochi.criteri[1].risultato.giudizio, pochi.criteri[1].risultato.criticita], ['NON SUFFICIENTE', CRITICITA.BANDA],
    'differenza non confermata, ma la zona critica resta: sono assi distinti');

  const s = progresso.nucleoDiClasse(['C1', 'C2'], righeDa({ C1: [96, 96, 96, 96, 96, 96], C2: [92, 92, 92, 92, 92, 92] }, 6), P_ALFA);
  assert.deepEqual(s.criteri.map((x) => x.confrontoConNucleo.esito), [CONFRONTO.ALLINEATO, CONFRONTO.ALLINEATO]);
  assert.deepEqual(s.criteri.map((x) => x.risultato.criticita), [null, null]);

  const q = progresso.nucleoDiClasse(['C1', 'C2'], righeDa({ C1: [80, 80, 80, 80, 80, 80], C2: [0, 0, 0, 90, 90, 90] }, 6), P_ALFA);
  assert.deepEqual([q.criteri[1].risultato.percentuale, q.criteri[1].confronto.inferiori], [45, 3]);
  assert.deepEqual([q.criteri[1].confrontoConNucleo.esito, q.criteri[1].confrontoConNucleo.motivo], [CONFRONTO.NON_CONFERMATO, 'UNCONFIRMED_QUORUM_NOT_REACHED'], '3 su 6 < 2/3');
  assert.equal(q.criteri[1].distribuzioneGiudizi.find((d) => d.livello === 0).studenti, 3, 'distribuzione indicizzata per livello (B-4)');
});

// --- Semantica: livello assoluto, criticità, confronto relativo, certezza --------

function casoNucleo(percentualeComplessivo, percentualeNucleo, bande, certezza = CERTEZZA.SUFFICIENTE) {
  const crea = (x) => {
    const v = progresso.valoreDi(x, bande);
    return { ...v, percentualeEsatta: x, certezza, criticita: progresso.criticitaDi(v, certezza), stato: x === null ? DATI.NON_OSSERVATO : null };
  };
  const complessivo = crea(percentualeComplessivo);
  const nucleo = crea(percentualeNucleo);
  return { complessivo, nucleo, confronto: progresso.confrontoRelativo(nucleo, complessivo) };
}

test('Semantica: casi A-H — il livello assoluto non è mai sostituito dal confronto', () => {
  const casi = {
    A: [[25, 25], ['NON SUFFICIENTE', CRITICITA.BANDA, CONFRONTO.ALLINEATO, 0, true]],
    B: [[25, 40], ['NON SUFFICIENTE', CRITICITA.BANDA, CONFRONTO.ALLINEATO, 15, true]],
    C: [[40, 25], ['NON SUFFICIENTE', CRITICITA.BANDA, CONFRONTO.ALLINEATO, -15, true]],
    D: [[70, 70], ['BUONO', null, CONFRONTO.ALLINEATO, 0, false]],
    E: [[70, 80], ['DISTINTO', null, CONFRONTO.SOPRA, 10, false]],
    F: [[70, 60], ['DISCRETO', null, CONFRONTO.SOTTO, -10, false]],
    G: [[90, 60], ['DISCRETO', null, CONFRONTO.SOTTO, -30, false]],
    H: [[60, 90], ['OTTIMO', null, CONFRONTO.SOPRA, 30, false]],
  };
  Object.entries(casi).forEach(([nome, [[complessivo, nucleo], atteso]]) => {
    const r = casoNucleo(complessivo, nucleo, P_ALFA);
    assert.deepEqual(
      [r.nucleo.giudizio, r.nucleo.criticita, r.confronto.esito, r.confronto.differenzaPunti, progresso.difficoltaGeneralizzata(r.complessivo)],
      atteso, `caso ${nome}`
    );
  });
});

test('Criticità (§8, P4, P5): zona dell\'asse; due gradi secondo la certezza; banda unica senza criticità', () => {
  assert.deepEqual(P_BETA.filter((b) => b.critica).map((b) => b.etichetta), ['INSUFFICIENTE']);
  assert.deepEqual([52, 55, 70].map((p) => progresso.valoreDi(p, P_BETA).critico), [true, false, false]);
  assert.deepEqual([52, 55].map((p) => progresso.valoreDi(p, P_ALFA).critico), [false, false], 'in Alfa 52% è SUFFICIENTE');

  const parziale = casoNucleo(25, 25, P_ALFA, CERTEZZA.PARZIALE);
  assert.equal(parziale.nucleo.criticita, CRITICITA.DA_VERIFICARE, 'dato parziale: ⚠ a contorno, fuori dal blocco di attenzione');
  assert.equal(progresso.difficoltaGeneralizzata(parziale.complessivo), false, 'P5: avviso solo con certezza sufficiente');
  assert.equal(casoNucleo(25, null, P_ALFA, CERTEZZA.ASSENTE).nucleo.criticita, null);

  const unica = progresso.preparaBande([{ soglia_minima: 0, etichetta: 'Unica' }]);
  assert.deepEqual([unica[0].critica, progresso.valoreDi(0, unica).critico, progresso.criticitaDi(progresso.valoreDi(0, unica), CERTEZZA.SUFFICIENTE)],
    [false, false, null], 'una sola banda configurata: nessuna banda critica');

  const altre = progresso.preparaBande([
    { soglia_minima: 75, etichetta: 'Verde' }, { soglia_minima: 0, etichetta: 'Rosso' }, { soglia_minima: 40, etichetta: 'Giallo' },
  ]);
  assert.deepEqual(altre.map((b) => [b.etichetta, b.livello, b.critica]), [['Verde', 2, false], ['Giallo', 1, false], ['Rosso', 0, true]],
    'nessuna etichetta o soglia fissa nel codice');
});

test('Semantica: non valutato e dati insufficienti non sono confrontabili; il segno derivato eredita la certezza minima', () => {
  assert.equal(casoNucleo(70, null, P_ALFA).confronto, null);
  assert.equal(casoNucleo(null, 70, P_ALFA).confronto, null);
  const insufficiente = { ...progresso.valoreDi(70, P_ALFA), percentualeEsatta: 70, stato: DATI.INSUFFICIENTI, certezza: CERTEZZA.PARZIALE };
  assert.equal(progresso.confrontoRelativo(insufficiente, casoNucleo(70, 70, P_ALFA).complessivo), null);
  const misto = progresso.confrontoRelativo(casoNucleo(70, 80, P_ALFA, CERTEZZA.PARZIALE).nucleo, casoNucleo(70, 80, P_ALFA).complessivo);
  assert.equal(misto.certezza, CERTEZZA.PARZIALE);
  assert.equal(progresso.certezzaMinima([CERTEZZA.SUFFICIENTE, CERTEZZA.ASSENTE, CERTEZZA.PARZIALE]), CERTEZZA.ASSENTE);
});

test('Semantica (studente): nucleo al 25% con complessivo al 25% -> critico, allineato, difficoltà generalizzata se sufficiente', () => {
  const numeri = [[0, 1, 0, 1], [1, 0, 0, 1]].map(criterioAlfa);
  const complessivo = complessivoAlfa([...numeri, criterioAlfa([0, 1, 1, 0])]);
  const nucleo = nucleoAlfa(numeri);
  assert.deepEqual([nucleo.giudizio, nucleo.criticita], ['NON SUFFICIENTE', CRITICITA.BANDA]);
  assert.equal(progresso.confrontoRelativo(nucleo, complessivo).esito, CONFRONTO.ALLINEATO);
  assert.equal(progresso.difficoltaGeneralizzata(complessivo), true);
  const parziale = complessivoAlfa([[0, 1]].map(criterioAlfa));
  assert.deepEqual([parziale.criticita, progresso.difficoltaGeneralizzata(parziale)], [CRITICITA.DA_VERIFICARE, false]);
});

test('Semantica (classe): criterio in banda critica allineato al nucleo critico resta critico; complessivo di classe', () => {
  const classe = { C1: [25, 25, 25, 25, 25, 25], C2: [40, 40, 40, 40, 40, 40], C3: [25, 40, 25, 40, 25, 40] };
  const n = progresso.nucleoDiClasse(['C1', 'C2', 'C3'], righeDa(classe, 6), P_ALFA);
  assert.deepEqual([n.risultato.percentuale, n.risultato.giudizio, n.risultato.criticita], [32.5, 'NON SUFFICIENTE', CRITICITA.BANDA]);
  n.criteri.forEach((c) => {
    assert.deepEqual([c.statoCopertura, c.risultato.criticita, c.confrontoConNucleo.esito], ['CLASS_COVERAGE_REPRESENTATIVE', CRITICITA.BANDA, CONFRONTO.ALLINEATO]);
  });
  assert.equal(n.criteri[1].confrontoConNucleo.differenzaPunti, 7.5);
  const complessivo = progresso.complessivoDiClasse([n], P_ALFA);
  assert.equal(progresso.difficoltaGeneralizzata(complessivo), true);

  const alto = progresso.nucleoDiClasse(['D1'], righeDa({ D1: [100, 100, 100, 100, 100, 100] }, 6), P_ALFA);
  assert.deepEqual([progresso.complessivoDiClasse([n, alto], P_ALFA).percentuale], [49.37], '(25 + 40 + 32,5 + 100) / 4 = 49,375 -> 49,37');
  const dueAlti = progresso.nucleoDiClasse(['D1', 'D2', 'D3'], righeDa({ D1: Array(6).fill(100), D2: Array(6).fill(100), D3: Array(6).fill(90) }, 6), P_ALFA);
  const misto = progresso.complessivoDiClasse([n, dueAlti], P_ALFA);
  assert.deepEqual([misto.percentuale, misto.giudizio, misto.criticita], [64.58, 'DISCRETO', null]);
  assert.deepEqual([progresso.confrontoRelativo(n.risultato, misto).esito, progresso.confrontoRelativo(n.risultato, misto).differenzaPunti],
    [CONFRONTO.SOTTO, -32.08]);
});

test('Distribuzione degli studenti per banda del proprio complessivo (P11): solo conteggi, parziali a parte', () => {
  const complessivi = [
    complessivoAlfa([criterioAlfa([2, 2, 2])]), complessivoAlfa([criterioAlfa([2, 2])]),
    complessivoAlfa([criterioAlfa([0, 0, 0])]), complessivoAlfa([criterioAlfa([])]),
  ];
  const d = progresso.distribuzioneStudenti(complessivi, P_ALFA);
  assert.deepEqual(d.base, { n: 3, N: 4 });
  const ottimo = d.bande.find((b) => b.livello === 5);
  assert.deepEqual([ottimo.studenti, ottimo.studentiParziali, ottimo.larghezza], [2, 1, 66.66]);
  assert.deepEqual([d.bande.find((b) => b.livello === 0).studenti, d.certezza], [1, CERTEZZA.PARZIALE]);
  assert.ok(d.bande.every((b) => !('nomi' in b) && !('studentiIds' in b)), 'nessuna persona identificata');
});
