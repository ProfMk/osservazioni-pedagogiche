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
    throw datiNonValidi('slug obbligatorio: solo lettere minuscole, cifre e trattini.');
  }
  if (!nome || !nome.trim()) throw datiNonValidi('nome obbligatorio.');
  const { rows: esistente } = await client.query('SELECT 1 FROM tenants WHERE slug = $1', [slug]);
  if (esistente.length > 0) throw conflitto(`Esiste già un tenant con slug "${slug}".`);
  const { rows } = await client.query(
    'INSERT INTO tenants (slug, nome) VALUES ($1, $2) RETURNING id, slug, nome, stato, created_at',
    [slug, nome.trim()]
  );
  return rows[0];
}

module.exports = { getTutteITenant, creaTenant };
