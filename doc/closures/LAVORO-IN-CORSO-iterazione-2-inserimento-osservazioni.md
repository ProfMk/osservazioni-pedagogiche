# LAVORO IN CORSO — Iterazione 2, lavoro 2: inserimento osservazioni

Ramo: `iterazione-2-inserimento-osservazioni` (creato dal proprietario da `main` a `2e8e671`).
Prompt: «Iterazione 2, lavoro 2: inserimento osservazioni» (04/11/2026).
File temporaneo: alla chiusura lo sostituisce il CHECKPOINT 017, scritto dal proprietario.

## Stato

| Passo | Contenuto | Commit | `npm test` | `npm run test:e2e` |
|---|---|---|---|---|
| 0 | Avvio, piano | `7b15a4c` | 206/206 | 22/22 |
| 1 | Server: sola lettura ed esito sul posto | `ea3a90f` | 213/213 | 22/22 |
| 2 | Client: avviso di sola lettura, salvataggio sul posto | `881aade` | 215/215 | 26/26 |
| 3 | Reflow della griglia | (questo commit) | 215/215 | 28/28 |
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

## Passo 1 — Server: sola lettura ed esito sul posto
- `server/queries/dominio.js`:
  - `motivoDiSolaLettura({ annoStato })`: punto unico del motivo (chiave di catalogo) per cui
    nessuno può scrivere; **lo usa anche `verificaAnnoScolasticoAttivo`** per il 409, così la regola
    esposta al client e il rifiuto delle scritture non possono divergere. Il lavoro 3 aggiungerà lì,
    prima dell'anno, il motivo «scuola sospesa».
  - `regolaDiScrittura(client, { accountId, permesso, tenantId, schoolLevelId, classId, teachingId, annoStato })`
    → `{ consentita, motivo }`: motivo prima del permesso; il permesso con `haPermesso` e l'ambito completo.
  - `righeDellaGriglia(d, alunni)`: calcolo unico della riga (estratto da `getGrigliaActivity`, nessuna
    duplicazione della Regola B).
  - `getCellaERigaDopoSalvataggio(...)`: rilegge l'attività nella stessa transazione e calcola cella e
    riga con `righeDellaGriglia`.
- `server/routes/dominio.js`: `scrittura` nella griglia (`observation.create`); nuova
  `GET /api/teachings/:teachingId/scrittura` (404 per anno in preparazione e per altro tenant, poi 403
  senza `teaching.read`); il PUT della cella aggiunge `cella` e `riga` (anche con `valore: null`).
- Test: `tests/inserimentoOsservazioni.test.js` (7 casi), aggiunto a `test` e `test:integration`.

## Passo 2 — Client: avviso di sola lettura e salvataggio sul posto
- `public/js/app.js`:
  - `regolaDiScrittura(tn)` legge `GET /teachings/:id/scrittura`; `avvisoSolaLettura(regola)`: `div.avviso.sola-lettura`
    con `role="status"`, titolo `UI_READ_ONLY` + testo del `motivo` ricevuto; nessun pulsante di chiusura; nulla se
    `motivo` è nullo.
  - Vista dell'attività: l'avviso sta **sopra le schede** (griglia ed esito), con la regola `osservazioni`.
    Scheda «Attività» della classe: avviso con la regola `attivita`; il modulo «Nuova attività» solo se
    `scrittura.attivita.consentita` (prima: `haPermesso('activity.create')`).
  - Griglia: controlli solo se `g.scrittura.consentita` (prima: `haPermesso('observation.create')`).
    Riferimenti nel DOM: `tr[data-iscrizione]`, `td.cella-valore[data-criterio]` (anche in sola lettura), `td.esito`.
  - `salvaCellaSulPosto(contesto, riga, cella)`: niente `disegna()`, niente «Caricamento», il `<select>` non è mai
    disabilitato né sostituito; `aria-busy="true"` sulla cella durante il salvataggio; coda per riga
    (`riga.coda`); a salvataggio riuscito cambiano solo il segno (`G.valoreScala`) e la cella `esito`
    (`contenutoEsitoRiga`, valori del PUT); annuncio `UI_CELL_SAVED` in un'unica regione `role="status"`
    (visivamente nascosta) sotto la tabella.
  - Errore: il controllo torna all'ultimo valore salvato, `aria-invalid="true"`, messaggio in
    `span#errore-cella-<iscrizione>-<criterio>.errore-campo` (`role="alert"`) collegato con `aria-describedby`;
    testo dal codice d'errore, `ERR_INTERNAL` se manca; mai il banner `#errore`. 401 → accesso.
- Test: due controlli statici in `tests/inserimentoOsservazioni.test.js` (catalogo; `salvaCellaSulPosto` senza
  `disegna(`, `caricamento(`, `.disabled`, `mostraErrore(`, `vai(`; la griglia usa `g.scrittura.consentita`);
  quattro E2E nuovi in `tests/e2e.test.js` (salvataggio sul posto con scorrimento, fuoco, osservatore di
  mutazioni e confronto con `GET …/griglia`; errori 500 e 409 simulati con `pagina.route`; solo tastiera;
  anno chiuso). axe-core sulle viste toccate (griglia con valori, griglia con errore, griglia/esito/scheda
  «Attività» ad anno chiuso).

## Passo 3 — Reflow della griglia
- **Approccio**: quello consigliato (misura, non solo CSS). `adattaGriglia(contenitore, tabella)` in `app.js`:
  un `ResizeObserver` sul contenitore `.griglia-contenitore`; in modalità tabella, se `tabella.offsetWidth`
  supera `contenitore.clientWidth` si conserva quella larghezza (= larghezza naturale minima della tabella con
  questi criteri, questa scala e questi testi) e si passa alla classe `a-schede`; in modalità scheda si torna
  alla tabella solo quando il contenitore è largo almeno quanto la larghezza conservata (poi si rimisura).
  Nessuna soglia in pixel, nessun `Math.`. Il cambio di classe avviene in `requestAnimationFrame`, fuori dal
  ciclo dell'osservatore (evita l'errore «ResizeObserver loop»). L'osservatore si scollega quando la griglia
  esce dal DOM.
- **Una sola struttura DOM**: la stessa `table.griglia`. In modalità scheda (`.a-schede`) tabella, righe e
  celle diventano blocchi/griglie; `thead` resta nell'albero dell'accessibilità ma visivamente nascosto. Per
  non perdere la semantica tabellare quando cambia `display` ogni elemento ha il **ruolo esplicito**
  (`table`, `rowgroup`, `row`, `columnheader`, `rowheader`, `cell`); i selettori degli E2E esistenti
  (`table.griglia`, `th scope`, `.valore`, `.valore.nullo`) trovano gli stessi elementi.
- Scheda: nome (il `th` della riga) → criteri (etichetta visibile `.etichetta-scheda` con codice e
  descrizione, `aria-hidden="true"`, poi segno e controllo) → esito (etichetta `UI_ACTIVITY_RESULT`
  `aria-hidden`, poi `span.valori-esito`), nell'ordine del DOM. L'etichetta è nascosta (`display: none`)
  in modalità tabella.
- Il salvataggio sul posto aggiorna ora `span.valori-esito` dentro `td.esito` (l'etichetta della scheda resta).
- Il messaggio d'errore di una cella va a capo (`display: block; white-space: normal`): non allarga la
  tabella (prima di questa regola un errore faceva passare la griglia alle schede).
- Tolto `overflow-x` dalla griglia (il contenitore `.scorrimento` non avvolge più la griglia; resta per la
  tabella delle osservazioni, che non è stata toccata).
- Test (E2E nuovi): 320, 768 e 1280 px × unità da 3, 4 e 8 criteri con una descrizione di 62 caratteri
  (unità create nel setup del test e rimosse alla fine): nessuno scorrimento laterale di pagina e di
  contenitori (`scrollWidth <= clientWidth`, nessun elemento con `overflow-x` auto/scroll che scorre),
  tutti i controlli presenti, etichette visibili solo nelle schede, axe-core in entrambe le disposizioni;
  a 320 px sempre schede, a 1280 px con 3 criteri tabella, con 8 criteri schede; ridimensionamento
  320 → 1280 senza oscillazioni. Modalità scheda: ordine del DOM nome → criteri → esito, etichette
  `aria-hidden`, ruoli, nome accessibile del controllo invariato, selezione e salvataggio sul posto; RTL
  (ar-XB di prova) a 320 px con 8 criteri senza scorrimento, nome all'inizio della riga di lettura.
- Tabelle a 320 px **non corrette** (fuori ambito, solo segnalate; sonda temporanea fuori dal repository):
  vedi «Da riprendere».

## Decisioni prese da Claude Code
1. **Anno in preparazione nella regola**: `motivoDiSolaLettura` restituisce
   `ERR_SCHOOL_YEAR_IN_PREPARATION` (lo stesso codice del 409 di oggi). Non è raggiungibile dalle
   letture (404), ma così la regola coincide sempre con il rifiuto delle scritture. Anno assente →
   `ERR_SCHOOL_YEAR_CLOSED`, come prima.
2. Nomi: `motivoDiSolaLettura`, `regolaDiScrittura`, `righeDellaGriglia`, `getCellaERigaDopoSalvataggio`.
3. `GET /teachings/:id/scrittura`: si risolve prima il Teaching (404) e poi il permesso (403), come le
   altre letture del percorso (`scopeDiTeaching`).
4. Nel PUT, `cella.valore` e `riga` sono **riletti dal database** dopo la scrittura (non copiati dalla
   richiesta).
5. (Passo 2) **«Vince l'ultima»**: ogni scrittura in coda legge il valore del controllo quando parte, non quando
   è stata chiesta; se coincide con l'ultimo valore salvato non parte. Tre scelte rapide sulla stessa cella
   danno quindi al più due PUT, e l'ultimo valore è quello salvato.
6. (Passo 2) Se un salvataggio fallisce mentre sulla stessa cella c'è già una scelta successiva in coda, il
   ripristino all'ultimo valore salvato **annulla anche quella scelta** (il controllo mostra sempre ciò che
   è salvato).
7. (Passo 2) Nuova chiave `UI_CELL_SAVED` («Salvato.») invece di riusare `UI_SAVED` («Modifica salvata.»,
   usata dai moduli dell'amministrazione), per l'annuncio breve chiesto dal prompt.
8. (Passo 2) La regione dell'annuncio è visivamente nascosta (`.nascosta`): chi vede ha già il segno della
   cella e l'esito della riga che cambiano.
9. (Passo 2) `aria-describedby` del controllo punta al messaggio solo mentre c'è un errore.
10. (Passo 2) L'E2E dell'anno chiuso chiude **per la durata del test** l'anno attivo di Alfa e lo riapre nel
    `finally`; le attività usate dagli E2E nuovi sono create dal test stesso (nessun dato del seed toccato).
11. (Passo 3) Ruoli ARIA espliciti sulla griglia **in entrambe le disposizioni** (in modalità tabella
    coincidono con quelli nativi), per non dipendere da come il browser tratta `display` sugli elementi di
    tabella.
12. (Passo 3) Nella scheda l'esito sta **in coda** (ordine del DOM), con l'etichetta `UI_ACTIVITY_RESULT`
    ripetuta e `aria-hidden`; `td.esito` contiene ora `span.valori-esito`, che il salvataggio aggiorna.
13. (Passo 3) Nei miei E2E del passo 2 il testo dell'esito si legge da `td.esito .valori-esito` (non da tutta
    la cella, che in modalità scheda contiene anche l'etichetta). Erano test nuovi di questo lavoro.

## Asserzioni esistenti modificate
1. `tests/immutabilita.test.js`, test «Anno attivo: salvataggio e cancellazione (valore null) di
   un'osservazione riescono».
   - Prima: `assert.deepEqual([cancella.status, cancella.corpo], [200, { eliminato: true }]);`
   - Dopo: `assert.deepEqual([cancella.status, cancella.corpo.eliminato, cancella.corpo.observationId], [200, true, undefined]);`
   - Motivo: il prompt (1d) aggiunge `cella` e `riga` alla risposta, anche per la cancellazione; il
     confronto per intero non può restare. Si conservano i due fatti verificati prima: `eliminato`
     vero e nessun `observationId`.

## Preparazione dati adattata
Nessuna.

## Testi di catalogo nuovi o modificati
| Chiave | Prima | Dopo | Passo |
|---|---|---|---|
| `UI_READ_ONLY` | (nuova) | Sola lettura | 2 |
| `UI_CELL_SAVED` | (nuova) | Salvato. | 2 |

## Da riprendere
- **Altre tabelle che a 320 px scorrono di lato** (fuori ambito, non corrette; la pagina non scorre, scorre
  il loro contenitore). Misure con il seed esteso, docente `teacher.math.a@alfa.test`, Matematica 2A:
  | Vista | Contenitore | Eccedenza |
  |---|---|---|
  | Quadro classe | «Mostra come tabella» (`.tabella-alternativa > .tabella-equivalente`) | +254 px |
  | Studenti | `.tabella-alternativa > .tabella-equivalente.matrice` | +188 px |
  | Profilo dell'alunno | `.tabella-alternativa > .tabella-equivalente` | +360 px |
  | Nucleo dell'alunno | `.tabella-alternativa > .tabella-equivalente` | +336 px |
  | Criterio dell'alunno | `.tabella-alternativa > .tabella-equivalente` | +329 px |
  | Criterio dell'alunno | sequenza delle osservazioni (`.scorrimento > table.osservazioni`) | +63 px |
  | Esito dell'attività | `.tabella-alternativa > .tabella-equivalente` | +243 px |
  Nessuno scorrimento a 320 px in: scheda «Attività», «Valutazioni», griglia.
