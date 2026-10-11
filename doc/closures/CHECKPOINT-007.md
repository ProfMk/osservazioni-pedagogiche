## CHECKPOINT 007 — Verifica dello schema sul database Neon (11/10/2026)

**Riferimento al piano:** nessuno (verifica dello stato; chiude punti del CHECKPOINT 002).

**Ramo e commit:** `visual-grammar-v2`, HEAD `218ef6a` (anche su `origin`).
Nessun codice è cambiato dopo `623fada`: gli ultimi esiti noti restano
`npm test` 132/132 e `npm run test:e2e` 14/14 (CHECKPOINT 006).

**Natura di questa voce:** primo controllo sul database reale. Eseguito con uno
script locale di sola lettura, `verifica-schema.js` (non versionato, escluso con
`.git/info/exclude`). Ogni controllo gira in una transazione `READ ONLY`
sempre annullata. Il database interrogato è **Neon**.

### Esiti
| # | Controllo | Esito |
|---|---|---|
| 1 | Indici `uq_assessment_criterio`, `uq_assessment_materia`, `uq_observation_scale_default` | **Parziali**, con il predicato giusto (`WHERE criterion_id IS NOT NULL`, `IS NULL`, `school_level_id IS NULL`). L'esportazione del CHECKPOINT 002 ne aveva perso la condizione |
| 2 | Hashing delle password | **argon2id** su tutti gli 8 account; nessun account senza hash |
| 3 | Email duplicate per maiuscole | **0 gruppi** |
| 4 | Vincolo `fk_tenant_lingua_predefinita_abilitata` | **DEFERRABLE INITIALLY DEFERRED**: la creazione di un tenant funziona; l'esportazione ne aveva perso l'attributo |
| 5a | Trigger | **Uno solo**: `trg_teaching_struttura_immutabile` su `teachings` |
| 5b | RLS | **Disattivata su tutte le 30 tabelle** |
| 5c | `app_role` su `audit_log` | `UPDATE` e `DELETE` **negati**: append-only confermato su Neon |
| 6 | Tabelle di tracciamento delle migration | **Nessuna** |

I nomi delle 30 tabelle elencate da Neon coincidono con quelli dell'esportazione
del CHECKPOINT 002: l'esportazione verosimilmente viene da questo database
`[da confermare]`. Comprendono `languages`, `catalog_overrides`,
`content_translations` e `tenant_languages`: la migrazione 003 della V2 è
quindi applicata su Neon, verificata per effetto.

### Rilievi del CHECKPOINT 002: stato aggiornato
- **Chiusi:** indici parziali (4), algoritmo di hashing, vincolo circolare,
  database di origine.
- **Email case-sensitive (1):** oggi nessun duplicato, ma il database non
  impedisce che ne nascano (nessun indice su `lower(email)`). Dipende da una
  normalizzazione nel codice `[da verificare]`.
- **Invariati:** conservazione dei dati degli alunni nell'audit (2),
  `role_assignments` senza unicità né legame con la Membership (3), e tutti i
  rilievi di priorità media e bassa.

### Nuovi rilievi
1. **Nessuna RLS: l'isolamento tra tenant in lettura è solo applicativo.** Il
   database impedisce collegamenti incrociati tra tenant nelle scritture (chiavi
   esterne composite), ma una query che dimentichi il filtro `tenant_id` non
   verrebbe fermata da nulla. I test di isolamento coprono i percorsi
   attuali. Se e come aggiungere la RLS (con `app_role` e una variabile di
   sessione per transazione) è una decisione tecnica da prendere prima di usare
   dati reali di più scuole.
2. **Un solo trigger.** Nessun trigger aggiorna `updated_at` su `observations` e
   `assessments`: resta a carico dell'applicazione `[da verificare nel codice]`.
3. **Nessun registro delle migration applicate.** Non c'è modo, nel database, di
   sapere quali migration sono state eseguite. La 003 è verificata per effetto;
   per 001 e 002 serve guardare cosa creano i file in `migrations/`.
4. **Avviso di sicurezza della libreria `pg`:** le modalità `sslmode`
   `prefer/require/verify-ca` oggi valgono come `verify-full`; nella prossima
   versione maggiore cambieranno e saranno più deboli. Per mantenere il
   comportamento attuale va scritto `sslmode=verify-full` nell'indirizzo del
   database.
5. **`.env` contiene credenziali** (6 variabili caricate dallo script). Va
   verificato che non sia tracciato e non sia mai stato committato `[da
   verificare]`.

### Decisioni da registrare (tecniche)
- Adottare o no la RLS (rilievo 1).
- Introdurre una tabella `schema_migrations` oppure annotare nei checkpoint le
  migration applicate per ogni database (rilievo 3).
- Indice univoco su `lower(email)` oppure normalizzazione garantita nel codice.

### Aperto
- Le cinque decisioni pedagogiche del CHECKPOINT 002 e D2, D4, D6, D5 (004).
- Elenco e contenuto delle migration 001 e 002.
- Verifica di `.env` e dell'indirizzo del database (rilievi 4 e 5).
- Specifica della V2 non ancora in `doc/`; passi 1–2 e fase A.
- Riga di stato in testa alla specifica v2.6; dataset da rileggere con la
  Regola B.
- Unione del ramo in `main` e sincronizzazione della knowledge base.

### Prossimo passo
1. Verificare che `.env` non sia mai stato committato:
   `git check-ignore -v .env` e `git log --all --oneline -- .env`.
2. Elencare `migrations/` e stabilire quali sono applicate su Neon.
3. Decidere su RLS e tracciamento delle migration.
4. Mettere in `doc/` la specifica della V2.
