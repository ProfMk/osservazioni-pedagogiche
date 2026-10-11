'use strict';

/**
 * Errore applicativo (Visual Grammar V2 §17): stato HTTP + CODICE semantico +
 * parametri NOMINATI. Mai una frase: il testo per l'utente viene risolto dal
 * catalogo di localizzazione (lingua della sessione), mai dal server in una
 * lingua fissa. Il gestore finale (server/routes/index.js) risponde
 * { errore: { codice, parametri } }; qualunque altro errore (bug, vincolo del
 * database non tradotto) diventa ERR_INTERNAL, con la diagnosi solo in console.
 */
const FORMATO_CODICE = /^ERR_[A-Z0-9_]+$/;

class ErroreApplicativo extends Error {
  constructor(stato, codice, parametri = {}) {
    if (!FORMATO_CODICE.test(codice)) {
      // Difesa strutturale: un errore applicativo non può mai trasportare una frase.
      throw new TypeError(`Codice d'errore non valido (atteso ERR_*): ${codice}`);
    }
    if (parametri === null || typeof parametri !== 'object' || Array.isArray(parametri)) {
      throw new TypeError('I parametri di un errore devono essere un oggetto con nomi.');
    }
    super(codice);
    this.stato = stato;
    this.codice = codice;
    this.parametri = parametri;
  }
}

/** 401: nessuna sessione valida (mancante, scaduta, revocata) o credenziali errate. */
function nonAutenticato(codice = 'ERR_SESSION_REQUIRED', parametri = {}) {
  return new ErroreApplicativo(401, codice, parametri);
}

/**
 * 404: risorsa inesistente o non appartenente all'ambito del chiamante.
 * Uso deliberato dello stesso stato per "non esiste" e "non è tua".
 */
function nonTrovato(codice = 'ERR_NOT_FOUND', parametri = {}) {
  return new ErroreApplicativo(404, codice, parametri);
}

/** 403: la richiesta è autenticata ma priva del permesso/scope richiesto. */
function vietato(codice = 'ERR_FORBIDDEN', parametri = {}) {
  return new ErroreApplicativo(403, codice, parametri);
}

/** 400: dati in ingresso non validi (validazione applicativa). */
function datiNonValidi(codice = 'ERR_INVALID_INPUT', parametri = {}) {
  return new ErroreApplicativo(400, codice, parametri);
}

/** 409: conflitto (es. risorsa già esistente). */
function conflitto(codice = 'ERR_CONFLICT', parametri = {}) {
  return new ErroreApplicativo(409, codice, parametri);
}

/** 422: dati sintatticamente validi ma semanticamente inaccettabili. */
function nonElaborabile(codice = 'ERR_UNPROCESSABLE', parametri = {}) {
  return new ErroreApplicativo(422, codice, parametri);
}

module.exports = {
  ErroreApplicativo, FORMATO_CODICE, nonAutenticato, nonTrovato, vietato, datiNonValidi, conflitto, nonElaborabile,
};
