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

test('risultatoCorrenteMediaMobile: 0,1,2,2 -> ultime 3 = 1,2,2 -> media 1,67; con meno di 3 usa tutte; vuoto = non valutato', () => {
  const { risultatoCorrenteMediaMobile } = require('../server/lib/calcoloEsiti');
  const r = risultatoCorrenteMediaMobile([0, 1, 2, 2], 2);
  assert.equal(r.media, 1.67);
  assert.equal(r.percentuale, 83.33);
  assert.equal(r.osservazioniConsiderate, 3);
  assert.equal(r.osservazioniTotali, 4);
  assert.equal(risultatoCorrenteMediaMobile([0, 2], 2).media, 1);
  const vuoto = risultatoCorrenteMediaMobile([], 2);
  assert.equal(vuoto.media, null);
  assert.equal(vuoto.percentuale, null);
});

// ===========================================================================
// REPORT PEDAGOGICI (specifica v2.7) — server/lib/calcoloProgresso.js
// I valori attesi sono quelli dei dataset calcolati a mano nella specifica.
// ===========================================================================

const progresso = require('../server/lib/calcoloProgresso');

const SCALA_ALFA = { valoreMinimo: 0, valoreMassimo: 2 };
const SCALA_BETA = { valoreMinimo: 1, valoreMassimo: 4 };
const P_ALFA = progresso.preparaBande(BANDE_ALFA);
const P_BETA = progresso.preparaBande([
  { soglia_minima: '85.00', etichetta: 'ECCELLENTE' },
  { soglia_minima: '70.00', etichetta: 'BUONO' },
  { soglia_minima: '55.00', etichetta: 'SUFFICIENTE' },
  { soglia_minima: '0.00', etichetta: 'INSUFFICIENTE' },
]);

const criterioAlfa = (valori) => progresso.risultatoCriterioStudente(valori, SCALA_ALFA, P_ALFA);

test('U1 criterio: 0,1,2,2 -> media mobile 1,67 (83,33% DISTINTO), cumulativo 62,5% distinto dal corrente', () => {
  const r = criterioAlfa([0, 1, 2, 2]);
  assert.equal(r.media, 1.67);
  assert.equal(r.percentuale, 83.33);
  assert.equal(r.giudizio, 'DISTINTO');
  assert.equal(r.osservazioniConsiderate, 3);
  assert.equal(r.osservazioniTotali, 4);
  assert.equal(r.cumulativo.percentuale, 62.5);
  assert.equal(r.cumulativo.giudizio, 'DISCRETO');
  assert.deepEqual([r.cumulativo.punteggioOttenuto, r.cumulativo.punteggioMassimo], [5, 8]);
});

test('U2 criterio: con meno di 3 osservazioni usa tutte; livelli di copertura 0/1/2/3+', () => {
  const una = criterioAlfa([1]);
  assert.deepEqual([una.media, una.percentuale, una.giudizio, una.livelloCopertura], [1, 50, 'SUFFICIENTE', 1]);
  const due = criterioAlfa([2, 0]);
  assert.deepEqual([due.media, due.percentuale, due.osservazioniConsiderate, due.livelloCopertura], [1, 50, 2, 2]);
  assert.equal(criterioAlfa([0, 1, 2]).livelloCopertura, 3);
  assert.equal(criterioAlfa([0, 1, 2, 2, 2]).livelloCopertura, 3, '3 o più = consolidato');
  // Lo 0 è una valutazione reale: una sola osservazione a 0 dà 0%, non "non valutato".
  const zero = criterioAlfa([0]);
  assert.deepEqual([zero.percentuale, zero.giudizio], [0, 'NON SUFFICIENTE']);
});

test('U3 criterio non osservato: tutto nullo, mai 0', () => {
  const r = criterioAlfa([]);
  assert.equal(r.media, null);
  assert.equal(r.percentuale, null);
  assert.equal(r.giudizio, '');
  assert.equal(r.livelloGiudizio, null);
  assert.equal(r.cumulativo.percentuale, null);
  assert.equal(r.livelloCopertura, 0);
});

test('U4 nucleo parzialmente osservato: media dei soli criteri valutati, a pesi uguali; cumulativo = media dei cumulativi', () => {
  const criteri = [[0, 1, 2, 2], [2, 0], [1], []].map(criterioAlfa);
  const n = progresso.aggregaCriteriStudente(criteri, SCALA_ALFA, P_ALFA);
  assert.equal(n.percentuale, 61.11);
  assert.equal(n.giudizio, 'DISCRETO');
  assert.deepEqual([n.criteriValutati, n.criteriTotali], [3, 4]);
  assert.equal(n.cumulativo.percentuale, 54.17, 'media dei cumulativi (62,5 + 50 + 50) / 3, non il pool 8/14 = 57,14');
  assert.deepEqual(n.copertura, { consolidati: 1, provvisori: 1, indicativi: 1, nonValutati: 1 });
  assert.equal(n.puntoPieno, false);

  const vuoto = progresso.aggregaCriteriStudente([[], []].map(criterioAlfa), SCALA_ALFA, P_ALFA);
  assert.deepEqual([vuoto.percentuale, vuoto.giudizio, vuoto.posizioneRadar, vuoto.criteriValutati], [null, '', null, 0]);
});

test('U5 complessivo studente: media dei criteri valutati della materia, NON media dei nuclei', () => {
  const numeri = [[0, 1, 2, 2], [2, 0], [1], []].map(criterioAlfa);
  const spazio = [[2, 2, 2, 1, 0], [], [], []].map(criterioAlfa);
  const nucleoSpazio = progresso.aggregaCriteriStudente(spazio, SCALA_ALFA, P_ALFA);
  assert.equal(nucleoSpazio.percentuale, 50, 'finestra 2,1,0');
  assert.equal(nucleoSpazio.cumulativo.percentuale, 70, 'studente in calo: corrente sotto il cumulativo');
  const g = progresso.aggregaCriteriStudente([...numeri, ...spazio], SCALA_ALFA, P_ALFA);
  assert.equal(g.percentuale, 58.33, '(83,33 + 50 + 50 + 50) / 4, non (61,11 + 50) / 2 = 55,56');
  assert.equal(g.giudizio, 'SUFFICIENTE');
  assert.equal(g.cumulativo.percentuale, 58.13);
  assert.deepEqual([g.criteriValutati, g.criteriTotali], [4, 8]);
});

test('U6 scala 1-4: percentuale pedagogica (media/massimo) e posizioneRadar (min->max) sono grandezze diverse', () => {
  const criterioBeta = (valori) => progresso.risultatoCriterioStudente(valori, SCALA_BETA, P_BETA);
  const a = criterioBeta([2, 4, 3, 4]);
  assert.deepEqual([a.media, a.percentuale, a.giudizio], [3.67, 91.67, 'ECCELLENTE']);
  assert.equal(a.cumulativo.percentuale, 81.25);
  const b = criterioBeta([1]);
  assert.deepEqual([b.percentuale, b.giudizio], [25, 'INSUFFICIENTE'], 'il minimo della scala vale 25%, non 0%');
  const nucleo = progresso.aggregaCriteriStudente([a, b, criterioBeta([2, 3])], SCALA_BETA, P_BETA);
  assert.equal(nucleo.percentuale, 59.72);
  assert.equal(nucleo.giudizio, 'SUFFICIENTE', 'il giudizio usa la percentuale pedagogica');
  assert.equal(nucleo.posizioneRadar, 46.3);
  assert.equal(nucleo.cumulativo.percentuale, 56.25);

  assert.deepEqual([1, 2, 3, 4].map((v) => arrotonda(progresso.posizioneRadarDaMedia(v, SCALA_BETA))), [0, 33.33, 66.67, 100]);
  const anelli = progresso.bandeConPosizioneRadar(P_BETA, SCALA_BETA);
  assert.deepEqual(anelli.map((x) => [x.etichetta, x.posizioneRadar]), [
    ['ECCELLENTE', 80], ['BUONO', 60], ['SUFFICIENTE', 40], ['INSUFFICIENTE', null],
  ], 'una soglia sotto il minimo della scala non ha anello');
  assert.deepEqual(anelli.map((x) => x.livello), [3, 2, 1, 0]);
});

function arrotonda(v) { return v === null ? null : Math.round(v * 100) / 100; }

test('U7 scala 0-2: percentuale e posizioneRadar coincidono; scala con un solo valore -> posizione nulla', () => {
  const n = progresso.aggregaCriteriStudente([[0, 1, 2, 2], [2, 0], [1]].map(criterioAlfa), SCALA_ALFA, P_ALFA);
  assert.equal(n.posizioneRadar, n.percentuale);
  assert.deepEqual(
    progresso.bandeConPosizioneRadar(P_ALFA, SCALA_ALFA).map((x) => x.posizioneRadar), [90, 80, 70, 60, 50, null]
  );
  assert.equal(progresso.posizioneRadarDaMedia(3, { valoreMinimo: 3, valoreMassimo: 3 }), null);
});

test('U8 radar: punto pieno solo con tutti i criteri consolidati; confronto nucleo/complessivo per banda', () => {
  const pieno = progresso.aggregaCriteriStudente([[2, 2, 2], [1, 2, 2, 2]].map(criterioAlfa), SCALA_ALFA, P_ALFA);
  assert.equal(pieno.puntoPieno, true);
  const conProvvisorio = progresso.aggregaCriteriStudente([[2, 2, 2], [2, 2]].map(criterioAlfa), SCALA_ALFA, P_ALFA);
  assert.equal(conProvvisorio.puntoPieno, false);
  const conNonValutato = progresso.aggregaCriteriStudente([[2, 2, 2], []].map(criterioAlfa), SCALA_ALFA, P_ALFA);
  assert.equal(conNonValutato.puntoPieno, false);

// Il confronto nucleo/complessivo è verificato nei test "Semantica" più sotto (livello assoluto e confronto relativo separati).
});

// --- Classe: dataset di 8 studenti della specifica (valori R in percentuale; "-" = non valutato) ---
const T = 100 / 3; // un terzo di scala percentuale: 33,33
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

test('U9 classe: K(c) = media dei risultati degli studenti valutati; nucleo = media dei soli criteri rappresentativi', () => {
  const n = progresso.nucleoDiClasse(['C1', 'C2', 'C3', 'C4'], righeDa(CLASSE_8, 8), P_ALFA);
  const c = Object.fromEntries(n.criteri.map((x) => [x.id, x]));
  assert.deepEqual([c.C1.risultato.percentuale, c.C1.risultato.giudizio, c.C1.copertura.studentiValutati], [85.42, 'DISTINTO', 8]);
  assert.deepEqual([c.C2.risultato.percentuale, c.C2.risultato.giudizio, c.C2.copertura.studentiValutati], [42.86, 'NON SUFFICIENTE', 7]);
  assert.deepEqual([c.C3.risultato.percentuale, c.C3.risultato.giudizio, c.C3.copertura.studentiValutati], [79.17, 'BUONO', 8]);
  assert.deepEqual([c.C4.rappresentativo, c.C4.statoCopertura], [false, 'poco_osservato'], '1 studente su 8');
  assert.equal(n.risultato.percentuale, 69.15, 'C4 (100% su un solo studente) non entra: con C4 sarebbe 76,86');
  assert.equal(n.risultato.giudizio, 'DISCRETO');
  assert.deepEqual([n.risultato.criteriRappresentativi, n.risultato.criteriTotali], [3, 4]);
  assert.deepEqual(n.copertura, { studentiValutati: 8, studentiTotali: 8 });
  assert.equal(c.C1.distribuzioneGiudizi.reduce((t, d) => t + d.studenti, 0), 8);

  const complessivo = progresso.complessivoDiClasse([n], P_ALFA);
  assert.deepEqual([complessivo.percentuale, complessivo.criteriRappresentativi, complessivo.criteriTotali], [69.15, 3, 4]);
});

test('U10 classe: un criterio valutato esattamente da metà degli iscritti NON è rappresentativo; nessuno studente = non osservato', () => {
  const matrice = { C1: [100, 100, 100, 100], C2: [50, 50, null, null], C3: [50, 50, 50, null], C4: [null, null, null, null] };
  const n = progresso.nucleoDiClasse(['C1', 'C2', 'C3', 'C4'], righeDa(matrice, 4), P_ALFA);
  const c = Object.fromEntries(n.criteri.map((x) => [x.id, x]));
  assert.deepEqual([c.C2.rappresentativo, c.C2.statoCopertura], [false, 'poco_osservato'], '2 su 4');
  assert.equal(c.C3.rappresentativo, true, '3 su 4');
  assert.deepEqual([c.C4.statoCopertura, c.C4.risultato.percentuale], ['non_osservato', null], 'mai 0');
  assert.equal(n.risultato.percentuale, 75, '(100 + 50) / 2: solo C1 e C3');

  const vuoto = progresso.nucleoDiClasse(['C1'], righeDa({ C1: [null, null] }, 2), P_ALFA);
  assert.deepEqual([vuoto.risultato.percentuale, vuoto.risultato.giudizio, vuoto.copertura.studentiValutati], [null, '', 0]);
});

test('U11 classe: criteri sopra e sotto il nucleo (banda diversa E almeno 2/3 dei confrontabili concordi, pari inclusi)', () => {
  const n = progresso.nucleoDiClasse(['C1', 'C2', 'C3', 'C4'], righeDa(CLASSE_8, 8), P_ALFA);
  const c = Object.fromEntries(n.criteri.map((x) => [x.id, x]));
  assert.deepEqual(c.C1.confronto, { confrontabili: 8, inferiori: 1, superiori: 7, pari: 0 });
  assert.deepEqual(c.C1.confrontoConNucleo, { esito: 'superiore', differenzaPunti: 16.27, confermato: true });
  assert.deepEqual(c.C2.confronto, { confrontabili: 7, inferiori: 7, superiori: 0, pari: 0 });
  assert.deepEqual(c.C2.confrontoConNucleo, { esito: 'inferiore', differenzaPunti: -26.29, confermato: true });  assert.deepEqual([c.C2.risultato.giudizio, c.C2.risultato.critico], ['NON SUFFICIENTE', true], 'il livello assoluto resta leggibile accanto al confronto');
  assert.deepEqual(c.C3.confronto, { confrontabili: 8, inferiori: 0, superiori: 6, pari: 2 });
  assert.deepEqual(c.C3.confrontoConNucleo, { esito: 'superiore', differenzaPunti: 10.02, confermato: true }, '6 su 8 (pari nel denominatore): 18 >= 16');
  assert.deepEqual(c.C4.confronto, { confrontabili: 0, inferiori: 0, superiori: 0, pari: 0 });  assert.deepEqual([c.C4.statoCopertura, c.C4.confrontoConNucleo], ['poco_osservato', null], 'poco osservato: nessun confronto, mai "debole"');  assert.ok(n.criteri.every((x) => x.stato === undefined), 'nessuno stato unico che fonda copertura, livello e confronto');
});

test('U12 classe: nessun falso allarme relativo (meno di 6 confrontabili, stessa banda, quota 2/3 non raggiunta)', () => {
  // Stessi rapporti del dataset, ma solo 5 studenti: differenze nette, però troppo pochi confrontabili.
  const cinque = { C1: [100, 100, 100, 100, 100], C2: [0, 0, 0, 0, 0] };
  const pochi = progresso.nucleoDiClasse(['C1', 'C2'], righeDa(cinque, 5), P_ALFA);
  assert.deepEqual(pochi.criteri.map((x) => [x.confrontoConNucleo.esito, x.confrontoConNucleo.confermato]), [['superiore', false], ['inferiore', false]]);  assert.deepEqual([pochi.criteri[1].risultato.giudizio, pochi.criteri[1].risultato.critico], ['NON SUFFICIENTE', true],    'differenza non confermata, ma il livello critico del criterio resta segnalato: sono assi distinti');
  assert.equal(pochi.criteri[1].confronto.confrontabili, 5);

  // Stessa banda del nucleo: differenza coerente fra tutti gli studenti, ma nessun cambio di giudizio.
  const stessaBanda = { C1: [96, 96, 96, 96, 96, 96], C2: [92, 92, 92, 92, 92, 92] };
  const s = progresso.nucleoDiClasse(['C1', 'C2'], righeDa(stessaBanda, 6), P_ALFA);
  assert.deepEqual(s.criteri.map((x) => x.risultato.giudizio), ['OTTIMO', 'OTTIMO']);
  assert.deepEqual(s.criteri.map((x) => [x.confrontoConNucleo.esito, x.confrontoConNucleo.confermato]), [['allineato', null], ['allineato', null]]);  assert.deepEqual(s.criteri.map((x) => x.risultato.critico), [false, false]);
  assert.equal(s.criteri[1].confronto.inferiori, 6);

  // Banda inferiore, ma solo 3 studenti su 6 vanno peggio (un sottogruppo molto basso): quota non raggiunta.
  const sottogruppo = { C1: [80, 80, 80, 80, 80, 80], C2: [0, 0, 0, 90, 90, 90] };
  const q = progresso.nucleoDiClasse(['C1', 'C2'], righeDa(sottogruppo, 6), P_ALFA);
  assert.deepEqual([q.criteri[1].risultato.percentuale, q.criteri[1].confronto.inferiori], [45, 3]);
  assert.deepEqual([q.criteri[1].confrontoConNucleo.esito, q.criteri[1].confrontoConNucleo.confermato], ['inferiore', false], '3 su 6 < 2/3');  assert.equal(q.criteri[1].risultato.critico, true);
  assert.equal(q.criteri[1].distribuzioneGiudizi.find((d) => d.etichetta === 'NON SUFFICIENTE').studenti, 3,
    'la dispersione resta visibile nella distribuzione');
});

// ===========================================================================
// SEMANTICA: livello assoluto, confronto relativo, copertura e criticità sono assi SEPARATI.
// Un risultato nella banda più bassa dell'istituto non può mai risultare "normale" solo perché
// è uguale a un riferimento altrettanto basso.
// ===========================================================================

const ESITI_RELATIVI = ['superiore', 'inferiore', 'allineato'];

/** Nucleo e complessivo come li produce il motore: livello assoluto di ciascuno + confronto relativo. */
function casoNucleo(percentualeComplessivo, percentualeNucleo, bande) {
  const complessivo = { percentualeEsatta: percentualeComplessivo, ...progresso.giudizioDi(percentualeComplessivo, bande) };
  const nucleo = { percentualeEsatta: percentualeNucleo, ...progresso.giudizioDi(percentualeNucleo, bande) };
  return { complessivo, nucleo, confronto: progresso.confrontoRelativo(nucleo, complessivo) };
}

test('Semantica: casi A-H con le bande di Alfa — il livello assoluto non è mai sostituito dal confronto', () => {
  // [complessivo, nucleo] -> [giudizio del nucleo, critico, confronto, differenza in punti, difficoltà generalizzata]
  const casi = {
    A: [[25, 25], ['NON SUFFICIENTE', true, 'allineato', 0, true]],
    B: [[25, 40], ['NON SUFFICIENTE', true, 'allineato', 15, true]],
    C: [[40, 25], ['NON SUFFICIENTE', true, 'allineato', -15, true]],
    D: [[70, 70], ['BUONO', false, 'allineato', 0, false]],
    E: [[70, 80], ['DISTINTO', false, 'superiore', 10, false]],
    F: [[70, 60], ['DISCRETO', false, 'inferiore', -10, false]],
    G: [[90, 60], ['DISCRETO', false, 'inferiore', -30, false]],
    H: [[60, 90], ['OTTIMO', false, 'superiore', 30, false]],
  };
  Object.entries(casi).forEach(([nome, [[complessivo, nucleo], atteso]]) => {
    const r = casoNucleo(complessivo, nucleo, P_ALFA);
    assert.deepEqual(
      [r.nucleo.giudizio, r.nucleo.critico, r.confronto.esito, r.confronto.differenzaPunti, progresso.difficoltaGeneralizzata(r.complessivo)],
      atteso, `caso ${nome}`
    );
    assert.ok(ESITI_RELATIVI.includes(r.confronto.esito), 'il confronto è solo relativo: nessun valore "nella norma"');
  });
  // Caso A, il caso patologico: allineato a un complessivo critico NON significa "nessuna attenzione".
  const a = casoNucleo(25, 25, P_ALFA);
  assert.deepEqual([a.confronto.esito, a.nucleo.critico, a.complessivo.critico], ['allineato', true, true]);
});

test('Semantica: la banda critica è quella con la posizione più bassa configurata dal tenant, senza soglie né etichette fisse', () => {
  // Beta: la banda più bassa arriva fino a 55, non a 50, e ha un altro nome.
  assert.deepEqual(P_BETA.filter((b) => b.critica).map((b) => b.etichetta), ['INSUFFICIENTE']);
  assert.deepEqual([52, 55, 70].map((p) => progresso.giudizioDi(p, P_BETA).critico), [true, false, false]);
  assert.deepEqual([52, 55].map((p) => progresso.giudizioDi(p, P_ALFA).critico), [false, false], 'in Alfa 52% è SUFFICIENTE: non critico');
  assert.equal(progresso.giudizioDi(49.99, P_ALFA).critico, true);

  // Istituto inventato: etichette e soglie arbitrarie, fornite in disordine.
  const altre = progresso.preparaBande([
    { soglia_minima: 75, etichetta: 'Verde' }, { soglia_minima: 0, etichetta: 'Rosso' }, { soglia_minima: 40, etichetta: 'Giallo' },
  ]);
  assert.deepEqual(altre.map((b) => [b.etichetta, b.livello, b.critica]), [['Verde', 2, false], ['Giallo', 1, false], ['Rosso', 0, true]]);
  assert.deepEqual([39.99, 40, 90].map((p) => progresso.giudizioDi(p, altre).critico), [true, false, false]);
  assert.deepEqual(casoNucleo(30, 35, altre).confronto, { esito: 'allineato', differenzaPunti: 5 });
  assert.equal(casoNucleo(30, 35, altre).nucleo.critico, true);

  // Una sola banda configurata: è per forza la più bassa.
  const unica = progresso.preparaBande([{ soglia_minima: 0, etichetta: 'Unica' }]);
  assert.equal(progresso.giudizioDi(100, unica).critico, true);

  // La criticità viaggia con le bande restituite alla UI.
  assert.deepEqual(progresso.bandeConPosizioneRadar(P_ALFA, SCALA_ALFA).map((b) => b.critica), [false, false, false, false, false, true]);
});

test('Semantica: non valutato non è né critico né confrontabile', () => {
  assert.deepEqual(progresso.giudizioDi(null, P_ALFA), { giudizio: '', livelloGiudizio: null, critico: null });
  assert.equal(casoNucleo(70, null, P_ALFA).confronto, null);
  assert.equal(casoNucleo(null, 70, P_ALFA).confronto, null);
  assert.equal(progresso.difficoltaGeneralizzata({ critico: null }), false);
});

test('Semantica (studente): nucleo al 25% con complessivo al 25% -> critico e allineato, difficoltà generalizzata', () => {
  // Tutti i criteri valutati valgono 25% (una osservazione 0 e una 1 su scala 0-2).
  const numeri = [[0, 1], [1, 0]].map(criterioAlfa);
  const spazio = [[0, 1]].map(criterioAlfa);
  const nucleo = progresso.aggregaCriteriStudente(numeri, SCALA_ALFA, P_ALFA);
  const complessivo = progresso.aggregaCriteriStudente([...numeri, ...spazio], SCALA_ALFA, P_ALFA);
  assert.deepEqual([nucleo.percentuale, nucleo.giudizio, nucleo.critico], [25, 'NON SUFFICIENTE', true]);
  assert.deepEqual([complessivo.percentuale, complessivo.critico], [25, true]);
  assert.deepEqual(progresso.confrontoRelativo(nucleo, complessivo), { esito: 'allineato', differenzaPunti: 0 });
  assert.equal(progresso.difficoltaGeneralizzata(complessivo), true);
  assert.equal(numeri[0].critico, true, 'anche il singolo criterio porta il proprio livello assoluto');

  // Studente con complessivo 70% (BUONO) e nucleo 70%: allineato e NON critico -> nessuna difficoltà generalizzata.
  const buoni = [[1, 2, 1, 2, 1, 2].slice(0, 3), [2, 1, 2]].map(criterioAlfa); // 66,67 e 83,33 -> 75
  const g = progresso.aggregaCriteriStudente(buoni, SCALA_ALFA, P_ALFA);
  assert.deepEqual([g.giudizio, g.critico, progresso.difficoltaGeneralizzata(g)], ['BUONO', false, false]);
});

test('Semantica (classe): criterio NON SUFFICIENTE in un nucleo NON SUFFICIENTE -> allineato al nucleo MA critico', () => {
  const classe = { C1: [25, 25, 25, 25, 25, 25], C2: [40, 40, 40, 40, 40, 40], C3: [25, 40, 25, 40, 25, 40] };
  const n = progresso.nucleoDiClasse(['C1', 'C2', 'C3'], righeDa(classe, 6), P_ALFA);
  assert.deepEqual([n.risultato.percentuale, n.risultato.giudizio, n.risultato.critico], [32.5, 'NON SUFFICIENTE', true]);
  n.criteri.forEach((c) => {
    assert.equal(c.statoCopertura, 'rappresentativo');
    assert.deepEqual([c.risultato.giudizio, c.risultato.critico], ['NON SUFFICIENTE', true], `criterio ${c.id}`);
    assert.deepEqual([c.confrontoConNucleo.esito, c.confrontoConNucleo.confermato], ['allineato', null]);
  });
  assert.equal(n.criteri[1].confrontoConNucleo.differenzaPunti, 7.5, 'la differenza numerica resta visibile anche dentro la stessa banda');

  const complessivo = progresso.complessivoDiClasse([n], P_ALFA);
  assert.deepEqual([complessivo.critico, progresso.difficoltaGeneralizzata(complessivo)], [true, true]);
  assert.deepEqual(progresso.confrontoRelativo(n.risultato, complessivo), { esito: 'allineato', differenzaPunti: 0 });

  // Classe a due nuclei: uno OTTIMO, uno NON SUFFICIENTE -> complessivo non critico, il nucleo basso è critico E sotto il complessivo.
  const alto = progresso.nucleoDiClasse(['D1'], righeDa({ D1: [100, 100, 100, 100, 100, 100] }, 6), P_ALFA);
  const tutto = progresso.complessivoDiClasse([n, alto], P_ALFA); // (25 + 40 + 32,5 + 100) / 4 = 49,38
  assert.deepEqual([tutto.percentuale, tutto.critico], [49.38, true]);
  const dueAlti = progresso.nucleoDiClasse(['D1', 'D2', 'D3'], righeDa({ D1: [100, 100, 100, 100, 100, 100], D2: [100, 100, 100, 100, 100, 100], D3: [90, 90, 90, 90, 90, 90] }, 6), P_ALFA);
  const misto = progresso.complessivoDiClasse([n, dueAlti], P_ALFA); // (97,5 + 290) / 6 = 64,58
  assert.deepEqual([misto.percentuale, misto.giudizio, misto.critico], [64.58, 'DISCRETO', false]);
  assert.deepEqual(progresso.confrontoRelativo(n.risultato, misto), { esito: 'inferiore', differenzaPunti: -32.08 });
  assert.equal(n.risultato.critico, true, 'critico e sotto il complessivo: i due assi restano entrambi');
  assert.equal(progresso.confrontoRelativo(dueAlti.risultato, misto).esito, 'superiore');
});

// ===========================================================================
// RADAR DEI NUCLEI — public/radar.js: sola geometria, i valori arrivano dal server.
// ===========================================================================

const RadarNuclei = require('../public/radar');
const assiRadar = (posizioni, pieno = true) => posizioni.map((posizione, i) => ({ id: i + 1, posizione, pieno }));

test('U13 radar: un asse per nucleo, numero variabile; raggio proporzionale alla posizione ricevuta', () => {
  for (const numero of [3, 4, 5, 8]) {
    const g = RadarNuclei.geometria({ assi: assiRadar(Array(numero).fill(50)), bande: [] });
    assert.equal(g.modalita, 'radar');
    assert.equal(g.assi.length, numero);
    assert.equal(g.tratti.length, numero, 'poligono chiuso: un lato per asse');
    g.assi.forEach((a) => assert.ok(Math.abs(Math.hypot(a.punto.x, a.punto.y) - 50) < 0.02));
  }
  const g = RadarNuclei.geometria({ assi: assiRadar([100, 0, 25]), bande: [] });
  assert.deepEqual(g.assi[0].punto, { x: 0, y: -100 }, 'primo asse in alto');
  assert.deepEqual(g.assi[1].punto, { x: 0, y: 0 }, 'posizione 0 = minimo della scala: è un punto reale, al centro');
  assert.ok(Math.abs(Math.hypot(g.assi[2].punto.x, g.assi[2].punto.y) - 25) < 0.02);
});

test('U13 radar: nucleo non valutato -> asse senza punto, nessuno zero inventato, poligono interrotto', () => {
  const g = RadarNuclei.geometria({ assi: assiRadar([80, null, 60, 40]), bande: [] });
  assert.deepEqual(g.assi.map((a) => a.valutato), [true, false, true, true]);
  assert.equal(g.assi[1].punto, null);
  assert.equal(g.assi[1].posizione, null);
  assert.ok(g.assi[1].estremo, "l'asse resta disegnato");
  // Lati solo tra assi adiacenti entrambi valutati: 2-3 e 3-0. Nessun lato tocca l'asse 1.
  assert.equal(g.tratti.length, 2);
  assert.deepEqual(g.tratti.map((t) => [t.da, t.a]), [[g.assi[2].punto, g.assi[3].punto], [g.assi[3].punto, g.assi[0].punto]]);

  const tuttiVuoti = RadarNuclei.geometria({ assi: assiRadar([null, null, null]), bande: [] });
  assert.deepEqual([tuttiVuoti.tratti.length, tuttiVuoti.assi.filter((a) => a.punto).length], [0, 0]);
});

test('U13 radar: punto vuoto e lato tratteggiato per i risultati parziali; anelli dalle bande ricevute', () => {
  const assi = [{ id: 1, posizione: 90, pieno: true }, { id: 2, posizione: 50, pieno: false }, { id: 3, posizione: 70, pieno: true }];
  const bande = [
    { etichetta: 'ECCELLENTE', posizione: 80 }, { etichetta: 'BUONO', posizione: 60 },
    { etichetta: 'SUFFICIENTE', posizione: 40 }, { etichetta: 'INSUFFICIENTE', posizione: null },
  ];
  const g = RadarNuclei.geometria({ assi, bande });
  assert.deepEqual(g.assi.map((a) => a.pieno), [true, false, true]);
  assert.deepEqual(g.tratti.map((t) => t.tratteggiato), [true, true, false], 'tratteggiati i due lati che toccano il punto vuoto');
  assert.deepEqual(g.anelli.map((a) => [a.etichetta, a.raggio]), [['ECCELLENTE', 80], ['BUONO', 60], ['SUFFICIENTE', 40]],
    'una banda senza posizione non ha anello; nessuna soglia è scritta nel frontend');
  assert.ok(g.anelli.every((a) => a.vertici.length === 3));
});

test('U13 radar: con meno di 3 nuclei si usano le barre, con gli stessi valori', () => {
  const uno = RadarNuclei.geometria({ assi: assiRadar([66.67]), bande: [{ etichetta: 'B', posizione: 50 }] });
  assert.deepEqual([uno.modalita, uno.tratti.length, uno.assi[0].posizione, uno.anelli[0].posizione], ['barre', 0, 66.67, 50]);
  const due = RadarNuclei.geometria({ assi: assiRadar([40, null]), bande: [] });
  assert.deepEqual([due.modalita, due.assi[1].valutato], ['barre', false]);
  assert.equal(RadarNuclei.geometria({ assi: [], bande: [] }).modalita, 'barre');
});

// ===========================================================================
// COERENZA DEL GIUDIZIO: una sola regola di confronto con le soglie, per tutti i report.
// La tolleranza neutralizza solo l'errore di virgola mobile, non sposta valori realmente sotto soglia.
// ===========================================================================

const { raggiungeSoglia, TOLLERANZA_NUMERICA } = require('../server/lib/calcoloEsiti');
const giudizioVecchioENuovo = (valore) => [calcolaGiudizio(valore, BANDE_ALFA), progresso.giudizioDi(valore, P_ALFA).giudizio];

test('Giudizio: un valore pari alla soglia ma rappresentato come 69,99999999999999 è classificato nella banda della soglia', () => {
  const quasiSettanta = 69.99999999999999;
  assert.notEqual(quasiSettanta, 70, 'è davvero un numero diverso da 70 in virgola mobile');
  assert.deepEqual(giudizioVecchioENuovo(quasiSettanta), ['BUONO', 'BUONO']);
  assert.deepEqual(giudizioVecchioENuovo(70), ['BUONO', 'BUONO']);
  assert.deepEqual(giudizioVecchioENuovo(49.99999999999999), ['SUFFICIENTE', 'SUFFICIENTE']);
  assert.equal(raggiungeSoglia(quasiSettanta, 70), true);
});

test('Giudizio: un valore realmente inferiore alla soglia resta nella banda inferiore', () => {
  assert.deepEqual(giudizioVecchioENuovo(69.99), ['DISCRETO', 'DISCRETO']);
  assert.deepEqual(giudizioVecchioENuovo(69.999999), ['DISCRETO', 'DISCRETO'], 'un milionesimo sotto è una differenza reale');
  assert.deepEqual(giudizioVecchioENuovo(49.99), ['NON SUFFICIENTE', 'NON SUFFICIENTE']);
  assert.equal(raggiungeSoglia(70 - 1e-6, 70), false);
  // La più piccola differenza reale tra due risultati (2 decimali) è enormemente più grande della tolleranza.
  assert.ok(TOLLERANZA_NUMERICA < 0.01 / 1000);
});

test('Giudizio: un valore realmente superiore alla soglia resta nella banda superiore', () => {
  assert.deepEqual(giudizioVecchioENuovo(70.01), ['BUONO', 'BUONO']);
  assert.deepEqual(giudizioVecchioENuovo(79.99), ['BUONO', 'BUONO'], 'appena sotto 80 resta BUONO, non diventa DISTINTO');
  assert.deepEqual(giudizioVecchioENuovo(80), ['DISTINTO', 'DISTINTO']);
  assert.deepEqual(giudizioVecchioENuovo(100), ['OTTIMO', 'OTTIMO']);
  assert.deepEqual(giudizioVecchioENuovo(0), ['NON SUFFICIENTE', 'NON SUFFICIENTE']);
  assert.deepEqual(giudizioVecchioENuovo(null), ['', '']);
});

test('Giudizio: il percorso del report attività e il motore dei report pedagogici danno lo stesso giudizio sul caso limite', () => {
  // Report attività: media semplice dei criteri 2/2, 28/30 e 6/36 = 70% esatto, ma 69,99999999999999 in virgola mobile.
  const esiti = [[2, 2], [28, 30], [6, 36]].map(([punteggioOttenuto, punteggioMassimo]) => ({ punteggioOttenuto, punteggioMassimo }));
  const media = mediaSemplicePercentuali(esiti);
  assert.equal(media.percentualeEsatta, 69.99999999999999);
  assert.equal(media.percentuale, 70);
  const delReportAttivita = calcolaGiudizio(media.percentualeEsatta, BANDE_ALFA);
  const delMotore = progresso.giudizioDi(media.percentualeEsatta, P_ALFA).giudizio;
  assert.equal(delReportAttivita, 'BUONO', 'coerente con la percentuale mostrata (70%)');
  assert.equal(delReportAttivita, delMotore);

  // Coerenza su tutta la gamma: stesse bande -> stesso giudizio, a passi di un centesimo e attorno a ogni soglia.
  for (let centesimi = 0; centesimi <= 10000; centesimi += 1) {
    const [vecchio, nuovo] = giudizioVecchioENuovo(centesimi / 100);
    assert.equal(vecchio, nuovo, `divergenza a ${centesimi / 100}`);
  }
  BANDE_ALFA.forEach((banda) => [-1e-6, -1e-12, 0, 1e-12, 1e-6].forEach((scarto) => {
    const [vecchio, nuovo] = giudizioVecchioENuovo(banda.soglia_minima + scarto);
    assert.equal(vecchio, nuovo, `divergenza attorno alla soglia ${banda.soglia_minima}`);
  }));
});

// ===========================================================================
// REPORT GLOBALE DELLA CLASSE — progressoDiClasse (motore) e le parti pure del report di classe in
// server/queries/progresso.js. Le righe sono costruite come in produzione: valori VALIDI per studente e
// criterio -> rigaStudenteDiClasse, cioè la stessa funzione del report individuale.
// ===========================================================================

const datiProgresso = require('../server/queries/progresso');

/**
 * @param {Object<string, (number[]|null)[]>} perCriterio - criterio -> per ogni studente i valori osservati in
 *   ordine cronologico (null o assente = studente non osservato su quel criterio).
 */
function righeDiClasse(perCriterio, numeroStudenti, scala = SCALA_ALFA, bande = P_ALFA) {
  return Array.from({ length: numeroStudenti }, (_, s) => progresso.rigaStudenteDiClasse(
    new Map(Object.entries(perCriterio).map(([criterio, valori]) => [criterio, valori[s] || []])), scala, bande
  ));
}

function reportClasse(criteriPerNucleo, perCriterio, numeroStudenti, scala = SCALA_ALFA, bande = P_ALFA) {
  return progresso.progressoDiClasse(criteriPerNucleo, righeDiClasse(perCriterio, numeroStudenti, scala, bande), scala, bande);
}

const criteriPerId = (nucleo) => Object.fromEntries(nucleo.criteri.map((c) => [c.id, c]));
const perTutti = (valori, numeroStudenti) => Array.from({ length: numeroStudenti }, () => valori);
/** I primi `quanti` studenti con questi valori, gli altri non osservati. */
const soloIPrimi = (valori, quanti, numeroStudenti) => Array.from({ length: numeroStudenti }, (_, s) => (s < quanti ? valori : null));

test('Report globale della classe U14 coerenza con il report individuale: R(s,c) e Cum(s,c) sono quelli di risultatoCriterioStudente', () => {
  for (const valori of [[0, 1, 2, 2], [2, 0], [1], [2, 2, 2, 0, 0, 0]]) {
    const individuale = criterioAlfa(valori);
    assert.deepEqual(progresso.rigaStudenteDiClasse(new Map([['C', valori]]), SCALA_ALFA, P_ALFA).get('C'), {
      percentualeEsatta: individuale.percentualeEsatta,
      cumulativoEsatto: individuale.cumulativo.percentualeEsatta,
      osservazioniTotali: valori.length,
    }, `valori ${valori}`);
  }
  assert.equal(progresso.rigaStudenteDiClasse(new Map([['C', []]]), SCALA_ALFA, P_ALFA).has('C'), false,
    'nessuna osservazione valida: lo studente non è valutato su quel criterio');
});

test('Report globale della classe U15 criterio: attuale e storico = media degli R(s,c) e dei Cum(s,c) degli studenti valutati, mai il pool delle osservazioni', () => {
  // Tre studenti con 6, 1 e 2 osservazioni: ognuno pesa una volta.
  const r = reportClasse([['C1']], { C1: [[2, 2, 2, 2, 2, 2], [0], [1, 1]] }, 3);
  const c1 = r.nuclei[0].criteri[0];
  assert.equal(c1.risultato.percentuale, 50, '(100 + 0 + 50) / 3');
  assert.equal(c1.storico.percentuale, 50, '(100 + 0 + 50) / 3');
  assert.notEqual(c1.risultato.percentuale, 66.67, 'pool delle finestre: (6 + 0 + 2) / 12');
  assert.notEqual(c1.storico.percentuale, 77.78, 'pool di tutte le osservazioni: 14 / 18');
  assert.deepEqual([c1.rappresentativo, c1.statoCopertura], [true, 'rappresentativo'], 'tutti valutati');
  assert.deepEqual(c1.copertura, { studentiValutati: 3, studentiTotali: 3, studentiConsolidati: 1 });
  assert.equal(c1.osservazioniTotali, 9);
  assert.deepEqual(c1.distribuzioneGiudizi.filter((d) => d.studenti > 0), [
    { etichetta: 'OTTIMO', studenti: 1 }, { etichetta: 'SUFFICIENTE', studenti: 1 }, { etichetta: 'NON SUFFICIENTE', studenti: 1 },
  ], 'la distribuzione usa il risultato attuale di ogni studente');
});

test('Report globale della classe U16 attuale e storico sono letture distinte: classe in crescita e in calo; giudizio e criticità seguono solo l\'attuale', () => {
  // In crescita: ogni studente 0,0,2,2,2 -> attuale 100 (ultime 3), storico 6/10 = 60.
  const crescita = reportClasse([['C1']], { C1: perTutti([0, 0, 2, 2, 2], 6) }, 6);
  const n = crescita.nuclei[0];
  assert.deepEqual([n.risultato.percentuale, n.risultato.giudizio, n.risultato.critico], [100, 'OTTIMO', false]);
  assert.deepEqual([n.storico.percentuale, n.differenzaCorrenteStorico], [60, 40]);
  assert.deepEqual(
    [crescita.complessivo.risultato.percentuale, crescita.complessivo.storico.percentuale, crescita.complessivo.differenzaCorrenteStorico],
    [100, 60, 40]
  );
  assert.equal(progresso.giudizioDi(60, P_ALFA).giudizio, 'DISCRETO', 'lo storico, se fosse giudicato, darebbe un altro giudizio');

  // In calo: 2,2,2,0,0,0 -> attuale 0 (banda critica), storico 6/12 = 50 (che sarebbe SUFFICIENTE).
  const calo = reportClasse([['C1']], { C1: perTutti([2, 2, 2, 0, 0, 0], 6) }, 6);
  const m = calo.nuclei[0];
  assert.deepEqual([m.risultato.percentuale, m.risultato.giudizio, m.risultato.critico], [0, 'NON SUFFICIENTE', true]);
  assert.deepEqual([m.storico.percentuale, m.differenzaCorrenteStorico], [50, -50]);
  assert.equal(calo.complessivo.difficoltaGeneralizzata, true, 'decisa dal complessivo ATTUALE, anche con lo storico al 50%');
  // Lo storico è solo un numero: nessun giudizio, criticità o confronto.
  for (const storico of [m.storico, m.criteri[0].storico, calo.complessivo.storico]) {
    assert.deepEqual(Object.keys(storico).sort(), ['percentuale', 'percentualeEsatta']);
  }
});

test('Report globale della classe U17 rappresentatività (più della metà sì, metà esatta no), copertura, criteri valutati e rappresentativi distinti', () => {
  const r = reportClasse([['C1', 'C2', 'C3', 'C4'], ['D1']], {
    C1: perTutti([2], 4), C2: soloIPrimi([1], 3, 4), C3: soloIPrimi([2], 2, 4), D1: soloIPrimi([2, 2, 2], 1, 4),
  }, 4);
  const [n, d] = r.nuclei;
  const c = criteriPerId(n);
  assert.deepEqual([c.C1.rappresentativo, c.C2.rappresentativo], [true, true], '4 su 4 e 3 su 4');
  assert.deepEqual([c.C3.rappresentativo, c.C3.statoCopertura, c.C3.risultato.percentuale], [false, 'poco_osservato', 100], 'metà esatta: 2 su 4');
  assert.deepEqual([c.C4.statoCopertura, c.C4.risultato.percentuale], ['non_osservato', null], 'mai 0');
  assert.equal(n.risultato.percentuale, 75, '(100 + 50) / 2: il 100% di C3, osservato su metà classe, non entra');
  assert.deepEqual([n.criteriValutati, n.risultato.criteriRappresentativi, n.risultato.criteriTotali], [3, 2, 4]);
  assert.deepEqual(n.copertura, {
    studentiValutati: 4, studentiTotali: 4, criteriPerStato: { rappresentativo: 2, poco_osservato: 1, non_osservato: 1 },
  });
  // Un solo studente valutato su 4: nucleo non valutato, ma la copertura resta leggibile.
  assert.deepEqual([d.risultato.percentuale, d.criteri[0].statoCopertura, d.copertura.studentiValutati, d.criteriValutati], [null, 'poco_osservato', 1, 1]);
  assert.deepEqual(
    [r.complessivo.risultato.percentuale, r.complessivo.criteriValutati, r.complessivo.risultato.criteriRappresentativi, r.complessivo.risultato.criteriTotali],
    [75, 4, 2, 5]
  );
  assert.deepEqual(r.classe, { studentiTotali: 4, studentiValutati: 4 });
});

test('Report globale della classe U18 nucleo e complessivo, attuale e storico: complessivo = media dei K di TUTTI i criteri rappresentativi, non dei nuclei', () => {
  const r = reportClasse([['C1', 'C2', 'C3'], ['D1']], {
    C1: perTutti([0, 1, 2, 2], 6), // R 83,33 · Cum 62,5
    C2: perTutti([2, 2, 0, 0], 6), // R 33,33 · Cum 50
    C3: perTutti([1], 6), //          R 50    · Cum 50
    D1: perTutti([2, 2, 2], 6), //    R 100   · Cum 100
  }, 6);
  const [n1, n2] = r.nuclei;
  assert.deepEqual([n1.risultato.percentuale, n1.risultato.giudizio, n1.storico.percentuale, n1.differenzaCorrenteStorico], [55.56, 'SUFFICIENTE', 54.17, 1.39]);
  assert.deepEqual([n2.risultato.percentuale, n2.storico.percentuale], [100, 100]);
  const c = r.complessivo;
  assert.deepEqual([c.risultato.percentuale, c.risultato.giudizio, c.storico.percentuale, c.differenzaCorrenteStorico], [66.67, 'DISCRETO', 65.63, 1.04],
    '(83,33 + 33,33 + 50 + 100) / 4 e (62,5 + 50 + 50 + 100) / 4; la media dei nuclei sarebbe 77,78 e 77,08');
  assert.deepEqual([c.risultato.criteriRappresentativi, c.risultato.criteriTotali, c.criteriValutati], [4, 4, 4]);
  // Confronto RELATIVO dei nuclei con il complessivo: il livello assoluto resta quello del nucleo.
  assert.deepEqual(n1.confrontoConComplessivo, { esito: 'inferiore', differenzaPunti: -11.11 });
  assert.deepEqual(n2.confrontoConComplessivo, { esito: 'superiore', differenzaPunti: 33.33 });
  // Criteri sopra/sotto il nucleo confermati dalla classe (6 confrontabili, tutti concordi); C3 è nella stessa banda del nucleo.
  const k = criteriPerId(n1);
  assert.deepEqual(k.C1.confrontoConNucleo, { esito: 'superiore', differenzaPunti: 27.78, confermato: true, motivoNonConfermato: null });
  assert.deepEqual(k.C2.confrontoConNucleo, { esito: 'inferiore', differenzaPunti: -22.22, confermato: true, motivoNonConfermato: null });
  assert.deepEqual(k.C3.confrontoConNucleo, { esito: 'allineato', differenzaPunti: -5.56, confermato: null, motivoNonConfermato: null });
  assert.deepEqual([n1.criteriForti, n1.criteriDeboli], [['C1'], ['C2']]);
  assert.deepEqual([k.C3.confronto.inferiori, k.C3.confronto.confrontabili], [6, 6], 'tutti sotto la propria media, ma stessa banda: nessuna classificazione');
});

test('Report globale della classe U19 forte/debole: banda diversa E almeno 2/3 dei confrontabili concordi (pari nel denominatore), con esattamente 6 confrontabili', () => {
  // A: 100 per tutti. B: 0 per quattro studenti, 100 per due -> K(B) = 33,33; nucleo = 66,67 (DISCRETO).
  const r = reportClasse([['A', 'B']], { A: perTutti([2, 2, 2], 6), B: [...perTutti([0, 0, 0], 4), ...perTutti([2, 2, 2], 2)] }, 6);
  const n = r.nuclei[0];
  const c = criteriPerId(n);
  assert.deepEqual([n.risultato.percentuale, n.risultato.giudizio], [66.67, 'DISCRETO']);
  assert.deepEqual(c.B.confronto, { confrontabili: 6, inferiori: 4, superiori: 0, pari: 2 });
  assert.deepEqual(c.B.confrontoConNucleo, { esito: 'inferiore', differenzaPunti: -33.33, confermato: true, motivoNonConfermato: null },
    '4 su 6: esattamente 2/3, pari inclusi nel denominatore');
  assert.deepEqual(c.A.confrontoConNucleo, { esito: 'superiore', differenzaPunti: 33.33, confermato: true, motivoNonConfermato: null });
  assert.deepEqual([n.criteriForti, n.criteriDeboli], [['A'], ['B']]);
  assert.deepEqual([c.B.risultato.giudizio, c.B.risultato.critico], ['NON SUFFICIENTE', true], 'il livello assoluto resta accanto al confronto');

  // Banda inferiore, ma 3 studenti sotto e 3 pari: 3/6 < 2/3 (escludendo i pari sarebbe 3/3).
  const q = reportClasse([['A', 'B']], { A: perTutti([2, 2, 2], 6), B: [...perTutti([0, 0, 0], 3), ...perTutti([2, 2, 2], 3)] }, 6);
  const m = q.nuclei[0];
  const cq = criteriPerId(m);
  assert.deepEqual([m.risultato.percentuale, m.risultato.giudizio], [75, 'BUONO']);
  assert.deepEqual(cq.B.confronto, { confrontabili: 6, inferiori: 3, superiori: 0, pari: 3 });
  assert.deepEqual(cq.B.confrontoConNucleo, { esito: 'inferiore', differenzaPunti: -25, confermato: false, motivoNonConfermato: 'quota_concordi_non_raggiunta' });
  assert.deepEqual(cq.A.confrontoConNucleo, { esito: 'superiore', differenzaPunti: 25, confermato: false, motivoNonConfermato: 'quota_concordi_non_raggiunta' });
  assert.deepEqual([m.criteriForti, m.criteriDeboli], [[], []], 'differenza non confermata: nessuna classificazione');
});

test('Report globale della classe U20 meno di 6 confrontabili: nessuna classificazione, anche con tutti gli studenti concordi; poco osservato non è mai debole', () => {
  const r = reportClasse([['A', 'B']], { A: perTutti([2, 2, 2], 5), B: perTutti([0, 0, 0], 5) }, 5);
  const n = r.nuclei[0];
  const c = criteriPerId(n);
  assert.deepEqual(c.B.confronto, { confrontabili: 5, inferiori: 5, superiori: 0, pari: 0 });
  assert.deepEqual(c.B.confrontoConNucleo, { esito: 'inferiore', differenzaPunti: -50, confermato: false, motivoNonConfermato: 'confrontabili_insufficienti' });
  assert.equal(c.A.confrontoConNucleo.motivoNonConfermato, 'confrontabili_insufficienti');
  assert.deepEqual([n.criteriForti, n.criteriDeboli], [[], []], 'classe con meno di 6 studenti: nessuna conferma possibile');
  assert.deepEqual([c.B.risultato.giudizio, c.B.risultato.critico], ['NON SUFFICIENTE', true], 'non confermato come "sotto", ma il livello critico resta');

  const poco = reportClasse([['A', 'B']], { A: perTutti([2, 2, 2], 8), B: soloIPrimi([0, 0, 0], 4, 8) }, 8);
  const b = criteriPerId(poco.nuclei[0]).B;
  assert.deepEqual([b.statoCopertura, b.confrontoConNucleo, b.risultato.critico], ['poco_osservato', null, true],
    'poco osservato: nessun confronto, nessuna classificazione; il livello resta un dato a sé');
  assert.deepEqual(poco.nuclei[0].criteriDeboli, []);
});

test('Report globale della classe U21 classe al 25% e nucleo al 25%: NON SUFFICIENTE + livello critico + allineato al complessivo + difficoltà generalizzata', () => {
  const r = reportClasse([['C1', 'C2']], { C1: perTutti([0, 1], 6), C2: perTutti([1, 0], 6) }, 6);
  const n = r.nuclei[0];
  assert.deepEqual([n.risultato.percentuale, n.risultato.giudizio, n.risultato.critico], [25, 'NON SUFFICIENTE', true]);
  assert.deepEqual([r.complessivo.risultato.percentuale, r.complessivo.risultato.critico, r.complessivo.difficoltaGeneralizzata], [25, true, true]);
  assert.deepEqual(n.confrontoConComplessivo, { esito: 'allineato', differenzaPunti: 0 }, 'allineato a un complessivo critico: non è "nella norma"');
  n.criteri.forEach((c) => {
    assert.deepEqual([c.risultato.giudizio, c.risultato.critico], ['NON SUFFICIENTE', true], `criterio ${c.id}: critico...`);
    assert.deepEqual([c.confrontoConNucleo.esito, c.confrontoConNucleo.confermato], ['allineato', null], '...e allineato al nucleo');
  });
  const testo = JSON.stringify(r);
  for (const vietato of ['nella_norma', 'Nella norma', 'punto_di_forza', 'Punto di forza', 'area_di_attenzione', 'Area di attenzione']) {
    assert.ok(!testo.includes(vietato), `il report non deve contenere "${vietato}"`);
  }
});

test('Report globale della classe U22 nucleo critico ma non allineato: sotto un complessivo non critico, senza difficoltà generalizzata', () => {
  const r = reportClasse([['C1', 'C2'], ['D1', 'D2', 'D3']], {
    C1: perTutti([0, 1], 6), C2: perTutti([1, 0], 6), D1: perTutti([2, 2, 2], 6), D2: perTutti([2, 2, 2], 6), D3: perTutti([2, 2, 2], 6),
  }, 6);
  const [basso, alto] = r.nuclei;
  assert.deepEqual([r.complessivo.risultato.percentuale, r.complessivo.risultato.giudizio, r.complessivo.difficoltaGeneralizzata], [70, 'BUONO', false],
    '(25 + 25 + 100 + 100 + 100) / 5');
  assert.deepEqual([basso.risultato.giudizio, basso.risultato.critico], ['NON SUFFICIENTE', true]);
  assert.deepEqual(basso.confrontoConComplessivo, { esito: 'inferiore', differenzaPunti: -45 }, 'critico E sotto il complessivo: due assi distinti');
  assert.deepEqual([alto.confrontoConComplessivo, alto.risultato.critico], [{ esito: 'superiore', differenzaPunti: 30 }, false]);
});

test('Report globale della classe U23 nessun criterio rappresentativo: nucleo e complessivo non valutati, copertura comunque disponibile', () => {
  const r = reportClasse([['C1', 'C2']], { C1: soloIPrimi([2], 2, 4), C2: [null, null, [1], null] }, 4);
  const n = r.nuclei[0];
  assert.deepEqual([n.risultato.percentuale, n.risultato.livelloGiudizio, n.risultato.critico, n.storico.percentuale], [null, null, null, null]);
  assert.deepEqual(n.copertura, {
    studentiValutati: 3, studentiTotali: 4, criteriPerStato: { rappresentativo: 0, poco_osservato: 2, non_osservato: 0 },
  });
  assert.deepEqual([n.criteriValutati, n.risultato.criteriRappresentativi], [2, 0]);
  assert.deepEqual([n.radar, n.confrontoConComplessivo, n.differenzaCorrenteStorico], [{ posizioneRadar: null, puntoPieno: false }, null, null]);
  assert.deepEqual(
    [r.complessivo.risultato.percentuale, r.complessivo.risultato.critico, r.complessivo.storico.percentuale, r.complessivo.difficoltaGeneralizzata],
    [null, null, null, false]
  );
});

test('Report globale della classe U24 casi limite: classe senza studenti, studente senza osservazioni, meno di 3 osservazioni, nucleo senza criteri o senza osservazioni', () => {
  const vuota = progresso.progressoDiClasse([['C1'], []], [], SCALA_ALFA, P_ALFA);
  assert.deepEqual(vuota.classe, { studentiTotali: 0, studentiValutati: 0 });
  assert.deepEqual([vuota.complessivo.risultato.percentuale, vuota.complessivo.difficoltaGeneralizzata], [null, false]);
  assert.deepEqual(vuota.nuclei[0].criteri[0].copertura, { studentiValutati: 0, studentiTotali: 0, studentiConsolidati: 0 });
  assert.equal(vuota.nuclei[0].criteri[0].statoCopertura, 'non_osservato');

  // Tre iscritti, il terzo senza alcuna osservazione: resta nel denominatore, non nella media.
  const r = reportClasse([['C1', 'C2'], ['D1'], []], { C1: [[2, 0], [1], null], C2: [[2, 2, 2, 2], [2, 2, 2], null] }, 3);
  assert.deepEqual(r.classe, { studentiTotali: 3, studentiValutati: 2 });
  const [c1, c2] = r.nuclei[0].criteri;
  assert.deepEqual([c1.risultato.percentuale, c1.copertura.studentiValutati, c1.copertura.studentiTotali, c1.rappresentativo], [50, 2, 3, true],
    'meno di 3 osservazioni: si usano tutte (2,0 -> 50%; 1 -> 50%); 2 studenti su 3 sono più della metà');
  assert.deepEqual([c1.copertura.studentiConsolidati, c2.copertura.studentiConsolidati], [0, 2]);
  // Nucleo senza osservazioni e nucleo senza criteri: non valutati, nessun punto sul radar, mai zero.
  for (const n of [r.nuclei[1], r.nuclei[2]]) {
    assert.deepEqual([n.risultato.percentuale, n.radar.posizioneRadar, n.radar.puntoPieno, n.copertura.studentiValutati], [null, null, false, 0]);
  }
  assert.equal(r.nuclei[2].risultato.criteriTotali, 0);
});

test('Report globale della classe U25 scala 1-4 e 0-2: percentuale pedagogica = valore/massimo, posizione sul radar = minimo->massimo', () => {
  // Beta: valore 4 = 100%, valore 2 = 50% -> K = 75 (BUONO); sul radar 75% equivale a 3 su 1-4 -> 66,67.
  const r = reportClasse([['C1']], { C1: [[4], [2]] }, 2, SCALA_BETA, P_BETA);
  const n = r.nuclei[0];
  assert.deepEqual([n.risultato.percentuale, n.risultato.giudizio, n.risultato.critico, n.radar.posizioneRadar], [75, 'BUONO', false, 66.67]);
  assert.deepEqual(n.criteri[0].distribuzioneGiudizi, [
    { etichetta: 'ECCELLENTE', studenti: 1 }, { etichetta: 'BUONO', studenti: 0 }, { etichetta: 'SUFFICIENTE', studenti: 0 }, { etichetta: 'INSUFFICIENTE', studenti: 1 },
  ]);
  // Il minimo della scala vale 25%, non 0%: critico in Beta (banda più bassa fino a 55) e al centro del radar.
  const minimo = reportClasse([['C1']], { C1: [[1], [1]] }, 2, SCALA_BETA, P_BETA);
  assert.deepEqual([minimo.nuclei[0].risultato.percentuale, minimo.nuclei[0].risultato.giudizio, minimo.nuclei[0].radar.posizioneRadar], [25, 'INSUFFICIENTE', 0]);
  assert.equal(minimo.complessivo.difficoltaGeneralizzata, true);
  // Scala 0-2: percentuale pedagogica e posizione sul radar coincidono.
  const alfa = reportClasse([['C1']], { C1: [[2], [1]] }, 2);
  assert.deepEqual([alfa.nuclei[0].risultato.percentuale, alfa.nuclei[0].radar.posizioneRadar], [75, 75]);
});

test('Report globale della classe U26 bande del tenant: personalizzate, in ordine diverso, una sola banda; critica è la banda più bassa, mai un\'etichetta', () => {
  const dati = { C1: perTutti([0, 1, 2], 6), C2: perTutti([0, 0, 1], 6) }; // 50% e 16,67% -> nucleo 33,33
  const ordinate = reportClasse([['C1', 'C2']], dati, 6);
  const disordinate = reportClasse([['C1', 'C2']], dati, 6, SCALA_ALFA, progresso.preparaBande([...BANDE_ALFA].reverse()));
  assert.deepEqual(disordinate, ordinate, 'stesse bande fornite in un altro ordine: stesso report');

  const altre = progresso.preparaBande([
    { soglia_minima: 75, etichetta: 'Verde' }, { soglia_minima: 0, etichetta: 'Rosso' }, { soglia_minima: 40, etichetta: 'Giallo' },
  ]);
  const r = reportClasse([['C1', 'C2']], dati, 6, SCALA_ALFA, altre);
  const c = criteriPerId(r.nuclei[0]);
  assert.deepEqual([c.C1.risultato.giudizio, c.C1.risultato.critico, c.C2.risultato.giudizio, c.C2.risultato.critico], ['Giallo', false, 'Rosso', true]);
  assert.deepEqual([r.nuclei[0].risultato.giudizio, r.complessivo.difficoltaGeneralizzata], ['Rosso', true]);
  assert.deepEqual(r.nuclei[0].criteri[0].distribuzioneGiudizi.map((d) => d.etichetta), ['Verde', 'Giallo', 'Rosso']);

  const unica = reportClasse([['C1', 'C2']], dati, 6, SCALA_ALFA, progresso.preparaBande([{ soglia_minima: 0, etichetta: 'Unica' }]));
  assert.deepEqual([unica.nuclei[0].risultato.giudizio, unica.nuclei[0].risultato.critico, unica.complessivo.difficoltaGeneralizzata], ['Unica', true, true],
    'una sola banda configurata: è per forza la più bassa');
});

test('Report globale della classe U27 radar H3: punto pieno, punto vuoto (osservazioni insufficienti o criterio non valutato), nucleo non valutato', () => {
  const r = reportClasse([['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2'], ['D1'], ['E1', 'E2']], {
    A1: perTutti([2], 4), A2: soloIPrimi([1], 3, 4), //          tutti valutati, 4 e 3 osservazioni -> pieno
    B1: perTutti([2], 4), B2: soloIPrimi([1, 1], 1, 4), //       B2 valutato con sole 2 osservazioni -> vuoto
    C1: perTutti([2], 4), //                                    C2 non valutato -> vuoto
    E1: soloIPrimi([2, 2, 2], 1, 4), E2: perTutti([1], 4), //    E1 poco osservato ma con 3 osservazioni -> pieno
  }, 4);
  const [a, b, c, d, e] = r.nuclei;
  assert.deepEqual(a.radar, { posizioneRadar: 75, puntoPieno: true });
  assert.deepEqual(b.radar, { posizioneRadar: 100, puntoPieno: false });
  assert.deepEqual(c.radar, { posizioneRadar: 100, puntoPieno: false });
  assert.deepEqual(d.radar, { posizioneRadar: null, puntoPieno: false });
  assert.deepEqual(e.radar, { posizioneRadar: 50, puntoPieno: true },
    'H3 usa solo "tutti i criteri valutati" e "almeno 3 osservazioni": la rappresentatività è un asse distinto');

  // La geometria del radar dello studente (public/radar.js) riceve queste posizioni senza modifiche.
  const g = RadarNuclei.geometria({ assi: r.nuclei.map((n, i) => ({ id: i, posizione: n.radar.posizioneRadar, pieno: n.radar.puntoPieno })), bande: [] });
  assert.deepEqual(g.assi.map((x) => [x.valutato, x.pieno]), [[true, true], [true, false], [true, false], [false, false], [true, true]]);
  assert.equal(g.assi[3].punto, null, 'nucleo non valutato: asse presente, nessun punto, nessuno zero inventato');
  assert.deepEqual(g.tratti.map((t) => t.tratteggiato), [true, true, false],
    'lati solo tra assi adiacenti valutati (A-B, B-C, E-A): il poligono non attraversa D; tratteggiati se toccano un punto vuoto');
});

test('Report globale della classe U28 osservazioni del Teaching: valide in ordine cronologico, escluse contate per motivo, un solo motivo per osservazione', () => {
  const contesto = { iscrizioniAttive: new Set(['1', '2']), criteriAttivi: new Set(['10', '11']), scala: { id: 7 } };
  const o = (iscrizione, criterio, valore, extra = {}) => ({
    enrollment_id: iscrizione, criterion_id: criterio, valore, scale_id: 7, attivita_stato: 'attiva', unit_stato: 'attiva', ...extra,
  });
  const tuttiIMotivi = { unit_stato: 'disattivata', attivita_stato: 'disattivata', scale_id: 99 };
  const { validePerIscrizione, nonConteggiate } = datiProgresso.classificaOsservazioniDiClasse([
    o(1, 10, 0), o(2, 11, 1), o(1, 10, 2),
    o(1, 10, 2, { attivita_stato: 'disattivata' }),
    o(2, 11, 2, { scale_id: 99 }),
    o(1, 12, 2), //                          criterio non più attivo in un nucleo attivo
    o(1, 13, 2, { unit_stato: 'disattivata' }),
    o(3, 10, 2), //                          iscrizione non attiva
    o(3, 13, 2, tuttiIMotivi), //            conta una volta sola, come iscrizione non attiva
    o(1, 13, 2, tuttiIMotivi), //            il nucleo disattivato prevale su attività e scala
  ], contesto);
  assert.deepEqual([...validePerIscrizione].map(([i, perCriterio]) => [i, [...perCriterio]]), [['1', [['10', [0, 2]]]], ['2', [['11', [1]]]]],
    'le valide restano nell\'ordine ricevuto (cronologico)');
  assert.deepEqual(nonConteggiate, {
    iscrizione_non_attiva: 2, nucleo_non_attivo: 2, criterio_non_attivo: 1, attivita_disattivata: 1, scala_non_compatibile: 1,
  });
  assert.deepEqual([...datiProgresso.MOTIVI_NON_CONTEGGIATE_CLASSE], Object.keys(nonConteggiate));
});

/** Tutte le chiavi di un valore JSON, col percorso (es. "nuclei[].criteri[].codice"). */
function percorsiDelleChiavi(valore, percorso = '') {
  if (Array.isArray(valore)) return valore.flatMap((v) => percorsiDelleChiavi(v, `${percorso}[]`));
  if (valore === null || typeof valore !== 'object') return [];
  return Object.entries(valore).flatMap(([chiave, v]) => {
    const qui = percorso ? `${percorso}.${chiave}` : chiave;
    return [qui, ...percorsiDelleChiavi(v, qui)];
  });
}

test('Report globale della classe U29 risposta: "non valutato" è null (solo nel report classe), nessun dato nominativo, regole e motivi esposti', () => {
  const struttura = [
    { id: 1, nome: 'Numeri', ordine: 1, criteri: [{ id: 10, codice: 'N-1', descrizione: 'Calcolo', ordine: 1 }, { id: 11, codice: 'N-2', descrizione: 'Stima', ordine: 2 }] },
    { id: 2, nome: 'Spazio', ordine: 2, criteri: [{ id: 20, codice: 'S-1', descrizione: 'Figure', ordine: 1 }] },
    { id: 3, nome: 'Senza criteri', ordine: 3, criteri: [] },
  ];
  // Sette iscritti, il settimo senza osservazioni. 10: 100 per sei studenti; 11: 0 per quattro e 100 per due.
  const righe = righeDiClasse({ 10: perTutti([2, 2, 2], 6), 11: [...perTutti([0, 0, 0], 4), ...perTutti([2, 2, 2], 2)] }, 7);
  const report = progresso.progressoDiClasse(struttura.map((n) => n.criteri.map((c) => String(c.id))), righe, SCALA_ALFA, P_ALFA);
  const nonConteggiate = Object.fromEntries(datiProgresso.MOTIVI_NON_CONTEGGIATE_CLASSE.map((motivo) => [motivo, 0]));
  nonConteggiate.attivita_disattivata = 2;
  const p = datiProgresso.descriviProgressoClasse({
    teaching: { id: 5, materia: 'Matematica', classe: '3C' }, annoScolastico: '2026/2027',
    scala: { id: 1, nome: 'Scala 0-2', valori: [], ...SCALA_ALFA }, bande: P_ALFA, struttura, report, nonConteggiate,
  });

  const nonValutato = { percentuale: null, giudizio: null, livelloGiudizio: null, critico: null };
  assert.deepEqual(p.nuclei[1].risultatoCorrente, nonValutato, 'nel report classe "non valutato" è null, non \'\'');
  assert.deepEqual(p.nuclei[1].criteri[0].risultatoCorrente, nonValutato);
  assert.deepEqual([p.nuclei[2].grigliaNonConfigurata, p.nuclei[2].risultatoCorrente], [true, nonValutato]);
  assert.deepEqual(p.nuclei[0].risultatoCorrente, { percentuale: 66.67, giudizio: 'DISCRETO', livelloGiudizio: 2, critico: false });
  assert.deepEqual([p.nuclei[0].criteriForti, p.nuclei[0].criteriDeboli], [[10], [11]], 'id originali dei criteri');
  assert.deepEqual(p.complessivo, {
    risultatoCorrente: { percentuale: 66.67, giudizio: 'DISCRETO', livelloGiudizio: 2, critico: false },
    risultatoStorico: { percentuale: 66.67 },
    differenzaCorrenteStorico: 0,
    difficoltaGeneralizzata: false,
    criteriValutati: 2,
    criteriRappresentativi: 2,
    criteriTotali: 3,
  });
  assert.deepEqual(p.classe, { studentiTotali: 7, studentiValutati: 6 });
  assert.deepEqual(p.regola, { tipo: 'media_mobile', finestra: 3, rappresentativitaOltre: 0.5, quotaConcordi: '2/3', minimoConfrontabili: 6 });
  assert.deepEqual(p.osservazioniNonConteggiate, { totale: 2, perMotivo: nonConteggiate });

  // Anonimato: gli unici "nome" sono quelli della scala e dei nuclei; nessuna chiave che identifichi studenti.
  const percorsi = [...new Set(percorsiDelleChiavi(p))];
  const nominativi = /(^|\.)(nome|cognome|alunno|alunni|enrollmentId|enrollment_id|studentPersonId|student_person_id|studentId|osservazioni)$/;
  assert.deepEqual(percorsi.filter((x) => nominativi.test(x)).sort(), ['nuclei[].nome', 'scala.nome']);
  assert.ok(percorsi.filter((x) => x.endsWith('.studenti')).every((x) => x === 'nuclei[].criteri[].distribuzioneGiudizi[].studenti'),
    'gli studenti compaiono solo come conteggi della distribuzione');
});
