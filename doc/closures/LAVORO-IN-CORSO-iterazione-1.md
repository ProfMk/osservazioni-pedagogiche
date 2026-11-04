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
| 1 | Migration 005 (+ test della migration) | completato | (questo commit) |
| 2 | Server: login, middleware del cambio obbligatorio, `POST /api/auth/password` | da fare | |
| 3 | Server: creazione scuola + primo amministratore, reimpostazione | da fare | |
| 4 | Client: modulo «Nuova scuola», riquadro password, reimpostazione, «Cambia password» | da fare | |
| 5 | E2E del primo accesso | da fare | |

**Passo in corso:** 2.

## Ultimo esito di `npm test`

150/150 (145 esistenti + 5 della migration 005).

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
