/*
 * Localizzazione del client (Visual Grammar V2 §17). Il client NON decide la lingua e
 * NON contiene testi: riceve dal server il catalogo già risolto per la lingua della
 * sessione (lingua, direzione, locale = lingua + regione del tenant) e si limita a:
 *   - risolvere un identificatore in testo, con parametri NOMINATI e plurali secondo
 *     le regole della lingua (Intl.PluralRules), mai con funzioni singolare/plurale;
 *   - segnalare un testo mancante con un marcatore non linguistico (mai il codice);
 *   - formattare numeri e date ricevuti come dati, alla precisione ricevuta.
 * Nessun calcolo: i numeri arrivano già alla loro precisione semantica (Regola B).
 *
 * Caricabile dal browser (window.I18n) e da Node (require) per i test.
 */
(function (radice, fabbrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabbrica();
  else radice.I18n = fabbrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MARCATORE_MANCANTE = '⟨?⟩';
  var stato = { lingua: null, direzione: 'ltr', locale: null, testi: {} };

  function imposta(catalogo) {
    stato.lingua = catalogo.lingua;
    stato.direzione = catalogo.direzione;
    stato.locale = catalogo.locale;
    stato.testi = catalogo.testi || {};
  }

  function esiste(chiave) {
    return Object.prototype.hasOwnProperty.call(stato.testi, chiave);
  }

  /** Valore di un parametro: identificatori di catalogo risolti, numeri formattati, il resto com'è. */
  function valoreParametro(valore) {
    if (typeof valore === 'string' && /^[A-Z][A-Z0-9_]+$/.test(valore) && esiste(valore)) return testo(valore);
    if (valore && typeof valore === 'object' && 'valore' in valore && 'decimali' in valore) return numero(valore.valore, valore.decimali);
    if (typeof valore === 'number') return numero(valore, 0);
    if (valore && typeof valore === 'object' && 'testo' in valore) return valore.testo;
    return String(valore);
  }

  /**
   * Testo di un identificatore. `parametri` nominati; se la voce ha forme plurali, la
   * categoria è scelta con le regole della lingua sul parametro `n`.
   */
  function testo(chiave, parametri) {
    if (!esiste(chiave)) return MARCATORE_MANCANTE;
    var voce = stato.testi[chiave];
    if (voce && typeof voce === 'object') {
      var categoria = new Intl.PluralRules(stato.locale).select(parametri && typeof parametri.n === 'number' ? parametri.n : 0);
      voce = voce[categoria] !== undefined ? voce[categoria] : voce.other;
    }
    if (typeof voce !== 'string') return MARCATORE_MANCANTE;
    return voce.replace(/\{(\w+)\}/g, function (_, nome) {
      if (!parametri || parametri[nome] === undefined || parametri[nome] === null) return MARCATORE_MANCANTE;
      return valoreParametro(parametri[nome]);
    });
  }

  /** Numero già alla sua precisione semantica: formattazione per lingua + regione, decimali fissi. */
  function numero(valore, decimali) {
    if (valore === null || valore === undefined) return '';
    return new Intl.NumberFormat(stato.locale, { minimumFractionDigits: decimali, maximumFractionDigits: decimali }).format(valore);
  }

  /** Data di calendario 'YYYY-MM-DD' (un dato, senza fuso): formattazione per lingua + regione. */
  function data(giorno) {
    if (!giorno) return '';
    return new Intl.DateTimeFormat(stato.locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(giorno + 'T00:00:00Z'));
  }

  return {
    imposta: imposta,
    testo: testo,
    esiste: esiste,
    numero: numero,
    data: data,
    lingua: function () { return stato.lingua; },
    direzione: function () { return stato.direzione; },
    locale: function () { return stato.locale; },
    MARCATORE_MANCANTE: MARCATORE_MANCANTE,
  };
}));
