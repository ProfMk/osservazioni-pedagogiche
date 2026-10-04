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

/**
 * Finestra della media mobile del risultato CORRENTE di un criterio: le ultime
 * N osservazioni dello studente su quel criterio (o tutte, se sono meno).
 * Lo storico completo non viene mai scartato: la media è solo una lettura derivata.
 */
const FINESTRA_MEDIA_MOBILE = 3;

/**
 * Risultato corrente di UN criterio per uno studente (media mobile).
 * @param {number[]} valoriCronologici - i valori osservati, GIÀ in ordine cronologico (dal più vecchio).
 * @param {number} valoreMassimo - massimo della scala applicabile.
 * @returns {{media: number|null, punteggioOttenuto: number|null, punteggioMassimo: number|null,
 *   percentuale: number|null, percentualeEsatta: number|null, osservazioniConsiderate: number, osservazioniTotali: number}}
 * Esempio: [0, 1, 2, 2] -> finestra [1, 2, 2] -> media 1,67 (5/3 arrotondato a 2 decimali).
 */
function risultatoCorrenteMediaMobile(valoriCronologici, valoreMassimo, finestra = FINESTRA_MEDIA_MOBILE) {
  const considerati = valoriCronologici.slice(-finestra);
  const esito = calcolaEsito(considerati, valoreMassimo);
  return {
    ...esito,
    media: considerati.length === 0 ? null : arrotondaPerPresentazione(esito.punteggioOttenuto / considerati.length),
    osservazioniConsiderate: considerati.length,
    osservazioniTotali: valoriCronologici.length,
  };
}

module.exports = {
  arrotondaPerPresentazione, calcolaEsito, calcolaGiudizio, mediaSemplicePercentuali,
  FINESTRA_MEDIA_MOBILE, risultatoCorrenteMediaMobile,
};
