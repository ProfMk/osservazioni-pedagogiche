'use strict';

/**
 * Forma pubblica dei valori del motore e dei contenuti (Visual Grammar V2): usata da
 * tutti i report, così ogni vista riceve la stessa rappresentazione (§12: un concetto,
 * stesso segno ovunque).
 */
const { daCentesimi } = require('./calcoloEsiti');
const { creaTraduttore } = require('./contenuti');
const motore = require('./calcoloProgresso');

/** Campi interni del motore che non diventano mai pubblici (l'intero kc resta interno). */
function pubblico(valore) {
  if (!valore) return valore;
  const { percentualeEsatta, centesimi, ...resto } = valore;
  if (resto.cumulativo) resto.cumulativo = pubblico(resto.cumulativo);
  return resto;
}

/** Bande pubbliche: etichetta (contenuto dell'istituto), soglia alla precisione di sintesi, zona sull'asse. */
function bandePubbliche(bande) {
  const { sintesi } = motore.precisione(bande);
  return bande.map((b) => ({
    id: b.id,
    livello: b.livello,
    etichetta: b.etichetta,
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

/** Scala applicabile con nome ed etichette dei valori tradotti. */
function scalaPubblica(scala, tr) {
  return {
    id: scala.id,
    nome: tr.testo('observation_scales.nome', scala.id, scala.nome),
    valoreMinimo: scala.valoreMinimo,
    valoreMassimo: scala.valoreMassimo,
    valori: scala.valori.map((v) => ({
      valore: v.valore,
      ordine: v.ordine,
      etichetta: tr.testo('observation_scale_values.etichetta', [scala.id, v.valore], v.etichetta),
    })),
  };
}

module.exports = { pubblico, bandePubbliche, scalaPubblica, traduttoreDi };
