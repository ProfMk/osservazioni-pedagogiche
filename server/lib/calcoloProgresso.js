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
} = require('./calcoloEsiti');

// Tolleranza per i confronti tra valori esatti ottenuti con divisioni (terzi, medie di medie):
// evita che 69,99999999999999 venga trattato come diverso da 70.
const TOLLERANZA = 1e-9;

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
 * @param {{soglia_minima: number|string, etichetta: string}[]} bandeDb
 */
function preparaBande(bandeDb) {
  const crescenti = bandeDb
    .map((b) => ({ sogliaMinima: Number(b.soglia_minima), etichetta: b.etichetta }))
    .sort((a, b) => a.sogliaMinima - b.sogliaMinima);
  return crescenti.map((b, livello) => ({ ...b, livello })).reverse();
}

/** Giudizio e livello della banda per una percentuale pedagogica ESATTA (null -> non valutato). */
function giudizioDi(percentualeEsatta, bande) {
  if (percentualeEsatta === null || percentualeEsatta === undefined) return { giudizio: '', livelloGiudizio: null };
  for (const banda of bande) {
    if (percentualeEsatta + TOLLERANZA >= banda.sogliaMinima) return { giudizio: banda.etichetta, livelloGiudizio: banda.livello };
  }
  return { giudizio: '', livelloGiudizio: null };
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
      posizioneRadar: posizione === null || posizione <= TOLLERANZA ? null : arrotondaPerPresentazione(posizione),
    };
  });
}

/** Livello di copertura di un criterio: 0 non valutato, 1 indicativo, 2 provvisorio, 3 consolidato (3 o più). */
function livelloCopertura(numeroOsservazioni) {
  return Math.min(numeroOsservazioni, LIVELLO_COPERTURA_CONSOLIDATO);
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
 * Confronto relativo tra un nucleo e il complessivo dello STESSO studente (non una diagnosi):
 * banda superiore -> punto di forza, inferiore -> area di attenzione, uguale -> nella norma.
 */
function confrontoConComplessivo(livelloNucleo, livelloComplessivo) {
  if (livelloNucleo === null || livelloComplessivo === null) return null;
  if (livelloNucleo > livelloComplessivo) return 'punto_di_forza';
  if (livelloNucleo < livelloComplessivo) return 'area_di_attenzione';
  return 'nella_norma';
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
    criterio.stato = statoCriterioDiClasse(criterio, risultato.livelloGiudizio);
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
 * Stato di un criterio nel report di classe. Forte/debole solo se valgono ENTRAMBE le condizioni:
 * banda diversa da quella del nucleo, e almeno 2/3 degli studenti confrontabili (minimo 6, pari
 * inclusi nel denominatore) concordi nella stessa direzione.
 */
function statoCriterioDiClasse(criterio, livelloNucleo) {
  if (criterio.copertura.studentiValutati === 0) return 'non_osservato';
  if (!criterio.rappresentativo) return 'poco_osservato';
  const { confrontabili, inferiori, superiori } = criterio.confronto;
  const livello = criterio.risultato.livelloGiudizio;
  if (livello === null || livelloNucleo === null || confrontabili < REGOLA_CLASSE.minimoConfrontabili) return 'nella_norma';
  if (livello < livelloNucleo && inferiori * 3 >= confrontabili * 2) return 'debole';
  if (livello > livelloNucleo && superiori * 3 >= confrontabili * 2) return 'forte';
  return 'nella_norma';
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
  posizioneRadarDaMedia, posizioneRadarDaPercentuale, livelloCopertura,
  risultatoCriterioStudente, aggregaCriteriStudente, confrontoConComplessivo,
  nucleoDiClasse, statoCriterioDiClasse, complessivoDiClasse,
};
