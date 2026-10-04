'use strict';

/**
 * Lingua della sessione (Visual Grammar V2, decisione C2) — sempre risolta dal
 * server, mai ricevuta come parametro libero dal client.
 *
 *   - prima della selezione di un tenant attivo: lingua di piattaforma (P3),
 *     un dato di configurazione (platform_settings), non un valore nel codice;
 *   - con un tenant attivo: preferenza dell'utente per quel tenant SE abilitata,
 *     altrimenti lingua predefinita del tenant.
 *
 * Rivalutata al login, al cambio tenant e a ogni richiesta (così una lingua
 * disabilitata nel frattempo non resta mai in uso).
 */

/** Lingua e regione di piattaforma, con la direzione di scrittura. */
async function contestoPiattaforma(client) {
  const { rows } = await client.query(
    `SELECT p.lingua, p.regione, l.direzione
     FROM platform_settings p JOIN languages l ON l.codice = p.lingua`
  );
  const riga = rows[0];
  return {
    lingua: riga.lingua,
    direzione: riga.direzione,
    regione: riga.regione,
    locale: localeDi(riga.lingua, riga.regione),
    linguaOrigine: null,
    tenantId: null,
  };
}

/** Tag di formattazione: sottotag di lingua + regione del tenant (o della piattaforma). */
function localeDi(lingua, regione) {
  return `${lingua.split('-')[0]}-${regione}`;
}

/**
 * Lingua di sessione C2 per (account, tenant). Un PLATFORM_ADMIN senza Membership
 * non ha preferenza in quel tenant: vale la lingua predefinita del tenant.
 */
async function risolviLinguaTenant(client, { accountId, tenantId }) {
  const { rows } = await client.query(
    `SELECT t.lingua_predefinita, t.lingua_contenuti, t.regione,
            m.lingua_preferita,
            (m.lingua_preferita IS NOT NULL AND EXISTS (
               SELECT 1 FROM tenant_languages tl WHERE tl.tenant_id = t.id AND tl.lingua = m.lingua_preferita
             )) AS preferenza_abilitata
     FROM tenants t
     LEFT JOIN memberships m ON m.tenant_id = t.id AND m.account_id = $1 AND m.stato = 'attiva'
     WHERE t.id = $2`,
    [accountId, tenantId]
  );
  const riga = rows[0];
  const lingua = riga.preferenza_abilitata ? riga.lingua_preferita : riga.lingua_predefinita;
  const { rows: dir } = await client.query('SELECT direzione FROM languages WHERE codice = $1', [lingua]);
  return {
    lingua,
    direzione: dir[0].direzione,
    regione: riga.regione,
    locale: localeDi(lingua, riga.regione),
    linguaOrigine: riga.lingua_contenuti,
    linguaPreferita: riga.lingua_preferita,
    tenantId,
  };
}

/** Contesto linguistico della sessione: piattaforma senza tenant attivo, C2 altrimenti. */
async function contestoLinguaSessione(client, { accountId, tenantId }) {
  if (!tenantId) return contestoPiattaforma(client);
  return risolviLinguaTenant(client, { accountId, tenantId });
}

/** Salva la lingua risolta sulla sessione (solo se cambiata). */
async function aggiornaLinguaSessione(client, sessioneId, lingua) {
  await client.query(
    'UPDATE sessions SET lingua = $1 WHERE id = $2 AND lingua IS DISTINCT FROM $1',
    [lingua, sessioneId]
  );
}

/** Lingue abilitate di un tenant, con direzione. */
async function lingueAbilitate(client, tenantId) {
  const { rows } = await client.query(
    `SELECT tl.lingua AS codice, l.direzione
     FROM tenant_languages tl JOIN languages l ON l.codice = tl.lingua
     WHERE tl.tenant_id = $1 ORDER BY tl.lingua`,
    [tenantId]
  );
  return rows;
}

module.exports = {
  contestoPiattaforma, risolviLinguaTenant, contestoLinguaSessione, aggiornaLinguaSessione, lingueAbilitate, localeDi,
};
