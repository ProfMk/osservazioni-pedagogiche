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
    percentuale: arrotondaPerPresentazione(percentualeEsatta),
    giudizio: calcolaGiudizio(percentualeEsatta),
  };
}

function arrotondaPerPresentazione(valore) {
  return Math.round(valore * 100) / 100;
}

// --- Risultato corrente (media mobile) -------------------------------------
//
// Il risultato CORRENTE di un criterio è la media, a pesi uguali, delle
// ultime FINESTRA_RISULTATO_CORRENTE osservazioni dello studente su quel
// criterio (o di tutte, se sono meno). Lo storico completo non viene mai
// scartato: questa è solo una lettura derivata.
const FINESTRA_RISULTATO_CORRENTE = 3;

/**
 * Ordine cronologico deterministico: data dell'attività, poi id dell'attività.
 * Per uno stesso studente e criterio esiste al massimo una valutazione per
 * attività (UNIQUE su osservazioni e su valutazioni_criteri), quindi la
 * coppia (data, id attività) non ha mai pareggi.
 * @param {{dataAttivita: Date|string, attivitaId: number}[]} osservazioni
 */
function ordinaCronologicamente(osservazioni) {
  return [...osservazioni].sort((a, b) => (
    (new Date(a.dataAttivita).getTime() - new Date(b.dataAttivita).getTime()) || (a.attivitaId - b.attivitaId)
  ));
}

/**
 * Risultato corrente di UN criterio per uno studente.
 * Percentuale e giudizio sono quelli di calcolaEsito applicato alle sole
 * osservazioni della finestra: media / massimo × 100 = somma / (n × massimo) × 100.
 * Lo 0 è una valutazione reale e fa parte della media; nessuna osservazione
 * significa "Non valutato" (media e percentuale null).
 *
 * @param {{punteggio: number, dataAttivita: Date|string, attivitaId: number}[]} osservazioni - tutte, in qualunque ordine.
 */
function risultatoCorrenteCriterio(osservazioni) {
  const ordinate = ordinaCronologicamente(osservazioni);
  const finestra = ordinate.slice(-FINESTRA_RISULTATO_CORRENTE);
  const esito = calcolaEsito(finestra.map((o) => o.punteggio));
  return {
    ...esito,
    media: finestra.length === 0 ? null : arrotondaPerPresentazione(esito.punteggioOttenuto / finestra.length),
    osservazioniConsiderate: finestra.length,
    osservazioniTotali: ordinate.length,
    attivitaConsiderate: finestra.map((o) => o.attivitaId),
  };
}

function massimoComuneDivisore(a, b) { return b === 0 ? a : massimoComuneDivisore(b, a % b); }

// Minimo comune multiplo di 1..FINESTRA_RISULTATO_CORRENTE (oggi 6): ogni media
// di criterio (somma / n, con n <= finestra), moltiplicata per questo valore,
// è un intero. Così la media dei criteri si calcola con una sola divisione
// finale e le soglie esatte (es. 90%) non subiscono errori di arrotondamento.
const DENOMINATORE_COMUNE = Array.from({ length: FINESTRA_RISULTATO_CORRENTE }, (_, i) => i + 1)
  .reduce((mcm, n) => (mcm * n) / massimoComuneDivisore(mcm, n), 1);

/**
 * Risultato corrente di un insieme di criteri (nucleo o intera materia):
 * media, a pesi uguali, dei risultati correnti dei soli criteri valutati.
 * I criteri "Non valutato" sono esclusi; un criterio con media 0 è incluso.
 *
 * @param {object[]} risultatiCriteri - risultati di risultatoCorrenteCriterio.
 */
function aggregaRisultatiCorrenti(risultatiCriteri) {
  const valutati = risultatiCriteri.filter((r) => r.osservazioniConsiderate > 0);
  if (valutati.length === 0) {
    return { media: null, percentuale: null, giudizio: '', criteriConsiderati: 0 };
  }
  const sommaScalata = valutati.reduce(
    (totale, r) => totale + (r.punteggioOttenuto * DENOMINATORE_COMUNE) / r.osservazioniConsiderate, 0
  );
  const mediaEsatta = sommaScalata / (valutati.length * DENOMINATORE_COMUNE);
  const percentualeEsatta = (sommaScalata * 100) / (valutati.length * DENOMINATORE_COMUNE * valoreMassimo());
  return {
    media: arrotondaPerPresentazione(mediaEsatta),
    percentuale: arrotondaPerPresentazione(percentualeEsatta),
    giudizio: calcolaGiudizio(percentualeEsatta),
    criteriConsiderati: valutati.length,
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
  FINESTRA_RISULTATO_CORRENTE,
  ordinaCronologicamente,
  risultatoCorrenteCriterio,
  aggregaRisultatiCorrenti,
};
