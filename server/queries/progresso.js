'use strict';

/**
 * Report pedagogici V2 — lettura dati. Questo modulo recupera e normalizza i dati
 * di UN Teaching e li passa al motore puro server/lib/calcoloProgresso.js: NESSUNA
 * formula pedagogica vive qui.
 *
 * Perimetro: un Teaching del tenant della sessione. Si leggono solo le osservazioni
 * sulle attività di QUEL Teaching (co-docenza: ciascun Teaching vede le proprie).
 *
 * Contenuti: i testi dell'istituto (materia, nuclei, criteri, bande, scala) sono
 * restituiti come { testo, lingua } nella lingua della sessione con fallback alla
 * lingua di origine (B-2/B-3); i contenuti d'autore (nome attività, note, giudizio
 * dell'Assessment) nella lingua in cui sono stati scritti.
 */

const { nonTrovato } = require('../lib/erroreApplicativo');
const { getScalaApplicabile, getBandeGiudizio } = require('./configurazione');
const { verificaTeachingNelTenant } = require('./dominio');
const { FINESTRA_MEDIA_MOBILE } = require('../lib/calcoloEsiti');
const motore = require('../lib/calcoloProgresso');
const { pubblico, bandePubbliche, scalaPubblica, traduttoreDi } = require('../lib/pubblicazione');

const ATTIVITA_ATTIVA = 'attiva';
const NUCLEO_ATTIVO = 'attiva';
const CRITERIO_ATTIVO = 'attivo';

// Motivi di esclusione (V2 §11): identificatori del vocabolario chiuso.
const ESCLUSIONE = Object.freeze({
  ISCRIZIONE: 'EXCLUSION_ENROLLMENT_INACTIVE',
  NUCLEO: 'EXCLUSION_UNIT_INACTIVE',
  CRITERIO: 'EXCLUSION_CRITERION_INACTIVE',
  ATTIVITA: 'EXCLUSION_ACTIVITY_INACTIVE',
  SCALA: 'EXCLUSION_SCALE_INCOMPATIBLE',
});

/** Teaching verificato nel tenant, con scala, bande (etichette tradotte) e anno. */
async function caricaContestoTeaching(client, { teachingId, tenantId, tr }) {
  const teaching = await verificaTeachingNelTenant(client, teachingId, tenantId);
  const { rows: anni } = await client.query(
    'SELECT nome FROM school_years WHERE id = $1 AND tenant_id = $2', [teaching.school_year_id, tenantId]
  );
  const scala = await getScalaApplicabile(client, { tenantId, schoolLevelId: teaching.school_level_id });
  const bandeDb = await getBandeGiudizio(client, { tenantId, schoolLevelId: teaching.school_level_id });
  const bande = motore.preparaBande(bandeDb.map((b) => ({ ...b, etichetta: tr.testo('judgment_bands.etichetta', b.id, b.etichetta) })));
  return {
    teaching,
    scala,
    bande,
    intestazione: {
      id: teaching.id,
      materia: tr.testo('subjects.nome', teaching.subject_id, teaching.materia),
      classe: teaching.classe,
      annoScolastico: anni[0] ? anni[0].nome : null,
    },
  };
}

/**
 * Struttura pedagogica corrente della materia: nuclei attivi nell'ordine configurato,
 * ciascuno con i propri criteri attivi (nomi tradotti).
 */
async function caricaStruttura(client, { subjectId, tenantId, tr }) {
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
    if (!nuclei.has(r.unit_id)) {
      nuclei.set(r.unit_id, { id: r.unit_id, nome: tr.testo('pedagogical_units.nome', r.unit_id, r.unit_nome), ordine: r.unit_ordine, criteri: [] });
    }
    if (r.criterion_id !== null) {
      nuclei.get(r.unit_id).criteri.push({
        id: r.criterion_id,
        codice: r.codice,
        ordine: r.ordine,
        descrizione: tr.testo('criteria.descrizione', r.criterion_id, r.descrizione),
      });
    }
  });
  return [...nuclei.values()];
}

/** Iscrizioni (attive e non) della classe/anno del Teaching, nell'ordine del registro. */
async function caricaIscrizioni(client, teaching, tenantId) {
  const { rows } = await client.query(
    `SELECT e.id AS enrollment_id, e.student_person_id, e.attiva, p.nome, p.cognome
     FROM enrollments e JOIN people p ON p.id = e.student_person_id AND p.tenant_id = e.tenant_id
     WHERE e.tenant_id = $1 AND e.class_id = $2 AND e.school_year_id = $3
     ORDER BY p.cognome, p.nome, e.id`,
    [tenantId, teaching.class_id, teaching.school_year_id]
  );
  return rows;
}

/**
 * Tutte le osservazioni sulle attività del Teaching (di tutti gli iscritti), in ordine
 * cronologico deterministico (data osservazione, data attività, id). Nessun filtro sugli
 * stati: è chi calcola a decidere cosa conteggiare (ed è sempre esplicito il motivo).
 */
async function caricaOsservazioni(client, { teachingId, tenantId }) {
  const { rows } = await client.query(
    `SELECT o.id AS observation_id, o.enrollment_id, o.criterion_id, o.valore, o.scale_id, o.note, o.lingua_nota,
            to_char(o.data_osservazione, 'YYYY-MM-DD') AS data_osservazione,
            a.id AS activity_id, a.nome AS attivita, a.lingua_contenuto AS attivita_lingua, a.stato AS attivita_stato,
            c.codice, c.descrizione, c.stato AS criterio_stato,
            pu.id AS unit_id, pu.nome AS unit_nome, pu.stato AS unit_stato,
            e.attiva AS iscrizione_attiva
     FROM observations o
     JOIN activities a ON a.id = o.activity_id AND a.tenant_id = o.tenant_id
     JOIN criteria c ON c.id = o.criterion_id AND c.tenant_id = o.tenant_id
     JOIN pedagogical_units pu ON pu.id = c.pedagogical_unit_id AND pu.tenant_id = o.tenant_id
     JOIN enrollments e ON e.id = o.enrollment_id AND e.tenant_id = o.tenant_id
     WHERE o.tenant_id = $1 AND a.teaching_id = $2
     ORDER BY o.data_osservazione, a.data_attivita, a.id, o.id`,
    [tenantId, teachingId]
  );
  return rows;
}

/** Perché un'osservazione di un criterio attivo NON entra nei calcoli (null = è valida). */
function motivoEsclusione(osservazione, scala) {
  if (osservazione.attivita_stato !== ATTIVITA_ATTIVA) return ESCLUSIONE.ATTIVITA;
  if (String(osservazione.scale_id) !== String(scala.id)) return ESCLUSIONE.SCALA;
  return null;
}

/**
 * Una riga di sequenza (strato OBSERVATION, §13): valore ed etichetta di scala, mai una
 * percentuale né una banda. Un'osservazione registrata con un'altra scala non ha etichetta.
 */
function descriviOsservazione(o, scala, scalaPub, tr, extra) {
  const stessaScala = String(o.scale_id) === String(scala.id);
  const valoreScala = stessaScala ? scalaPub.valori.find((v) => v.valore === o.valore) : null;
  return {
    observationId: o.observation_id,
    activityId: o.activity_id,
    attivita: tr.autore(o.attivita, o.attivita_lingua),
    dataOsservazione: o.data_osservazione,
    valore: o.valore,
    etichetta: valoreScala ? valoreScala.etichetta : null,
    nota: tr.autore(o.note || null, o.lingua_nota),
    ...extra,
  };
}

/**
 * Calcolo completo di UNO studente su un Teaching: per ogni nucleo e criterio attivo,
 * storico, risultato corrente, cumulativo; poi nucleo e complessivo. `filtroData`
 * (opzionale) limita le osservazioni considerate (evidenza di un periodo, P13).
 */
function calcolaStudente({ osservazioni, struttura, scala, scalaPub, bande, tr, filtroData = null }) {
  const proprie = filtroData ? osservazioni.filter((o) => filtroData(o.data_osservazione)) : osservazioni;
  const criteriAttivi = new Set(struttura.flatMap((n) => n.criteri.map((c) => String(c.id))));
  const perCriterio = new Map();
  const nonPiuAttivi = new Map();
  proprie.forEach((o) => {
    const chiave = String(o.criterion_id);
    if (criteriAttivi.has(chiave)) {
      if (!perCriterio.has(chiave)) perCriterio.set(chiave, []);
      perCriterio.get(chiave).push(o);
      return;
    }
    if (!nonPiuAttivi.has(chiave)) {
      nonPiuAttivi.set(chiave, {
        id: o.criterion_id,
        codice: o.codice,
        descrizione: tr.testo('criteria.descrizione', o.criterion_id, o.descrizione),
        nucleo: tr.testo('pedagogical_units.nome', o.unit_id, o.unit_nome),
        osservazioni: [],
      });
    }
    // Il nucleo disattivato prevale sul criterio: è la causa a monte (§11).
    const motivo = o.unit_stato !== NUCLEO_ATTIVO ? ESCLUSIONE.NUCLEO : ESCLUSIONE.CRITERIO;
    nonPiuAttivi.get(chiave).osservazioni.push(descriviOsservazione(o, scala, scalaPub, tr, {
      inFinestra: false, conteggiata: false, motivoEsclusione: motivo,
    }));
  });

  const nuclei = struttura.map((nucleo) => {
    const criteri = nucleo.criteri.map((criterio) => {
      const storico = (perCriterio.get(String(criterio.id)) || []).map((o) => ({ ...o, motivo: motivoEsclusione(o, scala) }));
      const valide = storico.filter((o) => o.motivo === null);
      const risultato = motore.risultatoCriterioStudente(valide.map((o) => o.valore), scala, bande);
      const finestra = new Set(valide.slice(-FINESTRA_MEDIA_MOBILE).map((o) => o.observation_id));
      return { criterio, storico, risultato, finestra };
    });
    return { nucleo, criteri, aggregato: motore.aggregaCriteriStudente(criteri.map((c) => c.risultato), scala, bande, { nucleo: true }) };
  });
  const complessivo = motore.aggregaCriteriStudente(nuclei.flatMap((n) => n.criteri.map((c) => c.risultato)), scala, bande);
  return { nuclei, complessivo, nonPiuAttivi: [...nonPiuAttivi.values()] };
}

/**
 * Dati e calcoli di classe del Teaching: risultato di ogni iscritto ATTIVO e risultati di
 * classe per nucleo e complessivo (motore). Le osservazioni di iscrizioni non attive sono
 * escluse e contate con il motivo EXCLUSION_ENROLLMENT_INACTIVE.
 */
async function caricaClasse(client, { teachingId, tenantId, lingua }) {
  const tr = await traduttoreDi(client, lingua);
  const contesto = await caricaContestoTeaching(client, { teachingId, tenantId, tr });
  const { teaching, scala, bande } = contesto;
  const scalaPub = scalaPubblica(scala, tr);
  const struttura = await caricaStruttura(client, { subjectId: teaching.subject_id, tenantId, tr });
  const iscrizioni = await caricaIscrizioni(client, teaching, tenantId);
  const osservazioni = await caricaOsservazioni(client, { teachingId, tenantId });

  const perIscrizione = new Map();
  osservazioni.forEach((o) => {
    if (!perIscrizione.has(o.enrollment_id)) perIscrizione.set(o.enrollment_id, []);
    perIscrizione.get(o.enrollment_id).push(o);
  });
  const studenti = iscrizioni.filter((e) => e.attiva).map((e) => ({
    iscrizione: e,
    calcolo: calcolaStudente({ osservazioni: perIscrizione.get(e.enrollment_id) || [], struttura, scala, scalaPub, bande, tr }),
  }));

  const righe = studenti.map(({ calcolo }) => {
    const riga = new Map();
    calcolo.nuclei.forEach((n) => n.criteri.forEach((c) => {
      if (c.risultato.osservazioniTotali > 0) riga.set(c.criterio.id, c.risultato);
    }));
    return riga;
  });
  const nucleiClasse = struttura.map((nucleo) => ({ nucleo, ...motore.nucleoDiClasse(nucleo.criteri.map((c) => c.id), righe, bande) }));
  const complessivoClasse = motore.complessivoDiClasse(nucleiClasse, bande);
  const esclusioniIscrizione = osservazioni.filter((o) => !o.iscrizione_attiva).length;

  return {
    tr, contesto, scalaPub, struttura, perIscrizione, studenti, nucleiClasse, complessivoClasse, esclusioniIscrizione,
  };
}

/** Riferimento (tacca) di classe per L1–L2 (§9, P9): solo se il valore di classe esiste ed è sufficiente. */
function riferimentoClasse(risultato) {
  if (!risultato || risultato.posizioneAsse === null || risultato.certezza !== motore.CERTEZZA.SUFFICIENTE) return null;
  return { posizioneAsse: risultato.posizioneAsse, certezza: risultato.certezza };
}

/** Valutazioni docente (strato TEACHER_ASSESSMENT) di un Teaching, con autore e periodo. */
async function caricaValutazioni(client, { teachingId, tenantId, tr, enrollmentId = null }) {
  const { rows } = await client.query(
    `SELECT ass.id, ass.enrollment_id, ass.criterion_id, ass.giudizio, ass.lingua_contenuto, ass.note,
            to_char(ass.updated_at, 'YYYY-MM-DD') AS aggiornata_il,
            ap.id AS periodo_id, ap.nome AS periodo_nome,
            to_char(ap.data_inizio, 'YYYY-MM-DD') AS periodo_inizio, to_char(ap.data_fine, 'YYYY-MM-DD') AS periodo_fine,
            c.codice AS criterio_codice, c.descrizione AS criterio_descrizione,
            ps.nome AS alunno_nome, ps.cognome AS alunno_cognome,
            pa.nome AS autore_nome, pa.cognome AS autore_cognome
     FROM assessments ass
     JOIN enrollments e ON e.id = ass.enrollment_id
     JOIN people ps ON ps.id = e.student_person_id
     JOIN assessment_periods ap ON ap.id = ass.assessment_period_id
     JOIN accounts acc ON acc.id = ass.recorded_by_account_id
     JOIN people pa ON pa.id = acc.person_id
     LEFT JOIN criteria c ON c.id = ass.criterion_id
     WHERE ass.teaching_id = $1 AND ass.tenant_id = $2 AND ($3::bigint IS NULL OR ass.enrollment_id = $3)
     ORDER BY ps.cognome, ps.nome, ap.data_inizio, ass.id`,
    [teachingId, tenantId, enrollmentId]
  );
  return rows.map((r) => ({
    id: r.id,
    enrollmentId: r.enrollment_id,
    alunno: { cognome: r.alunno_cognome, nome: r.alunno_nome },
    periodo: {
      id: r.periodo_id,
      nome: tr.testo('assessment_periods.nome', r.periodo_id, r.periodo_nome),
      dataInizio: r.periodo_inizio,
      dataFine: r.periodo_fine,
    },
    criterio: r.criterion_id === null ? null : {
      id: r.criterion_id, codice: r.criterio_codice, descrizione: tr.testo('criteria.descrizione', r.criterion_id, r.criterio_descrizione),
    },
    // Timbro (■): contenuto d'autore, nella lingua in cui è stato registrato; mai precompilato.
    giudizio: tr.autore(r.giudizio, r.lingua_contenuto),
    nota: tr.autore(r.note || null, r.lingua_contenuto),
    autore: { nome: r.autore_nome, cognome: r.autore_cognome },
    aggiornataIl: r.aggiornata_il,
  }));
}

/**
 * Evidenza di una valutazione (P13): sintesi delle sole osservazioni del periodo,
 * con le stesse regole della grammatica (complessivo per una valutazione di materia,
 * criterio per una valutazione di criterio).
 */
function evidenzaValutazione(valutazione, dati) {
  const { struttura, contesto, scalaPub, tr, perIscrizione } = dati;
  const { dataInizio, dataFine } = valutazione.periodo;
  const calcolo = calcolaStudente({
    osservazioni: perIscrizione.get(valutazione.enrollmentId) || [],
    struttura,
    scala: contesto.scala,
    scalaPub,
    bande: contesto.bande,
    tr,
    filtroData: (data) => data >= dataInizio && data <= dataFine,
  });
  if (!valutazione.criterio) return pubblico(calcolo.complessivo);
  const trovato = calcolo.nuclei.flatMap((n) => n.criteri).find((c) => c.criterio.id === valutazione.criterio.id);
  return trovato ? pubblico(trovato.risultato) : null;
}

/** Intestazione comune dei report: precisione, bande, regola. */
function testataReport(contesto) {
  return {
    teaching: contesto.intestazione,
    precisione: motore.precisione(contesto.bande),
    bande: bandePubbliche(contesto.bande),
    regola: { tipo: 'media_mobile', finestra: FINESTRA_MEDIA_MOBILE },
  };
}

/**
 * PROFILO ALUNNO (L0 studente): nucleo e criteri con storico, finestra, cumulativo (◇),
 * certezza, criticità, confronto nucleo↔complessivo, tacca della classe a L1–L2 e
 * valutazioni docente (■) con l'evidenza del periodo.
 */
async function getProgressoStudenteDiTeaching(client, { teachingId, enrollmentId, tenantId, lingua }) {
  const dati = await caricaClasse(client, { teachingId, tenantId, lingua });
  const studente = dati.studenti.find((s) => s.iscrizione.enrollment_id === enrollmentId);
  if (!studente) throw nonTrovato('ERR_NOT_FOUND', { risorsa: 'UI_RESOURCE_ENROLLMENT' });
  const { calcolo, iscrizione } = studente;
  const { tr, scalaPub, contesto } = dati;
  const classePerNucleo = new Map(dati.nucleiClasse.map((n) => [n.nucleo.id, n]));

  const valutazioni = (await caricaValutazioni(client, { teachingId, tenantId, tr, enrollmentId }))
    .map((v) => ({ ...v, evidenza: evidenzaValutazione(v, dati) }));

  return {
    ...testataReport(contesto),
    alunno: {
      enrollmentId: iscrizione.enrollment_id, studentPersonId: iscrizione.student_person_id, cognome: iscrizione.cognome, nome: iscrizione.nome,
    },
    scala: scalaPub,
    avviso: motore.difficoltaGeneralizzata(calcolo.complessivo) ? 'GENERALIZED_DIFFICULTY' : null,
    complessivo: pubblico(calcolo.complessivo),
    nuclei: calcolo.nuclei.map(({ nucleo, criteri, aggregato }) => {
      const classe = classePerNucleo.get(nucleo.id);
      const classePerCriterio = new Map(classe.criteri.map((c) => [c.id, c]));
      return {
        id: nucleo.id,
        nome: nucleo.nome,
        ordine: nucleo.ordine,
        grigliaNonConfigurata: nucleo.criteri.length === 0,
        risultatoCorrente: pubblico(aggregato),
        cumulativo: pubblico(aggregato.cumulativo),
        // Glifo ammesso (§9): nucleo ↔ complessivo dello stesso studente.
        confrontoConComplessivo: motore.confrontoRelativo(aggregato, calcolo.complessivo),
        // Alunno ↔ classe a L1: solo tacca (P9: nessuna tacca se il riferimento è insufficiente o assente).
        riferimentoClasse: riferimentoClasse(classe.risultato),
        criteri: criteri.map(({ criterio, storico, risultato, finestra }) => ({
          id: criterio.id,
          codice: criterio.codice,
          descrizione: criterio.descrizione,
          ordine: criterio.ordine,
          risultatoCorrente: pubblico(risultato),
          cumulativo: pubblico(risultato.cumulativo),
          livelloCopertura: risultato.livelloCopertura,
          // Riferimento del nucleo (per lo studente solo tacca, nessun glifo) e tacca della classe a L2.
          riferimentoNucleo: aggregato.posizioneAsse === null || risultato.posizioneAsse === null
            ? null : { posizioneAsse: aggregato.posizioneAsse, certezza: aggregato.certezza },
          riferimentoClasse: riferimentoClasse(classePerCriterio.get(criterio.id).risultato),
          osservazioni: storico.map((o) => descriviOsservazione(o, contesto.scala, scalaPub, tr, {
            inFinestra: finestra.has(o.observation_id),
            conteggiata: o.motivo === null,
            motivoEsclusione: o.motivo,
          })),
        })),
      };
    }),
    criteriNonPiuAttivi: calcolo.nonPiuAttivi,
    valutazioni,
  };
}

/**
 * QUADRO CLASSE (VIEW_CLASS_OVERVIEW, P11): complessivo e nuclei di classe con criteri,
 * distribuzione degli studenti per banda del proprio complessivo (senza nomi), blocco di
 * attenzione (nuclei/criteri in banda critica con certezza sufficiente), avviso.
 */
async function getQuadroClasse(client, { teachingId, tenantId, lingua }) {
  const dati = await caricaClasse(client, { teachingId, tenantId, lingua });
  const { contesto, complessivoClasse } = dati;
  const nuclei = dati.nucleiClasse.map((n) => ({
    id: n.nucleo.id,
    nome: n.nucleo.nome,
    ordine: n.nucleo.ordine,
    grigliaNonConfigurata: n.nucleo.criteri.length === 0,
    risultato: pubblico(n.risultato),
    copertura: n.copertura,
    confrontoConComplessivo: motore.confrontoRelativo(n.risultato, complessivoClasse),
    criteri: n.criteri.map((c) => {
      const criterio = n.nucleo.criteri.find((x) => x.id === c.id);
      return {
        id: c.id,
        codice: criterio.codice,
        descrizione: criterio.descrizione,
        risultato: pubblico(c.risultato),
        copertura: c.copertura,
        statoCopertura: c.statoCopertura,
        rappresentativo: c.rappresentativo,
        confronto: c.confronto,
        confrontoConNucleo: c.confrontoConNucleo,
        riferimentoNucleo: n.risultato.posizioneAsse === null ? null : { posizioneAsse: n.risultato.posizioneAsse, certezza: n.risultato.certezza },
        distribuzione: c.distribuzioneGiudizi.map((d) => ({ ...d, larghezza: motore.quota(d.studenti, c.copertura.studentiValutati) })),
      };
    }),
  }));
  const bloccoAttenzione = [];
  nuclei.forEach((n) => {
    if (n.risultato.criticita === motore.CRITICITA.BANDA) bloccoAttenzione.push({ tipo: 'nucleo', nucleoId: n.id, nome: n.nome });
    n.criteri.forEach((c) => {
      if (c.risultato.criticita === motore.CRITICITA.BANDA) {
        bloccoAttenzione.push({ tipo: 'criterio', nucleoId: n.id, criterioId: c.id, codice: c.codice, nome: c.descrizione });
      }
    });
  });
  return {
    ...testataReport(contesto),
    regolaClasse: motore.REGOLA_CLASSE,
    studentiTotali: dati.studenti.length,
    avviso: motore.difficoltaGeneralizzata(complessivoClasse) ? 'GENERALIZED_DIFFICULTY' : null,
    complessivo: pubblico(complessivoClasse),
    distribuzione: motore.distribuzioneStudenti(dati.studenti.map((s) => s.calcolo.complessivo), contesto.bande),
    bloccoAttenzione,
    nuclei,
    esclusioni: dati.esclusioniIscrizione === 0 ? [] : [{ motivo: ESCLUSIONE.ISCRIZIONE, osservazioni: dati.esclusioniIscrizione }],
  };
}

/**
 * MATRICE ALUNNI × NUCLEI (VIEW_STUDENTS, P12): celle = mini-righe del nucleo dello studente;
 * ordine del registro e ordine configurato dei nuclei, mai un ordinamento per livello.
 * `inZonaCritica`: almeno una cella in banda critica con certezza sufficiente (filtro).
 */
async function getMatriceStudenti(client, { teachingId, tenantId, lingua }) {
  const dati = await caricaClasse(client, { teachingId, tenantId, lingua });
  return {
    ...testataReport(dati.contesto),
    nuclei: dati.struttura.map((n) => ({ id: n.id, nome: n.nome, ordine: n.ordine, grigliaNonConfigurata: n.criteri.length === 0 })),
    studenti: dati.studenti.map(({ iscrizione, calcolo }) => {
      const celle = calcolo.nuclei.map(({ nucleo, aggregato }) => ({ nucleoId: nucleo.id, ...pubblico(aggregato) }));
      return {
        enrollmentId: iscrizione.enrollment_id,
        cognome: iscrizione.cognome,
        nome: iscrizione.nome,
        inZonaCritica: celle.some((c) => c.criticita === motore.CRITICITA.BANDA),
        celle,
      };
    }),
  };
}

/** VALUTAZIONI (VIEW_ASSESSMENT): timbro, periodo, autore, sintesi del periodo come evidenza. */
async function getValutazioniDiTeaching(client, { teachingId, tenantId, lingua }) {
  const dati = await caricaClasse(client, { teachingId, tenantId, lingua });
  const valutazioni = await caricaValutazioni(client, { teachingId, tenantId, tr: dati.tr });
  return {
    ...testataReport(dati.contesto),
    valutazioni: valutazioni.map((v) => ({ ...v, evidenza: evidenzaValutazione(v, dati) })),
  };
}

module.exports = {
  getProgressoStudenteDiTeaching, getQuadroClasse, getMatriceStudenti, getValutazioniDiTeaching,
  ESCLUSIONE,
};
