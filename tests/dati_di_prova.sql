-- =====================================================================
-- tests/dati_di_prova.sql
--
-- Dati aggiuntivi richiesti dai test di integrazione, da applicare DOPO
-- migrations/000_schema_base.sql, migrations/001_vincoli_osservazioni.sql
-- e seed/dati_esempio_matematica.sql. NON eseguire su Neon.
--
-- Descrizione completa dei dati di prova: tests/README_DATI_DI_PROVA.md
-- =====================================================================

-- Osservazione 2: Luca (iscrizione 2), attività 1, un solo criterio valutato.
-- Osservazione 3: Anna (iscrizione 1), attività 2 (stesso nucleo "Numeri").
INSERT INTO osservazioni (attivita_id, iscrizione_id, docente_id, data_osservazione) VALUES
  (1, 2, 1, '2025-10-01'),
  (2, 1, 1, '2025-10-08');

INSERT INTO valutazioni_criteri (osservazione_id, criterio_id, punteggio) VALUES
  (2, 1, 2),  -- Luca, "Correttezza numerica" = 2 (tutti gli altri criteri: Non valutato)
  (3, 1, 1);  -- Anna, "Correttezza numerica" = 1 (con lo 0 dell'attività 1: Caso E, 1/4 = 25%)
