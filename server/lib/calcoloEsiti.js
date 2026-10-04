'use strict';

/**
 * Regole numeriche comuni a tutti i report (Visual Grammar V2, Regola B).
 *
 * Le aggregazioni lavorano sui valori esatti (percentuali in virgola mobile),
 * ma tutto ciò che diventa pubblico — banda, valore del dettaglio, valore della
 * sintesi, geometria dell'asse — deriva da UN SOLO intero in centesimi:
 *
 *   kc = floor((x + ε) × 100)
 *
 * con x = percentuale esatta (0–100) ed ε = TOLLERANZA_NUMERICA, la stessa
 * tolleranza già adottata dal motore prima della V2 (non è stata cambiata).
 * Le soglie sono confrontate come interi in centesimi, convertiti dal valore
 * decimale configurato senza passare per la virgola mobile.
 *
 * Funzioni pure: nessun accesso al database, nessuna scala o soglia fissa.
 */

/**
 * Tolleranza usata SOLO per neutralizzare gli errori di virgola mobile: una
 * media di medie con i terzi può dare 69,99999999999999 dove il valore
 * matematico è 70. È molti ordini di grandezza più piccola di un centesimo,
 * quindi non sposta mai un valore realmente sotto soglia.
 */
const TOLLERANZA_NUMERICA = 1e-9;

/** Precisione del valore numerico del dettaglio (V2: p_dettaglio = 2). */
const DECIMALI_DETTAGLIO = 2;

/** Regola B: l'unico intero in centesimi da cui derivano banda, numeri e geometria. */
function centesimi(valoreEsatto) {
  if (valoreEsatto === null || valoreEsatto === undefined) return null;
  return Math.floor((valoreEsatto + TOLLERANZA_NUMERICA) * 100);
}

/**
 * Valore numerico alla precisione richiesta (0, 1 o 2 decimali), derivato da kc per
 * troncamento: il numero mostrato non supera mai la banda (N-6).
 */
function daCentesimi(kc, decimali = DECIMALI_DETTAGLIO) {
  if (kc === null || kc === undefined) return null;
  const passo = 10 ** (2 - decimali);
  return Math.floor(kc / passo) / 10 ** decimali;
}

/**
 * Soglia decimale configurata (stringa numeric di PostgreSQL, es. '66.67', o numero
 * con al più due decimali) convertita in centesimi per via testuale, senza float.
 */
function centesimiDaDecimale(valore) {
  const testo = String(valore).trim();
  const parti = /^(\d+)(?:\.(\d{1,2})\d*)?$/.exec(testo);
  if (!parti) throw new Error(`Soglia non convertibile in centesimi: ${testo}`);
  const decimali = (parti[2] || '').padEnd(2, '0');
  return Number.parseInt(parti[1], 10) * 100 + Number.parseInt(decimali, 10);
}

/**
 * p_sintesi: massimo numero di decimali significativi delle soglie applicabili
 * (soglie intere -> 0, a un decimale -> 1, a due decimali -> 2).
 */
function decimaliSintesi(soglieCentesimi) {
  return soglieCentesimi.reduce((massimo, c) => {
    let decimali = 2;
    if (c % 100 === 0) decimali = 0;
    else if (c % 10 === 0) decimali = 1;
    return Math.max(massimo, decimali);
  }, 0);
}

/** UNICA regola di confronto con una soglia (inclusiva), su interi in centesimi. */
function raggiungeSoglia(kc, sogliaCentesimi) {
  return kc >= sogliaCentesimi;
}

/**
 * Percentuale a partire dalle valutazioni REALMENTE presenti.
 * @param {number[]} punteggi - valori realmente osservati (mai un placeholder per "non valutato").
 * @param {number} valoreMassimo - valore massimo della scala applicabile.
 */
function calcolaEsito(punteggi, valoreMassimo) {
  const n = punteggi.length;
  if (n === 0) {
    return { punteggioOttenuto: null, punteggioMassimo: null, percentualeEsatta: null, centesimi: null, percentuale: null };
  }
  const punteggioOttenuto = punteggi.reduce((a, b) => a + b, 0);
  const punteggioMassimo = n * valoreMassimo;
  const percentualeEsatta = (punteggioOttenuto / punteggioMassimo) * 100;
  const kc = centesimi(percentualeEsatta);
  return { punteggioOttenuto, punteggioMassimo, percentualeEsatta, centesimi: kc, percentuale: daCentesimi(kc) };
}

/**
 * Media aritmetica semplice dei risultati percentuali di un insieme di criteri,
 * pesati allo stesso modo: NON una media mobile, NON un pool dei punteggi.
 * @param {{punteggioOttenuto: number, punteggioMassimo: number}[]} esitiValutati - solo quelli con dati.
 */
function mediaSemplicePercentuali(esitiValutati) {
  if (esitiValutati.length === 0) {
    return { percentualeEsatta: null, centesimi: null, percentuale: null, criteriConsiderati: 0 };
  }
  const percentualeEsatta = esitiValutati.reduce(
    (totale, e) => totale + (e.punteggioOttenuto / e.punteggioMassimo) * 100, 0
  ) / esitiValutati.length;
  const kc = centesimi(percentualeEsatta);
  return { percentualeEsatta, centesimi: kc, percentuale: daCentesimi(kc), criteriConsiderati: esitiValutati.length };
}

/**
 * Finestra della media mobile del risultato CORRENTE di un criterio: le ultime
 * N osservazioni valide dello studente su quel criterio (o tutte, se sono meno).
 */
const FINESTRA_MEDIA_MOBILE = 3;

/**
 * Risultato corrente di UN criterio per uno studente (media mobile).
 * @param {number[]} valoriCronologici - valori osservati in ordine cronologico (dal più vecchio).
 * Esempio: [0, 1, 2, 2] -> finestra [1, 2, 2] -> 5/6 = 83,33%.
 */
function risultatoCorrenteMediaMobile(valoriCronologici, valoreMassimo, finestra = FINESTRA_MEDIA_MOBILE) {
  const considerati = valoriCronologici.slice(-finestra);
  return {
    ...calcolaEsito(considerati, valoreMassimo),
    osservazioniConsiderate: considerati.length,
    osservazioniTotali: valoriCronologici.length,
  };
}

module.exports = {
  TOLLERANZA_NUMERICA, DECIMALI_DETTAGLIO,
  centesimi, daCentesimi, centesimiDaDecimale, decimaliSintesi, raggiungeSoglia,
  calcolaEsito, mediaSemplicePercentuali,
  FINESTRA_MEDIA_MOBILE, risultatoCorrenteMediaMobile,
};
