'use strict';

/**
 * Catalogo di localizzazione del SISTEMA (Visual Grammar V2 §17-18).
 *
 * Catena di risoluzione, per ogni identificatore:
 *   override del tenant (catalog_overrides) -> default di prodotto nella lingua della
 *   sessione (server/i18n/catalogo/<lingua>.json) -> segnalazione "testo mancante".
 * Mai un fallback a una lingua fissa. Il catalogo contiene SOLO concetti di sistema:
 * le etichette configurate dall'istituto (bande, scale, nuclei, criteri…) sono
 * contenuto pedagogico e vivono nelle tabelle di configurazione/traduzione.
 *
 * Forma tecnica provvisoria (V2 §28: forma definitiva del catalogo rinviata). I file
 * di prodotto attuali sono un CATALOGO DI PROVA: i testi definitivi di produzione
 * restano da redigere (L-11).
 */
const fs = require('fs');
const path = require('path');

const CARTELLA = path.join(__dirname, '..', 'i18n', 'catalogo');
const FORMATO_CHIAVE = /^[A-Z][A-Z0-9_]*$/;

function caricaCataloghiProdotto() {
  const cataloghi = new Map();
  if (!fs.existsSync(CARTELLA)) return cataloghi;
  fs.readdirSync(CARTELLA).filter((f) => f.endsWith('.json')).forEach((file) => {
    const contenuto = JSON.parse(fs.readFileSync(path.join(CARTELLA, file), 'utf8'));
    const testi = contenuto.testi || {};
    Object.keys(testi).forEach((chiave) => {
      if (!FORMATO_CHIAVE.test(chiave)) throw new Error(`Chiave di catalogo non valida in ${file}: ${chiave}`);
    });
    cataloghi.set(path.basename(file, '.json'), testi);
  });
  return cataloghi;
}

const CATALOGHI_PRODOTTO = caricaCataloghiProdotto();

/** Tutti gli identificatori noti al prodotto (unione dei cataloghi di prodotto). */
function chiaviDiRiferimento() {
  const chiavi = new Set();
  CATALOGHI_PRODOTTO.forEach((testi) => Object.keys(testi).forEach((c) => chiavi.add(c)));
  return [...chiavi].sort();
}

/**
 * Catalogo risolto per una lingua (ed eventualmente un tenant). Restituisce i testi
 * risolti e le chiavi di riferimento rimaste senza testo (segnalazione).
 */
async function risolviCatalogo(client, { lingua, tenantId = null }) {
  const testi = { ...(CATALOGHI_PRODOTTO.get(lingua) || {}) };
  if (tenantId) {
    const { rows } = await client.query(
      'SELECT chiave, valore FROM catalog_overrides WHERE tenant_id = $1 AND lingua = $2',
      [tenantId, lingua]
    );
    rows.forEach((r) => { testi[r.chiave] = r.valore; });
  }
  const mancanti = chiaviDiRiferimento().filter((c) => !(c in testi));
  return { testi, mancanti };
}

module.exports = { risolviCatalogo, chiaviDiRiferimento, CATALOGHI_PRODOTTO, FORMATO_CHIAVE };
