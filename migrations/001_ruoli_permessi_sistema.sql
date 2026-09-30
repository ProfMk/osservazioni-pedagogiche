-- =====================================================================
-- 001_ruoli_permessi_sistema.sql
--
-- Ruoli e permessi di SISTEMA (sez. 15: "l'MVP usa ruoli di sistema, non
-- ruoli arbitrariamente configurabili dal tenant"). Dati di configurazione
-- dell'applicazione, non dati di esempio: per questo vivono in migrations/
-- e non in seed/, ed esistono anche in produzione.
--
-- Modello grant-only (sez. 16): nessun DENY, il risultato finale è un OR
-- delle autorizzazioni valide.
-- =====================================================================

INSERT INTO permissions (codice, descrizione) VALUES
  ('platform.manage_tenants',   'Creare, sospendere e amministrare i tenant della piattaforma'),
  ('platform.manage_users',     'Amministrare account e membership a livello di piattaforma'),
  ('tenant.manage_users',       'Creare/gestire account e membership all''interno del proprio tenant'),
  ('tenant.manage_roles',       'Assegnare/revocare RoleAssignment all''interno del proprio tenant'),
  ('tenant.manage_config',      'Configurare livelli scolastici, materie, unità pedagogiche, criteri, scale'),
  ('class.read',                'Leggere classi e iscrizioni'),
  ('class.manage',              'Creare/gestire classi e iscrizioni'),
  ('teaching.read',             'Leggere i Teaching'),
  ('teaching.manage',           'Creare/gestire Teaching'),
  ('activity.read',             'Leggere le Activity'),
  ('activity.create',           'Creare Activity'),
  ('observation.read',          'Leggere le Observation'),
  ('observation.create',        'Creare/modificare Observation'),
  ('assessment.read',           'Leggere gli Assessment'),
  ('assessment.create',         'Creare/modificare Assessment'),
  ('report.read',               'Leggere i report di classe/attività'),
  ('audit.read',                'Consultare l''audit log');

INSERT INTO roles (codice, nome, is_system) VALUES
  ('PLATFORM_ADMIN', 'Amministratore di piattaforma', true),
  ('TENANT_ADMIN',   'Amministratore di istituto',   true),
  ('COORDINATOR',    'Coordinatore',                 true),
  ('TEACHER',        'Docente',                      true);

-- PLATFORM_ADMIN: ruolo "super", con ogni permesso. Assegnato sempre con
-- scope_type = PLATFORM: la risoluzione dei permessi (server/lib/autorizzazione.js)
-- tratta uno scope PLATFORM come valido per qualunque tenant/risorsa (sez. 9).
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE codice = 'PLATFORM_ADMIN'), id FROM permissions;

INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE codice = 'TENANT_ADMIN'), id FROM permissions
WHERE codice IN (
  'tenant.manage_users', 'tenant.manage_roles', 'tenant.manage_config',
  'class.read', 'class.manage', 'teaching.read', 'teaching.manage',
  'activity.read', 'observation.read', 'assessment.read', 'report.read', 'audit.read'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE codice = 'COORDINATOR'), id FROM permissions
WHERE codice IN (
  'class.read', 'teaching.read', 'activity.read',
  'observation.read', 'assessment.read', 'report.read'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE codice = 'TEACHER'), id FROM permissions
WHERE codice IN (
  'teaching.read', 'activity.read', 'activity.create',
  'observation.read', 'observation.create', 'assessment.read', 'assessment.create', 'report.read'
);
