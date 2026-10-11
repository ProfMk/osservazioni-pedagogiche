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
const { risolviLinguaTenant, aggiornaLinguaSessione } = require('../lib/lingua');

async function contestoTenant(req, res, next) {
  try {
    const tenantId = req.sessione.active_tenant_id;
    if (!tenantId) {
      throw vietato('ERR_TENANT_NOT_SELECTED');
    }
    const admin = await isPlatformAdmin(pool, req.accountId);
    if (!admin) {
      const valida = await haMembershipAttiva(pool, req.accountId, tenantId);
      if (!valida) throw vietato('ERR_TENANT_MEMBERSHIP_INVALID');
    }
    req.tenantId = tenantId;
    req.isPlatformAdmin = admin;
    // Lingua C2 rivalutata a ogni richiesta: una lingua disabilitata nel frattempo non resta in uso.
    req.lingua = await risolviLinguaTenant(pool, { accountId: req.accountId, tenantId });
    await aggiornaLinguaSessione(pool, req.sessione.id, req.lingua.lingua);
    next();
  } catch (errore) {
    next(errore);
  }
}

module.exports = { contestoTenant };
