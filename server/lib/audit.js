'use strict';

/**
 * Scrittura dell'audit log (sez. 40/42). Va sempre chiamata con lo STESSO
 * client della mutazione che si sta registrando, dentro la stessa
 * transazione (server/db.js:transazione): se la transazione fa ROLLBACK,
 * né la modifica né il suo audit vengono salvati; se fa COMMIT, entrambi lo
 * sono. Non è mai invocata da una query separata o da un trigger.
 */
async function registraAudit(client, {
  tenantId = null, actorAccountId = null, azione, risorsa, risorsaId = null,
  prima = null, dopo = null, correlationId = null,
}) {
  await client.query(
    `INSERT INTO audit_log (tenant_id, actor_account_id, azione, risorsa, risorsa_id, prima, dopo, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      tenantId, actorAccountId, azione, risorsa, risorsaId,
      prima !== null ? JSON.stringify(prima) : null,
      dopo !== null ? JSON.stringify(dopo) : null,
      correlationId,
    ]
  );
}

module.exports = { registraAudit };
