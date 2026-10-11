'use strict';

/**
 * Gestione dei RoleAssignment (sez. 16: grant-only, "non si può concedere
 * più di quanto si possiede"). Regola applicata qui (V1, volutamente
 * semplice): solo un PLATFORM_ADMIN può assegnare scope PLATFORM o il ruolo
 * PLATFORM_ADMIN; per ogni altro scope (tenant-bound) serve il permesso
 * 'tenant.manage_roles' nel tenant di destinazione (posseduto da un
 * PLATFORM_ADMIN o da un TENANT_ADMIN del tenant stesso).
 */

const { vietato, datiNonValidi } = require('../lib/erroreApplicativo');
const { isPlatformAdmin, haPermesso } = require('../lib/autorizzazione');

async function creaRoleAssignment(client, { creatoreAccountId, accountId, roleCodice, scopeType, tenantId, scopeIds = {} }) {
  const creatoreEPlatformAdmin = await isPlatformAdmin(client, creatoreAccountId);

  if (scopeType === 'PLATFORM' || roleCodice === 'PLATFORM_ADMIN') {
    if (!creatoreEPlatformAdmin) throw vietato('ERR_ROLE_ASSIGNMENT_PLATFORM_ONLY');
  } else {
    if (!tenantId) throw datiNonValidi('ERR_REQUIRED_FIELD', { campo: 'UI_FIELD_TENANT_ID' });
    if (!creatoreEPlatformAdmin) {
      const puo = await haPermesso(client, { accountId: creatoreAccountId, permesso: 'tenant.manage_roles', tenantId });
      if (!puo) throw vietato('ERR_PERMISSION_MISSING', { permesso: 'PERMISSION_TENANT_MANAGE_ROLES' });
    }
  }

  const { rows: ruoloRows } = await client.query('SELECT id FROM roles WHERE codice = $1', [roleCodice]);
  if (ruoloRows.length === 0) throw datiNonValidi('ERR_ROLE_UNKNOWN', { ruolo: String(roleCodice) });

  const colonne = {
    scope_tenant_id: null, scope_school_level_id: null, scope_class_id: null, scope_teaching_id: null, scope_student_person_id: null,
  };
  if (scopeType === 'TENANT') colonne.scope_tenant_id = tenantId;
  else if (scopeType === 'SCHOOL_LEVEL') colonne.scope_school_level_id = scopeIds.schoolLevelId;
  else if (scopeType === 'CLASS') colonne.scope_class_id = scopeIds.classId;
  else if (scopeType === 'TEACHING') colonne.scope_teaching_id = scopeIds.teachingId;
  else if (scopeType === 'STUDENT') colonne.scope_student_person_id = scopeIds.studentPersonId;
  else if (scopeType !== 'PLATFORM') throw datiNonValidi('ERR_SCOPE_TYPE_UNKNOWN', { scopeType: String(scopeType) });

  const { rows } = await client.query(
    `INSERT INTO role_assignments (
       account_id, role_id, scope_type, tenant_id,
       scope_tenant_id, scope_school_level_id, scope_class_id, scope_teaching_id, scope_student_person_id,
       created_by_account_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      accountId, ruoloRows[0].id, scopeType, scopeType === 'PLATFORM' ? null : tenantId,
      colonne.scope_tenant_id, colonne.scope_school_level_id, colonne.scope_class_id, colonne.scope_teaching_id, colonne.scope_student_person_id,
      creatoreAccountId,
    ]
  );
  return { id: rows[0].id };
}

async function getRoleAssignmentPerId(client, id) {
  const { rows } = await client.query('SELECT * FROM role_assignments WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getRoleAssignmentsDiAccount(client, accountId) {
  const { rows } = await client.query(
    `SELECT r.id, r.scope_type, r.tenant_id, ro.codice AS ruolo,
            r.scope_tenant_id, r.scope_school_level_id, r.scope_class_id, r.scope_teaching_id, r.scope_student_person_id
     FROM role_assignments r JOIN roles ro ON ro.id = r.role_id
     WHERE r.account_id = $1 AND r.revoked_at IS NULL
     ORDER BY r.created_at`,
    [accountId]
  );
  return rows;
}

module.exports = { creaRoleAssignment, getRoleAssignmentPerId, getRoleAssignmentsDiAccount };
