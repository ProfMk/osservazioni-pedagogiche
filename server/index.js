'use strict';

const path = require('path');
const express = require('express');
const { identificaDocente } = require('./auth');
const routeAttivita = require('./routes/attivita');
const { pool, verificaVincoliRichiesti } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Tutte le API richiedono un docente identificato (vedi server/auth.js: NON un login reale).
app.use('/api', identificaDocente, routeAttivita);

const porta = process.env.PORT || 3000;

// Verifica i vincoli richiesti PRIMA di accettare richieste: se la
// migration 001 non è stata applicata, il server si ferma con un
// messaggio chiaro invece di fallire in modo confuso a ogni salvataggio.
verificaVincoliRichiesti(pool)
  .then(() => {
    app.listen(porta, () => {
      // eslint-disable-next-line no-console
      console.log(`Server in ascolto su http://localhost:${porta}`);
    });
  })
  .catch((errore) => {
    // eslint-disable-next-line no-console
    console.error('AVVIO INTERROTTO:', errore.message);
    process.exit(1);
  });

module.exports = app;
