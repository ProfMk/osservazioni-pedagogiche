'use strict';

/**
 * Database di prova IN MEMORIA per i test di integrazione, senza alcun
 * PostgreSQL installato.
 *
 * Sostituisce, SOLO nel processo dei test, il modulo `pg` con PGlite
 * (PostgreSQL reale compilato in WebAssembly). Il codice applicativo
 * (server/) non cambia: esegue lo stesso `require('pg')` e le stesse query,
 * su un vero motore PostgreSQL con gli stessi vincoli, CHECK e codici
 * d'errore.
 *
 * Database disponibili, ricreati da zero a ogni esecuzione:
 *   pglite://completo         schema base + migration 001 + seed + dati di prova dei test
 *   pglite://senza-migration  solo schema base (test di regressione sulla migration 001)
 *
 * Limite: una sola sessione per database, quindi nessuna concorrenza reale.
 * Il test di concorrenza (Caso I) richiede un PostgreSQL vero (PGTEST_URL).
 */

const Module = require('module');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const RADICE = path.resolve(__dirname, '..', '..');

const URL_COMPLETO = 'pglite://completo';
const URL_SENZA_MIGRATION = 'pglite://senza-migration';

const SCRIPT_PER_DATABASE = {
  [URL_COMPLETO]: [
    'migrations/000_schema_base.sql',
    'migrations/001_vincoli_osservazioni.sql',
    'seed/dati_esempio_matematica.sql',
    'tests/dati_di_prova.sql',
  ],
  [URL_SENZA_MIGRATION]: ['migrations/000_schema_base.sql'],
};

// Parser di tipo registrati dal codice applicativo (server/db.js converte i bigint in numeri).
const parserDiTipo = {};
const istanze = new Map();

function apriDatabase(url) {
  if (!istanze.has(url)) {
    const script = SCRIPT_PER_DATABASE[url];
    if (!script) throw new Error(`Database di prova sconosciuto: ${url}`);
    istanze.set(url, (async () => {
      const db = await PGlite.create({ parsers: parserDiTipo });
      for (const file of script) {
        await db.exec(fs.readFileSync(path.join(RADICE, file), 'utf8'));
      }
      return db;
    })());
  }
  return istanze.get(url);
}

/** Sottoinsieme dell'interfaccia di pg.Pool usato dal progetto: query, connect/release, end. */
class Pool {
  constructor({ connectionString } = {}) {
    this.url = connectionString;
  }

  async query(testo, parametri) {
    const risultato = await (await apriDatabase(this.url)).query(testo, parametri || []);
    return { rows: risultato.rows, rowCount: risultato.affectedRows ?? risultato.rows.length, fields: risultato.fields };
  }

  async connect() {
    // Unica sessione: il "client" è il database stesso.
    return { query: (testo, parametri) => this.query(testo, parametri), release() {} };
  }

  async end() {
    const aperta = istanze.get(this.url);
    istanze.delete(this.url);
    if (aperta) await (await aperta).close();
  }
}

const pgDiProva = {
  Pool,
  Client: Pool,
  types: { setTypeParser(oid, parser) { parserDiTipo[oid] = parser; } },
};

/**
 * Installa il modulo `pg` di prova e imposta le variabili d'ambiente dei test.
 * Va chiamata PRIMA di richiedere server/db.js.
 */
function installa() {
  const caricaOriginale = Module._load;
  Module._load = function carica(richiesta, ...resto) {
    if (richiesta === 'pg') return pgDiProva;
    return caricaOriginale.call(this, richiesta, ...resto);
  };
  process.env.DATABASE_URL = URL_COMPLETO;
  if (!process.env.PGTEST_URL_SENZA_MIGRATION) process.env.PGTEST_URL_SENZA_MIGRATION = URL_SENZA_MIGRATION;
}

module.exports = { installa, URL_COMPLETO, URL_SENZA_MIGRATION };
