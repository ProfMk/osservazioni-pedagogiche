'use strict';

/**
 * Report pedagogici (specifica v2.7) — lettura dati. Questo modulo recupera
 * e normalizza i dati del Teaching e li passa al motore puro
 * server/lib/calcoloProgresso.js: NESSUNA formula pedagogica vive qui.
 *
 * Perimetro: un Teaching del tenant indicato (sempre quello della sessione,
 * mai un valore ricevuto dal client). Si leggono solo le osservazioni sulle
 * attività di QUEL Teaching: nessuna unione con altri Teaching della stessa
 * materia/classe (co-docenza: ciascun docente vede il proprio).
 */

const { nonTrovato } = require('../lib/erroreApplicativo');
const { getScalaApplicabile, getBandeGiudizio } = require('./configurazione');
const { verificaTeachingNelTenant } = require('./dominio');
const { FINESTRA_MEDIA_MOBILE } = require('../lib/calcoloEsiti');
const motore = require('../lib/calcoloProgresso');

// Stati che partecipano ai calcoli: i soli valori "attivi" ammessi dai CHECK dello schema.
const ATTIVITA_ATTIVA = 'attiva';
const NUCLEO_ATTIVO = 'attiva';
const CRITERIO_ATTIVO = 'attivo';

const MOTIVO_ATTIVITA_DISATTIVATA = 'attivita_disattivata';
const MOTIVO_SCALA_NON_COMPATIBILE = 'scala_non_compatibile';
const MOTIVO_CRITERIO_NON_ATTIVO = 'criterio_non_attivo';

/** Teaching verificato nel tenant, con scala e bande applicabili (tenant + eventuale override di livello). */
async function caricaContestoTeaching(client, teachingId, tenantId) {
  const teaching = await verificaTeachingNelTenant(client, teachingId, tenantId);
  const { rows: anni } = await client.query(
    'SELECT nome FROM school_years WHERE id = $1 AND tenant_id = $2', [teaching.school_year_id, tenantId]
  );
  const scala = await getScalaApplicabile(client, { tenantId, schoolLevelId: teaching.school_level_id });
  const bande = motore.preparaBande(await getBandeGiudizio(client, { tenantId, schoolLevelId: teaching.school_level_id }));
  return { teaching, annoScolastico: anni[0] ? anni[0].nome : null, scala, bande };
}

/**
 * Struttura pedagogica corrente della materia: nuclei attivi nell'ordine configurato, ciascuno
 * con i propri criteri attivi. Un nucleo senza criteri resta nell'elenco con criteri = [].
 */
async function caricaStruttura(client, { subjectId, tenantId }) {
  const { rows } = await client.query(
    `SELECT pu.id AS unit_id, pu.nome AS unit_nome, pu.ordine AS unit_ordine,
            c.id AS criterion_id, c.codice, c.descrizione, c.ordine
     FROM pedagogical_units pu
     LEFT JOIN criteria c ON c.pedagogical_unit_id = pu.id AND c.tenant_id = pu.tenant_id AND c.stato = $3
     WHERE pu.subject_id = $1 AND pu.tenant_id = $2 AND pu.stato = $4
     ORDER BY pu.ordine, pu.nome, pu.id, c.ordine, c.id`,
    [subjectId, tenantId, CRITERIO_ATTIVO, NUCLEO_ATTIVO]
  );
  const nuclei = new Map();
  rows.forEach((r) => {
    if (!nuclei.has(r.unit_id)) nuclei.set(r.unit_id, { id: r.unit_id, nome: r.unit_nome, ordine: r.unit_ordine, criteri: [] });
    if (r.criterion_id !== null) {
      nuclei.get(r.unit_id).criteri.push({ id: r.criterion_id, codice: r.codice, descrizione: r.descrizione, ordine: r.ordine });
    }
  });
  return [...nuclei.values()];
}

/**
 * Tutte le osservazioni di UNO studente sulle attività del Teaching, in ordine cronologico
 * deterministico (data osservazione, data attività, id attività). Nessun filtro sugli stati:
 * lo storico non viene mai nascosto, è chi calcola a decidere cosa conteggiare.
 */
async function caricaOsservazioniStudente(client, { teachingId, enrollmentId, tenantId }) {
  const { rows } = await client.query(
    `SELECT o.id AS observation_id, o.criterion_id, o.valore, o.scale_id,
            to_char(o.data_osservazione, 'YYYY-MM-DD') AS data_osservazione,
            a.id AS activity_id, a.nome AS attivita, a.stato AS attivita_stato,
            c.codice, c.descrizione, c.stato AS criterio_stato,
            pu.nome AS unit_nome, pu.stato AS unit_stato
     FROM observations o
     JOIN activities a ON a.id = o.activity_id AND a.tenant_id = o.tenant_id
     JOIN criteria c ON c.id = o.criterion_id AND c.tenant_id = o.tenant_id
     JOIN pedagogical_units pu ON pu.id = c.pedagogical_unit_id AND pu.tenant_id = o.tenant_id
     WHERE o.tenant_id = $1 AND a.teaching_id = $2 AND o.enrollment_id = $3
     ORDER BY o.data_osservazione, a.data_attivita, a.id, o.id`,
    [tenantId, teachingId, enrollmentId]
  );
  return rows;
}

/** Perché un'osservazione di un criterio attivo NON entra nei calcoli (null = è valida). */
function motivoEsclusione(osservazione, scala) {
  if (osservazione.attivita_stato !== ATTIVITA_ATTIVA) return MOTIVO_ATTIVITA_DISATTIVATA;
  if (String(osservazione.scale_id) !== String(scala.id)) return MOTIVO_SCALA_NON_COMPATIBILE;
  return null;
}

function descriviOsservazione(osservazione, etichette, extra) {
  return {
    observationId: osservazione.observation_id,
    activityId: osservazione.activity_id,
    attivita: osservazione.attivita,
    dataOsservazione: osservazione.data_osservazione,
    valore: osservazione.valore,
    etichetta: etichette.get(osservazione.valore) || null,
    ...extra,
  };
}

/** Campi pubblici del risultato corrente di un criterio (il valore esatto resta interno al calcolo). */
function descriviRisultatoCriterio(r) {
  return {
    media: r.media,
    percentuale: r.percentuale,
    giudizio: r.giudizio,
    livelloGiudizio: r.livelloGiudizio,
    osservazioniConsiderate: r.osservazioniConsiderate,
    osservazioniTotali: r.osservazioniTotali,
    punteggioOttenuto: r.punteggioOttenuto,
    punteggioMassimo: r.punteggioMassimo,
  };
}

function descriviCumulativo(c) {
  return { percentuale: c.percentuale, giudizio: c.giudizio };
}

/** Campi pubblici del risultato corrente di un insieme di criteri (nucleo o intera materia). */
function descriviAggregato(a) {
  return {
    percentuale: a.percentuale,
    giudizio: a.giudizio,
    livelloGiudizio: a.livelloGiudizio,
    criteriConsiderati: a.criteriValutati,
    criteriValutati: a.criteriValutati,
    criteriTotali: a.criteriTotali,
  };
}

/**
 * Avanzamento pedagogico di UNO studente nel contesto di un Teaching: per ogni nucleo e criterio
 * attivo, storico completo delle osservazioni, risultato corrente (media mobile delle ultime 3
 * osservazioni valide), cumulativo da inizio anno e livello di copertura; poi nucleo e complessivo.
 *
 * L'iscrizione è verificata lato server nella classe/anno/tenant del Teaching: l'enrollmentId
 * ricevuto dal client non determina mai da solo cosa si legge.
 *
 * Non conteggiate (ma sempre restituite nello storico, con il motivo): osservazioni di attività
 * non attive e osservazioni registrate con una scala diversa da quella applicabile. Le osservazioni
 * di criteri/nuclei non più attivi sono elencate a parte in `criteriNonPiuAttivi`, senza risultato.
 *
 * Distinto dal Report classe della singola attività, che NON usa la media mobile.
 */
async function getProgressoStudenteDiTeaching(client, { teachingId, enrollmentId, tenantId }) {
  const { teaching, annoScolastico, scala, bande } = await caricaContestoTeaching(client, teachingId, tenantId);

  const { rows: iscritti } = await client.query(
    `SELECT e.id AS enrollment_id, e.student_person_id, p.nome, p.cognome
     FROM enrollments e JOIN people p ON p.id = e.student_person_id AND p.tenant_id = e.tenant_id
     WHERE e.id = $1 AND e.tenant_id = $2 AND e.class_id = $3 AND e.school_year_id = $4 AND e.attiva`,
    [enrollmentId, tenantId, teaching.class_id, teaching.school_year_id]
  );
  if (iscritti.length === 0) throw nonTrovato('Studente non trovato tra gli iscritti attivi della classe di questo Teaching.');
  const alunno = iscritti[0];

  const struttura = await caricaStruttura(client, { subjectId: teaching.subject_id, tenantId });
  const osservazioni = await caricaOsservazioniStudente(client, { teachingId, enrollmentId, tenantId });
  const etichette = new Map(scala.valori.map((v) => [v.valore, v.etichetta]));

  const criteriAttivi = new Set(struttura.flatMap((n) => n.criteri.map((c) => String(c.id))));
  const perCriterioAttivo = new Map();
  const nonPiuAttivi = new Map();
  osservazioni.forEach((o) => {
    const chiave = String(o.criterion_id);
    if (criteriAttivi.has(chiave)) {
      if (!perCriterioAttivo.has(chiave)) perCriterioAttivo.set(chiave, []);
      perCriterioAttivo.get(chiave).push(o);
      return;
    }
    if (!nonPiuAttivi.has(chiave)) {
      nonPiuAttivi.set(chiave, { id: o.criterion_id, codice: o.codice, descrizione: o.descrizione, nucleo: o.unit_nome, osservazioni: [] });
    }
    nonPiuAttivi.get(chiave).osservazioni.push(descriviOsservazione(o, etichette, {
      inRisultatoCorrente: false, conteggiata: false, motivoEsclusione: MOTIVO_CRITERIO_NON_ATTIVO,
    }));
  });

  const nucleiCalcolati = struttura.map((nucleo) => {
    const criteri = nucleo.criteri.map((criterio) => {
      const storico = (perCriterioAttivo.get(String(criterio.id)) || []).map((o) => ({ ...o, motivo: motivoEsclusione(o, scala) }));
      const valide = storico.filter((o) => o.motivo === null);
      const risultato = motore.risultatoCriterioStudente(valide.map((o) => o.valore), scala, bande);
      const nellaFinestra = new Set(valide.slice(-FINESTRA_MEDIA_MOBILE).map((o) => o.observation_id));
      return { criterio, storico, risultato, nellaFinestra };
    });
    return { nucleo, criteri, aggregato: motore.aggregaCriteriStudente(criteri.map((c) => c.risultato), scala, bande) };
  });
  const complessivo = motore.aggregaCriteriStudente(
    nucleiCalcolati.flatMap((n) => n.criteri.map((c) => c.risultato)), scala, bande
  );

  return {
    teaching: { id: teaching.id, materia: teaching.materia, classe: teaching.classe, annoScolastico },
    alunno: { enrollmentId: alunno.enrollment_id, studentPersonId: alunno.student_person_id, cognome: alunno.cognome, nome: alunno.nome },
    scala: {
      id: scala.id, nome: scala.nome, valori: scala.valori, valoreMinimo: scala.valoreMinimo, valoreMassimo: scala.valoreMassimo,
    },
    bande: motore.bandeConPosizioneRadar(bande, scala),
    regola: { tipo: 'media_mobile', finestra: FINESTRA_MEDIA_MOBILE },
    complessivo: {
      ...descriviAggregato(complessivo),
      cumulativo: descriviCumulativo(complessivo.cumulativo),
      copertura: complessivo.copertura,
    },
    nuclei: nucleiCalcolati.map(({ nucleo, criteri, aggregato }) => ({
      id: nucleo.id,
      nome: nucleo.nome,
      ordine: nucleo.ordine,
      grigliaNonConfigurata: nucleo.criteri.length === 0,
      risultatoCorrente: descriviAggregato(aggregato),
      cumulativo: descriviCumulativo(aggregato.cumulativo),
      copertura: aggregato.copertura,
      confrontoConComplessivo: motore.confrontoConComplessivo(aggregato.livelloGiudizio, complessivo.livelloGiudizio),
      radar: { posizioneRadar: aggregato.posizioneRadar, puntoPieno: aggregato.puntoPieno },
      criteri: criteri.map(({ criterio, storico, risultato, nellaFinestra }) => ({
        id: criterio.id,
        codice: criterio.codice,
        descrizione: criterio.descrizione,
        ordine: criterio.ordine,
        risultatoCorrente: descriviRisultatoCriterio(risultato),
        cumulativo: {
          ...descriviCumulativo(risultato.cumulativo),
          punteggioOttenuto: risultato.cumulativo.punteggioOttenuto,
          punteggioMassimo: risultato.cumulativo.punteggioMassimo,
        },
        livelloCopertura: risultato.livelloCopertura,
        osservazioni: storico.map((o) => descriviOsservazione(o, etichette, {
          inRisultatoCorrente: nellaFinestra.has(o.observation_id),
          conteggiata: o.motivo === null,
          motivoEsclusione: o.motivo,
        })),
      })),
    })),
    criteriNonPiuAttivi: [...nonPiuAttivi.values()],
  };
}

module.exports = { getProgressoStudenteDiTeaching };
