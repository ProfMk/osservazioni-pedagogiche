'use strict';

/**
 * Motore dei report pedagogici — Visual Grammar V2. Solo funzioni PURE: nessun
 * accesso al database, nessun valore di scala, soglia o etichetta nel codice.
 *
 * Regole di calcolo (approvate, invariate rispetto alla baseline):
 * - corrente di un criterio = media mobile delle ultime 3 osservazioni valide;
 *   cumulativo = tutte le osservazioni valide;
 * - nucleo e complessivo dello studente = media semplice dei criteri valutati;
 * - classe: K(c) = media dei risultati correnti degli studenti valutati; criterio
 *   rappresentativo se valutato da più di metà degli iscritti; nucleo/complessivo
 *   di classe = media dei soli K(c) rappresentativi; conferma del confronto con
 *   almeno 6 confrontabili e almeno 2/3 concordi (pari nel denominatore).
 *
 * Rappresentazione (V2): ogni valore pubblico deriva dall'intero kc (Regola B) ed è
 * accompagnato da certezza (§7), criticità (§8), base n/N (P7) e stato dei dati
 * mancanti (§11). Gli identificatori sono quelli del vocabolario chiuso V2 (§6).
 * Le etichette delle bande sono contenuto dell'istituto: il motore le trasporta
 * senza mai usarle come chiave (B-4).
 */

const {
  calcolaEsito, risultatoCorrenteMediaMobile, FINESTRA_MEDIA_MOBILE, DECIMALI_DETTAGLIO,
  centesimi, daCentesimi, centesimiDaDecimale, decimaliSintesi, raggiungeSoglia,
} = require('./calcoloEsiti');

// Parametri della regola di classe (approvati): restituiti anche dall'API.
const REGOLA_CLASSE = Object.freeze({
  finestra: FINESTRA_MEDIA_MOBILE,
  rappresentativitaOltre: 0.5,
  quotaConcordi: '2/3',
  minimoConfrontabili: 6,
});

const OSSERVAZIONI_CONSOLIDATE = FINESTRA_MEDIA_MOBILE;

// --- Vocabolario V2 (identificatori, mai testi) ---------------------------------
const CERTEZZA = Object.freeze({ SUFFICIENTE: 'CERTAINTY_SUFFICIENT', PARZIALE: 'CERTAINTY_PARTIAL', ASSENTE: 'CERTAINTY_ABSENT' });
const GRADO_CERTEZZA = { CERTAINTY_ABSENT: 0, CERTAINTY_PARTIAL: 1, CERTAINTY_SUFFICIENT: 2 };
const CRITICITA = Object.freeze({ BANDA: 'CRITICAL_BAND', DA_VERIFICARE: 'CRITICAL_TO_VERIFY' });
const CONFRONTO = Object.freeze({
  SOPRA: 'COMPARISON_ABOVE', SOTTO: 'COMPARISON_BELOW', ALLINEATO: 'COMPARISON_ALIGNED', NON_CONFERMATO: 'COMPARISON_UNCONFIRMED',
  POCHI_CONFRONTABILI: 'UNCONFIRMED_TOO_FEW_COMPARABLE', QUORUM_NON_RAGGIUNTO: 'UNCONFIRMED_QUORUM_NOT_REACHED',
});
const DATI = Object.freeze({ NON_CONFIGURATO: 'NOT_CONFIGURED', NON_OSSERVATO: 'NOT_OBSERVED', INSUFFICIENTI: 'INSUFFICIENT_DATA' });
const COPERTURA_STUDENTE = ['STUDENT_COVERAGE_INDICATIVE', 'STUDENT_COVERAGE_PROVISIONAL', 'STUDENT_COVERAGE_CONSOLIDATED'];
const COPERTURA_CLASSE = Object.freeze({
  RAPPRESENTATIVA: 'CLASS_COVERAGE_REPRESENTATIVE', POCO_OSSERVATA: 'CLASS_COVERAGE_UNDER_OBSERVED', NON_OSSERVATA: 'CLASS_COVERAGE_NOT_OBSERVED',
});
const DATI_NUCLEO = Object.freeze({ COMPLETI: 'NUCLEUS_DATA_COMPLETE', INCOMPLETI: 'NUCLEUS_DATA_INCOMPLETE' });

function mediaSemplice(valori) {
  return valori.reduce((totale, v) => totale + v, 0) / valori.length;
}

/** P6: la certezza di un valore derivato è il minimo dei termini che lo producono. */
function certezzaMinima(certezze) {
  if (certezze.length === 0) return CERTEZZA.ASSENTE;
  return certezze.reduce((min, c) => (GRADO_CERTEZZA[c] < GRADO_CERTEZZA[min] ? c : min));
}

/** Certezza di un criterio dello studente dal numero di osservazioni valide (§7). */
function certezzaStudente(osservazioniValide) {
  if (osservazioniValide === 0) return CERTEZZA.ASSENTE;
  return osservazioniValide >= OSSERVAZIONI_CONSOLIDATE ? CERTEZZA.SUFFICIENTE : CERTEZZA.PARZIALE;
}

/**
 * Bande di giudizio pronte per il calcolo, ordinate dalla più alta, ciascuna con la
 * propria posizione (livello 0 = la più bassa), la zona che occupa sull'asse e la soglia
 * in centesimi. CRITICITÀ (P4): è critica la banda più bassa tra quelle configurate,
 * ma con una sola banda configurata non esiste banda critica.
 */
function preparaBande(bandeDb) {
  const crescenti = bandeDb
    .map((b) => {
      const sogliaCentesimi = b.soglia_centesimi !== undefined && b.soglia_centesimi !== null
        ? Number(b.soglia_centesimi)
        : centesimiDaDecimale(b.soglia_minima);
      return { id: b.id === undefined ? null : b.id, sogliaCentesimi, etichetta: b.etichetta };
    })
    .sort((a, b) => a.sogliaCentesimi - b.sogliaCentesimi);
  const esisteCritica = crescenti.length >= 2;
  return crescenti
    .map((b, livello) => ({
      ...b,
      sogliaMinima: b.sogliaCentesimi / 100,
      livello,
      critica: esisteCritica && livello === 0,
      // Zona sull'asse (0-100), dalle soglie in centesimi: geometria derivata dagli interi.
      posizioneInizio: daCentesimi(b.sogliaCentesimi),
      posizioneFine: livello + 1 < crescenti.length ? daCentesimi(crescenti[livello + 1].sogliaCentesimi) : 100,
      // Ampiezza della zona, in interi di centesimi: il client non calcola nemmeno la geometria.
      ampiezza: daCentesimi((livello + 1 < crescenti.length ? crescenti[livello + 1].sogliaCentesimi : 10000) - b.sogliaCentesimi),
    }))
    .reverse();
}

/** p_sintesi delle bande applicabili (V2 §2.1, P16). */
function decimaliSintesiBande(bande) {
  return decimaliSintesi(bande.map((b) => b.sogliaCentesimi));
}

/** Precisioni semantiche dei valori numerici (P16): dettaglio = 2, sintesi dalle soglie. */
function precisione(bande) {
  return { dettaglio: DECIMALI_DETTAGLIO, sintesi: decimaliSintesiBande(bande) };
}

const NON_VALUTATO = Object.freeze({
  centesimi: null, percentuale: null, sintesi: null, posizioneAsse: null,
  giudizio: null, livelloGiudizio: null, bandaId: null, critico: null,
});

/**
 * Rappresentazione pubblica di una percentuale ESATTA (Regola B): banda, valore del
 * dettaglio, valore della sintesi e posizione sull'asse derivano tutti da kc.
 */
function valoreDi(percentualeEsatta, bande) {
  if (percentualeEsatta === null || percentualeEsatta === undefined) return { ...NON_VALUTATO };
  const kc = centesimi(percentualeEsatta);
  const pSintesi = decimaliSintesiBande(bande);
  const banda = bande.find((b) => raggiungeSoglia(kc, b.sogliaCentesimi)) || null;
  return {
    centesimi: kc,
    percentuale: daCentesimi(kc),
    sintesi: { valore: daCentesimi(kc, pSintesi), decimali: pSintesi },
    posizioneAsse: daCentesimi(kc),
    giudizio: banda ? banda.etichetta : null,
    livelloGiudizio: banda ? banda.livello : null,
    bandaId: banda ? banda.id : null,
    critico: banda ? banda.critica : null,
  };
}

/** Livello assoluto (banda) di una percentuale esatta. */
function giudizioDi(percentualeEsatta, bande) {
  const v = valoreDi(percentualeEsatta, bande);
  return { giudizio: v.giudizio, livelloGiudizio: v.livelloGiudizio, critico: v.critico };
}

/**
 * Criticità (§8): una ZONA dell'asse. Banda critica con certezza sufficiente ->
 * CRITICAL_BAND (entra nel blocco di attenzione); con certezza parziale ->
 * CRITICAL_TO_VERIFY (⚠ a contorno, fuori dal blocco); senza dati -> nessuna.
 */
function criticitaDi(valore, certezza) {
  if (valore.critico !== true) return null;
  if (certezza === CERTEZZA.SUFFICIENTE) return CRITICITA.BANDA;
  if (certezza === CERTEZZA.PARZIALE) return CRITICITA.DA_VERIFICARE;
  return null;
}

/**
 * CONFRONTO RELATIVO tra un risultato e il suo riferimento (nucleo↔complessivo,
 * criterio di classe↔nucleo): posizione reciproca delle bande; la differenza è tra i
 * valori già mostrati alla stessa precisione (differenza di centesimi). Nessun
 * confronto se uno dei due manca, è insufficiente o non configurato (§11).
 */
function confrontoRelativo(risultato, riferimento) {
  const confrontabile = (r) => r && r.livelloGiudizio !== null && r.livelloGiudizio !== undefined
    && r.stato !== DATI.INSUFFICIENTI && r.stato !== DATI.NON_CONFIGURATO;
  if (!confrontabile(risultato) || !confrontabile(riferimento)) return null;
  let esito = CONFRONTO.ALLINEATO;
  if (risultato.livelloGiudizio > riferimento.livelloGiudizio) esito = CONFRONTO.SOPRA;
  else if (risultato.livelloGiudizio < riferimento.livelloGiudizio) esito = CONFRONTO.SOTTO;
  return {
    esito,
    differenzaPunti: (centesimi(risultato.percentualeEsatta) - centesimi(riferimento.percentualeEsatta)) / 100,
    riferimento: { posizioneAsse: riferimento.posizioneAsse },
    certezza: certezzaMinima([risultato.certezza, riferimento.certezza].filter(Boolean)),
  };
}

/** GENERALIZED_DIFFICULTY (P5): solo se il complessivo è in banda critica con certezza sufficiente. */
function difficoltaGeneralizzata(complessivo) {
  return complessivo.criticita === CRITICITA.BANDA;
}

/** Livello di copertura di un criterio: 0 non valutato, 1 indicativo, 2 provvisorio, 3 consolidato (3 o più). */
function livelloCopertura(numeroOsservazioni) {
  return Math.min(numeroOsservazioni, OSSERVAZIONI_CONSOLIDATE);
}

/**
 * Risultato di UN criterio per UNO studente.
 * @param {number[]} valoriCronologici - valori delle sole osservazioni VALIDE, dal più vecchio.
 */
function risultatoCriterioStudente(valoriCronologici, scala, bande) {
  const corrente = risultatoCorrenteMediaMobile(valoriCronologici, scala.valoreMassimo);
  const cumulativo = calcolaEsito(valoriCronologici, scala.valoreMassimo);
  const n = valoriCronologici.length;
  const certezza = certezzaStudente(n);
  const valore = valoreDi(corrente.percentualeEsatta, bande);
  return {
    ...valore,
    percentualeEsatta: corrente.percentualeEsatta,
    certezza,
    copertura: n === 0 ? null : COPERTURA_STUDENTE[livelloCopertura(n) - 1],
    criticita: criticitaDi(valore, certezza),
    stato: n === 0 ? DATI.NON_OSSERVATO : null,
    // P7: osservazioni considerate dalla finestra / osservazioni valide.
    base: { n: corrente.osservazioniConsiderate, N: n },
    punteggioOttenuto: corrente.punteggioOttenuto,
    punteggioMassimo: corrente.punteggioMassimo,
    osservazioniConsiderate: corrente.osservazioniConsiderate,
    osservazioniTotali: n,
    livelloCopertura: livelloCopertura(n),
    cumulativo: {
      ...valoreDi(cumulativo.percentualeEsatta, bande),
      percentualeEsatta: cumulativo.percentualeEsatta,
      punteggioOttenuto: cumulativo.punteggioOttenuto,
      punteggioMassimo: cumulativo.punteggioMassimo,
    },
  };
}

/**
 * Aggregazione di un insieme di criteri di UNO studente: un nucleo (`nucleo: true`) o
 * l'intera materia. Media semplice, a pesi uguali, dei soli criteri valutati.
 * Certezza: nucleo -> H3 (tutti i criteri valutati, ciascuno con almeno 3 osservazioni
 * valide); complessivo -> minimo dei criteri valutati che lo producono (P6).
 */
function aggregaCriteriStudente(criteri, scala, bande, { nucleo = false } = {}) {
  const valutati = criteri.filter((c) => c.osservazioniTotali > 0);
  const percentualeEsatta = valutati.length === 0 ? null : mediaSemplice(valutati.map((c) => c.percentualeEsatta));
  const cumulativoEsatto = valutati.length === 0 ? null : mediaSemplice(valutati.map((c) => c.cumulativo.percentualeEsatta));
  let certezza;
  if (valutati.length === 0) certezza = CERTEZZA.ASSENTE;
  else if (nucleo) certezza = criteri.every((c) => c.certezza === CERTEZZA.SUFFICIENTE) ? CERTEZZA.SUFFICIENTE : CERTEZZA.PARZIALE;
  else certezza = certezzaMinima(valutati.map((c) => c.certezza));
  let stato = null;
  if (criteri.length === 0) stato = DATI.NON_CONFIGURATO;
  else if (valutati.length === 0) stato = DATI.NON_OSSERVATO;
  const perLivello = (livello) => criteri.filter((c) => c.livelloCopertura === livello).length;
  const valore = valoreDi(percentualeEsatta, bande);
  let datiNucleo = null;
  if (nucleo && criteri.length > 0) datiNucleo = valutati.length === criteri.length ? DATI_NUCLEO.COMPLETI : DATI_NUCLEO.INCOMPLETI;
  return {
    ...valore,
    percentualeEsatta,
    certezza,
    criticita: criticitaDi(valore, certezza),
    stato,
    datiNucleo,
    // P7: criteri valutati / criteri attivi.
    base: { n: valutati.length, N: criteri.length },
    criteriValutati: valutati.length,
    criteriTotali: criteri.length,
    cumulativo: { ...valoreDi(cumulativoEsatto, bande), percentualeEsatta: cumulativoEsatto },
    copertura: {
      consolidati: perLivello(3), provvisori: perLivello(2), indicativi: perLivello(1), nonValutati: perLivello(0),
    },
  };
}

/** Certezza e stato di un valore di classe dalla copertura degli studenti (§7, §11). */
function coperturaDiClasse(valutati, totali) {
  if (valutati === 0) return { certezza: CERTEZZA.ASSENTE, copertura: COPERTURA_CLASSE.NON_OSSERVATA, stato: DATI.NON_OSSERVATO };
  if (valutati > totali * REGOLA_CLASSE.rappresentativitaOltre) {
    return { certezza: CERTEZZA.SUFFICIENTE, copertura: COPERTURA_CLASSE.RAPPRESENTATIVA, stato: null };
  }
  return { certezza: CERTEZZA.PARZIALE, copertura: COPERTURA_CLASSE.POCO_OSSERVATA, stato: DATI.INSUFFICIENTI };
}

/**
 * Valore di un aggregato di classe (nucleo o complessivo) dai criteri rappresentativi.
 * Senza criteri rappresentativi ma con dati: nessun valore (dati insufficienti).
 */
function aggregatoDiClasse(criteri, bande) {
  const rappresentativi = criteri.filter((c) => c.rappresentativo);
  const conDati = criteri.filter((c) => c.copertura.studentiValutati > 0);
  const percentualeEsatta = rappresentativi.length === 0 ? null : mediaSemplice(rappresentativi.map((c) => c.risultato.percentualeEsatta));
  let certezza = CERTEZZA.ASSENTE;
  let stato = DATI.NON_OSSERVATO;
  if (criteri.length === 0) stato = DATI.NON_CONFIGURATO;
  else if (rappresentativi.length > 0) {
    // P6: minimo dei termini che lo producono, tutti rappresentativi (sufficienti).
    certezza = CERTEZZA.SUFFICIENTE;
    stato = null;
  } else if (conDati.length > 0) {
    certezza = CERTEZZA.PARZIALE;
    stato = DATI.INSUFFICIENTI;
  }
  const valore = valoreDi(percentualeEsatta, bande);
  return {
    ...valore,
    percentualeEsatta,
    certezza,
    criticita: criticitaDi(valore, certezza),
    stato,
    // P7: criteri rappresentativi (i termini usati) / criteri attivi.
    base: { n: rappresentativi.length, N: criteri.length },
    criteriRappresentativi: rappresentativi.length,
    criteriTotali: criteri.length,
  };
}

/**
 * CONFRONTO di un criterio di classe con il proprio nucleo (§9). Solo per criteri
 * rappresentativi (regola di confrontabilità). Una differenza di banda è un glifo solo se
 * confermata: almeno 6 confrontabili e almeno 2/3 nella stessa direzione; altrimenti
 * COMPARISON_UNCONFIRMED (nessun glifo, P8) con il motivo.
 */
function confrontoCriterioConNucleo(criterio, risultatoNucleo) {
  if (!criterio.rappresentativo) return null;
  const relativo = confrontoRelativo(criterio.risultato, risultatoNucleo);
  if (relativo === null || relativo.esito === CONFRONTO.ALLINEATO) return relativo;
  const { confrontabili, inferiori, superiori } = criterio.confronto;
  const concordi = relativo.esito === CONFRONTO.SOTTO ? inferiori : superiori;
  if (confrontabili >= REGOLA_CLASSE.minimoConfrontabili && concordi * 3 >= confrontabili * 2) return relativo;
  return {
    ...relativo,
    esito: CONFRONTO.NON_CONFERMATO,
    direzione: relativo.esito,
    motivo: confrontabili < REGOLA_CLASSE.minimoConfrontabili ? CONFRONTO.POCHI_CONFRONTABILI : CONFRONTO.QUORUM_NON_RAGGIUNTO,
  };
}

/**
 * Avanzamento di un NUCLEO per la CLASSE.
 * @param {(number|string)[]} criteriIds - criteri attivi del nucleo, nell'ordine configurato.
 * @param {Map<number|string, {percentualeEsatta: number, osservazioniTotali: number}>[]} righeStudenti -
 *   una Map per OGNI studente iscritto (anche vuota): criterio -> risultato corrente, solo se valutato.
 */
function nucleoDiClasse(criteriIds, righeStudenti, bande) {
  const studentiTotali = righeStudenti.length;

  const criteri = criteriIds.map((id) => {
    const valutati = righeStudenti.map((riga) => riga.get(id)).filter(Boolean);
    const percentualeEsatta = valutati.length === 0 ? null : mediaSemplice(valutati.map((r) => r.percentualeEsatta));
    const { certezza, copertura, stato } = coperturaDiClasse(valutati.length, studentiTotali);
    // B-4: distribuzione indicizzata dalla posizione della banda, mai dal suo testo.
    const perLivello = new Map(bande.map((b) => [b.livello, 0]));
    valutati.forEach((r) => {
      const { livelloGiudizio } = valoreDi(r.percentualeEsatta, bande);
      if (perLivello.has(livelloGiudizio)) perLivello.set(livelloGiudizio, perLivello.get(livelloGiudizio) + 1);
    });
    const valore = valoreDi(percentualeEsatta, bande);
    return {
      id,
      risultato: {
        ...valore,
        percentualeEsatta,
        certezza,
        criticita: criticitaDi(valore, certezza),
        stato,
        base: { n: valutati.length, N: studentiTotali },
      },
      copertura: {
        studentiValutati: valutati.length,
        studentiTotali,
        studentiConsolidati: valutati.filter((r) => r.osservazioniTotali >= OSSERVAZIONI_CONSOLIDATE).length,
      },
      statoCopertura: copertura,
      osservazioniTotali: valutati.reduce((totale, r) => totale + r.osservazioniTotali, 0),
      rappresentativo: valutati.length > studentiTotali * REGOLA_CLASSE.rappresentativitaOltre,
      distribuzioneGiudizi: bande.map((b) => ({ livello: b.livello, bandaId: b.id, etichetta: b.etichetta, studenti: perLivello.get(b.livello) })),
    };
  });

  const risultato = aggregatoDiClasse(criteri, bande);
  const rappresentativi = criteri.filter((c) => c.rappresentativo);

  criteri.forEach((criterio) => {
    const confronto = { confrontabili: 0, inferiori: 0, superiori: 0, pari: 0 };
    if (criterio.rappresentativo) {
      const altri = rappresentativi.filter((c) => c.id !== criterio.id).map((c) => c.id);
      righeStudenti.forEach((riga) => {
        const proprio = riga.get(criterio.id);
        const altriValutati = altri.map((id) => riga.get(id)).filter(Boolean);
        if (!proprio || altriValutati.length === 0) return;
        // P1: "pari" = stesso valore in centesimi (stesso kc).
        const differenza = centesimi(proprio.percentualeEsatta) - centesimi(mediaSemplice(altriValutati.map((r) => r.percentualeEsatta)));
        confronto.confrontabili += 1;
        if (differenza === 0) confronto.pari += 1;
        else if (differenza < 0) confronto.inferiori += 1;
        else confronto.superiori += 1;
      });
    }
    criterio.confronto = confronto;
    criterio.confrontoConNucleo = confrontoCriterioConNucleo(criterio, risultato);
  });

  return {
    risultato,
    copertura: {
      studentiValutati: righeStudenti.filter((riga) => criteriIds.some((id) => riga.has(id))).length,
      studentiTotali,
    },
    osservazioniTotali: criteri.reduce((totale, c) => totale + c.osservazioniTotali, 0),
    criteri,
  };
}

/** Complessivo di classe: media semplice dei K(c) di TUTTI i criteri rappresentativi della materia. */
function complessivoDiClasse(nuclei, bande) {
  return aggregatoDiClasse(nuclei.flatMap((n) => n.criteri), bande);
}

/** Quota in centesimi (Regola B) di una parte su un totale: geometria delle barre di distribuzione. */
function quota(parte, totale) {
  return totale === 0 ? 0 : daCentesimi(centesimi((parte / totale) * 100));
}

/**
 * Distribuzione degli studenti per banda del PROPRIO complessivo (P11): solo conteggi,
 * nessuna persona identificata. Gli studenti con certezza parziale sono contati a parte
 * (resa più debole).
 */
function distribuzioneStudenti(complessivi, bande) {
  const conValore = complessivi.filter((c) => c.livelloGiudizio !== null);
  return {
    base: { n: conValore.length, N: complessivi.length },
    certezza: certezzaMinima(conValore.map((c) => c.certezza)),
    bande: bande.map((b) => {
      const nellaBanda = conValore.filter((c) => c.livelloGiudizio === b.livello);
      return {
        bandaId: b.id,
        livello: b.livello,
        etichetta: b.etichetta,
        critica: b.critica,
        studenti: nellaBanda.length,
        studentiParziali: nellaBanda.filter((c) => c.certezza !== CERTEZZA.SUFFICIENTE).length,
        larghezza: quota(nellaBanda.length, conValore.length),
      };
    }),
  };
}

module.exports = {
  REGOLA_CLASSE, CERTEZZA, CRITICITA, CONFRONTO, DATI, COPERTURA_CLASSE, DATI_NUCLEO,
  preparaBande, precisione, decimaliSintesiBande, valoreDi, giudizioDi, criticitaDi, certezzaMinima, certezzaStudente,
  confrontoRelativo, difficoltaGeneralizzata, livelloCopertura,
  risultatoCriterioStudente, aggregaCriteriStudente,
  nucleoDiClasse, confrontoCriterioConNucleo, complessivoDiClasse, coperturaDiClasse,
  distribuzioneStudenti, quota,
};
