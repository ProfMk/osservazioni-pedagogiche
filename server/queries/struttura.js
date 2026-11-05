'use strict';

/**
 * Struttura dell'istituto (iterazione 2A): livelli scolastici e, dentro ogni livello, le
 * classi. Non dipendono dall'anno (decisione 1): l'anno entra con iscrizioni e insegnamenti.
 *
 *   livelli: nuovo (nome, ordine), modifica (rinomina, riordina), disattiva, riattiva,
 *            elimina solo senza dati collegati (altrimenti 409: si disattiva);
 *   classi:  nuova (nome), rinomina, disattiva, riattiva, elimina solo senza dati
 *            collegati. Nessuno «sposta in un altro livello» (decisione 14): con figli lo
 *            vieta la 004, senza figli si ricrea. Nessuna rotta scrive school_level_id.
 *
 * Il nome di un livello è un contenuto traducibile (school_levels.nome): si registra nella
 * colonna originale, cioè nella lingua dei contenuti del tenant (B-1); le traduzioni
 * stanno in content_translations e vanno con il livello quando si elimina. Il nome di una
 * classe è un'identità e non si traduce (V2 §20).
 *
 * Chi chiama apre la transazione; audit nella stessa transazione.
 */
const { nonTrovato, conflitto } = require('../lib/erroreApplicativo');
const { registraAudit } = require('../lib/audit');
const {
  testoObbligatorio, interoFacoltativo, eliminaORifiuta, unicoORifiuta,
} = require('../lib/validazione');

const MAX_NOME_LIVELLO = 100; // school_levels.nome varchar(100)
const MAX_NOME_CLASSE = 50; // classes.nome varchar(50)

const STATO_LIVELLO = Object.freeze({ ATTIVO: 'attivo', DISATTIVATO: 'disattivato' });
const STATO_CLASSE = Object.freeze({ ATTIVA: 'attiva', DISATTIVATA: 'disattivata' });

const chiaveStatoLivello = (stato) => `STATUS_SCHOOL_LEVEL_${String(stato).toUpperCase()}`;
const chiaveStatoClasse = (stato) => `STATUS_CLASS_${String(stato).toUpperCase()}`;

// Righe che impediscono l'eliminazione (FK verso school_levels / classes), tranne le traduzioni.
const LIVELLO_CON_DATI = `(
  EXISTS (SELECT 1 FROM classes WHERE school_level_id = l.id)
  OR EXISTS (SELECT 1 FROM subjects WHERE school_level_id = l.id)
  OR EXISTS (SELECT 1 FROM observation_scales WHERE school_level_id = l.id)
  OR EXISTS (SELECT 1 FROM judgment_bands WHERE school_level_id = l.id)
  OR EXISTS (SELECT 1 FROM role_assignments WHERE scope_school_level_id = l.id)
)`;
const CLASSE_CON_DATI = `(
  EXISTS (SELECT 1 FROM enrollments WHERE class_id = c.id)
  OR EXISTS (SELECT 1 FROM teachings WHERE class_id = c.id)
  OR EXISTS (SELECT 1 FROM role_assignments WHERE scope_class_id = c.id)
)`;

const COLONNE_LIVELLO = `l.id, l.nome, l.ordine, l.stato, ${LIVELLO_CON_DATI} AS con_dati,
  (SELECT count(*)::int FROM classes c WHERE c.school_level_id = l.id AND c.stato = 'attiva') AS classi_attive`;
const COLONNE_CLASSE = `c.id, c.nome, c.stato, c.school_level_id, ${CLASSE_CON_DATI} AS con_dati`;

function azioniLivello(r) {
  return [r.stato === STATO_LIVELLO.ATTIVO ? 'disattiva' : 'riattiva'].concat(r.con_dati ? [] : ['elimina']);
}

function livelloPubblico(r, tr) {
  return {
    id: r.id,
    nome: tr.testo('school_levels.nome', r.id, r.nome),
    ordine: r.ordine,
    stato: r.stato,
    classiAttive: r.classi_attive,
    azioni: azioniLivello(r),
  };
}

function classePubblica(r, livello) {
  const azioni = r.stato === STATO_CLASSE.ATTIVA ? ['disattiva'] : (livello.stato === STATO_LIVELLO.ATTIVO ? ['riattiva'] : []);
  return { id: r.id, nome: r.nome, stato: r.stato, azioni: azioni.concat(r.con_dati ? [] : ['elimina']) };
}

const datiLivelloAudit = (r) => ({ nome: r.nome, ordine: r.ordine, stato: r.stato });
const datiClasseAudit = (r) => ({ nome: r.nome, stato: r.stato, schoolLevelId: r.school_level_id });

async function audit(client, ctx, azione, risorsa, risorsaId, prima, dopo) {
  await registraAudit(client, {
    tenantId: ctx.tenantId, actorAccountId: ctx.accountId, azione, risorsa, risorsaId, prima, dopo,
  });
}

// --- Livelli ---------------------------------------------------------------------------

/** Tutti i livelli, anche disattivati, nell'ordine configurato (L-6: mai sul testo tradotto). */
async function elencoLivelli(client, ctx, tr) {
  const { rows } = await client.query(
    `SELECT ${COLONNE_LIVELLO} FROM school_levels l WHERE l.tenant_id = $1 ORDER BY l.ordine, l.id`, [ctx.tenantId]
  );
  return rows.map((r) => livelloPubblico(r, tr));
}

async function livelloDelTenant(client, ctx, livelloId, { blocca = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${COLONNE_LIVELLO} FROM school_levels l WHERE l.id = $1 AND l.tenant_id = $2${blocca ? ' FOR UPDATE OF l' : ''}`,
    [livelloId, ctx.tenantId]
  );
  if (rows.length === 0) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_SCHOOL_LEVEL' });
  return rows[0];
}

const nomeLivelloOccupato = (nome) => () => conflitto('ERR_SCHOOL_LEVEL_NAME_TAKEN', { nome, campo: 'UI_FIELD_NOME' });

async function nomeLivelloLibero(client, ctx, nome, escludiId = null) {
  const { rows } = await client.query(
    'SELECT 1 FROM school_levels WHERE tenant_id = $1 AND nome = $2 AND ($3::bigint IS NULL OR id <> $3)', [ctx.tenantId, nome, escludiId]
  );
  if (rows.length > 0) throw nomeLivelloOccupato(nome)();
}

/** Nuovo livello: nome obbligatorio e unico nel tenant; ordine facoltativo (in coda, deciso dal server). */
async function creaLivello(client, ctx, corpo, tr) {
  const nome = testoObbligatorio(corpo.nome, 'UI_FIELD_NOME', MAX_NOME_LIVELLO);
  const { rows: [ultimo] } = await client.query('SELECT COALESCE(max(ordine), 0) + 1 AS prossimo FROM school_levels WHERE tenant_id = $1', [ctx.tenantId]);
  const ordine = interoFacoltativo(corpo.ordine, 'UI_FIELD_ORDINE', ultimo.prossimo);
  await nomeLivelloLibero(client, ctx, nome);
  const { rows } = await unicoORifiuta(() => client.query(
    'INSERT INTO school_levels (tenant_id, nome, ordine) VALUES ($1, $2, $3) RETURNING id', [ctx.tenantId, nome, ordine]
  ), { school_levels_tenant_id_nome_key: nomeLivelloOccupato(nome) });
  const livello = await livelloDelTenant(client, ctx, rows[0].id);
  await audit(client, ctx, 'school_level.create', 'school_level', livello.id, null, datiLivelloAudit(livello));
  return livelloPubblico(livello, tr);
}

/** Rinomina e/o riordina (campi assenti: invariati). */
async function modificaLivello(client, ctx, livelloId, corpo, tr) {
  const prima = await livelloDelTenant(client, ctx, livelloId, { blocca: true });
  const nome = corpo.nome === undefined ? prima.nome : testoObbligatorio(corpo.nome, 'UI_FIELD_NOME', MAX_NOME_LIVELLO);
  const ordine = interoFacoltativo(corpo.ordine, 'UI_FIELD_ORDINE', prima.ordine);
  await nomeLivelloLibero(client, ctx, nome, prima.id);
  await unicoORifiuta(() => client.query('UPDATE school_levels SET nome = $1, ordine = $2 WHERE id = $3', [nome, ordine, prima.id]),
    { school_levels_tenant_id_nome_key: nomeLivelloOccupato(nome) });
  const dopo = await livelloDelTenant(client, ctx, prima.id);
  await audit(client, ctx, 'school_level.update', 'school_level', prima.id, datiLivelloAudit(prima), datiLivelloAudit(dopo));
  return livelloPubblico(dopo, tr);
}

async function cambiaStatoLivello(client, ctx, livelloId, stato, azione, tr) {
  const prima = await livelloDelTenant(client, ctx, livelloId, { blocca: true });
  if (prima.stato === stato) throw conflitto('ERR_STATE_UNCHANGED', { stato: chiaveStatoLivello(stato) });
  await client.query('UPDATE school_levels SET stato = $1 WHERE id = $2', [stato, prima.id]);
  const dopo = await livelloDelTenant(client, ctx, prima.id);
  await audit(client, ctx, azione, 'school_level', prima.id, { stato: prima.stato }, { stato });
  return livelloPubblico(dopo, tr);
}

const disattivaLivello = (client, ctx, id, tr) => cambiaStatoLivello(client, ctx, id, STATO_LIVELLO.DISATTIVATO, 'school_level.deactivate', tr);
const riattivaLivello = (client, ctx, id, tr) => cambiaStatoLivello(client, ctx, id, STATO_LIVELLO.ATTIVO, 'school_level.reactivate', tr);

/** Solo senza dati collegati (classi, materie, scale, soglie, ruoli); altrimenti 409 con l'invito a disattivare. */
async function eliminaLivello(client, ctx, livelloId) {
  const livello = await livelloDelTenant(client, ctx, livelloId, { blocca: true });
  const rifiuto = { nome: livello.nome };
  if (livello.con_dati) throw conflitto('ERR_SCHOOL_LEVEL_IN_USE', rifiuto);
  await client.query('DELETE FROM content_translations WHERE school_level_id = $1 AND tenant_id = $2', [livello.id, ctx.tenantId]);
  await eliminaORifiuta(() => client.query('DELETE FROM school_levels WHERE id = $1', [livello.id]), 'ERR_SCHOOL_LEVEL_IN_USE', rifiuto);
  await audit(client, ctx, 'school_level.delete', 'school_level', livello.id, datiLivelloAudit(livello), null);
}

// --- Classi ----------------------------------------------------------------------------

/** Classi di un livello, anche disattivate (classes.nome è un'identità: ordine per nome, come altrove). */
async function elencoClassi(client, ctx, livello) {
  const { rows } = await client.query(
    `SELECT ${COLONNE_CLASSE} FROM classes c WHERE c.school_level_id = $1 AND c.tenant_id = $2 ORDER BY c.nome, c.id`, [livello.id, ctx.tenantId]
  );
  return rows.map((r) => classePubblica(r, livello));
}

/** Classe del tenant (404 altrimenti), con il suo livello (per lo scope del permesso). */
async function classeDelTenant(client, ctx, classeId, { blocca = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${COLONNE_CLASSE} FROM classes c WHERE c.id = $1 AND c.tenant_id = $2${blocca ? ' FOR UPDATE OF c' : ''}`, [classeId, ctx.tenantId]
  );
  if (rows.length === 0) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_CLASS' });
  return rows[0];
}

const nomeClasseOccupato = (nome) => () => conflitto('ERR_CLASS_NAME_TAKEN', { nome, campo: 'UI_FIELD_NOME' });

async function nomeClasseLibero(client, livelloId, nome, escludiId = null) {
  const { rows } = await client.query(
    'SELECT 1 FROM classes WHERE school_level_id = $1 AND nome = $2 AND ($3::bigint IS NULL OR id <> $3)', [livelloId, nome, escludiId]
  );
  if (rows.length > 0) throw nomeClasseOccupato(nome)();
}

function livelloAttivo(livello) {
  if (livello.stato !== STATO_LIVELLO.ATTIVO) throw conflitto('ERR_SCHOOL_LEVEL_DEACTIVATED', { livello: livello.nome });
}

/** Nuova classe in un livello attivo; nome unico nel livello. */
async function creaClasse(client, ctx, livello, corpo) {
  const nome = testoObbligatorio(corpo.nome, 'UI_FIELD_NOME', MAX_NOME_CLASSE);
  livelloAttivo(livello);
  await nomeClasseLibero(client, livello.id, nome);
  const { rows } = await unicoORifiuta(() => client.query(
    'INSERT INTO classes (tenant_id, school_level_id, nome) VALUES ($1, $2, $3) RETURNING id', [ctx.tenantId, livello.id, nome]
  ), { classes_tenant_id_school_level_id_nome_key: nomeClasseOccupato(nome) });
  const classe = await classeDelTenant(client, ctx, rows[0].id);
  await audit(client, ctx, 'class.create', 'class', classe.id, null, datiClasseAudit(classe));
  return classePubblica(classe, livello);
}

/** Rinomina (solo il nome: il livello di una classe non si cambia da qui). */
async function rinominaClasse(client, ctx, classe, livello, corpo) {
  const nome = testoObbligatorio(corpo.nome, 'UI_FIELD_NOME', MAX_NOME_CLASSE);
  await nomeClasseLibero(client, classe.school_level_id, nome, classe.id);
  await unicoORifiuta(() => client.query('UPDATE classes SET nome = $1 WHERE id = $2', [nome, classe.id]),
    { classes_tenant_id_school_level_id_nome_key: nomeClasseOccupato(nome) });
  const dopo = await classeDelTenant(client, ctx, classe.id);
  await audit(client, ctx, 'class.update', 'class', classe.id, datiClasseAudit(classe), datiClasseAudit(dopo));
  return classePubblica(dopo, livello);
}

async function cambiaStatoClasse(client, ctx, classe, livello, stato, azione) {
  if (classe.stato === stato) throw conflitto('ERR_STATE_UNCHANGED', { stato: chiaveStatoClasse(stato) });
  if (stato === STATO_CLASSE.ATTIVA) livelloAttivo(livello);
  await client.query('UPDATE classes SET stato = $1 WHERE id = $2', [stato, classe.id]);
  const dopo = await classeDelTenant(client, ctx, classe.id);
  await audit(client, ctx, azione, 'class', classe.id, { stato: classe.stato }, { stato });
  return classePubblica(dopo, livello);
}

const disattivaClasse = (client, ctx, classe, livello) => cambiaStatoClasse(client, ctx, classe, livello, STATO_CLASSE.DISATTIVATA, 'class.deactivate');
const riattivaClasse = (client, ctx, classe, livello) => cambiaStatoClasse(client, ctx, classe, livello, STATO_CLASSE.ATTIVA, 'class.reactivate');

/** Solo senza iscrizioni, insegnamenti o ruoli sulla classe; altrimenti 409 con l'invito a disattivare. */
async function eliminaClasse(client, ctx, classe) {
  const rifiuto = { nome: classe.nome };
  if (classe.con_dati) throw conflitto('ERR_CLASS_IN_USE', rifiuto);
  await eliminaORifiuta(() => client.query('DELETE FROM classes WHERE id = $1', [classe.id]), 'ERR_CLASS_IN_USE', rifiuto);
  await audit(client, ctx, 'class.delete', 'class', classe.id, datiClasseAudit(classe), null);
}

module.exports = {
  STATO_LIVELLO, STATO_CLASSE, chiaveStatoLivello, chiaveStatoClasse,
  elencoLivelli, livelloDelTenant, creaLivello, modificaLivello, disattivaLivello, riattivaLivello, eliminaLivello,
  elencoClassi, classeDelTenant, creaClasse, rinominaClasse, disattivaClasse, riattivaClasse, eliminaClasse,
};
