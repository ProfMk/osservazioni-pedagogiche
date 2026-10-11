-- =====================================================================
-- seed_multitenant.sql — dati di esempio realistici multi-tenant
--
-- NON eseguire su Neon con dati reali: password di sviluppo condivisa
-- ("Sviluppo!2026" per tutti gli account), pensata solo per il primo
-- collaudo locale/di test. Sostituire con un vero processo di provisioning
-- prima di qualunque uso reale (vedi README).
--
-- Contenuto (sez. 46-58 dell'architettura):
--   Tenant A "Istituto Comprensivo Alfa": Primaria + Secondaria I grado,
--     Matematica/Italiano/Scienze, classi 2A/2B, 4 studenti, 3 Teaching,
--     scala di osservazione 0/1/2, soglie di giudizio 90/80/70/60/50.
--   Tenant B "Istituto Comprensivo Beta": Primary + Middle School,
--     "Matematica e Logica"/Italiano, classe 2A (diversa da quella del
--     Tenant A pur avendo lo stesso nome), 2 studenti, 1 Teaching,
--     scala di osservazione 1-4 e soglie DIVERSE, per dimostrare che la
--     configurazione è realmente tenant-owned.
--   Un account multi-tenant (Membership in A e in B, ruoli diversi).
-- =====================================================================

-- ---------------------------------------------------------------------
-- TENANT
-- ---------------------------------------------------------------------
-- Configurazione linguistica (V2, C2/B-1): una sola lingua abilitata per tenant, caso
-- particolare ammesso di C2. Tenant e lingue nella stessa transazione: la FK
-- "lingua predefinita abilitata" è differita al COMMIT.
BEGIN;
INSERT INTO tenants (slug, nome, lingua_predefinita, lingua_contenuti, regione) VALUES
  ('alfa', 'Istituto Comprensivo Alfa', 'it', 'it', 'IT'),
  ('beta', 'Istituto Comprensivo Beta', 'it', 'it', 'IT');
INSERT INTO tenant_languages (tenant_id, lingua) VALUES
  ((SELECT id FROM tenants WHERE slug = 'alfa'), 'it'),
  ((SELECT id FROM tenants WHERE slug = 'beta'), 'it');
COMMIT;

-- ---------------------------------------------------------------------
-- PERSONE (identità globale di chi ha un Account: tenant_id NULL) E ACCOUNT
-- Password di sviluppo per TUTTI: "Sviluppo!2026" (vedi README).
-- ---------------------------------------------------------------------
INSERT INTO people (tenant_id, nome, cognome) VALUES
  (NULL, 'Piera',    'Piattaforma'),   -- platform.admin
  (NULL, 'Tea',       'AmministratriceAlfa'), -- tenant.admin.a
  (NULL, 'Cora',      'Coordinatrice'), -- coordinator.a
  (NULL, 'Mara',      'Matematica'),   -- teacher.math.a
  (NULL, 'Ida',       'Italiano'),     -- teacher.italian.a
  (NULL, 'Beba',      'AmministratriceBeta'), -- tenant.admin.b
  (NULL, 'Bruno',     'Numeri'),       -- teacher.math.b
  (NULL, 'Mia',       'Multitenant');  -- multitenant.user

INSERT INTO accounts (email, password_hash, person_id) VALUES
  ('platform.admin@platform.test', '$argon2id$v=19$m=19456,t=2,p=1$anfPS2sMVA/OVDlI49sVpw$4c5IbqyEy2qPTzxA9I35/av1puAjtNRPccbK5EUGJhc', (SELECT id FROM people WHERE cognome = 'Piattaforma')),
  ('tenant.admin.a@alfa.test',     '$argon2id$v=19$m=19456,t=2,p=1$5jii2qe2T/mPt3uozh5wiA$GO76UGi/3W36VlRGgMsqNAVGiitmv6b4ECa7MQ7r+Ow', (SELECT id FROM people WHERE cognome = 'AmministratriceAlfa')),
  ('coordinator.a@alfa.test',      '$argon2id$v=19$m=19456,t=2,p=1$j3OiqvjBXlv8GsVqFCOxTw$CBtUeOkDZg4/VZP4CPGtEGh1mfEdWrcXybe5PjLrhp4', (SELECT id FROM people WHERE cognome = 'Coordinatrice')),
  ('teacher.math.a@alfa.test',     '$argon2id$v=19$m=19456,t=2,p=1$0fOqESWAcMWdt7GBMcz54A$rJMCJGwGgeRxFkyIfzPHBKsC3RW+196UJ3bYa0TN58w', (SELECT id FROM people WHERE cognome = 'Matematica')),
  ('teacher.italian.a@alfa.test',  '$argon2id$v=19$m=19456,t=2,p=1$aba1eU7NRGGuNuBbbBER2Q$cX6+iSwKAYOw91Qngpq7g9KFEMSdgAbKxdCl6ABB0i4', (SELECT id FROM people WHERE cognome = 'Italiano')),
  ('tenant.admin.b@beta.test',     '$argon2id$v=19$m=19456,t=2,p=1$lAIyeMURRNHP9+J+UdhCYg$4conDr19RsT5Uu7bIP712EPY0eqZBJxgiw9xXTfht5Y', (SELECT id FROM people WHERE cognome = 'AmministratriceBeta')),
  ('teacher.math.b@beta.test',     '$argon2id$v=19$m=19456,t=2,p=1$wHb1rcV+xhKqaYEd9UCTKw$G8PUEHjm4yRz2EPE26zYAPHjBcLfo75Ym/6hoEOG7I4', (SELECT id FROM people WHERE cognome = 'Numeri')),
  ('multitenant.user@example.test','$argon2id$v=19$m=19456,t=2,p=1$67gM75Wby47WY6OKIDZnOw$nzqdCZtZzXp/vITa49WQZ1MBmB2sJKRvAUNB7+rPWDc', (SELECT id FROM people WHERE cognome = 'Multitenant'));

-- ---------------------------------------------------------------------
-- MEMBERSHIP (sez. 55: multitenant.user appartiene sia ad Alfa sia a Beta)
-- ---------------------------------------------------------------------
INSERT INTO memberships (account_id, tenant_id) VALUES
  ((SELECT id FROM accounts WHERE email = 'tenant.admin.a@alfa.test'),    (SELECT id FROM tenants WHERE slug = 'alfa')),
  ((SELECT id FROM accounts WHERE email = 'coordinator.a@alfa.test'),     (SELECT id FROM tenants WHERE slug = 'alfa')),
  ((SELECT id FROM accounts WHERE email = 'teacher.math.a@alfa.test'),    (SELECT id FROM tenants WHERE slug = 'alfa')),
  ((SELECT id FROM accounts WHERE email = 'teacher.italian.a@alfa.test'), (SELECT id FROM tenants WHERE slug = 'alfa')),
  ((SELECT id FROM accounts WHERE email = 'tenant.admin.b@beta.test'),    (SELECT id FROM tenants WHERE slug = 'beta')),
  ((SELECT id FROM accounts WHERE email = 'teacher.math.b@beta.test'),    (SELECT id FROM tenants WHERE slug = 'beta')),
  ((SELECT id FROM accounts WHERE email = 'multitenant.user@example.test'), (SELECT id FROM tenants WHERE slug = 'alfa')),
  ((SELECT id FROM accounts WHERE email = 'multitenant.user@example.test'), (SELECT id FROM tenants WHERE slug = 'beta'));
-- platform.admin non ha alcuna Membership (sez. 7): il suo scope è PLATFORM.


-- =======================================================================
-- TENANT A — Istituto Comprensivo Alfa
-- =======================================================================

INSERT INTO school_levels (tenant_id, nome, ordine) VALUES
  ((SELECT id FROM tenants WHERE slug = 'alfa'), 'Primaria', 1),
  ((SELECT id FROM tenants WHERE slug = 'alfa'), 'Secondaria di primo grado', 2);

INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine) VALUES
  ((SELECT id FROM tenants WHERE slug = 'alfa'), '2026/2027', '2026-09-01', '2027-06-30');

INSERT INTO subjects (tenant_id, school_level_id, school_year_id, nome, ordine) VALUES
  ((SELECT id FROM tenants WHERE slug = 'alfa'),
   (SELECT id FROM school_levels WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = 'Primaria'),
   (SELECT id FROM school_years WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = '2026/2027'),
   'Matematica', 1),
  ((SELECT id FROM tenants WHERE slug = 'alfa'),
   (SELECT id FROM school_levels WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = 'Primaria'),
   (SELECT id FROM school_years WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = '2026/2027'),
   'Italiano', 2),
  ((SELECT id FROM tenants WHERE slug = 'alfa'),
   (SELECT id FROM school_levels WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = 'Primaria'),
   (SELECT id FROM school_years WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = '2026/2027'),
   'Scienze', 3);

-- Unità pedagogiche di Matematica (Alfa): stessi nomi dei materiali reali del progetto.
INSERT INTO pedagogical_units (tenant_id, school_year_id, subject_id, nome, ordine) VALUES
  ((SELECT id FROM tenants WHERE slug = 'alfa'),
   (SELECT id FROM school_years WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = '2026/2027'),
   (SELECT id FROM subjects WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = 'Matematica'),
   'Numeri', 1),
  ((SELECT id FROM tenants WHERE slug = 'alfa'),
   (SELECT id FROM school_years WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = '2026/2027'),
   (SELECT id FROM subjects WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = 'Matematica'),
   'Spazio e figure', 2),
  ((SELECT id FROM tenants WHERE slug = 'alfa'),
   (SELECT id FROM school_years WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = '2026/2027'),
   (SELECT id FROM subjects WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = 'Matematica'),
   'Relazioni, dati e previsioni', 3);

INSERT INTO pedagogical_units (tenant_id, school_year_id, subject_id, nome, ordine) VALUES
  ((SELECT id FROM tenants WHERE slug = 'alfa'),
   (SELECT id FROM school_years WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = '2026/2027'),
   (SELECT id FROM subjects WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alfa') AND nome = 'Italiano'),
   'Lettura e comprensione', 1);

-- Criteri: 4 per unità di Matematica, 2 per l'unità di Italiano (sez. 50: 2-4 per unità).
INSERT INTO criteria (tenant_id, school_year_id, pedagogical_unit_id, codice, descrizione, ordine) VALUES
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Numeri'),
   'NUM-1', 'Correttezza numerica', 1),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Numeri'),
   'NUM-2', 'Valore posizionale', 2),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Numeri'),
   'NUM-3', 'Calcolo', 3),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Numeri'),
   'NUM-4', 'Autonomia', 4),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Spazio e figure'),
   'SPA-1', 'Orientamento e relazioni spaziali', 1),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Spazio e figure'),
   'SPA-2', 'Figure geometriche e proprietà', 2),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Relazioni, dati e previsioni'),
   'REL-1', 'Classificazione e relazioni', 1),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Relazioni, dati e previsioni'),
   'REL-2', 'Dati e rappresentazioni', 2),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Italiano' AND p.nome='Lettura e comprensione'),
   'LET-1', 'Comprensione del testo', 1),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Italiano' AND p.nome='Lettura e comprensione'),
   'LET-2', 'Fluenza di lettura', 2);

-- Scala di osservazione di Alfa: default di tenant 0/1/2 (continuità col prototipo).
INSERT INTO observation_scales (tenant_id, school_level_id, nome) VALUES
  ((SELECT id FROM tenants WHERE slug = 'alfa'), NULL, 'Scala a 3 livelli (Alfa, default)');
INSERT INTO observation_scale_values (scale_id, valore, etichetta, ordine) VALUES
  ((SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND school_level_id IS NULL), 0, 'Non manifestato', 1),
  ((SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND school_level_id IS NULL), 1, 'Con supporto', 2),
  ((SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND school_level_id IS NULL), 2, 'Autonomo', 3);

INSERT INTO judgment_bands (tenant_id, school_level_id, soglia_minima, etichetta) VALUES
  ((SELECT id FROM tenants WHERE slug = 'alfa'), NULL, 90, 'OTTIMO'),
  ((SELECT id FROM tenants WHERE slug = 'alfa'), NULL, 80, 'DISTINTO'),
  ((SELECT id FROM tenants WHERE slug = 'alfa'), NULL, 70, 'BUONO'),
  ((SELECT id FROM tenants WHERE slug = 'alfa'), NULL, 60, 'DISCRETO'),
  ((SELECT id FROM tenants WHERE slug = 'alfa'), NULL, 50, 'SUFFICIENTE'),
  ((SELECT id FROM tenants WHERE slug = 'alfa'), NULL, 0,  'NON SUFFICIENTE');

INSERT INTO classes (tenant_id, school_level_id, nome) VALUES
  ((SELECT id FROM tenants WHERE slug = 'alfa'), (SELECT id FROM school_levels WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Primaria'), '2A'),
  ((SELECT id FROM tenants WHERE slug = 'alfa'), (SELECT id FROM school_levels WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Primaria'), '2B');

INSERT INTO people (tenant_id, nome, cognome) VALUES
  ((SELECT id FROM tenants WHERE slug = 'alfa'), 'A-Student-01', 'Alfa'),
  ((SELECT id FROM tenants WHERE slug = 'alfa'), 'A-Student-02', 'Alfa'),
  ((SELECT id FROM tenants WHERE slug = 'alfa'), 'A-Student-03', 'Alfa'),
  ((SELECT id FROM tenants WHERE slug = 'alfa'), 'A-Student-04', 'Alfa');

INSERT INTO enrollments (tenant_id, school_year_id, class_id, student_person_id) VALUES
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A'),
   (SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='A-Student-01')),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A'),
   (SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='A-Student-02')),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2B'),
   (SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='A-Student-03')),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2B'),
   (SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='A-Student-04'));

-- Teaching: Matematica 2A e 2B (teacher.math.a, multi-scope sez. 54), Italiano 2A (teacher.italian.a).
-- Co-docenza su Matematica 2B: multitenant.user (sez. 55/56), a dimostrare più docenti sullo stesso Teaching-slot.
INSERT INTO teachings (tenant_id, school_year_id, class_id, subject_id, account_id) VALUES
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A'),
   (SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Matematica'),
   (SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test')),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2B'),
   (SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Matematica'),
   (SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test')),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A'),
   (SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Italiano'),
   (SELECT id FROM accounts WHERE email='teacher.italian.a@alfa.test')),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2B'),
   (SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Matematica'),
   (SELECT id FROM accounts WHERE email='multitenant.user@example.test'));

INSERT INTO activities (tenant_id, school_year_id, teaching_id, class_id, subject_id, pedagogical_unit_id, nome, data_attivita, lingua_contenuto) VALUES
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT t.id FROM teachings t WHERE t.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND t.class_id=(SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A') AND t.subject_id=(SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Matematica') AND t.account_id=(SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test')),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A'),
   (SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Matematica'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Numeri'),
   'Numeri entro il cento', '2026-10-06', 'it'),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT t.id FROM teachings t WHERE t.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND t.class_id=(SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2B') AND t.subject_id=(SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Matematica') AND t.account_id=(SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test')),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2B'),
   (SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Matematica'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Numeri'),
   'Numeri entro il cento', '2026-10-07', 'it'),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT t.id FROM teachings t WHERE t.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND t.class_id=(SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A') AND t.subject_id=(SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Italiano') AND t.account_id=(SELECT id FROM accounts WHERE email='teacher.italian.a@alfa.test')),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A'),
   (SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Italiano'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Italiano' AND p.nome='Lettura e comprensione'),
   'Lettura silenziosa', '2026-10-08', 'it');

-- Observation: 2A Mathematics, 2B Mathematics, 2A Italian, con valori differenti (sez. 58).
INSERT INTO observations (tenant_id, school_year_id, activity_id, enrollment_id, class_id, criterion_id, pedagogical_unit_id, scale_id, valore, recorded_by_account_id, data_osservazione) VALUES
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT id FROM activities WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Numeri entro il cento' AND class_id=(SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A')),
   (SELECT id FROM enrollments WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND student_person_id=(SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='A-Student-01')),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A'),
   (SELECT id FROM criteria WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND codice='NUM-1'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Numeri'),
   (SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND school_level_id IS NULL),
   2, (SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test'), '2026-10-06'),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT id FROM activities WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Numeri entro il cento' AND class_id=(SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A')),
   (SELECT id FROM enrollments WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND student_person_id=(SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='A-Student-02')),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A'),
   (SELECT id FROM criteria WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND codice='NUM-1'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Numeri'),
   (SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND school_level_id IS NULL),
   0, (SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test'), '2026-10-06'),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT id FROM activities WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Numeri entro il cento' AND class_id=(SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2B')),
   (SELECT id FROM enrollments WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND student_person_id=(SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='A-Student-03')),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2B'),
   (SELECT id FROM criteria WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND codice='NUM-1'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Matematica' AND p.nome='Numeri'),
   (SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND school_level_id IS NULL),
   1, (SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test'), '2026-10-07'),
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT id FROM activities WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Lettura silenziosa'),
   (SELECT id FROM enrollments WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND student_person_id=(SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='A-Student-01')),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A'),
   (SELECT id FROM criteria WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND codice='LET-1'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND s.nome='Italiano' AND p.nome='Lettura e comprensione'),
   (SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND school_level_id IS NULL),
   2, (SELECT id FROM accounts WHERE email='teacher.italian.a@alfa.test'), '2026-10-08');

INSERT INTO assessment_periods (tenant_id, school_year_id, nome, data_inizio, data_fine) VALUES
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   'Primo quadrimestre', '2026-09-01', '2027-01-31');

INSERT INTO assessments (tenant_id, school_year_id, teaching_id, class_id, subject_id, enrollment_id, assessment_period_id, giudizio, recorded_by_account_id, lingua_contenuto) VALUES
  ((SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2026/2027'),
   (SELECT t.id FROM teachings t WHERE t.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND t.class_id=(SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A') AND t.subject_id=(SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Matematica') AND t.account_id=(SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test')),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A'),
   (SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Matematica'),
   (SELECT id FROM enrollments WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND student_person_id=(SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='A-Student-01')),
   (SELECT id FROM assessment_periods WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Primo quadrimestre'),
   'DISTINTO', (SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test'), 'it');


-- =======================================================================
-- TENANT B — Istituto Comprensivo Beta (configurazione volutamente diversa)
-- =======================================================================

INSERT INTO school_levels (tenant_id, nome, ordine) VALUES
  ((SELECT id FROM tenants WHERE slug = 'beta'), 'Primary', 1),
  ((SELECT id FROM tenants WHERE slug = 'beta'), 'Middle School', 2);

INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine) VALUES
  ((SELECT id FROM tenants WHERE slug = 'beta'), '2026/2027', '2026-09-01', '2027-06-30');

INSERT INTO subjects (tenant_id, school_level_id, school_year_id, nome, ordine) VALUES
  ((SELECT id FROM tenants WHERE slug = 'beta'),
   (SELECT id FROM school_levels WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='Primary'),
   (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2026/2027'),
   'Matematica e Logica', 1),
  ((SELECT id FROM tenants WHERE slug = 'beta'),
   (SELECT id FROM school_levels WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='Primary'),
   (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2026/2027'),
   'Italiano', 2);

INSERT INTO pedagogical_units (tenant_id, school_year_id, subject_id, nome, ordine) VALUES
  ((SELECT id FROM tenants WHERE slug='beta'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2026/2027'),
   (SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='Matematica e Logica'), 'Numeri', 1),
  ((SELECT id FROM tenants WHERE slug='beta'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2026/2027'),
   (SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='Matematica e Logica'), 'Spazio e figure', 2);

INSERT INTO criteria (tenant_id, school_year_id, pedagogical_unit_id, codice, descrizione, ordine) VALUES
  ((SELECT id FROM tenants WHERE slug='beta'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2026/2027'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND s.nome='Matematica e Logica' AND p.nome='Numeri'),
   'NUM-1', 'Conteggio ed enumerazione', 1),
  ((SELECT id FROM tenants WHERE slug='beta'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2026/2027'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND s.nome='Matematica e Logica' AND p.nome='Numeri'),
   'NUM-2', 'Ragionamento logico', 2);

-- Scala di osservazione DIVERSA da Alfa (1-4): dimostra che la scala è configurabile per tenant (sez. 26/27).
INSERT INTO observation_scales (tenant_id, school_level_id, nome) VALUES
  ((SELECT id FROM tenants WHERE slug = 'beta'), NULL, 'Scala a 4 livelli (Beta, default)');
INSERT INTO observation_scale_values (scale_id, valore, etichetta, ordine) VALUES
  ((SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND school_level_id IS NULL), 1, 'Iniziale', 1),
  ((SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND school_level_id IS NULL), 2, 'Base', 2),
  ((SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND school_level_id IS NULL), 3, 'Intermedio', 3),
  ((SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND school_level_id IS NULL), 4, 'Avanzato', 4);

-- Soglie DIVERSE da Alfa: altra prova di configurazione tenant-owned.
INSERT INTO judgment_bands (tenant_id, school_level_id, soglia_minima, etichetta) VALUES
  ((SELECT id FROM tenants WHERE slug = 'beta'), NULL, 85, 'ECCELLENTE'),
  ((SELECT id FROM tenants WHERE slug = 'beta'), NULL, 70, 'BUONO'),
  ((SELECT id FROM tenants WHERE slug = 'beta'), NULL, 55, 'SUFFICIENTE'),
  ((SELECT id FROM tenants WHERE slug = 'beta'), NULL, 0,  'INSUFFICIENTE');

-- Classe "2A" di Beta: stesso nome della "2A" di Alfa, ma riga e tenant_id completamente diversi (sez. 51).
INSERT INTO classes (tenant_id, school_level_id, nome) VALUES
  ((SELECT id FROM tenants WHERE slug = 'beta'), (SELECT id FROM school_levels WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='Primary'), '2A');

INSERT INTO people (tenant_id, nome, cognome) VALUES
  ((SELECT id FROM tenants WHERE slug = 'beta'), 'B-Student-01', 'Beta'),
  ((SELECT id FROM tenants WHERE slug = 'beta'), 'B-Student-02', 'Beta');

INSERT INTO enrollments (tenant_id, school_year_id, class_id, student_person_id) VALUES
  ((SELECT id FROM tenants WHERE slug='beta'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2026/2027'),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2A'),
   (SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='B-Student-01')),
  ((SELECT id FROM tenants WHERE slug='beta'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2026/2027'),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2A'),
   (SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='B-Student-02'));

INSERT INTO teachings (tenant_id, school_year_id, class_id, subject_id, account_id) VALUES
  ((SELECT id FROM tenants WHERE slug='beta'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2026/2027'),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2A'),
   (SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='Matematica e Logica'),
   (SELECT id FROM accounts WHERE email='teacher.math.b@beta.test'));

INSERT INTO activities (tenant_id, school_year_id, teaching_id, class_id, subject_id, pedagogical_unit_id, nome, data_attivita, lingua_contenuto) VALUES
  ((SELECT id FROM tenants WHERE slug='beta'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2026/2027'),
   (SELECT t.id FROM teachings t WHERE t.tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND t.account_id=(SELECT id FROM accounts WHERE email='teacher.math.b@beta.test')),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2A'),
   (SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='Matematica e Logica'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND s.nome='Matematica e Logica' AND p.nome='Numeri'),
   'Conteggio fino a 20', '2026-10-06', 'it');

INSERT INTO observations (tenant_id, school_year_id, activity_id, enrollment_id, class_id, criterion_id, pedagogical_unit_id, scale_id, valore, recorded_by_account_id, data_osservazione) VALUES
  ((SELECT id FROM tenants WHERE slug='beta'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2026/2027'),
   (SELECT id FROM activities WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='Conteggio fino a 20'),
   (SELECT id FROM enrollments WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND student_person_id=(SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='B-Student-01')),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2A'),
   (SELECT id FROM criteria WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND codice='NUM-1'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND s.nome='Matematica e Logica' AND p.nome='Numeri'),
   (SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND school_level_id IS NULL),
   4, (SELECT id FROM accounts WHERE email='teacher.math.b@beta.test'), '2026-10-06'),
  ((SELECT id FROM tenants WHERE slug='beta'), (SELECT id FROM school_years WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2026/2027'),
   (SELECT id FROM activities WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='Conteggio fino a 20'),
   (SELECT id FROM enrollments WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND student_person_id=(SELECT id FROM people WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='B-Student-02')),
   (SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='2A'),
   (SELECT id FROM criteria WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND codice='NUM-1'),
   (SELECT p.id FROM pedagogical_units p JOIN subjects s ON s.id=p.subject_id WHERE s.tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND s.nome='Matematica e Logica' AND p.nome='Numeri'),
   (SELECT id FROM observation_scales WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND school_level_id IS NULL),
   2, (SELECT id FROM accounts WHERE email='teacher.math.b@beta.test'), '2026-10-06');


-- =======================================================================
-- ROLE ASSIGNMENT (sez. 53-56)
-- =======================================================================

-- Platform admin: scope PLATFORM, nessun tenant.
INSERT INTO role_assignments (account_id, role_id, scope_type) VALUES
  ((SELECT id FROM accounts WHERE email='platform.admin@platform.test'), (SELECT id FROM roles WHERE codice='PLATFORM_ADMIN'), 'PLATFORM');

-- Tenant A.
INSERT INTO role_assignments (account_id, role_id, scope_type, tenant_id, scope_tenant_id) VALUES
  ((SELECT id FROM accounts WHERE email='tenant.admin.a@alfa.test'), (SELECT id FROM roles WHERE codice='TENANT_ADMIN'), 'TENANT',
   (SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM tenants WHERE slug='alfa'));

INSERT INTO role_assignments (account_id, role_id, scope_type, tenant_id, scope_school_level_id) VALUES
  ((SELECT id FROM accounts WHERE email='coordinator.a@alfa.test'), (SELECT id FROM roles WHERE codice='COORDINATOR'), 'SCHOOL_LEVEL',
   (SELECT id FROM tenants WHERE slug='alfa'), (SELECT id FROM school_levels WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Primaria'));

-- teacher.math.a: due Teaching distinti (2A e 2B), sez. 54 "multi-role test".
INSERT INTO role_assignments (account_id, role_id, scope_type, tenant_id, scope_teaching_id) VALUES
  ((SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test'), (SELECT id FROM roles WHERE codice='TEACHER'), 'TEACHING',
   (SELECT id FROM tenants WHERE slug='alfa'),
   (SELECT t.id FROM teachings t WHERE t.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND t.class_id=(SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A') AND t.subject_id=(SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Matematica') AND t.account_id=(SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test'))),
  ((SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test'), (SELECT id FROM roles WHERE codice='TEACHER'), 'TEACHING',
   (SELECT id FROM tenants WHERE slug='alfa'),
   (SELECT t.id FROM teachings t WHERE t.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND t.class_id=(SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2B') AND t.subject_id=(SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Matematica') AND t.account_id=(SELECT id FROM accounts WHERE email='teacher.math.a@alfa.test')));

INSERT INTO role_assignments (account_id, role_id, scope_type, tenant_id, scope_teaching_id) VALUES
  ((SELECT id FROM accounts WHERE email='teacher.italian.a@alfa.test'), (SELECT id FROM roles WHERE codice='TEACHER'), 'TEACHING',
   (SELECT id FROM tenants WHERE slug='alfa'),
   (SELECT t.id FROM teachings t WHERE t.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND t.class_id=(SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2A') AND t.subject_id=(SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Italiano') AND t.account_id=(SELECT id FROM accounts WHERE email='teacher.italian.a@alfa.test')));

-- multitenant.user in Alfa: TEACHER sul suo Teaching di co-docenza (2B Matematica).
INSERT INTO role_assignments (account_id, role_id, scope_type, tenant_id, scope_teaching_id) VALUES
  ((SELECT id FROM accounts WHERE email='multitenant.user@example.test'), (SELECT id FROM roles WHERE codice='TEACHER'), 'TEACHING',
   (SELECT id FROM tenants WHERE slug='alfa'),
   (SELECT t.id FROM teachings t WHERE t.tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND t.class_id=(SELECT id FROM classes WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='2B') AND t.subject_id=(SELECT id FROM subjects WHERE tenant_id=(SELECT id FROM tenants WHERE slug='alfa') AND nome='Matematica') AND t.account_id=(SELECT id FROM accounts WHERE email='multitenant.user@example.test')));

-- Tenant B.
INSERT INTO role_assignments (account_id, role_id, scope_type, tenant_id, scope_tenant_id) VALUES
  ((SELECT id FROM accounts WHERE email='tenant.admin.b@beta.test'), (SELECT id FROM roles WHERE codice='TENANT_ADMIN'), 'TENANT',
   (SELECT id FROM tenants WHERE slug='beta'), (SELECT id FROM tenants WHERE slug='beta'));

INSERT INTO role_assignments (account_id, role_id, scope_type, tenant_id, scope_teaching_id) VALUES
  ((SELECT id FROM accounts WHERE email='teacher.math.b@beta.test'), (SELECT id FROM roles WHERE codice='TEACHER'), 'TEACHING',
   (SELECT id FROM tenants WHERE slug='beta'),
   (SELECT t.id FROM teachings t WHERE t.tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND t.account_id=(SELECT id FROM accounts WHERE email='teacher.math.b@beta.test')));

-- multitenant.user in Beta: ruolo DIVERSO da quello che ha in Alfa (COORDINATOR invece di TEACHER, sez. 55).
INSERT INTO role_assignments (account_id, role_id, scope_type, tenant_id, scope_school_level_id) VALUES
  ((SELECT id FROM accounts WHERE email='multitenant.user@example.test'), (SELECT id FROM roles WHERE codice='COORDINATOR'), 'SCHOOL_LEVEL',
   (SELECT id FROM tenants WHERE slug='beta'), (SELECT id FROM school_levels WHERE tenant_id=(SELECT id FROM tenants WHERE slug='beta') AND nome='Primary'));
