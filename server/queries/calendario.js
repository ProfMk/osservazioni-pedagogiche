'use strict';

/**
 * Calendario dell'istituto (iterazione 2A): anni scolastici e periodi di valutazione.
 *
 * Stati di un anno (006): 'in_preparazione' -> 'attivo' -> 'chiuso' (-> 'attivo' con la
 * riapertura). Al più un anno attivo e uno in preparazione per tenant (indici della 006,
 * verificati anche qui per rispondere con un codice preciso). Ogni transizione blocca le
 * righe degli anni del tenant (FOR UPDATE): due transizioni concorrenti si serializzano, e
 * una scrittura dei docenti in corso (FOR SHARE sull'anno) fa attendere la chiusura.
 *
 * Chi chiama apre la transazione e registra l'audit con lo stesso client: le funzioni di
 * scrittura restituiscono { prima, dopo } per l'audit.
 */
const crypto = require('crypto');
const { nonTrovato, conflitto, datiNonValidi } = require('../lib/erroreApplicativo');
const { registraAudit } = require('../lib/audit');
const { ANNO, verificaAnnoScolasticoConfigurabile } = require('./dominio');
const {
  testoObbligatorio, intervalloDate, eliminaORifiuta, unicoORifiuta,
} = require('../lib/validazione');

const MAX_NOME_ANNO = 20; // school_years.nome varchar(20)
const MAX_NOME_PERIODO = 50; // assessment_periods.nome varchar(50)

/** Identificatore di catalogo di uno stato dell'anno (STATUS_SCHOOL_YEAR_*). */
const chiaveStato = (stato) => `STATUS_SCHOOL_YEAR_${String(stato).toUpperCase()}`;

const COLONNE_ANNO = `id, nome, stato, to_char(data_inizio, 'YYYY-MM-DD') AS data_inizio, to_char(data_fine, 'YYYY-MM-DD') AS data_fine,
  EXISTS (SELECT 1 FROM subjects WHERE school_year_id = sy.id)
  OR EXISTS (SELECT 1 FROM enrollments WHERE school_year_id = sy.id)
  OR EXISTS (SELECT 1 FROM assessment_periods WHERE school_year_id = sy.id) AS con_dati`;

function annoPubblico(r) {
  return { id: r.id, nome: r.nome, stato: r.stato, dataInizio: r.data_inizio, dataFine: r.data_fine };
}

async function anniDelTenant(client, tenantId, { blocca = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${COLONNE_ANNO} FROM school_years sy WHERE tenant_id = $1 ORDER BY data_inizio DESC, id DESC${blocca ? ' FOR UPDATE' : ''}`,
    [tenantId]
  );
  return rows;
}

/**
 * Anno di lavoro predefinito (decisione 16): l'attivo, altrimenti quello in preparazione,
 * altrimenti l'ultimo per data. Deciso dal server (R-13).
 */
function annoDiLavoro(anni) {
  const scelto = anni.find((a) => a.stato === ANNO.ATTIVO)
    || anni.find((a) => a.stato === ANNO.IN_PREPARAZIONE)
    || anni[0];
  return scelto ? scelto.id : null;
}

/**
 * Azioni ammesse su ogni anno, decise dal server (il client mostra solo i pulsanti
 * ricevuti): attiva, passa (al nuovo anno: chiude l'attivo e attiva questo), chiudi,
 * riapri, elimina.
 */
function azioniDi(anno, anni) {
  const attivo = anni.find((a) => a.stato === ANNO.ATTIVO);
  switch (anno.stato) {
    case ANNO.IN_PREPARAZIONE:
      return [attivo ? 'passa' : 'attiva'].concat(anno.con_dati ? [] : ['elimina']);
    case ANNO.ATTIVO:
      return ['chiudi'];
    case ANNO.CHIUSO:
      return attivo ? [] : ['riapri'];
    default:
      return [];
  }
}

/** Elenco degli anni del tenant con azioni, anno di lavoro predefinito e passaggio proposto. */
async function elencoAnni(client, tenantId) {
  const anni = await anniDelTenant(client, tenantId);
  const attivo = anni.find((a) => a.stato === ANNO.ATTIVO);
  const nuovo = anni.find((a) => a.stato === ANNO.IN_PREPARAZIONE);
  return {
    anni: anni.map((a) => ({ ...annoPubblico(a), azioni: azioniDi(a, anni) })),
    annoDiLavoro: annoDiLavoro(anni),
    // «Passa al nuovo anno»: l'azione che il calendario propone quando esistono entrambi.
    passaggio: attivo && nuovo ? { daAnno: annoPubblico(attivo), aAnno: annoPubblico(nuovo) } : null,
  };
}

async function annoDelTenant(client, tenantId, annoId, { blocca = false } = {}) {
  const anni = await anniDelTenant(client, tenantId, { blocca });
  const anno = anni.find((a) => a.id === annoId);
  if (!anno) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_SCHOOL_YEAR' });
  return { anno, anni };
}

async function cambiaStato(client, id, stato) {
  await client.query('UPDATE school_years SET stato = $1 WHERE id = $2', [stato, id]);
}

const transizioneNonAmmessa = (anno) => conflitto('ERR_SCHOOL_YEAR_TRANSITION_NOT_ALLOWED', { anno: anno.nome, stato: chiaveStato(anno.stato) });

function nessunAltroAttivo(anni, anno) {
  const attivo = anni.find((a) => a.stato === ANNO.ATTIVO && a.id !== anno.id);
  if (attivo) throw conflitto('ERR_SCHOOL_YEAR_ACTIVE_EXISTS', { anno: attivo.nome });
}

async function audit(client, ctx, azione, annoId, prima, dopo, correlationId = null) {
  await registraAudit(client, {
    tenantId: ctx.tenantId, actorAccountId: ctx.accountId, azione, risorsa: 'school_year', risorsaId: annoId, prima, dopo, correlationId,
  });
}

/**
 * Nuovo anno: nasce SEMPRE 'in_preparazione' (decisione 10). Nome obbligatorio (≤ 20),
 * unico nel tenant; date valide, fine dopo inizio, nessuna sovrapposizione con gli altri
 * anni del tenant; al più un anno in preparazione.
 */
async function creaAnno(client, ctx, corpo) {
  const nome = testoObbligatorio(corpo.nome, 'UI_FIELD_NOME', MAX_NOME_ANNO);
  const { inizio, fine } = intervalloDate(corpo);
  const anni = await anniDelTenant(client, ctx.tenantId, { blocca: true });
  if (anni.some((a) => a.nome === nome)) throw conflitto('ERR_SCHOOL_YEAR_NAME_TAKEN', { nome, campo: 'UI_FIELD_NOME' });
  const sovrapposto = anni.find((a) => inizio <= a.data_fine && fine >= a.data_inizio);
  if (sovrapposto) {
    throw conflitto('ERR_SCHOOL_YEAR_OVERLAP', {
      anno: sovrapposto.nome, inizio: sovrapposto.data_inizio, fine: sovrapposto.data_fine, campo: 'UI_FIELD_DATA_INIZIO',
    });
  }
  const inPreparazione = anni.find((a) => a.stato === ANNO.IN_PREPARAZIONE);
  if (inPreparazione) throw conflitto('ERR_SCHOOL_YEAR_IN_PREPARATION_EXISTS', { anno: inPreparazione.nome });
  const { rows } = await unicoORifiuta(() => client.query(
    `INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine, stato) VALUES ($1, $2, $3, $4, 'in_preparazione')
     RETURNING id, nome, stato, to_char(data_inizio, 'YYYY-MM-DD') AS data_inizio, to_char(data_fine, 'YYYY-MM-DD') AS data_fine`,
    [ctx.tenantId, nome, inizio, fine]
  ), {
    school_years_tenant_id_nome_key: () => conflitto('ERR_SCHOOL_YEAR_NAME_TAKEN', { nome, campo: 'UI_FIELD_NOME' }),
    uq_school_years_una_preparazione: () => conflitto('ERR_SCHOOL_YEAR_IN_PREPARATION_EXISTS', { anno: nome }),
  });
  const anno = annoPubblico(rows[0]);
  await audit(client, ctx, 'school_year.create', anno.id, null, anno);
  return anno;
}

/** in_preparazione -> attivo, solo se non c'è un altro anno attivo. */
async function attivaAnno(client, ctx, annoId) {
  const { anno, anni } = await annoDelTenant(client, ctx.tenantId, annoId, { blocca: true });
  if (anno.stato !== ANNO.IN_PREPARAZIONE) throw transizioneNonAmmessa(anno);
  nessunAltroAttivo(anni, anno);
  await cambiaStato(client, anno.id, ANNO.ATTIVO);
  await audit(client, ctx, 'school_year.activate', anno.id, { stato: anno.stato }, { stato: ANNO.ATTIVO });
  return { ...annoPubblico(anno), stato: ANNO.ATTIVO };
}

/** attivo -> chiuso. */
async function chiudiAnno(client, ctx, annoId) {
  const { anno } = await annoDelTenant(client, ctx.tenantId, annoId, { blocca: true });
  if (anno.stato !== ANNO.ATTIVO) throw transizioneNonAmmessa(anno);
  await cambiaStato(client, anno.id, ANNO.CHIUSO);
  await audit(client, ctx, 'school_year.close', anno.id, { stato: anno.stato }, { stato: ANNO.CHIUSO });
  return { ...annoPubblico(anno), stato: ANNO.CHIUSO };
}

/** chiuso -> attivo, solo se non c'è un altro anno attivo (altrimenti 409 ERR_SCHOOL_YEAR_ACTIVE_EXISTS). */
async function riapriAnno(client, ctx, annoId) {
  const { anno, anni } = await annoDelTenant(client, ctx.tenantId, annoId, { blocca: true });
  if (anno.stato !== ANNO.CHIUSO) throw transizioneNonAmmessa(anno);
  nessunAltroAttivo(anni, anno);
  await cambiaStato(client, anno.id, ANNO.ATTIVO);
  await audit(client, ctx, 'school_year.reopen', anno.id, { stato: anno.stato }, { stato: ANNO.ATTIVO });
  return { ...annoPubblico(anno), stato: ANNO.ATTIVO };
}

/**
 * «Passa al nuovo anno»: una sola azione atomica (la transazione del chiamante) che chiude
 * l'anno attivo e attiva quello in preparazione indicato. Prima la chiusura, poi
 * l'attivazione (l'indice della 006 non ammette due anni attivi nemmeno per un istante).
 * Due righe d'audit 'school_year.switch', una per anno, con lo stesso correlation_id.
 */
async function passaAlNuovoAnno(client, ctx, annoId) {
  const { anno, anni } = await annoDelTenant(client, ctx.tenantId, annoId, { blocca: true });
  if (anno.stato !== ANNO.IN_PREPARAZIONE) throw transizioneNonAmmessa(anno);
  const attivo = anni.find((a) => a.stato === ANNO.ATTIVO);
  if (!attivo) throw conflitto('ERR_SCHOOL_YEAR_NO_ACTIVE', { anno: anno.nome });
  const correlazione = `school_year.switch:${crypto.randomUUID()}`;
  await cambiaStato(client, attivo.id, ANNO.CHIUSO);
  await cambiaStato(client, anno.id, ANNO.ATTIVO);
  await audit(client, ctx, 'school_year.switch', attivo.id, { stato: ANNO.ATTIVO }, { stato: ANNO.CHIUSO, nuovoAnnoId: anno.id }, correlazione);
  await audit(client, ctx, 'school_year.switch', anno.id, { stato: ANNO.IN_PREPARAZIONE }, { stato: ANNO.ATTIVO, annoChiusoId: attivo.id }, correlazione);
  return { chiuso: { ...annoPubblico(attivo), stato: ANNO.CHIUSO }, attivato: { ...annoPubblico(anno), stato: ANNO.ATTIVO } };
}

/** Solo un anno in preparazione senza alcun dato collegato (FK RESTRICT), altrimenti 409. */
async function eliminaAnno(client, ctx, annoId) {
  const { anno } = await annoDelTenant(client, ctx.tenantId, annoId, { blocca: true });
  if (anno.stato !== ANNO.IN_PREPARAZIONE) throw conflitto('ERR_SCHOOL_YEAR_NOT_DELETABLE', { anno: anno.nome, stato: chiaveStato(anno.stato) });
  if (anno.con_dati) throw conflitto('ERR_SCHOOL_YEAR_IN_USE', { anno: anno.nome });
  await eliminaORifiuta(() => client.query('DELETE FROM school_years WHERE id = $1', [anno.id]), 'ERR_SCHOOL_YEAR_IN_USE', { anno: anno.nome });
  await audit(client, ctx, 'school_year.delete', anno.id, annoPubblico(anno), null);
}

// --- Periodi di valutazione ----------------------------------------------------------

function periodoPubblico(r, tr) {
  return {
    id: r.id,
    nome: tr.testo('assessment_periods.nome', r.id, r.nome),
    dataInizio: r.data_inizio,
    dataFine: r.data_fine,
    eliminabile: !r.con_giudizi,
  };
}

const COLONNE_PERIODO = `p.id, p.nome, p.school_year_id, to_char(p.data_inizio, 'YYYY-MM-DD') AS data_inizio, to_char(p.data_fine, 'YYYY-MM-DD') AS data_fine,
  EXISTS (SELECT 1 FROM assessments a WHERE a.assessment_period_id = p.id) AS con_giudizi`;

/** Periodi di un anno, in ordine di data; `modificabile`: l'anno accetta scritture di configurazione. */
async function elencoPeriodi(client, ctx, annoId, tr) {
  const { anno } = await annoDelTenant(client, ctx.tenantId, annoId);
  const { rows } = await client.query(
    `SELECT ${COLONNE_PERIODO} FROM assessment_periods p WHERE p.school_year_id = $1 AND p.tenant_id = $2 ORDER BY p.data_inizio, p.data_fine, p.id`,
    [anno.id, ctx.tenantId]
  );
  return {
    anno: annoPubblico(anno),
    modificabile: [ANNO.ATTIVO, ANNO.IN_PREPARAZIONE].includes(anno.stato),
    periodi: rows.map((r) => periodoPubblico(r, tr)),
  };
}

/** Periodo del tenant (404 altrimenti) con l'anno bloccato in lettura e verificato configurabile. */
async function periodoConfigurabile(client, ctx, periodoId) {
  const { rows } = await client.query(
    `SELECT ${COLONNE_PERIODO} FROM assessment_periods p WHERE p.id = $1 AND p.tenant_id = $2`, [periodoId, ctx.tenantId]
  );
  if (rows.length === 0) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_ASSESSMENT_PERIOD' });
  const anno = await verificaAnnoScolasticoConfigurabile(client, rows[0].school_year_id, ctx.tenantId);
  return { periodo: rows[0], anno };
}

/** Periodo libero (decisione 6): l'unica regola è stare dentro le date dell'anno; sovrapposizioni ammesse. */
function validaPeriodo(corpo, anno) {
  const nome = testoObbligatorio(corpo.nome, 'UI_FIELD_NOME', MAX_NOME_PERIODO);
  const { inizio, fine } = intervalloDate(corpo);
  if (inizio < anno.data_inizio || fine > anno.data_fine) {
    throw datiNonValidi('ERR_PERIOD_OUTSIDE_YEAR', {
      anno: anno.nome, inizio: anno.data_inizio, fine: anno.data_fine, campo: inizio < anno.data_inizio ? 'UI_FIELD_DATA_INIZIO' : 'UI_FIELD_DATA_FINE',
    });
  }
  return { nome, inizio, fine };
}

const nomePeriodoOccupato = (nome) => () => conflitto('ERR_PERIOD_NAME_TAKEN', { nome, campo: 'UI_FIELD_NOME' });

async function nomePeriodoLibero(client, annoId, nome, escludiId = null) {
  const { rows } = await client.query(
    'SELECT 1 FROM assessment_periods WHERE school_year_id = $1 AND nome = $2 AND ($3::bigint IS NULL OR id <> $3)', [annoId, nome, escludiId]
  );
  if (rows.length > 0) throw nomePeriodoOccupato(nome)();
}

const datiPeriodoAudit = (p) => ({ nome: p.nome, dataInizio: p.data_inizio, dataFine: p.data_fine, schoolYearId: p.school_year_id });

/**
 * Nuovo periodo su un anno attivo o in preparazione. Il nome è il testo nella lingua dei
 * contenuti del tenant (colonna originale, come gli altri nomi traducibili: B-1).
 */
async function creaPeriodo(client, ctx, annoId, corpo, tr) {
  await annoDelTenant(client, ctx.tenantId, annoId); // 404 prima del 409
  const anno = await verificaAnnoScolasticoConfigurabile(client, annoId, ctx.tenantId);
  const { nome, inizio, fine } = validaPeriodo(corpo, anno);
  await nomePeriodoLibero(client, anno.id, nome);
  const { rows } = await unicoORifiuta(() => client.query(
    `INSERT INTO assessment_periods (tenant_id, school_year_id, nome, data_inizio, data_fine) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, nome, school_year_id, to_char(data_inizio, 'YYYY-MM-DD') AS data_inizio, to_char(data_fine, 'YYYY-MM-DD') AS data_fine, false AS con_giudizi`,
    [ctx.tenantId, anno.id, nome, inizio, fine]
  ), { assessment_periods_tenant_id_school_year_id_nome_key: nomePeriodoOccupato(nome) });
  await registraAudit(client, {
    tenantId: ctx.tenantId, actorAccountId: ctx.accountId, azione: 'assessment_period.create', risorsa: 'assessment_period', risorsaId: rows[0].id, dopo: datiPeriodoAudit(rows[0]),
  });
  return periodoPubblico(rows[0], tr);
}

/** Modifica nome e date (l'anno di un periodo non cambia mai: Regola 1 della 004). */
async function modificaPeriodo(client, ctx, periodoId, corpo, tr) {
  const { periodo, anno } = await periodoConfigurabile(client, ctx, periodoId);
  const { nome, inizio, fine } = validaPeriodo(corpo, anno);
  await nomePeriodoLibero(client, anno.id, nome, periodo.id);
  const { rows } = await unicoORifiuta(() => client.query(
    `UPDATE assessment_periods SET nome = $1, data_inizio = $2, data_fine = $3 WHERE id = $4
     RETURNING id, nome, school_year_id, to_char(data_inizio, 'YYYY-MM-DD') AS data_inizio, to_char(data_fine, 'YYYY-MM-DD') AS data_fine`,
    [nome, inizio, fine, periodo.id]
  ), { assessment_periods_tenant_id_school_year_id_nome_key: nomePeriodoOccupato(nome) });
  await registraAudit(client, {
    tenantId: ctx.tenantId, actorAccountId: ctx.accountId, azione: 'assessment_period.update', risorsa: 'assessment_period', risorsaId: periodo.id,
    prima: datiPeriodoAudit(periodo), dopo: datiPeriodoAudit(rows[0]),
  });
  return periodoPubblico({ ...rows[0], con_giudizi: periodo.con_giudizi }, tr);
}

/** Si elimina solo un periodo senza giudizi (409 altrimenti); le sue traduzioni vanno con lui. */
async function eliminaPeriodo(client, ctx, periodoId) {
  const { periodo } = await periodoConfigurabile(client, ctx, periodoId);
  if (periodo.con_giudizi) throw conflitto('ERR_PERIOD_IN_USE', { nome: periodo.nome });
  await client.query('DELETE FROM content_translations WHERE assessment_period_id = $1 AND tenant_id = $2', [periodo.id, ctx.tenantId]);
  await eliminaORifiuta(() => client.query('DELETE FROM assessment_periods WHERE id = $1', [periodo.id]), 'ERR_PERIOD_IN_USE', { nome: periodo.nome });
  await registraAudit(client, {
    tenantId: ctx.tenantId, actorAccountId: ctx.accountId, azione: 'assessment_period.delete', risorsa: 'assessment_period', risorsaId: periodo.id,
    prima: datiPeriodoAudit(periodo),
  });
}

module.exports = {
  chiaveStato, annoDiLavoro, anniDelTenant, annoPubblico, elencoAnni, creaAnno, attivaAnno, chiudiAnno, riapriAnno,
  passaAlNuovoAnno, eliminaAnno, elencoPeriodi, creaPeriodo, modificaPeriodo, eliminaPeriodo,
};
