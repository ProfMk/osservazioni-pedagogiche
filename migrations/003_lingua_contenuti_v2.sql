-- =====================================================================
-- 003_lingua_contenuti_v2.sql — Visual Grammar V2: lingua (C2) e contenuto
-- pedagogico multilingue (B-1…B-7)
--
-- Successiva a 002_audit_append_only.sql e coerente con essa: audit_log non
-- viene toccata; ogni nuova tabella e sequenza riceve ESPLICITAMENTE i
-- privilegi necessari ad app_role (la 002 li ha concessi solo alle tabelle
-- esistenti al momento della sua esecuzione).
--
-- Contenuto:
--   languages                lingue di prodotto (codice BCP 47 + direzione)
--   platform_settings        lingua/regione di piattaforma: usate SOLO prima
--                            della selezione di un tenant attivo (P3)
--   tenant_languages         lingue abilitate per tenant (C2)
--   tenants.*                lingua predefinita, lingua di origine dei
--                            contenuti (B-1), regione di formattazione (C2)
--   memberships.lingua_preferita   preferenza dell'utente per tenant (C2)
--   sessions.lingua          lingua risolta della sessione (C2)
--   catalog_overrides        sovrascritture del catalogo di sistema per
--                            tenant (catena: override -> default prodotto)
--   content_translations     traduzioni dei contenuti pedagogici (B); il
--                            testo nella lingua di origine resta nella
--                            colonna originale della tabella di configurazione
--   activities/observations/assessments: lingua del contenuto d'autore (B)
--
-- Forma tecnica provvisoria (V2 §28: la forma definitiva del catalogo è
-- rinviata). Integrità per tenant con FK composte, come nel resto dello
-- schema (stesso schema a colonne dedicate di role_assignments).
--
-- Dati esistenti: i tenant già presenti ricevono la lingua di piattaforma
-- ('it', l'unica lingua del sistema prima della V2) come lingua abilitata,
-- predefinita e di origine; i contenuti d'autore esistenti ereditano la
-- lingua di origine del proprio tenant.
-- =====================================================================

CREATE TABLE languages (
  codice varchar(20) PRIMARY KEY CHECK (codice ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  direzione varchar(3) NOT NULL CHECK (direzione IN ('ltr', 'rtl'))
);
INSERT INTO languages (codice, direzione) VALUES ('it', 'ltr');

-- Una sola riga (id = true): configurazione di piattaforma, non codice.
CREATE TABLE platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  lingua varchar(20) NOT NULL REFERENCES languages(codice),
  regione varchar(10) NOT NULL CHECK (regione ~ '^[A-Z]{2}$|^[0-9]{3}$')
);
INSERT INTO platform_settings (id, lingua, regione) VALUES (true, 'it', 'IT');

CREATE TABLE tenant_languages (
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  lingua varchar(20) NOT NULL REFERENCES languages(codice),
  PRIMARY KEY (tenant_id, lingua)
);

ALTER TABLE tenants
  ADD COLUMN lingua_predefinita varchar(20),
  ADD COLUMN lingua_contenuti varchar(20) REFERENCES languages(codice),
  ADD COLUMN regione varchar(10) CHECK (regione ~ '^[A-Z]{2}$|^[0-9]{3}$');

INSERT INTO tenant_languages (tenant_id, lingua) SELECT id, 'it' FROM tenants;
UPDATE tenants SET lingua_predefinita = 'it', lingua_contenuti = 'it', regione = 'IT';

ALTER TABLE tenants
  ALTER COLUMN lingua_predefinita SET NOT NULL,
  ALTER COLUMN lingua_contenuti SET NOT NULL,
  ALTER COLUMN regione SET NOT NULL,
  -- La lingua predefinita deve essere una lingua abilitata (C2). Differita: un
  -- tenant e le sue lingue si creano nella stessa transazione.
  ADD CONSTRAINT fk_tenant_lingua_predefinita_abilitata
    FOREIGN KEY (id, lingua_predefinita) REFERENCES tenant_languages(tenant_id, lingua)
    DEFERRABLE INITIALLY DEFERRED;

-- Preferenza per tenant: resta memorizzata anche se la lingua viene disabilitata
-- (in quel caso semplicemente non si applica: C2 "preferenza utente se abilitata").
ALTER TABLE memberships ADD COLUMN lingua_preferita varchar(20) REFERENCES languages(codice);

ALTER TABLE sessions ADD COLUMN lingua varchar(20) REFERENCES languages(codice);

CREATE TABLE catalog_overrides (
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  lingua varchar(20) NOT NULL REFERENCES languages(codice),
  chiave varchar(120) NOT NULL CHECK (chiave ~ '^[A-Z][A-Z0-9_]*$'),
  -- Stringa, oppure oggetto con le categorie plurali della lingua (es. {"one": …, "other": …}).
  valore jsonb NOT NULL CHECK (jsonb_typeof(valore) IN ('string', 'object')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_account_id bigint REFERENCES accounts(id),
  PRIMARY KEY (tenant_id, lingua, chiave)
);

-- Supporto alle FK composte (id, tenant_id) delle traduzioni.
ALTER TABLE subjects ADD CONSTRAINT uq_subjects_id_tenant UNIQUE (id, tenant_id);
ALTER TABLE pedagogical_units ADD CONSTRAINT uq_pedagogical_units_id_tenant UNIQUE (id, tenant_id);
ALTER TABLE criteria ADD CONSTRAINT uq_criteria_id_tenant UNIQUE (id, tenant_id);
ALTER TABLE assessment_periods ADD CONSTRAINT uq_assessment_periods_id_tenant UNIQUE (id, tenant_id);

CREATE TABLE content_translations (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  lingua varchar(20) NOT NULL REFERENCES languages(codice),
  campo varchar(50) NOT NULL CHECK (campo IN (
    'judgment_bands.etichetta', 'observation_scale_values.etichetta', 'observation_scales.nome',
    'subjects.nome', 'pedagogical_units.nome', 'criteria.descrizione', 'school_levels.nome',
    'assessment_periods.nome', 'tenants.nome'
  )),
  judgment_band_id bigint,
  observation_scale_id bigint,
  scale_valore integer,
  subject_id bigint,
  pedagogical_unit_id bigint,
  criterion_id bigint,
  school_level_id bigint,
  assessment_period_id bigint,
  target_tenant_id bigint,
  testo text NOT NULL CHECK (length(btrim(testo)) > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_account_id bigint REFERENCES accounts(id),
  -- Esattamente le colonne di riferimento coerenti con il campo tradotto.
  CONSTRAINT ck_translation_riferimento CHECK (
    ((campo = 'judgment_bands.etichetta') = (judgment_band_id IS NOT NULL))
    AND ((campo IN ('observation_scales.nome', 'observation_scale_values.etichetta')) = (observation_scale_id IS NOT NULL))
    AND ((campo = 'observation_scale_values.etichetta') = (scale_valore IS NOT NULL))
    AND ((campo = 'subjects.nome') = (subject_id IS NOT NULL))
    AND ((campo = 'pedagogical_units.nome') = (pedagogical_unit_id IS NOT NULL))
    AND ((campo = 'criteria.descrizione') = (criterion_id IS NOT NULL))
    AND ((campo = 'school_levels.nome') = (school_level_id IS NOT NULL))
    AND ((campo = 'assessment_periods.nome') = (assessment_period_id IS NOT NULL))
    AND ((campo = 'tenants.nome') = (target_tenant_id IS NOT NULL))
    AND (target_tenant_id IS NULL OR target_tenant_id = tenant_id)
  ),
  FOREIGN KEY (judgment_band_id, tenant_id) REFERENCES judgment_bands(id, tenant_id),
  FOREIGN KEY (observation_scale_id, tenant_id) REFERENCES observation_scales(id, tenant_id),
  FOREIGN KEY (observation_scale_id, scale_valore) REFERENCES observation_scale_values(scale_id, valore),
  FOREIGN KEY (subject_id, tenant_id) REFERENCES subjects(id, tenant_id),
  FOREIGN KEY (pedagogical_unit_id, tenant_id) REFERENCES pedagogical_units(id, tenant_id),
  FOREIGN KEY (criterion_id, tenant_id) REFERENCES criteria(id, tenant_id),
  FOREIGN KEY (school_level_id, tenant_id) REFERENCES school_levels(id, tenant_id),
  FOREIGN KEY (assessment_period_id, tenant_id) REFERENCES assessment_periods(id, tenant_id),
  FOREIGN KEY (target_tenant_id) REFERENCES tenants(id)
);
-- Una sola traduzione per (tenant, lingua, campo, oggetto tradotto).
CREATE UNIQUE INDEX uq_content_translation ON content_translations (
  tenant_id, lingua, campo,
  COALESCE(judgment_band_id, 0), COALESCE(observation_scale_id, 0), COALESCE(scale_valore, -2147483648),
  COALESCE(subject_id, 0), COALESCE(pedagogical_unit_id, 0), COALESCE(criterion_id, 0),
  COALESCE(school_level_id, 0), COALESCE(assessment_period_id, 0), COALESCE(target_tenant_id, 0)
);
-- Motivazione: caricamento di tutte le traduzioni di un tenant in una lingua (una query per richiesta).
CREATE INDEX idx_content_translations_lookup ON content_translations (tenant_id, lingua);

-- Lingua del contenuto d'autore (B): registrata, mai tradotta.
ALTER TABLE activities ADD COLUMN lingua_contenuto varchar(20) REFERENCES languages(codice);
UPDATE activities a SET lingua_contenuto = t.lingua_contenuti FROM tenants t WHERE t.id = a.tenant_id;
ALTER TABLE activities ALTER COLUMN lingua_contenuto SET NOT NULL;

ALTER TABLE assessments ADD COLUMN lingua_contenuto varchar(20) REFERENCES languages(codice);
UPDATE assessments a SET lingua_contenuto = t.lingua_contenuti FROM tenants t WHERE t.id = a.tenant_id;
ALTER TABLE assessments ALTER COLUMN lingua_contenuto SET NOT NULL;

ALTER TABLE observations ADD COLUMN lingua_nota varchar(20) REFERENCES languages(codice);
UPDATE observations o SET lingua_nota = t.lingua_contenuti FROM tenants t WHERE t.id = o.tenant_id AND o.note IS NOT NULL;
ALTER TABLE observations ADD CONSTRAINT ck_observation_lingua_nota CHECK (note IS NULL OR lingua_nota IS NOT NULL);

-- Privilegi espliciti per app_role (la 002 non copre le tabelle create dopo di lei).
-- audit_log resta append-only: qui non viene concesso nulla su di essa.
GRANT SELECT, INSERT, UPDATE, DELETE ON languages, platform_settings, tenant_languages, catalog_overrides, content_translations TO app_role;
GRANT USAGE, SELECT ON SEQUENCE content_translations_id_seq TO app_role;
