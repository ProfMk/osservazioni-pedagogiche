'use strict';

/**
 * Contenuto pedagogico multilingue (Visual Grammar V2, decisione B).
 *
 * Campi traducibili: etichette delle bande e dei valori di scala, nome della scala,
 * nomi di materie, nuclei, livelli e periodi, descrizioni dei criteri, nome del
 * tenant. Il testo nella lingua di origine del tenant (B-1) resta nella colonna
 * originale; le altre lingue stanno in content_translations.
 *
 * B-2: lingua richiesta -> lingua di origine; mai una lingua fissa, mai traduzione
 * automatica. B-3: ogni testo viaggia con la sua lingua EFFETTIVA ({ testo, lingua }),
 * così la UI imposta `lang`. B-4: nessuna regola pedagogica usa questi testi.
 */

const CAMPI = Object.freeze({
  'judgment_bands.etichetta': { colonne: ['judgment_band_id'], tabella: 'judgment_bands', conteggio: 'SELECT count(*)::int AS n FROM judgment_bands WHERE tenant_id = $1' },
  'observation_scales.nome': { colonne: ['observation_scale_id'], tabella: 'observation_scales', conteggio: 'SELECT count(*)::int AS n FROM observation_scales WHERE tenant_id = $1' },
  'observation_scale_values.etichetta': {
    colonne: ['observation_scale_id', 'scale_valore'],
    tabella: 'observation_scale_values',
    conteggio: 'SELECT count(*)::int AS n FROM observation_scale_values v JOIN observation_scales s ON s.id = v.scale_id WHERE s.tenant_id = $1',
  },
  'subjects.nome': { colonne: ['subject_id'], tabella: 'subjects', conteggio: 'SELECT count(*)::int AS n FROM subjects WHERE tenant_id = $1' },
  'pedagogical_units.nome': { colonne: ['pedagogical_unit_id'], tabella: 'pedagogical_units', conteggio: 'SELECT count(*)::int AS n FROM pedagogical_units WHERE tenant_id = $1' },
  'criteria.descrizione': { colonne: ['criterion_id'], tabella: 'criteria', conteggio: 'SELECT count(*)::int AS n FROM criteria WHERE tenant_id = $1' },
  'school_levels.nome': { colonne: ['school_level_id'], tabella: 'school_levels', conteggio: 'SELECT count(*)::int AS n FROM school_levels WHERE tenant_id = $1' },
  'assessment_periods.nome': { colonne: ['assessment_period_id'], tabella: 'assessment_periods', conteggio: 'SELECT count(*)::int AS n FROM assessment_periods WHERE tenant_id = $1' },
  'tenants.nome': { colonne: ['target_tenant_id'], tabella: 'tenants', conteggio: 'SELECT 1 AS n' },
});

/** Chiave interna di un oggetto tradotto: i valori delle colonne di riferimento. */
function chiaveRiferimento(campo, riferimento) {
  return `${campo}|${[].concat(riferimento).join(':')}`;
}

/**
 * Traduttore per (tenant, lingua della sessione): carica in una sola query tutte le
 * traduzioni del tenant in quella lingua. Senza tenant (contesto di piattaforma) i
 * testi restano nella lingua di origine dichiarata dal chiamante.
 */
async function creaTraduttore(client, { tenantId, lingua, linguaOrigine }) {
  const traduzioni = new Map();
  if (tenantId && lingua !== linguaOrigine) {
    const { rows } = await client.query(
      `SELECT campo, judgment_band_id, observation_scale_id, scale_valore, subject_id, pedagogical_unit_id,
              criterion_id, school_level_id, assessment_period_id, target_tenant_id, testo
       FROM content_translations WHERE tenant_id = $1 AND lingua = $2`,
      [tenantId, lingua]
    );
    rows.forEach((r) => {
      const riferimento = CAMPI[r.campo].colonne.map((c) => r[c]);
      traduzioni.set(chiaveRiferimento(r.campo, riferimento), r.testo);
    });
  }
  return {
    lingua,
    linguaOrigine,
    /** { testo, lingua } nella lingua richiesta se tradotto, altrimenti nella lingua di origine (B-2/B-3). */
    testo(campo, riferimento, originale) {
      if (!CAMPI[campo]) throw new Error(`Campo non traducibile: ${campo}`);
      if (originale === null || originale === undefined) return null;
      const tradotto = traduzioni.get(chiaveRiferimento(campo, riferimento));
      return tradotto !== undefined ? { testo: tradotto, lingua } : { testo: originale, lingua: linguaOrigine };
    },
    /** Contenuto d'autore: mai tradotto, viaggia con la lingua registrata (B). */
    autore(testo, linguaContenuto) {
      if (testo === null || testo === undefined) return null;
      return { testo, lingua: linguaContenuto };
    },
  };
}

/**
 * Inserisce o aggiorna una traduzione (B-5: chi chiama registra l'audit nella stessa
 * transazione). `riferimento` = valori delle colonne di riferimento del campo.
 */
async function salvaTraduzione(client, { tenantId, lingua, campo, riferimento, testo, accountId }) {
  const def = CAMPI[campo];
  const valori = [].concat(riferimento);
  const colonne = def.colonne;
  const condizioni = colonne.map((c, i) => `${c} = $${i + 4}`).join(' AND ');
  const prima = await client.query(
    `SELECT id, testo FROM content_translations WHERE tenant_id = $1 AND lingua = $2 AND campo = $3 AND ${condizioni}`,
    [tenantId, lingua, campo, ...valori]
  );
  if (prima.rows[0]) {
    await client.query(
      'UPDATE content_translations SET testo = $1, updated_at = now(), updated_by_account_id = $2 WHERE id = $3',
      [testo, accountId, prima.rows[0].id]
    );
    return { id: prima.rows[0].id, prima: { testo: prima.rows[0].testo } };
  }
  const segnaposto = colonne.map((_, i) => `$${i + 6}`).join(', ');
  const { rows } = await client.query(
    `INSERT INTO content_translations (tenant_id, lingua, campo, testo, updated_by_account_id, ${colonne.join(', ')})
     VALUES ($1, $2, $3, $4, $5, ${segnaposto}) RETURNING id`,
    [tenantId, lingua, campo, testo, accountId, ...valori]
  );
  return { id: rows[0].id, prima: null };
}

/**
 * Completezza delle traduzioni (B-6): per ogni lingua abilitata diversa da quella di
 * origine e per ogni campo traducibile, quanti oggetti hanno una traduzione.
 */
async function completezzaTraduzioni(client, { tenantId, linguaOrigine, lingue }) {
  const risultato = [];
  for (const lingua of lingue.filter((l) => l !== linguaOrigine)) {
    const campi = [];
    for (const [campo, def] of Object.entries(CAMPI)) {
      const totale = (await client.query(def.conteggio, def.conteggio.includes('$1') ? [tenantId] : [])).rows[0].n;
      const tradotti = (await client.query(
        'SELECT count(*)::int AS n FROM content_translations WHERE tenant_id = $1 AND lingua = $2 AND campo = $3',
        [tenantId, lingua, campo]
      )).rows[0].n;
      campi.push({ campo, totale, tradotti, mancanti: Math.max(totale - tradotti, 0) });
    }
    risultato.push({ lingua, campi });
  }
  return risultato;
}

module.exports = { CAMPI, creaTraduttore, salvaTraduzione, completezzaTraduzioni };
