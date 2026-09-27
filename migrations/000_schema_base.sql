-- =====================================================================
-- 000_schema_base.sql
--
-- Struttura ORIGINALE delle 13 tabelle così come risultano dall'analisi
-- del file Access (Sistema_Osservazioni_Pedagogiche.accdb / PostgreSQL
-- Neon), PRIMA di applicare 001_vincoli_osservazioni.sql.
--
-- QUESTO FILE NON VA MAI ESEGUITO SU NEON: le 13 tabelle esistono già lì.
-- Serve SOLO per ricreare in locale un database di prova identico alla
-- struttura reale, su cui poi eseguire 001_vincoli_osservazioni.sql e i
-- test di integrazione (vedi README, sezione "Preparare un database di
-- prova locale").
--
-- NON aggiunge i vincoli che 001_vincoli_osservazioni.sql introduce
-- (UNIQUE su osservazioni, CHECK sul punteggio, 2 FK): è intenzionale,
-- riproduce lo stato "prima della migration" per poterla collaudare.
--
-- La sua assenza tra i file consegnati in precedenza è la causa reale
-- dell'errore "Impossibile salvare: Errore interno" (Postgres 42P10):
-- senza questo file non esisteva un modo affidabile per ricreare in
-- locale la struttura corretta, e un database creato "a mano" può
-- facilmente mancare del vincolo UNIQUE su cui si basa il salvataggio.
-- =====================================================================

CREATE TABLE persone (
  id bigserial PRIMARY KEY,
  nome varchar(100) NOT NULL,
  cognome varchar(100) NOT NULL,
  email varchar(255) UNIQUE,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE ruoli (
  id bigserial PRIMARY KEY,
  nome varchar(100) NOT NULL UNIQUE
);

CREATE TABLE persone_ruoli (
  id bigserial PRIMARY KEY,
  persona_id bigint NOT NULL REFERENCES persone(id),
  ruolo_id bigint NOT NULL REFERENCES ruoli(id),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (persona_id, ruolo_id)
);

CREATE TABLE materie (
  id bigserial PRIMARY KEY,
  nome varchar(100) NOT NULL UNIQUE
);

CREATE TABLE classi (
  id bigserial PRIMARY KEY,
  nome varchar(50) NOT NULL UNIQUE
);

CREATE TABLE anni_scolastici (
  id bigserial PRIMARY KEY,
  nome varchar(20) NOT NULL UNIQUE,
  attivo boolean NOT NULL DEFAULT false
);

CREATE TABLE insegnamenti (
  id bigserial PRIMARY KEY,
  docente_id bigint NOT NULL REFERENCES persone(id),
  materia_id bigint NOT NULL REFERENCES materie(id),
  classe_id bigint NOT NULL REFERENCES classi(id),
  anno_scolastico_id bigint NOT NULL REFERENCES anni_scolastici(id),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (docente_id, materia_id, classe_id, anno_scolastico_id)
);
CREATE INDEX idx_insegnamenti_docente ON insegnamenti(docente_id);

CREATE TABLE iscrizioni (
  id bigserial PRIMARY KEY,
  persona_id bigint NOT NULL REFERENCES persone(id),
  classe_id bigint NOT NULL REFERENCES classi(id),
  anno_scolastico_id bigint NOT NULL REFERENCES anni_scolastici(id),
  attiva boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (persona_id, anno_scolastico_id)
);

CREATE TABLE nuclei_tematici (
  id bigserial PRIMARY KEY,
  materia_id bigint NOT NULL REFERENCES materie(id),
  nome varchar(150) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (materia_id, nome)
);

CREATE TABLE criteri_osservazione (
  id bigserial PRIMARY KEY,
  nucleo_tematico_id bigint NOT NULL REFERENCES nuclei_tematici(id),
  nome text NOT NULL,
  ordine integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_criterio_nucleo_ordine UNIQUE (nucleo_tematico_id, ordine)
);

CREATE TABLE attivita (
  id bigserial PRIMARY KEY,
  insegnamento_id bigint NOT NULL REFERENCES insegnamenti(id),
  nucleo_tematico_id bigint NOT NULL REFERENCES nuclei_tematici(id),
  nome varchar(200) NOT NULL,
  data_attivita date NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX idx_attivita_insegnamento ON attivita(insegnamento_id);

-- ATTENZIONE: nessun vincolo UNIQUE(attivita_id, iscrizione_id) qui.
-- È esattamente il vincolo che 001_vincoli_osservazioni.sql aggiunge e
-- di cui server/queries.js ha bisogno per il salvataggio (INSERT ... ON
-- CONFLICT). Senza eseguire la migration, ogni tentativo di creare o
-- modificare una valutazione fallisce con l'errore Postgres 42P10.
CREATE TABLE osservazioni (
  id bigserial PRIMARY KEY,
  attivita_id bigint NOT NULL REFERENCES attivita(id),
  iscrizione_id bigint NOT NULL REFERENCES iscrizioni(id),
  docente_id bigint NOT NULL,
  data_osservazione date NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  note text
);
CREATE INDEX idx_osservazioni_attivita ON osservazioni(attivita_id);
CREATE INDEX idx_osservazioni_iscrizione ON osservazioni(iscrizione_id);

CREATE TABLE valutazioni_criteri (
  id bigserial PRIMARY KEY,
  osservazione_id bigint NOT NULL REFERENCES osservazioni(id),
  criterio_id bigint NOT NULL,
  punteggio integer NOT NULL,
  CONSTRAINT uq_osservazione_criterio UNIQUE (osservazione_id, criterio_id)
);
