'use strict';

/**
 * Forma pubblica dei valori del motore e dei contenuti (Visual Grammar V2): usata da
 * tutti i report, così ogni vista riceve la stessa rappresentazione (§12: un concetto,
 * stesso segno ovunque).
 */
const { daCentesimi, calcolaEsito } = require('./calcoloEsiti');
const { creaTraduttore } = require('./contenuti');
const motore = require('./calcoloProgresso');

/** Campi interni del motore che non diventano mai pubblici (l'intero kc resta interno). */
function pubblico(valore) {
  if (!valore) return valore;
  const { percentualeEsatta, centesimi, ...resto } = valore;
  if (resto.cumulativo) resto.cumulativo = pubblico(resto.cumulativo);
  return resto;
}

/**
 * E1 (V2.1 rev. 2, decisione C1): colore della banda assegnato dal SERVER in base al livello
 * (0 = banda più bassa, critica). Scala a luminosità crescente, leggibile anche da chi non
 * distingue rosso e verde; con meno di 6 bande si campionano colori equidistanti. Il colore
 * identifica la banda configurata: non è un dato nuovo e non è mai l'unico canale (numero ed
 * etichetta accompagnano sempre il colore). Nessuna migrazione: un futuro colore configurato
 * dall'istituto sostituirà questa tabella.
 */
const PALETTE_BANDE = Object.freeze(['#c0492f', '#e0893a', '#e3bd3f', '#9bbb59', '#4f9a5c', '#1f7366']);
const INCHIOSTRI = Object.freeze(['#ffffff', '#1d2420']);

function luminanza(esadecimale) {
  const canali = [1, 3, 5].map((i) => parseInt(esadecimale.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * canali[0] + 0.7152 * canali[1] + 0.0722 * canali[2];
}

function contrasto(a, b) {
  const [chiaro, scuro] = [luminanza(a), luminanza(b)].sort((x, y) => y - x);
  return (chiaro + 0.05) / (scuro + 0.05);
}

/** Colore di sfondo e inchiostro (testo con il contrasto maggiore) per il livello di una banda. */
function coloreBanda(livello, numeroBande) {
  const indice = numeroBande <= 1
    ? Math.floor(PALETTE_BANDE.length / 2)
    : Math.round((livello * (PALETTE_BANDE.length - 1)) / (numeroBande - 1));
  const colore = PALETTE_BANDE[indice];
  const inchiostro = INCHIOSTRI.reduce((migliore, c) => (contrasto(colore, c) > contrasto(colore, migliore) ? c : migliore));
  return { colore, inchiostro };
}

/** Bande pubbliche: etichetta (contenuto dell'istituto), soglia alla precisione di sintesi, zona sull'asse, colore (E1). */
function bandePubbliche(bande) {
  const { sintesi } = motore.precisione(bande);
  return bande.map((b) => ({
    id: b.id,
    livello: b.livello,
    etichetta: b.etichetta,
    ...coloreBanda(b.livello, bande.length),
    soglia: { valore: daCentesimi(b.sogliaCentesimi, sintesi), decimali: sintesi },
    posizioneInizio: b.posizioneInizio,
    posizioneFine: b.posizioneFine,
    ampiezza: b.ampiezza,
    critica: b.critica,
  }));
}

/** Traduttore per la lingua della sessione (contesto linguistico risolto dal middleware). */
function traduttoreDi(client, lingua) {
  return creaTraduttore(client, { tenantId: lingua.tenantId, lingua: lingua.lingua, linguaOrigine: lingua.linguaOrigine });
}

/**
 * Scala applicabile con nome ed etichette dei valori tradotti e, per ogni valore, la banda
 * (E2). Ogni valore 0…n è un'osservazione reale: la sua percentuale è quella che il motore
 * usa già per un'osservazione sola (calcolaEsito: valore / massimo × 100) e la banda è
 * assegnata con la Regola B (valoreDi). L'assenza di osservazione (null) non è un valore
 * della scala e non ha banda.
 */
function scalaPubblica(scala, tr, bande) {
  return {
    id: scala.id,
    nome: tr.testo('observation_scales.nome', scala.id, scala.nome),
    valoreMinimo: scala.valoreMinimo,
    valoreMassimo: scala.valoreMassimo,
    valori: scala.valori.map((v) => ({
      valore: v.valore,
      ordine: v.ordine,
      etichetta: tr.testo('observation_scale_values.etichetta', [scala.id, v.valore], v.etichetta),
      bandaId: motore.valoreDi(calcolaEsito([v.valore], scala.valoreMassimo).percentualeEsatta, bande).bandaId,
    })),
  };
}

/**
 * E4 (decisione C2): REGOLA DI COMPATIBILITÀ con il testo libero del giudizio, non una
 * chiave. La banda resta identificata dal suo id; l'etichetta serve solo a riconoscere un
 * giudizio scritto uguale all'etichetta CONFIGURATA dall'istituto (mai la traduzione di
 * presentazione: il risultato non dipende dalla lingua della sessione), ignorando
 * maiuscole e spazi superflui. Nessuna corrispondenza: null (nessun colore).
 */
function normalizzaEtichetta(testo) {
  return String(testo).trim().replace(/\s+/g, ' ').toLowerCase();
}

function bandaDelGiudizio(giudizio, bande) {
  if (giudizio === null || giudizio === undefined) return null;
  const cercato = normalizzaEtichetta(typeof giudizio === 'object' ? giudizio.testo : giudizio);
  const trovata = bande.find((b) => b.etichettaOrigine !== null && b.etichettaOrigine !== undefined
    && normalizzaEtichetta(b.etichettaOrigine) === cercato);
  return trovata ? trovata.id : null;
}

module.exports = {
  pubblico, bandePubbliche, scalaPubblica, traduttoreDi, coloreBanda, contrasto, bandaDelGiudizio, PALETTE_BANDE,
};
