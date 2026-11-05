'use strict';

/**
 * Iterazione 2, lavoro 2 — inserimento osservazioni (server).
 *
 * Parte 1: regola unica di scrittura { consentita, motivo } — nella griglia e nella nuova
 *          GET /teachings/:id/scrittura; il motivo dipende solo dallo stato (lo ricevono tutti
 *          i ruoli che leggono), consentita anche dal permesso con l'ambito completo.
 * Parte 2: salvataggio sul posto — il PUT della cella restituisce la cella e l'esito della riga,
 *          identici a quelli della griglia letta subito dopo (inserimento, modifica, cancellazione;
 *          scala 0–2 di Alfa e 1–4 di Beta).
 *
 * Database proprio di questo file (un processo per file): ogni test che cambia lo stato
 * dell'anno lo ripristina.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

require('./support/pglite').installa();
const { pool } = require('../server/db');
const { avviaServer, loginESwitch } = require('./support/http');
const dominio = require('../server/queries/dominio');

const CATALOGO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'i18n', 'catalogo', 'it.json'), 'utf8')).testi;

let srv;
test.before(async () => { srv = await avviaServer(); });
test.after(async () => {
  await srv.chiudi();
  await pool.end();
});

const uno = async (sql, p) => (await pool.query(sql, p)).rows[0];
const DOCENTE = 'teacher.math.a@alfa.test';
const COORDINATORE = 'coordinator.a@alfa.test';
const ADMIN = 'tenant.admin.a@alfa.test';

const CONSENTITA = { consentita: true, motivo: null };
const NON_CONSENTITA = { consentita: false, motivo: null };
const ANNO_CHIUSO = { consentita: false, motivo: 'ERR_SCHOOL_YEAR_CLOSED' };

/** Insegnamento di Matematica 2A di Alfa e la sua attività del seed «Numeri entro il cento». */
async function insegnamentoEAttivitaAlfa(docente) {
  const teaching = (await docente.get('/teachings')).corpo.find((t) => t.classe === '2A').teaching_id;
  const attivita = (await docente.get(`/teachings/${teaching}/activities`)).corpo
    .find((a) => a.nome.testo === 'Numeri entro il cento').activity_id;
  return { teaching, attivita };
}

/** Chiude l'anno del seed di Alfa per la durata di fn, poi lo riporta ad attivo. */
async function conAnnoAlfaChiuso(fn) {
  const anno = (await uno("SELECT sy.id FROM school_years sy JOIN tenants t ON t.id = sy.tenant_id WHERE t.slug = 'alfa' AND sy.stato = 'attivo'")).id;
  await pool.query("UPDATE school_years SET stato = 'chiuso' WHERE id = $1", [anno]);
  try {
    return await fn();
  } finally {
    await pool.query("UPDATE school_years SET stato = 'attivo' WHERE id = $1", [anno]);
  }
}

// ===========================================================================
// REGOLA UNICA DI SCRITTURA
// ===========================================================================

test('Regola di scrittura: il motivo dipende solo dallo stato dell\'anno; ogni motivo emesso ha un testo nel catalogo', () => {
  assert.equal(dominio.motivoDiSolaLettura({ annoStato: dominio.ANNO.ATTIVO }), null);
  assert.equal(dominio.motivoDiSolaLettura({ annoStato: dominio.ANNO.CHIUSO }), 'ERR_SCHOOL_YEAR_CLOSED');
  assert.equal(dominio.motivoDiSolaLettura({ annoStato: null }), 'ERR_SCHOOL_YEAR_CLOSED', 'anno assente: come la scrittura (409)');
  assert.equal(dominio.motivoDiSolaLettura({ annoStato: dominio.ANNO.IN_PREPARAZIONE }), 'ERR_SCHOOL_YEAR_IN_PREPARATION');
  const emessi = [null, ...Object.values(dominio.ANNO)].map((s) => dominio.motivoDiSolaLettura({ annoStato: s })).filter(Boolean);
  assert.deepEqual(emessi.filter((m) => !(m in CATALOGO)), []);
});

test('Griglia: scrittura { consentita, motivo } — docente titolare sì; coordinatore e amministratore no, senza motivo; anno chiuso: motivo per tutti', async () => {
  const docente = await loginESwitch(srv.base, DOCENTE, 'alfa');
  const coordinatore = await loginESwitch(srv.base, COORDINATORE, 'alfa');
  const admin = await loginESwitch(srv.base, ADMIN, 'alfa');
  const { attivita } = await insegnamentoEAttivitaAlfa(docente);
  const scritturaDi = async (s) => {
    const r = await s.get(`/activities/${attivita}/griglia`);
    assert.equal(r.status, 200);
    return r.corpo.scrittura;
  };
  const primaDocente = (await docente.get(`/activities/${attivita}/griglia`)).corpo;
  assert.deepEqual(await scritturaDi(docente), CONSENTITA);
  assert.deepEqual(await scritturaDi(coordinatore), NON_CONSENTITA, 'il coordinatore legge ma non scrive: nessun avviso');
  assert.deepEqual(await scritturaDi(admin), NON_CONSENTITA);
  // Nessun campo esistente cambia: tutto il resto della griglia è quello di prima.
  const { scrittura, ...resto } = primaDocente;
  assert.ok(scrittura);
  assert.deepEqual(Object.keys(resto).sort(),
    ['activity', 'bande', 'criteri', 'grigliaNonConfigurata', 'pedagogicalUnitId', 'precisione', 'righe', 'scala', 'unitaPedagogica']);

  await conAnnoAlfaChiuso(async () => {
    for (const s of [docente, coordinatore, admin]) assert.deepEqual(await scritturaDi(s), ANNO_CHIUSO);
    const { scrittura: chiusa, ...restoChiuso } = (await docente.get(`/activities/${attivita}/griglia`)).corpo;
    assert.deepEqual(restoChiuso, resto, 'anno chiuso: stessi dati, cambia solo la regola di scrittura');
  });
  assert.deepEqual(await scritturaDi(docente), CONSENTITA, 'anno di nuovo attivo');
});

test('GET /teachings/:id/scrittura: forma, regole per ruolo, anno chiuso; 403 senza teaching.read; 404 per un altro tenant', async () => {
  const docente = await loginESwitch(srv.base, DOCENTE, 'alfa');
  const coordinatore = await loginESwitch(srv.base, COORDINATORE, 'alfa');
  const admin = await loginESwitch(srv.base, ADMIN, 'alfa');
  const { teaching } = await insegnamentoEAttivitaAlfa(docente);
  const leggi = async (s) => {
    const r = await s.get(`/teachings/${teaching}/scrittura`);
    assert.equal(r.status, 200);
    return r.corpo;
  };
  assert.deepEqual(await leggi(docente), { attivita: CONSENTITA, osservazioni: CONSENTITA });
  assert.deepEqual(await leggi(coordinatore), { attivita: NON_CONSENTITA, osservazioni: NON_CONSENTITA });
  assert.deepEqual(await leggi(admin), { attivita: NON_CONSENTITA, osservazioni: NON_CONSENTITA });

  await conAnnoAlfaChiuso(async () => {
    for (const s of [docente, coordinatore, admin]) {
      assert.deepEqual(await leggi(s), { attivita: ANNO_CHIUSO, osservazioni: ANNO_CHIUSO });
    }
  });

  // Il docente di Italiano 2A non ha teaching.read sull'insegnamento di Matematica 2A.
  const italiano = await loginESwitch(srv.base, 'teacher.italian.a@alfa.test', 'alfa');
  const vietata = await italiano.get(`/teachings/${teaching}/scrittura`);
  assert.deepEqual([vietata.status, vietata.corpo.errore],
    [403, { codice: 'ERR_PERMISSION_MISSING', parametri: { permesso: 'PERMISSION_TEACHING_READ' } }]);
  const beta = await loginESwitch(srv.base, 'teacher.math.b@beta.test', 'beta');
  const altroTenant = await beta.get(`/teachings/${teaching}/scrittura`);
  assert.deepEqual([altroTenant.status, altroTenant.corpo.errore],
    [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_TEACHING' } }]);
});

test('GET /teachings/:id/scrittura: un insegnamento di un anno in preparazione non esiste per il percorso (404)', async () => {
  const alfa = (await uno("SELECT id FROM tenants WHERE slug = 'alfa'")).id;
  const docenteId = (await uno('SELECT id FROM accounts WHERE email = $1', [DOCENTE])).id;
  const livello = (await uno("SELECT id FROM school_levels WHERE tenant_id = $1 AND nome = 'Primaria'", [alfa])).id;
  const classe = (await uno("SELECT id FROM classes WHERE tenant_id = $1 AND nome = '2A'", [alfa])).id;
  const anno = (await uno(
    "INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine, stato) VALUES ($1, '2027/2028', '2027-09-01', '2028-06-30', 'in_preparazione') RETURNING id", [alfa]
  )).id;
  const materia = (await uno("INSERT INTO subjects (tenant_id, school_level_id, school_year_id, nome) VALUES ($1, $2, $3, 'Matematica nuova') RETURNING id", [alfa, livello, anno])).id;
  const teaching = (await uno('INSERT INTO teachings (tenant_id, school_year_id, class_id, subject_id, account_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [alfa, anno, classe, materia, docenteId])).id;
  const ruolo = (await uno(
    "INSERT INTO role_assignments (account_id, role_id, scope_type, tenant_id, scope_teaching_id) VALUES ($1, (SELECT id FROM roles WHERE codice = 'TEACHER'), 'TEACHING', $2, $3) RETURNING id",
    [docenteId, alfa, teaching]
  )).id;
  try {
    for (const email of [DOCENTE, ADMIN]) {
      const s = await loginESwitch(srv.base, email, 'alfa');
      const r = await s.get(`/teachings/${teaching}/scrittura`);
      assert.deepEqual([r.status, r.corpo.errore], [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_TEACHING' } }], email);
    }
  } finally {
    await pool.query('DELETE FROM role_assignments WHERE id = $1', [ruolo]);
    await pool.query('DELETE FROM teachings WHERE id = $1', [teaching]);
    await pool.query('DELETE FROM subjects WHERE id = $1', [materia]);
    await pool.query('DELETE FROM school_years WHERE id = $1', [anno]);
  }
});

// ===========================================================================
// SALVATAGGIO SUL POSTO: CELLA ED ESITO DELLA RIGA NELLA RISPOSTA DEL PUT
// ===========================================================================

/**
 * Esegue le scritture in sequenza sulla prima riga di una nuova attività e, dopo ognuna,
 * confronta cella e riga del PUT con la griglia letta subito dopo.
 */
async function verificaEsitoSulPosto(sessione, teaching, dataAttivita, scritture) {
  const unita = (await sessione.get(`/teachings/${teaching}/pedagogical-units`)).corpo[0];
  const creata = await sessione.post(`/teachings/${teaching}/activities`, { nome: 'Prova sul posto', dataAttivita, pedagogicalUnitId: unita.id });
  assert.equal(creata.status, 201);
  const attivita = creata.corpo.activity_id;
  const griglia = async () => (await sessione.get(`/activities/${attivita}/griglia`)).corpo;
  const iniziale = await griglia();
  assert.ok(iniziale.criteri.length >= 2, 'servono almeno due criteri');
  const riga = iniziale.righe[0];
  const risposte = [];
  for (const [indiceCriterio, valore] of scritture) {
    const criterio = iniziale.criteri[indiceCriterio].id;
    const r = await sessione.put(`/activities/${attivita}/enrollments/${riga.enrollmentId}/criteria/${criterio}`, { valore });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const dopo = (await griglia()).righe.find((x) => x.enrollmentId === riga.enrollmentId);
    assert.deepEqual(r.corpo.riga, {
      enrollmentId: dopo.enrollmentId,
      valutazionePresenti: dopo.valutazionePresenti,
      valutazioniTotali: dopo.valutazioniTotali,
      esito: dopo.esito,
    }, `riga dopo ${JSON.stringify([indiceCriterio, valore])}`);
    assert.deepEqual(r.corpo.cella, { criterionId: criterio, valore: dopo.celle.find((c) => c.criterionId === criterio).valore });
    assert.equal(r.corpo.cella.valore, valore);
    risposte.push(r.corpo);
  }
  return { risposte, scala: iniziale.scala };
}

test('PUT della cella (Alfa, scala 0–2): cella ed esito di riga identici alla griglia dopo inserimento, modifica e cancellazione; i campi esistenti restano', async () => {
  const docente = await loginESwitch(srv.base, DOCENTE, 'alfa');
  const { teaching } = await insegnamentoEAttivitaAlfa(docente);
  const { risposte, scala } = await verificaEsitoSulPosto(docente, teaching, '2026-11-21', [
    [0, 2], // inserimento
    [0, 1], // modifica
    [1, 0], // inserimento di un secondo criterio (valore 0: osservato, non assente)
    [0, null], // cancellazione
    [0, null], // cancellazione di una cella già vuota
  ]);
  assert.deepEqual(scala.valori.map((v) => v.valore), [0, 1, 2]);
  const [inserita, modificata, seconda, cancellata, giaVuota] = risposte;
  assert.ok(Number.isInteger(inserita.observationId));
  assert.equal(inserita.eliminato, false);
  assert.equal(modificata.observationId, inserita.observationId, 'la modifica aggiorna la stessa osservazione');
  assert.deepEqual([inserita.riga.esito.base, modificata.riga.esito.base, seconda.riga.esito.base].map((b) => b.n), [1, 1, 2]);
  assert.deepEqual([cancellata.eliminato, cancellata.observationId, cancellata.riga.valutazionePresenti], [true, undefined, 1]);
  assert.deepEqual([giaVuota.eliminato, giaVuota.riga], [false, cancellata.riga]);
  assert.notDeepEqual(inserita.riga.esito, modificata.riga.esito, 'da 2 a 1 l\'esito cambia');
});

test('PUT della cella (Beta, scala 1–4): stesso esito della griglia', async () => {
  const docente = await loginESwitch(srv.base, 'teacher.math.b@beta.test', 'beta');
  const teaching = (await docente.get('/teachings')).corpo[0].teaching_id;
  const { scala } = await verificaEsitoSulPosto(docente, teaching, '2026-11-21', [[0, 4], [1, 1], [0, 3], [1, null]]);
  assert.deepEqual(scala.valori.map((v) => v.valore), [1, 2, 3, 4]);
});

// ===========================================================================
// CLIENT: CONTROLLI STATICI (passo 2)
// ===========================================================================

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

/** Corpo della funzione `nome` di app.js (parentesi graffe bilanciate). */
function corpoFunzione(nome) {
  const inizio = APP.indexOf(`function ${nome}(`);
  assert.ok(inizio >= 0, `${nome} non trovata`);
  const apertura = APP.indexOf('{', inizio);
  let profondita = 0;
  for (let i = apertura; i < APP.length; i += 1) {
    if (APP[i] === '{') profondita += 1;
    if (APP[i] === '}') profondita -= 1;
    if (profondita === 0) return APP.slice(apertura, i + 1);
  }
  throw new Error(`${nome}: graffe non bilanciate`);
}

test('Client: i testi nuovi della sola lettura e del salvataggio sul posto sono nel catalogo', () => {
  for (const chiave of ['UI_READ_ONLY', 'UI_CELL_SAVED', 'ERR_SCHOOL_YEAR_CLOSED', 'ERR_INTERNAL']) assert.ok(chiave in CATALOGO, chiave);
  assert.match(APP, /'UI_READ_ONLY'/);
  assert.match(APP, /'UI_CELL_SAVED'/);
});

test('Client: il salvataggio di una cella non ridisegna, non mostra «Caricamento», non disabilita il controllo, non usa il banner globale', () => {
  const salva = corpoFunzione('salvaCellaSulPosto');
  for (const vietato of ['disegna(', 'caricamento(', '.disabled', 'mostraErrore(', 'replaceChildren(contenitore', 'vai(']) {
    assert.ok(!salva.includes(vietato), `salvaCellaSulPosto contiene ${vietato}`);
  }
  const griglia = corpoFunzione('grigliaAttivita');
  assert.match(griglia, /addEventListener\('change', function \(\) \{ salvaCellaSulPosto\(contesto, statoRiga, statoCella\); \}\)/);
  assert.ok(!griglia.includes('disegna('), 'la griglia non ridisegna');
  assert.ok(!griglia.includes("haPermesso('observation.create')"), 'la scrittura la decide il server (g.scrittura)');
  assert.match(griglia, /g\.scrittura\.consentita/);
  // Riferimenti nel DOM usati dagli E2E e dal reflow.
  for (const riferimento of ["'data-iscrizione'", "'data-criterio'", "classe: 'esito'"]) assert.ok(griglia.includes(riferimento), riferimento);
});

test('PUT della cella: il coordinatore e l\'amministratore non scrivono (403), su anno chiuso nessuno (409); nessuna riga nella risposta di errore', async () => {
  const docente = await loginESwitch(srv.base, DOCENTE, 'alfa');
  const { attivita } = await insegnamentoEAttivitaAlfa(docente);
  const griglia = (await docente.get(`/activities/${attivita}/griglia`)).corpo;
  const cella = `/activities/${attivita}/enrollments/${griglia.righe[0].enrollmentId}/criteria/${griglia.criteri[0].id}`;
  for (const email of [COORDINATORE, ADMIN]) {
    const s = await loginESwitch(srv.base, email, 'alfa');
    const r = await s.put(cella, { valore: 1 });
    assert.deepEqual([r.status, r.corpo.errore.codice, r.corpo.riga], [403, 'ERR_PERMISSION_MISSING', undefined], email);
  }
  await conAnnoAlfaChiuso(async () => {
    const r = await docente.put(cella, { valore: 1 });
    assert.deepEqual([r.status, r.corpo.errore.codice, r.corpo.riga], [409, 'ERR_SCHOOL_YEAR_CLOSED', undefined]);
  });
});

// ===========================================================================
// PARTENZA PER RUOLO (passo 4)
// ===========================================================================

const { login } = require('./support/http');
const { PARTENZA } = require('../server/routes/auth');

/** partenza dopo il login (vista restituita dal login) e da /auth/me, che devono coincidere. */
async function partenzaDopoLogin(email) {
  const { sessione, risposta } = await login(srv.base, email);
  assert.equal(risposta.status, 200, email);
  const me = await sessione.get('/auth/me');
  assert.equal(me.corpo.partenza, risposta.corpo.partenza, `${email}: login e /auth/me`);
  return { sessione, partenza: risposta.corpo.partenza, vista: risposta.corpo };
}

async function cambiaTenant(sessione, slug) {
  const t = (await sessione.get('/auth/me')).corpo.tenantsDisponibiliPerSwitch.find((x) => x.slug === slug);
  const r = await sessione.post('/auth/switch-tenant', { tenantId: t.tenant_id ?? t.id });
  assert.equal(r.status, 200);
  assert.equal((await sessione.get('/auth/me')).corpo.partenza, r.corpo.partenza);
  return r.corpo.partenza;
}

test('Partenza: codici stabili per ruolo — PLATFORM_ADMIN (con e senza scuola), TENANT_ADMIN, COORDINATOR, TEACHER, utente con due scuole', async () => {
  assert.deepEqual(Object.values(PARTENZA), ['scuole', 'quadro', 'classi', 'insegnamenti']);
  const piattaforma = await partenzaDopoLogin('platform.admin@platform.test');
  assert.deepEqual([piattaforma.vista.activeTenantId, piattaforma.partenza], [null, 'scuole'], 'senza scuola attiva');
  assert.equal(await cambiaTenant(piattaforma.sessione, 'alfa'), 'scuole', 'anche con una scuola attiva');

  assert.equal((await partenzaDopoLogin('tenant.admin.a@alfa.test')).partenza, 'quadro');
  assert.equal((await partenzaDopoLogin('tenant.admin.b@beta.test')).partenza, 'quadro');
  assert.equal((await partenzaDopoLogin(COORDINATORE)).partenza, 'classi');
  assert.equal((await partenzaDopoLogin(DOCENTE)).partenza, 'insegnamenti');

  // Due scuole: nessuna scuola attiva dopo il login (resta la scelta dell'istituto), poi il ruolo di ognuna.
  const multi = await partenzaDopoLogin('multitenant.user@example.test');
  assert.deepEqual([multi.vista.activeTenantId, multi.partenza], [null, null]);
  assert.equal(await cambiaTenant(multi.sessione, 'alfa'), 'insegnamenti', 'TEACHER in Alfa');
  assert.equal(await cambiaTenant(multi.sessione, 'beta'), 'classi', 'COORDINATOR in Beta');
  assert.equal(await cambiaTenant(multi.sessione, 'alfa'), 'insegnamenti');
});

test('Partenza: precedenza TENANT_ADMIN > COORDINATOR > TEACHER nel tenant attivo; i ruoli di un altro tenant non contano; nessun campo esistente cambia', async () => {
  const coordinatore = (await uno('SELECT id FROM accounts WHERE email = $1', [COORDINATORE])).id;
  const alfa = (await uno("SELECT id FROM tenants WHERE slug = 'alfa'")).id;
  const teaching = (await uno("SELECT t.id FROM teachings t JOIN classes c ON c.id = t.class_id WHERE t.tenant_id = $1 AND c.nome = '2A' LIMIT 1", [alfa])).id;
  const aggiungi = async (ruolo, colonne, valori) => (await uno(
    `INSERT INTO role_assignments (account_id, role_id, scope_type, tenant_id, ${colonne}) VALUES ($1, (SELECT id FROM roles WHERE codice = $2), $3, $4, $5) RETURNING id`,
    [coordinatore, ruolo, ...valori]
  )).id;
  const prima = (await partenzaDopoLogin(COORDINATORE)).vista;
  const docente = await aggiungi('TEACHER', 'scope_teaching_id', ['TEACHING', alfa, teaching]);
  try {
    assert.equal((await partenzaDopoLogin(COORDINATORE)).partenza, 'classi', 'COORDINATOR prima di TEACHER');
    const admin = await aggiungi('TENANT_ADMIN', 'scope_tenant_id', ['TENANT', alfa, alfa]);
    try {
      const dopo = (await partenzaDopoLogin(COORDINATORE)).vista;
      assert.equal(dopo.partenza, 'quadro', 'TENANT_ADMIN prima di tutti');
      // Solo un campo in più: gli altri campi di /auth/me restano quelli di prima.
      assert.deepEqual(Object.keys(dopo).sort(), Object.keys(prima).sort());
      assert.ok(Object.keys(prima).includes('partenza'));
    } finally {
      await pool.query('DELETE FROM role_assignments WHERE id = $1', [admin]);
    }
  } finally {
    await pool.query('DELETE FROM role_assignments WHERE id = $1', [docente]);
  }
  assert.equal((await partenzaDopoLogin(COORDINATORE)).partenza, 'classi');
});

// ===========================================================================
// NOME DELL'ANNO MODIFICABILE, DATE NO (passo 5)
// ===========================================================================

async function auditRinomina(annoId) {
  const { rows } = await pool.query(
    "SELECT actor_account_id, tenant_id, prima, dopo FROM audit_log WHERE azione = 'school_year.rename' AND risorsa = 'school_year' AND risorsa_id = $1 ORDER BY id",
    [annoId]
  );
  return rows;
}

test('Nome dell\'anno: il TENANT_ADMIN rinomina un anno attivo (date e azioni invariate, audit con prima e dopo); il nuovo nome arriva agli insegnamenti', async () => {
  const admin = await loginESwitch(srv.base, ADMIN, 'alfa');
  const adminId = (await uno('SELECT id FROM accounts WHERE email = $1', [ADMIN])).id;
  const alfa = (await uno("SELECT id FROM tenants WHERE slug = 'alfa'")).id;
  const prima = (await admin.get('/admin/school-years')).corpo.anni.find((a) => a.stato === 'attivo');
  assert.deepEqual([prima.nome, prima.azioni, prima.rinominabile], ['2026/2027', ['chiudi'], true]);
  try {
    const r = await admin.put(`/admin/school-years/${prima.id}`, { nome: '  2026-27 ' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual(r.corpo, { id: prima.id, nome: '2026-27', stato: 'attivo', dataInizio: prima.dataInizio, dataFine: prima.dataFine });
    const dopo = (await admin.get('/admin/school-years')).corpo.anni.find((a) => a.id === prima.id);
    assert.deepEqual(dopo, { ...prima, nome: '2026-27' }, 'cambia solo il nome: date, stato, azioni e rinominabile restano');
    assert.deepEqual(await auditRinomina(prima.id), [{ actor_account_id: adminId, tenant_id: alfa, prima: { nome: '2026/2027' }, dopo: { nome: '2026-27' } }]);
    const docente = await loginESwitch(srv.base, DOCENTE, 'alfa');
    assert.ok((await docente.get('/teachings')).corpo.every((t) => t.anno_scolastico === '2026-27'));
    // Lo stesso nome di prima non scrive nulla.
    assert.equal((await admin.put(`/admin/school-years/${prima.id}`, { nome: '2026-27' })).status, 200);
    assert.equal((await auditRinomina(prima.id)).length, 1, 'nessun audit per un nome invariato');
  } finally {
    await pool.query('UPDATE school_years SET nome = $1 WHERE id = $2', [prima.nome, prima.id]);
  }
});

test('Nome dell\'anno: anno in preparazione sì; nome occupato, vuoto o troppo lungo rifiutati; anno chiuso 409 (rinominabile false); TEACHER 403; altro tenant 404', async () => {
  const admin = await loginESwitch(srv.base, ADMIN, 'alfa');
  const alfa = (await uno("SELECT id FROM tenants WHERE slug = 'alfa'")).id;
  const nuovo = await admin.post('/admin/school-years', { nome: '2027/2028', dataInizio: '2027-09-01', dataFine: '2028-06-30' });
  assert.equal(nuovo.status, 201);
  const chiuso = (await uno(
    "INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine, stato) VALUES ($1, '2020/2021', '2020-09-01', '2021-06-30', 'chiuso') RETURNING id", [alfa]
  )).id;
  try {
    const id = nuovo.corpo.id;
    const errore = async (annoId, corpo) => {
      const r = await admin.put(`/admin/school-years/${annoId}`, corpo);
      return [r.status, r.corpo && r.corpo.errore];
    };
    assert.deepEqual(await errore(id, { nome: '2026/2027' }), [409, { codice: 'ERR_SCHOOL_YEAR_NAME_TAKEN', parametri: { nome: '2026/2027', campo: 'UI_FIELD_NOME' } }]);
    assert.deepEqual(await errore(id, { nome: '   ' }), [400, { codice: 'ERR_REQUIRED_FIELD', parametri: { campo: 'UI_FIELD_NOME' } }]);
    assert.deepEqual(await errore(id, {}), [400, { codice: 'ERR_REQUIRED_FIELD', parametri: { campo: 'UI_FIELD_NOME' } }]);
    assert.deepEqual(await errore(id, { nome: 'x'.repeat(21) }), [400, { codice: 'ERR_TEXT_TOO_LONG', parametri: { campo: 'UI_FIELD_NOME', massimo: 20 } }]);
    assert.deepEqual(await errore(chiuso, { nome: '2020-21' }), [409, { codice: 'ERR_SCHOOL_YEAR_CLOSED', parametri: {} }]);
    assert.deepEqual(await errore(999999, { nome: 'Qualunque' }), [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_SCHOOL_YEAR' } }]);
    const annoBeta = (await uno("SELECT sy.id FROM school_years sy JOIN tenants t ON t.id = sy.tenant_id WHERE t.slug = 'beta' LIMIT 1")).id;
    assert.deepEqual(await errore(annoBeta, { nome: 'Di Beta' }), [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_SCHOOL_YEAR' } }]);
    const docente = await loginESwitch(srv.base, DOCENTE, 'alfa');
    const vietata = await docente.put(`/admin/school-years/${id}`, { nome: 'Del docente' });
    assert.deepEqual([vietata.status, vietata.corpo.errore], [403, { codice: 'ERR_PERMISSION_MISSING', parametri: { permesso: 'PERMISSION_TENANT_MANAGE_CONFIG' } }]);
    assert.deepEqual(await auditRinomina(id), [], 'nessun tentativo rifiutato è nell\'audit');

    const elenco = (await admin.get('/admin/school-years')).corpo.anni;
    assert.deepEqual(elenco.map((a) => [a.nome, a.stato, a.rinominabile]),
      [['2027/2028', 'in_preparazione', true], ['2026/2027', 'attivo', true], ['2020/2021', 'chiuso', false]]);
    const rinominato = await admin.put(`/admin/school-years/${id}`, { nome: 'Anno nuovo' });
    assert.deepEqual([rinominato.status, rinominato.corpo.nome, rinominato.corpo.stato, rinominato.corpo.dataInizio, rinominato.corpo.dataFine],
      [200, 'Anno nuovo', 'in_preparazione', '2027-09-01', '2028-06-30']);
    assert.deepEqual((await auditRinomina(id)).map((a) => [a.prima, a.dopo]), [[{ nome: '2027/2028' }, { nome: 'Anno nuovo' }]]);
    const { rows } = await pool.query("SELECT nome, to_char(data_inizio, 'YYYY-MM-DD') AS i, to_char(data_fine, 'YYYY-MM-DD') AS f FROM school_years WHERE tenant_id = $1 ORDER BY data_inizio", [alfa]);
    assert.deepEqual(rows, [
      { nome: '2020/2021', i: '2020-09-01', f: '2021-06-30' },
      { nome: '2026/2027', i: '2026-09-01', f: '2027-06-30' },
      { nome: 'Anno nuovo', i: '2027-09-01', f: '2028-06-30' },
    ], 'nessuna data è cambiata');
  } finally {
    await pool.query('DELETE FROM school_years WHERE id = ANY($1::bigint[])', [[nuovo.corpo.id, chiuso]]);
  }
});
