'use strict';

/**
 * Quadro dell'istituto (iterazione 2A, decisione 17): pagina iniziale dell'amministrazione.
 * Tutto calcolato dal server per l'anno scelto (R-13); il client mostra solo testi del
 * catalogo con i parametri ricevuti. Nessun pannello numerico (R-4): una lista di cose da
 * fare e un riepilogo per livello da mostrare come testo o tabella semplice.
 *
 * Cose da fare, nell'ordine in cui si sistemano. Ognuna ha un codice (identificatore di
 * catalogo), i suoi parametri e, se la sezione esiste già, il collegamento dove si sistema:
 *   UI_TODO_NO_ACTIVE_YEAR              nessun anno attivo                     -> calendario
 *   UI_TODO_YEAR_WITHOUT_PERIODS        l'anno scelto non ha periodi           -> calendario dell'anno
 *   UI_TODO_NO_LEVELS                   nessun livello attivo                  -> livelli
 *   UI_TODO_LEVEL_WITHOUT_CLASSES       livello attivo senza classi attive     -> classi del livello
 *   UI_TODO_CLASS_WITHOUT_STUDENTS      classe attiva senza alunni nell'anno   -> (Persone: passo futuro)
 *   UI_TODO_CLASS_WITHOUT_TEACHINGS     classe attiva senza insegnamenti       -> (Insegnamenti: passo futuro)
 *   UI_TODO_ACCOUNT_TEMPORARY_PASSWORD  account che non ha ancora cambiato     -> (Persone: passo futuro)
 *                                       la password temporanea
 */
const { nonTrovato } = require('../lib/erroreApplicativo');
const { ANNO } = require('./dominio');
const { anniDelTenant, annoDiLavoro, annoPubblico } = require('./calendario');

const TODO = Object.freeze({
  NESSUN_ANNO_ATTIVO: 'UI_TODO_NO_ACTIVE_YEAR',
  ANNO_SENZA_PERIODI: 'UI_TODO_YEAR_WITHOUT_PERIODS',
  NESSUN_LIVELLO: 'UI_TODO_NO_LEVELS',
  LIVELLO_SENZA_CLASSI: 'UI_TODO_LEVEL_WITHOUT_CLASSES',
  CLASSE_SENZA_ALUNNI: 'UI_TODO_CLASS_WITHOUT_STUDENTS',
  CLASSE_SENZA_INSEGNAMENTI: 'UI_TODO_CLASS_WITHOUT_TEACHINGS',
  PASSWORD_TEMPORANEA: 'UI_TODO_ACCOUNT_TEMPORARY_PASSWORD',
});

const voce = (codice, parametri, collegamento = null) => ({ codice, parametri, collegamento });

/**
 * Quadro per l'anno `annoId` (assente: l'anno di lavoro predefinito). Anno di un altro
 * tenant -> 404. Senza alcun anno: anno null, e le voci legate all'anno non compaiono
 * (resta «nessun anno attivo»).
 */
async function quadroIstituto(client, { tenantId, annoId, tr }) {
  const anni = await anniDelTenant(client, tenantId);
  const sceltoId = annoId === undefined ? annoDiLavoro(anni) : annoId;
  const anno = sceltoId === null ? null : anni.find((a) => a.id === sceltoId);
  if (sceltoId !== null && !anno) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_SCHOOL_YEAR' });
  const annoSql = anno ? anno.id : null;

  const { rows: livelli } = await client.query(
    `SELECT l.id, l.nome, l.stato,
            (SELECT count(*)::int FROM classes c WHERE c.school_level_id = l.id AND c.stato = 'attiva') AS classi,
            (SELECT count(DISTINCT e.student_person_id)::int FROM enrollments e JOIN classes c ON c.id = e.class_id
              WHERE c.school_level_id = l.id AND e.attiva AND e.school_year_id = $2) AS alunni,
            (SELECT count(DISTINCT t.account_id)::int FROM teachings t JOIN classes c ON c.id = t.class_id
              WHERE c.school_level_id = l.id AND t.stato = 'attivo' AND t.school_year_id = $2) AS docenti,
            (SELECT count(*)::int FROM teachings t JOIN classes c ON c.id = t.class_id
              WHERE c.school_level_id = l.id AND t.stato = 'attivo' AND t.school_year_id = $2) AS insegnamenti
     FROM school_levels l WHERE l.tenant_id = $1 ORDER BY l.ordine, l.id`,
    [tenantId, annoSql]
  );
  const nomeLivello = (l) => tr.testo('school_levels.nome', l.id, l.nome);
  const attivi = livelli.filter((l) => l.stato === 'attivo');

  const daFare = [];
  if (!anni.some((a) => a.stato === ANNO.ATTIVO)) daFare.push(voce(TODO.NESSUN_ANNO_ATTIVO, {}, { sezione: 'calendario' }));
  if (anno) {
    const { rows: [periodi] } = await client.query('SELECT count(*)::int AS n FROM assessment_periods WHERE school_year_id = $1', [anno.id]);
    if (periodi.n === 0) daFare.push(voce(TODO.ANNO_SENZA_PERIODI, { anno: anno.nome }, { sezione: 'calendario', annoId: anno.id }));
  }
  if (attivi.length === 0) daFare.push(voce(TODO.NESSUN_LIVELLO, {}, { sezione: 'livelli' }));
  attivi.filter((l) => l.classi === 0).forEach((l) => {
    daFare.push(voce(TODO.LIVELLO_SENZA_CLASSI, { livello: nomeLivello(l) }, { sezione: 'classi', livelloId: l.id }));
  });

  if (anno) {
    const { rows: classi } = await client.query(
      `SELECT c.id, c.nome, l.id AS livello_id, l.nome AS livello_nome,
              EXISTS (SELECT 1 FROM enrollments e WHERE e.class_id = c.id AND e.school_year_id = $2 AND e.attiva) AS con_alunni,
              EXISTS (SELECT 1 FROM teachings t WHERE t.class_id = c.id AND t.school_year_id = $2 AND t.stato = 'attivo') AS con_insegnamenti
       FROM classes c JOIN school_levels l ON l.id = c.school_level_id
       WHERE c.tenant_id = $1 AND c.stato = 'attiva' AND l.stato = 'attivo'
       ORDER BY l.ordine, l.id, c.nome, c.id`,
      [tenantId, anno.id]
    );
    const parametri = (c) => ({ classe: c.nome, livello: tr.testo('school_levels.nome', c.livello_id, c.livello_nome), anno: anno.nome });
    classi.filter((c) => !c.con_alunni).forEach((c) => daFare.push(voce(TODO.CLASSE_SENZA_ALUNNI, parametri(c))));
    classi.filter((c) => !c.con_insegnamenti).forEach((c) => daFare.push(voce(TODO.CLASSE_SENZA_INSEGNAMENTI, parametri(c))));
  }

  const { rows: temporanee } = await client.query(
    `SELECT a.email, p.nome, p.cognome
     FROM accounts a JOIN people p ON p.id = a.person_id
     JOIN memberships m ON m.account_id = a.id AND m.tenant_id = $1 AND m.stato = 'attiva'
     WHERE a.deve_cambiare_password AND a.stato = 'attivo'
     ORDER BY p.cognome, p.nome, a.id`,
    [tenantId]
  );
  temporanee.forEach((a) => daFare.push(voce(TODO.PASSWORD_TEMPORANEA, { persona: `${a.nome} ${a.cognome}`, email: a.email })));

  return {
    anno: anno ? annoPubblico(anno) : null,
    daFare,
    riepilogo: livelli.map((l) => ({
      livello: { id: l.id, nome: nomeLivello(l), stato: l.stato },
      classi: l.classi,
      alunni: l.alunni,
      docenti: l.docenti,
      insegnamenti: l.insegnamenti,
    })),
  };
}

module.exports = { TODO, quadroIstituto };
