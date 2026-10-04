'use strict';

/**
 * Calcolo dei report pedagogici (specifica v2.7): avanzamento dello studente
 * e avanzamento della classe. Solo funzioni PURE: nessun accesso al database.
 * Scala e bande di giudizio arrivano sempre da chi chiama (configurazione del
 * tenant/livello): qui non compare alcun valore di scala, soglia o etichetta.
 *
 * Due grandezze distinte, da non confondere mai:
 * - `percentuale` (percentuale PEDAGOGICA) = media / massimo della scala × 100:
 *   è l'unica usata per giudizi, medie, confronti e report;
 * - `posizioneRadar` = (media − minimo) / (massimo − minimo) × 100: serve SOLO
 *   alla geometria del radar, non entra in alcun giudizio o aggregazione.
 *
 * Tutte le aggregazioni lavorano sui valori esatti (`percentualeEsatta`);
 * l'arrotondamento a 2 decimali è solo di presentazione.
 */

const {
  arrotondaPerPresentazione, calcolaEsito, risultatoCorrenteMediaMobile, FINESTRA_MEDIA_MOBILE,
  TOLLERANZA_NUMERICA: TOLLERANZA, raggiungeSoglia,
} = require('./calcoloEsiti');

// Parametri della regola di classe (specifica v2.7, approvati): restituiti anche dall'API.
const REGOLA_CLASSE = Object.freeze({
  finestra: FINESTRA_MEDIA_MOBILE,
  rappresentativitaOltre: 0.5,
  quotaConcordi: '2/3',
  minimoConfrontabili: 6,
});

const LIVELLO_COPERTURA_CONSOLIDATO = FINESTRA_MEDIA_MOBILE;

function mediaSemplice(valori) {
  return valori.reduce((totale, v) => totale + v, 0) / valori.length;
}

function arrotondaONullo(valore) {
  return valore === null ? null : arrotondaPerPresentazione(valore);
}

/**
 * Bande di giudizio pronte per il calcolo: soglie numeriche, ordinate dalla più alta,
 * ciascuna con il proprio `livello` (0 = banda più bassa). L'ordine è quello delle soglie:
 * lo schema non ha una colonna d'ordine.
 *
 * CRITICITÀ: è critica la banda con la posizione più bassa tra quelle configurate dall'istituto
 * (`critica: true`). Deriva solo dalla struttura delle bande: nessuna soglia numerica e nessuna
 * etichetta sono scritte nel codice.
 * @param {{soglia_minima: number|string, etichetta: string}[]} bandeDb
 */
function preparaBande(bandeDb) {
  const crescenti = bandeDb
    .map((b) => ({ sogliaMinima: Number(b.soglia_minima), etichetta: b.etichetta }))
    .sort((a, b) => a.sogliaMinima - b.sogliaMinima);
  return crescenti.map((b, livello) => ({ ...b, livello, critica: livello === LIVELLO_BANDA_CRITICA })).reverse();
}

// Posizione della banda critica nell'ordine crescente delle soglie: la più bassa.
const LIVELLO_BANDA_CRITICA = 0;

const NON_VALUTATO = Object.freeze({ giudizio: '', livelloGiudizio: null, critico: null });

/**
 * LIVELLO ASSOLUTO di una percentuale pedagogica ESATTA: giudizio (etichetta della banda), posizione
 * della banda e criticità. Dipende solo dal valore e dalle bande dell'istituto: nessun confronto con
 * altri risultati può modificarlo. Null -> non valutato (critico: null, non false).
 */
function giudizioDi(percentualeEsatta, bande) {
  if (percentualeEsatta === null || percentualeEsatta === undefined) return { ...NON_VALUTATO };
  for (const banda of bande) {
    if (raggiungeSoglia(percentualeEsatta, banda.sogliaMinima)) {
      return { giudizio: banda.etichetta, livelloGiudizio: banda.livello, critico: banda.critica };
    }
  }
  return { ...NON_VALUTATO };
}

/**
 * CONFRONTO RELATIVO tra un risultato e il suo riferimento (nucleo vs complessivo, criterio vs nucleo):
 * solo la posizione reciproca delle due bande, più la differenza in punti percentuali come dato
 * descrittivo. NON dice nulla sull'adeguatezza del risultato: "allineato" significa "stessa banda del
 * riferimento", non "va bene". Il livello assoluto e la criticità restano quelli di giudizioDi.
 * @returns {{esito: 'superiore'|'inferiore'|'allineato', differenzaPunti: number}|null} null se uno dei due non è valutato.
 */
function confrontoRelativo(risultato, riferimento) {
  if (!risultato || !riferimento || risultato.livelloGiudizio === null || riferimento.livelloGiudizio === null) return null;
  let esito = 'allineato';
  if (risultato.livelloGiudizio > riferimento.livelloGiudizio) esito = 'superiore';
  else if (risultato.livelloGiudizio < riferimento.livelloGiudizio) esito = 'inferiore';
  return { esito, differenzaPunti: arrotondaPerPresentazione(risultato.percentualeEsatta - riferimento.percentualeEsatta) };
}

/**
 * Difficoltà generalizzata: il risultato complessivo (dello studente o della classe) è nella banda
 * critica. In quel caso un nucleo "allineato" non è un nucleo senza problemi: è critico come il resto.
 */
function difficoltaGeneralizzata(complessivo) {
  return complessivo.critico === true;
}

/**
 * Posizione sul radar di una media espressa in unità di scala: 0 = minimo della scala,
 * 100 = massimo. Solo geometria. Null se la media è null o la scala ha un solo valore.
 */
function posizioneRadarDaMedia(media, scala) {
  const ampiezza = scala.valoreMassimo - scala.valoreMinimo;
  if (media === null || media === undefined || ampiezza <= 0) return null;
  return ((media - scala.valoreMinimo) / ampiezza) * 100;
}

/** Posizione sul radar corrispondente a una percentuale pedagogica (stessa trasformazione). */
function posizioneRadarDaPercentuale(percentualeEsatta, scala) {
  if (percentualeEsatta === null || percentualeEsatta === undefined) return null;
  return posizioneRadarDaMedia((percentualeEsatta / 100) * scala.valoreMassimo, scala);
}

/**
 * Bande con la posizione dell'anello sul radar. Una soglia che cade sul minimo della
 * scala o sotto (posizione <= 0) non ha anello: `posizioneRadar` null.
 */
function bandeConPosizioneRadar(bande, scala) {
  return bande.map((b) => {
    const posizione = posizioneRadarDaPercentuale(b.sogliaMinima, scala);
    return {
      sogliaMinima: b.sogliaMinima,
      etichetta: b.etichetta,
      livello: b.livello,
      critica: b.critica,
      posizioneRadar: posizione === null || posizione <= TOLLERANZA ? null : arrotondaPerPresentazione(posizione),
    };
  });
}

/** Livello di copertura di un criterio: 0 non valutato, 1 indicativo, 2 provvisorio, 3 consolidato (3 o più). */
function livelloCopertura(numeroOsservazioni) {
  return Math.min(numeroOsservazioni, LIVELLO_COPERTURA_CONSOLIDATO);
}

/** Percentuale pedagogica di UNA osservazione (valore / massimo della scala × 100): solo per lo storico. */
function percentualeOsservazione(valore, scala) {
  return calcolaEsito([valore], scala.valoreMassimo).percentuale;
}

/**
 * Risultato di UN criterio per UNO studente.
 * @param {number[]} valoriCronologici - valori delle sole osservazioni VALIDE, dal più vecchio.
 * @param {{valoreMassimo: number, valoreMinimo: number}} scala
 * @param {object[]} bande - da preparaBande.
 * Corrente = media mobile delle ultime 3 (o di tutte, se meno); cumulativo = tutte le osservazioni valide.
 */
function risultatoCriterioStudente(valoriCronologici, scala, bande) {
  const corrente = risultatoCorrenteMediaMobile(valoriCronologici, scala.valoreMassimo);
  const cumulativo = calcolaEsito(valoriCronologici, scala.valoreMassimo);
  return {
    media: corrente.media,
    percentuale: corrente.percentuale,
    percentualeEsatta: corrente.percentualeEsatta,
    ...giudizioDi(corrente.percentualeEsatta, bande),
    punteggioOttenuto: corrente.punteggioOttenuto,
    punteggioMassimo: corrente.punteggioMassimo,
    osservazioniConsiderate: corrente.osservazioniConsiderate,
    osservazioniTotali: corrente.osservazioniTotali,
    livelloCopertura: livelloCopertura(valoriCronologici.length),
    cumulativo: {
      percentuale: cumulativo.percentuale,
      percentualeEsatta: cumulativo.percentualeEsatta,
      giudizio: giudizioDi(cumulativo.percentualeEsatta, bande).giudizio,
      punteggioOttenuto: cumulativo.punteggioOttenuto,
      punteggioMassimo: cumulativo.punteggioMassimo,
    },
  };
}

/**
 * Aggregazione di un insieme di criteri di UNO studente (un nucleo, o l'intera materia):
 * media semplice, a pesi uguali, dei risultati correnti dei soli criteri valutati.
 * Il cumulativo è la media semplice dei cumulativi degli stessi criteri.
 * @param {object[]} criteri - risultati di risultatoCriterioStudente (tutti i criteri dell'insieme).
 */
function aggregaCriteriStudente(criteri, scala, bande) {
  const valutati = criteri.filter((c) => c.osservazioniTotali > 0);
  const percentualeEsatta = valutati.length === 0 ? null : mediaSemplice(valutati.map((c) => c.percentualeEsatta));
  const cumulativoEsatto = valutati.length === 0 ? null : mediaSemplice(valutati.map((c) => c.cumulativo.percentualeEsatta));
  const perLivello = (livello) => criteri.filter((c) => c.livelloCopertura === livello).length;
  return {
    percentuale: arrotondaONullo(percentualeEsatta),
    percentualeEsatta,
    ...giudizioDi(percentualeEsatta, bande),
    criteriValutati: valutati.length,
    criteriTotali: criteri.length,
    cumulativo: {
      percentuale: arrotondaONullo(cumulativoEsatto),
      percentualeEsatta: cumulativoEsatto,
      giudizio: giudizioDi(cumulativoEsatto, bande).giudizio,
    },
    copertura: {
      consolidati: perLivello(3), provvisori: perLivello(2), indicativi: perLivello(1), nonValutati: perLivello(0),
    },
    posizioneRadar: arrotondaONullo(posizioneRadarDaPercentuale(percentualeEsatta, scala)),
    // Punto pieno sul radar solo se TUTTI i criteri sono valutati e ciascuno è consolidato.
    puntoPieno: criteri.length > 0 && criteri.every((c) => c.livelloCopertura === LIVELLO_COPERTURA_CONSOLIDATO),
  };
}

/**
 * Avanzamento di un NUCLEO per la CLASSE.
 * @param {(number|string)[]} criteriIds - criteri attivi del nucleo, nell'ordine configurato.
 * @param {Map<number|string, {percentualeEsatta: number, osservazioniTotali: number}>[]} righeStudenti -
 *   una Map per OGNI studente iscritto (anche vuota): criterio -> risultato corrente, solo se valutato.
 * @param {object[]} bande - da preparaBande.
 *
 * K(c) = media dei risultati correnti degli studenti valutati sul criterio (ogni studente conta una volta);
 * nucleo = media semplice dei K(c) dei soli criteri rappresentativi (valutati su più di metà degli iscritti).
 */
function nucleoDiClasse(criteriIds, righeStudenti, bande) {
  const studentiTotali = righeStudenti.length;

  const criteri = criteriIds.map((id) => {
    const valutati = righeStudenti.map((riga) => riga.get(id)).filter(Boolean);
    const percentualeEsatta = valutati.length === 0 ? null : mediaSemplice(valutati.map((r) => r.percentualeEsatta));
    const perEtichetta = new Map(bande.map((b) => [b.etichetta, 0]));
    valutati.forEach((r) => {
      const { giudizio } = giudizioDi(r.percentualeEsatta, bande);
      if (perEtichetta.has(giudizio)) perEtichetta.set(giudizio, perEtichetta.get(giudizio) + 1);
    });
    return {
      id,
      risultato: { percentuale: arrotondaONullo(percentualeEsatta), percentualeEsatta, ...giudizioDi(percentualeEsatta, bande) },
      copertura: {
        studentiValutati: valutati.length,
        studentiTotali,
        studentiConsolidati: valutati.filter((r) => r.osservazioniTotali >= LIVELLO_COPERTURA_CONSOLIDATO).length,
      },
      osservazioniTotali: valutati.reduce((totale, r) => totale + r.osservazioniTotali, 0),
      rappresentativo: valutati.length > studentiTotali * REGOLA_CLASSE.rappresentativitaOltre,
      distribuzioneGiudizi: bande.map((b) => ({ etichetta: b.etichetta, studenti: perEtichetta.get(b.etichetta) })),
    };
  });

  const rappresentativi = criteri.filter((c) => c.rappresentativo);
  const percentualeNucleo = rappresentativi.length === 0
    ? null
    : mediaSemplice(rappresentativi.map((c) => c.risultato.percentualeEsatta));
  const risultato = {
    percentuale: arrotondaONullo(percentualeNucleo),
    percentualeEsatta: percentualeNucleo,
    ...giudizioDi(percentualeNucleo, bande),
    criteriRappresentativi: rappresentativi.length,
    criteriTotali: criteri.length,
  };

  criteri.forEach((criterio) => {
    const confronto = { confrontabili: 0, inferiori: 0, superiori: 0, pari: 0 };
    if (criterio.rappresentativo) {
      const altri = rappresentativi.filter((c) => c.id !== criterio.id).map((c) => c.id);
      righeStudenti.forEach((riga) => {
        const proprio = riga.get(criterio.id);
        const altriValutati = altri.map((id) => riga.get(id)).filter(Boolean);
        if (!proprio || altriValutati.length === 0) return;
        const differenza = proprio.percentualeEsatta - mediaSemplice(altriValutati.map((r) => r.percentualeEsatta));
        confronto.confrontabili += 1;
        if (Math.abs(differenza) <= TOLLERANZA) confronto.pari += 1;
        else if (differenza < 0) confronto.inferiori += 1;
        else confronto.superiori += 1;
      });
    }
    criterio.confronto = confronto;
    criterio.statoCopertura = statoCoperturaCriterio(criterio);
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

/**
 * COPERTURA di un criterio nel report di classe: dice solo se i dati rappresentano la classe,
 * mai se il risultato è buono o cattivo ("pochi studenti valutati" non è "classe debole").
 */
function statoCoperturaCriterio(criterio) {
  if (criterio.copertura.studentiValutati === 0) return 'non_osservato';
  return criterio.rappresentativo ? 'rappresentativo' : 'poco_osservato';
}

/**
 * CONFRONTO RELATIVO di un criterio di classe con il proprio nucleo. Solo per criteri rappresentativi
 * (altrimenti null): `esito` e `differenzaPunti` come in confrontoRelativo; `confermato` dice se la
 * differenza di banda è condivisa dalla classe, cioè se almeno 2/3 degli studenti confrontabili
 * (minimo 6, pari inclusi nel denominatore) vanno nella stessa direzione. Una differenza non
 * confermata non va segnalata; in nessun caso questo confronto sostituisce il livello assoluto.
 */
function confrontoCriterioConNucleo(criterio, risultatoNucleo) {
  if (!criterio.rappresentativo) return null;
  const relativo = confrontoRelativo(criterio.risultato, risultatoNucleo);
  if (relativo === null) return null;
  const { confrontabili, inferiori, superiori } = criterio.confronto;
  const concordi = relativo.esito === 'inferiore' ? inferiori : superiori;
  const confermato = relativo.esito === 'allineato'
    ? null
    : confrontabili >= REGOLA_CLASSE.minimoConfrontabili && concordi * 3 >= confrontabili * 2;
  return { ...relativo, confermato };
}

/** Complessivo di classe: media semplice dei K(c) di TUTTI i criteri rappresentativi della materia. */
function complessivoDiClasse(nuclei, bande) {
  const criteri = nuclei.flatMap((n) => n.criteri);
  const rappresentativi = criteri.filter((c) => c.rappresentativo);
  const percentualeEsatta = rappresentativi.length === 0
    ? null
    : mediaSemplice(rappresentativi.map((c) => c.risultato.percentualeEsatta));
  return {
    percentuale: arrotondaONullo(percentualeEsatta),
    percentualeEsatta,
    ...giudizioDi(percentualeEsatta, bande),
    criteriRappresentativi: rappresentativi.length,
    criteriTotali: criteri.length,
  };
}

module.exports = {
  REGOLA_CLASSE,
  preparaBande, giudizioDi, bandeConPosizioneRadar,
  posizioneRadarDaMedia, posizioneRadarDaPercentuale, livelloCopertura, percentualeOsservazione,
  confrontoRelativo, difficoltaGeneralizzata,
  risultatoCriterioStudente, aggregaCriteriStudente,
  nucleoDiClasse, statoCoperturaCriterio, confrontoCriterioConNucleo, complessivoDiClasse,
};
