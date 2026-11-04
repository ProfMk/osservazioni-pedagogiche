-- =====================================================================
-- 005_account_primo_accesso.sql — Primo accesso con password temporanea
-- (iterazione 1: creazione di una scuola e del suo primo amministratore)
--
-- Contenuto:
--   accounts.deve_cambiare_password        obbligo di cambio al prossimo
--                                          accesso (password temporanea).
--                                          Colonna esplicita, NON dedotta da
--                                          password_changed_at IS NULL: gli
--                                          account esistenti (seed, Neon)
--                                          hanno quella colonna a NULL e non
--                                          devono essere bloccati.
--   accounts.password_temporanea_scade_il  scadenza della password
--                                          temporanea (7 giorni dalla
--                                          generazione); NULL per una
--                                          password scelta dall'utente.
--   uq_accounts_email_lower                unicità dell'email ignorando le
--                                          maiuscole. Prima di crearlo si
--                                          cercano i doppioni: se ce ne sono,
--                                          la migration si ferma con un
--                                          messaggio chiaro (nessun indice,
--                                          nessuna colonna: tutto annullato).
--
-- Privilegi: app_role ha SELECT/INSERT/UPDATE/DELETE a livello di TABELLA
-- su accounts (002), che comprendono anche le colonne aggiunte dopo: nessun
-- GRANT ulteriore (verificato dai test con has_column_privilege).
--
-- Rieseguibile (non esiste un registro delle migration): ADD COLUMN IF NOT
-- EXISTS e CREATE UNIQUE INDEX IF NOT EXISTS, in una transazione.
-- =====================================================================

BEGIN;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS deve_cambiare_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_temporanea_scade_il timestamptz;

-- Controllo dei doppioni prima dell'indice: un messaggio leggibile invece
-- dell'errore generico di CREATE UNIQUE INDEX.
DO $$
DECLARE
  gruppi integer;
BEGIN
  SELECT count(*) INTO gruppi
  FROM (SELECT lower(email) FROM accounts GROUP BY lower(email) HAVING count(*) > 1) AS doppi;
  IF gruppi > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'unique_violation',
      MESSAGE = format('005: %s gruppi di account con la stessa email a meno delle maiuscole. Migration annullata: nessuna modifica applicata.', gruppi),
      HINT = 'Elencarli con: SELECT lower(email), array_agg(id ORDER BY id) FROM accounts GROUP BY lower(email) HAVING count(*) > 1; risolverli, poi rieseguire la 005.';
  END IF;
END $$;

-- Motivazione: login e creazione degli amministratori cercano per lower(email);
-- l'indice garantisce anche l'unicità senza distinzione di maiuscole.
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_email_lower ON accounts (lower(email));

COMMIT;
