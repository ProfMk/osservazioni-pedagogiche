'use strict';

/**
 * Visual Grammar V2.1 (revisione 2) — verifica nel BROWSER (Chromium headless via
 * playwright-core), sul seed esteso (catena completa + seed/seed_esteso.sql).
 *
 * Copre: percorso unico e viste senza testi mancanti né errori; 0/1/2 colorati con la banda
 * giusta e null grigio; colori delle bande dal server; valutazione del docente colorata solo
 * se abbinata; arco della classe distinto dal ◇ storico; certezza parziale sopra il colore;
 * criticità piena / da verificare; mini-dischi; navigazione a pila (settore = carta, ←,
 * tasto Indietro); tabella alternativa; confronto «rispetto al suo complessivo»; nessun
 * andamento; specchio RTL; marcatore di testo mancante; accessibilità (axe-core).
 *
 * Richiede Chromium installato per playwright-core: `npm run test:e2e`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const supporto = require('./support/pglite');

supporto.installa({ url: supporto.URL_ESTESO });
const { chromium } = require('playwright-core');
const { pool } = require('../server/db');
const { avviaServer, loginESwitch } = require('./support/http');

const CATALOGO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'i18n', 'catalogo', 'it.json'), 'utf8')).testi;
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const MARCATORE = '⟨?⟩';

let srv;
let browser;
let api;
let t2A;
let luca;
test.before(async () => {
  srv = await avviaServer({ statico: true });
  browser = await chromium.launch();
  api = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
  t2A = (await api.get('/teachings')).corpo.find((t) => t.proprio && t.classe === '2A');
  const matrice = (await api.get(`/teachings/${t2A.teaching_id}/students-matrix`)).corpo;
  luca = matrice.studenti.find((s) => s.nome === 'Luca' && s.cognome === 'Colombo');
});
test.after(async () => {
  await browser.close();
  await srv.chiudi();
  await pool.end();
});

// --- Supporto ------------------------------------------------------------------------

async function nuovaPagina(opzioni = {}) {
  const contesto = await browser.newContext({ viewport: { width: 1300, height: 950 }, ...opzioni });
  const pagina = await contesto.newPage();
  pagina.errori = [];
  pagina.on('pageerror', (e) => pagina.errori.push(e.message));
  pagina.on('response', (r) => {
    if (r.status() >= 400 && !(r.status() === 401 && r.url().endsWith('/api/auth/me'))) pagina.errori.push(`${r.status()} ${r.url()}`);
  });
  return pagina;
}

async function stabile(pagina) {
  await pagina.waitForFunction(() => !document.querySelector('#contenuto [role=status].stato') && document.querySelector('#contenuto').childElementCount > 0);
}

async function accedi(pagina, hash = '') {
  await pagina.goto(`${srv.origine}/${hash}`);
  await pagina.fill('#campo-email', 'teacher.math.a@alfa.test');
  await pagina.fill('#campo-password', 'Sviluppo!2026');
  await pagina.click('form.modulo-accesso button[type=submit]');
  await pagina.waitForSelector('#intestazione:not([hidden])');
  await pagina.selectOption('#tenant', { index: 1 });
  await pagina.waitForSelector('#contenuto .elenco .scelta');
  await stabile(pagina);
}

/** Va direttamente a un livello (stesso meccanismo del tasto Indietro: popstate sull'indirizzo). */
async function vaiA(pagina, hash) {
  await pagina.evaluate((h) => { history.pushState(null, '', h); dispatchEvent(new PopStateEvent('popstate', { state: null })); }, hash);
  await stabile(pagina);
}

const hashClasse = (scheda) => `#/classe/${t2A.teaching_id}/${scheda}`;
const hashAlunno = (resto = '') => `#/classe/${t2A.teaching_id}/alunno/${luca.enrollmentId}${resto}`;

async function senzaTestiMancanti(pagina, dove) {
  const mancanti = await pagina.$$eval('[data-testo-mancante]', (n) => n.map((x) => x.getAttribute('data-testo-mancante')));
  assert.deepEqual(mancanti, [], `${dove}: identificatori senza testo`);
  assert.ok(!(await pagina.innerText('body')).includes(MARCATORE), `${dove}: marcatore di testo mancante`);
}

async function nessunaViolazione(pagina, dove) {
  await pagina.addScriptTag({ content: AXE });
  const risultato = await pagina.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
  const gravi = risultato.violations.filter((v) => v.impact !== 'minor')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  assert.deepEqual(gravi, [], `${dove}: violazioni di accessibilità`);
}

const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

async function profiloApi() {
  return (await api.get(`/teachings/${t2A.teaching_id}/students/${luca.enrollmentId}/progress`)).corpo;
}

const bandaPerEtichetta = (bande, etichetta) => bande.find((b) => b.etichetta.testo === etichetta);

// --- Test ----------------------------------------------------------------------------

test('P3: la schermata di accesso è nella lingua di piattaforma, senza testi nel guscio', async () => {
  const pagina = await nuovaPagina();
  await pagina.goto(`${srv.origine}/`);
  await pagina.waitForSelector('form.modulo-accesso');
  assert.equal(await pagina.getAttribute('html', 'lang'), 'it');
  assert.equal(await pagina.getAttribute('html', 'dir'), 'ltr');
  assert.equal(await pagina.title(), CATALOGO.UI_APP_TITLE);
  await senzaTestiMancanti(pagina, 'accesso');
  await nessunaViolazione(pagina, 'accesso');
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

test('P15 + V2.1: tutte le viste usano il disco, senza testi mancanti, errori, andamento o violazioni di accessibilità', async () => {
  const pagina = await nuovaPagina();
  await accedi(pagina);
  const attivita = (await api.get(`/teachings/${t2A.teaching_id}/activities`)).corpo.find((a) => a.nome.testo === 'Il grafico delle merende');
  const p = await profiloApi();
  const numeri = p.nuclei.find((n) => n.nome.testo === 'Numeri');
  const viste = [
    ['quadro', hashClasse('quadro'), 3],
    ['nucleo di classe', `#/classe/${t2A.teaching_id}/nucleo/${numeri.id}`, 4],
    ['studenti', hashClasse('studenti'), null],
    ['profilo', hashAlunno(), 3],
    ['nucleo alunno', hashAlunno(`/nucleo/${numeri.id}`), 4],
    ['criterio alunno', hashAlunno(`/nucleo/${numeri.id}/criterio/${numeri.criteri[0].id}`), 1],
    ['griglia', `#/classe/${t2A.teaching_id}/attivita/${attivita.activity_id}/griglia`, null],
    ['esito attività', `#/classe/${t2A.teaching_id}/attivita/${attivita.activity_id}/esito`, 2],
    ['valutazioni', hashClasse('valutazioni'), null],
  ];
  for (const [nome, hash, settori] of viste) {
    await vaiA(pagina, hash);
    await senzaTestiMancanti(pagina, nome);
    if (settori !== null) {
      assert.equal(await pagina.getAttribute('.blocco-disco svg.disco', 'data-settori'), String(settori), `${nome}: un settore per categoria`);
    }
    const testo = await pagina.innerText('#contenuto');
    assert.ok(!/Andamento|↗|↘/.test(testo), `${nome}: nessun andamento`);
    await nessunaViolazione(pagina, nome);
  }
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

test('Valori osservati: 0, 1 e 2 hanno il colore della propria banda (dal server); null è grigio senza banda', async () => {
  const p = await profiloApi();
  const colore = (etichetta) => rgb(bandaPerEtichetta(p.bande, etichetta).colore);
  const pagina = await nuovaPagina();
  await accedi(pagina);
  const numeri = p.nuclei.find((n) => n.nome.testo === 'Numeri');
  await vaiA(pagina, hashAlunno(`/nucleo/${numeri.id}/criterio/${numeri.criteri[0].id}`));
  const sfondo = (sel) => pagina.$eval(sel, (n) => getComputedStyle(n).backgroundColor);
  assert.equal(await sfondo('table.osservazioni .valore[data-valore="0"]'), colore('NON SUFFICIENTE'), '0 Non manifestato è un dato osservato e colorato');
  assert.equal(await sfondo('table.osservazioni .valore[data-valore="1"]'), colore('SUFFICIENTE'));
  assert.equal(await sfondo('table.osservazioni .valore[data-valore="2"]'), colore('OTTIMO'));
  assert.equal(await pagina.getAttribute('table.osservazioni .valore[data-valore="0"]', 'aria-label'), '0 · Non manifestato · NON SUFFICIENTE');

  // Esito dell'attività: distribuzione 0/1/2 + null; griglia: celle vuote grigie.
  const attivita = (await api.get(`/teachings/${t2A.teaching_id}/activities`)).corpo.find((a) => a.nome.testo === 'Il grafico delle merende');
  await vaiA(pagina, `#/classe/${t2A.teaching_id}/attivita/${attivita.activity_id}/esito`);
  const segmenti = await pagina.$$eval('.criterio-esito:first-child .barra-segmenti .segmento', (n) => n.map((x) => [x.dataset.valore, x.textContent, getComputedStyle(x).backgroundColor]));
  assert.deepEqual(segmenti.map(([v, n]) => [v, n]), [['0', '1'], ['1', '9'], ['2', '7'], ['null', '4']]);
  assert.deepEqual(segmenti.slice(0, 3).map((s) => s[2]), [colore('NON SUFFICIENTE'), colore('SUFFICIENTE'), colore('OTTIMO')]);
  const coloriBande = p.bande.map((b) => rgb(b.colore));
  assert.ok(!coloriBande.includes(segmenti[3][2]), 'null non ha mai il colore di una banda');
  assert.equal(await pagina.$eval('.voci-distribuzione .valore.nullo', (n) => n.hasAttribute('data-banda')), false);

  await vaiA(pagina, `#/classe/${t2A.teaching_id}/attivita/${attivita.activity_id}/griglia`);
  const nulli = await pagina.$$eval('table.griglia .valore.nullo', (n) => n.map((x) => [getComputedStyle(x).borderTopStyle, x.getAttribute('aria-label')]));
  assert.ok(nulli.length > 0, 'nella griglia ci sono celle non osservate');
  nulli.forEach(([bordo, etichetta]) => { assert.equal(bordo, 'dashed'); assert.equal(etichetta, CATALOGO.NOT_OBSERVED); });
  await pagina.context().close();
});

test('Disco: colore = banda del valore (dal server), raggio = valore, settori di uguale ampiezza', async () => {
  const p = await profiloApi();
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashAlunno());
  const riempimenti = await pagina.$$eval('.blocco-disco svg.disco .settore .riempimento', (n) => n.map((x) => [x.getAttribute('data-banda'), x.getAttribute('fill')]));
  assert.deepEqual(riempimenti, p.nuclei.map((n) => {
    const b = p.bande.find((x) => x.id === n.risultatoCorrente.bandaId);
    return [String(b.id), b.colore];
  }));
  const ampiezze = await pagina.$$eval('.blocco-disco svg.disco .settore .traccia', (n) => n.map((x) => Math.round(x.getTotalLength())));
  assert.equal(new Set(ampiezze).size, 1, `settori uguali: ${ampiezze}`);
  // Raggio: il riempimento di Numeri (83,33%) arriva più lontano dal centro di Spazio e figure (50%).
  const estensione = await pagina.$$eval('.blocco-disco svg.disco .settore .riempimento', (n) => n.map((x) => {
    const b = x.getBBox();
    return Math.max(Math.abs(b.x), Math.abs(b.y), Math.abs(b.x + b.width), Math.abs(b.y + b.height));
  }));
  assert.ok(estensione[0] > estensione[1]);
  await pagina.context().close();
});

test('Riferimenti: ⌒ classe (arco con terminali) e ◇ storico hanno segni diversi; certezza parziale = righe sopra il colore', async () => {
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashAlunno());
  const segni = await pagina.$eval('.blocco-disco svg.disco .settore[data-settore^="nucleo-"]', (g) => ({
    classe: g.querySelectorAll('.riferimento-classe path').length,
    storico: g.querySelectorAll('.storico path').length,
    titoloClasse: g.querySelector('.riferimento-classe title').textContent,
    titoloStorico: g.querySelector('.storico title').textContent,
    riempimentoStorico: getComputedStyle(g.querySelector('.storico path')).fill,
    riempimentoClasse: getComputedStyle(g.querySelector('.riferimento-classe path')).fill,
  }));
  assert.equal(segni.classe, 3, 'arco + due terminali');
  assert.equal(segni.storico, 1, 'un rombo');
  assert.match(segni.titoloClasse, /^Classe /);
  assert.match(segni.titoloStorico, /^Storico /);
  assert.notEqual(segni.riempimentoStorico, segni.riempimentoClasse);

  const spazio = await pagina.$eval('.blocco-disco svg.disco .settore:nth-of-type(2)', (g) => ({
    righe: !!g.querySelector('.righe[data-certezza="CERTAINTY_PARTIAL"]'),
    colore: g.querySelector('.riempimento').getAttribute('fill'),
  }));
  assert.ok(spazio.righe, 'certezza parziale: righe');
  assert.match(spazio.colore, /^#[0-9a-f]{6}$/, 'il colore della banda resta sotto le righe');
  assert.equal(await pagina.getAttribute('.carta[data-carta^="nucleo-"]:nth-child(2) .certezza', 'aria-label'), CATALOGO.CERTAINTY_PARTIAL);
  await pagina.context().close();
});

test('Criticità distinta dalla certezza: bordo pieno = in banda critica, tratteggiato + ⚠ a contorno = da verificare', async () => {
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashClasse('quadro'));
  const piena = await pagina.$eval('.blocco-disco svg.disco .bordo-critico', (n) => [n.dataset.criticita, getComputedStyle(n).strokeDasharray]);
  assert.deepEqual(piena, ['CRITICAL_BAND', 'none']);
  assert.ok(await pagina.$('.carta.critica .segno.pieno'));

  const p = await profiloApi();
  const spazio = p.nuclei.find((n) => n.nome.testo === 'Spazio e figure');
  await vaiA(pagina, hashAlunno(`/nucleo/${spazio.id}`));
  const daVerificare = await pagina.$eval('.blocco-disco svg.disco .bordo-critico', (n) => [n.dataset.criticita, getComputedStyle(n).strokeDasharray]);
  assert.equal(daVerificare[0], 'CRITICAL_TO_VERIFY');
  assert.notEqual(daVerificare[1], 'none');
  const segno = await pagina.$eval('.carta.verificare .segno.contorno', (n) => [getComputedStyle(n).borderTopStyle, n.getAttribute('aria-label')]);
  assert.deepEqual(segno, ['dashed', CATALOGO.CRITICAL_TO_VERIFY]);
  await pagina.context().close();
});

test('Valutazione del docente: colore della banda solo se il giudizio coincide con una banda; distinta da ■ e dall\'etichetta', async () => {
  const id = t2A.teaching_id;
  const matrice = (await api.get(`/teachings/${id}/students-matrix`)).corpo;
  const chiara = matrice.studenti.find((s) => s.nome === 'Chiara');
  const { rows: [ctx] } = await pool.query(
    `SELECT t.tenant_id, t.school_year_id, t.class_id, t.subject_id, t.account_id,
            (SELECT id FROM assessment_periods WHERE tenant_id = t.tenant_id AND nome = 'Primo quadrimestre') AS periodo
     FROM teachings t WHERE t.id = $1`, [id]
  );
  await pool.query(
    `INSERT INTO assessments (tenant_id, school_year_id, teaching_id, class_id, subject_id, enrollment_id, assessment_period_id, giudizio, recorded_by_account_id, lingua_contenuto)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'In crescita', $8, 'it') ON CONFLICT DO NOTHING`,
    [ctx.tenant_id, ctx.school_year_id, id, ctx.class_id, ctx.subject_id, chiara.enrollmentId, ctx.periodo, ctx.account_id]
  );
  const r = (await api.get(`/teachings/${id}/assessments`)).corpo;
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashClasse('valutazioni'));
  const daValutazione = async (vid) => pagina.$eval(`[data-valutazione="${vid}"]`, (n) => ({
    banda: n.querySelector('.chip.giudizio').getAttribute('data-banda'),
    sfondo: getComputedStyle(n.querySelector('.chip.giudizio')).backgroundColor,
    timbro: n.querySelector('.segno.timbro').getAttribute('aria-label'),
    etichetta: n.querySelector('.giudizio-docente .nota').textContent,
  }));
  const vLuca = r.valutazioni.find((v) => v.alunno.nome === 'Luca');
  const lucaDom = await daValutazione(vLuca.id);
  assert.equal(lucaDom.sfondo, rgb(bandaPerEtichetta(r.bande, 'DISCRETO').colore));
  assert.equal(lucaDom.timbro, CATALOGO.TEACHER_ASSESSMENT);
  assert.equal(lucaDom.etichetta, CATALOGO.TEACHER_ASSESSMENT);
  const chiaraDom = await daValutazione(r.valutazioni.find((v) => v.alunno.nome === 'Chiara').id);
  assert.equal(chiaraDom.banda, null, 'nessuna corrispondenza: nessuna banda');
  assert.ok(!r.bande.map((b) => rgb(b.colore)).includes(chiaraDom.sfondo), 'nessun colore di banda');
  await pagina.context().close();
});

test('Confronto nel profilo: ▲ ▼ = rispetto al complessivo dello stesso alunno', async () => {
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashAlunno());
  const etichette = await pagina.$$eval('.carta .confronto', (n) => n.map((x) => [x.textContent, x.getAttribute('aria-label')]));
  assert.equal(etichette.length, 3);
  etichette.forEach(([glifo, testo]) => {
    assert.ok(['▲', '▼', '='].includes(glifo));
    assert.ok(testo.includes(CATALOGO.UI_VS_OWN_OVERALL), testo);
  });
  await pagina.context().close();
});

test('Studenti: mini-dischi con il complessivo del server (E3), stessi settori per tutti, cornice e filtro per la zona critica', async () => {
  const matrice = (await api.get(`/teachings/${t2A.teaching_id}/students-matrix`)).corpo;
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashClasse('studenti'));
  const mini = await pagina.$$eval('a.alunno', (n) => n.map((x) => ({
    zona: x.classList.contains('in-zona'), settori: x.querySelector('svg.disco').dataset.settori,
    centro: x.querySelector('.centro-valore') ? x.querySelector('.centro-valore').textContent : null,
    ordine: [...x.querySelectorAll('.settore')].map((g) => g.dataset.settore).join(','),
  })));
  assert.equal(mini.length, matrice.studenti.length);
  assert.ok(mini.every((m) => m.settori === String(matrice.nuclei.length)));
  assert.equal(new Set(mini.map((m) => m.ordine)).size, 1, 'stesso nucleo = stesso settore');
  assert.deepEqual(mini.map((m) => m.zona), matrice.studenti.map((s) => s.inZonaCritica));
  matrice.studenti.forEach((s, i) => {
    if (s.complessivo.percentuale === null) return;
    assert.equal(mini[i].centro, `${s.complessivo.sintesi.valore}%`, `${s.cognome}: centro = complessivo del server`);
  });
  await pagina.check('#filtro-zona-critica');
  assert.equal(await pagina.$$eval('a.alunno', (n) => n.length), matrice.studenti.filter((s) => s.inZonaCritica).length);
  await pagina.context().close();
});

test('Navigazione a pila: settore e carta portano allo stesso livello; ← e il tasto Indietro tornano al precedente', async () => {
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashAlunno());
  await pagina.click('.blocco-disco svg.disco .settore[role=link] >> nth=0');
  await stabile(pagina);
  const daSettore = await pagina.evaluate(() => location.hash);
  await pagina.goBack();
  await stabile(pagina);
  assert.equal(await pagina.evaluate(() => location.hash), hashAlunno(), 'il tasto Indietro torna al profilo');
  await pagina.click('.carte .carta.apribile >> nth=0');
  await stabile(pagina);
  assert.equal(await pagina.evaluate(() => location.hash), daSettore, 'carta e settore: stessa destinazione');
  assert.equal((await pagina.innerText('.indietro')).replace(/\s+/g, ' ').trim(), '← Colombo Luca');
  await pagina.click('.indietro');
  await stabile(pagina);
  assert.equal(await pagina.evaluate(() => location.hash), hashAlunno());
  assert.equal((await pagina.innerText('.indietro')).replace(/\s+/g, ' ').trim(), `← 2A · ${CATALOGO.VIEW_STUDENTS}`);
  // Tastiera: il settore si apre con Invio.
  await pagina.focus('.blocco-disco svg.disco .settore[role=link]');
  await pagina.keyboard.press('Enter');
  await stabile(pagina);
  assert.equal(await pagina.evaluate(() => location.hash), daSettore);
  // Ricaricando, l'indirizzo riporta allo stesso livello.
  await pagina.reload();
  await stabile(pagina);
  assert.equal(await pagina.evaluate(() => location.hash), daSettore);
  assert.ok(await pagina.$('.blocco-disco svg.disco'));
  await pagina.context().close();
});

test('Tabella alternativa: «Mostra come tabella» espone la stessa informazione del disco', async () => {
  const p = await profiloApi();
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashAlunno());
  assert.equal(await pagina.isVisible('.tabella-alternativa table'), false);
  await pagina.click('.mostra-tabella');
  assert.equal(await pagina.getAttribute('.mostra-tabella', 'aria-expanded'), 'true');
  const righe = await pagina.$$eval('.tabella-alternativa tbody tr', (n) => n.map((r) => [...r.children].map((c) => c.textContent.trim())));
  assert.equal(righe.length, 1 + p.nuclei.length, 'complessivo + un nucleo per riga');
  assert.ok(righe[1][1].startsWith('83,33'), righe[1].join(' | '));
  const intestazioni = await pagina.$$eval('.tabella-alternativa thead th', (n) => n.map((x) => x.textContent));
  assert.ok(intestazioni.includes(CATALOGO.COLUMN_HISTORY) && intestazioni.includes(CATALOGO.COLUMN_CLASS));
  assert.ok(!intestazioni.includes('Andamento'));
  await pagina.context().close();
});

/** Abilita la pseudo-lingua RTL di prova con il catalogo copiato come sovrascrittura (solo test). */
async function abilitaRtlDiProva(escluse = []) {
  const tenantId = (await pool.query("SELECT id FROM tenants WHERE slug = 'alfa'")).rows[0].id;
  await pool.query("INSERT INTO languages (codice, direzione) VALUES ('ar-XB', 'rtl') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO tenant_languages (tenant_id, lingua) VALUES ($1, 'ar-XB') ON CONFLICT DO NOTHING", [tenantId]);
  await pool.query("DELETE FROM catalog_overrides WHERE tenant_id = $1 AND lingua = 'ar-XB'", [tenantId]);
  for (const [chiave, valore] of Object.entries(CATALOGO)) {
    if (escluse.includes(chiave)) continue;
    await pool.query("INSERT INTO catalog_overrides (tenant_id, lingua, chiave, valore) VALUES ($1, 'ar-XB', $2, $3)", [tenantId, chiave, JSON.stringify(valore)]);
  }
}

async function cambiaLingua(pagina, codice, direzione) {
  await pagina.evaluate(() => { document.querySelector('#contenuto').firstElementChild.dataset.primaDelCambio = '1'; });
  await pagina.selectOption('#lingua', codice);
  await pagina.waitForFunction((dir) => document.documentElement.getAttribute('dir') === dir
    && !document.querySelector('[data-prima-del-cambio]')
    && !document.querySelector('#contenuto [role=status].stato')
    && document.querySelector('#contenuto').childElementCount > 0, direzione);
}

async function primoSettore(pagina) {
  return pagina.$eval('.blocco-disco svg.disco', (svg) => {
    const box = svg.getBoundingClientRect();
    const r = svg.querySelector('.settore .riempimento').getBoundingClientRect();
    return { centroDisco: box.x + box.width / 2, centroSettore: r.x + r.width / 2 };
  });
}

test('RTL: il disco si specchia (primo nucleo all\'inizio della riga di lettura), con il percorso', async () => {
  await abilitaRtlDiProva();
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashAlunno());
  const ltr = await primoSettore(pagina);
  assert.ok(ltr.centroSettore > ltr.centroDisco, 'LTR: primo settore verso destra');
  await cambiaLingua(pagina, 'ar-XB', 'rtl');
  assert.equal(await pagina.getAttribute('html', 'lang'), 'ar-XB');
  await senzaTestiMancanti(pagina, 'profilo RTL');
  const rtl = await primoSettore(pagina);
  assert.ok(rtl.centroSettore < rtl.centroDisco, 'RTL: primo settore verso sinistra');
  const percorso = await pagina.$$eval('nav.percorso > *:not(.separatore)', (n) => n.map((x) => x.getBoundingClientRect().x));
  assert.ok(percorso[0] > percorso.at(-1));
  await nessunaViolazione(pagina, 'profilo RTL');
  await cambiaLingua(pagina, 'it', 'ltr');
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

test('§17: un testo mancante nella lingua della sessione è segnalato dal marcatore, mai sostituito da un\'altra lingua', async () => {
  await abilitaRtlDiProva(['UI_TEACHINGS']);
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await cambiaLingua(pagina, 'ar-XB', 'rtl');
  const titolo = await pagina.$('#contenuto h2');
  assert.equal(await titolo.textContent(), MARCATORE);
  assert.equal(await titolo.getAttribute('data-testo-mancante'), 'UI_TEACHINGS');
  await cambiaLingua(pagina, 'it', 'ltr');
  await pagina.context().close();
});

test('Bianco e nero: ogni distinzione ha anche una forma (righe, tratteggio, bordo, testo)', async () => {
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashAlunno());
  await pagina.addStyleTag({ content: 'html { filter: grayscale(1) }' });
  const forme = await pagina.evaluate(() => ({
    parziale: !!document.querySelector('.settore .righe'),
    certezzaTesto: [...document.querySelectorAll('.carta .certezza')].every((c) => c.getAttribute('aria-label')),
    chipConTesto: [...document.querySelectorAll('.carta .chip:not(.vuoto)')].every((c) => c.textContent.trim().length > 0),
  }));
  assert.deepEqual(forme, { parziale: true, certezzaTesto: true, chipConTesto: true });
  await pagina.context().close();
});
