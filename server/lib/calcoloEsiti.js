'use strict';

/**
 * Calcolo di esiti percentuali e giudizi, parametrico rispetto alla scala e
 * alle soglie: NON assume più 0/1/2 né soglie fisse (sez. 26/27), a
 * differenza del vecchio server/config/valutazione.js (superato). Scala e
 * soglie sono lette dal database (tenant-owned) da chi chiama queste
 * funzioni pure: qui non c'è alcun accesso al database.
 */

function arrotondaPerPresentazione(valore) {
  return Math.round(valore * 100) / 100;
}

/**
 * Percentuale e punteggio a partire dalle valutazioni REALMENTE presenti.
 * @param {number[]} punteggi - valori realmente osservati (mai un placeholder per "non valutato").
 * @param {number} valoreMassimo - valore massimo della scala applicabile.
 */
function calcolaEsito(punteggi, valoreMassimo) {
  const n = punteggi.length;
  if (n === 0) return { punteggioOttenuto: null, punteggioMassimo: null, percentuale: null, percentualeEsatta: null };
  const punteggioOttenuto = punteggi.reduce((a, b) => a + b, 0);
  const punteggioMassimo = n * valoreMassimo;
  const percentualeEsatta = (punteggioOttenuto / punteggioMassimo) * 100;
  return {
    punteggioOttenuto,
    punteggioMassimo,
    // Arrotondata solo per la presentazione: il giudizio va calcolato su percentualeEsatta, non su questa.
    percentuale: arrotondaPerPresentazione(percentualeEsatta),
    percentualeEsatta,
  };
}

/**
 * Giudizio a partire da una percentuale ESATTA (non arrotondata) e dalle
 * bande di giudizio del tenant/livello applicabile, ordinate dalla soglia
 * più alta alla più bassa.
 * @param {number|null} percentualeEsatta
 * @param {{soglia_minima: number, etichetta: string}[]} bande
 */
function calcolaGiudizio(percentualeEsatta, bande) {
  if (percentualeEsatta === null || percentualeEsatta === undefined) return '';
  for (const banda of bande) {
    if (percentualeEsatta >= Number(banda.soglia_minima)) return banda.etichetta;
  }
  return '';
}

/**
 * Media aritmetica semplice dei risultati percentuali di un insieme di
 * elementi (criteri), pesati allo stesso modo — stessa scelta già adottata
 * per il Report classe del prototipo: NON una media mobile, NON un pool di
 * tutti i punteggi individuali.
 * @param {{punteggioOttenuto: number, punteggioMassimo: number}[]} esitiValutati - solo quelli con almeno un dato presente.
 */
function mediaSemplicePercentuali(esitiValutati) {
  if (esitiValutati.length === 0) return { percentuale: null, criteriConsiderati: 0 };
  const percentualeEsattaMedia = esitiValutati.reduce(
    (totale, e) => totale + (e.punteggioOttenuto / e.punteggioMassimo) * 100, 0
  ) / esitiValutati.length;
  return {
    percentuale: arrotondaPerPresentazione(percentualeEsattaMedia),
    percentualeEsatta: percentualeEsattaMedia,
    criteriConsiderati: esitiValutati.length,
  };
}

module.exports = { arrotondaPerPresentazione, calcolaEsito, calcolaGiudizio, mediaSemplicePercentuali };
