'use strict';

/**
 * Errore applicativo con uno stato HTTP esplicito.
 * Uso deliberato di un solo tipo di errore per "non trovato" e "non
 * autorizzato" (stato 404): il piano (sezione 13/R10) richiede di non
 * rivelare l'esistenza di una risorsa che non appartiene al docente.
 */
class ErroreApplicativo extends Error {
  constructor(stato, messaggio) {
    super(messaggio);
    this.stato = stato;
  }
}

/** Risorsa inesistente o non appartenente al docente autenticato: risposta uniforme. */
function nonTrovato(messaggio = 'Risorsa non trovata.') {
  return new ErroreApplicativo(404, messaggio);
}

/** Dati in ingresso non validi (es. punteggio fuori scala). */
function datiNonValidi(messaggio) {
  return new ErroreApplicativo(400, messaggio);
}

module.exports = { ErroreApplicativo, nonTrovato, datiNonValidi };
