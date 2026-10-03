# DATABASE V1 SNAPSHOT — Documento tecnico per revisione migrazione Neon

**Commit**: `f8d319d240c7c824304aaf9646639ee80c2dbed8` · **Tag**: `v1.0.0` · Verificato: HEAD = commit citato, working tree pulito, branch `main` allineato a `origin/main`.

Questo documento fotografa esattamente il contenuto dei tre file di migration e del file di seed presenti nel repository a questo commit. Nessun file è stato letto a memoria: ogni riga sotto riportata è stata riletta dal disco in questa sessione.

---

## 1. Ordine delle migration

| # | File | Cosa realizza |
|---|---|---|
| 1 | `migrations/000_schema_base.sql` | Crea tutte le 25 tabelle dello schema V1 (identità, RBAC, configurazione pedagogica, dominio operativo, audit), i loro indici, e l'unico trigger dello schema (immutabilità strutturale di `teachings`). Non inserisce alcun dato. |
| 2 | `migrations/001_ruoli_permessi_sistema.sql` | Inserisce dati di **configurazione di sistema** (non di esempio): 17 righe in `permissions`, 4 righe in `roles` (PLATFORM_ADMIN, TENANT_ADMIN, COORDINATOR, TEACHER), e le relative righe in `role_permissions`. |
| 3 | `migrations/002_audit_append_only.sql` | Crea (se non esistono) i ruoli Postgres `audit_owner` e `app_role`; concede `app_role` al ruolo di connessione corrente (`GRANT app_role TO CURRENT_USER`); trasferisce la proprietà di `audit_log` a `audit_owner`; revoca tutti i privilegi su `audit_log` da `PUBLIC` e concede solo `INSERT, SELECT` ad `app_role`; concede `SELECT, INSERT, UPDATE, DELETE` su **tutte le altre tabelle** e `USAGE, SELECT` su tutte le altre sequenze ad `app_role`. |
| — | `seed/seed_multitenant.sql` | (non è una migration numerata) Dati di esempio multi-tenant, descritti in dettaglio al §10. |

Le prime tre vanno eseguite **in quest'ordine, una sola volta**; il seed è opzionale e va eseguito dopo la 002.

---

## 2. Schema completo

### 2.1 `tenants`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | autoincrement | PRIMARY KEY |
| slug | varchar(60) | NOT NULL | — | UNIQUE |
| nome | varchar(200) | NOT NULL | — | |
| stato | varchar(20) | NOT NULL | `'attivo'` | CHECK IN (`attivo`,`sospeso`) |
| created_at | timestamptz | NOT NULL | `now()` | |

### 2.2 `people`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | **NULL ammesso** | | FK → `tenants(id)` |
| nome | varchar(100) | NOT NULL | | |
| cognome | varchar(100) | NOT NULL | | |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE composta: `(id, tenant_id)` — colonna denormalizzata di supporto per FK composte di tabelle figlie (non integrità cross-tenant di `people` stessa). `tenant_id` NULL = persona "globale" legata a un Account (staff/admin); NOT NULL = studente di proprietà di quel tenant. Indice: `idx_people_tenant(tenant_id)`.

### 2.3 `accounts`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| email | varchar(255) | NOT NULL | | UNIQUE |
| password_hash | text | NULL ammesso | | |
| person_id | bigint | NOT NULL | | UNIQUE, FK → `people(id)` |
| stato | varchar(20) | NOT NULL | `'attivo'` | CHECK IN (`attivo`,`disabilitato`) |
| password_changed_at | timestamptz | NULL ammesso | | |
| created_at | timestamptz | NOT NULL | `now()` | |

Nessuna FK composta; nessuna colonna `tenant_id` (Account è platform-wide).

### 2.4 `memberships`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| account_id | bigint | NOT NULL | | FK → `accounts(id)` |
| tenant_id | bigint | NOT NULL | | FK → `tenants(id)` |
| stato | varchar(20) | NOT NULL | `'attiva'` | CHECK IN (`attiva`,`sospesa`) |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(account_id, tenant_id)` — usata anche come target di FK composte da altre tabelle (vedi `teachings.account_id`). Indici: `idx_memberships_account(account_id)`, `idx_memberships_tenant(tenant_id)`.

### 2.5 `sessions`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| account_id | bigint | NOT NULL | | FK → `accounts(id)` |
| token_hash | char(64) | NOT NULL | | UNIQUE |
| active_tenant_id | bigint | NULL ammesso | | FK → `tenants(id)` |
| created_at | timestamptz | NOT NULL | `now()` | |
| last_seen_at | timestamptz | NOT NULL | `now()` | |
| expires_at | timestamptz | NOT NULL | | |
| revoked_at | timestamptz | NULL ammesso | | |
| revoked_reason | varchar(100) | NULL ammesso | | |
| user_agent | text | NULL ammesso | | |
| ip | varchar(64) | NULL ammesso | | |

Nessun campo contenente il token in chiaro. Indici: `idx_sessions_account(account_id)`, `idx_sessions_expires(expires_at)`.

### 2.6 `roles`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| codice | varchar(50) | NOT NULL | | UNIQUE |
| nome | varchar(100) | NOT NULL | | |
| is_system | boolean | NOT NULL | `true` | |

### 2.7 `permissions`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| codice | varchar(100) | NOT NULL | | UNIQUE |
| descrizione | text | NOT NULL | | |

### 2.8 `role_permissions`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| role_id | bigint | NOT NULL | | FK → `roles(id)`, PK composta |
| permission_id | bigint | NOT NULL | | FK → `permissions(id)`, PK composta |

PRIMARY KEY: `(role_id, permission_id)`.

### 2.9 `school_levels`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | FK → `tenants(id)` |
| nome | varchar(100) | NOT NULL | | |
| ordine | integer | NOT NULL | `0` | |
| stato | varchar(20) | NOT NULL | `'attivo'` | CHECK IN (`attivo`,`disattivato`) |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(tenant_id, nome)`, `(id, tenant_id)` *(quest'ultima è la colonna denormalizzata di supporto)*. Indice: `idx_school_levels_tenant(tenant_id)`.

### 2.10 `school_years`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | FK → `tenants(id)` |
| nome | varchar(20) | NOT NULL | | |
| data_inizio | date | NOT NULL | | |
| data_fine | date | NOT NULL | | CHECK `data_fine > data_inizio` |
| stato | varchar(20) | NOT NULL | `'attivo'` | CHECK IN (`attivo`,`chiuso`) |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(tenant_id, nome)`, `(id, tenant_id)`. Indice: `idx_school_years_tenant(tenant_id)`.

### 2.11 `subjects`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | FK composta (vedi sotto) |
| school_level_id | bigint | NOT NULL | | FK composta |
| school_year_id | bigint | NOT NULL | | FK composta |
| nome | varchar(150) | NOT NULL | | |
| ordine | integer | NOT NULL | `0` | |
| stato | varchar(20) | NOT NULL | `'attiva'` | CHECK IN (`attiva`,`disattivata`) |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(tenant_id, school_level_id, school_year_id, nome)`, `(id, tenant_id, school_year_id)`.
FK composte: `(school_level_id, tenant_id) → school_levels(id, tenant_id)`; `(school_year_id, tenant_id) → school_years(id, tenant_id)`. Indice: `idx_subjects_scope(tenant_id, school_year_id, school_level_id)`.

### 2.12 `pedagogical_units`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | (denormalizzata) |
| school_year_id | bigint | NOT NULL | | (denormalizzata) |
| subject_id | bigint | NOT NULL | | FK composta |
| nome | varchar(150) | NOT NULL | | |
| ordine | integer | NOT NULL | `0` | |
| stato | varchar(20) | NOT NULL | `'attiva'` | CHECK IN (`attiva`,`disattivata`) |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(subject_id, nome)`, `(id, tenant_id, school_year_id)`, `(id, subject_id, tenant_id, school_year_id)`.
FK composta: `(subject_id, tenant_id, school_year_id) → subjects(id, tenant_id, school_year_id)`. Indice: `idx_pedagogical_units_subject(subject_id)`.

### 2.13 `criteria`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | (denormalizzata) |
| school_year_id | bigint | NOT NULL | | (denormalizzata) |
| pedagogical_unit_id | bigint | NOT NULL | | FK composta |
| codice | varchar(50) | NOT NULL | | |
| descrizione | text | NOT NULL | | |
| ordine | integer | NOT NULL | | |
| stato | varchar(20) | NOT NULL | `'attivo'` | CHECK IN (`attivo`,`disattivato`) |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(pedagogical_unit_id, ordine)`, `(pedagogical_unit_id, codice)`, `(id, tenant_id, school_year_id)`, `(id, pedagogical_unit_id, tenant_id, school_year_id)`.
FK composta: `(pedagogical_unit_id, tenant_id, school_year_id) → pedagogical_units(id, tenant_id, school_year_id)`. Indice: `idx_criteria_unit(pedagogical_unit_id)`.

### 2.14 `observation_scales`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | FK → `tenants(id)` |
| school_level_id | bigint | **NULL ammesso** | | FK composta (nullable) |
| nome | varchar(100) | NOT NULL | | |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(id, tenant_id)`. FK composta: `(school_level_id, tenant_id) → school_levels(id, tenant_id)`.
Indici parziali (non impliciti da UNIQUE/PK): `uq_observation_scale_default` UNIQUE su `(tenant_id)` WHERE `school_level_id IS NULL`; `uq_observation_scale_livello` UNIQUE su `(tenant_id, school_level_id)` WHERE `school_level_id IS NOT NULL`. `school_level_id = NULL` → scala di default del tenant.

### 2.15 `observation_scale_values`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| scale_id | bigint | NOT NULL | | FK → `observation_scales(id)`, PK composta |
| valore | integer | NOT NULL | | PK composta |
| etichetta | varchar(100) | NOT NULL | | |
| ordine | integer | NOT NULL | | |

PRIMARY KEY: `(scale_id, valore)`. Questa tabella è il target della FK `(scale_id, valore)` da `observations`: è il meccanismo con cui un valore osservato deve appartenere alla scala configurata.

### 2.16 `judgment_bands`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | FK → `tenants(id)` |
| school_level_id | bigint | NULL ammesso | | FK composta (nullable) |
| soglia_minima | numeric(5,2) | NOT NULL | | CHECK `>= 0 AND <= 100` |
| etichetta | varchar(50) | NOT NULL | | |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(id, tenant_id)`. FK composta: `(school_level_id, tenant_id) → school_levels(id, tenant_id)`. Indice: `idx_judgment_bands_lookup(tenant_id, school_level_id, soglia_minima DESC)`. Nessun indice unico parziale come per `observation_scales` (più bande per tenant/livello sono normali: una per soglia).

### 2.17 `classes`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | FK → `tenants(id)` |
| school_level_id | bigint | NOT NULL | | FK composta |
| nome | varchar(50) | NOT NULL | | |
| stato | varchar(20) | NOT NULL | `'attiva'` | CHECK IN (`attiva`,`disattivata`) |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(tenant_id, school_level_id, nome)`, `(id, tenant_id)`. FK composta: `(school_level_id, tenant_id) → school_levels(id, tenant_id)`. Indice: `idx_classes_tenant(tenant_id)`. **Non versionata per anno scolastico** (nessuna colonna `school_year_id`).

### 2.18 `enrollments`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | (denormalizzata) |
| school_year_id | bigint | NOT NULL | | FK composta |
| class_id | bigint | NOT NULL | | FK composta |
| student_person_id | bigint | NOT NULL | | FK composta |
| attiva | boolean | NOT NULL | `true` | |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(tenant_id, school_year_id, student_person_id)` — uno studente iscritto una sola volta per anno; `(id, tenant_id, school_year_id, class_id)` — target delle FK composte da `observations`/`assessments`.
FK composte: `(class_id, tenant_id) → classes(id, tenant_id)`; `(school_year_id, tenant_id) → school_years(id, tenant_id)`; `(student_person_id, tenant_id) → people(id, tenant_id)`.
Indici: `idx_enrollments_class_year(class_id, school_year_id) WHERE attiva` (parziale), `idx_enrollments_student(student_person_id)`.

### 2.19 `teachings`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | (denormalizzata) |
| school_year_id | bigint | NOT NULL | | (denormalizzata) |
| class_id | bigint | NOT NULL | | FK composta |
| subject_id | bigint | NOT NULL | | FK composta |
| account_id | bigint | NOT NULL | | FK → `accounts(id)` + FK composta |
| stato | varchar(20) | NOT NULL | `'attivo'` | CHECK IN (`attivo`,`disattivato`) |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(tenant_id, school_year_id, class_id, subject_id, account_id)`, `(id, tenant_id)`, `(id, tenant_id, school_year_id)`, `(id, class_id, tenant_id, school_year_id)`, `(id, subject_id, tenant_id, school_year_id)` — queste ultime tre sono target delle FK composte da `activities`/`assessments`.
FK composte: `(class_id, tenant_id) → classes(id, tenant_id)`; `(subject_id, tenant_id, school_year_id) → subjects(id, tenant_id, school_year_id)`; `(account_id, tenant_id) → memberships(account_id, tenant_id)` — **il docente deve avere una Membership in quel tenant**.
Indici: `idx_teachings_account(account_id)`, `idx_teachings_tenant_year(tenant_id, school_year_id)`.
**Trigger**: `class_id`/`subject_id`/`school_year_id` diventano immutabili una volta che esiste almeno una `activities` collegata (vedi §5).

### 2.20 `activities`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | (denormalizzata) |
| school_year_id | bigint | NOT NULL | | (denormalizzata) |
| teaching_id | bigint | NOT NULL | | FK composta |
| class_id | bigint | NOT NULL | | denormalizzata da `teaching`, FK composta |
| subject_id | bigint | NOT NULL | | denormalizzata da `teaching`, FK composta doppia |
| pedagogical_unit_id | bigint | NOT NULL | | FK composta |
| nome | varchar(200) | NOT NULL | | |
| data_attivita | date | NOT NULL | | |
| stato | varchar(20) | NOT NULL | `'attiva'` | CHECK IN (`attiva`,`disattivata`) |
| created_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(id, tenant_id, school_year_id)`, `(id, class_id, tenant_id, school_year_id)`, `(id, subject_id, tenant_id, school_year_id)`, `(id, pedagogical_unit_id, tenant_id, school_year_id)` — tutte target di FK composte da `observations`.
FK composte:
- `(teaching_id, tenant_id, school_year_id) → teachings(id, tenant_id, school_year_id)`
- `(teaching_id, class_id, tenant_id, school_year_id) → teachings(id, class_id, tenant_id, school_year_id)` — impone `activities.class_id = teachings.class_id`
- `(teaching_id, subject_id, tenant_id, school_year_id) → teachings(id, subject_id, tenant_id, school_year_id)` — impone `activities.subject_id = teachings.subject_id`
- `(pedagogical_unit_id, subject_id, tenant_id, school_year_id) → pedagogical_units(id, subject_id, tenant_id, school_year_id)` — impone `pedagogical_unit.subject_id = activities.subject_id` (che, per la FK precedente, è già `= teachings.subject_id`): le due FK insieme forzano la coerenza materia/nucleo/Teaching senza trigger.

Indice: `idx_activities_teaching(teaching_id)`.

### 2.21 `observations`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | (denormalizzata) |
| school_year_id | bigint | NOT NULL | | (denormalizzata) |
| activity_id | bigint | NOT NULL | | FK composta ×3 |
| enrollment_id | bigint | NOT NULL | | FK composta |
| class_id | bigint | NOT NULL | | denormalizzata, doppiamente vincolata |
| criterion_id | bigint | NOT NULL | | FK composta |
| pedagogical_unit_id | bigint | NOT NULL | | denormalizzata, doppiamente vincolata |
| scale_id | bigint | NOT NULL | | FK composta ×2 |
| valore | integer | NOT NULL | | vincolato dalla FK `(scale_id, valore)`, non da un CHECK statico |
| recorded_by_account_id | bigint | NOT NULL | | FK → `accounts(id)` |
| data_osservazione | date | NOT NULL | | |
| note | text | NULL ammesso | | |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

UNIQUE: `(activity_id, enrollment_id, criterion_id)` — una sola valutazione per criterio/attività/alunno (base dell'upsert applicativo).
FK composte:
- `(activity_id, tenant_id, school_year_id) → activities(id, tenant_id, school_year_id)`
- `(activity_id, class_id, tenant_id, school_year_id) → activities(id, class_id, tenant_id, school_year_id)`
- `(enrollment_id, class_id, tenant_id, school_year_id) → enrollments(id, class_id, tenant_id, school_year_id)` — insieme alla precedente, impedisce l'osservazione cross-classe
- `(activity_id, pedagogical_unit_id, tenant_id, school_year_id) → activities(id, pedagogical_unit_id, tenant_id, school_year_id)`
- `(criterion_id, pedagogical_unit_id, tenant_id, school_year_id) → criteria(id, pedagogical_unit_id, tenant_id, school_year_id)` — insieme alla precedente, impedisce un criterio di un'unità pedagogica diversa da quella dell'attività
- `(scale_id, tenant_id) → observation_scales(id, tenant_id)`
- `(scale_id, valore) → observation_scale_values(scale_id, valore)` — impedisce un valore non ammesso dalla scala applicabile

Indici: `idx_observations_activity(activity_id)`, `idx_observations_enrollment(enrollment_id)`.

### 2.22 `assessment_periods`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | FK composta |
| school_year_id | bigint | NOT NULL | | FK composta |
| nome | varchar(50) | NOT NULL | | |
| data_inizio | date | NOT NULL | | |
| data_fine | date | NOT NULL | | CHECK `data_fine > data_inizio` |

UNIQUE: `(tenant_id, school_year_id, nome)`, `(id, tenant_id, school_year_id)`. FK composta: `(school_year_id, tenant_id) → school_years(id, tenant_id)`.

### 2.23 `assessments`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NOT NULL | | (denormalizzata) |
| school_year_id | bigint | NOT NULL | | (denormalizzata) |
| teaching_id | bigint | NOT NULL | | FK composta ×3 |
| class_id | bigint | NOT NULL | | denormalizzata da teaching |
| subject_id | bigint | NOT NULL | | denormalizzata da teaching |
| enrollment_id | bigint | NOT NULL | | FK composta |
| assessment_period_id | bigint | NOT NULL | | FK composta |
| criterion_id | bigint | **NULL ammesso** | | FK composta (nullable) |
| pedagogical_unit_id | bigint | **NULL ammesso** | | FK composta (nullable) |
| giudizio | varchar(50) | NOT NULL | | |
| note | text | NULL ammesso | | |
| recorded_by_account_id | bigint | NOT NULL | | FK → `accounts(id)` |
| created_at | timestamptz | NOT NULL | `now()` | |
| updated_at | timestamptz | NOT NULL | `now()` | |

CHECK: `(criterion_id IS NULL) = (pedagogical_unit_id IS NULL)` — un Assessment "di materia" oppure "di criterio", mai valorizzato a metà.
FK composte:
- `(teaching_id, tenant_id, school_year_id) → teachings(id, tenant_id, school_year_id)`
- `(teaching_id, class_id, tenant_id, school_year_id) → teachings(id, class_id, tenant_id, school_year_id)`
- `(teaching_id, subject_id, tenant_id, school_year_id) → teachings(id, subject_id, tenant_id, school_year_id)`
- `(enrollment_id, class_id, tenant_id, school_year_id) → enrollments(id, class_id, tenant_id, school_year_id)`
- `(assessment_period_id, tenant_id, school_year_id) → assessment_periods(id, tenant_id, school_year_id)`
- `(criterion_id, pedagogical_unit_id, tenant_id, school_year_id) → criteria(id, pedagogical_unit_id, tenant_id, school_year_id)`
- `(pedagogical_unit_id, subject_id, tenant_id, school_year_id) → pedagogical_units(id, subject_id, tenant_id, school_year_id)`

Indici parziali: `uq_assessment_criterio` UNIQUE su `(teaching_id, enrollment_id, assessment_period_id, criterion_id)` WHERE `criterion_id IS NOT NULL`; `uq_assessment_materia` UNIQUE su `(teaching_id, enrollment_id, assessment_period_id)` WHERE `criterion_id IS NULL`. Indice ordinario: `idx_assessments_enrollment(enrollment_id)`.

### 2.24 `role_assignments`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| account_id | bigint | NOT NULL | | FK → `accounts(id)` |
| role_id | bigint | NOT NULL | | FK → `roles(id)` |
| scope_type | varchar(20) | NOT NULL | | CHECK IN (`PLATFORM`,`TENANT`,`SCHOOL_LEVEL`,`CLASS`,`TEACHING`,`STUDENT`) |
| tenant_id | bigint | NULL ammesso | | FK → `tenants(id)` |
| scope_tenant_id | bigint | NULL ammesso | | FK → `tenants(id)` |
| scope_school_level_id | bigint | NULL ammesso | | FK composta |
| scope_class_id | bigint | NULL ammesso | | FK composta |
| scope_teaching_id | bigint | NULL ammesso | | FK composta |
| scope_student_person_id | bigint | NULL ammesso | | FK composta |
| created_at | timestamptz | NOT NULL | `now()` | |
| created_by_account_id | bigint | NULL ammesso | | FK → `accounts(id)` |
| revoked_at | timestamptz | NULL ammesso | | |

CHECK `ck_role_assignment_scope_coerente`: per ciascuno dei 6 valori di `scope_type`, impone che *esattamente* le colonne di scope pertinenti siano valorizzate e tutte le altre NULL (riportato per esteso al §4).
FK composte: `(scope_school_level_id, tenant_id) → school_levels(id, tenant_id)`; `(scope_class_id, tenant_id) → classes(id, tenant_id)`; `(scope_teaching_id, tenant_id) → teachings(id, tenant_id)`; `(scope_student_person_id, tenant_id) → people(id, tenant_id)`. FK semplice: `scope_tenant_id → tenants(id)`.
Indici: `idx_role_assignments_account(account_id) WHERE revoked_at IS NULL` (parziale); `idx_role_assignments_teaching(scope_teaching_id) WHERE scope_teaching_id IS NOT NULL` (parziale); `idx_role_assignments_class(scope_class_id) WHERE scope_class_id IS NOT NULL` (parziale); `idx_role_assignments_tenant(tenant_id) WHERE tenant_id IS NOT NULL` (parziale).

### 2.25 `audit_log`
| Colonna | Tipo | Null | Default | Vincoli |
|---|---|---|---|---|
| id | bigserial | NOT NULL | | PRIMARY KEY |
| tenant_id | bigint | NULL ammesso | | FK → `tenants(id)` |
| actor_account_id | bigint | NULL ammesso | | FK → `accounts(id)` |
| azione | varchar(100) | NOT NULL | | |
| risorsa | varchar(100) | NOT NULL | | |
| risorsa_id | bigint | NULL ammesso | | |
| prima | jsonb | NULL ammesso | | |
| dopo | jsonb | NULL ammesso | | |
| correlation_id | varchar(100) | NULL ammesso | | |
| created_at | timestamptz | NOT NULL | `now()` | |

Nessun CHECK/FK composta oltre alle due FK semplici indicate. Indici: `idx_audit_log_tenant(tenant_id, created_at DESC)`, `idx_audit_log_risorsa(risorsa, risorsa_id)`. Proprietà e privilegi: vedi §9.

---

## 3. Relazioni (albero reale)

```text
Tenant
 ├── People (tenant_id NULL = identità globale legata ad Account; NOT NULL = studente del tenant)
 │     └── Account (1:1, account.person_id UNIQUE) ── Membership ── Tenant
 │                                                        └── Session (account_id; active_tenant_id → Tenant)
 ├── SchoolLevel
 │     ├── Subject (tenant, school_level, school_year)
 │     │     └── PedagogicalUnit (tenant, school_year, subject)
 │     │           └── Criterion (tenant, school_year, pedagogical_unit)
 │     ├── Class (tenant, school_level — NON versionata per anno)
 │     │     └── Enrollment (tenant, school_year, class, student_person)
 │     ├── ObservationScale (tenant, school_level opzionale = override)
 │     │     └── ObservationScaleValue (scale, valore)
 │     └── JudgmentBand (tenant, school_level opzionale = override)
 ├── SchoolYear
 │     ├── Subject / PedagogicalUnit / Criterion (come sopra)
 │     ├── Enrollment / Teaching / Activity / AssessmentPeriod
 ├── Teaching (tenant, school_year, class, subject, account — il docente, via Membership)
 │     └── Activity (tenant, school_year, teaching, class*, subject*, pedagogical_unit)
 │           └── Observation (tenant, school_year, activity, enrollment, class*, criterion, pedagogical_unit*, scale, valore)
 ├── AssessmentPeriod (tenant, school_year)
 │     └── Assessment (tenant, school_year, teaching, class*, subject*, enrollment, assessment_period, criterion?, pedagogical_unit?)
 ├── Role / Permission / RolePermission (di sistema, non tenant-owned)
 │     └── RoleAssignment (account, role, scope_type + una tra: tenant/school_level/class/teaching/student)
 └── AuditLog (tenant opzionale, actor_account opzionale)
```
`*` = colonna denormalizzata dal genitore immediato, mantenuta coerente da FK composte (non da trigger).

---

## 4. Vincoli di integrità

| Tipo di incoerenza impedita | Meccanismo | Dove |
|---|---|---|
| Cross-tenant su Subject/PedagogicalUnit/Criterion/Class/Enrollment/Teaching/Activity/Observation/Assessment/scale/bande/RoleAssignment | **FK composta** che include sempre `tenant_id` | in ogni FK elencata al §2 |
| Cross-school-year su Subject/PedagogicalUnit/Criterion/Enrollment/Teaching/Activity/Observation/Assessment/AssessmentPeriod | **FK composta** che include sempre `school_year_id` | idem |
| Cross-class (Observation/Assessment su un Enrollment di classe diversa da quella dell'Activity/Teaching) | **FK composta**: `class_id` denormalizzato vincolato simultaneamente da due genitori (Activity/Teaching **e** Enrollment) | `observations` (2.21), `assessments` (2.23) |
| Cross-subject (PedagogicalUnit/Criterion di materia diversa da quella del Teaching/Activity) | **FK composta**: `subject_id`/`pedagogical_unit_id` denormalizzati vincolati simultaneamente da due genitori | `activities` (2.20), `observations` (2.21), `assessments` (2.23) |
| Teaching incoerente (materia/classe/anno cambiati dopo la creazione di un'Activity) | **TRIGGER** (unico nello schema) | `teachings` (vedi §5) |
| Activity incoerente (nucleo di materia diversa dal Teaching) | **FK composta** (`pedagogical_unit_id, subject_id, tenant_id, school_year_id`) | `activities` |
| Observation incoerente (criterio di un'altra unità pedagogica; valore fuori scala; classe/alunno incoerenti) | **FK composta** ×5 | `observations` |
| Assessment incoerente (stessi controlli di Observation, più criterio/unità entrambi presenti o entrambi assenti) | **FK composta** ×5 + **CHECK** | `assessments` |
| Criterion incoerente (fuori dalla PedagogicalUnit dichiarata) | **FK composta** `(pedagogical_unit_id, tenant_id, school_year_id)` | `criteria` |
| Enrollment incoerente (classe/persona di un altro tenant) | **FK composta** ×3 | `enrollments` |
| Uso di una scala/valore di un altro tenant | **FK composta**: `(scale_id, tenant_id)` e `(scale_id, valore)` | `observations` |
| RoleAssignment con scope che punta a risorsa di un altro tenant | **FK composta** su ciascuna colonna di scope + **CHECK** di coerenza forma/scope_type | `role_assignments` |
| Docente (Teaching.account_id) senza Membership nel tenant | **FK composta** `(account_id, tenant_id) → memberships(account_id, tenant_id)` | `teachings` |
| Uno studente iscritto più volte nello stesso anno | **UNIQUE** `(tenant_id, school_year_id, student_person_id)` | `enrollments` |
| Una sola scala di default / un solo override per livello | **UNIQUE parziale** (2 indici) | `observation_scales` |
| Un solo Assessment "di materia" o "di criterio" per alunno/periodo/Teaching | **UNIQUE parziale** (2 indici) | `assessments` |
| Data fine ≤ data inizio (anno scolastico, periodo di valutazione) | **CHECK** | `school_years`, `assessment_periods` |
| Soglia di giudizio fuori range 0-100 | **CHECK** | `judgment_bands` |
| Stato non tra i valori ammessi (tutte le tabelle con colonna `stato`) | **CHECK** | tenants, accounts, memberships, school_levels, school_years, subjects, pedagogical_units, criteria, classes, teachings, activities |

Nessun vincolo di integrità cross-tabella nello schema è implementato tramite trigger, eccetto quello elencato al §5.

---

## 5. Trigger

**Confermato: esiste un solo trigger in tutto lo schema.**

| Proprietà | Valore |
|---|---|
| Nome trigger | `trg_teaching_struttura_immutabile` |
| Tabella | `teachings` |
| Evento | `BEFORE UPDATE`, `FOR EACH ROW` |
| Funzione | `fn_blocca_modifica_struttura_teaching()` (PL/pgSQL) |
| Regola garantita | Se `NEW.(class_id, subject_id, school_year_id)` differisce da `OLD.(class_id, subject_id, school_year_id)` **e** esiste almeno una riga in `activities` con `teaching_id = OLD.id`, l'UPDATE viene rifiutato con `RAISE EXCEPTION`. Altrimenti (nessuna Activity collegata) la modifica è permessa. Colonne non strutturali (es. `stato`) restano sempre modificabili. |

Nessun altro trigger (né su `activities`, `observations`, `assessments`, `role_assignments`, `audit_log` o altre tabelle) è presente nel file di migration.

---

## 6. Indici (non impliciti da PK/UNIQUE)

| Indice | Tabella | Colonne | Scopo dichiarato nel file |
|---|---|---|---|
| `idx_people_tenant` | people | tenant_id | liste studenti filtrate per tenant |
| `idx_memberships_account` | memberships | account_id | risoluzione tenant di un account a login/switch |
| `idx_memberships_tenant` | memberships | tenant_id | elenco membri di un tenant |
| `idx_sessions_account` | sessions | account_id | revoca/elenco sessioni di un account |
| `idx_sessions_expires` | sessions | expires_at | pulizia sessioni scadute |
| `idx_school_levels_tenant` | school_levels | tenant_id | — |
| `idx_school_years_tenant` | school_years | tenant_id | — |
| `idx_subjects_scope` | subjects | tenant_id, school_year_id, school_level_id | — |
| `idx_pedagogical_units_subject` | pedagogical_units | subject_id | — |
| `idx_criteria_unit` | criteria | pedagogical_unit_id | — |
| `uq_observation_scale_default` (UNIQUE, parziale) | observation_scales | tenant_id | al più una scala di default per tenant |
| `uq_observation_scale_livello` (UNIQUE, parziale) | observation_scales | tenant_id, school_level_id | al più un override per livello |
| `idx_judgment_bands_lookup` | judgment_bands | tenant_id, school_level_id, soglia_minima DESC | lookup ordinato delle soglie |
| `idx_classes_tenant` | classes | tenant_id | — |
| `idx_enrollments_class_year` (parziale, WHERE attiva) | enrollments | class_id, school_year_id | roster di una classe per anno |
| `idx_enrollments_student` | enrollments | student_person_id | — |
| `idx_teachings_account` | teachings | account_id | "i miei Teaching" |
| `idx_teachings_tenant_year` | teachings | tenant_id, school_year_id | — |
| `idx_activities_teaching` | activities | teaching_id | — |
| `idx_observations_activity` | observations | activity_id | — |
| `idx_observations_enrollment` | observations | enrollment_id | — |
| `uq_assessment_criterio` (UNIQUE, parziale) | assessments | teaching_id, enrollment_id, assessment_period_id, criterion_id | un solo Assessment di criterio |
| `uq_assessment_materia` (UNIQUE, parziale) | assessments | teaching_id, enrollment_id, assessment_period_id | un solo Assessment di materia |
| `idx_assessments_enrollment` | assessments | enrollment_id | — |
| `idx_role_assignments_account` (parziale, WHERE revoked_at IS NULL) | role_assignments | account_id | risoluzione permessi effettivi |
| `idx_role_assignments_teaching` (parziale) | role_assignments | scope_teaching_id | "chi ha accesso a questo Teaching" |
| `idx_role_assignments_class` (parziale) | role_assignments | scope_class_id | idem per classe |
| `idx_role_assignments_tenant` (parziale) | role_assignments | tenant_id | idem per tenant |
| `idx_audit_log_tenant` | audit_log | tenant_id, created_at DESC | cronologia audit per tenant |
| `idx_audit_log_risorsa` | audit_log | risorsa, risorsa_id | indagine su una risorsa specifica |

---

## 7. RBAC

```text
roles              : id, codice (UNIQUE), nome, is_system
permissions        : id, codice (UNIQUE), descrizione
role_permissions   : (role_id, permission_id) — PK composta, grant-only, nessun DENY
role_assignments   : account_id, role_id, scope_type, + colonne di scope dedicate
```

**Rappresentazione dello scope**: `role_assignments` NON usa un `scope_id` polimorfico. Usa `scope_type` (CHECK su 6 valori: `PLATFORM`, `TENANT`, `SCHOOL_LEVEL`, `CLASS`, `TEACHING`, `STUDENT`) più **cinque colonne dedicate nullable**, una per tipo di scope possibile: `scope_tenant_id`, `scope_school_level_id`, `scope_class_id`, `scope_teaching_id`, `scope_student_person_id`, ciascuna con una propria FK reale verso la tabella corrispondente. Il CHECK `ck_role_assignment_scope_coerente` impone che, per ogni riga, sia valorizzata **esattamente** la colonna coerente con `scope_type` e tutte le altre siano NULL:

- `PLATFORM` → `tenant_id` e tutte le colonne di scope NULL
- `TENANT` → `tenant_id` NOT NULL e `scope_tenant_id = tenant_id`, resto NULL
- `SCHOOL_LEVEL` → `tenant_id` e `scope_school_level_id` NOT NULL, resto NULL
- `CLASS` → `tenant_id` e `scope_class_id` NOT NULL, resto NULL
- `TEACHING` → `tenant_id` e `scope_teaching_id` NOT NULL, resto NULL
- `STUDENT` → `tenant_id` e `scope_student_person_id` NOT NULL, resto NULL

Colonna `tenant_id` su `role_assignments`: NULL solo per `PLATFORM`, altrimenti sempre valorizzata (denormalizzata per indicizzazione e per le FK composte di scope).

---

## 8. Sessioni e sicurezza DB

| Concetto | Tabella.colonna |
|---|---|
| Identità autenticabile | `accounts.id`, `accounts.email` (UNIQUE), `accounts.password_hash`, `accounts.stato` |
| Appartenenza a un tenant | `memberships.account_id` + `memberships.tenant_id`, UNIQUE `(account_id, tenant_id)`, `memberships.stato` |
| Sessione | `sessions.account_id`, `sessions.token_hash` (UNIQUE, `char(64)`), `sessions.expires_at`, `sessions.last_seen_at`, `sessions.revoked_at`/`revoked_reason` |
| Token hash | `sessions.token_hash` — unica colonna relativa al token; **nessuna colonna contiene il token in chiaro** |
| Tenant context (attivo) | `sessions.active_tenant_id` (FK → `tenants.id`, nullable: nessun tenant attivo appena dopo il login) |

---

## 9. Audit

**Struttura** `audit_log`: `id, tenant_id (nullable), actor_account_id (nullable), azione, risorsa, risorsa_id (nullable), prima (jsonb, nullable), dopo (jsonb, nullable), correlation_id (nullable), created_at`. Nessuna colonna `updated_at` (coerente con append-only: una riga di audit non si aggiorna mai).

**Chi può scrivere**: il ruolo Postgres `app_role` — unico ruolo con cui `server/db.js` esegue le query applicative (via `SET ROLE app_role` a ogni connessione) — riceve `GRANT INSERT, SELECT ON audit_log TO app_role` e `GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO app_role` (migration 002).

**Chi non può modificarlo**: `app_role` NON riceve `UPDATE`/`DELETE` su `audit_log` (l'istruzione `GRANT SELECT, INSERT, UPDATE, DELETE ... TO app_role` della migration 002 è eseguita in loop su tutte le tabelle **tranne** `audit_log`, esplicitamente esclusa: `WHERE schemaname = 'public' AND tablename <> 'audit_log'`). Inoltre `REVOKE ALL ON audit_log FROM PUBLIC` toglie ogni privilegio di default.

**Proprietà**: `ALTER TABLE audit_log OWNER TO audit_owner` — un ruolo Postgres separato (`NOLOGIN`), diverso sia da `app_role` sia dal ruolo con cui si esegue la migration. Il ruolo di connessione riceve `GRANT app_role TO CURRENT_USER` per poter eseguire `SET ROLE app_role` nel codice applicativo.

**Trigger/vincoli specifici su audit_log**: nessuno oltre alle due FK semplici (`tenant_id → tenants`, `actor_account_id → accounts`) e ai due indici (§6). L'append-only è garantito **esclusivamente dai privilegi Postgres** (owner + GRANT/REVOKE), non da un trigger né da un vincolo CHECK.

**Proprietà append-only**: risultato di owner separato + privilegi minimi, non di una regola applicativa. Un bypass richiederebbe connettersi con un ruolo diverso da `app_role` (cioè non passare dall'applicazione).

---

## 10. Seed (`seed/seed_multitenant.sql`)

**Tenant creati**: `alfa` (Istituto Comprensivo Alfa), `beta` (Istituto Comprensivo Beta).

**Persone/Account creati** (8 account, password comune — vedi nota sotto):
`platform.admin@platform.test`, `tenant.admin.a@alfa.test`, `coordinator.a@alfa.test`, `teacher.math.a@alfa.test`, `teacher.italian.a@alfa.test`, `tenant.admin.b@beta.test`, `teacher.math.b@beta.test`, `multitenant.user@example.test`. Più 6 studenti come `people` senza account: A-Student-01..04 (tenant Alfa), B-Student-01..02 (tenant Beta).

**Membership**: tutti gli account tranne `platform.admin` (nessuna, scope PLATFORM) hanno Membership nel/i proprio/i tenant; `multitenant.user` ha Membership sia in Alfa sia in Beta.

**RoleAssignment**: `platform.admin` → PLATFORM_ADMIN/PLATFORM; `tenant.admin.a` → TENANT_ADMIN/TENANT(Alfa); `coordinator.a` → COORDINATOR/SCHOOL_LEVEL(Primaria, Alfa); `teacher.math.a` → TEACHER/TEACHING × 2 (Matematica 2A e 2B, Alfa); `teacher.italian.a` → TEACHER/TEACHING (Italiano 2A, Alfa); `multitenant.user` → TEACHER/TEACHING (Matematica 2B, Alfa, co-docenza) **e** COORDINATOR/SCHOOL_LEVEL (Primary, Beta); `tenant.admin.b` → TENANT_ADMIN/TENANT(Beta); `teacher.math.b` → TEACHER/TEACHING (Matematica e Logica 2A, Beta).

**Materie**: Alfa → Matematica, Italiano, Scienze (Scienze creata come `subjects` ma senza unità/criteri/Teaching); Beta → "Matematica e Logica", Italiano (Italiano di Beta creata come `subjects` senza unità/criteri).

**Unità pedagogiche/Criteri**: Alfa/Matematica → Numeri (4 criteri: NUM-1..4), Spazio e figure (2 criteri: SPA-1/2), Relazioni dati e previsioni (2 criteri: REL-1/2); Alfa/Italiano → Lettura e comprensione (2 criteri: LET-1/2). Beta/Matematica e Logica → Numeri (2 criteri: NUM-1/2), Spazio e figure (0 criteri).

**Classi**: Alfa → 2A, 2B (livello Primaria); Beta → 2A (livello Primary) — riga e `id` distinti dalla 2A di Alfa nonostante il nome identico.

**Scale di osservazione**: Alfa → scala di default (school_level_id NULL) a 3 valori `0=Non manifestato, 1=Con supporto, 2=Autonomo`; Beta → scala di default a 4 valori `1=Iniziale, 2=Base, 3=Intermedio, 4=Avanzato`. Nessun override per school_level in nessuno dei due tenant.

**Soglie di giudizio**: Alfa → 90 OTTIMO / 80 DISTINTO / 70 BUONO / 60 DISCRETO / 50 SUFFICIENTE / 0 NON SUFFICIENTE; Beta → 85 ECCELLENTE / 70 BUONO / 55 SUFFICIENTE / 0 INSUFFICIENTE.

**Teaching**: Alfa → Matematica 2A (teacher.math.a), Matematica 2B (teacher.math.a **e** multitenant.user, co-docenza), Italiano 2A (teacher.italian.a); Beta → Matematica e Logica 2A (teacher.math.b).

**Activity**: Alfa → "Numeri entro il cento" su Matematica 2A (06/10/2026) e su Matematica 2B (07/10/2026), "Lettura silenziosa" su Italiano 2A (08/10/2026); Beta → "Conteggio fino a 20" su Matematica e Logica 2A (06/10/2026).

**Observation**: 4 righe su Alfa (criterio NUM-1: A-Student-01=2, A-Student-02=0 su "Numeri entro il cento" 2A; A-Student-03=1 su "Numeri entro il cento" 2B; criterio LET-1: A-Student-01=2 su "Lettura silenziosa"); 2 righe su Beta (criterio NUM-1: B-Student-01=4, B-Student-02=2 su "Conteggio fino a 20").

**Assessment**: 1 riga su Alfa (A-Student-01, Matematica 2A, periodo "Primo quadrimestre" 01/09/2026–31/01/2027, giudizio `DISTINTO`, di materia — `criterion_id`/`pedagogical_unit_id` NULL). Nessun Assessment seminato su Beta.

**Password iniziali**: il seed contiene **hash Argon2id** (non password in chiaro) nella colonna `accounts.password_hash`, uno per ciascuno degli 8 account elencati sopra, righe `INSERT INTO accounts (...) VALUES (...)` (righe 42-50 del file). Tutti e otto gli hash corrispondono alla stessa password demo condivisa, documentata solo nel `README.md` del repository (non riportata qui perché non necessaria a verificare la migrazione: la migrazione dello schema/dati non richiede di conoscerla).

---

## 11. Comandi esatti di migrazione

Prerequisito: un ruolo Postgres con privilegio di creare tabelle, ruoli (`CREATE ROLE`) e funzioni/trigger nel database di destinazione (su Neon, il ruolo owner del database assegnato di default soddisfa questo requisito).

```text
psql "$DATABASE_URL" -f migrations/000_schema_base.sql
psql "$DATABASE_URL" -f migrations/001_ruoli_permessi_sistema.sql
psql "$DATABASE_URL" -f migrations/002_audit_append_only.sql
psql "$DATABASE_URL" -f seed/seed_multitenant.sql   # opzionale, solo per un ambiente di collaudo con dati di esempio
```

Ordine non intercambiabile: 001 richiede le tabelle `roles`/`permissions`/`role_permissions` create da 000; 002 richiede che `audit_log` e le altre tabelle esistano già (fa `ALTER TABLE`/`GRANT` su tabelle già create) ed esegue un `GRANT app_role TO CURRENT_USER`, quindi va eseguita con lo stesso ruolo che poi comparirà in `DATABASE_URL` dell'applicazione (o un suo membro). Il seed presuppone 000+001+002 già applicate (referenzia `roles`, tabelle di dominio, e il ruolo `app_role` implicitamente tramite i privilegi già concessi).

---

## 12. Verifica finale

```text
DATABASE V1 SNAPSHOT
Commit: f8d319d
Tag: v1.0.0
Schema: 25 tabelle, integrità cross-tenant/anno/classe/materia/scala quasi interamente tramite FK composte
Migration: 000_schema_base.sql (schema) → 001_ruoli_permessi_sistema.sql (RBAC di sistema) → 002_audit_append_only.sql (ruoli DB app_role/audit_owner)
Seed: seed/seed_multitenant.sql — 2 tenant, 8 account, 6 studenti, 2 scale distinte (0-2 e 1-4), 4 Teaching, 4 Activity, 6 Observation, 1 Assessment
Trigger: 1 solo — trg_teaching_struttura_immutabile su teachings (BEFORE UPDATE)
RBAC: roles/permissions/role_permissions (grant-only) + role_assignments con scope a colonne dedicate (PLATFORM/TENANT/SCHOOL_LEVEL/CLASS/TEACHING/STUDENT)
Audit: audit_log, owner audit_owner, app_role limitato a INSERT/SELECT, append-only per privilegio Postgres (non per trigger)
```

Documento di sola fotografia tecnica: nessuna raccomandazione, nessuna modifica proposta, nessun file del repository alterato nella produzione di questo documento.
