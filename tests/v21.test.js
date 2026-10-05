'use strict';

/**
 * Visual Grammar V2.1 — revisione 2: campi derivati del payload E1–E4 (nessun calcolo
 * nuovo nel motore, nessuna migrazione). Database: catena completa + seed esteso.
 *
 *   E1 bande[].colore (+ inchiostro): colore della banda assegnato dal server;
 *   E2 scala.valori[].bandaId: banda di ogni valore 0…n (osservazione reale), mai di null;
 *   E3 studenti[].complessivo nella matrice: lo stesso complessivo del profilo;
 *   E4 valutazioni[].bandaId: abbinamento esatto giudizio ↔ etichetta (maiuscole e spazi ignorati).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const supporto = require('./support/pglite');

supporto.installa({ url: supporto.URL_ESTESO });
const { pool } = require('../server/db');
const { avviaServer, loginESwitch } = require('./support/http');
const { coloreBanda, contrasto, bandaDelGiudizio, PALETTE_BANDE } = require('../server/lib/pubblicazione');

let srv;
let alfa;
let beta;
let insegnamento2A;
test.before(async () => {
  srv = await avviaServer();
  alfa = await loginESwitch(srv.base, 'teacher.math.a@alfa.test', 'alfa');
  beta = await loginESwitch(srv.base, 'teacher.math.b@beta.test', 'beta');
  insegnamento2A = (await alfa.get('/teachings')).corpo.find((t) => t.proprio && t.classe === '2A');
});
test.after(async () => {
  await srv.chiudi();
  await pool.end();
});

const etichetta = (bande, id) => {
  const b = bande.find((x) => x.id === id);
  return b ? b.etichetta.testo : null;
};

test('E1: ogni banda ha un colore assegnato dal server, distinto per livello e leggibile con il suo inchiostro', async () => {
  const q = (await alfa.get(`/teachings/${insegnamento2A.teaching_id}/class-overview`)).corpo;
  assert.equal(q.bande.length, 6);
  q.bande.forEach((b) => {
    assert.match(b.colore, /^#[0-9a-f]{6}$/);
    assert.ok(contrasto(b.colore, b.inchiostro) >= 4.5, `${b.etichetta.testo}: contrasto ${contrasto(b.colore, b.inchiostro)}`);
  });
  assert.equal(new Set(q.bande.map((b) => b.colore)).size, 6, 'colori distinti');
  const critica = q.bande.find((b) => b.critica);
  assert.equal(critica.colore, PALETTE_BANDE[0], 'la banda critica (livello 0) ha il primo colore della scala');
});

test('E1: con meno bande si campionano colori equidistanti; con una sola banda un colore neutro della scala', () => {
  assert.deepEqual([0, 1, 2, 3].map((l) => coloreBanda(l, 4).colore), [0, 2, 3, 5].map((i) => PALETTE_BANDE[i]));
  assert.equal(coloreBanda(0, 1).colore, PALETTE_BANDE[3]);
});

test('E1: le bande hanno il colore in tutti i report (profilo, matrice, valutazioni, griglia, esito attività)', async () => {
  const id = insegnamento2A.teaching_id;
  const matrice = (await alfa.get(`/teachings/${id}/students-matrix`)).corpo;
  const profilo = (await alfa.get(`/teachings/${id}/students/${matrice.studenti[3].enrollmentId}/progress`)).corpo;
  const valutazioni = (await alfa.get(`/teachings/${id}/assessments`)).corpo;
  const attivita = (await alfa.get(`/teachings/${id}/activities`)).corpo[0];
  const griglia = (await alfa.get(`/activities/${attivita.activity_id}/griglia`)).corpo;
  const esito = (await alfa.get(`/activities/${attivita.activity_id}/report-classe`)).corpo;
  [matrice, profilo, valutazioni, griglia, esito].forEach((r) => r.bande.forEach((b) => assert.ok(b.colore && b.inchiostro)));
});

test('E2 Alfa: 0, 1 e 2 sono osservazioni reali con la loro banda (0 Non manifestato = NON SUFFICIENTE)', async () => {
  const id = insegnamento2A.teaching_id;
  const matrice = (await alfa.get(`/teachings/${id}/students-matrix`)).corpo;
  const profilo = (await alfa.get(`/teachings/${id}/students/${matrice.studenti[3].enrollmentId}/progress`)).corpo;
  const atteso = [[0, 'Non manifestato', 'NON SUFFICIENTE'], [1, 'Con supporto', 'SUFFICIENTE'], [2, 'Autonomo', 'OTTIMO']];
  assert.deepEqual(profilo.scala.valori.map((v) => [v.valore, v.etichetta.testo, etichetta(profilo.bande, v.bandaId)]), atteso);
  assert.ok(profilo.scala.valori.every((v) => v.bandaId !== null), 'nessun valore della scala è senza banda: null non è un valore della scala');

  const attivita = (await alfa.get(`/teachings/${id}/activities`)).corpo[0];
  for (const percorso of [`/activities/${attivita.activity_id}/griglia`, `/activities/${attivita.activity_id}/report-classe`]) {
    const r = (await alfa.get(percorso)).corpo;
    assert.deepEqual(r.scala.valori.map((v) => [v.valore, v.etichetta.testo, etichetta(r.bande, v.bandaId)]), atteso, percorso);
  }
});

test('E2 Beta (scala 1–4, 4 bande): stessa regola del motore, valore / massimo × 100 con la Regola B', async () => {
  const t = (await beta.get('/teachings')).corpo.find((x) => x.proprio);
  const matrice = (await beta.get(`/teachings/${t.teaching_id}/students-matrix`)).corpo;
  const profilo = (await beta.get(`/teachings/${t.teaching_id}/students/${matrice.studenti[0].enrollmentId}/progress`)).corpo;
  assert.deepEqual(
    profilo.scala.valori.map((v) => [v.valore, etichetta(profilo.bande, v.bandaId)]),
    [[1, 'INSUFFICIENTE'], [2, 'INSUFFICIENTE'], [3, 'BUONO'], [4, 'ECCELLENTE']]
  );
});

test('E2: le osservazioni restano valore + etichetta (nessuna banda nella riga), null non compare come osservazione', async () => {
  const id = insegnamento2A.teaching_id;
  const matrice = (await alfa.get(`/teachings/${id}/students-matrix`)).corpo;
  const profilo = (await alfa.get(`/teachings/${id}/students/${matrice.studenti[3].enrollmentId}/progress`)).corpo;
  const osservazioni = profilo.nuclei.flatMap((n) => n.criteri.flatMap((c) => c.osservazioni));
  assert.ok(osservazioni.length > 0);
  osservazioni.forEach((o) => {
    assert.equal(typeof o.valore, 'number');
    assert.ok(!('bandaId' in o) && !('percentuale' in o));
  });
  assert.ok(osservazioni.some((o) => o.valore === 0), 'il seed contiene valori 0 osservati');
});

test('Esito attività: la distribuzione distingue 0/1/2 e i non osservati (null) senza nuovi calcoli', async () => {
  const id = insegnamento2A.teaching_id;
  const attivita = (await alfa.get(`/teachings/${id}/activities`)).corpo.find((a) => a.nome.testo === 'Il grafico delle merende');
  const r = (await alfa.get(`/activities/${attivita.activity_id}/report-classe`)).corpo;
  const rel1 = r.unitaPedagogiche[0].criteri.find((c) => c.codice === 'REL-1');
  assert.deepEqual(rel1.distribuzione.map((d) => [d.valore, d.studenti]), [[0, 1], [1, 9], [2, 7]]);
  assert.equal(rel1.nonValutati, 4);
  assert.equal(rel1.base.N, rel1.distribuzione.reduce((t, d) => t + d.studenti, 0) + rel1.nonValutati);
});

test('E3: il complessivo di ogni alunno nella matrice è quello del profilo (prodotto dal motore)', async () => {
  const id = insegnamento2A.teaching_id;
  const matrice = (await alfa.get(`/teachings/${id}/students-matrix`)).corpo;
  for (const s of matrice.studenti.slice(0, 6)) {
    const p = (await alfa.get(`/teachings/${id}/students/${s.enrollmentId}/progress`)).corpo;
    assert.deepEqual(s.complessivo, p.complessivo, `${s.cognome} ${s.nome}`);
  }
  const luca = matrice.studenti.find((s) => s.nome === 'Luca' && s.cognome === 'Colombo');
  assert.deepEqual([luca.complessivo.percentuale, luca.complessivo.certezza], [72.91, 'CERTAINTY_PARTIAL'], 'motore invariato');
});

test('E4: il giudizio coincide con un\'etichetta di banda (maiuscole e spazi ignorati) oppure non ha banda', async () => {
  const id = insegnamento2A.teaching_id;
  const matrice = (await alfa.get(`/teachings/${id}/students-matrix`)).corpo;
  const trova = (nome) => matrice.studenti.find((s) => s.nome === nome);
  const { rows: [ctx] } = await pool.query(
    `SELECT t.tenant_id, t.school_year_id, t.class_id, t.subject_id, t.account_id,
            (SELECT id FROM assessment_periods WHERE tenant_id = t.tenant_id AND nome = 'Primo quadrimestre') AS periodo
     FROM teachings t WHERE t.id = $1`, [id]
  );
  const inserisci = (enrollmentId, giudizio) => pool.query(
    `INSERT INTO assessments (tenant_id, school_year_id, teaching_id, class_id, subject_id, enrollment_id, assessment_period_id, giudizio, recorded_by_account_id, lingua_contenuto)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'it')`,
    [ctx.tenant_id, ctx.school_year_id, id, ctx.class_id, ctx.subject_id, enrollmentId, ctx.periodo, giudizio, ctx.account_id]
  );
  await inserisci(trova('Martina').enrollmentId, '  non   sufficiente ');
  await inserisci(trova('Riccardo').enrollmentId, 'In crescita');

  const r = (await alfa.get(`/teachings/${id}/assessments`)).corpo;
  const per = (nome) => r.valutazioni.find((v) => v.alunno.nome === nome);
  assert.equal(etichetta(r.bande, per('Martina').bandaId), 'NON SUFFICIENTE');
  assert.equal(per('Martina').giudizio.testo, '  non   sufficiente ', 'il testo del docente resta com\'è');
  assert.equal(per('Riccardo').bandaId, null, 'nessuna corrispondenza: nessuna banda, nessuna interpretazione del testo');
  assert.equal(etichetta(r.bande, per('Luca').bandaId), 'DISCRETO');

  const profilo = (await alfa.get(`/teachings/${id}/students/${per('Luca').enrollmentId}/progress`)).corpo;
  assert.equal(etichetta(profilo.bande, profilo.valutazioni[0].bandaId), 'DISCRETO');
});

test('E4: nessuna somiglianza parziale (es. "SUFFICIENTE" non abbina "NON SUFFICIENTE", "distinto+" non abbina)', () => {
  const bande = [{ id: 1, etichetta: { testo: 'NON SUFFICIENTE' }, etichettaOrigine: 'NON SUFFICIENTE' }, { id: 2, etichetta: { testo: 'SUFFICIENTE' }, etichettaOrigine: 'SUFFICIENTE' }];
  assert.equal(bandaDelGiudizio('Sufficiente', bande), 2);
  assert.equal(bandaDelGiudizio('distinto+', bande), null);
  assert.equal(bandaDelGiudizio('sufficiente.', bande), null);
  assert.equal(bandaDelGiudizio(null, bande), null);
});

test('E4: compatibilità con l\'etichetta configurata, non con la traduzione di presentazione (indipendente dalla lingua della sessione)', () => {
  const bande = [{ id: 7, etichetta: { testo: 'جيد', lingua: 'ar-XB' }, etichettaOrigine: 'BUONO' }];
  assert.equal(bandaDelGiudizio('buono', bande), 7);
  assert.equal(bandaDelGiudizio('جيد', bande), null, 'la traduzione non diventa una chiave');
});
