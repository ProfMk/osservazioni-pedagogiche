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
 *   pglite://completo         schema V1 + ruoli/permessi + audit + seed multi-tenant
 *   pglite://senza-migration  solo schema base (test di regressione sulla migration)
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

const SCRIPT_PER_DATABASE = {
  [URL_COMPLETO]: [
    'migrations/000_schema_base.sql',
    'migrations/001_ruoli_permessi_sistema.sql',
    'migrations/002_audit_append_only.sql',
    'seed/seed_multitenant.sql',
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

/** Sottoinsieme dell'interfaccia di pg.Pool usato dal progetto: query, connect/release, end, on('connect'). */
class Pool {
  constructor({ connectionString } = {}) {
    this.url = connectionString;
    this._onConnect = null;
    this._connectEseguito = false;
  }

  async query(testo, parametri) {
    const risultato = await (await apriDatabase(this.url)).query(testo, parametri || []);
    return { rows: risultato.rows, rowCount: risultato.affectedRows ?? risultato.rows.length, fields: risultato.fields };
  }

  async connect() {
    // Assicura che schema/migration/seed siano già applicati (servono privilegi pieni,
    // prima di eseguire SET ROLE app_role qui sotto).
    await apriDatabase(this.url);
    const client = { query: (testo, parametri) => this.query(testo, parametri), release() {} };
    // PGlite è una sessione unica e condivisa: SET ROLE eseguito una sola volta la prima
    // volta che un client viene "aperto" resta valido per tutta la vita di quella sessione,
    // esattamente come una connessione fisica reale con pg.Pool in produzione.
    if (this._onConnect && !this._connectEseguito) {
      this._connectEseguito = true;
      await this._onConnect(client);
    }
    return client;
  }

  /** Sottoinsieme di EventEmitter usato da server/db.js: solo l'evento 'connect'. */
  on(evento, listener) {
    if (evento === 'connect') this._onConnect = listener;
    return this;
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
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'segreto-di-test-non-usare-in-produzione';
}

module.exports = { installa, URL_COMPLETO, URL_SENZA_MIGRATION };
