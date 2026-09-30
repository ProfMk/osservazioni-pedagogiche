'use strict';

/** Amministrazione dei tenant: riservata a PLATFORM_ADMIN (sez. 7/9/64). */
const express = require('express');
const { pool, transazione } = require('../db');
const { richiedePermesso } = require('../lib/autorizzazione');
const { getTutteITenant, creaTenant } = require('../queries/tenant');
const { registraAudit } = require('../lib/audit');
const { asincrono } = require('../lib/asincrono');

const router = express.Router();

// GET /api/platform/tenants
router.get('/tenants', asincrono(async (req, res) => {
  await richiedePermesso(pool, { accountId: req.accountId, permesso: 'platform.manage_tenants' });
  res.json(await getTutteITenant(pool));
}));

// POST /api/platform/tenants  body: { slug, nome }
router.post('/tenants', asincrono(async (req, res) => {
  const risultato = await transazione(async (client) => {
    await richiedePermesso(client, { accountId: req.accountId, permesso: 'platform.manage_tenants' });
    const tenant = await creaTenant(client, req.body || {});
    await registraAudit(client, {
      tenantId: tenant.id, actorAccountId: req.accountId, azione: 'tenant.create', risorsa: 'tenant', risorsaId: tenant.id, dopo: tenant,
    });
    return tenant;
  });
  res.status(201).json(risultato);
}));

module.exports = router;
