-- =====================================================================
-- 001_vincoli_osservazioni.sql
--
-- Migration "sicura": aggiunge solo i vincoli mancanti individuati
-- nell'analisi (UNIQUE su osservazioni, CHECK sul punteggio, 2 FK).
--
-- REGOLA: ogni blocco VERIFICA PRIMA se il vincolo serve ed è sicuro da
-- aggiungere (nessun duplicato, nessun valore incompatibile). Se non è
-- sicuro, SOLLEVA UN ERRORE ESPLICITO e NON tocca lo schema né i dati:
-- l'esecuzione si ferma, non cancella e non modifica righe.
--
-- Nessun DROP, nessun DELETE, nessuna riscrittura di dati esistenti.
-- Eseguire una sola volta; è comunque sicuro rieseguirla (idempotente):
-- se un vincolo esiste già, il blocco lo salta senza errori.
--
-- USO CONSIGLIATO:
--   1) eseguire prima verifica_schema_e_dati.sql (sezione 14) su Neon;
--   2) se segnala duplicati o valori fuori scala, risolverli (a mano,
--      con una decisione esplicita su quale riga tenere: questa
--      migration non lo decide da sola);
--   3) solo allora eseguire questo file su Neon, dentro una transazione
--      (psql lo fa già per un intero file da riga di comando: se un
--      blocco fallisce, nulla viene applicato).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) UNIQUE (attivita_id, iscrizione_id) su osservazioni
--    Richiesto dal piano: una sola osservazione per alunno e attività.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n_duplicati integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relname = 'osservazioni' AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid) ILIKE '%(attivita_id, iscrizione_id)%'
  ) THEN
    RAISE NOTICE 'Vincolo UNIQUE(attivita_id, iscrizione_id) già presente: nessuna azione.';
  ELSE
    SELECT COUNT(*) INTO n_duplicati FROM (
      SELECT 1 FROM osservazioni GROUP BY attivita_id, iscrizione_id HAVING COUNT(*) > 1
    ) x;
    IF n_duplicati > 0 THEN
      RAISE EXCEPTION 'MIGRATION INTERROTTA: % coppie (attivita_id, iscrizione_id) duplicate in osservazioni. '
        'Risolverle prima (vedi blocco 7.2 di verifica_schema_e_dati.sql), poi rieseguire questa migration. '
        'Nessuna modifica è stata applicata.', n_duplicati;
    ELSE
      ALTER TABLE osservazioni
        ADD CONSTRAINT uq_osservazione_attivita_iscrizione UNIQUE (attivita_id, iscrizione_id);
      RAISE NOTICE 'Vincolo UNIQUE(attivita_id, iscrizione_id) aggiunto.';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2) CHECK (punteggio IN (0,1,2)) su valutazioni_criteri
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n_anomale integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relname = 'valutazioni_criteri' AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%punteggio%'
  ) THEN
    RAISE NOTICE 'Un CHECK su punteggio esiste già: nessuna azione (verificarne il contenuto a parte).';
  ELSE
    SELECT COUNT(*) INTO n_anomale FROM valutazioni_criteri WHERE punteggio IS NULL OR punteggio NOT IN (0,1,2);
    IF n_anomale > 0 THEN
      RAISE EXCEPTION 'MIGRATION INTERROTTA: % righe in valutazioni_criteri hanno punteggio NULL o fuori da {0,1,2}. '
        'Correggerle prima (vedi blocco 6.3 di verifica_schema_e_dati.sql), poi rieseguire questa migration. '
        'Nessuna modifica è stata applicata.', n_anomale;
    ELSE
      ALTER TABLE valutazioni_criteri
        ADD CONSTRAINT ck_valutazioni_punteggio CHECK (punteggio IN (0, 1, 2));
      RAISE NOTICE 'Vincolo CHECK(punteggio IN (0,1,2)) aggiunto.';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3) FK valutazioni_criteri.criterio_id -> criteri_osservazione.id
--    (mancante secondo l'analisi dei metadati Access; verificare qui)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n_orfane integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relname = 'valutazioni_criteri' AND con.contype = 'f'
      AND con.confrelid = 'criteri_osservazione'::regclass
  ) THEN
    RAISE NOTICE 'FK valutazioni_criteri.criterio_id -> criteri_osservazione già presente: nessuna azione.';
  ELSE
    SELECT COUNT(*) INTO n_orfane FROM valutazioni_criteri v
      WHERE NOT EXISTS (SELECT 1 FROM criteri_osservazione c WHERE c.id = v.criterio_id);
    IF n_orfane > 0 THEN
      RAISE EXCEPTION 'MIGRATION INTERROTTA: % righe in valutazioni_criteri puntano a un criterio_id inesistente. '
        'Nessuna modifica è stata applicata.', n_orfane;
    ELSE
      ALTER TABLE valutazioni_criteri
        ADD FOREIGN KEY (criterio_id) REFERENCES criteri_osservazione(id);
      RAISE NOTICE 'FK valutazioni_criteri.criterio_id -> criteri_osservazione.id aggiunta.';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4) FK osservazioni.docente_id -> persone.id (mancante secondo l'analisi)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n_orfane integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relname = 'osservazioni' AND con.contype = 'f'
      AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'osservazioni'::regclass AND attname = 'docente_id')]
  ) THEN
    RAISE NOTICE 'FK osservazioni.docente_id -> persone già presente: nessuna azione.';
  ELSE
    SELECT COUNT(*) INTO n_orfane FROM osservazioni o
      WHERE NOT EXISTS (SELECT 1 FROM persone p WHERE p.id = o.docente_id);
    IF n_orfane > 0 THEN
      RAISE EXCEPTION 'MIGRATION INTERROTTA: % righe in osservazioni hanno docente_id inesistente. '
        'Nessuna modifica è stata applicata.', n_orfane;
    ELSE
      ALTER TABLE osservazioni ADD FOREIGN KEY (docente_id) REFERENCES persone(id);
      RAISE NOTICE 'FK osservazioni.docente_id -> persone.id aggiunta.';
    END IF;
  END IF;
END $$;

-- Nota: NON aggiungo qui il vincolo UNIQUE(nucleo_tematico_id, nome) su
-- criteri_osservazione (decisione D7, sezione 9.1 dell'analisi: ancora
-- da confermare) né alcuna modifica legata alla multi-tenancy (sezione 10):
-- non richiesti/decisi esplicitamente, quindi non li applico qui.

COMMIT;

-- Verifica finale: elenca i 4 vincoli sopra, per conferma visiva dopo l'esecuzione.
SELECT c.relname AS tabella, con.conname AS vincolo,
       CASE con.contype WHEN 'u' THEN 'UNIQUE' WHEN 'c' THEN 'CHECK' WHEN 'f' THEN 'FOREIGN KEY' END AS tipo
FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE con.conname IN ('uq_osservazione_attivita_iscrizione', 'ck_valutazioni_punteggio')
   OR (c.relname = 'valutazioni_criteri' AND con.contype = 'f' AND con.confrelid = 'criteri_osservazione'::regclass)
   OR (c.relname = 'osservazioni' AND con.contype = 'f' AND con.confrelid = 'persone'::regclass AND con.conname LIKE '%docente%')
ORDER BY 1, 2;
