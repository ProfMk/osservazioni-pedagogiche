'use strict';

/**
 * Database di prova IN MEMORIA per i test di integrazione, senza alcun
 * PostgreSQL installato.
 *
 * Sostituisce, SOLO nel processo dei test, il modulo `pg` con PGlite
 * (PostgreSQL reale compilato in WebAssembly). Il codice applicativo
 * (server/) non cambia: esegue lo stesso `require('pg')` e le stesse query,
 * su un vero motore PostgreSQL con gli stessi vincoli, trigger, ruoli
 * (CREATE ROLE/GRANT/REVOKE/SET ROLE funzionano davvero, verificato) e
 * codici d'errore.
 *
 * Database disponibili, ricreati da zero a ogni esecuzione:
 *   pglite://completo         schema V1 + ruoli/permessi + audit + lingua/contenuti V2 + seed multi-tenant
 *   pglite://senza-migration  solo schema base (test di regressione sulla migration)
 *   pglite://esteso           come "completo" + seed/seed_esteso.sql (scenari ampi per le viste V2)
 *
 * Limite: una sola sessione per database, quindi nessuna concorrenza reale.
 */

const Module = require('module');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const RADICE = path.resolve(__dirname, '..', '..');

const URL_COMPLETO = 'pglite://completo';
const URL_SENZA_MIGRATION = 'pglite://senza-migration';
const URL_ESTESO = 'pglite://esteso';

const SCRIPT_PER_DATABASE = {
  [URL_COMPLETO]: [
    'migrations/000_schema_base.sql',
    'migrations/001_ruoli_permessi_sistema.sql',
    'migrations/002_audit_append_only.sql',
    'migrations/003_lingua_contenuti_v2.sql',
    'seed/seed_multitenant.sql',
  ],
  [URL_SENZA_MIGRATION]: ['migrations/000_schema_base.sql'],
  [URL_ESTESO]: [
    'migrations/000_schema_base.sql',
    'migrations/001_ruoli_permessi_sistema.sql',
    'migrations/002_audit_append_only.sql',
    'migrations/003_lingua_contenuti_v2.sql',
    'seed/seed_multitenant.sql',
    'seed/seed_esteso.sql',
  ],
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

/**
 * Sottoinsieme dell'interfaccia di pg.Pool usato dal progetto: query,
 * connect/release, end. query() dipende da connect() esattamente come nel
 * vero pg-pool (Pool.prototype.query chiama internamente this.connect(cb)
 * prima di eseguire la query, verificato in node_modules/pg-pool/index.js):
 * questo è ciò che permette a server/db.js di avvolgere pool.connect() e
 * ottenere automaticamente la stessa garanzia anche su pool.query(), sia in
 * produzione sia qui nei test.
 */
class Pool {
  constructor({ connectionString } = {}) {
    this.url = connectionString;
  }

  /** Restituisce un client "grezzo": nessuna inizializzazione qui, esattamente come pg-pool. */
  async connect() {
    // Assicura che schema/migration/seed siano già applicati.
    await apriDatabase(this.url);
    return { query: (testo, parametri) => this._queryDiretta(testo, parametri), release() {} };
  }

  async _queryDiretta(testo, parametri) {
    const risultato = await (await apriDatabase(this.url)).query(testo, parametri || []);
    return { rows: risultato.rows, rowCount: risultato.affectedRows ?? risultato.rows.length, fields: risultato.fields };
  }

  /** Come nel vero pg-pool: ottiene un client via this.connect() (sovrascrivibile da server/db.js) e lo rilascia dopo l'uso. */
  async query(testo, parametri) {
    const client = await this.connect();
    try {
      return await client.query(testo, parametri);
    } finally {
      client.release();
    }
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
function installa({ url = URL_COMPLETO } = {}) {
  const caricaOriginale = Module._load;
  Module._load = function carica(richiesta, ...resto) {
    if (richiesta === 'pg') return pgDiProva;
    return caricaOriginale.call(this, richiesta, ...resto);
  };
  process.env.DATABASE_URL = url;
  if (!process.env.PGTEST_URL_SENZA_MIGRATION) process.env.PGTEST_URL_SENZA_MIGRATION = URL_SENZA_MIGRATION;
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'segreto-di-test-non-usare-in-produzione';
}

module.exports = { installa, URL_COMPLETO, URL_SENZA_MIGRATION, URL_ESTESO };
