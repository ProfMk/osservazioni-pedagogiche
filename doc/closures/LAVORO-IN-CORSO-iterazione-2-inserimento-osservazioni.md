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
| 3 | Reflow della griglia | `42ad8c4` | 215/215 | 28/28 |
| 4 | Partenza per ruolo, «Classi del mio livello» | `8d0fbe6` | 217/217 | 30/30 |
| 5 | Nome dell'anno modificabile | (questo commit) | 219/219 | 31/31 |
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

## Passo 4 — Partenza per ruolo e «Classi del mio livello»
- Server (`server/routes/auth.js`): `PARTENZA` (`scuole`, `quadro`, `classi`, `insegnamenti`) e `partenzaDi(...)`;
  `costruisciVistaMe` aggiunge `partenza` (login, `/auth/me`, cambio password, `switch-tenant`). PLATFORM_ADMIN →
  `scuole` sempre; nel tenant attivo TENANT_ADMIN > COORDINATOR > TEACHER (`quadro`, `classi`, `insegnamenti`);
  senza tenant attivo e senza PLATFORM_ADMIN → `null`. Nessun altro campo cambia.
- Client (`public/js/app.js`):
  - `rottaDiPartenza()`: unica traduzione codice → rotta (`#/amministrazione/scuole`, `#/amministrazione/quadro`,
    `#/classi`, `#/insegnamenti`).
  - `daHash` restituisce `null` per un indirizzo vuoto o non riconosciuto (riconosce ora anche `#/insegnamenti`,
    `#/classi`, `#/classi/<id>`); `popstate` e `avviaApp` usano `daHash(...) || rottaDiPartenza()`;
    `avviaApp({ radice })` (dopo l'accesso con scelta della scuola e «Cambia istituto») usa `rottaDiPartenza()`;
    il clic sul titolo, con una scuola attiva, `rottaDiPartenza()`. **Senza scuola attiva** il ramo di
    `avviaApp` e del titolo resta quello di prima (PLATFORM_ADMIN → `#/amministrazione`, altri → `#/istituti`).
  - Viste nuove `VISTE.classi` (`#/classi`) e `VISTE.classeDelLivello` (`#/classi/<classId>`): livelli da
    `ruoliNelTenantAttivo` (`ruolo === 'COORDINATOR'` con `scope_school_level_id`), nomi da `GET /school-levels`,
    classi da `GET /school-levels/:id/classes`, insegnamenti da `GET /classes/:id/teachings`, collegamenti alla
    scheda esistente `{ tipo: 'classe', teachingId, scheda: 'quadro' }`. Briciole «Classi del mio livello» › classe.
  - `collegamentoVista(...)`: collegamento «Classi del mio livello» in «Insegnamenti» e «Insegnamenti» in
    «Classi del mio livello», solo per chi è COORDINATOR nel tenant attivo.
- Test: due test di integrazione in `tests/inserimentoOsservazioni.test.js` (tutti gli account richiesti, con
  precedenza dei ruoli e un ruolo di prova aggiunto e rimosso nel test); due E2E nuovi (partenze, titolo,
  indirizzo valido e non riconosciuto; percorso del COORDINATOR con classe senza insegnamenti creata e rimossa
  nel test).

## Passo 5 — Nome dell'anno modificabile (date no)
- Verificato prima: nessuna migration serve (`app_role` ha UPDATE su tutte le tabelle tranne `audit_log`,
  migration 002; la 004 non ha trigger di immutabilità su `school_years` oltre a quello generico su `tenant_id`).
- Server: `rinominabile(anno)` e `rinominaAnno(client, ctx, annoId, corpo)` in `server/queries/calendario.js`;
  `PUT /api/admin/school-years/:annoId` con `scritturaConfigurazione` (permesso `tenant.manage_config`, stessa
  transazione dell'audit). Ordine dei controlli: anno del tenant (404, riga bloccata `FOR UPDATE`), anno
  chiuso (409 `ERR_SCHOOL_YEAR_CLOSED`), nome (`testoObbligatorio`, ≤ 20), unicità nel tenant (409
  `ERR_SCHOOL_YEAR_NAME_TAKEN`, anche dal vincolo `school_years_tenant_id_nome_key`). Audit
  `school_year.rename` con `prima: { nome }`, `dopo: { nome }`. Le date non si toccano.
- `GET /api/admin/school-years`: campo `rinominabile` per anno; `azioni` invariato.
- Client: pulsante «Rinomina» (`UI_RENAME`, nome accessibile `UI_YEAR_RENAME_FOR`) solo se `rinominabile`; modulo
  nel corpo della pagina (`moduloRinominaAnno`, stesso `moduloAdmin` degli altri moduli, con nota
  `UI_YEAR_RENAME_NOTE`); dopo il salvataggio `stato.insegnamenti = null` e ridisegno con la conferma.
- Test: due test di integrazione (successo con audit e date invariate, nome invariato senza audit, anno in
  preparazione, nome occupato, vuoto, assente, troppo lungo, anno chiuso, anno inesistente e di un altro
  tenant, TEACHER 403); un E2E (modulo nel corpo, errore sul campo, nuovo nome negli insegnamenti, nessuna
  finestra di dialogo, nessun «Rinomina» su un anno chiuso, axe-core). Le asserzioni sulle `azioni` in
  `tests/anniScolastici.test.js` sono invariate e verdi.

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
14. (Passo 4) Senza tenant attivo `partenza` è `null` per chi non è PLATFORM_ADMIN (il client lo ignora: resta
    la scelta dell'istituto); per il PLATFORM_ADMIN è `scuole`, ma il client senza scuola attiva continua ad
    aprire `#/amministrazione` come prima (lo verifica l'E2E esistente).
15. (Passo 4) Il ruolo COORDINATOR basta per `classi` (il server non controlla lo scope del ruolo); la vista
    usa poi solo i ruoli con `scope_school_level_id`. Con nessun livello mostra `UI_MY_LEVEL_NONE`.
16. (Passo 4) Il nome della classe della vista `#/classi/<id>` si trova tra le classi dei livelli coordinati
    (le stesse richieste della vista «Classi»); una classe fuori dai propri livelli dà 404
    (`ERR_NOT_FOUND`, `UI_RESOURCE_CLASS`) senza chiamare altre API.
17. (Passo 4) Testo dei collegamenti di andata e ritorno: il nome della vista di destinazione (`UI_MY_LEVEL_CLASSES`,
    `UI_TEACHINGS`).
18. (Passo 5) Su un anno chiuso il 409 arriva **prima** della validazione del nome (come i periodi: prima
    lo stato dell'anno, poi i campi).
19. (Passo 5) Lo stesso nome di prima risponde 200 con l'anno, **senza** scrittura né riga d'audit.
20. (Passo 5) L'E2E rinomina l'anno attivo di Alfa e lo riporta al nome originale nel `finally` (SQL); l'anno
    chiuso di prova è creato e rimosso dal test.

## Asserzioni esistenti modificate
1. `tests/immutabilita.test.js`, test «Anno attivo: salvataggio e cancellazione (valore null) di
   un'osservazione riescono».
   - Prima: `assert.deepEqual([cancella.status, cancella.corpo], [200, { eliminato: true }]);`
   - Dopo: `assert.deepEqual([cancella.status, cancella.corpo.eliminato, cancella.corpo.observationId], [200, true, undefined]);`
   - Motivo: il prompt (1d) aggiunge `cella` e `riga` alla risposta, anche per la cancellazione; il
     confronto per intero non può restare. Si conservano i due fatti verificati prima: `eliminato`
     vero e nessun `observationId`.
2. `tests/e2e.test.js`, test «Passo 6: utente con due scuole — pulsanti con nome e ruoli, scelta da tastiera,
   «Cambia istituto» e tasto Indietro» (due asserzioni).
   - Prima: dopo la scelta di Beta `assert.equal(await titoloVista(pagina), CATALOGO.UI_TEACHINGS);` e, dopo
     `goBack()`, attesa del titolo `CATALOGO.UI_TEACHINGS`.
   - Dopo: `CATALOGO.UI_MY_LEVEL_CLASSES` in entrambi i punti.
   - Motivo: decisione «Partenza per ruolo» (passo 4): in Beta `multitenant.user` è COORDINATOR e atterra su
     «Classi del mio livello»; il tasto Indietro torna a quella vista. L'ultima asserzione (Alfa, TEACHER →
     «Insegnamenti») resta invariata.
3. `tests/e2e.test.js`, test «Passo 6: PLATFORM_ADMIN — prima vista l'Amministrazione; entra in una scuola con
   lo stesso elenco di pulsanti».
   - Prima: dopo l'ingresso in Beta `assert.equal(await titoloVista(pagina), CATALOGO.UI_TEACHINGS);`
   - Dopo: `assert.equal(await titoloVista(pagina), CATALOGO.UI_ADMINISTRATION);`
   - Motivo: partenza `scuole` per il PLATFORM_ADMIN anche con una scuola attiva (prompt, 4a e 4b). Le
     asserzioni sulla prima vista senza scuola (`#/amministrazione`) restano invariate.

## Preparazione dati adattata
Nessuna.

## Testi di catalogo nuovi o modificati
| Chiave | Prima | Dopo | Passo |
|---|---|---|---|
| `UI_READ_ONLY` | (nuova) | Sola lettura | 2 |
| `UI_CELL_SAVED` | (nuova) | Salvato. | 2 |
| `UI_MY_LEVEL_CLASSES` | (nuova) | Classi del mio livello | 4 |
| `UI_MY_LEVEL_NONE` | (nuova) | Non coordini nessun livello in questo istituto. | 4 |
| `UI_CLASS_NO_TEACHINGS` | (nuova) | Questa classe non ha ancora insegnamenti. | 4 |
| `UI_YEAR_RENAME_FOR` | (nuova) | Rinomina l'anno scolastico {anno} | 5 |
| `UI_YEAR_RENAME_NOTE` | (nuova) | Cambia solo il nome: le date dell'anno restano quelle di prima, perché da esse dipendono i periodi di valutazione. | 5 |

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
- **Da valutare (passo 4)**: il PLATFORM_ADMIN che entra in una scuola atterra su «Scuole» (come deciso),
  cioè sull'elenco delle scuole della piattaforma, con la scuola attiva solo nell'intestazione. Se si
  preferisce il Quadro della scuola appena scelta, basta cambiare il codice nel server (`partenzaDi`).
