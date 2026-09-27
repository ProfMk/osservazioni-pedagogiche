'use strict';

const { nonTrovato } = require('./erroreApplicativo');

/**
 * Verifica che l'attività appartenga a un insegnamento del docente autenticato
 * e che il nucleo dell'attività appartenga alla stessa materia dell'insegnamento
 * (R2, R4). Nessuna informazione sull'attività viene mai presa dal client:
 * qui si ricostruisce classe, anno e materia SOLO a partire dall'attivita_id
 * e dal docente_id di sessione.
 *
 * @returns {Promise<object>} riga con id, insegnamento_id, nucleo_tematico_id,
 *   classe_id, anno_scolastico_id, materia_id, docente_id
 * @throws {ErroreApplicativo} 404 se l'attività non esiste o non è del docente.
 */
async function verificaAttivitaDelDocente(client, attivitaId, docenteId) {
  const { rows } = await client.query(
    `SELECT a.id, a.nome, a.data_attivita, a.insegnamento_id, a.nucleo_tematico_id,
            i.docente_id, i.materia_id, i.classe_id, i.anno_scolastico_id
     FROM attivita a
     JOIN insegnamenti i    ON i.id = a.insegnamento_id
     JOIN nuclei_tematici n ON n.id = a.nucleo_tematico_id AND n.materia_id = i.materia_id
     WHERE a.id = $1 AND i.docente_id = $2`,
    [attivitaId, docenteId]
  );
  if (rows.length === 0) {
    throw nonTrovato('Attività non trovata o non accessibile.');
  }
  return rows[0];
}

/**
 * Verifica che l'iscrizione appartenga alla stessa classe e allo stesso anno
 * scolastico dell'insegnamento a cui appartiene l'attività (R5).
 * `attivitaInfo` deve provenire da verificaAttivitaDelDocente (mai da input client).
 *
 * @param {boolean} richiedeAttiva - true per le scritture (A4): l'iscrizione deve essere attiva.
 */
async function verificaIscrizioneCoerente(client, attivitaInfo, iscrizioneId, richiedeAttiva) {
  const condizioneAttiva = richiedeAttiva ? 'AND s.attiva' : '';
  const { rows } = await client.query(
    `SELECT s.id, s.persona_id, s.classe_id, s.anno_scolastico_id
     FROM iscrizioni s
     WHERE s.id = $1 AND s.classe_id = $2 AND s.anno_scolastico_id = $3 ${condizioneAttiva}`,
    [iscrizioneId, attivitaInfo.classe_id, attivitaInfo.anno_scolastico_id]
  );
  if (rows.length === 0) {
    throw nonTrovato('Alunno non trovato in questa classe/anno per questa attività.');
  }
  return rows[0];
}

/**
 * Verifica che il criterio appartenga al nucleo tematico dell'attività (R6).
 * `attivitaInfo` deve provenire da verificaAttivitaDelDocente.
 */
async function verificaCriterioDelNucleo(client, attivitaInfo, criterioId) {
  const { rows } = await client.query(
    `SELECT c.id, c.nome, c.ordine
     FROM criteri_osservazione c
     WHERE c.id = $1 AND c.nucleo_tematico_id = $2`,
    [criterioId, attivitaInfo.nucleo_tematico_id]
  );
  if (rows.length === 0) {
    throw nonTrovato('Criterio non appartenente al nucleo di questa attività.');
  }
  return rows[0];
}

module.exports = {
  verificaAttivitaDelDocente,
  verificaIscrizioneCoerente,
  verificaCriterioDelNucleo,
};
