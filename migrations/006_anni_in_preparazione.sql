-- =====================================================================
-- 006_anni_in_preparazione.sql — Anni scolastici «in preparazione»
-- (iterazione 2, passo A: amministrazione dell'istituto)
--
-- Contenuto:
--   school_years.stato           CHECK esteso: 'attivo', 'in_preparazione',
--                                'chiuso'. Il vincolo esistente (della 000,
--                                nome generato da PostgreSQL) si trova in
--                                pg_constraint, non si assume il nome.
--                                Il DEFAULT resta 'attivo' (seed e dati
--                                esistenti); un anno creato dall'interfaccia
--                                nasce sempre 'in_preparazione' (server).
--   uq_school_years_un_attivo            al più UN anno 'attivo' per tenant
--   uq_school_years_una_preparazione     al più UN anno 'in_preparazione'
--                                        per tenant
--
-- Controllo preventivo: se un tenant ha già più di un anno 'attivo', la
-- migration si ferma con un messaggio chiaro e non applica nulla (stessa
-- forma della 005).
--
-- Privilegi: nessuna tabella nuova; app_role ha già i privilegi di tabella
-- su school_years (002).
--
-- Rieseguibile (non esiste un registro delle migration): il CHECK sullo
-- stato si elimina e si ricrea (anche quello di una esecuzione precedente),
-- CREATE UNIQUE INDEX IF NOT EXISTS, tutto in una transazione.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  tenant_doppi integer;
BEGIN
  SELECT count(*) INTO tenant_doppi
  FROM (SELECT tenant_id FROM school_years WHERE stato = 'attivo' GROUP BY tenant_id HAVING count(*) > 1) AS doppi;
  IF tenant_doppi > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'unique_violation',
      MESSAGE = format('006: %s tenant con più di un anno scolastico attivo. Migration annullata: nessuna modifica applicata.', tenant_doppi),
      HINT = 'Elencarli con: SELECT tenant_id, array_agg(id ORDER BY data_inizio) FROM school_years WHERE stato = ''attivo'' GROUP BY tenant_id HAVING count(*) > 1; chiudere gli anni in più (stato = ''chiuso''), poi rieseguire la 006.';
  END IF;
END $$;

-- CHECK sullo stato: ogni vincolo CHECK di school_years che riguarda la colonna stato
-- (in pratica: quello della 000, o quello di una esecuzione precedente della 006).
DO $$
DECLARE
  vincolo record;
BEGIN
  FOR vincolo IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.school_years'::regclass
      AND c.contype = 'c'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) AND a.attname = 'stato'
      )
  LOOP
    EXECUTE format('ALTER TABLE school_years DROP CONSTRAINT %I', vincolo.conname);
  END LOOP;
END $$;

ALTER TABLE school_years
  ADD CONSTRAINT ck_school_years_stato CHECK (stato IN ('attivo', 'in_preparazione', 'chiuso'));

-- Motivazione: un solo anno su cui i docenti scrivono, un solo anno nuovo in preparazione.
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_years_un_attivo
  ON school_years (tenant_id) WHERE stato = 'attivo';
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_years_una_preparazione
  ON school_years (tenant_id) WHERE stato = 'in_preparazione';

COMMIT;
