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
