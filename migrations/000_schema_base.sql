-- =====================================================================
-- 000_schema_base.sql — V1 multi-tenant / multi-utente
--
-- SOSTITUISCE INTEGRALMENTE lo schema mono-tenant del prototipo (persone/
-- ruoli/insegnamenti/iscrizioni/attivita/osservazioni/valutazioni_criteri
-- senza tenant, senza sessione, senza RBAC). Il vecchio schema è superato:
-- questo file non tenta una migrazione incrementale di dati reali, perché
-- non ne esistono (progetto ancora in fase di prototipo, mai eseguito su
-- Neon con dati veri — vedi README).
--
-- Principio architetturale (due assi distinti):
--
--   IDENTITY -> ACCOUNT -> MEMBERSHIP -> TENANT -> ROLE ASSIGNMENT -> SCOPE -> PERMISSION -> RESOURCE
--   TENANT -> SCHOOL LEVEL -> SCHOOL YEAR -> SUBJECT -> PEDAGOGICAL UNIT -> CRITERION
--   che converge nel dominio operativo: CLASS -> ENROLLMENT -> TEACHING -> ACTIVITY -> OBSERVATION -> ASSESSMENT
--
-- Integrità cross-tenant / cross-year / cross-class: quasi ovunque tramite
-- FOREIGN KEY composte (preferite ai trigger, come richiesto). La tecnica
-- usata sistematicamente: ogni tabella "figlia" porta denormalizzate le
-- colonne di ambito (tenant_id, school_year_id, e talvolta class_id o
-- subject_id) e dichiara una FK composta verso CIASCUN genitore su quelle
-- stesse colonne. Se due genitori diversi vincolano la STESSA colonna
-- condivisa (es. class_id su observations, vincolato sia da activities sia
-- da enrollments), il database forza per costruzione che i due genitori
-- concordino, senza bisogno di un trigger cross-row.
--
-- Trigger applicativi usati SOLO dove una FK non può bastare (motivati
-- singolarmente in loco): un solo caso reale in questo schema (immutabilità
-- strutturale di un Teaching già usato da Activity).
-- =====================================================================


-- =====================================================================
-- SEZIONE 1 — TENANT
-- =====================================================================

CREATE TABLE tenants (
  id bigserial PRIMARY KEY,
  slug varchar(60) NOT NULL UNIQUE,
  nome varchar(200) NOT NULL,
  stato varchar(20) NOT NULL DEFAULT 'attivo' CHECK (stato IN ('attivo', 'sospeso')),
  created_at timestamptz NOT NULL DEFAULT now()
);


-- =====================================================================
-- SEZIONE 2 — IDENTITY: PERSON, ACCOUNT, MEMBERSHIP, SESSION
--
-- Person è l'anagrafica di un essere umano. Non richiede un Account (uno
-- studente non ha mai un Account in V1). tenant_id è NULL quando la persona
-- rappresenta l'identità "globale" di un Account (docente/staff/platform
-- admin: lo stesso essere umano può avere Membership in più tenant, ma è
-- una sola persona); è NOT NULL quando la persona è uno studente, di
-- proprietà di un tenant specifico (non ha login).
-- =====================================================================

CREATE TABLE people (
  id bigserial PRIMARY KEY,
  tenant_id bigint REFERENCES tenants(id),
  nome varchar(100) NOT NULL,
  cognome varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
-- Motivazione: le liste di studenti sono sempre filtrate per tenant (mai globali).
CREATE INDEX idx_people_tenant ON people(tenant_id);

-- Account è l'identità di piattaforma che può autenticarsi. Un Account può
-- avere più Membership (uno per tenant) ma una sola Person (la sua identità
-- reale, sez. 6: "non assumere Account = Person" — sono tabelle distinte
-- anche quando la relazione è 1:1).
CREATE TABLE accounts (
  id bigserial PRIMARY KEY,
  email varchar(255) NOT NULL UNIQUE,
  password_hash text,
  person_id bigint NOT NULL UNIQUE REFERENCES people(id),
  stato varchar(20) NOT NULL DEFAULT 'attivo' CHECK (stato IN ('attivo', 'disabilitato')),
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Membership: l'appartenenza di un Account a un Tenant. PLATFORM_ADMIN non
-- ha bisogno di alcuna Membership (sez. 7): il suo scope è PLATFORM, non
-- una finta appartenenza a un tenant.
CREATE TABLE memberships (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id),
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  stato varchar(20) NOT NULL DEFAULT 'attiva' CHECK (stato IN ('attiva', 'sospesa')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, tenant_id)
);
-- Motivazione: risoluzione "a quali tenant appartiene questo account" a ogni login/switch.
CREATE INDEX idx_memberships_account ON memberships(account_id);
-- Motivazione: elenco membri di un tenant (gestione utenti tenant admin).
CREATE INDEX idx_memberships_tenant ON memberships(tenant_id);

-- Sessione server-side (sez. 10/11). Il browser riceve solo un token opaco;
-- qui si salva SOLO il suo hash (SHA-256), mai il token in chiaro.
-- active_tenant_id: per utenti normali deve corrispondere a una Membership
-- valida (verificato dall'applicazione, non dal database: un PLATFORM_ADMIN
-- può impostare come attivo qualunque tenant, sez. 9).
CREATE TABLE sessions (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id),
  token_hash char(64) NOT NULL UNIQUE,
  active_tenant_id bigint REFERENCES tenants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason varchar(100),
  user_agent text,
  ip varchar(64)
);
-- Motivazione: revoca/elenco sessioni di un account (logout ovunque, cambio password).
CREATE INDEX idx_sessions_account ON sessions(account_id);
-- Motivazione: pulizia periodica delle sessioni scadute/revocate.
CREATE INDEX idx_sessions_expires ON sessions(expires_at);


-- =====================================================================
-- SEZIONE 3 — RBAC: ROLE, PERMISSION, ROLE_ASSIGNMENT (grant-only)
--
-- Ruoli e permessi sono di SISTEMA (non configurabili dal tenant, sez. 15).
-- Popolati da 001_ruoli_permessi_sistema.sql, non qui.
-- Un RoleAssignment concede un Role in uno scope preciso. Lo scope è
-- rappresentato da colonne dedicate (non un scope_id polimorfico): ciascuna
-- ha una FK reale verso la propria tabella, quindi l'integrità è garantita
-- dal database senza bisogno di un trigger per validare "a cosa punta
-- scope_id secondo scope_type".
-- =====================================================================

CREATE TABLE roles (
  id bigserial PRIMARY KEY,
  codice varchar(50) NOT NULL UNIQUE,
  nome varchar(100) NOT NULL,
  is_system boolean NOT NULL DEFAULT true
);

CREATE TABLE permissions (
  id bigserial PRIMARY KEY,
  codice varchar(100) NOT NULL UNIQUE,
  descrizione text NOT NULL
);

CREATE TABLE role_permissions (
  role_id bigint NOT NULL REFERENCES roles(id),
  permission_id bigint NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

-- role_assignments è creata più avanti in questo file (dopo school_levels,
-- classes, teachings, people), perché le sue FK di scope puntano a quelle
-- tabelle: l'ordine fisico delle CREATE TABLE segue le dipendenze reali,
-- non l'ordine concettuale delle sezioni.


-- =====================================================================
-- SEZIONE 4 — CONFIGURAZIONE PEDAGOGICA (tenant-owned, storica per anno)
--
-- SchoolLevel: struttura stabile del tenant (sez. 19): NON versionata per
-- anno scolastico ("Primaria 2025", "Primaria 2026" NON sono livelli
-- diversi).
-- SchoolYear: dimensione temporale del dominio (sez. 20): la configurazione
-- pedagogica (Subject/PedagogicalUnit/Criterion) è versionata per anno.
-- =====================================================================

CREATE TABLE school_levels (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  nome varchar(100) NOT NULL,
  ordine integer NOT NULL DEFAULT 0,
  stato varchar(20) NOT NULL DEFAULT 'attivo' CHECK (stato IN ('attivo', 'disattivato')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome),
  UNIQUE (id, tenant_id)
);
CREATE INDEX idx_school_levels_tenant ON school_levels(tenant_id);

CREATE TABLE school_years (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  nome varchar(20) NOT NULL,
  data_inizio date NOT NULL,
  data_fine date NOT NULL,
  stato varchar(20) NOT NULL DEFAULT 'attivo' CHECK (stato IN ('attivo', 'chiuso')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome),
  UNIQUE (id, tenant_id),
  CHECK (data_fine > data_inizio)
);
CREATE INDEX idx_school_years_tenant ON school_years(tenant_id);

-- Subject: definito nel contesto Tenant + SchoolLevel + SchoolYear (sez. 22).
-- "Matematica" del Tenant A non è la stessa riga di "Matematica" del Tenant B,
-- né della "Matematica" dell'anno successivo.
CREATE TABLE subjects (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  school_level_id bigint NOT NULL,
  school_year_id bigint NOT NULL,
  nome varchar(150) NOT NULL,
  ordine integer NOT NULL DEFAULT 0,
  stato varchar(20) NOT NULL DEFAULT 'attiva' CHECK (stato IN ('attiva', 'disattivata')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, school_level_id, school_year_id, nome),
  UNIQUE (id, tenant_id, school_year_id),
  FOREIGN KEY (school_level_id, tenant_id) REFERENCES school_levels(id, tenant_id),
  FOREIGN KEY (school_year_id, tenant_id) REFERENCES school_years(id, tenant_id)
);
CREATE INDEX idx_subjects_scope ON subjects(tenant_id, school_year_id, school_level_id);

-- PedagogicalUnit: livello tematico intermedio (es. "Numeri"), sez. 23.
CREATE TABLE pedagogical_units (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  school_year_id bigint NOT NULL,
  subject_id bigint NOT NULL,
  nome varchar(150) NOT NULL,
  ordine integer NOT NULL DEFAULT 0,
  stato varchar(20) NOT NULL DEFAULT 'attiva' CHECK (stato IN ('attiva', 'disattivata')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, nome),
  UNIQUE (id, tenant_id, school_year_id),
  UNIQUE (id, subject_id, tenant_id, school_year_id),
  FOREIGN KEY (subject_id, tenant_id, school_year_id) REFERENCES subjects(id, tenant_id, school_year_id)
);
CREATE INDEX idx_pedagogical_units_subject ON pedagogical_units(subject_id);

-- Criterion: appartiene a una PedagogicalUnit, e quindi indirettamente a
-- Subject/SchoolLevel/SchoolYear/Tenant (sez. 24).
CREATE TABLE criteria (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  school_year_id bigint NOT NULL,
  pedagogical_unit_id bigint NOT NULL,
  codice varchar(50) NOT NULL,
  descrizione text NOT NULL,
  ordine integer NOT NULL,
  stato varchar(20) NOT NULL DEFAULT 'attivo' CHECK (stato IN ('attivo', 'disattivato')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pedagogical_unit_id, ordine),
  UNIQUE (pedagogical_unit_id, codice),
  UNIQUE (id, tenant_id, school_year_id),
  UNIQUE (id, pedagogical_unit_id, tenant_id, school_year_id),
  FOREIGN KEY (pedagogical_unit_id, tenant_id, school_year_id) REFERENCES pedagogical_units(id, tenant_id, school_year_id)
);
CREATE INDEX idx_criteria_unit ON criteria(pedagogical_unit_id);


-- =====================================================================
-- SEZIONE 5 — SCALA DI OSSERVAZIONE E DI VALUTAZIONE (sez. 25-27)
--
-- Tenant default + override per SchoolLevel (non una cascata infinita).
-- Il valore di una Observation è vincolato dalla FK (scale_id, valore) ->
-- observation_scale_values: niente CHECK statico su 0/1/2, niente trigger,
-- perché l'insieme di valori ammessi è quello configurato per quella scala.
-- =====================================================================

CREATE TABLE observation_scales (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  school_level_id bigint,
  nome varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (school_level_id, tenant_id) REFERENCES school_levels(id, tenant_id)
);
-- Al più un default per tenant (school_level_id NULL) e un override per (tenant, livello).
CREATE UNIQUE INDEX uq_observation_scale_default ON observation_scales(tenant_id) WHERE school_level_id IS NULL;
CREATE UNIQUE INDEX uq_observation_scale_livello ON observation_scales(tenant_id, school_level_id) WHERE school_level_id IS NOT NULL;

CREATE TABLE observation_scale_values (
  scale_id bigint NOT NULL REFERENCES observation_scales(id),
  valore integer NOT NULL,
  etichetta varchar(100) NOT NULL,
  ordine integer NOT NULL,
  PRIMARY KEY (scale_id, valore)
);

-- Soglie di giudizio (percentuale minima inclusiva -> etichetta), stesso
-- pattern default/override di observation_scales. Configurabili per tenant:
-- non più una costante fissa 90/80/70/60/50 applicativa.
CREATE TABLE judgment_bands (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  school_level_id bigint,
  soglia_minima numeric(5, 2) NOT NULL CHECK (soglia_minima >= 0 AND soglia_minima <= 100),
  etichetta varchar(50) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (school_level_id, tenant_id) REFERENCES school_levels(id, tenant_id)
);
-- Motivazione: calcolaGiudizio legge le soglie di un tenant/livello ordinate dalla più alta.
CREATE INDEX idx_judgment_bands_lookup ON judgment_bands(tenant_id, school_level_id, soglia_minima DESC);


-- =====================================================================
-- SEZIONE 6 — DOMINIO OPERATIVO: CLASS, ENROLLMENT
-- =====================================================================

-- Class: identità stabile di una sezione (es. "2A"), NON versionata per
-- anno (l'anno entra tramite Enrollment/Teaching, sez. 30).
CREATE TABLE classes (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  school_level_id bigint NOT NULL,
  nome varchar(50) NOT NULL,
  stato varchar(20) NOT NULL DEFAULT 'attiva' CHECK (stato IN ('attiva', 'disattivata')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, school_level_id, nome),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (school_level_id, tenant_id) REFERENCES school_levels(id, tenant_id)
);
CREATE INDEX idx_classes_tenant ON classes(tenant_id);

-- Enrollment: collega Student(Person)/Class/SchoolYear/Tenant (sez. 30).
CREATE TABLE enrollments (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  school_year_id bigint NOT NULL,
  class_id bigint NOT NULL,
  student_person_id bigint NOT NULL,
  attiva boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, school_year_id, student_person_id),
  UNIQUE (id, tenant_id, school_year_id, class_id),
  FOREIGN KEY (class_id, tenant_id) REFERENCES classes(id, tenant_id),
  FOREIGN KEY (school_year_id, tenant_id) REFERENCES school_years(id, tenant_id),
  FOREIGN KEY (student_person_id, tenant_id) REFERENCES people(id, tenant_id)
);
-- Motivazione: roster di una classe per un dato anno (query più frequente del dominio).
CREATE INDEX idx_enrollments_class_year ON enrollments(class_id, school_year_id) WHERE attiva;
CREATE INDEX idx_enrollments_student ON enrollments(student_person_id);


-- =====================================================================
-- SEZIONE 7 — TEACHING, ACTIVITY
--
-- Teaching: Teacher + Class + Subject + SchoolYear (sez. 28). I riferimenti
-- strutturali (class_id, subject_id, school_year_id) diventano immutabili
-- non appena esiste almeno una Activity: applicato con un trigger (unico
-- caso in questo schema in cui una FK non può bastare, perché la regola è
-- "immutabile SE esistono figli", non "sempre immutabile" — vedi in fondo
-- alla sezione 8).
-- =====================================================================

CREATE TABLE teachings (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  school_year_id bigint NOT NULL,
  class_id bigint NOT NULL,
  subject_id bigint NOT NULL,
  account_id bigint NOT NULL REFERENCES accounts(id),
  stato varchar(20) NOT NULL DEFAULT 'attivo' CHECK (stato IN ('attivo', 'disattivato')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, school_year_id, class_id, subject_id, account_id),
  UNIQUE (id, tenant_id),
  UNIQUE (id, tenant_id, school_year_id),
  UNIQUE (id, class_id, tenant_id, school_year_id),
  UNIQUE (id, subject_id, tenant_id, school_year_id),
  FOREIGN KEY (class_id, tenant_id) REFERENCES classes(id, tenant_id),
  FOREIGN KEY (subject_id, tenant_id, school_year_id) REFERENCES subjects(id, tenant_id, school_year_id),
  -- Il docente deve avere una Membership in questo tenant: nessun "docente estraneo" referenziabile.
  FOREIGN KEY (account_id, tenant_id) REFERENCES memberships(account_id, tenant_id)
);
-- Motivazione: "i miei Teaching" è la query di ingresso più frequente per un docente.
CREATE INDEX idx_teachings_account ON teachings(account_id);
CREATE INDEX idx_teachings_tenant_year ON teachings(tenant_id, school_year_id);

CREATE TABLE activities (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  school_year_id bigint NOT NULL,
  teaching_id bigint NOT NULL,
  class_id bigint NOT NULL,
  subject_id bigint NOT NULL,
  pedagogical_unit_id bigint NOT NULL,
  nome varchar(200) NOT NULL,
  data_attivita date NOT NULL,
  stato varchar(20) NOT NULL DEFAULT 'attiva' CHECK (stato IN ('attiva', 'disattivata')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id, school_year_id),
  UNIQUE (id, class_id, tenant_id, school_year_id),
  UNIQUE (id, subject_id, tenant_id, school_year_id),
  UNIQUE (id, pedagogical_unit_id, tenant_id, school_year_id),
  FOREIGN KEY (teaching_id, tenant_id, school_year_id) REFERENCES teachings(id, tenant_id, school_year_id),
  -- class_id è denormalizzato da teaching: questa FK impone che coincidano davvero (sez. 29/31/32).
  FOREIGN KEY (teaching_id, class_id, tenant_id, school_year_id) REFERENCES teachings(id, class_id, tenant_id, school_year_id),
  -- subject_id è denormalizzato da teaching: impone la stessa coerenza per la materia (sez. 29/34).
  FOREIGN KEY (teaching_id, subject_id, tenant_id, school_year_id) REFERENCES teachings(id, subject_id, tenant_id, school_year_id),
  -- Il nucleo tematico scelto deve appartenere alla STESSA materia del Teaching (sez. 29/34): la colonna
  -- subject_id, già vincolata sopra a coincidere col Teaching, è qui vincolata anche a coincidere col
  -- nucleo: le due FK insieme forzano pedagogical_unit.subject_id = teaching.subject_id = activities.subject_id.
  FOREIGN KEY (pedagogical_unit_id, subject_id, tenant_id, school_year_id) REFERENCES pedagogical_units(id, subject_id, tenant_id, school_year_id)
);
CREATE INDEX idx_activities_teaching ON activities(teaching_id);


-- =====================================================================
-- SEZIONE 8 — OBSERVATION
--
-- Collega Enrollment/Activity/Criterion/Scale/Value (sez. 31). Le colonne
-- denormalizzate class_id e pedagogical_unit_id, ciascuna vincolata da DUE
-- FK composte (una verso Activity, una verso Enrollment/Criterion), sono
-- il meccanismo con cui il database impedisce, senza trigger, sia
-- l'osservazione cross-class (sez. 31/32) sia quella su un criterio di
-- un'unità pedagogica diversa da quella dell'attività (sez. 34).
-- =====================================================================

CREATE TABLE observations (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  school_year_id bigint NOT NULL,
  activity_id bigint NOT NULL,
  enrollment_id bigint NOT NULL,
  class_id bigint NOT NULL,
  criterion_id bigint NOT NULL,
  pedagogical_unit_id bigint NOT NULL,
  scale_id bigint NOT NULL,
  valore integer NOT NULL,
  recorded_by_account_id bigint NOT NULL REFERENCES accounts(id),
  data_osservazione date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Una sola valutazione per criterio/attività/alunno (upsert applicativo, come nel prototipo).
  UNIQUE (activity_id, enrollment_id, criterion_id),
  FOREIGN KEY (activity_id, tenant_id, school_year_id) REFERENCES activities(id, tenant_id, school_year_id),
  -- class_id deve coincidere con quello dell'attività...
  FOREIGN KEY (activity_id, class_id, tenant_id, school_year_id) REFERENCES activities(id, class_id, tenant_id, school_year_id),
  -- ...e con quello dell'iscrizione: le due FK insieme vietano l'osservazione cross-class (sez. 31/32).
  FOREIGN KEY (enrollment_id, class_id, tenant_id, school_year_id) REFERENCES enrollments(id, class_id, tenant_id, school_year_id),
  -- pedagogical_unit_id deve coincidere con quello dell'attività...
  FOREIGN KEY (activity_id, pedagogical_unit_id, tenant_id, school_year_id) REFERENCES activities(id, pedagogical_unit_id, tenant_id, school_year_id),
  -- ...e con quello del criterio: le due FK insieme vietano "Activity Matematica -> Criterion Italiano" (sez. 34).
  FOREIGN KEY (criterion_id, pedagogical_unit_id, tenant_id, school_year_id) REFERENCES criteria(id, pedagogical_unit_id, tenant_id, school_year_id),
  FOREIGN KEY (scale_id, tenant_id) REFERENCES observation_scales(id, tenant_id),
  -- Il valore deve esistere per QUESTA scala: sostituisce un CHECK statico 0/1/2 (sez. 27), niente trigger.
  FOREIGN KEY (scale_id, valore) REFERENCES observation_scale_values(scale_id, valore)
);
CREATE INDEX idx_observations_activity ON observations(activity_id);
CREATE INDEX idx_observations_enrollment ON observations(enrollment_id);


-- =====================================================================
-- SEZIONE 9 — ASSESSMENT (distinto dall'Observation pedagogica, sez. 33)
--
-- Rappresenta il giudizio/voto disciplinare ufficiale, non un aggregato
-- automatico delle Observation. Coerente con Activity/Criterion tramite lo
-- stesso schema di FK composte (sez. 34).
-- =====================================================================

CREATE TABLE assessment_periods (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  school_year_id bigint NOT NULL,
  nome varchar(50) NOT NULL,
  data_inizio date NOT NULL,
  data_fine date NOT NULL,
  UNIQUE (tenant_id, school_year_id, nome),
  UNIQUE (id, tenant_id, school_year_id),
  FOREIGN KEY (school_year_id, tenant_id) REFERENCES school_years(id, tenant_id),
  CHECK (data_fine > data_inizio)
);

CREATE TABLE assessments (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  school_year_id bigint NOT NULL,
  teaching_id bigint NOT NULL,
  class_id bigint NOT NULL,
  subject_id bigint NOT NULL,
  enrollment_id bigint NOT NULL,
  assessment_period_id bigint NOT NULL,
  criterion_id bigint,
  pedagogical_unit_id bigint,
  giudizio varchar(50) NOT NULL,
  note text,
  recorded_by_account_id bigint NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (teaching_id, tenant_id, school_year_id) REFERENCES teachings(id, tenant_id, school_year_id),
  FOREIGN KEY (teaching_id, class_id, tenant_id, school_year_id) REFERENCES teachings(id, class_id, tenant_id, school_year_id),
  FOREIGN KEY (teaching_id, subject_id, tenant_id, school_year_id) REFERENCES teachings(id, subject_id, tenant_id, school_year_id),
  FOREIGN KEY (enrollment_id, class_id, tenant_id, school_year_id) REFERENCES enrollments(id, class_id, tenant_id, school_year_id),
  FOREIGN KEY (assessment_period_id, tenant_id, school_year_id) REFERENCES assessment_periods(id, tenant_id, school_year_id),
  FOREIGN KEY (criterion_id, pedagogical_unit_id, tenant_id, school_year_id) REFERENCES criteria(id, pedagogical_unit_id, tenant_id, school_year_id),
  FOREIGN KEY (pedagogical_unit_id, subject_id, tenant_id, school_year_id) REFERENCES pedagogical_units(id, subject_id, tenant_id, school_year_id),
  CHECK ((criterion_id IS NULL) = (pedagogical_unit_id IS NULL))
);
-- Un solo Assessment "di materia" (criterion_id NULL) o "di criterio" per alunno/periodo/Teaching.
CREATE UNIQUE INDEX uq_assessment_criterio ON assessments(teaching_id, enrollment_id, assessment_period_id, criterion_id) WHERE criterion_id IS NOT NULL;
CREATE UNIQUE INDEX uq_assessment_materia ON assessments(teaching_id, enrollment_id, assessment_period_id) WHERE criterion_id IS NULL;
CREATE INDEX idx_assessments_enrollment ON assessments(enrollment_id);


-- =====================================================================
-- SEZIONE 10 — ROLE_ASSIGNMENT (ora che tutte le tabelle di scope esistono)
--
-- Scope rappresentato da colonne dedicate (non un id polimorfico): ciascuna
-- ha una vera FK verso la propria tabella + tenant_id, quindi un
-- RoleAssignment non può mai puntare a una risorsa di un altro tenant. Il
-- CHECK garantisce che esattamente le colonne coerenti con scope_type siano
-- valorizzate.
-- =====================================================================

CREATE TABLE role_assignments (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id),
  role_id bigint NOT NULL REFERENCES roles(id),
  scope_type varchar(20) NOT NULL CHECK (scope_type IN ('PLATFORM', 'TENANT', 'SCHOOL_LEVEL', 'CLASS', 'TEACHING', 'STUDENT')),
  tenant_id bigint REFERENCES tenants(id),
  scope_tenant_id bigint,
  scope_school_level_id bigint,
  scope_class_id bigint,
  scope_teaching_id bigint,
  scope_student_person_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_account_id bigint REFERENCES accounts(id),
  revoked_at timestamptz,
  CONSTRAINT ck_role_assignment_scope_coerente CHECK (
    (scope_type = 'PLATFORM' AND tenant_id IS NULL AND scope_tenant_id IS NULL AND scope_school_level_id IS NULL AND scope_class_id IS NULL AND scope_teaching_id IS NULL AND scope_student_person_id IS NULL)
    OR (scope_type = 'TENANT' AND tenant_id IS NOT NULL AND scope_tenant_id = tenant_id AND scope_school_level_id IS NULL AND scope_class_id IS NULL AND scope_teaching_id IS NULL AND scope_student_person_id IS NULL)
    OR (scope_type = 'SCHOOL_LEVEL' AND tenant_id IS NOT NULL AND scope_school_level_id IS NOT NULL AND scope_tenant_id IS NULL AND scope_class_id IS NULL AND scope_teaching_id IS NULL AND scope_student_person_id IS NULL)
    OR (scope_type = 'CLASS' AND tenant_id IS NOT NULL AND scope_class_id IS NOT NULL AND scope_tenant_id IS NULL AND scope_school_level_id IS NULL AND scope_teaching_id IS NULL AND scope_student_person_id IS NULL)
    OR (scope_type = 'TEACHING' AND tenant_id IS NOT NULL AND scope_teaching_id IS NOT NULL AND scope_tenant_id IS NULL AND scope_school_level_id IS NULL AND scope_class_id IS NULL AND scope_student_person_id IS NULL)
    OR (scope_type = 'STUDENT' AND tenant_id IS NOT NULL AND scope_student_person_id IS NOT NULL AND scope_tenant_id IS NULL AND scope_school_level_id IS NULL AND scope_class_id IS NULL AND scope_teaching_id IS NULL)
  ),
  FOREIGN KEY (scope_tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (scope_school_level_id, tenant_id) REFERENCES school_levels(id, tenant_id),
  FOREIGN KEY (scope_class_id, tenant_id) REFERENCES classes(id, tenant_id),
  FOREIGN KEY (scope_teaching_id, tenant_id) REFERENCES teachings(id, tenant_id),
  FOREIGN KEY (scope_student_person_id, tenant_id) REFERENCES people(id, tenant_id)
);
-- Motivazione: risoluzione dei permessi effettivi di un account a ogni richiesta autenticata.
CREATE INDEX idx_role_assignments_account ON role_assignments(account_id) WHERE revoked_at IS NULL;
-- Motivazione: "chi ha accesso a questo Teaching/questa classe" (gestione utenti, audit).
CREATE INDEX idx_role_assignments_teaching ON role_assignments(scope_teaching_id) WHERE scope_teaching_id IS NOT NULL;
CREATE INDEX idx_role_assignments_class ON role_assignments(scope_class_id) WHERE scope_class_id IS NOT NULL;
CREATE INDEX idx_role_assignments_tenant ON role_assignments(tenant_id) WHERE tenant_id IS NOT NULL;


-- =====================================================================
-- SEZIONE 11 — AUDIT LOG (append-only; i privilegi sono in 002)
-- =====================================================================

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id bigint REFERENCES tenants(id),
  actor_account_id bigint REFERENCES accounts(id),
  azione varchar(100) NOT NULL,
  risorsa varchar(100) NOT NULL,
  risorsa_id bigint,
  prima jsonb,
  dopo jsonb,
  correlation_id varchar(100),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Motivazione: cronologia di audit per tenant (schermata amministrativa), più recenti prima.
CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id, created_at DESC);
-- Motivazione: "chi ha modificato questa risorsa" durante un'indagine puntuale.
CREATE INDEX idx_audit_log_risorsa ON audit_log(risorsa, risorsa_id);


-- =====================================================================
-- SEZIONE 12 — TRIGGER (unico caso: immutabilità strutturale di Teaching)
--
-- class_id/subject_id/school_year_id di un Teaching sono strutturali (sez.
-- 28): non possono cambiare una volta che esiste almeno una Activity. Una
-- FK non può esprimere "immutabile SE esistono figli" (è una regola
-- condizionata all'esistenza di righe in un'altra tabella, non una
-- relazione statica) quindi qui un trigger è l'unico strumento adeguato.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_blocca_modifica_struttura_teaching() RETURNS trigger AS $$
BEGIN
  IF (NEW.class_id, NEW.subject_id, NEW.school_year_id) IS DISTINCT FROM (OLD.class_id, OLD.subject_id, OLD.school_year_id) THEN
    IF EXISTS (SELECT 1 FROM activities WHERE teaching_id = OLD.id) THEN
      RAISE EXCEPTION 'Teaching % ha già delle Activity: class_id/subject_id/school_year_id sono immutabili. Creare un nuovo Teaching.', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_teaching_struttura_immutabile
BEFORE UPDATE ON teachings
FOR EACH ROW EXECUTE FUNCTION fn_blocca_modifica_struttura_teaching();
