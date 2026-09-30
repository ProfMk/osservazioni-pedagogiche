'use strict';

const { Pool, types } = require('pg');

// Le colonne bigint (tutti gli "id" dello schema) vengono restituite da `pg`
// come STRINGHE per sicurezza (un bigint può eccedere Number.MAX_SAFE_INTEGER).
// In questa applicazione gli ID sono seriali crescenti, ben al di sotto di
// quel limite: convertirli a numero qui, in un unico punto, evita bug di
// confronto (es. "1" === 1 è falso) in tutto il resto del codice.
types.setTypeParser(20 /* int8/bigint */, (valore) => parseInt(valore, 10));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // eslint-disable-next-line no-console
  console.error('Variabile d\'ambiente DATABASE_URL non impostata. Impostarla prima di avviare il server.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: true },
});

// Isolamento dei privilegi (sez. 41): l'applicazione non opera MAI con
// l'identità piena del ruolo di connessione (quello di DATABASE_URL), ma
// sempre come app_role, a cui 002_audit_append_only.sql concede INSERT e
// SELECT su audit_log ma non UPDATE/DELETE. SET ROLE è applicato a OGNI
// nuova connessione fisica del pool (evento 'connect'), quindi copre anche
// le connessioni aperte più tardi sotto carico.
pool.on('connect', (client) => {
  client.query('SET ROLE app_role').catch((errore) => {
    // eslint-disable-next-line no-console
    console.error('Impossibile impostare app_role sulla connessione:', errore.message);
  });
});

/** Esegue una query con parametri (mai concatenazione di stringhe: previene SQL injection). */
function query(testo, parametri) {
  return pool.query(testo, parametri);
}

/**
 * Esegue una funzione dentro una transazione. La funzione riceve un client
 * dedicato e deve usarlo per tutte le query della transazione.
 * Se la funzione lancia un errore, viene fatto ROLLBACK automaticamente.
 * Audit transazionale (sez. 42): chi chiama transazione() e scrive anche
 * nell'audit_log con lo stesso client ottiene automaticamente "modifica e
 * audit nella stessa transazione, o nessuno dei due".
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
 * Verifica all'avvio che lo schema V1 (multi-tenant) sia stato applicato:
 * tabelle chiave presenti e ruolo applicativo app_role configurato. Senza
 * questo controllo, un database non migrato fallirebbe in modo confuso al
 * primo login invece che con un messaggio chiaro all'avvio.
 */
async function verificaVincoliRichiesti(pool) {
  const { rows } = await pool.query(`
    SELECT
      to_regclass('public.tenants') IS NOT NULL AS ha_tenants,
      to_regclass('public.role_assignments') IS NOT NULL AS ha_role_assignments,
      to_regclass('public.sessions') IS NOT NULL AS ha_sessions,
      to_regclass('public.audit_log') IS NOT NULL AS ha_audit_log,
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') AS ha_app_role
  `);
  const stato = rows[0];
  const mancanti = [
    !stato.ha_tenants && 'tabella tenants',
    !stato.ha_role_assignments && 'tabella role_assignments',
    !stato.ha_sessions && 'tabella sessions',
    !stato.ha_audit_log && 'tabella audit_log',
    !stato.ha_app_role && 'ruolo app_role (002_audit_append_only.sql)',
  ].filter(Boolean);
  if (mancanti.length > 0) {
    throw new Error(
      `Migration non applicata: manca ${mancanti.join('; ')}. `
      + 'Eseguire tutte le migration in migrations/ (in ordine numerico) su questo database prima di avviare il server.'
    );
  }
}

module.exports = { pool, query, transazione, verificaVincoliRichiesti };
