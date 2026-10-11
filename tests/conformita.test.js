'use strict';

/**
 * Visual Grammar V2 — controlli STATICI di conformità del client (nessun browser).
 *
 *  - §17 / decisione A: nessuna coordinata fisica sinistra/destra nello stile e nel client
 *    (solo proprietà logiche), nessuna lingua o locale fissati nel client;
 *  - §17: nessun testo nel guscio HTML, ogni identificatore usato dal client ha un testo
 *    nel catalogo di prova; ogni identificatore emesso dal motore e dalle query ha un testo;
 *  - Regola B: il client non calcola (niente Math, arrotondamenti, conversioni numeriche
 *    dei valori ricevuti);
 *  - V1 rimossa: nessun radar, nessuna Dashboard.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RADICE = path.join(__dirname, '..');
const leggi = (relativo) => fs.readFileSync(path.join(RADICE, relativo), 'utf8');
const FILE_JS = fs.readdirSync(path.join(RADICE, 'public', 'js')).map((f) => `public/js/${f}`);
const CATALOGO = JSON.parse(leggi('server/i18n/catalogo/it.json')).testi;

/** Sorgente senza commenti (i commenti possono citare ciò che il codice non fa). */
function senzaCommenti(sorgente) {
  return sorgente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

test('Decisione A: nessuna proprietà o valore fisico sinistra/destra nel CSS e nel client', () => {
  const fisici = /\b(left|right)\b|margin-(left|right)|padding-(left|right)|border-(left|right)|float\s*:/i;
  for (const file of ['public/css/app.css', ...FILE_JS]) {
    senzaCommenti(leggi(file)).split('\n').forEach((riga, i) => {
      assert.ok(!fisici.test(riga), `${file}:${i + 1} usa una coordinata fisica: ${riga.trim()}`);
    });
  }
});

test('C2: il client non fissa lingua, locale o direzione', () => {
  for (const file of FILE_JS) {
    const sorgente = senzaCommenti(leggi(file));
    assert.ok(!/['"](it|it-IT|en|en-US|ar)['"]/.test(sorgente), `${file} contiene un codice di lingua fisso`);
    // i18n.js è l'unico punto che legge la direzione ricevuta dal server (I18n.rtl()).
    if (file !== 'public/js/i18n.js') assert.ok(!/['"](ltr|rtl)['"]/.test(sorgente), `${file} decide la direzione`);
  }
  const html = leggi('public/index.html');
  assert.ok(!/<html[^>]*\b(lang|dir)=/.test(html), 'lang/dir li imposta il client dal catalogo del server');
});

test('Regola B: il client non calcola né arrotonda i valori ricevuti (la sola geometria grafica è in geometria.js, C4)', () => {
  const calcolo = /\bMath\.|\.toFixed\(|\.toPrecision\(|parseFloat\(|Number\.EPSILON/;
  for (const file of FILE_JS.filter((f) => f !== 'public/js/geometria.js')) {
    senzaCommenti(leggi(file)).split('\n').forEach((riga, i) => {
      assert.ok(!calcolo.test(riga), `${file}:${i + 1} esegue un calcolo numerico: ${riga.trim()}`);
    });
  }
});

test('§17: il guscio HTML non contiene testi', () => {
  const html = leggi('public/index.html');
  const corpo = html.slice(html.indexOf('<body'), html.indexOf('</body>'))
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const testo = corpo.replace(/<[^>]+>/g, '').trim();
  assert.equal(testo, '', `testo nel guscio: ${testo}`);
  assert.match(html, /<title><\/title>/);
});

test('§17: ogni identificatore citato dal client ha un testo nel catalogo di prova', () => {
  const usati = new Set();
  for (const file of FILE_JS) {
    for (const m of senzaCommenti(leggi(file)).matchAll(/'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g)) usati.add(m[1]);
  }
  // Prefissi composti dal client con un dato del server: l'elenco chiuso dei valori è verificato sotto.
  const PREFISSI = ['ROLE_', 'STATUS_TENANT_', 'UI_LANGUAGE_', 'UI_TRANSLATION_FIELD_'];
  const mancanti = [...usati].filter((c) => !PREFISSI.includes(c) && !(c in CATALOGO));
  assert.deepEqual(mancanti, []);
  assert.ok(usati.size > 80, 'il client usa il catalogo per i propri testi');
});

test('§17: i valori composti dal client (ruoli, stati del tenant, campi traducibili) hanno un testo', () => {
  const ruoli = [...leggi('migrations/001_ruoli_permessi_sistema.sql').matchAll(/\('([A-Z_]+)',\s*'[^']*',\s*true\)/g)].map((m) => m[1]);
  assert.ok(ruoli.length >= 4);
  const stati = leggi('migrations/000_schema_base.sql').match(/stato varchar\(20\) NOT NULL DEFAULT 'attivo' CHECK \(stato IN \('attivo', 'sospeso'\)\)/);
  assert.ok(stati, 'stati del tenant attesi: attivo, sospeso');
  const { CAMPI } = require('../server/lib/contenuti');
  const attese = [
    ...ruoli.map((r) => `ROLE_${r}`),
    'STATUS_TENANT_ATTIVO', 'STATUS_TENANT_SOSPESO', 'UI_LANGUAGE_IT',
    ...Object.keys(CAMPI).map((c) => `UI_TRANSLATION_FIELD_${c.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`),
  ];
  assert.deepEqual(attese.filter((c) => !(c in CATALOGO)), []);
});

test('§17: ogni identificatore emesso dal motore e dalle query (stati, motivi, avvisi) ha un testo', () => {
  const motore = require('../server/lib/calcoloProgresso');
  const { ESCLUSIONE } = require('../server/queries/progresso');
  const emessi = [
    ...Object.values(motore.CERTEZZA), ...Object.values(motore.CRITICITA), ...Object.values(motore.CONFRONTO),
    ...Object.values(motore.DATI), ...Object.values(motore.COPERTURA_CLASSE), ...Object.values(motore.DATI_NUCLEO),
    ...Object.values(ESCLUSIONE), 'GENERALIZED_DIFFICULTY', 'GENERALIZED_DIFFICULTY_DETAIL',
  ];
  assert.deepEqual(emessi.filter((c) => !(c in CATALOGO)), []);
});

test('C4: geometria.js è solo presentazionale (nessuna banda, certezza, media, percentuale, confronto)', () => {
  const sorgente = senzaCommenti(leggi('public/js/geometria.js'));
  assert.ok(!/banda|bande|certezz|media|percentual|confront|giudizio|I18n/i.test(sorgente));
});

test('V2.1: nessun colore di banda scritto nel client (arrivano dal server, E1); nessun andamento', () => {
  const PALETTE = require('../server/lib/pubblicazione').PALETTE_BANDE;
  for (const file of ['public/css/app.css', ...FILE_JS]) {
    const sorgente = leggi(file).toLowerCase();
    PALETTE.forEach((colore) => assert.ok(!sorgente.includes(colore), `${file} contiene il colore di banda ${colore}`));
    assert.ok(!/COLUMN_TREND|TREND_|andamento/i.test(senzaCommenti(leggi(file))), `${file} cita l'andamento`);
  }
  assert.ok(!('COLUMN_TREND' in CATALOGO));
});

test('V1 rimossa: nessun radar, nessuna Dashboard, nessun percorso duplicato', () => {
  assert.ok(!fs.existsSync(path.join(RADICE, 'public', 'radar.js')));
  for (const file of ['public/index.html', 'public/css/app.css', ...FILE_JS]) {
    const sorgente = senzaCommenti(leggi(file));
    assert.ok(!/radar|dashboard/i.test(sorgente), `${file} cita elementi V1`);
  }
  assert.ok(!Object.keys(CATALOGO).some((c) => /DASHBOARD|RADAR/.test(c)));
});
