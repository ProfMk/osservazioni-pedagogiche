# LAVORO IN CORSO — Iterazione 2, lavoro 2: inserimento osservazioni

Ramo: `iterazione-2-inserimento-osservazioni` (creato dal proprietario da `main` a `2e8e671`).
Prompt: «Iterazione 2, lavoro 2: inserimento osservazioni» (04/11/2026).
File temporaneo: alla chiusura lo sostituisce il CHECKPOINT 017, scritto dal proprietario.

## Stato

| Passo | Contenuto | Commit | `npm test` | `npm run test:e2e` |
|---|---|---|---|---|
| 0 | Avvio, piano | (questo commit) | 206/206 | 22/22 |
| 1 | Server: sola lettura ed esito sul posto | — | — | — |
| 2 | Client: avviso di sola lettura, salvataggio sul posto | — | — | — |
| 3 | Reflow della griglia | — | — | — |
| 4 | Partenza per ruolo, «Classi del mio livello» | — | — | — |
| 5 | Nome dell'anno modificabile | — | — | — |
| 6 | Etichette e aiuto per livello e ordine | — | — | — |
| 7 | Chiusura (README, numeri finali) | — | — | — |

## Passo 0 — Avvio
- Ramo `iterazione-2-inserimento-osservazioni`, albero pulito, `HEAD` = `2e8e671`.
- Letti `README.md` e `doc/closures/CHECKPOINT-016.md`.
- Partenza: `npm test` **206/206**, `npm run test:e2e` **22/22** (comando ufficiale, Windows).

## Piano
1. **Server.** Regola unica di scrittura `{ consentita, motivo }`; `scrittura` nella griglia;
   nuova `GET /api/teachings/:id/scrittura`; il PUT della cella restituisce `cella` e `riga`
   (esito calcolato con la stessa funzione della griglia, nella stessa transazione).
   Test: `tests/inserimentoOsservazioni.test.js`.
2. **Client.** Avviso fisso di sola lettura (motivo dal server); griglia e modulo «Nuova
   attività» guidati da `scrittura`; salvataggio sul posto senza `disegna()`, scritture
   serializzate per riga, errore sul controllo con ripristino del valore salvato. E2E nuovi.
3. **Reflow della griglia**: una scheda per alunno sotto una soglia misurata
   (`ResizeObserver`), una sola struttura DOM, nessuno scorrimento orizzontale da 320 px.
4. **Partenza per ruolo** (`partenza` in `/auth/me`) e vista «Classi del mio livello».
5. **Nome dell'anno modificabile** (`PUT /api/admin/school-years/:annoId`, `rinominabile`).
6. **Livello e ordine**: etichette e testo d'aiuto nel catalogo.
7. **Chiusura**: README, numeri finali.

## Decisioni prese da Claude Code
(nessuna finora)

## Asserzioni esistenti modificate
Nessuna.

## Preparazione dati adattata
Nessuna.

## Testi di catalogo nuovi o modificati
(nessuno finora)

## Da riprendere
(niente)
