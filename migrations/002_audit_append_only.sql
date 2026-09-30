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

-- Il ruolo di connessione (chi esegue questa migration) deve poter fare SET ROLE app_role.
DO $$
BEGIN
  EXECUTE format('GRANT app_role TO %I', current_user);
END $$;

ALTER TABLE audit_log OWNER TO audit_owner;
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
