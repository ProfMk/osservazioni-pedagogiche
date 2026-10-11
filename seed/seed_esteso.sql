-- =====================================================================
-- seed_esteso.sql — dati di esempio ESTESI per provare le viste V2
--
-- Da eseguire DOPO l'intera catena:
--   migrations/000 → 001 → 002 → 003 → seed/seed_multitenant.sql
-- con lo stesso ruolo usato per il seed di base (owner del database).
-- Solo sviluppo/collaudo: MAI su un database con dati reali.
--
-- Tenant Alfa, anno 2026/2027, tutto deterministico (nessun random):
--   2A  +20 alunni (22 in tutto), Matematica: 11 attività su 3 nuclei;
--       Italiano: 3 attività. Profili diversi (forte, buono, medio,
--       fragile, in crescita, in calo). REL-2 è volutamente difficile per
--       tutta la classe → blocco "Da guardare" del quadro classe.
--       Alcune assenze, alcune note, valutazioni del primo quadrimestre.
--       Un alunno con iscrizione poi DISATTIVATA → esclusioni motivate.
--   2B  +16 alunni (18 in tutto), Matematica: 9 attività, livelli
--       complessivamente bassi → difficoltà generalizzata della classe.
--
-- Idempotenza: se l'attività marcatore esiste già, lo script non fa nulla.
-- È un unico blocco DO: o si applica tutto o niente.
-- =====================================================================

DO $seed$
DECLARE
  v_tenant   bigint := (SELECT id FROM tenants WHERE slug = 'alfa');
  v_anno     bigint;
  v_scala    bigint;
  v_mat      bigint;
  v_ita      bigint;
  v_2a       bigint;
  v_2b       bigint;
  v_doc_mat  bigint := (SELECT id FROM accounts WHERE email = 'teacher.math.a@alfa.test');
  v_doc_ita  bigint := (SELECT id FROM accounts WHERE email = 'teacher.italian.a@alfa.test');
  v_periodo  bigint;

  nomi    text[] := ARRAY['Giulia','Marco','Sofia','Luca','Aurora','Matteo','Alice','Leonardo','Ginevra','Tommaso',
                          'Emma','Francesco','Beatrice','Lorenzo','Chiara','Davide','Martina','Riccardo','Greta','Edoardo',
                          'Noemi','Pietro','Viola','Gabriele','Anna','Samuele','Elena','Filippo','Irene','Nicolò',
                          'Bianca','Andrea','Camilla','Simone','Rebecca','Diego'];
  cognomi text[] := ARRAY['Rossi','Bianchi','Romano','Colombo','Ricci','Marino','Greco','Bruno','Gallo','Conti',
                          'De Luca','Mancini','Costa','Giordano','Rizzo','Lombardi','Moretti','Barbieri','Fontana','Santoro',
                          'Mariani','Rinaldi','Caruso','Ferrara','Galli','Martini','Leone','Longo','Gentile','Martinelli',
                          'Vitale','Lombardo','Serra','Coppola','De Santis','Fabbri'];

  -- Attività: classe, materia, nucleo, nome, data.
  attivita text[][] := ARRAY[
    ['2A','Matematica','Numeri',                      'Conta e confronta',              '2026-09-21'],
    ['2A','Matematica','Spazio e figure',             'Percorsi in palestra',           '2026-09-28'],
    ['2A','Matematica','Relazioni, dati e previsioni','Classifichiamo i bottoni',       '2026-10-12'],
    ['2A','Matematica','Numeri',                      'Decine e unità con l''abaco',    '2026-10-26'],
    ['2A','Matematica','Spazio e figure',             'Caccia alle figure',             '2026-11-09'],
    ['2A','Matematica','Relazioni, dati e previsioni','Il grafico delle merende',       '2026-11-23'],
    ['2A','Matematica','Numeri',                      'Addizioni in colonna',           '2026-12-07'],
    ['2A','Matematica','Spazio e figure',             'Simmetrie con la carta',         '2026-12-14'],
    ['2A','Matematica','Relazioni, dati e previsioni','Sondaggio di classe',            '2027-01-11'],
    ['2A','Matematica','Relazioni, dati e previsioni','Probabile o impossibile?',       '2027-01-20'],
    ['2A','Matematica','Numeri',                      'Problemi con le monete',         '2027-01-25'],
    ['2A','Italiano',  'Lettura e comprensione',      'La fiaba del lupo',              '2026-10-01'],
    ['2A','Italiano',  'Lettura e comprensione',      'Leggere un avviso',              '2026-11-16'],
    ['2A','Italiano',  'Lettura e comprensione',      'Lettura ad alta voce',           '2027-01-18'],
    ['2B','Matematica','Numeri',                      'Conta e confronta',              '2026-09-22'],
    ['2B','Matematica','Spazio e figure',             'Percorsi in palestra',           '2026-10-06'],
    ['2B','Matematica','Numeri',                      'Decine e unità con l''abaco',    '2026-10-27'],
    ['2B','Matematica','Relazioni, dati e previsioni','Classifichiamo i bottoni',       '2026-11-17'],
    ['2B','Matematica','Relazioni, dati e previsioni','Il grafico delle merende',       '2026-11-24'],
    ['2B','Matematica','Spazio e figure',             'Caccia alle figure',             '2026-12-01'],
    ['2B','Matematica','Spazio e figure',             'Simmetrie con la carta',         '2026-12-15'],
    ['2B','Matematica','Numeri',                      'Addizioni in colonna',           '2027-01-12'],
    ['2B','Matematica','Relazioni, dati e previsioni','Sondaggio di classe',            '2027-01-19']
  ];

  i int; s int; k int;
  r record; c record;
  v_persona bigint; v_iscr bigint; v_classe bigint; v_materia bigint; v_unita bigint;
  v_teaching bigint; v_doc bigint; v_att bigint; v_inattivo bigint;
  profilo int; base numeric; obiettivo numeric; rumore numeric; valore int; indice_att int;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'seed_esteso: eseguire prima seed/seed_multitenant.sql (tenant alfa assente)';
  END IF;
  IF EXISTS (SELECT 1 FROM activities WHERE tenant_id = v_tenant AND nome = 'Problemi con le monete') THEN
    RAISE NOTICE 'seed_esteso: già applicato, nessuna modifica';
    RETURN;
  END IF;

  v_anno    := (SELECT id FROM school_years WHERE tenant_id = v_tenant AND nome = '2026/2027');
  v_scala   := (SELECT id FROM observation_scales WHERE tenant_id = v_tenant AND school_level_id IS NULL);
  v_mat     := (SELECT id FROM subjects WHERE tenant_id = v_tenant AND nome = 'Matematica');
  v_ita     := (SELECT id FROM subjects WHERE tenant_id = v_tenant AND nome = 'Italiano');
  v_2a      := (SELECT id FROM classes WHERE tenant_id = v_tenant AND nome = '2A');
  v_2b      := (SELECT id FROM classes WHERE tenant_id = v_tenant AND nome = '2B');
  v_periodo := (SELECT id FROM assessment_periods WHERE tenant_id = v_tenant AND nome = 'Primo quadrimestre');

  -- ------------------------------------------------------------------
  -- Alunni: 20 in 2A (indici 1..20), 16 in 2B (indici 21..36).
  -- ------------------------------------------------------------------
  FOR s IN 1..36 LOOP
    INSERT INTO people (tenant_id, nome, cognome) VALUES (v_tenant, nomi[s], cognomi[s]) RETURNING id INTO v_persona;
    INSERT INTO enrollments (tenant_id, school_year_id, class_id, student_person_id)
    VALUES (v_tenant, v_anno, CASE WHEN s <= 20 THEN v_2a ELSE v_2b END, v_persona);
  END LOOP;

  -- ------------------------------------------------------------------
  -- Attività e osservazioni.
  -- ------------------------------------------------------------------
  FOR i IN 1..array_length(attivita, 1) LOOP
    v_classe  := CASE attivita[i][1] WHEN '2A' THEN v_2a ELSE v_2b END;
    v_materia := CASE attivita[i][2] WHEN 'Matematica' THEN v_mat ELSE v_ita END;
    v_doc     := CASE attivita[i][2] WHEN 'Matematica' THEN v_doc_mat ELSE v_doc_ita END;
    v_unita   := (SELECT id FROM pedagogical_units WHERE tenant_id = v_tenant AND subject_id = v_materia AND nome = attivita[i][3]);
    v_teaching := (SELECT id FROM teachings WHERE tenant_id = v_tenant AND class_id = v_classe AND subject_id = v_materia AND account_id = v_doc);

    INSERT INTO activities (tenant_id, school_year_id, teaching_id, class_id, subject_id, pedagogical_unit_id, nome, data_attivita, lingua_contenuto)
    VALUES (v_tenant, v_anno, v_teaching, v_classe, v_materia, v_unita, attivita[i][4], attivita[i][5]::date, 'it')
    RETURNING id INTO v_att;

    -- Posizione dell'attività nel tempo della sua classe/materia (0 = prima), per i profili che cambiano.
    indice_att := (SELECT count(*) FROM activities a WHERE a.tenant_id = v_tenant AND a.class_id = v_classe
                   AND a.subject_id = v_materia AND a.data_attivita < attivita[i][5]::date
                   AND a.nome <> 'Numeri entro il cento' AND a.nome <> 'Lettura silenziosa');

    FOR r IN
      SELECT e.id AS iscrizione, p.nome, p.cognome,
             array_position(nomi, p.nome) AS idx
      FROM enrollments e JOIN people p ON p.id = e.student_person_id
      WHERE e.tenant_id = v_tenant AND e.class_id = v_classe AND e.school_year_id = v_anno
        AND array_position(nomi, p.nome) IS NOT NULL
        AND p.cognome = cognomi[array_position(nomi, p.nome)]
    LOOP
      s := r.idx;
      -- Assenze deterministiche (~1 su 9).
      CONTINUE WHEN (s * 13 + i * 7) % 9 = 0;

      -- Profili: 0 forte, 1 buono, 2 medio, 3 fragile, 4 in crescita, 5 in calo.
      profilo := s % 6;
      base := CASE profilo
                WHEN 0 THEN 1.85 WHEN 1 THEN 1.55 WHEN 2 THEN 1.20 WHEN 3 THEN 0.55
                WHEN 4 THEN 0.40 + 0.22 * indice_att
                ELSE        1.90 - 0.22 * indice_att
              END;
      -- 2B: classe complessivamente in difficoltà.
      IF v_classe = v_2b THEN base := base - 0.75; END IF;

      FOR c IN
        SELECT id, codice FROM criteria WHERE tenant_id = v_tenant AND pedagogical_unit_id = v_unita ORDER BY ordine
      LOOP
        obiettivo := base;
        -- REL-2 "Dati e rappresentazioni": difficile per tutta la 2A.
        IF c.codice = 'REL-2' AND v_classe = v_2a THEN obiettivo := obiettivo - 1.00; END IF;
        -- SPA-1 un po' più facile.
        IF c.codice = 'SPA-1' THEN obiettivo := obiettivo + 0.30; END IF;
        k := (SELECT ordine FROM criteria WHERE id = c.id);
        rumore := (((s * 37 + k * 11 + i * 17) % 7) - 3) * 0.17;
        valore := greatest(0, least(2, round(obiettivo + rumore)::int));

        INSERT INTO observations (tenant_id, school_year_id, activity_id, enrollment_id, class_id, criterion_id,
                                  pedagogical_unit_id, scale_id, valore, recorded_by_account_id, data_osservazione,
                                  note, lingua_nota)
        VALUES (v_tenant, v_anno, v_att, r.iscrizione, v_classe, c.id, v_unita, v_scala, valore, v_doc,
                attivita[i][5]::date,
                CASE WHEN valore = 0 AND (s + i) % 4 = 0 THEN 'Ha avuto bisogno dei materiali concreti.'
                     WHEN valore = 2 AND (s + i) % 7 = 0 THEN 'Ha spiegato il procedimento ai compagni.' END,
                CASE WHEN (valore = 0 AND (s + i) % 4 = 0) OR (valore = 2 AND (s + i) % 7 = 0) THEN 'it' END);
      END LOOP;
    END LOOP;
  END LOOP;

  -- ------------------------------------------------------------------
  -- Iscrizione disattivata a metà anno (2A, Edoardo Santoro): le sue
  -- osservazioni restano ma sono escluse con EXCLUSION_ENROLLMENT_INACTIVE.
  -- ------------------------------------------------------------------
  UPDATE enrollments SET attiva = false
  WHERE tenant_id = v_tenant AND school_year_id = v_anno
    AND student_person_id = (SELECT id FROM people WHERE tenant_id = v_tenant AND nome = 'Edoardo' AND cognome = 'Santoro');

  -- ------------------------------------------------------------------
  -- Valutazioni del docente, primo quadrimestre, Matematica 2A (i primi 12 alunni).
  -- ------------------------------------------------------------------
  v_teaching := (SELECT id FROM teachings WHERE tenant_id = v_tenant AND class_id = v_2a AND subject_id = v_mat AND account_id = v_doc_mat);
  FOR s IN 1..12 LOOP
    v_iscr := (SELECT e.id FROM enrollments e JOIN people p ON p.id = e.student_person_id
               WHERE e.tenant_id = v_tenant AND p.nome = nomi[s] AND p.cognome = cognomi[s]);
    INSERT INTO assessments (tenant_id, school_year_id, teaching_id, class_id, subject_id, enrollment_id,
                             assessment_period_id, giudizio, recorded_by_account_id, lingua_contenuto)
    VALUES (v_tenant, v_anno, v_teaching, v_2a, v_mat, v_iscr, v_periodo,
            CASE s % 6 WHEN 0 THEN 'OTTIMO' WHEN 1 THEN 'DISTINTO' WHEN 2 THEN 'BUONO'
                       WHEN 3 THEN 'SUFFICIENTE' WHEN 4 THEN 'DISCRETO' ELSE 'BUONO' END,
            v_doc_mat, 'it');
  END LOOP;

  RAISE NOTICE 'seed_esteso: applicato';
END
$seed$;
