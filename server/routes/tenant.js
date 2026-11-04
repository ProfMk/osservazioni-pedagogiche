'use strict';

/** Amministrazione dei tenant: riservata a PLATFORM_ADMIN (sez. 7/9/64). */
const express = require('express');
const { pool, transazione } = require('../db');
const { richiedePermesso } = require('../lib/autorizzazione');
const { getTutteITenant, creaTenant } = require('../queries/tenant');
const {
  validaAmministratore, creaPrimoAmministratore, getAmministratoriPerTenant, reimpostaPasswordAmministratore,
} = require('../queries/amministratori');
const { registraAudit } = require('../lib/audit');
const { datiNonValidi } = require('../lib/erroreApplicativo');
const { asincrono } = require('../lib/asincrono');

const router = express.Router();

function idPositivo(valore, campo) {
  const id = Number(valore);
  if (!Number.isInteger(id) || id <= 0) throw datiNonValidi('ERR_INVALID_IDENTIFIER', { campo });
  return id;
}

// GET /api/platform/tenants — ogni tenant con i suoi amministratori di istituto (TENANT_ADMIN).
router.get('/tenants', asincrono(async (req, res) => {
  await richiedePermesso(pool, { accountId: req.accountId, permesso: 'platform.manage_tenants' });
  const tenants = await getTutteITenant(pool);
  const amministratori = await getAmministratoriPerTenant(pool);
  res.json(tenants.map((t) => ({ ...t, amministratori: amministratori.get(t.id) || [] })));
}));

// POST /api/platform/tenants  body: { slug, nome, amministratore?: { nome, cognome, email } }
// Risposta 201: il tenant (stessi campi di prima) e, se è stato indicato l'amministratore,
// amministratore: { account, accountEsistente, passwordTemporanea?, passwordTemporaneaScadeIl? }.
// La password temporanea compare SOLO qui, una volta, e solo per un account nuovo.
// Tenant, persona, account, membership, ruolo e audit: una sola transazione.
router.post('/tenants', asincrono(async (req, res) => {
  const corpo = req.body || {};
  const risultato = await transazione(async (client) => {
    await richiedePermesso(client, { accountId: req.accountId, permesso: 'platform.manage_tenants' });
    const amministratore = corpo.amministratore !== undefined ? validaAmministratore(corpo.amministratore) : null;
    const tenant = await creaTenant(client, corpo);
    await registraAudit(client, {
      tenantId: tenant.id, actorAccountId: req.accountId, azione: 'tenant.create', risorsa: 'tenant', risorsaId: tenant.id, dopo: tenant,
    });
    if (!amministratore) return tenant;
    const esito = await creaPrimoAmministratore(client, { actorAccountId: req.accountId, tenantId: tenant.id, amministratore });
    return { ...tenant, amministratore: esito };
  });
  res.set('Cache-Control', 'no-store');
  res.status(201).json(risultato);
}));

// POST /api/platform/tenants/:tenantId/admins/:accountId/reset-password
// Nuova password temporanea per un amministratore di istituto (mostrata una volta).
router.post('/tenants/:tenantId/admins/:accountId/reset-password', asincrono(async (req, res) => {
  const tenantId = idPositivo(req.params.tenantId, 'UI_FIELD_TENANT_ID');
  const accountId = idPositivo(req.params.accountId, 'UI_FIELD_ACCOUNT_ID');
  const risultato = await transazione(async (client) => {
    await richiedePermesso(client, { accountId: req.accountId, permesso: 'platform.manage_tenants' });
    return reimpostaPasswordAmministratore(client, { actorAccountId: req.accountId, tenantId, accountId });
  });
  res.set('Cache-Control', 'no-store');
  res.json(risultato);
}));

module.exports = router;
