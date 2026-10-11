'use strict';

/**
 * seed/seed_esteso.sql: si applica sopra la catena completa (000 → 003 + seed di base),
 * è idempotente e produce gli scenari per cui esiste (viste V2 con dati ampi).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const supporto = require('./support/pglite');

supporto.installa({ url: supporto.URL_ESTESO });
const { pool } = require('../server/db');
const { avviaServer, loginESwitch } = require('./support/http');

let srv;
let sessione;
let insegnamenti;
test.before(async () => {
  srv = await avviaServer();
  sessione = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
  insegnamenti = (await sessione.get('/teachings')).corpo.filter((t) => t.proprio);
});
test.after(async () => {
  await srv.chiudi();
  await pool.end();
});

const quadro = async (classe) => {
  const t = insegnamenti.find((x) => x.classe === classe);
  return (await sessione.get(`/teachings/${t.teaching_id}/class-overview`)).corpo;
};
const matrice = async (classe) => {
  const t = insegnamenti.find((x) => x.classe === classe);
  return (await sessione.get(`/teachings/${t.teaching_id}/students-matrix`)).corpo;
};

test('seed esteso: idempotente (una seconda esecuzione non cambia nulla)', async () => {
  const conta = async () => (await pool.query('SELECT (SELECT count(*) FROM observations) + (SELECT count(*) FROM activities) + (SELECT count(*) FROM people) AS n')).rows[0].n;
  const prima = await conta();
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'seed', 'seed_esteso.sql'), 'utf8'));
  assert.equal(await conta(), prima);
});

test('seed esteso 2A: criterio critico nel blocco attenzione, esclusioni per iscrizione non attiva, nessuna difficoltà generalizzata', async () => {
  const q = await quadro('2A');
  assert.equal(q.avviso, null);
  assert.ok(q.bloccoAttenzione.some((v) => v.codice === 'REL-2'));
  assert.deepEqual(q.esclusioni.map((e) => e.motivo), ['EXCLUSION_ENROLLMENT_INACTIVE']);
  const voci = q.distribuzione.bande;
  assert.ok(voci.some((v) => v.studentiParziali > 0) && voci.some((v) => v.studenti > v.studentiParziali), 'certezze miste');
});

test('seed esteso 2B: difficoltà generalizzata', async () => {
  const q = await quadro('2B');
  assert.equal(q.avviso, 'GENERALIZED_DIFFICULTY');
});

test('seed esteso: la matrice ha celle in banda critica e da verificare, e il filtro non è vuoto', async () => {
  for (const classe of ['2A', '2B']) {
    const m = await matrice(classe);
    const celle = m.studenti.flatMap((s) => s.celle);
    assert.ok(celle.some((c) => c.criticita === 'CRITICAL_BAND'), `${classe}: banda critica`);
    assert.ok(celle.some((c) => c.criticita === 'CRITICAL_TO_VERIFY'), `${classe}: da verificare`);
    assert.ok(m.studenti.some((s) => s.inZonaCritica) && m.studenti.some((s) => !s.inZonaCritica), `${classe}: filtro significativo`);
  }
});
