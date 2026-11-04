'use strict';

/**
 * Avvolge un handler async e inoltra gli errori a Express (evita try/catch
 * ripetuti). Cattura qui, non nel gestore errori finale, i parametri e il
 * corpo della richiesta: in Express 5 `req.params` (e in alcuni casi
 * `req.body`) non sono affidabili quando l'errore raggiunge un middleware di
 * gestione errori a livello di router — risultano vuoti anche se la rotta li
 * aveva popolati. Bug reale già trovato e corretto nel prototipo.
 *
 * Il corpo finisce nella diagnosi in console (server/routes/index.js): ogni
 * campo il cui nome contiene «password» (a qualunque profondità) è sostituito
 * da un segnaposto, così una password non compare MAI in un log.
 */
const OMESSA = '[omessa]';
const CAMPO_RISERVATO = /password/i;

function senzaPassword(valore) {
  if (Array.isArray(valore)) return valore.map(senzaPassword);
  if (valore && typeof valore === 'object') {
    return Object.fromEntries(Object.entries(valore).map(([chiave, v]) => (
      [chiave, CAMPO_RISERVATO.test(chiave) ? OMESSA : senzaPassword(v)]
    )));
  }
  return valore;
}

function asincrono(handler) {
  return (req, res, next) => {
    handler(req, res, next).catch((errore) => {
      errore.diagnosticaRichiesta = { parametri: { ...req.params }, corpo: senzaPassword(req.body) };
      next(errore);
    });
  };
}

module.exports = { asincrono, senzaPassword, OMESSA };
