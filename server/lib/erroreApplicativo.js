'use strict';

/**
 * Errore applicativo con uno stato HTTP esplicito. Un solo tipo di errore,
 * distinto per stato: il gestore finale (server/routes/index.js) traduce
 * SOLO questo tipo in una risposta strutturata; qualunque altro errore (bug,
 * violazione di vincolo del database) diventa un 500 generico verso il
 * client, con la diagnosi completa solo in console (mai dettagli interni
 * esposti, sez. 68).
 */
class ErroreApplicativo extends Error {
  constructor(stato, messaggio) {
    super(messaggio);
    this.stato = stato;
  }
}

/** 401: nessuna sessione valida (mancante, scaduta, revocata). */
function nonAutenticato(messaggio = 'Autenticazione richiesta.') {
  return new ErroreApplicativo(401, messaggio);
}

/**
 * 404: risorsa inesistente o non appartenente all'ambito del chiamante.
 * Uso deliberato dello stesso stato per "non esiste" e "non è tua": non
 * rivelare l'esistenza di una risorsa di un altro tenant/scope.
 */
function nonTrovato(messaggio = 'Risorsa non trovata.') {
  return new ErroreApplicativo(404, messaggio);
}

/** 403: la richiesta è autenticata ma priva del permesso/scope richiesto. */
function vietato(messaggio = 'Operazione non consentita.') {
  return new ErroreApplicativo(403, messaggio);
}

/** 400: dati in ingresso non validi (validazione applicativa). */
function datiNonValidi(messaggio) {
  return new ErroreApplicativo(400, messaggio);
}

/** 409: conflitto (es. risorsa già modificata, email già in uso). */
function conflitto(messaggio) {
  return new ErroreApplicativo(409, messaggio);
}

/** 422: dati sintatticamente validi ma semanticamente inaccettabili. */
function nonElaborabile(messaggio) {
  return new ErroreApplicativo(422, messaggio);
}

module.exports = {
  ErroreApplicativo, nonAutenticato, nonTrovato, vietato, datiNonValidi, conflitto, nonElaborabile,
};
