## CHECKPOINT 012 — Validazione delle decisioni della migrazione 004 e regole di subentro dei docenti (28/10/2026)

**Riferimento al piano:** CHECKPOINT 011 (`[DECISIONE PROPOSTA]` 1–8).

**Ramo e commit:** `claude/awesome-johnson-ac4qcm`, HEAD `c73920c` (CHECKPOINT
011), due commit davanti a `main` (`103c0ca`). Nessun codice cambiato dopo
`83e9025`: vale l'esito del CHECKPOINT 011 (145/145 e 14/14, PGlite).

**Natura di questa voce:** registra le decisioni del proprietario sulle proposte
del CHECKPOINT 011, che resta invariato. Aggiunge le regole di subentro dei
docenti, emerse nell'analisi della decisione 1, e due rilievi sul codice.

### Esito delle proposte del CHECKPOINT 011
| # | Proposta | Esito |
|---|---|---|
| 1 | `assessments` blocca `teachings`, `enrollments`, `criteria` (blocco pieno, opzione A) | **Validata** dal proprietario, 28/10/2026, dopo l'analisi degli scenari sotto |
| 2 | `school_year_id` sempre immutabile anche su `activities`, `observations`, `assessments`, `assessment_periods` | **Validata**, 28/10/2026 |
| 3 | Anno chiuso: bloccate la creazione di attività e il salvataggio e la cancellazione di osservazioni; lettura libera; traduzioni fuori per ora | **Validata**, 28/10/2026 |
| 4 | Codici `ERR_IMMUTABLE_REFERENCE` e `ERR_SCHOOL_YEAR_CLOSED` (409) e testi italiani | **Validata**, 28/10/2026; i testi si potranno cambiare nel file di traduzione |
| 5 | `audit_log` senza trigger della Regola 1 | Scelta tecnica, raccomandata dalla chat; **nessuna obiezione** del proprietario |
| 6 | Regola 1 su tutte le tabelle con `tenant_id` (persone, account, ruoli compresi) | **Validata**, 28/10/2026 |
| 7 | Ordine dei controlli: 404 e 403 prima del 409 | Scelta tecnica, raccomandata dalla chat; **nessuna obiezione** del proprietario |
| 8 | `FOR SHARE` su `school_years` durante le scritture | Scelta tecnica, raccomandata dalla chat; **nessuna obiezione** del proprietario |

Il ramo può essere unito in `main` (vedi «Prossimo passo»).

### Decisioni pedagogiche `[CONCORDATO]` — proprietario, 28/10/2026
1. **Principio di successione.** Chi subentra, come supplente temporaneo o
   come sostituto definitivo, diventa titolare della materia e ha in carico
   l'alunno: **vede lo storico**. La privacy tra docenti vale tra colleghi in
   parallelo, non nella successione.
2. **Supplenza temporanea (breve o lunga): meccanismo M1, stesso
   insegnamento.** Il supplente riceve il ruolo di docente sull'insegnamento del
   titolare, con un'assegnazione che ha un inizio e viene revocata al rientro.
   Vede tutto lo storico, i risultati proseguono senza interruzione e le sue
   osservazioni restano firmate da lui. Il titolare, al rientro, ritrova anche il
   lavoro del supplente.
3. **Sostituzione definitiva: meccanismo M3, insegnamento nuovo** per il nuovo
   titolare, con lettura dello storico dell'insegnamento precedente. Richiede la
   continuità dei risultati tra insegnamenti diversi (oggi i risultati si
   calcolano per insegnamento): stesso lavoro necessario per il cambio di sezione.
4. **Co-docenza e sostegno** (due docenti insieme, stessa classe e materia):
   **ognuno vede solo le proprie osservazioni**, come oggi (insegnamenti
   separati).
5. **Decisione 1 (blocco pieno, A)**: validata perché con M1 e M3 il docente
   scritto su un insegnamento non va mai cambiato. A impedisce solo il cambio di
   titolare (M2), escluso anche dalla chiusura V1.1.

### Rilievi sul codice `[CODICE]`, letto dalla chat di progetto su `c73920c`
- **I permessi di un docente vengono dalle assegnazioni di ruolo**
  (`role_assignments` con `scope_type = 'TEACHING'`), non da
  `teachings.account_id`: è il meccanismo dei seed. M1 si può quindi realizzare
  senza modificare lo schema.
- **Lacuna per M1:** `getTeachingsPropri` (`server/queries/dominio.js`) elenca
  gli insegnamenti propri (`account_id`) e quelli coperti da scope `PLATFORM`,
  `TENANT`, `SCHOOL_LEVEL`, `CLASS`, ma **non** `TEACHING`. Un supplente con
  un'assegnazione sull'insegnamento del titolare avrebbe i permessi
  (`haPermesso` copre `TEACHING`), ma non vedrebbe l'insegnamento nel suo elenco.
- **Autore delle attività:** `activities` non ha una colonna per chi l'ha creata
  e la creazione non è registrata in `audit_log` (gli `registraAudit` coprono
  osservazioni, assegnazioni di ruolo, traduzioni, tenant). Con M1 due docenti
  creano attività nello stesso insegnamento: senza autore non si distingue il
  lavoro del supplente. Osservazioni e giudizi registrano invece l'autore
  (`recorded_by_account_id`).

### Aperto (nuovo o modificato)
- **Firma dello scrutinio in supplenza lunga:** chi firma i giudizi del periodo.
  Questione normativa, non risolta `[da verificare con la normativa]`.
- **Docente uscente:** dopo il subentro, conserva la lettura del proprio lavoro
  passato? `[da decidere]`
- **Continuità dei risultati tra insegnamenti diversi** (M3 e cambio di sezione)
  e **continuità con supplente o nuovo docente**: rinviata dal proprietario
  all'iterazione sui movimenti.
- **Iterazione sui movimenti di alunni e docenti**, che ora comprende:
  - M1: assegnazione temporanea, elenco degli insegnamenti con scope
    `TEACHING`, autore delle attività;
  - M3: insegnamento nuovo, lettura dello storico, continuità;
  - cambio di sezione: seconda iscrizione nello stesso anno, snapshot per
    periodo;
  - promozione anticipata.
- Restano aperti tutti i punti del CHECKPOINT 011 non toccati qui (indici,
  Neon, piano punti 2–5).

### Prossimo passo
1. Commit di questo checkpoint sul ramo `claude/awesome-johnson-ac4qcm`.
2. Unione in `main` (`git merge --no-ff`), `npm run test:all` su `main`.
   Criterio: 145/145 e 14/14. Push di `main`.
3. Su Neon: ramo di backup, poi la 004 dall'SQL Editor. Criterio: 26 trigger
   `trg_%immutabil%`.
4. Registrare unione ed esito su Neon nel CHECKPOINT 013.
