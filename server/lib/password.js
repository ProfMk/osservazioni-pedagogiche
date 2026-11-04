'use strict';

/**
 * Hashing password con Argon2id (sez. 13). Usa @node-rs/argon2 (binding
 * nativi precompilati) invece del pacchetto `argon2` ufficiale: quest'ultimo
 * richiede la compilazione locale (node-gyp + toolchain C++), non
 * disponibile in questo ambiente Windows; @node-rs/argon2 fornisce lo
 * stesso algoritmo (Argon2id, verificato) senza bisogno di compilare nulla.
 *
 * Password temporanee (iterazione 1): generate dal sistema, mostrate una sola
 * volta a chi crea o reimposta l'account, valide GIORNI_VALIDITA_TEMPORANEA
 * giorni, da cambiare al primo accesso. Mai salvate né registrate in chiaro.
 */
const crypto = require('crypto');
const argon2 = require('@node-rs/argon2');
const { datiNonValidi } = require('./erroreApplicativo');

const LUNGHEZZA_MINIMA = 12;
const LUNGHEZZA_MASSIMA = 128;
const LUNGHEZZA_TEMPORANEA = 16;
const GIORNI_VALIDITA_TEMPORANEA = 7;
// Alfabeto senza caratteri ambigui (niente 0 O o 1 l I): 56 simboli, ~92 bit su 16 caratteri.
const ALFABETO_TEMPORANEA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Calcola l'hash Argon2id di una password in chiaro. */
function hashPassword(passwordInChiaro) {
  return argon2.hash(passwordInChiaro);
}

/** true se la password in chiaro corrisponde all'hash salvato. */
function verificaPassword(hash, passwordInChiaro) {
  if (!hash) return Promise.resolve(false);
  return argon2.verify(hash, passwordInChiaro).catch(() => false);
}

/** Password temporanea: LUNGHEZZA_TEMPORANEA caratteri estratti con crypto.randomInt (uniforme, CSPRNG). */
function generaPasswordTemporanea() {
  let risultato = '';
  for (let i = 0; i < LUNGHEZZA_TEMPORANEA; i += 1) {
    risultato += ALFABETO_TEMPORANEA[crypto.randomInt(ALFABETO_TEMPORANEA.length)];
  }
  return risultato;
}

/** Scadenza di una password temporanea generata ora. */
function scadenzaPasswordTemporanea(ora = Date.now()) {
  return new Date(ora + GIORNI_VALIDITA_TEMPORANEA * 24 * 3600 * 1000);
}

/**
 * Regole per una password scelta dall'utente: solo la lunghezza, in caratteri
 * (punti di codice Unicode), tra LUNGHEZZA_MINIMA e LUNGHEZZA_MASSIMA; nessuna
 * altra regola di composizione.
 */
function validaPasswordNuova(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw datiNonValidi('ERR_REQUIRED_FIELD', { campo: 'UI_FIELD_PASSWORD_NEW' });
  }
  const lunghezza = Array.from(password).length;
  if (lunghezza < LUNGHEZZA_MINIMA) throw datiNonValidi('ERR_PASSWORD_TOO_SHORT', { minimo: LUNGHEZZA_MINIMA });
  if (lunghezza > LUNGHEZZA_MASSIMA) throw datiNonValidi('ERR_PASSWORD_TOO_LONG', { massimo: LUNGHEZZA_MASSIMA });
}

module.exports = {
  hashPassword,
  verificaPassword,
  generaPasswordTemporanea,
  scadenzaPasswordTemporanea,
  validaPasswordNuova,
  LUNGHEZZA_MINIMA,
  LUNGHEZZA_MASSIMA,
  LUNGHEZZA_TEMPORANEA,
  GIORNI_VALIDITA_TEMPORANEA,
  ALFABETO_TEMPORANEA,
};
