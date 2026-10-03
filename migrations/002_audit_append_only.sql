-- =====================================================================
-- 002_audit_append_only.sql
--
-- Isolamento dei privilegi (sez. 41): audit_log deve essere realmente
-- append-only per l'applicazione, non per convenzione. Non ci si affida
-- solo a un REVOKE se il ruolo applicativo è owner della tabella: qui
-- audit_log passa a un owner SEPARATO (audit_owner), e il ruolo con cui
-- l'applicazione opera davvero (app_role) riceve solo INSERT e SELECT.
--
-- Il ruolo con cui ci si connette (quello di DATABASE_URL, es. l'owner
-- assegnato da Neon) NON deve operare come se stesso: server/db.js esegue
-- SET ROLE app_role subito dopo la connessione, per OGNI connessione del
-- pool, così ogni query dell'applicazione (comprese eventuali query scritte
-- male o iniettate) è vincolata dai privilegi di app_role, non da quelli,
-- più ampi, del ruolo di connessione. GRANT app_role TO CURRENT_USER rende
-- possibile quel SET ROLE indipendentemente da quale sia il ruolo di
-- connessione in un dato ambiente (locale, test, Neon).
--
-- Idempotente: rieseguibile senza errori (CREATE ROLE è protetto da un
-- controllo su pg_roles, dato che PostgreSQL non supporta
-- "CREATE ROLE IF NOT EXISTS").
--
-- ALTER TABLE ... OWNER TO (sotto) ha due prerequisiti documentati da
-- PostgreSQL, verificati empiricamente prima di scrivere questo file:
--   1) chi esegue l'ALTER deve essere membro (diretto o indiretto) del
--      NUOVO proprietario. Avere CREATEROLE, e persino aver creato tu
--      stesso quel ruolo con CREATE ROLE, NON t'iscrive automaticamente
--      come membro (confermato: senza il GRANT esplicito sotto, l'ALTER
--      fallisce con "must be able to SET ROLE audit_owner").
--   2) il NUOVO proprietario deve avere CREATE sullo schema della tabella
--      (stesso motivo per cui serve il 1: l'operazione non deve permettere
--      nulla che non si potrebbe ottenere droppando e ricreando la tabella).
-- Su un ruolo di connessione non-superuser (es. neondb_owner di Neon),
-- nessuna delle due condizioni vale di default: senza questa correzione
-- l'ALTER TABLE fallisce silenziosamente (e, se l'intero file viene
-- eseguito come una singola transazione da un client, fa fallire anche
-- tutti i GRANT successivi, lasciando app_role senza alcun privilegio).
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_owner') THEN
    CREATE ROLE audit_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role NOLOGIN;
  END IF;
END $$;

-- Il ruolo di connessione (chi esegue questa migration) deve poter fare SET
-- ROLE app_role (permanentemente, sez. 41) e deve essere membro di
-- audit_owner (permanentemente: è l'identità già pienamente fidata che
-- amministra il database, non l'applicazione — vedi nota su "bypass" più
-- sotto — mantenerla membro non indebolisce l'append-only per app_role).
DO $$
BEGIN
  EXECUTE format('GRANT app_role TO %I', current_user);
  EXECUTE format('GRANT audit_owner TO %I', current_user);
END $$;

-- CREATE sullo schema concesso ad audit_owner SOLO per la durata di questo
-- ALTER (prerequisito 2 sopra), poi revocato subito: l'unico compito
-- permanente di audit_owner è possedere audit_log, nessun privilegio a
-- livello di schema deve restargli (least privilege).
GRANT CREATE ON SCHEMA public TO audit_owner;
ALTER TABLE audit_log OWNER TO audit_owner;
REVOKE CREATE ON SCHEMA public FROM audit_owner;

REVOKE ALL ON audit_log FROM PUBLIC;
GRANT INSERT, SELECT ON audit_log TO app_role;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO app_role;

-- app_role opera con pieno CRUD su tutte le altre tabelle applicative:
-- rappresenta "l'applicazione", non un ruolo con meno privilegi del
-- necessario altrove — la restrizione riguarda SOLO audit_log.
DO $$
DECLARE
  riga record;
BEGIN
  FOR riga IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'audit_log'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_role', riga.tablename);
  END LOOP;
  FOR riga IN
    SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' AND sequencename <> 'audit_log_id_seq'
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO app_role', riga.sequencename);
  END LOOP;
END $$;
