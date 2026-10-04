'use strict';

/**
 * Server HTTP di prova (stessa pipeline /api dell'applicazione) e client con cookie
 * jar minimale e token CSRF, condivisi dai test di integrazione V2.
 * Va richiesto DOPO tests/support/pglite.js#installa().
 */
const path = require('path');
const express = require('express');

const PASSWORD_SVILUPPO = 'Sviluppo!2026';

/** Avvia l'app su una porta libera; con `statico` serve anche public/ (test E2E). */
async function avviaServer({ statico = false } = {}) {
  const routeApi = require('../../server/routes/index');
  const app = express();
  app.use(express.json());
  if (statico) app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  app.use('/api', routeApi);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const origine = `http://127.0.0.1:${server.address().port}`;
  return { server, origine, base: `${origine}/api`, chiudi: () => new Promise((r) => server.close(r)) };
}

function estraiCookie(risposta, nome) {
  const grezzo = typeof risposta.headers.getSetCookie === 'function'
    ? risposta.headers.getSetCookie()
    : [risposta.headers.get('set-cookie')].filter(Boolean);
  for (const riga of grezzo) {
    const m = riga.match(new RegExp(`${nome}=([^;]*)`));
    if (m) return m[1];
  }
  return null;
}

class SessioneHttp {
  constructor(base) { this.base = base; this.token = null; this.csrfToken = null; }

  async richiesta(metodo, percorso, corpo, intestazioniExtra = {}) {
    const h = { 'Content-Type': 'application/json', ...intestazioniExtra };
    if (this.token) h.Cookie = `session_token=${this.token}`;
    if (this.csrfToken) h['X-CSRF-Token'] = this.csrfToken;
    const risposta = await fetch(this.base + percorso, {
      method: metodo, headers: h, body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    const t = estraiCookie(risposta, 'session_token');
    if (t !== null) this.token = t === '' ? null : t;
    const corpoRisposta = risposta.status === 204 ? null : await risposta.json().catch(() => null);
    if (corpoRisposta && corpoRisposta.csrfToken) this.csrfToken = corpoRisposta.csrfToken;
    return { status: risposta.status, corpo: corpoRisposta };
  }

  get(percorso, intestazioni) { return this.richiesta('GET', percorso, undefined, intestazioni); }
  post(percorso, corpo) { return this.richiesta('POST', percorso, corpo); }
  put(percorso, corpo) { return this.richiesta('PUT', percorso, corpo); }
}

async function login(base, email, password = PASSWORD_SVILUPPO) {
  const sessione = new SessioneHttp(base);
  const risposta = await sessione.post('/auth/login', { email, password });
  return { sessione, risposta };
}

async function loginESwitch(base, email, tenantSlug) {
  const { sessione, risposta } = await login(base, email);
  if (risposta.status !== 200) throw new Error(`login di ${email} fallito: ${risposta.status}`);
  const tenant = risposta.corpo.tenantsDisponibiliPerSwitch.find((t) => t.slug === tenantSlug);
  if (!tenant) throw new Error(`${email} non può selezionare ${tenantSlug}`);
  const r = await sessione.post('/auth/switch-tenant', { tenantId: tenant.tenant_id ?? tenant.id });
  if (r.status !== 200) throw new Error(`switch a ${tenantSlug} fallito: ${r.status}`);
  return sessione;
}

module.exports = { avviaServer, SessioneHttp, login, loginESwitch, PASSWORD_SVILUPPO };
