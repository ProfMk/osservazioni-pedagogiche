# LAVORO IN CORSO — Iterazione 1: creazione di una scuola, primo amministratore, password temporanea

> File di lavoro, **non** un checkpoint: alla fine dell'iterazione la chat di
> progetto lo sostituisce con il CHECKPOINT.

- **Partenza:** `main` a `cad4af8` (verificato).
- **Ramo:** `claude/laughing-clarke-1vc5f1` (assegnato dall'ambiente; il nome
  `iterazione-1-scuola` non era sceglibile).
- **Baseline:** `npm test` 145/145. E2E: `npx playwright-core install chromium`
  fallito (download bloccato: «Download failure, code=1»), quindi `npm run
  test:e2e` **non eseguibile** così com'è (playwright-core 1.56.1 cerca Chromium
  rev. 1194, l'ambiente ha la 1243). Con un preload fuori dal repository che
  passa `executablePath: '/opt/pw-browsers/chromium'` gli E2E della baseline
  danno 14/14.

## Passi

| N | Passo | Stato | Commit |
|---|---|---|---|
| 1 | Migration 005 (+ test della migration) | completato | `4a20cf6` |
| 2 | Server: login, middleware del cambio obbligatorio, `POST /api/auth/password`, password mai nei log | completato | `008602f` |
| 3 | Server: creazione scuola + primo amministratore, reimpostazione | completato | `cdcdb2d` |
| 4 | Client: modulo «Nuova scuola», riquadro password, reimpostazione, «Cambia password» | completato | `f501978` |
| 5 | E2E del primo accesso; README (005, nuovo file di test) | completato | `8fe125b` |
| 6a | Passo 6, server: selezione automatica dell'istituto al login, ruoli per scuola in `/me` | completato | (questo commit) |
| 6b | Passo 6, client: vista «Scegli l'istituto», intestazione senza `<select>`, «Cambia istituto» | da fare | |
| 6c | Passo 6, E2E: punti che usavano `#tenant`, casi nuovi | da fare | |

**Passo in corso:** 6b (prompt «passo 6: scelta dell'istituto dopo l'accesso», partenza `8fe125b`).

## Ultimo esito di `npm test`

181/181 (173 + 8 di `tests/sceltaIstituto.test.js`).

**Asserzioni esistenti modificate nel passo 6** (solo quelle che davano per
scontato `activeTenantId` NULL dopo il login di un account con una sola scuola):
- `tests/integration.test.js`, «Login: credenziali corrette…»: prima
  `activeTenantId === null`; dopo `activeTenantId ===` id di Alfa.
- `tests/lingua.test.js`, «C2: login -> lingua di piattaforma…» (docente di sola
  Alfa): prima `[lingua, lingueAbilitate] = ['it', []]` («prima del tenant:
  P3»); dopo `[lingua, codici delle lingueAbilitate] = ['it', ['ar-XB', 'it']]`.
  La verifica di P3 al login passa al test nuovo con `multitenant.user`.
- `tests/primoAccesso.test.js`, «Primo accesso…»: prima nessuna sessione con
  `active_tenant_id`; dopo la sessione ha il tenant della sua unica scuola.

**Prova a contrario (passo 6a):** senza la selezione automatica falliscono 3
degli 8 test nuovi (una sola scuola, una sola scuola con cambio obbligatorio,
membership mista).

**Prova a contrario (passo 2):** tolto `richiedePasswordAggiornata` da
`routes/index.js` e da `switch-tenant`, il test «Primo accesso: … ogni altra API
-> 403» fallisce (`switch-tenant` risponde `[200, undefined]` invece di
`[403, ERR_PASSWORD_CHANGE_REQUIRED]`). Ripristinato, torna verde.

## Decisioni prese finora

- `[DECISIONE PROPOSTA]` La 005 entra nella catena di `pglite://completo` e
  `pglite://esteso` subito dopo la 004 e prima dei seed (gli account dei seed
  nascono con `deve_cambiare_password = false`).
- `[DECISIONE PROPOSTA]` Il messaggio d'errore della 005 sui doppioni riporta
  solo il numero di gruppi (niente email nel log della migration) e, come
  `HINT`, la query per elencarli.
- `[DECISIONE PROPOSTA]` Nessun `GRANT` nella 005: i privilegi di tabella di
  `app_role` su `accounts` (002) coprono le colonne nuove; lo verifica un test
  con `has_column_privilege` e una scrittura reale sotto `app_role`.
- `[DECISIONE PROPOSTA]` Nuovo file di test `tests/primoAccesso.test.js`,
  aggiunto a `npm test` e `npm run test:integration`.
- `[DECISIONE PROPOSTA]` Il blocco del cambio obbligatorio è il middleware
  `server/middleware/cambioPassword.js`, montato subito dopo `autenticazione` su
  `/platform`, sul dominio e su `/auth/switch-tenant`. Fuori: login, `/auth/me`,
  `/auth/password`, `/auth/logout`, `/i18n`. Una query in più per richiesta
  (`deve_cambiare_password` dell'account).
- `[DECISIONE PROPOSTA]` Il login cerca con `lower(a.email) = lower(trim(input))`
  (usa l'indice della 005; trova anche un'eventuale email storica con
  maiuscole).
- `[DECISIONE PROPOSTA]` `POST /api/auth/password`: errori di validazione 400
  (anche `ERR_PASSWORD_CURRENT_INVALID`, non 401, per non far uscire l'utente);
  l'ordine dei controlli è campi → lunghezza della nuova → password attuale →
  uguaglianza. Risponde 200 con la vista `/me` aggiornata e il nuovo cookie.
  Il `csrfToken` non cambia (deriva dall'id di sessione, che resta lo stesso).
- `[DECISIONE PROPOSTA]` Una temporanea scaduta non vale nemmeno come «password
  attuale» in una sessione aperta prima della scadenza
  (`ERR_PASSWORD_CURRENT_INVALID`).
- `[DECISIONE PROPOSTA]` Codice in più: `ERR_PASSWORD_SAME_AS_CURRENT` per il
  cambio volontario con nuova = attuale (`ERR_PASSWORD_SAME_AS_TEMPORARY` resta
  per la temporanea). Parametri: `ERR_PASSWORD_TOO_SHORT {minimo}`,
  `ERR_PASSWORD_TOO_LONG {massimo}`; campi mancanti con `ERR_REQUIRED_FIELD` e
  `UI_FIELD_PASSWORD_CURRENT` / `UI_FIELD_PASSWORD_NEW`.
- `[DECISIONE PROPOSTA]` Lunghezza contata in caratteri Unicode
  (`Array.from`), non in unità UTF-16.
- `[DECISIONE PROPOSTA]` Audit `account.password_change` con `prima` e `dopo`
  `NULL`; `tenant_id` = tenant attivo della sessione, se c'è.
- `[DECISIONE PROPOSTA]` **Correzione di un rischio preesistente:** il gestore
  errori scriveva in console il corpo della richiesta sugli errori imprevisti
  (anche quello del login). `server/lib/asincrono.js` ora sostituisce con
  `[omessa]` ogni campo il cui nome contiene «password», a qualunque profondità.
- `[DECISIONE PROPOSTA]` `POST /api/platform/tenants`: `amministratore` è
  facoltativo lato server (il test esistente crea un tenant senza), obbligatorio
  nel modulo del client. Risposta 201: i campi del tenant restano al primo
  livello (compatibilità) e, se c'è l'amministratore, si aggiunge
  `amministratore: { account, accountEsistente, passwordTemporanea?,
  passwordTemporaneaScadeIl? }`. `Cache-Control: no-store` sulle risposte che
  possono contenere una password.
- `[DECISIONE PROPOSTA]` Email esistente: nome e cognome inviati sono ignorati
  (resta la persona dell'account); la risposta riporta quelli salvati.
- `[DECISIONE PROPOSTA]` Audit della creazione: `account.create` con `dopo` =
  id, email, stato, personId, nome, cognome, deveCambiarePassword,
  passwordTemporaneaScadeIl (niente password, niente hash);
  `membership.create`; `role_assignment.create` con lo stesso `dopo` di
  `POST /api/role-assignments`. Nessuna riga separata per la persona. Tutte con
  `tenant_id` della scuola nuova e l'attore PLATFORM_ADMIN.
- `[DECISIONE PROPOSTA]` Il ruolo passa da `creaRoleAssignment` di
  `queries/rbac.js` (stessi controlli, nessuna duplicazione).
- `[DECISIONE PROPOSTA]` Reimpostazione: valida solo per un account con un
  TENANT_ADMIN attivo (scope TENANT) in quella scuola; altrimenti 404
  `UI_RESOURCE_ACCOUNT`; scuola inesistente 404 `UI_RESOURCE_TENANT`; account
  disabilitato 409 `ERR_ACCOUNT_DISABLED`. Revoca tutte le sessioni
  (`reimpostazione_password`), non tocca `password_changed_at`. Audit
  `account.password_reset` con `prima`/`dopo` `NULL` e `tenant_id` della
  scuola. Risposta 200 `{ account, passwordTemporanea,
  passwordTemporaneaScadeIl }`. La password è dell'account, quindi vale per
  tutte le scuole in cui lavora.
- `[DECISIONE PROPOSTA]` `GET /api/platform/tenants` aggiunge a ogni tenant
  `amministratori: [{ account_id, email, stato, nome, cognome }]` (serve al
  client per l'azione «Nuova password temporanea»).
- `[DECISIONE PROPOSTA]` Lunghezze: nome e cognome ≤ 100 caratteri, slug ≤ 60,
  nome della scuola ≤ 200 (limiti delle colonne): `ERR_FIELD_TOO_LONG {campo,
  massimo}` invece di un 500. Campi: `UI_FIELD_ADMIN_NAME`,
  `UI_FIELD_ADMIN_SURNAME`, `UI_FIELD_SLUG`, `UI_FIELD_NOME`.
- `[DECISIONE PROPOSTA]` Formato email volutamente minimo
  (`^[^\s@]+@[^\s@]+\.[^\s@]+$`, ≤ 255).
- `[DECISIONE PROPOSTA]` Ordine dei controlli in `POST /api/platform/tenants`:
  prima i campi della scuola (dentro `creaTenant`), poi quelli
  dell'amministratore, come nel modulo; un errore sui secondi annulla anche il
  tenant appena inserito.
- `[DECISIONE PROPOSTA]` `/me` espone `regolePassword: { minimo, massimo }`: il
  client le usa per l'aiuto e per `minlength`/`maxlength`, senza fissare 12 nel
  codice.
- `[DECISIONE PROPOSTA]` Client, cambio obbligatorio: schermata fuori dalle
  rotte (nessuna chiamata API bloccata), intestazione ridotta a nome ed «Esci».
  Dopo il cambio si riparte da `avviaApp` con il messaggio
  `UI_PASSWORD_CHANGED`. Se una vista riceve `ERR_PASSWORD_CHANGE_REQUIRED`
  (password reimpostata altrove), il client rilegge `/me` e torna alla
  schermata di cambio.
- `[DECISIONE PROPOSTA]` Client, «Cambia password» volontario: pulsante
  nell'intestazione e rotta `#/password`; il campo si chiama «Password attuale»
  (nella schermata obbligatoria «Password temporanea»). Conferma della nuova
  password solo nel client (`ERR_PASSWORD_CONFIRMATION_MISMATCH`, codice del
  solo catalogo).
- `[DECISIONE PROPOSTA]` Moduli con `novalidate`: i messaggi vengono tutti dal
  catalogo (niente fumetti del browser). Ogni campo ha `label for`, aiuto ed
  errore collegati con `aria-describedby`; l'errore del server va sul campo
  indicato dal codice o dal parametro `campo`, con `aria-invalid` e fuoco; il
  resto nell'area d'errore generale.
- `[DECISIONE PROPOSTA]` Password temporanea mostrata solo in memoria fino al
  successivo disegno della vista (niente storage, indirizzo, storia); «Copia»
  con `navigator.clipboard`, altrimenti selezione del testo e messaggio
  `UI_COPY_FAILED`; «Fatto» chiude il riquadro; il fuoco va al titolo del
  riquadro. Scadenza mostrata con il nuovo `I18n.dataOra` (data e ora per
  lingua + regione).
- `[DECISIONE PROPOSTA]` «Nuova password temporanea» chiede conferma con
  `window.confirm` (testo `UI_RESET_CONFIRM` dal catalogo): revoca le sessioni.
- `[DECISIONE PROPOSTA]` (6a) Selezione automatica nel login, nella stessa
  transazione della sessione: conta le Membership attive in tenant attivi
  (stessa query di `getMembershipsDiAccount`); una sola → tenant attivo. Una
  Membership sospesa o in un tenant sospeso non conta (con una attiva e una
  sospesa si entra in quella attiva).
- `[DECISIONE PROPOSTA]` (6a) `/me`: ogni voce di `memberships` e di
  `tenantsDisponibiliPerSwitch` ha `ruoli: [codici]` (RoleAssignment attivi in
  quel tenant, qualunque scope, senza doppioni, nell'ordine dei ruoli di
  sistema). Per il PLATFORM_ADMIN `tenantsDisponibiliPerSwitch` comprende ora
  solo i tenant **attivi** (gli unici che `switch-tenant` accetta), con
  `ruoli` di norma vuoto.
