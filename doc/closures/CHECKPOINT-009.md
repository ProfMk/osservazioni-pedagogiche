## CHECKPOINT 009 — Unione in `main` e conformità alla chiusura V1.1 (11/10/2026)

**Riferimento al piano:** chiusura `V1.1_Final_Security_Database_Integrity_Closure.md` (decisioni congelate 1–7).

**Ramo e commit:** `main`, HEAD `4d19432` (commit di unione, anche su `origin`).
`main` precedente: `0ff1428`. Punta del ramo unito: `2c96800` (CHECKPOINT 008).

**Esito dei test:** prima dell'unione, sul ramo, `npm run test:all`:
`npm test` 132/132 (22,1 s) ed E2E 14/14 (29,5 s). Dopo l'unione non sono stati
rieseguiti: vale lo stesso esito solo se `git diff --stat main visual-grammar-v2`
è vuoto `[da confermare]`.

**Natura di questa voce:** registra l'unione e confronta lo schema reale con le
decisioni congelate della chiusura V1.1.

### Unione
- `git merge --no-ff visual-grammar-v2` su `main`, push `0ff1428..4d19432`.
- 55 file, +8350 −2699. Entrano: migrazione 003, client V2 (`public/css`,
  `public/js`), catalogo (`server/i18n`), test E2E, i checkpoint 004–008 e
  `CHECKPOINTS.md`, `SPECIFICA_REPORT_PEDAGOGICI_v2.6.md` e
  `doc/VISUAL_GRAMMAR_V2_IMPLEMENTAZIONE.md` (1174 righe). Esce `public/radar.js`.
- Gli avvisi di Windows ("Deletion of directory ... failed", risposta `n`) non
  hanno avuto effetto: `git status` risulta pulito e `main` allineato a `origin`.
- Dopo l'unione la knowledge base del progetto si è aggiornata, ma non elenca
  ancora tutti i file (mancano 004, 008 e `VISUAL_GRAMMAR_V2_IMPLEMENTAZIONE.md`)
  `[da verificare]`.

### Esiti dello script su Neon (CHECKPOINT 008)
- Migrazione 001: 4 ruoli, 17 permessi, 43 assegnazioni, come atteso.
- Proprietario di `audit_log`: `audit_owner`, come previsto dalla 002.
- `app_role` ha DELETE, INSERT, SELECT, UPDATE su `roles`, `permissions` e
  `role_permissions` (rilievo del CHECKPOINT 008 confermato, ancora da decidere).

### Conformità alle decisioni congelate della chiusura V1.1
| # | Decisione | Stato |
|---|---|---|
| 1 | Token di sessione: solo `SHA-256` in `sessions.token_hash`, univoco | Conforme (`char(64)`, UNIQUE) |
| 2 | Immutabilità dei riferimenti strutturali, con trigger | **Parziale**: vedi sotto |
| 3 | `activeTenantId` solo contesto per lo scope PLATFORM | Conforme (test su platform admin e cambio tenant) |
| 4 | Scritture solo su anno scolastico `attivo` | **Nessun test** tra i 132 `[da verificare nel codice]` |
| 5 | `audit_log` di `audit_owner`; `app_role` solo INSERT e SELECT | Conforme, verificato su Neon |
| 6 | Ogni FK composita ha un candidate key | Conforme (lo schema compila); coerenza con **FK composte invece dei tre trigger** previsti dal documento, scelta dichiarata nella 000 |
| 7 | RESTRICT su ogni relazione, nessun CASCADE | Conforme (nessun `ON DELETE` nel DDL; test RESTRICT) |

### Decisione 2: cosa manca
Il documento prevede sei trigger di immutabilità (Regola 2: immutabili quando
esistono righe figlie) e, per `tenant_id` e `school_year_id`, immutabilità
sempre (Regola 1). Su Neon esiste **un solo trigger**, su `teachings`, e la sua
funzione controlla solo `class_id`, `subject_id` e `school_year_id`. Le FK
composte coprono una parte del resto; restano scoperti:

1. **`teachings.account_id`**: il documento lo elenca tra le colonne
   immutabili, il trigger no. Con attività esistenti, un UPDATE può passare
   un Teaching, e tutte le sue attività storiche, a un altro docente.
2. **`enrollments.student_person_id`**: nessuna FK delle osservazioni lo
   include; con osservazioni esistenti, un UPDATE può cambiare lo studente a
   cui appartengono. È il rilievo più delicato (dati di minori).
3. **`classes.school_level_id`** e **`subjects.school_level_id`**: non fanno
   parte delle chiavi referenziate; modificabili con figli.
4. **`pedagogical_units.subject_id`**: bloccato dalle attività (FK), non dai
   soli criteri.
5. **Regola 1** (`tenant_id`, `school_year_id` immutabili sempre): imposta dalle
   FK solo per le righe che hanno figli.

Coperti dalle FK composte: `enrollments.class_id` e `school_year_id` con
osservazioni, `criteria.pedagogical_unit_id` con osservazioni o valutazioni,
`pedagogical_units.subject_id` con attività. `app_role` ha UPDATE su tutte
queste tabelle.

### Cambiamenti di modello confermati dalla chiusura
- Nomi: `insegnamenti`→`teachings`, `attivita`→`activities`,
  `nuclei_tematici`→`pedagogical_units`, `criteri_osservazione`→`criteria`,
  `iscrizioni`→`enrollments`, `materie`→`subjects`,
  `anni_scolastici`→`school_years`, `persone`→`people`,
  `docente_id`→`account_id`.
- `osservazioni` e `valutazioni_criteri` sono diventate **una sola tabella
  `observations`, una riga per criterio**. "Non valutato" resta l'assenza della
  riga. La nota passa da livello alunno/attività a livello criterio.
- `anni_scolastici.attivo` (booleano) è ora `school_years.stato`
  (`attivo`/`chiuso`).
- Il vincolo di coerenza di `role_assignments` per PLATFORM, che la chiusura
  dava ancora come aperto, ora esiste (`ck_role_assignment_scope_coerente`).

### Cambio di classe a metà anno
Il CHECKPOINT 002 chiedeva come spostare uno studente. La chiusura non lo
risolve: stabilisce che `classe_id` di un'iscrizione è immutabile con
osservazioni e che il cambiamento si fa "creando un nuovo record", ma
l'iscrizione è unica per studente e anno. Le due regole insieme rendono il
trasferimento impossibile. Resta una **decisione pedagogica aperta**.

### Specifiche: numerazione
La chiusura rimanda al "Blueprint v1.1" (sezioni A–I, Gap 1–8, "Model Freeze"),
non a "sez. N". Le "sez. N" delle migration e dei test potrebbero venire da una
numerazione successiva `[da confermare]`. Nessuno di questi documenti, né quelli
della V2 (§/P/C/E), è tra i file letti. Da aprire:
`doc/VISUAL_GRAMMAR_V2_IMPLEMENTAZIONE.md`, per vedere se contiene passi, fasi
e riferimenti della V2.

### Aperto
- Implementare le immutabilità mancanti (decisione 2) e la regola di scrittura
  su anno attivo (decisione 4), con test per ogni tabella: modifica riuscita
  senza figli, rifiutata con figli.
- Regola per il cambio di classe a metà anno.
- Privilegi di `app_role` su ruoli e permessi; RLS; registro delle migration.
- Le decisioni pedagogiche del CHECKPOINT 002 e D2, D4, D6, D5 (004).
- Contenuto di `VISUAL_GRAMMAR_V2_IMPLEMENTAZIONE.md`; Blueprint v1.1 e chiusure
  precedenti; passi 1–2 e fase A.
- `.env`: `git log --all --oneline -- .env` non ancora riportato.

### Prossimo passo
1. `git diff --stat main visual-grammar-v2`: se vuoto, l'esito dei test vale per
   `main`.
2. Preparare l'iterazione sulle immutabilità (punti 1–5) e sulla regola
   dell'anno attivo, con i test.
3. Aprire un ramo nuovo da `main` per questo lavoro.
