'use strict';

/**
 * Iterazione 2, passo A — struttura dell'istituto: livelli scolastici e classi
 * (rotte /api/admin/school-levels e /api/admin/classes), e quadro dell'istituto
 * (/api/admin/overview).
 *
 * Database proprio di questo file; ogni test rimuove ciò che crea.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

require('./support/pglite').installa();
const { pool } = require('../server/db');
const { avviaServer, loginESwitch } = require('./support/http');

let srv;
test.before(async () => { srv = await avviaServer(); });
test.after(async () => {
  await srv.chiudi();
  await pool.end();
});

const uno = async (sql, parametri) => (await pool.query(sql, parametri)).rows[0];
const erroreDi = (r) => [r.status, r.corpo && r.corpo.errore];
const ADMIN_ALFA = 'tenant.admin.a@alfa.test';
const idAlfa = async () => (await uno("SELECT id FROM tenants WHERE slug = 'alfa'")).id;
const livelloSeed = async (nome = 'Primaria') => (await uno('SELECT id FROM school_levels WHERE tenant_id = $1 AND nome = $2', [await idAlfa(), nome])).id;

async function auditDi(azione, risorsaId) {
  const { rows } = await pool.query('SELECT tenant_id, actor_account_id, prima, dopo FROM audit_log WHERE azione = $1 AND risorsa_id = $2 ORDER BY id', [azione, risorsaId]);
  return rows;
}

/** Livelli e classi creati dai test (nomi che iniziano con «Prova»): via, con le loro traduzioni. */
async function ripulisci() {
  const alfa = await idAlfa();
  await pool.query("DELETE FROM classes WHERE tenant_id = $1 AND (nome LIKE 'P-%' OR school_level_id IN (SELECT id FROM school_levels WHERE tenant_id = $1 AND nome LIKE 'Prova%'))", [alfa]);
  await pool.query("DELETE FROM content_translations WHERE school_level_id IN (SELECT id FROM school_levels WHERE tenant_id = $1 AND nome LIKE 'Prova%')", [alfa]);
  await pool.query("DELETE FROM school_levels WHERE tenant_id = $1 AND nome LIKE 'Prova%'", [alfa]);
  await pool.query("UPDATE school_levels SET stato = 'attivo' WHERE tenant_id = $1", [alfa]);
  await pool.query("UPDATE classes SET stato = 'attiva' WHERE tenant_id = $1", [alfa]);
}

// ===========================================================================
// LIVELLI
// ===========================================================================

test('Livelli: nuovo (in coda per default), rinomina e riordina, con audit; nome unico nel tenant; validazione', async () => {
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const prima = (await admin.get('/admin/school-levels')).corpo;
    assert.deepEqual(prima.map((l) => [l.nome.testo, l.stato]), [['Primaria', 'attivo'], ['Secondaria di primo grado', 'attivo']]);
    const ultimoOrdine = prima.at(-1).ordine;

    const r = await admin.post('/admin/school-levels', { nome: ' Prova infanzia ' });
    assert.equal(r.status, 201);
    assert.deepEqual({ ...r.corpo, id: undefined }, {
      id: undefined, nome: { testo: 'Prova infanzia', lingua: 'it' }, ordine: ultimoOrdine + 1, stato: 'attivo', classiAttive: 0, azioni: ['disattiva', 'elimina'],
    });
    assert.deepEqual((await auditDi('school_level.create', r.corpo.id))[0].dopo, { nome: 'Prova infanzia', ordine: ultimoOrdine + 1, stato: 'attivo' });

    const conOrdine = await admin.post('/admin/school-levels', { nome: 'Prova nido', ordine: '0' });
    assert.deepEqual([conOrdine.status, conOrdine.corpo.ordine], [201, 0]);
    assert.equal((await admin.get('/admin/school-levels')).corpo[0].nome.testo, 'Prova nido', 'l\'elenco segue l\'ordine configurato');

    const prova = async (metodo, percorso, corpo) => erroreDi(await admin[metodo](percorso, corpo));
    assert.deepEqual(await prova('post', '/admin/school-levels', { nome: 'Primaria' }), [409, { codice: 'ERR_SCHOOL_LEVEL_NAME_TAKEN', parametri: { nome: 'Primaria', campo: 'UI_FIELD_NOME' } }]);
    assert.deepEqual(await prova('post', '/admin/school-levels', { nome: '' }), [400, { codice: 'ERR_REQUIRED_FIELD', parametri: { campo: 'UI_FIELD_NOME' } }]);
    assert.deepEqual(await prova('post', '/admin/school-levels', { nome: 'x'.repeat(101) }), [400, { codice: 'ERR_TEXT_TOO_LONG', parametri: { campo: 'UI_FIELD_NOME', massimo: 100 } }]);
    assert.deepEqual(await prova('post', '/admin/school-levels', { nome: 'Prova Z', ordine: 'primo' }), [400, { codice: 'ERR_INTEGER_INVALID', parametri: { campo: 'UI_FIELD_ORDINE' } }]);

    const mod = await admin.put(`/admin/school-levels/${r.corpo.id}`, { nome: 'Prova infanzia statale', ordine: 7 });
    assert.deepEqual([mod.status, mod.corpo.nome.testo, mod.corpo.ordine], [200, 'Prova infanzia statale', 7]);
    assert.deepEqual((await auditDi('school_level.update', r.corpo.id)).map((a) => [a.prima, a.dopo]), [[
      { nome: 'Prova infanzia', ordine: ultimoOrdine + 1, stato: 'attivo' }, { nome: 'Prova infanzia statale', ordine: 7, stato: 'attivo' },
    ]]);
    assert.equal((await admin.put(`/admin/school-levels/${r.corpo.id}`, { ordine: 3 })).corpo.nome.testo, 'Prova infanzia statale', 'solo l\'ordine: il nome resta');
    assert.deepEqual(await prova('put', `/admin/school-levels/${r.corpo.id}`, { nome: 'Primaria' }), [409, { codice: 'ERR_SCHOOL_LEVEL_NAME_TAKEN', parametri: { nome: 'Primaria', campo: 'UI_FIELD_NOME' } }]);
  } finally {
    await ripulisci();
  }
});

test('Livelli: disattiva e riattiva con audit; un livello disattivato resta leggibile nello storico del docente', async () => {
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const primaria = await livelloSeed();
    const d = await admin.post(`/admin/school-levels/${primaria}/deactivate`);
    assert.deepEqual([d.status, d.corpo.stato, d.corpo.azioni], [200, 'disattivato', ['riattiva']], 'con dati: niente «elimina»');
    assert.deepEqual(erroreDi(await admin.post(`/admin/school-levels/${primaria}/deactivate`)), [409, { codice: 'ERR_STATE_UNCHANGED', parametri: { stato: 'STATUS_SCHOOL_LEVEL_DISATTIVATO' } }]);
    assert.deepEqual((await auditDi('school_level.deactivate', primaria)).map((a) => [a.prima, a.dopo]), [[{ stato: 'attivo' }, { stato: 'disattivato' }]]);

    // Storico: gli insegnamenti e le viste del docente sul livello disattivato restano leggibili.
    const docente = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
    const tn = (await docente.get('/teachings')).corpo.find((t) => t.proprio);
    assert.ok(tn, 'l\'insegnamento resta nell\'elenco');
    assert.equal((await docente.get(`/teachings/${tn.teaching_id}/class-overview`)).status, 200);
    assert.ok((await admin.get('/admin/school-levels')).corpo.some((l) => l.id === primaria && l.stato === 'disattivato'));

    const r = await admin.post(`/admin/school-levels/${primaria}/reactivate`);
    assert.deepEqual([r.status, r.corpo.stato], [200, 'attivo']);
    assert.deepEqual((await auditDi('school_level.reactivate', primaria)).map((a) => a.dopo), [{ stato: 'attivo' }]);
  } finally {
    await ripulisci();
  }
});

test('Livelli: si elimina solo senza dati collegati (audit, traduzioni comprese); con classi o materie -> 409 con l\'invito a disattivare, mai 500', async () => {
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    assert.deepEqual(erroreDi(await admin.del(`/admin/school-levels/${await livelloSeed()}`)),
      [409, { codice: 'ERR_SCHOOL_LEVEL_IN_USE', parametri: { nome: 'Primaria' } }]);
    const vuoto = (await admin.post('/admin/school-levels', { nome: 'Prova vuoto' })).corpo.id;
    const classe = (await admin.post(`/admin/school-levels/${vuoto}/classes`, { nome: 'P-1A' })).corpo.id;
    assert.deepEqual(erroreDi(await admin.del(`/admin/school-levels/${vuoto}`)), [409, { codice: 'ERR_SCHOOL_LEVEL_IN_USE', parametri: { nome: 'Prova vuoto' } }]);
    assert.equal((await admin.del(`/admin/classes/${classe}`)).status, 204);
    // Una scala di livello (regole di valutazione) è un dato collegato anche se l'elenco delle classi è vuoto.
    const scala = (await uno("INSERT INTO observation_scales (tenant_id, school_level_id, nome) VALUES ($1, $2, 'Scala di prova') RETURNING id", [await idAlfa(), vuoto])).id;
    assert.deepEqual(erroreDi(await admin.del(`/admin/school-levels/${vuoto}`)), [409, { codice: 'ERR_SCHOOL_LEVEL_IN_USE', parametri: { nome: 'Prova vuoto' } }]);
    await pool.query('DELETE FROM observation_scales WHERE id = $1', [scala]);

    await pool.query("INSERT INTO languages (codice, direzione) VALUES ('ar-XB', 'rtl') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO tenant_languages (tenant_id, lingua) VALUES ($1, 'ar-XB') ON CONFLICT DO NOTHING", [await idAlfa()]);
    await pool.query("INSERT INTO content_translations (tenant_id, lingua, campo, school_level_id, testo) VALUES ($1, 'ar-XB', 'school_levels.nome', $2, 'مستوى')", [await idAlfa(), vuoto]);
    assert.equal((await admin.del(`/admin/school-levels/${vuoto}`)).status, 204);
    assert.equal((await pool.query('SELECT 1 FROM school_levels WHERE id = $1', [vuoto])).rows.length, 0);
    assert.equal((await pool.query('SELECT 1 FROM content_translations WHERE school_level_id = $1', [vuoto])).rows.length, 0);
    assert.deepEqual((await auditDi('school_level.delete', vuoto))[0].prima.nome, 'Prova vuoto');
  } finally {
    await ripulisci();
  }
});

// ===========================================================================
// CLASSI
// ===========================================================================

test('Classi: nuova, rinomina, disattiva e riattiva, con audit; nome unico nel livello (lo stesso nome in un altro livello è ammesso)', async () => {
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const primaria = await livelloSeed();
    const secondaria = await livelloSeed('Secondaria di primo grado');
    const r = await admin.post(`/admin/school-levels/${primaria}/classes`, { nome: ' P-5C ' });
    assert.equal(r.status, 201);
    assert.deepEqual({ ...r.corpo, id: undefined }, { id: undefined, nome: 'P-5C', stato: 'attiva', azioni: ['disattiva', 'elimina'] });
    assert.deepEqual((await auditDi('class.create', r.corpo.id))[0].dopo, { nome: 'P-5C', stato: 'attiva', schoolLevelId: primaria });
    assert.deepEqual(erroreDi(await admin.post(`/admin/school-levels/${primaria}/classes`, { nome: 'P-5C' })),
      [409, { codice: 'ERR_CLASS_NAME_TAKEN', parametri: { nome: 'P-5C', campo: 'UI_FIELD_NOME' } }]);
    assert.equal((await admin.post(`/admin/school-levels/${secondaria}/classes`, { nome: 'P-5C' })).status, 201, 'altro livello: ammesso');
    assert.deepEqual(erroreDi(await admin.post(`/admin/school-levels/${primaria}/classes`, { nome: 'x'.repeat(51) })),
      [400, { codice: 'ERR_TEXT_TOO_LONG', parametri: { campo: 'UI_FIELD_NOME', massimo: 50 } }]);

    // Rinomina: il livello non cambia, anche se il corpo ne indica un altro (nessuno «sposta», decisione 14).
    const ren = await admin.put(`/admin/classes/${r.corpo.id}`, { nome: 'P-5D', schoolLevelId: secondaria });
    assert.deepEqual([ren.status, ren.corpo.nome], [200, 'P-5D']);
    assert.equal((await uno('SELECT school_level_id FROM classes WHERE id = $1', [r.corpo.id])).school_level_id, primaria);
    assert.deepEqual((await auditDi('class.update', r.corpo.id)).map((a) => [a.prima.nome, a.dopo.nome]), [['P-5C', 'P-5D']]);
    // Una classe con alunni e insegnamenti si rinomina (il nome non è un riferimento protetto dalla 004).
    const classe2A = (await uno("SELECT id FROM classes WHERE tenant_id = $1 AND nome = '2A'", [await idAlfa()])).id;
    assert.equal((await admin.put(`/admin/classes/${classe2A}`, { nome: 'P-2A' })).status, 200);
    assert.equal((await admin.put(`/admin/classes/${classe2A}`, { nome: '2A' })).status, 200);

    const d = await admin.post(`/admin/classes/${r.corpo.id}/deactivate`);
    assert.deepEqual([d.status, d.corpo.stato, d.corpo.azioni], [200, 'disattivata', ['riattiva', 'elimina']]);
    assert.deepEqual(erroreDi(await admin.post(`/admin/classes/${r.corpo.id}/deactivate`)), [409, { codice: 'ERR_STATE_UNCHANGED', parametri: { stato: 'STATUS_CLASS_DISATTIVATA' } }]);
    const elenco = (await admin.get(`/admin/school-levels/${primaria}/classes`)).corpo;
    assert.equal(elenco.livello.nome.testo, 'Primaria');
    assert.ok(elenco.classi.some((c) => c.id === r.corpo.id && c.stato === 'disattivata'), 'le disattivate restano nell\'elenco dell\'amministrazione');
    assert.ok(!(await admin.get(`/school-levels/${primaria}/classes`)).corpo.some((c) => c.id === r.corpo.id), 'ma non nell\'elenco delle classi attive');
    assert.equal((await admin.post(`/admin/classes/${r.corpo.id}/reactivate`)).status, 200);
    assert.deepEqual((await auditDi('class.deactivate', r.corpo.id)).length + (await auditDi('class.reactivate', r.corpo.id)).length, 2);
  } finally {
    await ripulisci();
  }
});

test('Classi: in un livello disattivato non si creano né si riattivano classi (409)', async () => {
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const livello = (await admin.post('/admin/school-levels', { nome: 'Prova chiuso' })).corpo.id;
    const classe = (await admin.post(`/admin/school-levels/${livello}/classes`, { nome: 'P-1' })).corpo.id;
    await admin.post(`/admin/classes/${classe}/deactivate`);
    await admin.post(`/admin/school-levels/${livello}/deactivate`);
    const DISATTIVATO = [409, { codice: 'ERR_SCHOOL_LEVEL_DEACTIVATED', parametri: { livello: 'Prova chiuso' } }];
    assert.deepEqual(erroreDi(await admin.post(`/admin/school-levels/${livello}/classes`, { nome: 'P-2' })), DISATTIVATO);
    assert.deepEqual(erroreDi(await admin.post(`/admin/classes/${classe}/reactivate`)), DISATTIVATO);
    assert.deepEqual((await admin.get(`/admin/school-levels/${livello}/classes`)).corpo.classi[0].azioni, ['elimina'], 'niente «riattiva» finché il livello è disattivato');
  } finally {
    await ripulisci();
  }
});

test('Classi: si elimina solo senza dati collegati (audit); con alunni o insegnamenti -> 409, mai 500', async () => {
  try {
    const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const classe2A = (await uno("SELECT id FROM classes WHERE tenant_id = $1 AND nome = '2A'", [await idAlfa()])).id;
    assert.deepEqual(erroreDi(await admin.del(`/admin/classes/${classe2A}`)), [409, { codice: 'ERR_CLASS_IN_USE', parametri: { nome: '2A' } }]);
    const vuota = (await admin.post(`/admin/school-levels/${await livelloSeed()}/classes`, { nome: 'P-9Z' })).corpo.id;
    assert.equal((await admin.del(`/admin/classes/${vuota}`)).status, 204);
    assert.deepEqual((await auditDi('class.delete', vuota))[0].prima, { nome: 'P-9Z', stato: 'attiva', schoolLevelId: await livelloSeed() });
    assert.deepEqual(erroreDi(await admin.del(`/admin/classes/${vuota}`)), [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_CLASS' } }]);
  } finally {
    await ripulisci();
  }
});

test('Livelli e classi: isolamento — un TENANT_ADMIN non legge né modifica quelli di un\'altra scuola (404); docente e coordinatore -> 403', async () => {
  try {
    const adminAlfa = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
    const livello = (await adminAlfa.post('/admin/school-levels', { nome: 'Prova isolamento' })).corpo.id;
    const classe = (await adminAlfa.post(`/admin/school-levels/${livello}/classes`, { nome: 'P-ISO' })).corpo.id;
    const adminBeta = await loginESwitch(srv.base, 'tenant.admin.b@beta.test', 'beta');
    assert.ok(!(await adminBeta.get('/admin/school-levels')).corpo.some((l) => l.id === livello));
    const LIV = [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_SCHOOL_LEVEL' } }];
    const CLA = [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_CLASS' } }];
    const casi = [
      [adminBeta.put(`/admin/school-levels/${livello}`, { nome: 'X' }), LIV],
      [adminBeta.post(`/admin/school-levels/${livello}/deactivate`), LIV],
      [adminBeta.post(`/admin/school-levels/${livello}/reactivate`), LIV],
      [adminBeta.del(`/admin/school-levels/${livello}`), LIV],
      [adminBeta.get(`/admin/school-levels/${livello}/classes`), LIV],
      [adminBeta.post(`/admin/school-levels/${livello}/classes`, { nome: 'X' }), LIV],
      [adminBeta.put(`/admin/classes/${classe}`, { nome: 'X' }), CLA],
      [adminBeta.post(`/admin/classes/${classe}/deactivate`), CLA],
      [adminBeta.post(`/admin/classes/${classe}/reactivate`), CLA],
      [adminBeta.del(`/admin/classes/${classe}`), CLA],
    ];
    for (const [i, [richiesta, atteso]] of casi.entries()) assert.deepEqual(erroreDi(await richiesta), atteso, `richiesta ${i}`);
    assert.deepEqual(await uno('SELECT l.nome AS livello, l.stato, c.nome AS classe FROM classes c JOIN school_levels l ON l.id = c.school_level_id WHERE c.id = $1', [classe]),
      { livello: 'Prova isolamento', stato: 'attivo', classe: 'P-ISO' });

    const CONFIG = [403, { codice: 'ERR_PERMISSION_MISSING', parametri: { permesso: 'PERMISSION_TENANT_MANAGE_CONFIG' } }];
    const CLASSI = [403, { codice: 'ERR_PERMISSION_MISSING', parametri: { permesso: 'PERMISSION_CLASS_MANAGE' } }];
    for (const email of ['teacher.math.a@alfa.test', 'coordinator.a@alfa.test']) {
      const s = await loginESwitch(srv.base, email, 'alfa');
      const richieste = [
        [s.get('/admin/school-levels'), CONFIG], [s.post('/admin/school-levels', { nome: 'Prova X' }), CONFIG],
        [s.put(`/admin/school-levels/${livello}`, { nome: 'X' }), CONFIG], [s.post(`/admin/school-levels/${livello}/deactivate`), CONFIG],
        [s.post(`/admin/school-levels/${livello}/reactivate`), CONFIG], [s.del(`/admin/school-levels/${livello}`), CONFIG],
        [s.get(`/admin/school-levels/${livello}/classes`), CLASSI], [s.post(`/admin/school-levels/${livello}/classes`, { nome: 'X' }), CLASSI],
        [s.put(`/admin/classes/${classe}`, { nome: 'X' }), CLASSI], [s.post(`/admin/classes/${classe}/deactivate`), CLASSI],
        [s.post(`/admin/classes/${classe}/reactivate`), CLASSI], [s.del(`/admin/classes/${classe}`), CLASSI],
      ];
      for (const [i, [richiesta, atteso]] of richieste.entries()) assert.deepEqual(erroreDi(await richiesta), atteso, `${email}, richiesta ${i}`);
    }
  } finally {
    await ripulisci();
  }
});

// ===========================================================================
// QUADRO DELL'ISTITUTO
// ===========================================================================

const { login } = require('./support/http');

/** Scuola vuota creata dal PLATFORM_ADMIN; il suo amministratore entra e cambia la password temporanea. */
async function scuolaVuota(slug) {
  const { sessione: piattaforma } = await login(srv.base, 'platform.admin@platform.test');
  const creata = await piattaforma.post('/platform/tenants', {
    slug, nome: `Istituto ${slug}`, amministratore: { nome: 'Quadro', cognome: 'Admin', email: `admin@${slug}.test` },
  });
  assert.equal(creata.status, 201);
  const { sessione } = await login(srv.base, `admin@${slug}.test`, creata.corpo.amministratore.passwordTemporanea);
  assert.equal((await sessione.post('/auth/password', {
    passwordAttuale: creata.corpo.amministratore.passwordTemporanea, passwordNuova: 'una frase lunga e nuova',
  })).status, 200);
  return { admin: sessione, tenantId: creata.corpo.id, accountId: creata.corpo.amministratore.account.id };
}

const codici = (quadro) => quadro.daFare.map((v) => v.codice);

test('Quadro: in una scuola vuota ogni «cosa da fare» compare quando deve e sparisce quando è sistemata; riepilogo per livello', async () => {
  const { admin, tenantId, accountId } = await scuolaVuota('quadro');
  const quadro = async (anno) => {
    const r = await admin.get(`/admin/overview${anno ? `?anno=${anno}` : ''}`);
    assert.equal(r.status, 200);
    return r.corpo;
  };

  let q = await quadro();
  assert.equal(q.anno, null);
  assert.deepEqual(q.daFare, [
    { codice: 'UI_TODO_NO_ACTIVE_YEAR', parametri: {}, collegamento: { sezione: 'calendario' } },
    { codice: 'UI_TODO_NO_LEVELS', parametri: {}, collegamento: { sezione: 'livelli' } },
  ]);
  assert.deepEqual(q.riepilogo, []);

  // Anno in preparazione: diventa l'anno di lavoro; manca ancora un anno attivo, e i periodi.
  const anno = (await admin.post('/admin/school-years', { nome: '2026/2027', dataInizio: '2026-09-01', dataFine: '2027-06-30' })).corpo;
  q = await quadro();
  assert.deepEqual([q.anno.id, q.anno.stato], [anno.id, 'in_preparazione']);
  assert.deepEqual(q.daFare.slice(0, 2), [
    { codice: 'UI_TODO_NO_ACTIVE_YEAR', parametri: {}, collegamento: { sezione: 'calendario' } },
    { codice: 'UI_TODO_YEAR_WITHOUT_PERIODS', parametri: { anno: '2026/2027' }, collegamento: { sezione: 'calendario', annoId: anno.id } },
  ]);
  await admin.post(`/admin/school-years/${anno.id}/activate`);
  assert.ok(!codici(await quadro()).includes('UI_TODO_NO_ACTIVE_YEAR'), 'anno attivato: sparisce');
  await admin.post(`/admin/school-years/${anno.id}/periods`, { nome: 'Primo quadrimestre', dataInizio: '2026-09-01', dataFine: '2027-01-31' });
  assert.deepEqual(codici(await quadro()), ['UI_TODO_NO_LEVELS'], 'periodo aggiunto: sparisce');

  // Livello senza classi, poi una classe senza alunni né insegnamenti.
  const livello = (await admin.post('/admin/school-levels', { nome: 'Primaria' })).corpo;
  q = await quadro();
  assert.deepEqual(q.daFare, [{
    codice: 'UI_TODO_LEVEL_WITHOUT_CLASSES', parametri: { livello: { testo: 'Primaria', lingua: 'it' } }, collegamento: { sezione: 'classi', livelloId: livello.id },
  }]);
  const classe = (await admin.post(`/admin/school-levels/${livello.id}/classes`, { nome: '1A' })).corpo;
  q = await quadro();
  const parametriClasse = { classe: '1A', livello: { testo: 'Primaria', lingua: 'it' }, anno: '2026/2027' };
  assert.deepEqual(q.daFare, [
    { codice: 'UI_TODO_CLASS_WITHOUT_STUDENTS', parametri: parametriClasse, collegamento: null },
    { codice: 'UI_TODO_CLASS_WITHOUT_TEACHINGS', parametri: parametriClasse, collegamento: null },
  ]);
  assert.deepEqual(q.riepilogo, [{ livello: { id: livello.id, nome: { testo: 'Primaria', lingua: 'it' }, stato: 'attivo' }, classi: 1, alunni: 0, docenti: 0, insegnamenti: 0 }]);

  // Un alunno iscritto e un insegnamento (con SQL: le sezioni Persone e Insegnamenti sono dei passi futuri).
  const persona = (await uno("INSERT INTO people (tenant_id, nome, cognome) VALUES ($1, 'Ada', 'Alunna') RETURNING id", [tenantId])).id;
  await pool.query('INSERT INTO enrollments (tenant_id, school_year_id, class_id, student_person_id) VALUES ($1, $2, $3, $4)', [tenantId, anno.id, classe.id, persona]);
  assert.deepEqual(codici(await quadro()), ['UI_TODO_CLASS_WITHOUT_TEACHINGS'], 'alunno iscritto: sparisce');
  const materia = (await uno("INSERT INTO subjects (tenant_id, school_level_id, school_year_id, nome) VALUES ($1, $2, $3, 'Matematica') RETURNING id", [tenantId, livello.id, anno.id])).id;
  await pool.query('INSERT INTO teachings (tenant_id, school_year_id, class_id, subject_id, account_id) VALUES ($1, $2, $3, $4, $5)', [tenantId, anno.id, classe.id, materia, accountId]);
  q = await quadro();
  assert.deepEqual(q.daFare, [], 'tutto sistemato');
  assert.deepEqual(q.riepilogo.map(({ classi, alunni, docenti, insegnamenti }) => [classi, alunni, docenti, insegnamenti]), [[1, 1, 1, 1]]);

  // Un account del tenant con la password temporanea ancora da cambiare.
  const p2 = (await uno("INSERT INTO people (nome, cognome) VALUES ('Tea', 'Temporanea') RETURNING id")).id;
  const a2 = (await uno("INSERT INTO accounts (email, person_id, deve_cambiare_password) VALUES ('tea@quadro.test', $1, true) RETURNING id", [p2])).id;
  await pool.query('INSERT INTO memberships (account_id, tenant_id) VALUES ($1, $2)', [a2, tenantId]);
  assert.deepEqual((await quadro()).daFare, [{
    codice: 'UI_TODO_ACCOUNT_TEMPORARY_PASSWORD', parametri: { persona: 'Tea Temporanea', email: 'tea@quadro.test' }, collegamento: null,
  }]);
  await pool.query('UPDATE accounts SET deve_cambiare_password = false WHERE id = $1', [a2]);
  assert.deepEqual((await quadro()).daFare, [], 'password cambiata: sparisce');

  // Disattivare la classe la toglie dalle cose da fare; disattivare il livello fa ricomparire «nessun livello».
  await pool.query('DELETE FROM teachings WHERE class_id = $1', [classe.id]);
  assert.deepEqual(codici(await quadro()), ['UI_TODO_CLASS_WITHOUT_TEACHINGS']);
  await admin.post(`/admin/classes/${classe.id}/deactivate`);
  assert.deepEqual(codici(await quadro()), ['UI_TODO_LEVEL_WITHOUT_CLASSES']);
  await admin.post(`/admin/school-levels/${livello.id}/deactivate`);
  q = await quadro();
  assert.deepEqual(codici(q), ['UI_TODO_NO_LEVELS']);
  assert.equal(q.riepilogo[0].livello.stato, 'disattivato', 'il livello disattivato resta nel riepilogo');

  // Il quadro di un anno scelto: un anno passato chiuso, senza periodi né alunni.
  await pool.query("INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine, stato) VALUES ($1, '2025/2026', '2025-09-01', '2026-06-30', 'chiuso')", [tenantId]);
  const passato = (await uno("SELECT id FROM school_years WHERE tenant_id = $1 AND nome = '2025/2026'", [tenantId])).id;
  await admin.post(`/admin/school-levels/${livello.id}/reactivate`);
  await admin.post(`/admin/classes/${classe.id}/reactivate`);
  q = await quadro(passato);
  assert.equal(q.anno.nome, '2025/2026');
  assert.deepEqual(codici(q), ['UI_TODO_YEAR_WITHOUT_PERIODS', 'UI_TODO_CLASS_WITHOUT_STUDENTS', 'UI_TODO_CLASS_WITHOUT_TEACHINGS']);
  assert.equal((await quadro()).anno.id, anno.id, 'senza ?anno: l\'anno attivo');
});

test('Quadro: isolamento (anno di un\'altra scuola -> 404) e permessi (docente e coordinatore -> 403)', async () => {
  const admin = await loginESwitch(srv.base, ADMIN_ALFA, 'alfa');
  const q = (await admin.get('/admin/overview')).corpo;
  assert.equal(q.anno.nome, '2026/2027');
  assert.deepEqual(q.riepilogo.map((r) => r.livello.nome.testo), ['Primaria', 'Secondaria di primo grado']);
  const annoBeta = (await uno("SELECT id FROM school_years WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'beta')")).id;
  const NON_TROVATO = [404, { codice: 'ERR_NOT_FOUND', parametri: { risorsa: 'UI_RESOURCE_SCHOOL_YEAR' } }];
  assert.deepEqual(erroreDi(await admin.get(`/admin/overview?anno=${annoBeta}`)), NON_TROVATO);
  assert.deepEqual(erroreDi(await admin.get('/admin/overview?anno=abc')), NON_TROVATO);
  for (const email of ['teacher.math.a@alfa.test', 'coordinator.a@alfa.test']) {
    const s = await loginESwitch(srv.base, email, 'alfa');
    assert.deepEqual(erroreDi(await s.get('/admin/overview')), [403, { codice: 'ERR_PERMISSION_MISSING', parametri: { permesso: 'PERMISSION_TENANT_MANAGE_CONFIG' } }]);
  }
});

test('Catalogo: ogni «cosa da fare» del quadro e ogni stato di anni, livelli e classi ha un testo', () => {
  const catalogo = require('../server/i18n/catalogo/it.json').testi;
  const { TODO } = require('../server/queries/quadro');
  const { chiaveStato } = require('../server/queries/calendario');
  const { chiaveStatoLivello, chiaveStatoClasse } = require('../server/queries/struttura');
  const attese = [
    ...Object.values(TODO),
    ...['attivo', 'in_preparazione', 'chiuso'].map(chiaveStato),
    ...['attivo', 'disattivato'].map(chiaveStatoLivello),
    ...['attiva', 'disattivata'].map(chiaveStatoClasse),
  ];
  assert.deepEqual(attese.filter((c) => !(c in catalogo)), []);
});
