'use strict';

/**
 * Catalogo di localizzazione risolto per la lingua della SESSIONE (V2 §17, C2).
 *
 * GET /api/i18n — l'unico endpoint senza autenticazione obbligatoria, perché la
 * schermata di accesso ha bisogno dei propri testi: senza sessione (o senza tenant
 * attivo) restituisce il catalogo nella lingua di piattaforma (P3), senza alcun
 * dato di tenant; con una sessione e un tenant attivo valido applica C2 e le
 * sovrascritture di quel tenant. La lingua non è mai un parametro del client.
 */
const express = require('express');
const { pool } = require('../db');
const { leggiTokenDalCookie } = require('../middleware/autenticazione');
const { trovaSessioneValida } = require('../lib/sessioni');
const { isPlatformAdmin } = require('../lib/autorizzazione');
const { haMembershipAttiva } = require('../queries/account');
const { contestoPiattaforma, risolviLinguaTenant } = require('../lib/lingua');
const { risolviCatalogo } = require('../lib/catalogo');
const { asincrono } = require('../lib/asincrono');

const router = express.Router();

/** Tenant attivo della sessione se ancora valido (stessa regola di contestoTenant), altrimenti null. */
async function tenantValidoDellaSessione(sessione) {
  if (!sessione || !sessione.active_tenant_id) return null;
  const admin = await isPlatformAdmin(pool, sessione.account_id);
  if (admin) return sessione.active_tenant_id;
  return (await haMembershipAttiva(pool, sessione.account_id, sessione.active_tenant_id)) ? sessione.active_tenant_id : null;
}

router.get('/', asincrono(async (req, res) => {
  const sessione = await trovaSessioneValida(pool, leggiTokenDalCookie(req));
  const tenantId = await tenantValidoDellaSessione(sessione);
  const contesto = tenantId
    ? await risolviLinguaTenant(pool, { accountId: sessione.account_id, tenantId })
    : await contestoPiattaforma(pool);
  const { testi, mancanti } = await risolviCatalogo(pool, { lingua: contesto.lingua, tenantId });
  res.set('Cache-Control', 'no-store');
  res.json({ lingua: contesto.lingua, direzione: contesto.direzione, locale: contesto.locale, testi, mancanti });
}));

module.exports = router;
