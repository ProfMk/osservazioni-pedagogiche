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

  assert.equal(progresso.confrontoConComplessivo(4, 2), 'punto_di_forza');
  assert.equal(progresso.confrontoConComplessivo(1, 2), 'area_di_attenzione');
  assert.equal(progresso.confrontoConComplessivo(2, 2), 'nella_norma');
  assert.equal(progresso.confrontoConComplessivo(null, 2), null);
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
  assert.deepEqual([c.C4.rappresentativo, c.C4.stato], [false, 'poco_osservato'], '1 studente su 8');
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
  assert.deepEqual([c.C2.rappresentativo, c.C2.stato], [false, 'poco_osservato'], '2 su 4');
  assert.equal(c.C3.rappresentativo, true, '3 su 4');
  assert.deepEqual([c.C4.stato, c.C4.risultato.percentuale], ['non_osservato', null], 'mai 0');
  assert.equal(n.risultato.percentuale, 75, '(100 + 50) / 2: solo C1 e C3');

  const vuoto = progresso.nucleoDiClasse(['C1'], righeDa({ C1: [null, null] }, 2), P_ALFA);
  assert.deepEqual([vuoto.risultato.percentuale, vuoto.risultato.giudizio, vuoto.copertura.studentiValutati], [null, '', 0]);
});

test('U11 classe: criteri forti e deboli (banda diversa dal nucleo E almeno 2/3 dei confrontabili concordi, pari inclusi)', () => {
  const n = progresso.nucleoDiClasse(['C1', 'C2', 'C3', 'C4'], righeDa(CLASSE_8, 8), P_ALFA);
  const c = Object.fromEntries(n.criteri.map((x) => [x.id, x]));
  assert.deepEqual(c.C1.confronto, { confrontabili: 8, inferiori: 1, superiori: 7, pari: 0 });
  assert.equal(c.C1.stato, 'forte');
  assert.deepEqual(c.C2.confronto, { confrontabili: 7, inferiori: 7, superiori: 0, pari: 0 });
  assert.equal(c.C2.stato, 'debole');
  assert.deepEqual(c.C3.confronto, { confrontabili: 8, inferiori: 0, superiori: 6, pari: 2 });
  assert.equal(c.C3.stato, 'forte', '6 su 8 (pari nel denominatore): 18 >= 16');
  assert.deepEqual(c.C4.confronto, { confrontabili: 0, inferiori: 0, superiori: 0, pari: 0 });
});

test('U12 classe: nessun falso allarme (meno di 6 confrontabili, stessa banda, quota 2/3 non raggiunta)', () => {
  // Stessi rapporti del dataset, ma solo 5 studenti: differenze nette, però troppo pochi confrontabili.
  const cinque = { C1: [100, 100, 100, 100, 100], C2: [0, 0, 0, 0, 0] };
  const pochi = progresso.nucleoDiClasse(['C1', 'C2'], righeDa(cinque, 5), P_ALFA);
  assert.deepEqual(pochi.criteri.map((x) => x.stato), ['nella_norma', 'nella_norma']);
  assert.equal(pochi.criteri[1].confronto.confrontabili, 5);

  // Stessa banda del nucleo: differenza coerente fra tutti gli studenti, ma nessun cambio di giudizio.
  const stessaBanda = { C1: [96, 96, 96, 96, 96, 96], C2: [92, 92, 92, 92, 92, 92] };
  const s = progresso.nucleoDiClasse(['C1', 'C2'], righeDa(stessaBanda, 6), P_ALFA);
  assert.deepEqual(s.criteri.map((x) => x.risultato.giudizio), ['OTTIMO', 'OTTIMO']);
  assert.deepEqual(s.criteri.map((x) => x.stato), ['nella_norma', 'nella_norma']);
  assert.equal(s.criteri[1].confronto.inferiori, 6);

  // Banda inferiore, ma solo 3 studenti su 6 vanno peggio (un sottogruppo molto basso): quota non raggiunta.
  const sottogruppo = { C1: [80, 80, 80, 80, 80, 80], C2: [0, 0, 0, 90, 90, 90] };
  const q = progresso.nucleoDiClasse(['C1', 'C2'], righeDa(sottogruppo, 6), P_ALFA);
  assert.deepEqual([q.criteri[1].risultato.percentuale, q.criteri[1].confronto.inferiori], [45, 3]);
  assert.equal(q.criteri[1].stato, 'nella_norma', '3 su 6 < 2/3');
  assert.equal(q.criteri[1].distribuzioneGiudizi.find((d) => d.etichetta === 'NON SUFFICIENTE').studenti, 3,
    'la dispersione resta visibile nella distribuzione');
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
