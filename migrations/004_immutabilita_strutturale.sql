-- =====================================================================
-- 004_immutabilita_strutturale.sql — Immutabilità dei riferimenti
-- strutturali (chiusura V1.1, decisione congelata 2, §3 e §14.2)
--
-- Due regole:
--
--   Regola 1 — immutabili SEMPRE, anche senza righe figlie:
--     tenant_id su ogni tabella tenant-owned (elenco ricavato da
--     information_schema: ogni tabella di public con una colonna tenant_id,
--     esclusa tenants, che non ne ha, ed esclusa audit_log, vedi sotto);
--     school_year_id su subjects, pedagogical_units, criteria, activities,
--     observations, assessments, assessment_periods.
--
--   Regola 2 — immutabili QUANDO esistono righe figlie:
--     teachings          account_id, class_id, subject_id, school_year_id   figli: activities, assessments
--     enrollments        student_person_id, class_id, school_year_id        figli: observations, assessments
--     classes            school_level_id                                    figli: teachings, enrollments
--     subjects           school_level_id                                    figli: pedagogical_units
--     pedagogical_units  subject_id                                         figli: criteria, activities
--     criteria           pedagogical_unit_id                                figli: observations, assessments
--
-- Un cambiamento reale si fa creando un record nuovo, mai riscrivendo il
-- riferimento di uno esistente. enrollments.attiva NON è protetta:
-- disattivare un'iscrizione con osservazioni resta possibile (alunno che
-- lascia la scuola).
--
-- Errore: SQLSTATE 23001 (restrict_violation), messaggio che nomina
-- tabella, riga e motivo; il backend lo traduce in 409
-- ERR_IMMUTABLE_REFERENCE (server/routes/index.js), mai in 500.
--
-- audit_log NON riceve il trigger della Regola 1: è già append-only per
-- privilegi (002: app_role ha solo INSERT e SELECT), quindi nessun UPDATE
-- applicativo può raggiungerla; agganciarvi un trigger richiederebbe inoltre
-- di operare come il suo proprietario separato (audit_owner).
--
-- I trigger sono SECURITY INVOKER: sotto app_role servono solo SELECT sulle
-- tabelle figlie, che app_role ha (002/003).
--
-- Rieseguibile (non esiste un registro delle migration): CREATE OR REPLACE
-- FUNCTION e DROP TRIGGER IF EXISTS + CREATE TRIGGER, in una transazione.
-- =====================================================================

BEGIN;


-- ---------------------------------------------------------------------
-- Regola 1: funzione generica. TG_ARGV = colonne immutabili sempre.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_blocca_modifica_riferimenti_immutabili() RETURNS trigger AS $$
DECLARE
  colonna text;
BEGIN
  FOREACH colonna IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(OLD) -> colonna) IS DISTINCT FROM (to_jsonb(NEW) -> colonna) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'restrict_violation',
        TABLE = TG_TABLE_NAME,
        COLUMN = colonna,
        MESSAGE = format(
          '%s %s: %s è immutabile (Regola 1, sempre). Creare un nuovo record.',
          TG_TABLE_NAME, COALESCE('id ' || (to_jsonb(OLD) ->> 'id'), 'riga ' || OLD::text), colonna
        );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  riga record;
  colonne text[];
BEGIN
  FOR riga IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('tenants', 'audit_log')
    ORDER BY c.table_name
  LOOP
    colonne := CASE
      WHEN riga.table_name IN ('subjects', 'pedagogical_units', 'criteria', 'activities', 'observations', 'assessments', 'assessment_periods')
        THEN ARRAY['tenant_id', 'school_year_id']
      ELSE ARRAY['tenant_id']
    END;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || riga.table_name || '_riferimenti_immutabili', riga.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OF %s ON %I FOR EACH ROW EXECUTE FUNCTION fn_blocca_modifica_riferimenti_immutabili(%s)',
      'trg_' || riga.table_name || '_riferimenti_immutabili',
      (SELECT string_agg(quote_ident(x), ', ') FROM unnest(colonne) AS x),
      riga.table_name,
      (SELECT string_agg(quote_literal(x), ', ') FROM unnest(colonne) AS x)
    );
  END LOOP;
END $$;


-- ---------------------------------------------------------------------
-- Regola 2: una funzione e un trigger per tabella.
-- ---------------------------------------------------------------------

-- teachings: sostituisce la funzione della 000 (che copriva solo class_id,
-- subject_id, school_year_id con figli activities e sollevava P0001).
CREATE OR REPLACE FUNCTION fn_blocca_modifica_struttura_teaching() RETURNS trigger AS $$
DECLARE
  figlio text;
BEGIN
  IF (NEW.account_id, NEW.class_id, NEW.subject_id, NEW.school_year_id)
     IS DISTINCT FROM (OLD.account_id, OLD.class_id, OLD.subject_id, OLD.school_year_id) THEN
    IF EXISTS (SELECT 1 FROM activities WHERE teaching_id = OLD.id) THEN
      figlio := 'activities';
    ELSIF EXISTS (SELECT 1 FROM assessments WHERE teaching_id = OLD.id) THEN
      figlio := 'assessments';
    END IF;
    IF figlio IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'restrict_violation',
        TABLE = 'teachings',
        MESSAGE = format(
          'teachings id %s ha già righe in %s: account_id/class_id/subject_id/school_year_id sono immutabili. Creare un nuovo Teaching.',
          OLD.id, figlio
        );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_teaching_struttura_immutabile ON teachings;
CREATE TRIGGER trg_teaching_struttura_immutabile
BEFORE UPDATE OF account_id, class_id, subject_id, school_year_id ON teachings
FOR EACH ROW EXECUTE FUNCTION fn_blocca_modifica_struttura_teaching();

-- enrollments: attiva resta modificabile (non è tra le colonne del trigger).
CREATE OR REPLACE FUNCTION fn_blocca_modifica_struttura_enrollment() RETURNS trigger AS $$
DECLARE
  figlio text;
BEGIN
  IF (NEW.student_person_id, NEW.class_id, NEW.school_year_id)
     IS DISTINCT FROM (OLD.student_person_id, OLD.class_id, OLD.school_year_id) THEN
    IF EXISTS (SELECT 1 FROM observations WHERE enrollment_id = OLD.id) THEN
      figlio := 'observations';
    ELSIF EXISTS (SELECT 1 FROM assessments WHERE enrollment_id = OLD.id) THEN
      figlio := 'assessments';
    END IF;
    IF figlio IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'restrict_violation',
        TABLE = 'enrollments',
        MESSAGE = format(
          'enrollments id %s ha già righe in %s: student_person_id/class_id/school_year_id sono immutabili. Creare una nuova iscrizione.',
          OLD.id, figlio
        );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enrollment_struttura_immutabile ON enrollments;
CREATE TRIGGER trg_enrollment_struttura_immutabile
BEFORE UPDATE OF student_person_id, class_id, school_year_id ON enrollments
FOR EACH ROW EXECUTE FUNCTION fn_blocca_modifica_struttura_enrollment();

-- classes
CREATE OR REPLACE FUNCTION fn_blocca_modifica_struttura_class() RETURNS trigger AS $$
DECLARE
  figlio text;
BEGIN
  IF NEW.school_level_id IS DISTINCT FROM OLD.school_level_id THEN
    IF EXISTS (SELECT 1 FROM teachings WHERE class_id = OLD.id) THEN
      figlio := 'teachings';
    ELSIF EXISTS (SELECT 1 FROM enrollments WHERE class_id = OLD.id) THEN
      figlio := 'enrollments';
    END IF;
    IF figlio IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'restrict_violation',
        TABLE = 'classes',
        MESSAGE = format(
          'classes id %s ha già righe in %s: school_level_id è immutabile. Creare una nuova classe.',
          OLD.id, figlio
        );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_class_struttura_immutabile ON classes;
CREATE TRIGGER trg_class_struttura_immutabile
BEFORE UPDATE OF school_level_id ON classes
FOR EACH ROW EXECUTE FUNCTION fn_blocca_modifica_struttura_class();

-- subjects
CREATE OR REPLACE FUNCTION fn_blocca_modifica_struttura_subject() RETURNS trigger AS $$
BEGIN
  IF NEW.school_level_id IS DISTINCT FROM OLD.school_level_id
     AND EXISTS (SELECT 1 FROM pedagogical_units WHERE subject_id = OLD.id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'restrict_violation',
      TABLE = 'subjects',
      MESSAGE = format(
        'subjects id %s ha già righe in pedagogical_units: school_level_id è immutabile. Creare una nuova materia.',
        OLD.id
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subject_struttura_immutabile ON subjects;
CREATE TRIGGER trg_subject_struttura_immutabile
BEFORE UPDATE OF school_level_id ON subjects
FOR EACH ROW EXECUTE FUNCTION fn_blocca_modifica_struttura_subject();

-- pedagogical_units
CREATE OR REPLACE FUNCTION fn_blocca_modifica_struttura_pedagogical_unit() RETURNS trigger AS $$
DECLARE
  figlio text;
BEGIN
  IF NEW.subject_id IS DISTINCT FROM OLD.subject_id THEN
    IF EXISTS (SELECT 1 FROM criteria WHERE pedagogical_unit_id = OLD.id) THEN
      figlio := 'criteria';
    ELSIF EXISTS (SELECT 1 FROM activities WHERE pedagogical_unit_id = OLD.id) THEN
      figlio := 'activities';
    END IF;
    IF figlio IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'restrict_violation',
        TABLE = 'pedagogical_units',
        MESSAGE = format(
          'pedagogical_units id %s ha già righe in %s: subject_id è immutabile. Creare un nuovo nucleo.',
          OLD.id, figlio
        );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pedagogical_unit_struttura_immutabile ON pedagogical_units;
CREATE TRIGGER trg_pedagogical_unit_struttura_immutabile
BEFORE UPDATE OF subject_id ON pedagogical_units
FOR EACH ROW EXECUTE FUNCTION fn_blocca_modifica_struttura_pedagogical_unit();

-- criteria
CREATE OR REPLACE FUNCTION fn_blocca_modifica_struttura_criterion() RETURNS trigger AS $$
DECLARE
  figlio text;
BEGIN
  IF NEW.pedagogical_unit_id IS DISTINCT FROM OLD.pedagogical_unit_id THEN
    IF EXISTS (SELECT 1 FROM observations WHERE criterion_id = OLD.id) THEN
      figlio := 'observations';
    ELSIF EXISTS (SELECT 1 FROM assessments WHERE criterion_id = OLD.id) THEN
      figlio := 'assessments';
    END IF;
    IF figlio IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'restrict_violation',
        TABLE = 'criteria',
        MESSAGE = format(
          'criteria id %s ha già righe in %s: pedagogical_unit_id è immutabile. Creare un nuovo criterio.',
          OLD.id, figlio
        );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_criterion_struttura_immutabile ON criteria;
CREATE TRIGGER trg_criterion_struttura_immutabile
BEFORE UPDATE OF pedagogical_unit_id ON criteria
FOR EACH ROW EXECUTE FUNCTION fn_blocca_modifica_struttura_criterion();

COMMIT;
