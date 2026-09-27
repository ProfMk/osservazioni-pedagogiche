'use strict';

/**
 * CONFIGURAZIONE DELLA VALUTAZIONE — punto unico.
 *
 * Sezione 10 dell'analisi: la scala, il valore massimo e le soglie del
 * giudizio sono oggi valori fissi (nessuna tabella li rappresenta nel
 * database), ma nel resto del codice non devono comparire come numeri o
 * stringhe letterali sparsi: tutto ciò che ne ha bisogno importa QUESTO
 * modulo. Quando in futuro scala/soglie diventeranno configurabili per
 * scuola/materia/nucleo, si sostituirà l'implementazione di questo file
 * (es. con una lettura da tabella) senza toccare il resto del codice,
 * perché l'interfaccia (le funzioni esportate) resta la stessa.
 *
 * Nessuna parte del codice, al di fuori di questo file, deve contenere
 * i numeri 0/1/2, il numero 2 come "massimo", le stringhe delle
 * etichette o le soglie 90/80/70/60/50.
 */

// --- Scala di valutazione attuale (configurazione di test: Matematica) ---
const SCALA = Object.freeze({
  valoreMinimo: 0,
  valoreMassimo: 2,
  valori: Object.freeze([
    { punteggio: 0, etichetta: 'Non manifestato' },
    { punteggio: 1, etichetta: 'Con supporto' },
    { punteggio: 2, etichetta: 'Autonomo' },
  ]),
});

// --- Soglie del giudizio (valori confermati dall'utente: 90/80/70/60/50) ---
// Ordinate dalla soglia più alta alla più bassa; "min" è inclusivo.
const SOGLIE_GIUDIZIO = Object.freeze([
  { min: 90, etichetta: 'OTTIMO' },
  { min: 80, etichetta: 'DISTINTO' },
  { min: 70, etichetta: 'BUONO' },
  { min: 60, etichetta: 'DISCRETO' },
  { min: 50, etichetta: 'SUFFICIENTE' },
  { min: 0, etichetta: 'NON SUFFICIENTE' },
]);

/** Punteggi ammessi dalla scala attuale, es. per un CHECK applicativo lato server. */
function valoriAmmessi() {
  return SCALA.valori.map((v) => v.punteggio);
}

/** Valore massimo di una singola valutazione nella scala attuale (oggi: 2). */
function valoreMassimo() {
  return SCALA.valoreMassimo;
}

/** true se il punteggio è uno dei valori ammessi dalla scala attuale. */
function isPunteggioValido(punteggio) {
  return Number.isInteger(punteggio) && valoriAmmessi().includes(punteggio);
}

/** Etichetta descrittiva di un punteggio (es. per l'interfaccia), o null se non valido. */
function etichettaPunteggio(punteggio) {
  const v = SCALA.valori.find((x) => x.punteggio === punteggio);
  return v ? v.etichetta : null;
}

/**
 * Percentuale e giudizio a partire dalle valutazioni REALMENTE presenti.
 * @param {number[]} punteggi - i punteggi delle sole valutazioni presenti (mai un placeholder per "non valutato").
 * @returns {{punteggioOttenuto: number|null, punteggioMassimo: number|null, percentuale: number|null, giudizio: string}}
 */
function calcolaEsito(punteggi) {
  const n = punteggi.length;
  if (n === 0) {
    return { punteggioOttenuto: null, punteggioMassimo: null, percentuale: null, giudizio: '' };
  }
  const punteggioOttenuto = punteggi.reduce((a, b) => a + b, 0);
  const punteggioMassimo = n * valoreMassimo();
  const percentualeEsatta = (punteggioOttenuto / punteggioMassimo) * 100;
  return {
    punteggioOttenuto,
    punteggioMassimo,
    // Arrotondata solo per la presentazione: il giudizio (sotto) usa il valore esatto, non questo.
    percentuale: Math.round(percentualeEsatta * 100) / 100,
    giudizio: calcolaGiudizio(percentualeEsatta),
  };
}

/**
 * Converte una percentuale nel giudizio corrispondente.
 * Usa il valore ESATTO (non arrotondato prima del confronto), come richiesto.
 * @param {number|null} percentuale
 * @returns {string} l'etichetta del giudizio, oppure '' se percentuale è null.
 */
function calcolaGiudizio(percentuale) {
  if (percentuale === null || percentuale === undefined) return '';
  for (const soglia of SOGLIE_GIUDIZIO) {
    if (percentuale >= soglia.min) return soglia.etichetta;
  }
  return '';
}

module.exports = {
  SCALA,
  SOGLIE_GIUDIZIO,
  valoriAmmessi,
  valoreMassimo,
  isPunteggioValido,
  etichettaPunteggio,
  calcolaEsito,
  calcolaGiudizio,
};
