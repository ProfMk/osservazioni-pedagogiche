'use strict';

/**
 * Risolve il tenant attivo della richiesta (sez. 8/9). SEMPRE verificato
 * contro una Membership attiva, tranne per un PLATFORM_ADMIN, per cui
 * l'active tenant è solo contesto operativo/UI/audit, non un confine di
 * autorizzazione (sez. 9): può restare impostato su un tenant qualunque.
 */
const { pool } = require('../db');
const { isPlatformAdmin } = require('../lib/autorizzazione');
const { haMembershipAttiva } = require('../queries/account');
const { vietato } = require('../lib/erroreApplicativo');

async function contestoTenant(req, res, next) {
  try {
    const tenantId = req.sessione.active_tenant_id;
    if (!tenantId) {
      throw vietato('Nessun tenant attivo per questa sessione: selezionarne uno con POST /api/auth/switch-tenant.');
    }
    const admin = await isPlatformAdmin(pool, req.accountId);
    if (!admin) {
      const valida = await haMembershipAttiva(pool, req.accountId, tenantId);
      if (!valida) throw vietato('Il tenant attivo della sessione non corrisponde più a una Membership valida.');
    }
    req.tenantId = tenantId;
    req.isPlatformAdmin = admin;
    next();
  } catch (errore) {
    next(errore);
  }
}

module.exports = { contestoTenant };
