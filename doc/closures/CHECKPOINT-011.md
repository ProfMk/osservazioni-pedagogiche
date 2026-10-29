## CHECKPOINT 011 — Immutabilità strutturale (migrazione 004) e scritture solo su anno attivo (28/10/2026)

**Riferimento al piano:** chiusura `V1.1_Final_Security_Database_Integrity_Closure.md`,
decisioni congelate 2 (immutabilità) e 4 (scritture solo su anno attivo);
punti aperti dei CHECKPOINT 009 e 010.

**Ramo e commit:** `claude/awesome-johnson-ac4qcm`, creato da `main` a `103c0ca`
(CHECKPOINT 010). Un commit: `83e9025` («Immutabilità strutturale (migrazione 004)
e scritture solo su anno attivo»). `main` **non** è stato toccato; nessuna unione.
Il ramo è stato creato dalla sessione cloud di Claude Code, che ne ha scelto il
nome al posto di `immutabilita-v1-1` (consentito dal prompt).

**Esito dei test a `83e9025`** (PGlite, in due ambienti cloud distinti):
| Chi | `npm test` | E2E | Note |
|---|---|---|---|
| Claude Code (sessione cloud) | 145/145, 18,2 s | 14/14, 18,8 s | `npm run test:all`, 37,5 s |
| Chat di progetto (verifica indipendente) | 145/145, 30,6 s | 14/14, 17,8 s | `npm ci`, poi `npm test` e `npm run test:e2e` |

145 = i 132 esistenti + 13 nuovi in `tests/immutabilita.test.js`. Nessuna
asserzione esistente modificata.

**Natura di questa voce:** resoconto dell'iterazione eseguita da Claude Code,
con verifica indipendente del ramo e registrazione delle decisioni del
proprietario sui movimenti degli alunni.

### Fatto (7 file, +772 −7)
| File | Cosa |
|---|---|
| `migrations/004_immutabilita_strutturale.sql` (nuovo) | Trigger della Regola 1 e della Regola 2, `ERRCODE = 'restrict_violation'` (23001). Transazione unica, rieseguibile |
| `server/routes/index.js` | 23001 → **409** `ERR_IMMUTABLE_REFERENCE`; il gestore errori è esportato come `gestoreErrori` per il test |
| `server/queries/dominio.js` | `verificaAnnoScolasticoAttivo` (con `FOR SHARE`) in `creaActivity` e `salvaObservation`, compreso il ramo di cancellazione → 409 `ERR_SCHOOL_YEAR_CLOSED` |
| `server/i18n/catalogo/it.json` | Testi italiani dei due codici nuovi |
| `tests/immutabilita.test.js` (nuovo) | 13 test |
| `tests/support/pglite.js` | La 004 entra nei database `completo` ed `esteso` |
| `package.json` | Il file di test nuovo entra in `test` e `test:integration` |

### Trigger creati `[CODICE]`
**Regola 2** (immutabili solo con figli; 6 trigger `*_struttura_immutabile`):
| Tabella | Colonne | Figli che bloccano |
|---|---|---|
| `teachings` (funzione della 000 sostituita) | `account_id`, `class_id`, `subject_id`, `school_year_id` | `activities`, `assessments` |
| `enrollments` | `student_person_id`, `class_id`, `school_year_id` | `observations`, `assessments` |
| `classes` | `school_level_id` | `teachings`, `enrollments` |
| `subjects` | `school_level_id` | `pedagogical_units` |
| `pedagogical_units` | `subject_id` | `criteria`, `activities` |
| `criteria` | `pedagogical_unit_id` | `observations`, `assessments` |

`enrollments.attiva` non è protetta: disattivare un'iscrizione con osservazioni
resta possibile (test dedicato).

**Regola 1** (immutabili sempre; 20 trigger `*_riferimenti_immutabili`, una
funzione generica): `tenant_id` su `activities`, `assessment_periods`,
`assessments`, `catalog_overrides`, `classes`, `content_translations`,
`criteria`, `enrollments`, `judgment_bands`, `memberships`,
`observation_scales`, `observations`, `pedagogical_units`, `people`,
`role_assignments`, `school_levels`, `school_years`, `subjects`, `teachings`,
`tenant_languages`. In più `school_year_id` su `subjects`, `pedagogical_units`,
`criteria`, `activities`, `observations`, `assessments`, `assessment_periods`.
Esclusa `audit_log`.

Totale atteso dopo l'applicazione: **26 trigger** con nome `trg_%immutabil%`.

### Verificato
- **Suite completa verde** a `83e9025`, in due ambienti (tabella sopra).
- **Prova a contrario** (chat di progetto): senza la 004 nei database di prova,
  `tests/immutabilita.test.js` dà 3 passati e **10 falliti** su 13; coincide con
  quanto riportato da Claude Code. Secondo Claude Code, senza il controllo
  dell'anno attivo fallisce il test sull'anno chiuso `[non rieseguito qui]`.
- **Rieseguibilità** (Claude Code): la 004 applicata due volte dà ancora 26
  trigger e i seed passano `[non rieseguito qui]`.
- **Sotto `app_role`**: i trigger funzionano (verificato da un test).
- **Nessun percorso modifica le colonne protette** (Claude Code, ricerca degli
  `UPDATE` in `server/`, `seed/`, `tests/`). L'upsert delle osservazioni
  aggiorna solo `valore`, `updated_at` e `recorded_by_account_id`, quindi non
  attiva la Regola 1 `[CODICE, letto qui]`.
- **Transazioni** `[CODICE, letto qui]`: creazione di attività e salvataggio di
  osservazioni girano dentro `transazione(...)`, quindi il `FOR SHARE`
  sull'anno ha effetto.
- **Riga `[errore]` con `ar-XB`: chiusa.** Viene da `PUT /api/admin/traduzioni`
  (FK 23503 su `content_translations`) nel test di `lingua.test.js` che tenta
  una traduzione su un nucleo di un altro tenant e si aspetta 400. È un caso
  negativo atteso. Le due righe `[errore]` nuove con `endpoint: "/finto"` e
  codice 23001 vengono dal test del gestore errori e sono attese anch'esse.
- **Altre verifiche del CHECKPOINT 009/010, chiuse dalla chat di progetto il
  11/10/2026 su un clone di GitHub:**
  - `git diff --stat main visual-grammar-v2`: cambiava solo
    `CHECKPOINT-009.md`, quindi gli esiti 132/132 e 14/14 valevano per `main`.
  - `git log --all --oneline -- .env`: vuoto su tutti i rami remoti; `.env` è
    in `.gitignore`. I rami solo locali non sono verificabili da qui.
  - `claude/vigilant-hamilton-g1n5rh`: un commit non presente in `main`,
    `03b62b7` («feat: report globale della classe (Fase 5)»).
- **Neon:** nulla eseguito. La 004 **non** è applicata.

### Decisioni pedagogiche `[CONCORDATO]` — proprietario, 11/10/2026
Movimenti degli alunni durante l'anno. Registrate qui, **non implementate**.
1. Un alunno può cambiare sezione durante l'anno (motivi socio-affettivi, di
   integrazione). Raramente può esserci una promozione anticipata.
2. Un alunno che lascia la scuola: si disattiva l'iscrizione. Un alunno che
   arriva: si crea la persona e un'iscrizione attiva.
3. Trasferimento tra due scuole che usano entrambe l'applicazione: nella nuova
   scuola si crea un record nuovo; i tenant non comunicano.
4. **Continuità del risultato:** nella nuova sezione il risultato corrente
   dell'alunno tiene conto anche delle osservazioni raccolte nella vecchia.
5. **Privacy dei docenti, senza eccezioni:** ogni docente vede il dettaglio
   (attività, punteggi, note) solo delle proprie osservazioni. I risultati
   mostrano il livello pedagogico raggiunto fino a quel momento, calcolato su
   tutte le osservazioni dell'alunno.
6. **Report di classe:** l'alunno compare nella classe attuale. La vecchia
   classe ne conserva una «foto». Il periodo di valutazione crea virtualmente
   uno snapshot dello stato di ogni studente in ogni materia.
7. **Promozione anticipata:** caso rarissimo; la gestione, anche sotto il
   profilo legale, è **da decidere**.

### Scelte tecniche
**[CONCORDATO]** (chiusura V1.1 §3, §5, §14): Regola 1, Regola 2 con le colonne
della chiusura, errore 23001 tradotto in 409, nuovo record invece di modifica,
scrittura solo su anno `attivo` con lettura libera su tutti gli anni.

**[DECISIONE PROPOSTA] — da validare dal proprietario** (applicate da Claude
Code come scritte nel prompt, o decise da lui dove indicato):
1. `assessments` come figlio che blocca `teachings`, `enrollments` e `criteria`
   (tabella nata dopo la chiusura).
2. Regola 1 estesa: `school_year_id` sempre immutabile anche su `activities`,
   `observations`, `assessments`, `assessment_periods`.
3. Perimetro dell'anno attivo: creazione di attività; salvataggio e
   cancellazione di osservazioni. `/admin/traduzioni` e `role-assignments`
   restano fuori.
4. Codici `ERR_IMMUTABLE_REFERENCE` e `ERR_SCHOOL_YEAR_CLOSED`, entrambi 409, e
   i loro testi italiani:
   - «Questo riferimento non si può più modificare perché ci sono già dati
     collegati: crea un nuovo elemento.»
   - «L'anno scolastico è chiuso: i dati si possono consultare ma non
     modificare.»
5. *(Claude Code)* `audit_log` esclusa dalla Regola 1: è già append-only per
   privilegi, e un trigger richiederebbe di operare come `audit_owner`.
6. *(Claude Code)* Regola 1 su **tutte** le tabelle con `tenant_id`, comprese
   `people`, `memberships`, `role_assignments` e le tabelle di lingua. Una
   persona con `tenant_id` NULL non può poi essere assegnata a un tenant.
7. *(Claude Code)* Ordine dei controlli: 404 e 403 prima del 409; su un anno
   chiuso anche una richiesta non valida riceve 409.
8. *(Claude Code)* `FOR SHARE` su `school_years`, per impedire che l'anno venga
   chiuso mentre una scrittura è in corso.

### Rilievi della chat di progetto
- **`FOR SHARE` richiede a `app_role` il privilegio UPDATE su `school_years`**
  (regola di PostgreSQL per `SELECT … FOR SHARE`). Oggi `app_role` ha CRUD, quindi
  funziona. Quando si ridurranno i privilegi di `app_role` (piano, punto 2),
  `school_years` dovrà conservare UPDATE, o il `FOR SHARE` andrà sostituito;
  altrimenti tutte le scritture pedagogiche falliranno.
- **Rieseguire la 004 non rimuove trigger.** Se una delle decisioni proposte
  venisse cambiata dopo l'applicazione su Neon, servirebbe una migration nuova
  con `DROP TRIGGER` espliciti.
- **Proprietario delle tabelle su Neon** `[da verificare]`: `CREATE TRIGGER`
  richiede il proprietario della tabella. Se il ruolo dell'SQL Editor non lo è,
  la 004 fallisce e la transazione si annulla senza effetti.
- **Documento V1.1 assente dal repository**: è solo nella knowledge base del
  progetto. Claude Code non l'ha potuto leggere e ha lavorato sulle decisioni
  riportate nel prompt.

### Non toccato di proposito
- Vincolo `UNIQUE (tenant_id, school_year_id, student_person_id)` su
  `enrollments`: oggi impedisce il cambio di sezione con un'iscrizione nuova. I
  trigger nuovi non rendono quella modifica più difficile.
- UI, CSS, viste, motore dei report, seed.
- `main`, `claude/vigilant-hamilton-g1n5rh`, Neon.

### Aperto
- Validazione delle otto `[DECISIONE PROPOSTA]` sopra.
- Unione di `claude/awesome-johnson-ac4qcm` in `main`, poi applicazione della 004
  su Neon con verifica dei 26 trigger.
- Indici per gli `EXISTS` dei trigger, oggi assenti o parziali:
  `teachings(class_id)`, `enrollments(class_id)` (l'indice esistente vale solo
  `WHERE attiva`), `activities(pedagogical_unit_id)`,
  `observations(criterion_id)`, `assessments(criterion_id)`,
  `assessments(teaching_id)`.
- Regola dell'anno attivo su `/admin/traduzioni` e `role-assignments`.
- **Iterazione sui movimenti degli alunni** (decisioni 1–7 sopra): seconda
  iscrizione nello stesso anno (vincolo UNIQUE), continuità del risultato tra
  iscrizioni, snapshot per periodo di valutazione, alunno che cambia sezione a
  metà periodo, promozione anticipata.
- Congelamento di soglie e scale alla chiusura del periodo: ora collegato agli
  snapshot (decisione 6). Se lo snapshot è ricalcolato dalle osservazioni,
  resta stabile solo se soglie e scale non cambiano dopo.
- Aggiungere `V1.1_Final_Security_Database_Integrity_Closure.md` in `doc/`.
- Dal piano, invariati: privilegi di `app_role` su ruoli e permessi; privilegi
  di default per le tabelle future; `sslmode=verify-full`; indice su
  `lower(email)`; RLS; registro delle migration; nota di stato e specifica
  V2.1 rev. 2; decisioni D2, D4, D5, D6; sorte di
  `claude/vigilant-hamilton-g1n5rh`.

### Prossimo passo
1. Il proprietario valida o corregge le `[DECISIONE PROPOSTA]` 1–8.
2. Commit di questo checkpoint **sul ramo** `claude/awesome-johnson-ac4qcm`, così
   arriva in `main` insieme al codice.
3. Unione in `main` (`git merge --no-ff`), poi `npm run test:all` su `main`.
   Criterio: 145/145 e 14/14.
4. Su Neon: ramo di backup, poi la 004 dall'SQL Editor. Criterio: la query
   `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'trg\_%immutabil%';`
   restituisce **26**.
5. Preparare l'iterazione sugli indici (piccola) o quella sui movimenti degli
   alunni (richiede prima le decisioni aperte).
