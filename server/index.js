'use strict';
require('dotenv').config();

const path = require('path');
const express = require('express');
const routeApi = require('./routes/index');
const { pool, verificaVincoliRichiesti } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', routeApi);

const porta = process.env.PORT || 3000;

// Verifica lo schema V1 PRIMA di accettare richieste: se le migration non
// sono state applicate, il server si ferma con un messaggio chiaro invece
// di fallire in modo confuso a ogni richiesta.
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
