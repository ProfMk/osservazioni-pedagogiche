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
| 2 | Server: login, middleware del cambio obbligatorio, `POST /api/auth/password`, password mai nei log | completato | (questo commit) |
| 3 | Server: creazione scuola + primo amministratore, reimpostazione | da fare | |
| 4 | Client: modulo «Nuova scuola», riquadro password, reimpostazione, «Cambia password» | da fare | |
| 5 | E2E del primo accesso | da fare | |

**Passo in corso:** 3.

## Ultimo esito di `npm test`

161/161 (145 esistenti + 16 di `tests/primoAccesso.test.js`).

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
