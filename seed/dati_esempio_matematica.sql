-- =====================================================================
-- dati_esempio_matematica.sql
--
-- Dati minimi per provare l'applicazione su un database locale creato
-- con migrations/000_schema_base.sql. NON eseguire su Neon: sono dati
-- di prova, non dati reali.
--
-- Contenuto: 1 docente, 3 alunni (2 in classe 3A, 1 in 3B), 1 anno
-- scolastico attivo, i 3 nuclei e i 18 criteri di Matematica descritti
-- nell'analisi, 1 insegnamento (docente/Matematica/3A/2025-2026) con 2
-- attività sul nucleo "Numeri", alcune valutazioni già presenti.
-- =====================================================================

INSERT INTO ruoli (nome) VALUES ('docente'), ('alunno');

INSERT INTO materie (nome) VALUES ('Matematica');

INSERT INTO classi (nome) VALUES ('3A'), ('3B');

INSERT INTO anni_scolastici (nome, attivo) VALUES ('2025/2026', true);

INSERT INTO persone (nome, cognome, email) VALUES
  ('Mario', 'Docente', 'mario.docente@esempio.test'),   -- id 1: docente titolare
  ('Anna',  'Alunna1', NULL),                            -- id 2
  ('Luca',  'Alunno2', NULL),                             -- id 3
  ('Sara',  'Alunna3', NULL);                             -- id 4 (classe 3B, per provare i controlli di coerenza)

INSERT INTO persone_ruoli (persona_id, ruolo_id) VALUES
  (1, (SELECT id FROM ruoli WHERE nome = 'docente')),
  (2, (SELECT id FROM ruoli WHERE nome = 'alunno')),
  (3, (SELECT id FROM ruoli WHERE nome = 'alunno')),
  (4, (SELECT id FROM ruoli WHERE nome = 'alunno'));

INSERT INTO insegnamenti (docente_id, materia_id, classe_id, anno_scolastico_id) VALUES (
  1, (SELECT id FROM materie WHERE nome = 'Matematica'),
  (SELECT id FROM classi WHERE nome = '3A'),
  (SELECT id FROM anni_scolastici WHERE nome = '2025/2026')
);

INSERT INTO iscrizioni (persona_id, classe_id, anno_scolastico_id) VALUES
  (2, (SELECT id FROM classi WHERE nome = '3A'), (SELECT id FROM anni_scolastici WHERE nome = '2025/2026')),
  (3, (SELECT id FROM classi WHERE nome = '3A'), (SELECT id FROM anni_scolastici WHERE nome = '2025/2026')),
  (4, (SELECT id FROM classi WHERE nome = '3B'), (SELECT id FROM anni_scolastici WHERE nome = '2025/2026'));

INSERT INTO nuclei_tematici (materia_id, nome) VALUES
  ((SELECT id FROM materie WHERE nome = 'Matematica'), 'Numeri'),
  ((SELECT id FROM materie WHERE nome = 'Matematica'), 'Spazio e figure'),
  ((SELECT id FROM materie WHERE nome = 'Matematica'), 'Relazioni, dati e previsioni');

INSERT INTO criteri_osservazione (nucleo_tematico_id, nome, ordine) VALUES
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Numeri'), 'Correttezza numerica', 1),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Numeri'), 'Valore posizionale', 2),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Numeri'), 'Relazioni quantitative', 3),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Numeri'), 'Calcolo', 4),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Numeri'), 'Autonomia', 5),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Numeri'), 'Linguaggio matematico', 6),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Spazio e figure'), 'Orientamento e relazioni spaziali', 1),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Spazio e figure'), 'Linee, confine e regione interna', 2),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Spazio e figure'), 'Percorsi e rappresentazioni', 3),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Spazio e figure'), 'Reticoli e coordinate', 4),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Spazio e figure'), 'Figure geometriche e proprietà', 5),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Spazio e figure'), 'Simmetria e linguaggio geometrico', 6),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Relazioni, dati e previsioni'), 'Classificazione e relazioni', 1),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Relazioni, dati e previsioni'), 'Dati e rappresentazioni', 2),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Relazioni, dati e previsioni'), 'Lettura dei dati e previsioni', 3),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Relazioni, dati e previsioni'), 'Misura e grandezze', 4),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Relazioni, dati e previsioni'), 'Problemi e strategie risolutive', 5),
  ((SELECT id FROM nuclei_tematici WHERE nome = 'Relazioni, dati e previsioni'), 'Scelte, denaro e linguaggio matematico', 6);

INSERT INTO attivita (insegnamento_id, nucleo_tematico_id, nome, data_attivita) VALUES
  ((SELECT id FROM insegnamenti LIMIT 1), (SELECT id FROM nuclei_tematici WHERE nome = 'Numeri'), 'Addizioni e sottrazioni', '2025-10-01'),
  ((SELECT id FROM insegnamenti LIMIT 1), (SELECT id FROM nuclei_tematici WHERE nome = 'Numeri'), 'Moltiplicazioni', '2025-10-08');

-- Osservazione di esempio: Anna (iscrizione 1), attività 1, griglia completa (0,2,1,1,2,2 -> esempio del piano).
INSERT INTO osservazioni (attivita_id, iscrizione_id, docente_id, data_osservazione, note) VALUES
  (1, 1, 1, '2025-10-01', 'Nota di esempio, facoltativa.');
INSERT INTO valutazioni_criteri (osservazione_id, criterio_id, punteggio)
SELECT 1, c.id, v.punteggio
FROM criteri_osservazione c
JOIN (VALUES (1,0),(2,2),(3,1),(4,1),(5,2),(6,2)) AS v(ordine, punteggio)
  ON v.ordine = c.ordine AND c.nucleo_tematico_id = (SELECT id FROM nuclei_tematici WHERE nome = 'Numeri');
