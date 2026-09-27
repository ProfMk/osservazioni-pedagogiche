'use strict';

/**
 * ATTENZIONE — QUESTO NON È UN SISTEMA DI LOGIN.
 *
 * Le 13 tabelle analizzate (persona, ruoli, persone_ruoli, ...) non
 * contengono alcuna tabella di credenziali, password o sessioni: il
 * modello Access/PostgreSQL non prevede login. Introdurre un sistema di
 * autenticazione vero (password, hash, sessioni o token, eventualmente
 * SSO) è una decisione di prodotto che NON è stata presa: non la invento
 * qui.
 *
 * Per rendere il resto del sistema (autorizzazione, calcoli, griglia)
 * testabile fin da ora, questo middleware legge l'ID del docente da un
 * header HTTP indicato esplicitamente dal chiamante (X-Docente-Id).
 * QUESTO NON È SICURO: chiunque può scrivere un ID a piacere.
 *
 * Va sostituito, prima di qualunque uso reale, con un meccanismo che
 * stabilisca l'identità in modo verificato (sessione autenticata, token
 * firmato, ecc.). Il resto del codice (autorizzazione.js, queries.js)
 * NON dipende da come l'identità viene stabilita: usa sempre e solo il
 * valore restituito da req.docenteId, quindi sostituire questo file è
 * sufficiente a introdurre un login vero senza toccare il resto (R1).
 */
function identificaDocente(req, res, next) {
  const intestazione = req.header('X-Docente-Id');
  const docenteId = intestazione ? Number.parseInt(intestazione, 10) : NaN;
  if (!Number.isInteger(docenteId) || docenteId <= 0) {
    return res.status(401).json({
      errore: 'Identità del docente non fornita o non valida (header X-Docente-Id). '
        + 'Nota: questo è un meccanismo di sviluppo, non un login reale — vedi server/auth.js.',
    });
  }
  req.docenteId = docenteId;
  next();
}

module.exports = { identificaDocente };
