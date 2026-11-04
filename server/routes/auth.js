'use strict';

/**
 * Autenticazione, sessione, CSRF, tenant attivo (sez. 10-14, 8-9).
 * Queste rotte NON passano per il middleware di autenticazione globale
 * (vedi server/routes/index.js): login è per definizione senza sessione.
 */
const express = require('express');
const cookie = require('cookie');
const { pool, transazione } = require('../db');
const { autenticazione, NOME_COOKIE } = require('../middleware/autenticazione');
const { richiedeCsrf } = require('../middleware/csrf');
const { richiedePasswordAggiornata } = require('../middleware/cambioPassword');
const {
  verificaPassword, hashPassword, validaPasswordNuova, LUNGHEZZA_MINIMA, LUNGHEZZA_MASSIMA,
} = require('../lib/password');
const {
  creaSessione, impostaTenantAttivo, revocaAltreSessioni, ruotaToken, MINUTI_IDLE_TIMEOUT, ORE_ABSOLUTE_TIMEOUT,
} = require('../lib/sessioni');
const { generaTokenCsrf } = require('../lib/csrf');
const {
  normalizzaEmail, trovaAccountPerEmail, getAccountById, getMembershipsDiAccount, haMembershipAttiva,
  getCredenzialiPerAggiornamento, aggiornaPassword,
} = require('../queries/account');
const { registraAudit } = require('../lib/audit');
const { isPlatformAdmin, permessiNelTenant } = require('../lib/autorizzazione');
const { getTutteITenant } = require('../queries/tenant');
const { getRoleAssignmentsDiAccount, getRuoliPerTenant } = require('../queries/rbac');
const { nonAutenticato, vietato, datiNonValidi } = require('../lib/erroreApplicativo');

/** true se la password temporanea dell'account è scaduta (scaduta = credenziali non valide). */
function temporaneaScaduta(account) {
  return !!account.password_temporanea_scade_il && new Date(account.password_temporanea_scade_il).getTime() <= Date.now();
}
const { asincrono } = require('../lib/asincrono');
const { contestoLinguaSessione, aggiornaLinguaSessione, lingueAbilitate } = require('../lib/lingua');

const router = express.Router();

const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';

function impostaCookieSessione(res, token) {
  res.setHeader('Set-Cookie', cookie.serialize(NOME_COOKIE, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: ORE_ABSOLUTE_TIMEOUT * 3600,
  }));
}

function cancellaCookieSessione(res) {
  res.setHeader('Set-Cookie', cookie.serialize(NOME_COOKIE, '', {
    httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: 0,
  }));
}

/** Costruisce la vista "me": account, membership, tenant attivo, permessi effettivi, csrfToken. */
async function costruisciVistaMe(client, { account, sessione }) {
  const ruoliPerTenant = await getRuoliPerTenant(client, account.id);
  // Ogni scuola porta i ruoli dell'utente in quella scuola (codici ROLE_* nel catalogo).
  const conRuoli = (t) => ({ ...t, ruoli: ruoliPerTenant.get(t.tenant_id !== undefined ? t.tenant_id : t.id) || [] });
  const memberships = (await getMembershipsDiAccount(client, account.id)).map(conRuoli);
  const admin = await isPlatformAdmin(client, account.id);
  // PLATFORM_ADMIN: può attivare solo un tenant attivo (switch-tenant), quindi solo quelli.
  const tenants = admin ? (await getTutteITenant(client)).filter((t) => t.stato === 'attivo').map(conRuoli) : [];
  const permessi = sessione.active_tenant_id
    ? await permessiNelTenant(client, account.id, sessione.active_tenant_id)
    : [];
  // Scope esatti dei RoleAssignment dell'account nel tenant attivo (sez. 17/18):
  // il frontend ne ha bisogno per sapere, es., "sono Coordinatore con
  // scope_school_level_id=X" senza dover indovinare o elencare tutto il tenant.
  const ruoliAssegnati = await getRoleAssignmentsDiAccount(client, account.id);
  const ruoliNelTenantAttivo = sessione.active_tenant_id
    ? ruoliAssegnati.filter((r) => r.scope_type === 'PLATFORM' || r.tenant_id === sessione.active_tenant_id)
    : [];
  // Lingua della sessione (C2, o lingua di piattaforma prima della scelta del tenant: P3).
  const lingua = await contestoLinguaSessione(client, { accountId: account.id, tenantId: sessione.active_tenant_id });
  await aggiornaLinguaSessione(client, sessione.id, lingua.lingua);
  return {
    account: { id: account.id, email: account.email, nome: account.nome, cognome: account.cognome },
    // Password temporanea ancora da cambiare: finché è true, le altre API rispondono 403 ERR_PASSWORD_CHANGE_REQUIRED.
    deveCambiarePassword: account.deve_cambiare_password === true,
    // Regole della password scelta dall'utente (il client le usa per l'aiuto e per minlength/maxlength).
    regolePassword: { minimo: LUNGHEZZA_MINIMA, massimo: LUNGHEZZA_MASSIMA },
    isPlatformAdmin: admin,
    memberships,
    tenantsDisponibiliPerSwitch: admin ? tenants : memberships,
    activeTenantId: sessione.active_tenant_id,
    permessiNelTenantAttivo: permessi,
    ruoliNelTenantAttivo,
    csrfToken: generaTokenCsrf(sessione.id),
    lingua: {
      codice: lingua.lingua,
      direzione: lingua.direzione,
      locale: lingua.locale,
      linguaPreferita: lingua.linguaPreferita || null,
      lingueAbilitate: sessione.active_tenant_id ? await lingueAbilitate(client, sessione.active_tenant_id) : [],
    },
    sessione: {
      idleTimeoutMinuti: MINUTI_IDLE_TIMEOUT,
      absoluteTimeoutOre: ORE_ABSOLUTE_TIMEOUT,
      scadeIl: sessione.expires_at,
    },
  };
}

// POST /api/auth/login  body: { email, password }
router.post('/login', asincrono(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw datiNonValidi('ERR_CREDENTIALS_REQUIRED');

  const esito = await transazione(async (client) => {
    const account = await trovaAccountPerEmail(client, normalizzaEmail(email));
    // Stesso messaggio generico sia per account inesistente sia per password errata (non rivelare quale).
    const credenzialiErrate = () => nonAutenticato('ERR_CREDENTIALS_INVALID');
    if (!account || account.stato !== 'attivo') throw credenzialiErrate();
    const ok = await verificaPassword(account.password_hash, password);
    if (!ok) throw credenzialiErrate();
    // Password temporanea oltre la validità: stesso errore generico (decisione 4).
    if (temporaneaScaduta(account)) throw credenzialiErrate();

    const { token, sessione } = await creaSessione(client, {
      accountId: account.id, userAgent: req.header('User-Agent'), ip: req.ip,
    });
    // Selezione automatica dell'istituto (passo 6): un account che non è PLATFORM_ADMIN e ha
    // esattamente una Membership attiva in un tenant attivo entra direttamente in quella scuola.
    // Vale anche con il cambio password obbligatorio (in quella fase switch-tenant è bloccato).
    // Con più scuole, nessuna o per un PLATFORM_ADMIN il tenant attivo resta da scegliere (sez. 8).
    if (!(await isPlatformAdmin(client, account.id))) {
      const disponibili = await getMembershipsDiAccount(client, account.id);
      if (disponibili.length === 1) {
        await impostaTenantAttivo(client, sessione.id, disponibili[0].tenant_id);
        sessione.active_tenant_id = disponibili[0].tenant_id;
      }
    }
    const vista = await costruisciVistaMe(client, { account, sessione });
    return { token, vista };
  });

  impostaCookieSessione(res, esito.token);
  res.json(esito.vista);
}));

// POST /api/auth/logout — revoca la sessione corrente.
router.post('/logout', autenticazione, richiedeCsrf, asincrono(async (req, res) => {
  if (req.sessione) {
    await pool.query('UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1', [req.sessione.id, 'logout']);
  }
  cancellaCookieSessione(res);
  res.status(204).end();
}));

// GET /api/auth/me
router.get('/me', autenticazione, asincrono(async (req, res) => {
  const account = await getAccountById(pool, req.accountId);
  const vista = await costruisciVistaMe(pool, { account, sessione: req.sessione });
  res.json(vista);
}));

// POST /api/auth/password  body: { passwordAttuale, passwordNuova }
// Cambio della password: obbligatorio dopo una password temporanea, possibile in ogni momento.
// Dopo il cambio: le ALTRE sessioni dell'account sono revocate, il token della sessione corrente
// è ruotato (nuovo cookie), l'obbligo di cambio e la scadenza della temporanea sono azzerati.
// Audit account.password_change senza valori (né password né hash).
router.post('/password', autenticazione, richiedeCsrf, asincrono(async (req, res) => {
  const { passwordAttuale, passwordNuova } = req.body || {};
  if (typeof passwordAttuale !== 'string' || passwordAttuale.length === 0) {
    throw datiNonValidi('ERR_REQUIRED_FIELD', { campo: 'UI_FIELD_PASSWORD_CURRENT' });
  }
  validaPasswordNuova(passwordNuova);

  const token = await transazione(async (client) => {
    const credenziali = await getCredenzialiPerAggiornamento(client, req.accountId);
    if (!credenziali || credenziali.stato !== 'attivo') throw nonAutenticato('ERR_SESSION_REQUIRED');
    const attualeValida = await verificaPassword(credenziali.password_hash, passwordAttuale) && !temporaneaScaduta(credenziali);
    if (!attualeValida) throw datiNonValidi('ERR_PASSWORD_CURRENT_INVALID');
    if (passwordNuova === passwordAttuale) {
      throw datiNonValidi(credenziali.deve_cambiare_password ? 'ERR_PASSWORD_SAME_AS_TEMPORARY' : 'ERR_PASSWORD_SAME_AS_CURRENT');
    }
    await aggiornaPassword(client, req.accountId, await hashPassword(passwordNuova));
    await revocaAltreSessioni(client, req.accountId, req.sessione.id, 'cambio_password');
    const nuovoToken = await ruotaToken(client, req.sessione.id);
    await registraAudit(client, {
      tenantId: req.sessione.active_tenant_id || null,
      actorAccountId: req.accountId,
      azione: 'account.password_change',
      risorsa: 'account',
      risorsaId: req.accountId,
    });
    return nuovoToken;
  });

  impostaCookieSessione(res, token);
  const account = await getAccountById(pool, req.accountId);
  res.json(await costruisciVistaMe(pool, { account, sessione: req.sessione }));
}));

// POST /api/auth/switch-tenant  body: { tenantId }
router.post('/switch-tenant', autenticazione, richiedePasswordAggiornata, richiedeCsrf, asincrono(async (req, res) => {
  const tenantId = Number(req.body && req.body.tenantId);
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw datiNonValidi('ERR_INVALID_IDENTIFIER', { campo: 'UI_FIELD_TENANT_ID' });

  await transazione(async (client) => {
    const admin = await isPlatformAdmin(client, req.accountId);
    if (!admin) {
      const valida = await haMembershipAttiva(client, req.accountId, tenantId);
      if (!valida) throw vietato('ERR_TENANT_MEMBERSHIP_INVALID');
    } else {
      const { rows } = await client.query("SELECT 1 FROM tenants WHERE id = $1 AND stato = 'attivo'", [tenantId]);
      if (rows.length === 0) throw vietato('ERR_TENANT_UNAVAILABLE');
    }
    await client.query('UPDATE sessions SET active_tenant_id = $1 WHERE id = $2', [tenantId, req.sessione.id]);
  });

  const account = await getAccountById(pool, req.accountId);
  const sessioneAggiornata = { ...req.sessione, active_tenant_id: tenantId };
  const vista = await costruisciVistaMe(pool, { account, sessione: sessioneAggiornata });
  res.json(vista);
}));

module.exports = router;
