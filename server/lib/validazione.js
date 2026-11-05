'use strict';

/**
 * Validazione dei moduli dell'amministrazione dell'istituto (iterazione 2A). Ogni errore
 * è un codice semantico con il campo come parametro (UI_FIELD_*): il client lo mostra
 * sul campo a cui si riferisce (L-7, mai una frase).
 */
const { datiNonValidi, conflitto, nonTrovato } = require('./erroreApplicativo');

/** Testo obbligatorio, ripulito degli spazi, entro `massimo` caratteri (contati in caratteri, non in byte). */
function testoObbligatorio(valore, campo, massimo) {
  if (typeof valore !== 'string' || valore.trim() === '') throw datiNonValidi('ERR_REQUIRED_FIELD', { campo });
  const testo = valore.trim();
  if ([...testo].length > massimo) throw datiNonValidi('ERR_TEXT_TOO_LONG', { campo, massimo });
  return testo;
}

/** Data di calendario 'YYYY-MM-DD' esistente (niente 31 febbraio). */
function dataObbligatoria(valore, campo) {
  if (valore === undefined || valore === null || valore === '') throw datiNonValidi('ERR_REQUIRED_FIELD', { campo });
  if (typeof valore !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valore)) throw datiNonValidi('ERR_DATE_INVALID', { campo });
  const giorno = new Date(`${valore}T00:00:00Z`);
  if (Number.isNaN(giorno.getTime()) || giorno.toISOString().slice(0, 10) !== valore) throw datiNonValidi('ERR_DATE_INVALID', { campo });
  return valore;
}

/** Intervallo [inizio, fine] con fine strettamente dopo inizio (come i CHECK dello schema). */
function intervalloDate(corpo, { campoInizio = 'UI_FIELD_DATA_INIZIO', campoFine = 'UI_FIELD_DATA_FINE' } = {}) {
  const inizio = dataObbligatoria(corpo.dataInizio, campoInizio);
  const fine = dataObbligatoria(corpo.dataFine, campoFine);
  if (fine <= inizio) throw datiNonValidi('ERR_DATE_RANGE_INVALID', { campo: campoFine });
  return { inizio, fine };
}

/** Intero (anche negativo) per l'ordine di un elenco; assente -> `predefinito`. */
function interoFacoltativo(valore, campo, predefinito) {
  if (valore === undefined || valore === null || valore === '') return predefinito;
  const numero = typeof valore === 'string' && /^-?\d+$/.test(valore.trim()) ? Number(valore.trim()) : valore;
  if (!Number.isInteger(numero) || Math.abs(numero) > 1000000) throw datiNonValidi('ERR_INTEGER_INVALID', { campo });
  return numero;
}

/** Identificativo di percorso positivo (altrimenti 404: un id malformato non indica nessuna risorsa). */
function idDiPercorso(valore, risorsa) {
  const id = Number(valore);
  if (!Number.isInteger(id) || id <= 0) throw nonTrovato('ERR_NOT_FOUND', { risorsa });
  return id;
}

/**
 * Eliminazione con righe collegate (FK RESTRICT, 23503): mai un 500 né un 400 generico,
 * ma 409 con il codice indicato. Si usa intorno al solo DELETE.
 */
async function eliminaORifiuta(fn, codice, parametri = {}) {
  try {
    return await fn();
  } catch (errore) {
    if (errore && errore.code === '23503') throw conflitto(codice, parametri);
    throw errore;
  }
}

/** Vincolo d'unicità violato (23505) su un vincolo noto -> 409 con il codice indicato. */
async function unicoORifiuta(fn, mappa) {
  try {
    return await fn();
  } catch (errore) {
    if (errore && errore.code === '23505') {
      const testo = `${errore.constraint || ''} ${errore.message || ''}`;
      const voce = Object.entries(mappa).find(([vincolo]) => testo.includes(vincolo));
      if (voce) throw voce[1]();
    }
    throw errore;
  }
}

module.exports = {
  testoObbligatorio, dataObbligatoria, intervalloDate, interoFacoltativo, idDiPercorso, eliminaORifiuta, unicoORifiuta,
};
