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
 * Iterazione 1: creazione di una scuola, password temporanea mostrata una volta, primo
 * accesso con cambio obbligatorio.
 * Iterazione 2A: amministrazione dell'istituto (quadro, calendario, livelli e classi),
 * «passa al nuovo anno» con conferma, RTL della cornice.
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

test('Iterazione 1: il PLATFORM_ADMIN crea una scuola; il nuovo amministratore entra con la temporanea, è obbligato a cambiarla, poi vede la propria amministrazione', async () => {
  const pagina = await nuovaPagina({ permissions: ['clipboard-read', 'clipboard-write'] });
  await pagina.goto(`${srv.origine}/`);
  await pagina.fill('#campo-email', 'platform.admin@platform.test');
  await pagina.fill('#campo-password', 'Sviluppo!2026');
  await pagina.click('form.modulo-accesso button[type=submit]');
  await pagina.waitForSelector('#intestazione:not([hidden])');
  await pagina.click('#amministrazione');
  await pagina.waitForSelector('form.modulo-scuola');
  await stabile(pagina);
  await senzaTestiMancanti(pagina, 'amministrazione della piattaforma');
  await nessunaViolazione(pagina, 'amministrazione della piattaforma');

  // Nuova scuola: le etichette portano ai campi (getByLabel), l'email con maiuscole.
  await pagina.getByLabel(CATALOGO.UI_SCHOOL_NAME, { exact: true }).fill('Istituto Comprensivo Omega');
  await pagina.getByLabel(CATALOGO.UI_SCHOOL_SLUG, { exact: true }).fill('omega');
  await pagina.getByLabel(CATALOGO.UI_FIRST_NAME, { exact: true }).fill('Olga');
  await pagina.getByLabel(CATALOGO.UI_LAST_NAME, { exact: true }).fill('Omega');
  await pagina.locator('form.modulo-scuola').getByLabel(CATALOGO.UI_EMAIL, { exact: true }).fill('Olga.Omega@Omega.test');
  await pagina.click('form.modulo-scuola button[type=submit]');
  await pagina.waitForSelector('#password-temporanea');
  const temporanea = (await pagina.textContent('#password-temporanea')).trim();
  assert.match(temporanea, /^[A-HJ-NP-Za-km-np-z2-9]{16}$/);
  assert.equal(await pagina.evaluate(() => document.activeElement.id), 'titolo-credenziali', 'il fuoco va al riquadro della password');
  assert.ok((await pagina.innerText('.riquadro-credenziali')).includes(CATALOGO.UI_TEMP_PASSWORD_WARNING));
  await senzaTestiMancanti(pagina, 'password temporanea');
  await nessunaViolazione(pagina, 'password temporanea');
  await pagina.click('.riquadro-credenziali button.azione');
  await pagina.waitForSelector('.esito-copia span');
  assert.equal(await pagina.textContent('.esito-copia'), CATALOGO.UI_COPIED);
  assert.equal(await pagina.evaluate(() => navigator.clipboard.readText()), temporanea);
  assert.ok((await pagina.innerText('.elenco-scuole')).includes('olga.omega@omega.test'));

  // Una sola volta: ridisegnata la vista, la password non c'è più.
  await pagina.click('#amministrazione');
  await pagina.waitForFunction(() => !document.querySelector('#password-temporanea') && document.querySelector('form.modulo-scuola'));
  assert.ok(!(await pagina.innerText('body')).includes(temporanea));
  await pagina.click('#esci');
  await pagina.waitForSelector('form.modulo-accesso');

  // Primo accesso: solo la schermata di cambio password.
  await pagina.fill('#campo-email', 'olga.omega@omega.test');
  await pagina.fill('#campo-password', temporanea);
  await pagina.click('form.modulo-accesso button[type=submit]');
  await pagina.waitForSelector('#titolo-cambio-password');
  assert.equal(await pagina.evaluate(() => document.activeElement.id), 'password-attuale');
  const intestazione = await pagina.evaluate(() => ['blocco-tenant', 'amministrazione', 'cambia-password', 'come-leggere-apri', 'esci']
    .map((id) => document.getElementById(id).hidden));
  assert.deepEqual(intestazione, [true, true, true, true, false], 'solo «Esci» resta disponibile');
  await senzaTestiMancanti(pagina, 'cambio obbligatorio');
  await nessunaViolazione(pagina, 'cambio obbligatorio');

  // Errori associati ai campi: conferma diversa (nel client), nuova uguale alla temporanea (dal server).
  await pagina.getByLabel(CATALOGO.UI_PASSWORD_TEMPORARY, { exact: true }).fill(temporanea);
  await pagina.getByLabel(CATALOGO.UI_PASSWORD_NEW, { exact: true }).fill('una frase lunga e nuova');
  await pagina.getByLabel(CATALOGO.UI_PASSWORD_CONFIRM, { exact: true }).fill('una frase diversa');
  await pagina.press('#password-ripetuta', 'Enter');
  await pagina.waitForSelector('#password-ripetuta-errore:not([hidden])');
  assert.equal(await pagina.textContent('#password-ripetuta-errore'), CATALOGO.ERR_PASSWORD_CONFIRMATION_MISMATCH);
  assert.deepEqual(await pagina.evaluate(() => [document.activeElement.id, document.activeElement.getAttribute('aria-invalid'),
    document.activeElement.getAttribute('aria-describedby')]), ['password-ripetuta', 'true', 'password-ripetuta-errore']);
  await pagina.getByLabel(CATALOGO.UI_PASSWORD_NEW, { exact: true }).fill(temporanea);
  await pagina.getByLabel(CATALOGO.UI_PASSWORD_CONFIRM, { exact: true }).fill(temporanea);
  await pagina.press('#password-ripetuta', 'Enter');
  await pagina.waitForSelector('#password-nuova-errore:not([hidden])');
  assert.equal(await pagina.textContent('#password-nuova-errore'), CATALOGO.ERR_PASSWORD_SAME_AS_TEMPORARY);
  assert.equal(await pagina.getAttribute('#password-nuova', 'aria-invalid'), 'true');
  assert.ok((await pagina.getAttribute('#password-nuova', 'aria-describedby')).split(' ').includes('password-nuova-errore'));
  await nessunaViolazione(pagina, 'cambio obbligatorio con errore');
  assert.deepEqual(pagina.errori.map((e) => e.replace(srv.origine, '')), ['400 /api/auth/password'], 'il solo errore atteso');
  pagina.errori.length = 0;

  // Cambio riuscito, da tastiera; poi la propria scuola e la propria amministrazione.
  await pagina.getByLabel(CATALOGO.UI_PASSWORD_NEW, { exact: true }).fill('una frase lunga e nuova');
  await pagina.getByLabel(CATALOGO.UI_PASSWORD_CONFIRM, { exact: true }).fill('una frase lunga e nuova');
  await pagina.press('#password-ripetuta', 'Enter');
  await pagina.waitForSelector('#contenuto .conferma');
  assert.equal(await pagina.textContent('#contenuto .conferma'), CATALOGO.UI_PASSWORD_CHANGED);
  assert.equal(await pagina.isHidden('#blocco-tenant'), false);
  assert.equal((await pagina.textContent('#istituto-attivo bdi')), 'Istituto Comprensivo Omega', 'entra direttamente nella sua sola scuola');
  assert.equal(await pagina.isHidden('#cambia-istituto'), true, 'una sola scuola: niente «Cambia istituto»');
  await pagina.waitForSelector('#amministrazione:not([hidden])');
  await stabile(pagina);
  await pagina.click('#amministrazione');
  await pagina.waitForFunction((titolo) => [...document.querySelectorAll('#contenuto h3')].some((h) => h.textContent === titolo), CATALOGO.UI_TRANSLATION_COMPLETENESS);
  assert.equal(await pagina.textContent('#contenuto h2'), CATALOGO.UI_ADMINISTRATION);
  assert.equal(await pagina.$('form.modulo-scuola'), null, 'niente amministrazione della piattaforma');
  await senzaTestiMancanti(pagina, 'amministrazione della scuola');
  await nessunaViolazione(pagina, 'amministrazione della scuola');

  // «Cambia password» resta raggiungibile dal menu.
  await pagina.click('#cambia-password');
  await pagina.waitForSelector('form.modulo-password');
  assert.equal(await pagina.textContent('label[for=password-attuale]'), CATALOGO.UI_PASSWORD_CURRENT);
  await senzaTestiMancanti(pagina, 'cambio volontario');
  await nessunaViolazione(pagina, 'cambio volontario');
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

// --- Iterazione 1, passo 6: scelta dell'istituto ------------------------------------------

async function entraCome(pagina, email) {
  await pagina.goto(`${srv.origine}/`);
  await pagina.fill('#campo-email', email);
  await pagina.fill('#campo-password', 'Sviluppo!2026');
  await pagina.click('form.modulo-accesso button[type=submit]');
  await pagina.waitForSelector('#intestazione:not([hidden])');
  await stabile(pagina);
}

const titoloVista = (pagina) => pagina.textContent('#contenuto h2');
const pulsantiIstituti = (pagina) => pagina.$$eval('#contenuto .elenco-istituti button.scelta',
  (b) => b.map((x) => x.innerText.split('\n').map((r) => r.trim()).filter(Boolean)));

test('Passo 6: docente di una sola scuola — dopo il login vede subito i suoi insegnamenti; nessun select dell\'istituto', async () => {
  const pagina = await nuovaPagina();
  await entraCome(pagina, 'teacher.math.a@alfa.test');
  assert.equal(await titoloVista(pagina), CATALOGO.UI_TEACHINGS);
  assert.ok((await pagina.$$('#contenuto .elenco a.scelta')).length > 0, 'i suoi insegnamenti');
  assert.equal(await pagina.$('#tenant'), null, 'nessun <select id="tenant">');
  assert.deepEqual(await pagina.$$eval('#intestazione select', (s) => s.map((x) => x.id)), ['lingua'], 'resta solo il selettore della lingua');
  assert.equal(await pagina.textContent('#istituto-attivo bdi'), 'Istituto Comprensivo Alfa');
  assert.equal(await pagina.isHidden('#cambia-istituto'), true, 'una sola scuola: niente «Cambia istituto»');
  await senzaTestiMancanti(pagina, 'insegnamenti dopo il login');
  await nessunaViolazione(pagina, 'insegnamenti dopo il login');
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

test('Passo 6: utente con due scuole — pulsanti con nome e ruoli, scelta da tastiera, «Cambia istituto» e tasto Indietro', async () => {
  const pagina = await nuovaPagina();
  await entraCome(pagina, 'multitenant.user@example.test');
  assert.equal(await titoloVista(pagina), CATALOGO.UI_CHOOSE_TENANT);
  assert.ok(pagina.url().endsWith('#/istituti'));
  assert.deepEqual(await pulsantiIstituti(pagina), [
    ['Istituto Comprensivo Alfa', CATALOGO.ROLE_TEACHER],
    ['Istituto Comprensivo Beta', CATALOGO.ROLE_COORDINATOR],
  ]);
  assert.equal(await pagina.isHidden('#blocco-tenant'), true, 'nessuna scuola attiva da mostrare');
  assert.equal(await pagina.$('#tenant'), null);
  await senzaTestiMancanti(pagina, 'scegli l\'istituto');
  await nessunaViolazione(pagina, 'scegli l\'istituto');

  // Da tastiera: fuoco sul secondo pulsante, Invio.
  await pagina.focus('#contenuto .elenco-istituti button.scelta >> nth=1');
  await pagina.keyboard.press('Enter');
  await pagina.waitForFunction(() => document.querySelector('#istituto-attivo bdi'));
  await stabile(pagina);
  assert.equal(await titoloVista(pagina), CATALOGO.UI_TEACHINGS);
  assert.equal(await pagina.textContent('#istituto-attivo bdi'), 'Istituto Comprensivo Beta');
  assert.equal(await pagina.isVisible('#cambia-istituto'), true);
  assert.equal(await pagina.textContent('#cambia-istituto'), CATALOGO.UI_CHANGE_TENANT);

  // «Cambia istituto» riporta all'elenco (scuola attiva segnata); il tasto Indietro torna dove si era.
  await pagina.click('#cambia-istituto');
  await pagina.waitForSelector('#contenuto .elenco-istituti');
  await stabile(pagina);
  assert.equal(await titoloVista(pagina), CATALOGO.UI_CHOOSE_TENANT);
  assert.deepEqual(await pagina.$$eval('.elenco-istituti button[aria-current="true"] .titolo', (n) => n.map((x) => x.textContent)),
    ['Istituto Comprensivo Beta']);
  await nessunaViolazione(pagina, 'cambia istituto');
  await pagina.goBack();
  await pagina.waitForFunction((t) => document.querySelector('#contenuto h2') && document.querySelector('#contenuto h2').textContent === t,
    CATALOGO.UI_TEACHINGS);

  // Di nuovo l'elenco, poi l'altra scuola.
  await pagina.click('#cambia-istituto');
  await pagina.waitForSelector('#contenuto .elenco-istituti');
  await pagina.click('#contenuto .elenco-istituti button.scelta >> nth=0');
  await pagina.waitForFunction(() => document.querySelector('#istituto-attivo bdi')
    && document.querySelector('#istituto-attivo bdi').textContent === 'Istituto Comprensivo Alfa');
  await stabile(pagina);
  assert.equal(await titoloVista(pagina), CATALOGO.UI_TEACHINGS);
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

test('Passo 6: RTL — la vista «Scegli l\'istituto» si specchia (testo all\'inizio della riga di lettura), senza testi mancanti', async () => {
  await abilitaRtlDiProva();
  const pagina = await nuovaPagina();
  await entraCome(pagina, 'multitenant.user@example.test');
  await pagina.click('#contenuto .elenco-istituti button.scelta >> nth=0'); // Alfa, dove la lingua RTL di prova è abilitata
  await pagina.waitForSelector('#blocco-lingua:not([hidden])');
  await stabile(pagina);
  await cambiaLingua(pagina, 'ar-XB', 'rtl');
  await pagina.click('#cambia-istituto');
  await pagina.waitForSelector('#contenuto .elenco-istituti');
  await stabile(pagina);
  await senzaTestiMancanti(pagina, 'scegli l\'istituto RTL');
  const posizione = await pagina.$eval('#contenuto .elenco-istituti button.scelta', (b) => {
    const box = b.getBoundingClientRect();
    const testo = document.createRange();
    testo.selectNodeContents(b.querySelector('.titolo'));
    const titolo = testo.getBoundingClientRect();
    return { direzione: getComputedStyle(b).direction, distanzaFine: box.right - titolo.right, distanzaInizio: titolo.left - box.left };
  });
  assert.equal(posizione.direzione, 'rtl');
  assert.ok(posizione.distanzaFine < posizione.distanzaInizio, 'in RTL il nome sta a destra, dove inizia la riga');
  await nessunaViolazione(pagina, 'scegli l\'istituto RTL');
  await pagina.click('#contenuto .elenco-istituti button.scelta >> nth=0');
  await pagina.waitForSelector('#blocco-lingua:not([hidden])');
  await stabile(pagina);
  await cambiaLingua(pagina, 'it', 'ltr');
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

test('Passo 6: PLATFORM_ADMIN — prima vista l\'Amministrazione; entra in una scuola con lo stesso elenco di pulsanti', async () => {
  const pagina = await nuovaPagina();
  await entraCome(pagina, 'platform.admin@platform.test');
  assert.equal(await titoloVista(pagina), CATALOGO.UI_ADMINISTRATION);
  assert.ok(pagina.url().endsWith('#/amministrazione'));
  const nomi = (await pulsantiIstituti(pagina)).map((righe) => righe[0]);
  assert.ok(nomi.includes('Istituto Comprensivo Alfa') && nomi.includes('Istituto Comprensivo Beta'), nomi.join(', '));
  await nessunaViolazione(pagina, 'amministrazione con elenco delle scuole');
  await pagina.click('#contenuto .elenco-istituti button.scelta:has-text("Istituto Comprensivo Beta")');
  await pagina.waitForFunction(() => document.querySelector('#istituto-attivo bdi'));
  await stabile(pagina);
  assert.equal(await pagina.textContent('#istituto-attivo bdi'), 'Istituto Comprensivo Beta');
  assert.equal(await titoloVista(pagina), CATALOGO.UI_TEACHINGS);
  assert.equal(await pagina.isVisible('#cambia-istituto'), true);
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

// --- Iterazione 2, passo A: amministrazione dell'istituto ---------------------------------

const { login } = require('./support/http');

/** Testo del catalogo con i parametri (stessa sostituzione di i18n.js, solo per i confronti). */
const testoCatalogo = (chiave, parametri = {}) => CATALOGO[chiave].replace(/\{(\w+)\}/g, (_, nome) => parametri[nome]);

/** Scuola vuota creata dal PLATFORM_ADMIN via API; il suo amministratore ha già cambiato la temporanea. */
async function scuolaVuotaE2e(slug) {
  const { sessione } = await login(srv.base, 'platform.admin@platform.test');
  const creata = await sessione.post('/platform/tenants', {
    slug, nome: `Istituto ${slug}`, amministratore: { nome: 'Zoe', cognome: 'Zeta', email: `admin@${slug}.test` },
  });
  assert.equal(creata.status, 201);
  const { sessione: admin } = await login(srv.base, `admin@${slug}.test`, creata.corpo.amministratore.passwordTemporanea);
  assert.equal((await admin.post('/auth/password', {
    passwordAttuale: creata.corpo.amministratore.passwordTemporanea, passwordNuova: 'Sviluppo!2026',
  })).status, 200);
  return { email: `admin@${slug}.test`, tenantId: creata.corpo.id };
}

/** Esegue un'azione che ridisegna la vista e attende la vista nuova con la conferma. */
async function conRidisegno(pagina, azione) {
  await pagina.evaluate(() => { document.querySelector('#contenuto').firstElementChild.dataset.primaDellAzione = '1'; });
  await azione();
  await pagina.waitForFunction(() => !document.querySelector('[data-prima-dell-azione]') && document.querySelector('#contenuto .conferma'));
  await stabile(pagina);
}

async function vociDaFare(pagina) {
  return pagina.$$eval('#contenuto .cose-da-fare li', (n) => n.map((x) => x.textContent.trim()));
}

const moduloDi = (pagina, id) => pagina.locator(`form[aria-labelledby="${id}-titolo"]`);
const sezioneMenu = (pagina, chiave) => pagina.locator('.menu-amministrazione').getByRole('link', { name: CATALOGO[chiave], exact: true });

test('Iterazione 2A: un TENANT_ADMIN prepara una scuola vuota — quadro, anno in preparazione poi attivo, due periodi, un livello con due classi; il quadro si aggiorna', async () => {
  const { email } = await scuolaVuotaE2e('zeta');
  const pagina = await nuovaPagina();
  pagina.on('dialog', (d) => d.accept());
  await entraCome(pagina, email);
  await pagina.click('#amministrazione');
  await pagina.waitForSelector('.cose-da-fare');
  await stabile(pagina);

  // 1. Il quadro elenca le cose da fare, ognuna con il collegamento dove si sistema.
  assert.equal(await titoloVista(pagina), CATALOGO.UI_ADMINISTRATION);
  assert.deepEqual(await vociDaFare(pagina), [CATALOGO.UI_TODO_NO_ACTIVE_YEAR, CATALOGO.UI_TODO_NO_LEVELS]);
  assert.equal(await pagina.$$eval('.cose-da-fare li a', (n) => n.length), 2);
  assert.equal(await pagina.getAttribute('.menu-amministrazione [aria-current="page"]', 'href'), '#/amministrazione/quadro');
  assert.ok((await pagina.innerText('.anno-di-lavoro')).includes(CATALOGO.UI_NO_SCHOOL_YEARS));
  await senzaTestiMancanti(pagina, 'quadro della scuola vuota');
  await nessunaViolazione(pagina, 'quadro della scuola vuota');

  // 2. Il collegamento porta al calendario; il nuovo anno nasce in preparazione, poi si attiva (con conferma).
  await pagina.click(`.cose-da-fare a:has-text("${CATALOGO.UI_TODO_NO_ACTIVE_YEAR}")`);
  await pagina.waitForSelector('form[aria-labelledby="nuovo-anno-titolo"]');
  await stabile(pagina);
  assert.ok(pagina.url().includes('#/amministrazione/calendario'));
  // Errore sul campo: nome mancante (dal server).
  await moduloDi(pagina, 'nuovo-anno').getByLabel(CATALOGO.UI_DATE_START, { exact: true }).fill('2026-09-01');
  await moduloDi(pagina, 'nuovo-anno').getByLabel(CATALOGO.UI_DATE_END, { exact: true }).fill('2027-06-30');
  await moduloDi(pagina, 'nuovo-anno').locator('button[type=submit]').click();
  await pagina.waitForSelector('#nuovo-anno-nome-errore:not([hidden])');
  assert.equal(await pagina.textContent('#nuovo-anno-nome-errore'), testoCatalogo('ERR_REQUIRED_FIELD', { campo: CATALOGO.UI_FIELD_NOME }));
  assert.deepEqual(await pagina.evaluate(() => [document.activeElement.id, document.activeElement.getAttribute('aria-invalid')]), ['nuovo-anno-nome', 'true']);
  await nessunaViolazione(pagina, 'nuovo anno con errore');
  assert.deepEqual(pagina.errori.map((e) => e.replace(srv.origine, '')), ['400 /api/admin/school-years'], 'il solo errore atteso');
  pagina.errori.length = 0;
  await conRidisegno(pagina, async () => {
    await moduloDi(pagina, 'nuovo-anno').getByLabel(CATALOGO.UI_SCHOOL_YEAR_NAME, { exact: true }).fill('2026/2027');
    await pagina.press('#nuovo-anno-nome', 'Enter');
  });
  assert.deepEqual(await pagina.$$eval('.elenco-anni .etichetta-stato', (n) => n.map((x) => x.textContent)), [CATALOGO.STATUS_SCHOOL_YEAR_IN_PREPARAZIONE]);
  assert.ok((await pagina.innerText('.anno-di-lavoro')).includes('2026/2027'), 'diventa l\'anno su cui si lavora');
  await conRidisegno(pagina, () => pagina.getByRole('button', { name: testoCatalogo('UI_YEAR_ACTIVATE_FOR', { anno: '2026/2027' }) }).click());
  assert.deepEqual(await pagina.$$eval('.elenco-anni .etichetta-stato', (n) => n.map((x) => x.textContent)), [CATALOGO.STATUS_SCHOOL_YEAR_ATTIVO]);

  // 3. Due periodi dell'anno di lavoro (anche sovrapposti).
  for (const [nome, inizio, fine] of [['Primo quadrimestre', '2026-09-01', '2027-01-31'], ['Secondo quadrimestre', '2027-01-15', '2027-06-30']]) {
    await conRidisegno(pagina, async () => {
      const modulo = moduloDi(pagina, 'nuovo-periodo');
      await modulo.getByLabel(CATALOGO.UI_PERIOD_NAME, { exact: true }).fill(nome);
      await modulo.getByLabel(CATALOGO.UI_DATE_START, { exact: true }).fill(inizio);
      await modulo.getByLabel(CATALOGO.UI_DATE_END, { exact: true }).fill(fine);
      await modulo.locator('button[type=submit]').click();
    });
  }
  assert.deepEqual(await pagina.$$eval('.elenco-periodi .titolo', (n) => n.map((x) => x.textContent)), ['Primo quadrimestre', 'Secondo quadrimestre']);
  await senzaTestiMancanti(pagina, 'calendario');
  await nessunaViolazione(pagina, 'calendario');

  // 4. Un livello con due classi.
  await sezioneMenu(pagina, 'UI_ADMIN_SECTION_LEVELS').click();
  await pagina.waitForSelector('form[aria-labelledby="nuovo-livello-titolo"]');
  await stabile(pagina);
  assert.equal(await pagina.$('.anno-di-lavoro'), null, 'livelli e classi non seguono l\'anno');
  await conRidisegno(pagina, async () => {
    await moduloDi(pagina, 'nuovo-livello').getByLabel(CATALOGO.UI_LEVEL_NAME, { exact: true }).fill('Primaria');
    await pagina.press('#nuovo-livello-nome', 'Enter');
  });
  await nessunaViolazione(pagina, 'livelli');
  await pagina.getByRole('link', { name: testoCatalogo('UI_LEVEL_OPEN_CLASSES_FOR', { livello: 'Primaria' }) }).click();
  await pagina.waitForSelector('form[aria-labelledby="nuova-classe-titolo"]');
  await stabile(pagina);
  for (const nome of ['1A', '1B']) {
    await conRidisegno(pagina, async () => {
      await moduloDi(pagina, 'nuova-classe').getByLabel(CATALOGO.UI_CLASS_NAME, { exact: true }).fill(nome);
      await pagina.press('#nuova-classe-nome', 'Enter');
    });
  }
  assert.deepEqual(await pagina.$$eval('.elenco-classi .titolo', (n) => n.map((x) => x.textContent)), ['1A', '1B']);
  assert.equal(await pagina.getAttribute('.menu-amministrazione [aria-current="page"]', 'href'), '#/amministrazione/livelli', 'le classi stanno nella sezione dei livelli');
  assert.equal(await pagina.$('.elenco-classi button:has-text("sposta")'), null);
  await senzaTestiMancanti(pagina, 'classi');
  await nessunaViolazione(pagina, 'classi');

  // 5. Il quadro si aggiorna: restano le classi senza alunni e senza insegnamenti (sezioni dei passi futuri: senza collegamento).
  await sezioneMenu(pagina, 'UI_ADMIN_SECTION_OVERVIEW').click();
  await pagina.waitForSelector('.cose-da-fare');
  await stabile(pagina);
  const parametri = (classe) => ({ classe, livello: 'Primaria', anno: '2026/2027' });
  assert.deepEqual(await vociDaFare(pagina), [
    testoCatalogo('UI_TODO_CLASS_WITHOUT_STUDENTS', parametri('1A')), testoCatalogo('UI_TODO_CLASS_WITHOUT_STUDENTS', parametri('1B')),
    testoCatalogo('UI_TODO_CLASS_WITHOUT_TEACHINGS', parametri('1A')), testoCatalogo('UI_TODO_CLASS_WITHOUT_TEACHINGS', parametri('1B')),
  ]);
  assert.equal(await pagina.$$eval('.cose-da-fare li a', (n) => n.length), 0);
  assert.deepEqual(await pagina.$$eval('.riepilogo-livelli tbody tr', (n) => n.map((r) => [...r.children].map((c) => c.textContent))), [['Primaria', '2', '0', '0', '0']]);
  await senzaTestiMancanti(pagina, 'quadro aggiornato');
  await nessunaViolazione(pagina, 'quadro aggiornato');
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

test('Iterazione 2A: «passa al nuovo anno» chiede conferma (annullata: nulla cambia; confermata: chiude l\'attivo e attiva il nuovo)', async () => {
  const { email } = await scuolaVuotaE2e('passaggio');
  const pagina = await nuovaPagina();
  const dialoghi = [];
  let risposta = 'annulla';
  pagina.on('dialog', (d) => { dialoghi.push(d.message()); return risposta === 'conferma' ? d.accept() : d.dismiss(); });
  await entraCome(pagina, email);
  await vaiA(pagina, '#/amministrazione/calendario');
  for (const [nome, inizio, fine] of [['2026/2027', '2026-09-01', '2027-06-30'], ['2027/2028', '2027-09-01', '2028-06-30']]) {
    await conRidisegno(pagina, async () => {
      const modulo = moduloDi(pagina, 'nuovo-anno');
      await modulo.getByLabel(CATALOGO.UI_SCHOOL_YEAR_NAME, { exact: true }).fill(nome);
      await modulo.getByLabel(CATALOGO.UI_DATE_START, { exact: true }).fill(inizio);
      await modulo.getByLabel(CATALOGO.UI_DATE_END, { exact: true }).fill(fine);
      await modulo.locator('button[type=submit]').click();
    });
    if (nome === '2026/2027') {
      risposta = 'conferma';
      await conRidisegno(pagina, () => pagina.getByRole('button', { name: testoCatalogo('UI_YEAR_ACTIVATE_FOR', { anno: '2026/2027' }) }).click());
      risposta = 'annulla';
    }
  }
  const stati = () => pagina.$$eval('.elenco-anni li', (n) => n.map((li) => [li.querySelector('.titolo').textContent, li.querySelector('.etichetta-stato').textContent]));
  assert.deepEqual(await stati(), [['2027/2028', CATALOGO.STATUS_SCHOOL_YEAR_IN_PREPARAZIONE], ['2026/2027', CATALOGO.STATUS_SCHOOL_YEAR_ATTIVO]]);
  assert.ok((await pagina.innerText('.passaggio')).includes(testoCatalogo('UI_YEAR_SWITCH_TEXT', { da: '2026/2027', a: '2027/2028' })));
  await nessunaViolazione(pagina, 'calendario con il passaggio');

  // Annullata: nessuna richiesta, nulla cambia.
  const passaggi = [];
  pagina.on('request', (r) => { if (r.url().endsWith('/switch-to')) passaggi.push(r.method()); });
  const conferme = dialoghi.length;
  await pagina.click('.passaggio button');
  assert.equal(dialoghi.length, conferme + 1, 'una richiesta di conferma');
  assert.deepEqual(passaggi, [], 'annullata: nessuna richiesta al server');
  assert.equal(dialoghi.at(-1), testoCatalogo('UI_YEAR_SWITCH_CONFIRM', { da: '2026/2027', a: '2027/2028' }));
  assert.deepEqual(await stati(), [['2027/2028', CATALOGO.STATUS_SCHOOL_YEAR_IN_PREPARAZIONE], ['2026/2027', CATALOGO.STATUS_SCHOOL_YEAR_ATTIVO]]);

  // Confermata: un'unica operazione.
  risposta = 'conferma';
  await conRidisegno(pagina, () => pagina.click('.passaggio button'));
  assert.deepEqual(passaggi, ['POST'], 'confermata: una sola richiesta');
  assert.deepEqual(await stati(), [['2027/2028', CATALOGO.STATUS_SCHOOL_YEAR_ATTIVO], ['2026/2027', CATALOGO.STATUS_SCHOOL_YEAR_CHIUSO]]);
  assert.equal(await pagina.$('.passaggio'), null, 'nessun passaggio da proporre');
  assert.ok((await pagina.innerText('.anno-di-lavoro [aria-current="true"]')).includes('2027/2028'), 'l\'anno attivo diventa l\'anno di lavoro');
  await senzaTestiMancanti(pagina, 'calendario dopo il passaggio');
  await nessunaViolazione(pagina, 'calendario dopo il passaggio');
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

test('Iterazione 2A: RTL — la cornice dell\'amministrazione (menu, anno di lavoro, percorso) si specchia, senza testi mancanti', async () => {
  const { email, tenantId } = await scuolaVuotaE2e('specchio');
  await pool.query("INSERT INTO languages (codice, direzione) VALUES ('ar-XB', 'rtl') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO tenant_languages (tenant_id, lingua) VALUES ($1, 'ar-XB') ON CONFLICT DO NOTHING", [tenantId]);
  for (const [chiave, valore] of Object.entries(CATALOGO)) {
    await pool.query("INSERT INTO catalog_overrides (tenant_id, lingua, chiave, valore) VALUES ($1, 'ar-XB', $2, $3)", [tenantId, chiave, JSON.stringify(valore)]);
  }
  await pool.query("INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine, stato) VALUES ($1, '2026/2027', '2026-09-01', '2027-06-30', 'attivo'), ($1, '2027/2028', '2027-09-01', '2028-06-30', 'in_preparazione')", [tenantId]);
  const pagina = await nuovaPagina();
  await entraCome(pagina, email);
  await vaiA(pagina, '#/amministrazione/calendario');
  const posizioni = () => pagina.evaluate(() => ({
    menu: [...document.querySelectorAll('.menu-amministrazione .voce-menu')].map((x) => x.getBoundingClientRect().x),
    anni: [...document.querySelectorAll('.anno-di-lavoro .scelta-anno')].map((x) => x.getBoundingClientRect().x),
    percorso: [...document.querySelectorAll('nav.percorso > *:not(.separatore)')].map((x) => x.getBoundingClientRect().x),
  }));
  const ltr = await posizioni();
  assert.ok(ltr.menu[0] < ltr.menu.at(-1) && ltr.anni[0] < ltr.anni.at(-1) && ltr.percorso[0] < ltr.percorso.at(-1), 'LTR: da sinistra a destra');
  await cambiaLingua(pagina, 'ar-XB', 'rtl');
  await senzaTestiMancanti(pagina, 'amministrazione RTL');
  const rtl = await posizioni();
  assert.ok(rtl.menu[0] > rtl.menu.at(-1), 'RTL: la prima sezione all\'inizio della riga di lettura (a destra)');
  assert.ok(rtl.anni[0] > rtl.anni.at(-1), 'RTL: anni specchiati');
  assert.ok(rtl.percorso[0] > rtl.percorso.at(-1), 'RTL: percorso specchiato');
  assert.equal(await pagina.$eval('.menu-amministrazione', (n) => getComputedStyle(n).direction), 'rtl');
  await nessunaViolazione(pagina, 'amministrazione RTL');
  await cambiaLingua(pagina, 'it', 'ltr');
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

// --- Lavoro 2: inserimento osservazioni (sola lettura, salvataggio sul posto) ------------

/** Attività nuova in 2A, con dati propri: nessun altro test ne dipende. */
async function attivitaDiProva(nome, dataAttivita = '2026-11-22') {
  const unita = (await api.get(`/teachings/${t2A.teaching_id}/pedagogical-units`)).corpo[0];
  const r = await api.post(`/teachings/${t2A.teaching_id}/activities`, { nome, dataAttivita, pedagogicalUnitId: unita.id });
  assert.equal(r.status, 201);
  return r.corpo.activity_id;
}

const hashGriglia = (id, scheda = 'griglia') => `#/classe/${t2A.teaching_id}/attivita/${id}/${scheda}`;
const selCella = (enrollmentId, criterionId) => `tr[data-iscrizione="${enrollmentId}"] td[data-criterio="${criterionId}"]`;
const grigliaApi = async (id) => (await api.get(`/activities/${id}/griglia`)).corpo;

/** Attende che nessuna cella sia in salvataggio. */
async function salvataggiConclusi(pagina) {
  await pagina.waitForFunction(() => !document.querySelector('table.griglia [aria-busy="true"]'));
}

/** Osservatore di mutazioni installato prima delle scelte: conta i nodi «Caricamento» aggiunti. */
async function osservaCaricamenti(pagina) {
  await pagina.evaluate((testo) => {
    window.caricamentiVisti = 0;
    new MutationObserver((mutazioni) => {
      mutazioni.forEach((m) => m.addedNodes.forEach((n) => { if ((n.textContent || '').includes(testo)) window.caricamentiVisti += 1; }));
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, CATALOGO.STATUS_LOADING);
}

/** L'esito di riga mostrato corrisponde a quello della griglia del server (banda e n/N). */
async function esitoDiRigaComeServer(pagina, id, enrollmentId) {
  const riga = (await grigliaApi(id)).righe.find((r) => r.enrollmentId === enrollmentId);
  const mostrato = await pagina.$eval(`tr[data-iscrizione="${enrollmentId}"] td.esito`, (td) => ({
    banda: (td.querySelector('.chip[data-banda]') || { dataset: {} }).dataset.banda || null,
    base: td.querySelector('.tenue').textContent,
  }));
  assert.deepEqual(mostrato, {
    banda: riga.esito.bandaId === null || riga.esito.bandaId === undefined ? null : String(riga.esito.bandaId),
    base: testoCatalogo('BASE_COUNT', riga.esito.base),
  });
  return riga;
}

test('Lavoro 2: salvataggio sul posto — stesso controllo, fuoco e scorrimento invariati, nessun «Caricamento», esito di riga dal server', async () => {
  const id = await attivitaDiProva('Prova sul posto E2E');
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashGriglia(id));
  assert.equal(await pagina.$('.avviso.sola-lettura'), null, 'anno attivo: nessun avviso di sola lettura');
  const g = await grigliaApi(id);
  const riga = g.righe.at(-1);
  const [c1, c2] = g.criteri;
  const cella = selCella(riga.enrollmentId, c1.id);
  const selettore = await pagina.$(`${cella} select`);
  await selettore.scrollIntoViewIfNeeded();
  await selettore.focus();
  const scorrimento = await pagina.evaluate(() => scrollY);
  assert.ok(scorrimento > 0, 'la riga bassa richiede lo scorrimento della pagina');
  await osservaCaricamenti(pagina);
  await selettore.evaluate((n) => {
    n.dataset.stesso = '1';
    // Il salvataggio locale è rapido: si registra ogni valore di aria-busy assunto dalla cella.
    window.occupata = [];
    new MutationObserver(() => window.occupata.push(n.closest('td').getAttribute('aria-busy')))
      .observe(n.closest('td'), { attributes: true, attributeFilter: ['aria-busy'] });
  });

  await pagina.selectOption(`${cella} select`, '2');
  await salvataggiConclusi(pagina);
  assert.deepEqual(await pagina.evaluate(() => window.occupata), ['true', null], 'durante il salvataggio la cella è occupata');
  const dopo = await pagina.evaluate((sel) => {
    const s = document.querySelector(`${sel} select`);
    return { stesso: s.dataset.stesso === '1' && s.isConnected, fuoco: document.activeElement === s, abilitato: !s.disabled, valore: s.value, scrollY, caricamenti: window.caricamentiVisti };
  }, cella);
  assert.deepEqual(dopo, { stesso: true, fuoco: true, abilitato: true, valore: '2', scrollY: scorrimento, caricamenti: 0 });
  assert.equal(await pagina.getAttribute(`${cella} .valore`, 'data-valore'), '2', 'il segno della cella segue il valore salvato');
  assert.equal(await pagina.getAttribute(`${cella} .valore`, 'data-banda'), String(g.scala.valori.find((v) => v.valore === 2).bandaId));
  assert.equal(await pagina.textContent('.annuncio-salvataggio[role=status]'), CATALOGO.UI_CELL_SAVED);
  assert.equal(await pagina.$$eval('[role=status].annuncio-salvataggio', (n) => n.length), 1, 'una sola regione di annuncio');
  await esitoDiRigaComeServer(pagina, id, riga.enrollmentId);

  // Scelte ravvicinate: sulla stessa cella vince l'ultima; la riga resta coerente con il server.
  await pagina.selectOption(`${cella} select`, '0');
  await pagina.selectOption(`${selCella(riga.enrollmentId, c2.id)} select`, '1');
  await pagina.selectOption(`${cella} select`, '1');
  await salvataggiConclusi(pagina);
  const servita = await esitoDiRigaComeServer(pagina, id, riga.enrollmentId);
  assert.deepEqual(servita.celle.slice(0, 2).map((c) => c.valore), [1, 1]);
  assert.equal(await pagina.getAttribute(`${cella} .valore`, 'data-valore'), '1');
  assert.deepEqual(await pagina.evaluate(() => [scrollY, window.caricamentiVisti]), [scorrimento, 0]);

  // Il risultato non cambia: una griglia ridisegnata da zero mostra lo stesso esito.
  const esitoSulPosto = await pagina.innerText(`tr[data-iscrizione="${riga.enrollmentId}"] td.esito .valori-esito`);
  await vaiA(pagina, hashGriglia(id));
  assert.equal(await pagina.innerText(`tr[data-iscrizione="${riga.enrollmentId}"] td.esito .valori-esito`), esitoSulPosto);
  await senzaTestiMancanti(pagina, 'griglia dopo i salvataggi');
  await nessunaViolazione(pagina, 'griglia dopo i salvataggi');

  // Anno attivo: la scheda «Attività» ha il modulo «Nuova attività» e nessun avviso.
  await vaiA(pagina, hashClasse('attivita'));
  assert.ok(await pagina.$('#nuova-nome'));
  assert.equal(await pagina.$('.avviso.sola-lettura'), null);
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

test('Lavoro 2: un salvataggio fallito (500, poi 409) riporta il controllo all\'ultimo valore salvato, con il messaggio accanto; nessun banner globale', async () => {
  const id = await attivitaDiProva('Prova errori E2E');
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashGriglia(id));
  const g = await grigliaApi(id);
  const riga = g.righe[0];
  const cella = selCella(riga.enrollmentId, g.criteri[0].id);
  await pagina.selectOption(`${cella} select`, '1');
  await salvataggiConclusi(pagina);
  const esitoSalvato = await pagina.innerText(`tr[data-iscrizione="${riga.enrollmentId}"] td.esito .valori-esito`);

  const simulate = [
    { status: 500, body: '' },
    { status: 409, body: JSON.stringify({ errore: { codice: 'ERR_SCHOOL_YEAR_CLOSED', parametri: {} } }) },
  ];
  await pagina.route('**/api/activities/*/enrollments/*/criteria/*', (route) => {
    const r = simulate.shift();
    return r ? route.fulfill({ status: r.status, contentType: 'application/json', body: r.body }) : route.continue();
  });
  const statoCella = () => pagina.$eval(cella, (td) => {
    const s = td.querySelector('select');
    const m = td.querySelector('.errore-campo');
    return {
      valore: s.value, invalido: s.getAttribute('aria-invalid'), descritto: s.getAttribute('aria-describedby') === m.id,
      messaggio: m.hidden ? null : m.textContent, segno: td.querySelector('.valore').dataset.valore,
      bannerGlobale: document.querySelector('#errore').textContent, fuoco: document.activeElement === s,
    };
  });
  await pagina.focus(`${cella} select`);
  for (const [scelto, codice] of [['2', 'ERR_INTERNAL'], ['0', 'ERR_SCHOOL_YEAR_CLOSED']]) {
    await pagina.selectOption(`${cella} select`, scelto);
    await salvataggiConclusi(pagina);
    assert.deepEqual(await statoCella(), {
      valore: '1', invalido: 'true', descritto: true, messaggio: CATALOGO[codice], segno: '1', bannerGlobale: '', fuoco: true,
    }, codice);
    assert.equal(await pagina.innerText(`tr[data-iscrizione="${riga.enrollmentId}"] td.esito .valori-esito`), esitoSalvato, 'esito invariato');
  }
  assert.equal((await grigliaApi(id)).righe[0].celle[0].valore, 1, 'nel database resta l\'ultimo valore salvato');
  await nessunaViolazione(pagina, 'griglia con un errore sul controllo');

  // Di nuovo raggiungibile: il salvataggio riesce e il messaggio sparisce.
  await pagina.unroute('**/api/activities/*/enrollments/*/criteria/*');
  await pagina.selectOption(`${cella} select`, '2');
  await salvataggiConclusi(pagina);
  const ripreso = await statoCella();
  assert.deepEqual([ripreso.valore, ripreso.invalido, ripreso.messaggio, ripreso.segno], ['2', null, null, '2']);
  assert.equal(await pagina.getAttribute(`${cella} select`, 'aria-describedby'), null);
  await esitoDiRigaComeServer(pagina, id, riga.enrollmentId);
  assert.deepEqual(pagina.errori.filter((e) => !/^(500|409) .*\/criteria\//.test(e)), [], 'solo gli errori simulati');
  await pagina.context().close();
});

test('Lavoro 2: solo tastiera — frecce sul controllo per scegliere, Tab al criterio successivo della stessa riga; salvataggio sul posto', async () => {
  const id = await attivitaDiProva('Prova tastiera E2E');
  const pagina = await nuovaPagina();
  await accedi(pagina);
  await vaiA(pagina, hashGriglia(id));
  const g = await grigliaApi(id);
  const riga = g.righe[1];
  const [c1, c2] = g.criteri;
  await osservaCaricamenti(pagina);
  await pagina.focus(`${selCella(riga.enrollmentId, c1.id)} select`);
  await pagina.keyboard.press('ArrowDown');
  await salvataggiConclusi(pagina);
  await pagina.keyboard.press('Tab');
  const dove = await pagina.evaluate(() => {
    const td = document.activeElement.closest('td');
    return [document.activeElement.tagName, td.dataset.criterio, td.closest('tr').dataset.iscrizione];
  });
  assert.deepEqual(dove, ['SELECT', String(c2.id), String(riga.enrollmentId)], 'Tab: criterio successivo dello stesso alunno');
  await pagina.keyboard.press('ArrowDown');
  await pagina.keyboard.press('ArrowDown');
  await salvataggiConclusi(pagina);
  const servita = await esitoDiRigaComeServer(pagina, id, riga.enrollmentId);
  assert.deepEqual(servita.celle.slice(0, 2).map((c) => c.valore), [g.scala.valori[0].valore, g.scala.valori[1].valore]);
  assert.equal(await pagina.evaluate((sel) => document.activeElement === document.querySelector(`${sel} select`), selCella(riga.enrollmentId, c2.id)), true, 'il fuoco resta');
  assert.equal(await pagina.evaluate(() => window.caricamentiVisti), 0);
  assert.deepEqual(pagina.errori, []);
  await pagina.context().close();
});

test('Lavoro 2: anno chiuso — avviso di sola lettura appena si entra (griglia, esito, scheda «Attività»), nessun controllo, nessun modulo «Nuova attività»', async () => {
  const id = await attivitaDiProva('Prova anno chiuso E2E');
  const g = await grigliaApi(id);
  assert.equal((await api.put(`/activities/${id}/enrollments/${g.righe[0].enrollmentId}/criteria/${g.criteri[0].id}`, { valore: 2 })).status, 200);
  // Dati condivisi: l'anno di Alfa si chiude solo per questo test e si riapre in ogni caso.
  const anno = (await pool.query("SELECT sy.id FROM school_years sy JOIN tenants t ON t.id = sy.tenant_id WHERE t.slug = 'alfa' AND sy.stato = 'attivo'")).rows[0].id;
  await pool.query("UPDATE school_years SET stato = 'chiuso' WHERE id = $1", [anno]);
  try {
    const pagina = await nuovaPagina();
    await accedi(pagina);
    const avvisoVisibile = async (dove) => {
      const avviso = await pagina.$('#contenuto .avviso.sola-lettura[role=status]');
      assert.ok(avviso && await avviso.isVisible(), `${dove}: avviso visibile`);
      assert.equal((await avviso.textContent()).replace(/\s+/g, ' ').trim(), `${CATALOGO.UI_READ_ONLY} ${CATALOGO.ERR_SCHOOL_YEAR_CLOSED}`);
      assert.equal(await avviso.$('button'), null, `${dove}: l'avviso non si chiude`);
      await senzaTestiMancanti(pagina, dove);
      await nessunaViolazione(pagina, dove);
    };
    await vaiA(pagina, hashGriglia(id));
    await avvisoVisibile('griglia, anno chiuso');
    assert.equal(await pagina.$eval('#contenuto .avviso.sola-lettura', (a) => !!(a.compareDocumentPosition(document.querySelector('#contenuto .schede')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'sopra le schede');
    assert.equal(await pagina.$$eval('table.griglia select', (n) => n.length), 0, 'nessun controllo');
    assert.equal(await pagina.getAttribute(`${selCella(g.righe[0].enrollmentId, g.criteri[0].id)} .valore`, 'data-valore'), '2', 'i valori restano leggibili');
    await vaiA(pagina, hashGriglia(id, 'esito'));
    await avvisoVisibile('esito, anno chiuso');
    await vaiA(pagina, hashClasse('attivita'));
    await avvisoVisibile('scheda Attività, anno chiuso');
    assert.equal(await pagina.$('#nuova-nome'), null, 'nessun modulo «Nuova attività»');
    assert.ok(await pagina.$('#contenuto .elenco .scelta'), 'le attività restano consultabili');
    assert.deepEqual(pagina.errori, []);
    await pagina.context().close();
  } finally {
    await pool.query("UPDATE school_years SET stato = 'attivo' WHERE id = $1", [anno]);
  }
});

// --- Lavoro 2: reflow della griglia (nessuno scorrimento laterale da 320 px) ----------------

const DESCRIZIONE_LUNGA = 'Riconosce e descrive regolarità in sequenze di numeri e figure'; // circa 60 caratteri

/**
 * Unità di Matematica 2A con 3, 4 e 8 criteri (una descrizione lunga ciascuna) e un'attività per unità.
 * Dati propri del test, rimossi alla fine (`rimuovi`).
 */
async function unitaDiProvaReflow() {
  const uno = async (sql, p) => (await pool.query(sql, p)).rows[0];
  const alfa = (await uno("SELECT id FROM tenants WHERE slug = 'alfa'")).id;
  const anno = (await uno("SELECT id FROM school_years WHERE tenant_id = $1 AND stato = 'attivo'", [alfa])).id;
  const materia = (await uno("SELECT id FROM subjects WHERE tenant_id = $1 AND nome = 'Matematica'", [alfa])).id;
  const unita = [];
  for (const [n, ordine] of [[3, 91], [4, 92], [8, 93]]) {
    const u = (await uno('INSERT INTO pedagogical_units (tenant_id, school_year_id, subject_id, nome, ordine) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [alfa, anno, materia, `Reflow ${n} criteri`, ordine])).id;
    for (let i = 1; i <= n; i += 1) {
      await pool.query('INSERT INTO criteria (tenant_id, school_year_id, pedagogical_unit_id, codice, descrizione, ordine) VALUES ($1, $2, $3, $4, $5, $6)',
        [alfa, anno, u, `RF${n}-${i}`, i === 2 ? DESCRIZIONE_LUNGA : `Criterio ${i} di prova`, i]);
    }
    const a = await api.post(`/teachings/${t2A.teaching_id}/activities`, { nome: `Reflow ${n}`, dataAttivita: '2026-11-23', pedagogicalUnitId: u });
    assert.equal(a.status, 201);
    unita.push({ criteri: n, unitaId: u, activityId: a.corpo.activity_id });
  }
  const rimuovi = async () => {
    for (const u of unita) {
      await pool.query('DELETE FROM observations WHERE activity_id = $1', [u.activityId]);
      await pool.query('DELETE FROM activities WHERE id = $1', [u.activityId]);
      await pool.query('DELETE FROM criteria WHERE pedagogical_unit_id = $1', [u.unitaId]);
      await pool.query('DELETE FROM pedagogical_units WHERE id = $1', [u.unitaId]);
    }
  };
  return { unita, rimuovi };
}

/** Due fotogrammi: il tempo che la griglia scelga la disposizione (ResizeObserver, poi requestAnimationFrame). */
const fotogrammi = (pagina) => pagina.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Misure del reflow: scorrimento laterale di pagina e contenitori, disposizione, controlli presenti. */
async function misureReflow(pagina) {
  await fotogrammi(pagina);
  return pagina.evaluate(() => {
    const radice = document.documentElement;
    const contenitore = document.querySelector('.griglia-contenitore');
    const tabella = contenitore.querySelector('table.griglia');
    const scorrevoli = [...document.querySelectorAll('#contenuto *')]
      .filter((n) => ['auto', 'scroll'].includes(getComputedStyle(n).overflowX) && n.scrollWidth > n.clientWidth)
      .map((n) => n.className || n.tagName);
    return {
      pagina: radice.scrollWidth <= radice.clientWidth,
      contenitore: contenitore.scrollWidth <= contenitore.clientWidth && tabella.offsetWidth <= contenitore.clientWidth,
      scorrevoli,
      schede: contenitore.classList.contains('a-schede'),
      controlli: tabella.querySelectorAll('tbody td[data-criterio] select').length,
      etichetteVisibili: [...tabella.querySelectorAll('tbody tr:first-child .etichetta-scheda')].filter((e) => e.offsetWidth > 0).length,
    };
  });
}

test('Lavoro 2: reflow — 320, 768 e 1280 px con 3, 4 e 8 criteri e una descrizione lunga: nessuno scorrimento laterale, tutti i controlli, axe in entrambe le disposizioni', async () => {
  const { unita, rimuovi } = await unitaDiProvaReflow();
  try {
    const pagina = await nuovaPagina();
    await accedi(pagina);
    const disposizioni = {};
    for (const larghezza of [320, 768, 1280]) {
      await pagina.setViewportSize({ width: larghezza, height: 900 });
      for (const u of unita) {
        const dove = `${larghezza} px, ${u.criteri} criteri`;
        await vaiA(pagina, hashGriglia(u.activityId));
        const righe = (await grigliaApi(u.activityId)).righe.length;
        const m = await misureReflow(pagina);
        assert.deepEqual([m.pagina, m.contenitore, m.scorrevoli], [true, true, []], `${dove}: nessuno scorrimento laterale`);
        assert.equal(m.controlli, righe * u.criteri, `${dove}: tutti i controlli presenti`);
        assert.equal(m.etichetteVisibili, m.schede ? u.criteri + 1 : 0, `${dove}: etichette visibili solo nelle schede (criteri ed esito)`);
        disposizioni[dove] = m.schede;
        await senzaTestiMancanti(pagina, dove);
        await nessunaViolazione(pagina, dove);
      }
    }
    // A 320 px è sempre una scheda per alunno; a 1280 px con 3 criteri la tabella sta e resta tabella.
    assert.deepEqual(Object.entries(disposizioni).filter(([d]) => d.startsWith('320')).map(([, s]) => s), [true, true, true]);
    assert.equal(disposizioni['1280 px, 3 criteri'], false, 'sopra la soglia resta la tabella');
    assert.equal(disposizioni['1280 px, 8 criteri'], true, 'la soglia dipende dal numero di criteri');

    // Da schede a tabella e ritorno ridimensionando la stessa vista, senza oscillare.
    const tre = unita[0];
    await vaiA(pagina, hashGriglia(tre.activityId));
    await pagina.setViewportSize({ width: 320, height: 900 });
    assert.equal((await misureReflow(pagina)).schede, true);
    await pagina.setViewportSize({ width: 1280, height: 900 });
    assert.equal((await misureReflow(pagina)).schede, false);
    const stabili = await pagina.evaluate(async () => {
      const visti = [];
      for (let i = 0; i < 6; i += 1) {
        await new Promise((r) => requestAnimationFrame(r));
        visti.push(document.querySelector('.griglia-contenitore').classList.contains('a-schede'));
      }
      return visti;
    });
    assert.deepEqual(stabili, [false, false, false, false, false, false], 'nessuna oscillazione');
    assert.deepEqual(pagina.errori, []);
    await pagina.context().close();
  } finally {
    await rimuovi();
  }
});

test('Lavoro 2: reflow — in modalità scheda nome, criteri ed esito nell\'ordine del DOM; selezione e salvataggio sul posto funzionano; RTL senza scorrimento', async () => {
  const { unita, rimuovi } = await unitaDiProvaReflow();
  try {
    const quattro = unita[1];
    await abilitaRtlDiProva(); // prima dell'accesso: il selettore della lingua compare con due lingue abilitate
    const pagina = await nuovaPagina({ viewport: { width: 320, height: 800 } });
    await accedi(pagina);
    await vaiA(pagina, hashGriglia(quattro.activityId));
    assert.equal((await misureReflow(pagina)).schede, true);
    const g = await grigliaApi(quattro.activityId);
    const riga = g.righe[2];
    // Ordine del DOM e della lettura: nome → criteri → esito; l'etichetta ripetuta non si legge due volte.
    const scheda = await pagina.$eval(`tr[data-iscrizione="${riga.enrollmentId}"]`, (tr) => ({
      ordine: [...tr.children].map((c) => (c.tagName === 'TH' ? 'nome' : c.classList.contains('esito') ? 'esito' : c.dataset.criterio)),
      etichetteNascoste: [...tr.querySelectorAll('.etichetta-scheda')].every((e) => e.getAttribute('aria-hidden') === 'true'),
      inColonna: [...tr.children].every((c, i, tutti) => i === 0 || c.getBoundingClientRect().top >= tutti[i - 1].getBoundingClientRect().bottom - 1),
      ruoli: [tr.getAttribute('role'), tr.querySelector('th').getAttribute('role'), tr.querySelector('td').getAttribute('role')],
    }));
    assert.deepEqual(scheda.ordine, ['nome', ...g.criteri.map((c) => String(c.id)), 'esito']);
    assert.deepEqual([scheda.etichetteNascoste, scheda.inColonna, scheda.ruoli], [true, true, ['row', 'rowheader', 'cell']]);
    assert.equal(await pagina.getAttribute(`${selCella(riga.enrollmentId, g.criteri[1].id)} select`, 'aria-label'),
      testoCatalogo('UI_CELL_LABEL', { alunno: `${riga.cognome} ${riga.nome}`, criterio: DESCRIZIONE_LUNGA }), 'il nome accessibile del controllo resta');

    // Selezione e salvataggio sul posto in modalità scheda.
    const cella = selCella(riga.enrollmentId, g.criteri[1].id);
    await pagina.$eval(`${cella} select`, (s) => s.scrollIntoView({ block: 'center' }));
    await pagina.focus(`${cella} select`);
    const scorrimento = await pagina.evaluate(() => scrollY);
    await osservaCaricamenti(pagina);
    await pagina.selectOption(`${cella} select`, '2');
    await salvataggiConclusi(pagina);
    await esitoDiRigaComeServer(pagina, quattro.activityId, riga.enrollmentId);
    assert.deepEqual(await pagina.evaluate((sel) => [scrollY, window.caricamentiVisti, document.activeElement === document.querySelector(`${sel} select`)], cella), [scorrimento, 0, true]);
    assert.equal(await pagina.getAttribute(`${cella} .valore`, 'data-valore'), '2');
    const dopo = await misureReflow(pagina);
    assert.deepEqual([dopo.pagina, dopo.contenitore, dopo.schede], [true, true, true]);

    // RTL a 320 px con 8 criteri: stessa disposizione a schede, specchiata, senza scorrimento laterale.
    await vaiA(pagina, hashGriglia(unita[2].activityId));
    await cambiaLingua(pagina, 'ar-XB', 'rtl');
    const rtl = await misureReflow(pagina);
    assert.deepEqual([rtl.pagina, rtl.contenitore, rtl.scorrevoli, rtl.schede], [true, true, [], true], 'RTL: nessuno scorrimento laterale');
    const allineamento = await pagina.$eval('table.griglia tbody tr:first-child th', (th) => {
      const tr = th.closest('tr').getBoundingClientRect();
      const testo = document.createRange();
      testo.selectNodeContents(th);
      const r = testo.getBoundingClientRect();
      return (tr.right - r.right) < (r.left - tr.left);
    });
    assert.ok(allineamento, 'RTL: il nome dell\'alunno all\'inizio della riga di lettura (a destra)');
    await senzaTestiMancanti(pagina, 'griglia a schede RTL');
    await nessunaViolazione(pagina, 'griglia a schede RTL');
    await cambiaLingua(pagina, 'it', 'ltr');
    assert.deepEqual(pagina.errori, []);
    await pagina.context().close();
  } finally {
    await rimuovi();
  }
});
