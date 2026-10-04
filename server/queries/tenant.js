'use strict';

const { conflitto, datiNonValidi } = require('../lib/erroreApplicativo');

/** Elenco di tutti i tenant (solo per PLATFORM_ADMIN). */
async function getTutteITenant(client) {
  const { rows } = await client.query('SELECT id, slug, nome, stato, created_at FROM tenants ORDER BY nome');
  return rows;
}

/** Crea un nuovo tenant (solo PLATFORM_ADMIN, verificato dalla rotta). */
async function creaTenant(client, { slug, nome }) {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    throw datiNonValidi('ERR_TENANT_SLUG_INVALID');
  }
  if (!nome || !nome.trim()) throw datiNonValidi('ERR_REQUIRED_FIELD', { campo: 'UI_FIELD_NOME' });
  const { rows: esistente } = await client.query('SELECT 1 FROM tenants WHERE slug = $1', [slug]);
  if (esistente.length > 0) throw conflitto('ERR_TENANT_SLUG_TAKEN', { slug });
  // Un nuovo tenant nasce con la configurazione linguistica di piattaforma (C2): una lingua
  // abilitata, predefinita e di origine dei contenuti; il tenant potrà poi cambiarla.
  // Stessa transazione del chiamante: la FK "predefinita abilitata" è differita al COMMIT.
  const { rows } = await client.query(
    `INSERT INTO tenants (slug, nome, lingua_predefinita, lingua_contenuti, regione)
     SELECT $1, $2, p.lingua, p.lingua, p.regione FROM platform_settings p
     RETURNING id, slug, nome, stato, created_at, lingua_predefinita`,
    [slug, nome.trim()]
  );
  await client.query('INSERT INTO tenant_languages (tenant_id, lingua) VALUES ($1, $2)', [rows[0].id, rows[0].lingua_predefinita]);
  const { lingua_predefinita: _lingua, ...tenant } = rows[0];
  return tenant;
}

module.exports = { getTutteITenant, creaTenant };
