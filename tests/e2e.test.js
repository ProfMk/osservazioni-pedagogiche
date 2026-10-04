'use strict';

/**
 * Visual Grammar V2 — verifica nel BROWSER (Chromium headless via playwright-core).
 *
 * Percorso unico (P15), viste V2, riga a 8 colonne (§12), nessun testo mancante, nessun
 * errore di console, filtro della matrice (P12), distinzioni leggibili senza colore (§16),
 * specchiatura RTL dell'asse con la pseudo-lingua di prova 'ar-XB' (decisione A),
 * testo mancante segnalato con il marcatore e mai con un'altra lingua (§17), accessibilità
 * (axe-core: nessuna violazione moderata, grave o critica).
 *
 * Richiede Chromium installato per playwright-core: `npm run test:e2e`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

require('./support/pglite').installa();
const { chromium } = require('playwright-core');
const { pool } = require('../server/db');
const { avviaServer, loginESwitch } = require('./support/http');

const CATALOGO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'i18n', 'catalogo', 'it.json'), 'utf8')).testi;
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const MARCATORE = '⟨?⟩';
const COLONNE = ['nome', 'asse', 'banda', 'criticita', 'confronto', 'andamento', 'certezza', 'base'];

let srv;
let browser;
test.before(async () => {
  srv = await avviaServer({ statico: true });
  browser = await chromium.launch();
});
test.after(async () => {
  await browser.close();
  await srv.chiudi();
  await pool.end();
});

/** Pagina con raccolta degli errori di console (la sola 401 attesa è /auth/me prima dell'accesso). */
async function nuovaPagina() {
  const contesto = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const pagina = await contesto.newPage();
  pagina.errori = [];
  pagina.on('pageerror', (e) => pagina.errori.push(e.message));
  pagina.on('response', (r) => {
    if (r.status() >= 400 && !(r.status() === 401 && r.url().endsWith('/api/auth/me'))) pagina.errori.push(`${r.status()} ${r.url()}`);
  });
  return pagina;
}

async function accedi(pagina, email, indiceTenant = 1) {
  await pagina.goto(`${srv.origine}/`);
  await pagina.fill('#campo-email', email);
  await pagina.fill('#campo-password', 'Sviluppo!2026');
  await pagina.click('form.modulo-accesso button[type=submit]');
  await pagina.waitForSelector('#intestazione:not([hidden])');
  await pagina.selectOption('#tenant', { index: indiceTenant });
  await pagina.waitForSelector('#contenuto .elenco .scelta');
}

/** Attende che la vista sia disegnata (nessuno stato di caricamento). */
async function stabile(pagina) {
  await pagina.waitForFunction(() => !document.querySelector('#contenuto [role=status].stato'));
}

async function clic(pagina, selettore) {
  await pagina.click(selettore);
  await stabile(pagina);
}

async function senzaTestiMancanti(pagina, dove) {
  const mancanti = await pagina.$$eval('[data-testo-mancante]', (n) => n.map((x) => x.getAttribute('data-testo-mancante')));
  assert.deepEqual(mancanti, [], `${dove}: identificatori senza testo`);
  assert.ok(!(await pagina.innerText('body')).includes(MARCATORE), `${dove}: marcatore di testo mancante`);
}

async function righeBenFormate(pagina, dove) {
  const strutture = await pagina.$$eval('.riga:not(.colonne)', (righe) => righe.map((r) => [...r.children].map((c) => c.className.split(' ')[0])));
  assert.ok(strutture.length > 0, `${dove}: nessuna riga`);
  strutture.forEach((s) => assert.deepEqual(s, COLONNE, `${dove}: ordine delle colonne della riga`));
}

async function nessunaViolazioneGrave(pagina, dove) {
  await pagina.addScriptTag({ content: AXE });
  const risultato = await pagina.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
  const gravi = risultato.violations.filter((v) => v.impact !== 'minor')
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  assert.deepEqual(gravi, [], `${dove}: violazioni di accessibilità`);
}

async function vaiAllaClasse(pagina) {
  await clic(pagina, '#contenuto .elenco .scelta >> nth=0'); // materia
  await clic(pagina, '#contenuto .elenco .scelta >> nth=0'); // classe -> Quadro
}

async function scheda(pagina, indice) {
  await clic(pagina, `.schede .scheda >> nth=${indice}`);
}

test('P3: la schermata di accesso è nella lingua di piattaforma, senza testi nel guscio', async () => {
  const pagina = await nuovaPagina();
  await pagina.goto(`${srv.origine}/`);
  await pagina.waitForSelector('form.modulo-accesso');
  assert.equal(await pagina.getAttribute('html', 'lang'), 'it');
  assert.equal(await pagina.getAttribute('html', 'dir'), 'ltr');
  assert.equal(await pagina.title(), CATALOGO.UI_APP_TITLE);
  await senzaTestiMancanti(pagina, 'accesso');
  await nessunaViolazioneGrave(pagina, 'accesso');
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

test('P15: percorso unico Insegnamenti → materia → classe → {Quadro, Studenti, Attività, Valutazioni}; viste V2 complete', async () => {
  const pagina = await nuovaPagina();
  await accedi(pagina, 'teacher.math.a@alfa.test');
  await senzaTestiMancanti(pagina, 'insegnamenti');
  await vaiAllaClasse(pagina);

  const schede = await pagina.$$eval('.schede .scheda', (n) => n.map((x) => x.textContent));
  assert.deepEqual(schede, ['VIEW_CLASS_OVERVIEW', 'VIEW_STUDENTS', 'VIEW_ACTIVITIES', 'VIEW_ASSESSMENT'].map((c) => CATALOGO[c]));
  const percorso = await pagina.$$eval('nav.percorso > *:not(.separatore)', (n) => n.map((x) => x.textContent));
  assert.deepEqual([percorso[0], percorso.at(-1)], [CATALOGO.UI_TEACHINGS, CATALOGO.VIEW_CLASS_OVERVIEW]);

  // Quadro classe (L0) e nucleo di classe (L1).
  await senzaTestiMancanti(pagina, 'quadro');
  await righeBenFormate(pagina, 'quadro');
  assert.ok(await pagina.$('.distribuzione-classe .distribuzione .voce'), 'distribuzione degli studenti per banda');
  await nessunaViolazioneGrave(pagina, 'quadro');
  await clic(pagina, '.livello .riga.apribile >> nth=0');
  await senzaTestiMancanti(pagina, 'nucleo di classe');
  assert.equal(await pagina.$$eval('.riga.intestazione', (n) => n.length), 1, 'la riga scelta diventa intestazione');

  // Studenti: matrice -> profilo L0 -> nucleo L1 -> criterio L2 -> osservazioni L3.
  await clic(pagina, 'nav.percorso button >> nth=2');
  await scheda(pagina, 1);
  await senzaTestiMancanti(pagina, 'matrice');
  await nessunaViolazioneGrave(pagina, 'matrice');
  await clic(pagina, '.matrice tbody .collegamento >> nth=0');
  await senzaTestiMancanti(pagina, 'profilo');
  await righeBenFormate(pagina, 'profilo');
  await nessunaViolazioneGrave(pagina, 'profilo');
  await clic(pagina, '.livello .riga.apribile >> nth=0');
  await senzaTestiMancanti(pagina, 'nucleo studente');
  await clic(pagina, '.livello .riga.apribile >> nth=0');
  await senzaTestiMancanti(pagina, 'criterio studente');
  assert.ok(await pagina.$('table.sequenza'), 'L3: sequenza delle osservazioni');
  assert.ok(await pagina.$('table.sequenza .finestra'), 'L3: finestra corrente ⟦ ⟧');
  await nessunaViolazioneGrave(pagina, 'osservazioni');

  // Attività: griglia di inserimento ed esito.
  await clic(pagina, 'nav.percorso button >> nth=2');
  await scheda(pagina, 2);
  await senzaTestiMancanti(pagina, 'attività');
  await clic(pagina, '.corpo-scheda .elenco .scelta >> nth=0');
  await senzaTestiMancanti(pagina, 'griglia');
  await nessunaViolazioneGrave(pagina, 'griglia');
  await scheda(pagina, 1);
  await senzaTestiMancanti(pagina, 'esito');
  await righeBenFormate(pagina, 'esito');
  assert.equal(await pagina.$('.storico'), null, 'P10: nessun ◇ nell\'esito dell\'attività');

  // Valutazioni.
  await clic(pagina, 'nav.percorso button >> nth=2');
  await scheda(pagina, 3);
  await senzaTestiMancanti(pagina, 'valutazioni');
  assert.ok(await pagina.$('.valutazione .timbro'));

  // HOW_TO_READ su richiesta.
  assert.equal(await pagina.isVisible('#come-leggere'), false);
  await pagina.click('#come-leggere-apri');
  assert.equal(await pagina.isVisible('#come-leggere'), true);
  await senzaTestiMancanti(pagina, 'come leggere');

  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

test('P12: il filtro della matrice mostra solo gli alunni con almeno una cella in banda critica (certezza sufficiente)', async () => {
  const sessione = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
  const teaching = (await sessione.get('/teachings')).corpo[0];
  const matrice = (await sessione.get(`/teachings/${teaching.teaching_id}/students-matrix`)).corpo;
  const attesi = matrice.studenti.filter((s) => s.inZonaCritica).map((s) => `${s.cognome} ${s.nome}`);

  const pagina = await nuovaPagina();
  await accedi(pagina, 'teacher.math.a@alfa.test');
  await vaiAllaClasse(pagina);
  await scheda(pagina, 1);
  const tutti = await pagina.$$eval('.matrice tbody th', (n) => n.map((x) => x.textContent));
  assert.deepEqual(tutti, matrice.studenti.map((s) => `${s.cognome} ${s.nome}`), 'ordine di registro conservato');
  await pagina.check('#filtro-zona-critica');
  const filtrati = await pagina.$$eval('.matrice tbody th', (n) => n.map((x) => x.textContent));
  assert.deepEqual(filtrati, attesi);
  assert.equal(await pagina.isVisible('.corpo-scheda > p.stato'), attesi.length === 0);
  await pagina.context().close();
});

test('§16: le distinzioni non dipendono dal colore (criticità, certezza, bande)', async () => {
  const pagina = await nuovaPagina();
  await accedi(pagina, 'teacher.math.a@alfa.test');
  await vaiAllaClasse(pagina);
  await scheda(pagina, 1);
  const stili = await pagina.evaluate(() => {
    const prova = (classe) => {
      const n = document.createElement('span');
      n.className = classe;
      n.textContent = '⚠';
      document.querySelector('#contenuto').append(n);
      const s = getComputedStyle(n);
      const r = { bordo: s.borderTopStyle, sfondo: s.backgroundColor };
      n.remove();
      return r;
    };
    const barra = (classe) => {
      const traccia = document.createElement('span');
      traccia.className = 'traccia';
      const b = document.createElement('span');
      b.className = classe;
      traccia.append(b);
      document.querySelector('#contenuto').append(traccia);
      const s = getComputedStyle(b);
      const r = { bordo: s.borderTopStyle, sfondo: s.backgroundColor };
      traccia.remove();
      return r;
    };
    const bande = [...document.querySelectorAll('.banda:not(.vuota)')].map((b) => {
      const s = getComputedStyle(b);
      return `${s.color}|${s.backgroundColor}`;
    });
    return {
      pieno: prova('segno pieno'), contorno: prova('segno contorno'),
      sufficiente: barra('barra'), parziale: barra('barra parziale'), insufficiente: barra('barra insufficiente'),
      bandeDistinte: new Set(bande).size, bande: bande.length,
    };
  });
  // ⚠ pieno = blocco pieno; ⚠ a contorno = cornice tratteggiata vuota.
  assert.notEqual(stili.pieno.sfondo, 'rgba(0, 0, 0, 0)');
  assert.equal(stili.contorno.sfondo, 'rgba(0, 0, 0, 0)');
  assert.notEqual(stili.pieno.bordo, stili.contorno.bordo);
  // Certezza parziale = barra cava; dati insufficienti = tratteggio.
  assert.notEqual(stili.sufficiente.sfondo, 'rgba(0, 0, 0, 0)');
  assert.equal(stili.parziale.sfondo, 'rgba(0, 0, 0, 0)');
  assert.equal(stili.insufficiente.bordo, 'dashed');
  // Le bande non hanno colori propri.
  assert.ok(stili.bande > 0);
  assert.equal(stili.bandeDistinte, 1);
  await pagina.context().close();
});

/** Abilita la pseudo-lingua RTL di prova con un catalogo completo come sovrascrittura (solo test). */
async function abilitaRtlDiProva(escluse = []) {
  const tenantId = (await pool.query("SELECT id FROM tenants WHERE slug = 'alfa'")).rows[0].id;
  await pool.query("INSERT INTO languages (codice, direzione) VALUES ('ar-XB', 'rtl') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO tenant_languages (tenant_id, lingua) VALUES ($1, 'ar-XB') ON CONFLICT DO NOTHING", [tenantId]);
  await pool.query("DELETE FROM catalog_overrides WHERE tenant_id = $1 AND lingua = 'ar-XB'", [tenantId]);
  for (const [chiave, valore] of Object.entries(CATALOGO)) {
    if (escluse.includes(chiave)) continue;
    await pool.query(
      "INSERT INTO catalog_overrides (tenant_id, lingua, chiave, valore) VALUES ($1, 'ar-XB', $2, $3)",
      [tenantId, chiave, JSON.stringify(valore)]
    );
  }
}

/** Cambia la lingua preferita dal selettore e attende il ridisegno completo della vista. */
async function cambiaLingua(pagina, codice, direzione) {
  await pagina.evaluate(() => { document.querySelector('#contenuto').firstElementChild.dataset.primaDelCambio = '1'; });
  await pagina.selectOption('#lingua', codice);
  await pagina.waitForFunction((dir) => document.documentElement.getAttribute('dir') === dir
    && !document.querySelector('[data-prima-del-cambio]')
    && !document.querySelector('#contenuto [role=status].stato')
    && document.querySelector('#contenuto').childElementCount > 0, direzione);
}

const passaARtl = (pagina) => cambiaLingua(pagina, 'ar-XB', 'rtl');

test('Decisione A: in RTL l\'asse, le tacche e il percorso si specchiano', async () => {
  await abilitaRtlDiProva();
  const pagina = await nuovaPagina();
  await accedi(pagina, 'teacher.math.a@alfa.test');
  await vaiAllaClasse(pagina);
  await scheda(pagina, 1);
  await clic(pagina, '.matrice tbody .collegamento >> nth=0');
  const misureLtr = await misureAsse(pagina);
  await passaARtl(pagina);
  assert.equal(await pagina.getAttribute('html', 'lang'), 'ar-XB');
  await senzaTestiMancanti(pagina, 'profilo RTL');
  const misureRtl = await misureAsse(pagina);

  // LTR: la barra parte dall'inizio in linea a sinistra; RTL: dal bordo destro della traccia.
  assert.ok(Math.abs(misureLtr.barra.x - misureLtr.traccia.x) <= 1);
  assert.ok(Math.abs((misureRtl.barra.x + misureRtl.barra.width) - (misureRtl.traccia.x + misureRtl.traccia.width)) <= 1);
  // La stessa posizione relativa si specchia: distanza dall'inizio in linea invariata.
  const relLtr = (misureLtr.tacca.x + misureLtr.tacca.width / 2 - misureLtr.traccia.x) / misureLtr.traccia.width;
  const relRtl = (misureRtl.traccia.x + misureRtl.traccia.width - (misureRtl.tacca.x + misureRtl.tacca.width / 2)) / misureRtl.traccia.width;
  assert.ok(Math.abs(relLtr - relRtl) < 0.02, `tacca: ${relLtr} vs ${relRtl}`);
  // Percorso: il primo elemento è all'inizio in linea (a destra in RTL).
  const percorso = await pagina.$$eval('nav.percorso > *:not(.separatore)', (n) => n.map((x) => x.getBoundingClientRect().x));
  assert.ok(percorso[0] > percorso.at(-1));
  await nessunaViolazioneGrave(pagina, 'profilo RTL');
  await cambiaLingua(pagina, 'it', 'ltr');
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

async function misureAsse(pagina) {
  return pagina.evaluate(() => {
    const riga = [...document.querySelectorAll('.livello .riga')].find((r) => r.querySelector('.barra') && r.querySelector('.tacca'));
    const box = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, width: r.width }; };
    return { traccia: box(riga.querySelector('.traccia')), barra: box(riga.querySelector('.barra')), tacca: box(riga.querySelector('.tacca')) };
  });
}

test('§17: un testo mancante nella lingua della sessione è segnalato dal marcatore, mai sostituito da un\'altra lingua', async () => {
  await abilitaRtlDiProva(['UI_TEACHINGS']);
  const pagina = await nuovaPagina();
  await accedi(pagina, 'teacher.math.a@alfa.test');
  await passaARtl(pagina);
  const titolo = await pagina.$('#contenuto h2');
  assert.equal(await titolo.textContent(), MARCATORE);
  assert.equal(await titolo.getAttribute('data-testo-mancante'), 'UI_TEACHINGS');
  assert.ok(!(await pagina.innerText('#contenuto')).includes(CATALOGO.UI_TEACHINGS));
  // Ripristina la lingua preferita per non influenzare altri test.
  await cambiaLingua(pagina, 'it', 'ltr');
  await pagina.context().close();
});
