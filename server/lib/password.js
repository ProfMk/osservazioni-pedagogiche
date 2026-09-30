'use strict';

/**
 * Hashing password con Argon2id (sez. 13). Usa @node-rs/argon2 (binding
 * nativi precompilati) invece del pacchetto `argon2` ufficiale: quest'ultimo
 * richiede la compilazione locale (node-gyp + toolchain C++), non
 * disponibile in questo ambiente Windows; @node-rs/argon2 fornisce lo
 * stesso algoritmo (Argon2id, verificato) senza bisogno di compilare nulla.
 */
const argon2 = require('@node-rs/argon2');

/** Calcola l'hash Argon2id di una password in chiaro. */
function hashPassword(passwordInChiaro) {
  return argon2.hash(passwordInChiaro);
}

/** true se la password in chiaro corrisponde all'hash salvato. */
function verificaPassword(hash, passwordInChiaro) {
  if (!hash) return Promise.resolve(false);
  return argon2.verify(hash, passwordInChiaro).catch(() => false);
}

module.exports = { hashPassword, verificaPassword };
