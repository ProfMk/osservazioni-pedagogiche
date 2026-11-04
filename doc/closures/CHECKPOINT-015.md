## CHECKPOINT 015 — Iterazione 1: creazione di una scuola, primo accesso con password temporanea, scelta dell'istituto (04/11/2026)

**Riferimento al piano:** prima delle quattro iterazioni per preparare una scuola
dall'interfaccia (CHECKPOINT 014, «Prossimo passo»; decisioni del proprietario
del 04/11/2026). Prompt: `prompt-claude-code-iterazione-1-scuola.md` e
`prompt-claude-code-iterazione-1-passo-6.md`.

**Ramo e commit:** `claude/laughing-clarke-1vc5f1`, creato da `main` a `cad4af8`
dalla sessione cloud di Claude Code. Il nome `iterazione-1-scuola` non era
sceglibile. Otto commit, uno per passo:

| Passo | Commit | Contenuto |
|---|---|---|
| 1 | `4a20cf6` | Migration 005 |
| 2 | `008602f` | Cambio password obbligatorio, `POST /api/auth/password`, password mai nei log |
| 3 | `cdcdb2d` | Scuola + primo amministratore in una transazione; reimpostazione |
| 4 | `f501978` | Client: nuova scuola, password mostrata una volta, cambia password |
| 5 | `8fe125b` | E2E del primo accesso; README con la 005 |
| 6a | `0252804` | Selezione automatica dell'istituto al login; ruoli per scuola in `/me` |
| 6b | `a6aa6b3` | Scelta dell'istituto con pulsanti; nessun `<select>` |
| 6c | `823eb49` | E2E della scelta dell'istituto |

Il passo 6 nasce dal test d'uso del proprietario (vedi sotto).

**Esito dei test a `823eb49`:**
| Dove | `npm test` | `npm run test:e2e` |
|---|---|---|
| Computer del proprietario (Windows), comando ufficiale | **181/181** (31,0 s) | **19/19** (30,1 s) |
| Sessione cloud | 181/181 | 19/19, **solo con un accorgimento** fuori dal repository |

Nel cloud `playwright-core` 1.56.1 cerca Chromium rev. 1194, mentre l'ambiente ha
la 1243. Quella del proprietario è quindi la **prima esecuzione ufficiale** degli
E2E di questa iterazione.

181 = 145 preesistenti + 28 di `tests/primoAccesso.test.js` + 8 di
`tests/sceltaIstituto.test.js`. 19 E2E = 14 preesistenti + 5 nuovi.

**Natura di questa voce:** chiude l'iterazione 1. Sostituisce
`doc/closures/LAVORO-IN-CORSO-iterazione-1.md`, rimosso nello stesso commit;
la versione completa resta nella storia di Git a `823eb49`.

### Cosa si può fare ora
- **Il PLATFORM_ADMIN crea una scuola** dall'Amministrazione: nome,
  identificativo, primo amministratore (nome, cognome, email). Tutto avviene in
  una transazione, con audit.
- La **password temporanea** (16 caratteri, valida 7 giorni) si mostra **una
  sola volta**, con «Copia».
- **Al primo accesso il cambio è obbligatorio.** Fino al cambio ogni API
  risponde 403 `ERR_PASSWORD_CHANGE_REQUIRED`, tranne `me`, `password`,
  `logout` e `i18n`.
- **Il PLATFORM_ADMIN può reimpostare** la password di un amministratore
  d'istituto: nuova temporanea, sessioni chiuse, obbligo di cambio di nuovo
  attivo.
- **Chiunque cambia volontariamente** la propria password dal menu. Al cambio
  le altre sessioni si chiudono e il token viene ruotato.
- **Scelta dell'istituto:**
  - con **una sola** scuola si entra direttamente (selezione al login, lato
    server);
  - con **più** scuole compare l'elenco di pulsanti, con nome e ruoli, e
    «Cambia istituto» nell'intestazione;
  - il PLATFORM_ADMIN parte dall'Amministrazione;
  - nessun `<select>` nell'intestazione.

### Migration 005 (`migrations/005_account_primo_accesso.sql`)
- `accounts.deve_cambiare_password boolean NOT NULL DEFAULT false`.
- `accounts.password_temporanea_scade_il timestamptz`.
- Controllo dei doppioni su `lower(email)`: se ne trova, la migration si ferma
  senza applicare nulla.
- Indice univoco `uq_accounts_email_lower`.
- Transazione unica, rieseguibile, nessun GRANT (bastano i privilegi di tabella
  della 002, verificato da un test).

### Verificato
- **Test:** tabella sopra.
- **Prove a contrario** (Claude Code):
  - senza il middleware del cambio obbligatorio, `switch-tenant` risponde 200
    invece di 403 e il test fallisce;
  - senza la selezione automatica falliscono 3 degli 8 test nuovi.
- **Password e hash assenti dall'audit:** un test controlla ogni campo `prima`
  e `dopo`, e un hash inserito apposta viene trovato.
- **Password assenti dai log:** il gestore errori scriveva in console il corpo
  delle richieste, compresa la password del login. Ora ogni campo `*password*`
  compare come `[omessa]`. Visto anche dal proprietario nel log reale del
  04/11/2026.
- **Modifiche a test esistenti** (chat di progetto, `git diff` su GitHub):
  - due asserzioni, entrambe nate dal passo 6 e consentite dal prompt:
    `integration.test.js` «Login: credenziali corrette…» (da `activeTenantId`
    NULL all'id di Alfa) e `lingua.test.js` «C2: login…» (lingua del tenant
    invece di P3; la verifica di P3 passa a `multitenant.user` in un test nuovo);
  - negli E2E, le righe con `selectOption('#tenant')`.

  Nessun'altra asserzione esistente è cambiata.
- **Test d'uso** (proprietario, 04/11/2026):
  - **ambiente:** `localhost`, ramo a `8fe125b`, database sul ramo Neon
    **`test-iterazione-1`** (genitore `v2-visual-grammar`), con la 005
    applicata;
  - creazione della scuola, primo accesso e blocco della password temporanea
    dopo l'uso: **funzionano**;
  - password corte e password che non coincidono: **bloccate**;
  - **problema trovato:** il TENANT_ADMIN di una sola scuola doveva comunque
    scegliere l'istituto, e la scelta stava in un menu nella barra in alto →
    corretto con il passo 6;
  - il passo 6 non è stato ancora provato a mano su `localhost` `[da fare]`.
- **Neon:**
  - la 005 è applicata **solo** su `test-iterazione-1`;
  - `v2-visual-grammar` **non** ce l'ha. Con il codice di questo ramo, il login
    su `v2-visual-grammar` fallisce (`42703 column a.deve_cambiare_password
    does not exist`), come visto nel test d'uso prima di cambiare `.env`.

### Decisioni `[CONCORDATO]` — proprietario, 04/11/2026
1. Credenziali dei nuovi utenti: password temporanea generata dal sistema,
   mostrata una volta a chi crea l'account, cambio obbligatorio al primo
   accesso. Nessun servizio email.
2. Il PLATFORM_ADMIN crea la scuola e il suo primo TENANT_ADMIN.
3. Con una sola scuola nessuna scelta dell'istituto. Con più scuole, pulsanti
   come per gli insegnamenti. Niente scelta nella barra in alto.
4. Per le iterazioni successive:
   - scala e soglie le definiscono **entrambi**: il TENANT_ADMIN come default
     d'istituto, il COORDINATOR come variante del proprio livello;
   - i «dirigenti» che definiscono materie e criteri sono il **COORDINATOR**,
     limitato al **proprio livello scolastico**;
   - l'import degli alunni porta **cognome, nome, classe** («in seguito un
     sistema flessibile»).

### Decisioni proposte da Claude Code: **validate** dal proprietario, 04/11/2026
L'elenco completo e motivato è in `LAVORO-IN-CORSO-iterazione-1.md` a
`823eb49`. Le otto che toccano l'uso, validate una per una:
1. Password **da 12 a 128 caratteri**, senza regole di composizione; lunghezza
   contata in caratteri.
2. Password temporanea valida **7 giorni**; scaduta = credenziali non valide.
3. **Email già registrata:** si aggiungono solo scuola e ruolo; password, nome
   e cognome restano quelli dell'account.
4. **La password è dell'account:** una reimpostazione fatta per una scuola vale
   anche per le altre in cui la persona lavora.
5. Sui pulsanti della scelta compaiono **i ruoli** dell'utente in quella
   scuola.
6. Il PLATFORM_ADMIN entra in una scuola dalla sezione «Entra in un istituto»
   dell'Amministrazione.
7. La reimpostazione chiede conferma, perché chiude le sessioni della persona.
8. Testi del catalogo: 55 voci nuove in `it.json`, provvisorie come tutto il
   catalogo di prova.

### Non toccato di proposito
- `main`, `claude/vigilant-hamilton-g1n5rh`, `seed/`, motore e viste dei
  report, Neon `v2-visual-grammar`.

### Aperto
- **Subito dopo l'unione:** applicare la 005 su `v2-visual-grammar`,
  altrimenti il codice di `main` non permette più il login su quel ramo. Il
  backup **`backup-prima-migration005`** (genitore `v2-visual-grammar`) è già
  stato creato dal proprietario, il 04/11/2026.
- Prova a mano del passo 6 su `localhost`.
- **Accesso e sessioni** (da Claude Code):
  - nessun limite ai tentativi di accesso;
  - durata delle sessioni (30 minuti di inattività, 12 ore massimo) da
    valutare;
  - nessun modo per aggiungere un amministratore a una scuola che non ne ha,
    né per riattivare un account disabilitato;
  - nessun elenco degli account che non hanno ancora cambiato la temporanea;
  - nessuna riga `person.create` nell'audit (nome e cognome stanno in
    `account.create`).
- **Ambiente E2E del cloud:** allineare `playwright-core` al Chromium
  disponibile, e far terminare gli E2E quando il browser manca invece di
  lasciarli appesi.
- **Catalogo:** `UI_TENANT`, `UI_TENANT_NONE`, `UI_SELECT_TENANT_PROMPT` non
  sono più usate.
- **Neon:** ramo `test-iterazione-1` da eliminare dopo l'unione.
- Le 2 vulnerabilità di `npm audit`.
- Tutto il resto del CHECKPOINT 014.

### Prossimo passo
1. Prova a mano del passo 6 su `localhost`, con `.env` su `test-iterazione-1`:
   - un TENANT_ADMIN entra direttamente;
   - `multitenant.user@example.test` vede i pulsanti;
   - il PLATFORM_ADMIN parte dall'Amministrazione.
2. ~~Validazione delle decisioni proposte 1–8~~: fatta, 04/11/2026.
3. Commit di questo checkpoint sul ramo, con rimozione del file di lavoro;
   unione in `main` con `--no-ff`; verifica con `git diff --stat` vuoto.
4. 005 su `v2-visual-grammar` (backup già fatto, poi applicazione, poi verifica);
   `.env` di nuovo su `v2-visual-grammar`; login di prova.
5. Iterazione 2: il TENANT_ADMIN prepara l'istituto.
