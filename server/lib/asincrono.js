'use strict';

/**
 * Avvolge un handler async e inoltra gli errori a Express (evita try/catch
 * ripetuti). Cattura qui, non nel gestore errori finale, i parametri e il
 * corpo della richiesta: in Express 5 `req.params` (e in alcuni casi
 * `req.body`) non sono affidabili quando l'errore raggiunge un middleware di
 * gestione errori a livello di router — risultano vuoti anche se la rotta li
 * aveva popolati. Bug reale già trovato e corretto nel prototipo.
 */
function asincrono(handler) {
  return (req, res, next) => {
    handler(req, res, next).catch((errore) => {
      errore.diagnosticaRichiesta = { parametri: { ...req.params }, corpo: req.body };
      next(errore);
    });
  };
}

module.exports = { asincrono };
