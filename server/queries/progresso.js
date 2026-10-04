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
// Solo nel report di classe (il report individuale verifica l'iscrizione a monte e conta un nucleo disattivato
// come "criterio non attivo"): il suo contratto resta invariato.
const MOTIVO_NUCLEO_NON_ATTIVO = 'nucleo_non_attivo';
const MOTIVO_ISCRIZIONE_NON_ATTIVA = 'iscrizione_non_attiva';

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
    `SELECT o.id AS observation_id, o.criterion_id, o.valore, o.scale_id, o.note,
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

/**
 * Una riga di storico. Etichetta e percentuale si riferiscono alla scala applicabile: per
 * un'osservazione registrata con un'altra scala restano null (il valore non è interpretabile qui).
 */
function descriviOsservazione(osservazione, scala, etichette, extra) {
  const stessaScala = String(osservazione.scale_id) === String(scala.id);
  return {
    observationId: osservazione.observation_id,
    activityId: osservazione.activity_id,
    attivita: osservazione.attivita,
    dataOsservazione: osservazione.data_osservazione,
    valore: osservazione.valore,
    etichetta: stessaScala ? (etichette.get(osservazione.valore) || null) : null,
    percentuale: stessaScala ? motore.percentualeOsservazione(osservazione.valore, scala) : null,
    nota: osservazione.note || null,
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
    critico: r.critico,
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
    critico: a.critico,
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
    nonPiuAttivi.get(chiave).osservazioni.push(descriviOsservazione(o, scala, etichette, {
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
    difficoltaGeneralizzata: motore.difficoltaGeneralizzata(complessivo),
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
      // Solo confronto relativo (banda del nucleo rispetto a quella del complessivo): il livello assoluto e la
      // criticità sono in risultatoCorrente e non vengono mai sostituiti da questo campo.
      confrontoConComplessivo: motore.confrontoRelativo(aggregato, complessivo),
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
        osservazioni: storico.map((o) => descriviOsservazione(o, scala, etichette, {
          inRisultatoCorrente: nellaFinestra.has(o.observation_id),
          conteggiata: o.motivo === null,
          motivoEsclusione: o.motivo,
        })),
      })),
    })),
    criteriNonPiuAttivi: [...nonPiuAttivi.values()],
  };
}

// ===========================================================================
// REPORT GLOBALE DELLA CLASSE: aggregato e anonimo. Nessun dato nominativo viene letto: gli studenti
// compaiono solo come id di iscrizione, usati come chiavi interne e mai restituiti.
// ===========================================================================

/**
 * Motivi per cui un'osservazione del Teaching non entra nel report di classe, dal più ampio al più
 * specifico: un'osservazione esclusa è conteggiata UNA volta, con il primo motivo che la riguarda.
 */
const MOTIVI_NON_CONTEGGIATE_CLASSE = Object.freeze([
  MOTIVO_ISCRIZIONE_NON_ATTIVA, MOTIVO_NUCLEO_NON_ATTIVO, MOTIVO_CRITERIO_NON_ATTIVO,
  MOTIVO_ATTIVITA_DISATTIVATA, MOTIVO_SCALA_NON_COMPATIBILE,
]);

/** Id delle iscrizioni ATTIVE della classe/anno del Teaching (solo gli id: nessun dato della persona). */
async function caricaIscrizioniAttive(client, { teaching, tenantId }) {
  const { rows } = await client.query(
    `SELECT e.id FROM enrollments e
     WHERE e.tenant_id = $1 AND e.class_id = $2 AND e.school_year_id = $3 AND e.attiva
     ORDER BY e.id`,
    [tenantId, teaching.class_id, teaching.school_year_id]
  );
  return rows.map((r) => r.id);
}

/**
 * TUTTE le osservazioni del Teaching in UNA query (mai una query per studente), con quanto serve a decidere
 * se contano. Solo le attività di QUESTO Teaching: le osservazioni di un altro Teaching (co-docenza, anche
 * stessa classe/materia/anno) non vengono lette. Il nucleo è quello del criterio (la FK composta di
 * observations impone che coincidano). Stesso ordine cronologico del report individuale: ogni studente ha,
 * per ogni criterio, la stessa sequenza di valori del suo report.
 */
async function caricaOsservazioniDelTeaching(client, { teachingId, tenantId }) {
  const { rows } = await client.query(
    `SELECT o.enrollment_id, o.criterion_id, o.valore, o.scale_id,
            a.stato AS attivita_stato, pu.stato AS unit_stato
     FROM observations o
     JOIN activities a ON a.id = o.activity_id AND a.tenant_id = o.tenant_id
     JOIN pedagogical_units pu ON pu.id = o.pedagogical_unit_id AND pu.tenant_id = o.tenant_id
     WHERE o.tenant_id = $1 AND a.teaching_id = $2
     ORDER BY o.data_osservazione, a.data_attivita, a.id, o.id`,
    [tenantId, teachingId]
  );
  return rows;
}

/** Perché un'osservazione del Teaching NON entra nel report di classe (null = è valida). */
function motivoEsclusioneDiClasse(osservazione, { iscrizioniAttive, criteriAttivi, scala }) {
  if (!iscrizioniAttive.has(String(osservazione.enrollment_id))) return MOTIVO_ISCRIZIONE_NON_ATTIVA;
  if (!criteriAttivi.has(String(osservazione.criterion_id))) {
    return osservazione.unit_stato === NUCLEO_ATTIVO ? MOTIVO_CRITERIO_NON_ATTIVO : MOTIVO_NUCLEO_NON_ATTIVO;
  }
  return motivoEsclusione(osservazione, scala);
}

/**
 * Separa le osservazioni VALIDE, raggruppate per iscrizione e criterio nell'ordine ricevuto (cronologico),
 * da quelle non conteggiate, contate per motivo.
 * @param {object[]} osservazioni - da caricaOsservazioniDelTeaching.
 * @param {{iscrizioniAttive: Set<string>, criteriAttivi: Set<string>, scala: {id: *}}} contesto
 * @returns {{validePerIscrizione: Map<string, Map<string, number[]>>, nonConteggiate: Object<string, number>}}
 */
function classificaOsservazioniDiClasse(osservazioni, contesto) {
  const nonConteggiate = Object.fromEntries(MOTIVI_NON_CONTEGGIATE_CLASSE.map((motivo) => [motivo, 0]));
  const validePerIscrizione = new Map();
  osservazioni.forEach((o) => {
    const motivo = motivoEsclusioneDiClasse(o, contesto);
    if (motivo !== null) {
      nonConteggiate[motivo] += 1;
      return;
    }
    const iscrizione = String(o.enrollment_id);
    const criterio = String(o.criterion_id);
    if (!validePerIscrizione.has(iscrizione)) validePerIscrizione.set(iscrizione, new Map());
    const perCriterio = validePerIscrizione.get(iscrizione);
    if (!perCriterio.has(criterio)) perCriterio.set(criterio, []);
    perCriterio.get(criterio).push(o.valore);
  });
  return { validePerIscrizione, nonConteggiate };
}

/** Livello ASSOLUTO di un risultato di classe. In questo report "non valutato" è null, mai ''. */
function descriviLivelloDiClasse(r) {
  return { percentuale: r.percentuale, giudizio: r.giudizio || null, livelloGiudizio: r.livelloGiudizio, critico: r.critico };
}

/**
 * Risposta pubblica del report di classe. Contiene solo dati aggregati e la struttura della materia:
 * nessun nome, cognome o identificativo di studenti.
 * @param {{teaching: object, annoScolastico: string|null, scala: object, bande: object[], struttura: object[],
 *   report: object, nonConteggiate: Object<string, number>}} dati - report da motore.progressoDiClasse.
 */
function descriviProgressoClasse({ teaching, annoScolastico, scala, bande, struttura, report, nonConteggiate }) {
  // Il motore lavora su chiavi stringa: si torna agli id originali dei criteri.
  const idCriterio = new Map(struttura.flatMap((n) => n.criteri.map((c) => [String(c.id), c.id])));
  const { complessivo } = report;
  return {
    teaching: { id: teaching.id, materia: teaching.materia, classe: teaching.classe, annoScolastico },
    classe: report.classe,
    scala: {
      id: scala.id, nome: scala.nome, valori: scala.valori, valoreMinimo: scala.valoreMinimo, valoreMassimo: scala.valoreMassimo,
    },
    bande: motore.bandeConPosizioneRadar(bande, scala),
    regola: { tipo: 'media_mobile', ...motore.REGOLA_CLASSE },
    complessivo: {
      risultatoCorrente: descriviLivelloDiClasse(complessivo.risultato),
      risultatoStorico: { percentuale: complessivo.storico.percentuale },
      differenzaCorrenteStorico: complessivo.differenzaCorrenteStorico,
      difficoltaGeneralizzata: complessivo.difficoltaGeneralizzata,
      criteriValutati: complessivo.criteriValutati,
      criteriRappresentativi: complessivo.risultato.criteriRappresentativi,
      criteriTotali: complessivo.risultato.criteriTotali,
    },
    nuclei: struttura.map((nucleo, i) => {
      const n = report.nuclei[i];
      return {
        id: nucleo.id,
        nome: nucleo.nome,
        ordine: nucleo.ordine,
        grigliaNonConfigurata: nucleo.criteri.length === 0,
        risultatoCorrente: descriviLivelloDiClasse(n.risultato),
        risultatoStorico: { percentuale: n.storico.percentuale },
        differenzaCorrenteStorico: n.differenzaCorrenteStorico,
        criteriValutati: n.criteriValutati,
        criteriRappresentativi: n.risultato.criteriRappresentativi,
        criteriTotali: n.risultato.criteriTotali,
        copertura: n.copertura,
        osservazioniTotali: n.osservazioniTotali,
        confrontoConComplessivo: n.confrontoConComplessivo,
        criteriForti: n.criteriForti.map((id) => idCriterio.get(id)),
        criteriDeboli: n.criteriDeboli.map((id) => idCriterio.get(id)),
        radar: n.radar,
        criteri: nucleo.criteri.map((criterio, j) => {
          const c = n.criteri[j];
          return {
            id: criterio.id,
            codice: criterio.codice,
            descrizione: criterio.descrizione,
            ordine: criterio.ordine,
            risultatoCorrente: descriviLivelloDiClasse(c.risultato),
            risultatoStorico: { percentuale: c.storico.percentuale },
            differenzaCorrenteStorico: c.differenzaCorrenteStorico,
            rappresentativo: c.rappresentativo,
            statoCopertura: c.statoCopertura,
            copertura: c.copertura,
            osservazioniTotali: c.osservazioniTotali,
            distribuzioneGiudizi: c.distribuzioneGiudizi,
            confronto: c.confronto,
            confrontoConNucleo: c.confrontoConNucleo,
          };
        }),
      };
    }),
    osservazioniNonConteggiate: {
      totale: Object.values(nonConteggiate).reduce((totale, n) => totale + n, 0),
      perMotivo: nonConteggiate,
    },
  };
}

/**
 * REPORT GLOBALE DELLA CLASSE per un Teaching: un numero fisso di query (contesto, iscrizioni attive,
 * struttura, osservazioni del Teaching), poi solo il motore puro. Ogni studente iscritto attivo entra nel
 * denominatore della copertura, anche senza osservazioni; le iscrizioni non attive non entrano in nulla.
 * Distinto dal Report classe della singola attività, che è una fotografia senza media mobile.
 */
async function getProgressoClasseDiTeaching(client, { teachingId, tenantId }) {
  const { teaching, annoScolastico, scala, bande } = await caricaContestoTeaching(client, teachingId, tenantId);
  const iscrizioni = await caricaIscrizioniAttive(client, { teaching, tenantId });
  const struttura = await caricaStruttura(client, { subjectId: teaching.subject_id, tenantId });
  const osservazioni = await caricaOsservazioniDelTeaching(client, { teachingId, tenantId });

  const { validePerIscrizione, nonConteggiate } = classificaOsservazioniDiClasse(osservazioni, {
    iscrizioniAttive: new Set(iscrizioni.map(String)),
    criteriAttivi: new Set(struttura.flatMap((n) => n.criteri.map((c) => String(c.id)))),
    scala,
  });
  const righeStudenti = iscrizioni.map(
    (id) => motore.rigaStudenteDiClasse(validePerIscrizione.get(String(id)) || new Map(), scala, bande)
  );
  const report = motore.progressoDiClasse(
    struttura.map((n) => n.criteri.map((c) => String(c.id))), righeStudenti, scala, bande
  );
  return descriviProgressoClasse({ teaching, annoScolastico, scala, bande, struttura, report, nonConteggiate });
}

module.exports = {
  getProgressoStudenteDiTeaching,
  getProgressoClasseDiTeaching,
  // Parti pure del report di classe, esportate per i test unitari.
  MOTIVI_NON_CONTEGGIATE_CLASSE, classificaOsservazioniDiClasse, descriviProgressoClasse,
};
