'use strict';

const { Pool, types } = require('pg');

// Le colonne bigint (tutti gli "id" dello schema) vengono restituite da `pg`
// come STRINGHE per sicurezza (un bigint può eccedere Number.MAX_SAFE_INTEGER).
// In questa applicazione gli ID sono seriali crescenti, ben al di sotto di
// quel limite: convertirli a numero qui, in un unico punto, evita bug di
// confronto (es. "1" === 1 è falso) in tutto il resto del codice.
types.setTypeParser(20 /* int8/bigint */, (valore) => parseInt(valore, 10));

// La stringa di connessione (host, utente, password del database Neon) viene
// SEMPRE da una variabile d'ambiente, mai scritta nel codice. Questo è
// intenzionale: le credenziali del file Access erano incorporate nella
// connessione ODBC (rischio segnalato nell'analisi, sezione 1.3); qui non
// deve ripetersi lo stesso problema.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Non si tenta un valore di default: è meglio fermarsi in modo esplicito
  // che connettersi per sbaglio al database sbagliato.
  // eslint-disable-next-line no-console
  console.error('Variabile d\'ambiente DATABASE_URL non impostata. Impostarla prima di avviare il server.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: true }, // Neon richiede SSL
});

/** Esegue una query con parametri (mai concatenazione di stringhe: previene SQL injection). */
function query(testo, parametri) {
  return pool.query(testo, parametri);
}

/**
 * Esegue una funzione dentro una transazione. La funzione riceve un client
 * dedicato e deve usarlo per tutte le query della transazione.
 * Se la funzione lancia un errore, viene fatto ROLLBACK automaticamente.
 */
async function transazione(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const risultato = await fn(client);
    await client.query('COMMIT');
    return risultato;
  } catch (errore) {
    await client.query('ROLLBACK');
    throw errore;
  } finally {
    client.release();
  }
}

/**
 * Verifica all'avvio che i vincoli della migration 001 esistano davvero.
 * Senza UNIQUE(attivita_id, iscrizione_id) il salvataggio di qualunque
 * valutazione fallisce con l'errore Postgres 42P10 ("no unique or
 * exclusion constraint matching the ON CONFLICT specification"), che
 * arriva al docente come un generico "Errore interno" senza alcun
 * indizio sulla causa reale. Meglio fermarsi qui, con un messaggio
 * chiaro, che fallire in modo confuso a ogni tentativo di salvataggio.
 */
async function verificaVincoliRichiesti(pool) {
  const { rows } = await pool.query(`
    SELECT
      EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
              WHERE c.relname = 'osservazioni' AND con.contype = 'u'
                AND pg_get_constraintdef(con.oid) ILIKE '%(attivita_id, iscrizione_id)%') AS ha_unique_osservazioni,
      EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
              WHERE c.relname = 'valutazioni_criteri' AND con.contype = 'u'
                AND pg_get_constraintdef(con.oid) ILIKE '%(osservazione_id, criterio_id)%') AS ha_unique_valutazioni
  `);
  const { ha_unique_osservazioni: haOsservazioni, ha_unique_valutazioni: haValutazioni } = rows[0];
  if (!haOsservazioni || !haValutazioni) {
    const mancanti = [
      !haOsservazioni && 'UNIQUE(attivita_id, iscrizione_id) su osservazioni',
      !haValutazioni && 'UNIQUE(osservazione_id, criterio_id) su valutazioni_criteri',
    ].filter(Boolean).join('; ');
    throw new Error(
      `Migration non applicata: manca ${mancanti}. `
      + 'Il salvataggio delle valutazioni non può funzionare senza questo vincolo (errore Postgres 42P10 a ogni tentativo). '
      + 'Eseguire migrations/001_vincoli_osservazioni.sql su questo database prima di avviare il server.'
    );
  }
}

module.exports = { pool, query, transazione, verificaVincoliRichiesti };
