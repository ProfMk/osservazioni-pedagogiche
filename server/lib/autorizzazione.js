'use strict';

/**
 * RBAC grant-only con scope (sez. 15-18). SOSTITUISCE integralmente il
 * vecchio autorizzazione.js mono-tenant (verificaInsegnamentoDelDocente e
 * simili), che presupponeva un solo docente per attività e nessun tenant:
 * quel modello è superato (istruzione esplicita dell'utente).
 *
 * Modello: un account ha zero o più RoleAssignment attivi (non revocati).
 * Ciascuno concede, tramite Role -> Permission, un insieme di permessi in
 * UNO scope preciso (PLATFORM, TENANT, SCHOOL_LEVEL, CLASS, TEACHING,
 * STUDENT). Il risultato finale è un OR di tutte le concessioni valide
 * (sez. 16: grant-only, mai un DENY): basta UNA riga che copra la richiesta.
 *
 * Uno scope PLATFORM concede il permesso indipendentemente da
 * tenant/risorsa richiesti (sez. 9): per questo la condizione SQL per quel
 * ramo non confronta alcun id.
 */
const { vietato } = require('./erroreApplicativo');

/**
 * true se l'account ha `permesso` in almeno uno degli scope applicabili
 * alla risorsa. Passare `null` per un livello di scope non pertinente alla
 * risorsa: un RoleAssignment su quel livello semplicemente non potrà mai
 * eguagliare NULL (nessun trattamento speciale necessario in SQL).
 */
async function haPermesso(client, {
  accountId, permesso, tenantId = null, schoolLevelId = null, classId = null, teachingId = null, studentPersonId = null,
}) {
  const { rows } = await client.query(
    `SELECT 1
     FROM role_assignments r
     JOIN role_permissions rp ON rp.role_id = r.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE r.account_id = $1 AND p.codice = $2 AND r.revoked_at IS NULL
       AND (
         r.scope_type = 'PLATFORM'
         OR (r.scope_type = 'TENANT' AND r.tenant_id = $3)
         OR (r.scope_type = 'SCHOOL_LEVEL' AND r.scope_school_level_id = $4)
         OR (r.scope_type = 'CLASS' AND r.scope_class_id = $5)
         OR (r.scope_type = 'TEACHING' AND r.scope_teaching_id = $6)
         OR (r.scope_type = 'STUDENT' AND r.scope_student_person_id = $7)
       )
     LIMIT 1`,
    [accountId, permesso, tenantId, schoolLevelId, classId, teachingId, studentPersonId]
  );
  return rows.length > 0;
}

/** Solleva 403 se l'account non ha il permesso nel contesto indicato. */
async function richiedePermesso(client, contesto) {
  const concesso = await haPermesso(client, contesto);
  if (!concesso) throw vietato(`Permesso mancante: ${contesto.permesso}.`);
}

/** true se l'account ha un RoleAssignment attivo con scope_type = PLATFORM (sez. 7/9). */
async function isPlatformAdmin(client, accountId) {
  const { rows } = await client.query(
    "SELECT 1 FROM role_assignments WHERE account_id = $1 AND scope_type = 'PLATFORM' AND revoked_at IS NULL LIMIT 1",
    [accountId]
  );
  return rows.length > 0;
}

/**
 * Tutti i permessi effettivi di un account in un dato tenant (utile per
 * /me e per la regola "non si può concedere più di quanto si possiede",
 * sez. 16). Include i permessi concessi a livello PLATFORM.
 */
async function permessiNelTenant(client, accountId, tenantId) {
  const { rows } = await client.query(
    `SELECT DISTINCT p.codice
     FROM role_assignments r
     JOIN role_permissions rp ON rp.role_id = r.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE r.account_id = $1 AND r.revoked_at IS NULL
       AND (r.scope_type = 'PLATFORM' OR r.tenant_id = $2)`,
    [accountId, tenantId]
  );
  return rows.map((r) => r.codice);
}

module.exports = { haPermesso, richiedePermesso, isPlatformAdmin, permessiNelTenant };
