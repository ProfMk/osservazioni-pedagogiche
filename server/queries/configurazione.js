'use strict';

/**
 * Configurazione pedagogica tenant-owned (sez. 21-27): livelli scolastici,
 * anni scolastici, materie, unità pedagogiche, criteri, scala di
 * osservazione, soglie di giudizio.
 */

async function getSchoolLevels(client, tenantId) {
  const { rows } = await client.query(
    'SELECT id, nome, ordine FROM school_levels WHERE tenant_id = $1 AND stato = $2 ORDER BY ordine, nome',
    [tenantId, 'attivo']
  );
  return rows;
}

async function getSchoolYears(client, tenantId) {
  const { rows } = await client.query(
    'SELECT id, nome, data_inizio, data_fine, stato FROM school_years WHERE tenant_id = $1 ORDER BY data_inizio DESC',
    [tenantId]
  );
  return rows;
}

async function getSubjects(client, { tenantId, schoolLevelId, schoolYearId }) {
  const { rows } = await client.query(
    `SELECT id, nome, ordine FROM subjects
     WHERE tenant_id = $1 AND school_level_id = $2 AND school_year_id = $3 AND stato = 'attiva'
     ORDER BY ordine, nome`,
    [tenantId, schoolLevelId, schoolYearId]
  );
  return rows;
}

async function getPedagogicalUnits(client, subjectId) {
  const { rows } = await client.query(
    "SELECT id, nome, ordine FROM pedagogical_units WHERE subject_id = $1 AND stato = 'attiva' ORDER BY ordine, nome",
    [subjectId]
  );
  return rows;
}

async function getCriteria(client, pedagogicalUnitId) {
  const { rows } = await client.query(
    "SELECT id, codice, descrizione, ordine FROM criteria WHERE pedagogical_unit_id = $1 AND stato = 'attivo' ORDER BY ordine",
    [pedagogicalUnitId]
  );
  return rows;
}

/**
 * Scala di osservazione applicabile: override per SchoolLevel se esiste,
 * altrimenti il default di tenant (sez. 26). Nessuna cascata oltre questi
 * due livelli.
 */
async function getScalaApplicabile(client, { tenantId, schoolLevelId }) {
  const override = await client.query(
    'SELECT id, nome FROM observation_scales WHERE tenant_id = $1 AND school_level_id = $2',
    [tenantId, schoolLevelId]
  );
  const scala = override.rows[0] || (await client.query(
    'SELECT id, nome FROM observation_scales WHERE tenant_id = $1 AND school_level_id IS NULL',
    [tenantId]
  )).rows[0];
  if (!scala) throw new Error(`Nessuna scala di osservazione configurata per il tenant ${tenantId}.`);
  const { rows: valori } = await client.query(
    'SELECT valore, etichetta, ordine FROM observation_scale_values WHERE scale_id = $1 ORDER BY ordine',
    [scala.id]
  );
  const valoreMassimo = valori.reduce((massimo, v) => Math.max(massimo, v.valore), -Infinity);
  return { ...scala, valori, valoreMassimo };
}

/** Soglie di giudizio applicabili: stesso pattern override/default della scala (sez. 26). */
async function getBandeGiudizio(client, { tenantId, schoolLevelId }) {
  const override = await client.query(
    'SELECT soglia_minima, etichetta FROM judgment_bands WHERE tenant_id = $1 AND school_level_id = $2 ORDER BY soglia_minima DESC',
    [tenantId, schoolLevelId]
  );
  if (override.rows.length > 0) return override.rows;
  const { rows } = await client.query(
    'SELECT soglia_minima, etichetta FROM judgment_bands WHERE tenant_id = $1 AND school_level_id IS NULL ORDER BY soglia_minima DESC',
    [tenantId]
  );
  return rows;
}

module.exports = {
  getSchoolLevels, getSchoolYears, getSubjects, getPedagogicalUnits, getCriteria,
  getScalaApplicabile, getBandeGiudizio,
};
