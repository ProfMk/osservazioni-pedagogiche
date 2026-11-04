# LAVORO IN CORSO — Iterazione 2, passo A (amministrazione dell'istituto)

**Ramo:** `claude/new-session-wd7goo` (assegnato dalla sessione cloud; il nome
`iterazione-2-passo-A` non era sceglibile), creato da `main` a `7bf0ca7`.
Push solo su questo ramo.

**Verifica di partenza:** nel clone il riferimento locale `main` era fermo a
`cad4af8` (non aggiornato); `origin/main` e GitHub (`git ls-remote`) sono a
**`7bf0ca7`**, che è anche la base del ramo (`git merge-base`). Il `main` locale
non è stato toccato.

**Baseline a `7bf0ca7`:** `npm ci`, poi `npm test` → **181/181**.

## Passi
| Passo | Stato | Commit | Contenuto |
|---|---|---|---|
| 1 | fatto | `f849e04` | Migration 006 e test |
| 2 | fatto | `aa7b5a4` | Regola dell'anno |
| 3 | fatto | `783cf4f` | Server, calendario |
| 4 | fatto | `990b424` | Server, livelli e classi |
| 5 | fatto | `3d5d121` | Server, quadro |
| 6 | fatto | `9855774` | Client, cornice dell'amministrazione e quadro |
| 7 | fatto | `4feb47a` | Client, calendario |
| 8 | fatto | `e60a2a0` | Client, livelli e classi |
| 9 | fatto | (questo commit) | E2E |
| 10 | da fare | | README |

## Ultimo esito dei test
- Passo 9: `npm test` → **206/206**; E2E con l'accorgimento → **22/22** (19 + 3
  nuovi), 40,8 s, nessuna riga `[errore]` negli E2E.
- Passo 8: `npm test` → **206/206**.
- Passo 7: `npm test` → **206/206**.
- Passo 6: `npm test` → **206/206**. E2E esistenti **19/19** con l'accorgimento
  (vedi sotto). `npx playwright-core install chromium` provato una volta:
  `Failed to download Chromium 141.0.7390.37 (playwright build v1194)`.
- Passo 5: `npm test` → **206/206** (+3 in `tests/strutturaIstituto.test.js`). Righe
  `[errore]`: le stesse 5 del passo 3.
- Passo 4: `npm test` → **203/203** (+7 in `tests/strutturaIstituto.test.js`). Righe
  `[errore]`: le stesse 5 del passo 3.
- Passo 3: `npm test` → **196/196** (+8 in `tests/anniScolastici.test.js`). Righe
  `[errore]`: le 4 della baseline + 1 **attesa**: `POST /api/admin/school-years/:id/switch-to`
  con `P0001 guasto di prova` (trigger di prova che simula un guasto a metà di
  «passa al nuovo anno», per provarne l'atomicità; risposta 500 `ERR_INTERNAL`).
- Passo 2: `npm test` → **188/188** (+3 in `tests/anniScolastici.test.js`). Righe
  `[errore]`: le stesse 4 della baseline.
- Passo 1: `npm test` → **185/185** (181 + 4 di `tests/anniScolastici.test.js`).
  Righe `[errore]`: le stesse 4 della baseline (casi negativi attesi: `/finto`
  ×2, `/api/admin/traduzioni` 23503, `/api/platform/tenants` 23505).

## E2E nel cloud: accorgimento
Come nell'iterazione 1: un file **fuori dal repository**
(`/tmp/claude-0/…/scratchpad/preload-chromium.js`) caricato con
`NODE_OPTIONS="--require …"`, che aggiunge solo
`executablePath: '/opt/pw-browsers/chromium'` (rev. 1243) a `chromium.launch()`.
Comando: `NODE_OPTIONS="--require <preload>" npm run test:e2e`. Il proprietario
li riesegue in locale con il comando ufficiale.

## Decisioni prese (oltre a quelle del prompt)
- **006:** il DEFAULT di `school_years.stato` resta `'attivo'`: i seed e i dati
  esistenti inseriscono anni senza stato. L'anno creato dall'interfaccia nasce
  `in_preparazione` per decisione del server, non del DEFAULT.
- **006:** il CHECK della 000 si trova in `pg_constraint` tra i vincoli CHECK di
  `school_years` che usano la colonna `stato` (via `conkey`), e si sostituisce con
  `ck_school_years_stato`. Alla riesecuzione si elimina e si ricrea anche quello.
- **006:** nomi degli indici `uq_school_years_un_attivo` e
  `uq_school_years_una_preparazione`.

- **Regola dell'anno (passo 2):**
  - scritture dei docenti su un anno `in_preparazione` → 409 con un **codice
    nuovo** `ERR_SCHOOL_YEAR_IN_PREPARATION` (più preciso di
    `ERR_SCHOOL_YEAR_CLOSED`, che resta per gli anni chiusi o assenti);
  - `verificaAnnoScolasticoConfigurabile` (nuova): `attivo` e `in_preparazione`
    → riuscita; `chiuso` → 409 `ERR_SCHOOL_YEAR_CLOSED`; anno di un altro tenant
    → 404 `UI_RESOURCE_SCHOOL_YEAR`. Stesso `FOR SHARE` della regola dei docenti;
  - percorso degli insegnamenti: `GET /api/teachings` e
    `GET /api/classes/:id/teachings` escludono gli anni in preparazione; le
    **letture** da un insegnamento o da un'attività di quegli anni rispondono
    404 (come se non esistessero). Le **scritture** dei docenti passano invece
    dalla verifica dell'anno e ricevono il 409: così il test richiesto «scrittura
    su anno in preparazione → 409» vale anche per chi conosce l'id.

- **Calendario (passo 3):**
  - rotte sotto `/api/admin`, montate dentro il dominio (`routes/amministrazione.js`);
  - permesso `tenant.manage_config` verificato **prima** della ricerca della
    risorsa: docente e coordinatore → sempre 403; anno o periodo di un'altra
    scuola → 404;
  - le **azioni ammesse** su ogni anno (`attiva`, `passa`, `chiudi`, `riapri`,
    `elimina`) e l'**anno di lavoro** predefinito le decide il server (R-13);
    `elimina` compare solo se l'anno non ha materie, iscrizioni o periodi;
  - «passa al nuovo anno» = `POST /school-years/:id/switch-to` sull'anno in
    preparazione: prima chiude l'attivo, poi attiva il nuovo; due righe
    d'audit `school_year.switch` (una per anno) con lo stesso `correlation_id`;
  - senza anno attivo, `switch-to` → 409 `ERR_SCHOOL_YEAR_NO_ACTIVE` (si usa
    «attiva»); transizione da uno stato sbagliato → 409
    `ERR_SCHOOL_YEAR_TRANSITION_NOT_ALLOWED`;
  - le transizioni bloccano con `FOR UPDATE` tutti gli anni del tenant;
  - nome e date di un anno **non** si modificano (non previsto dal prompt): un
    anno in preparazione senza dati si elimina e si ricrea;
  - sovrapposizione: basta un giorno in comune (`inizio ≤ fine altrui` e
    `fine ≥ inizio altrui`);
  - periodi: eliminando un periodo si eliminano anche le sue traduzioni
    (`content_translations`), che non sono «dati collegati» ma parte del nome;
  - errori sul campo: ogni errore di validazione porta `campo` (UI_FIELD_*).

- **Livelli e classi (passo 4):**
  - livelli con `tenant.manage_config` (permesso prima della risorsa); classi con
    `class.manage` nell'ambito del livello e della classe, **dopo** aver trovato
    la risorsa nel tenant (404 prima di 403, come le rotte di lettura delle classi);
  - ordine di un nuovo livello: facoltativo, per default in coda (max + 1, deciso
    dal server); riordino = modifica del numero d'ordine (`PUT`);
  - «dati collegati» di un livello: classi, materie, scale, soglie, ruoli con
    ambito sul livello; di una classe: iscrizioni, insegnamenti, ruoli con ambito
    sulla classe. Le traduzioni del nome si eliminano con il livello;
  - in un livello **disattivato** non si creano né si riattivano classi (409
    `ERR_SCHOOL_LEVEL_DEACTIVATED`); le classi esistenti restano;
  - disattivare ciò che è già disattivato (o viceversa) → 409 `ERR_STATE_UNCHANGED`;
  - **nessuna rotta scrive `school_level_id`** (né altre colonne protette dalla
    004): `PUT /admin/classes/:id` ignora un eventuale `schoolLevelId` (test). Le
    violazioni della 004 restano quindi impossibili da queste rotte; se un domani
    arrivassero, il gestore errori le traduce già in 409
    `ERR_IMMUTABLE_REFERENCE` (test esistente in `immutabilita.test.js`);
  - le eliminazioni con dati collegati sono verificate prima del DELETE; in più
    un 23503 residuo sul DELETE diventa 409 con lo stesso codice (mai 400 o 500).

- **Quadro (passo 5):** `GET /api/admin/overview?anno=<id>`:
  - codici delle cose da fare `UI_TODO_*` (identificatori di catalogo), nell'ordine
    in cui si sistemano; `collegamento` = `{ sezione, annoId?, livelloId? }` solo
    per calendario, livelli e classi; `null` per alunni, insegnamenti e password
    (sezioni dei passi B e D);
  - «nessun livello» conta solo i livelli **attivi**; le classi e i livelli
    disattivati non producono cose da fare; i livelli disattivati restano nel
    riepilogo, con il loro stato;
  - «password temporanea»: account con membership attiva nel tenant, account
    attivo, `deve_cambiare_password`; una voce per persona (nome ed email);
  - senza alcun anno: `anno = null` e le voci legate all'anno non compaiono;
  - riepilogo per livello: classi attive, alunni distinti con iscrizione attiva
    nell'anno, docenti distinti e insegnamenti attivi nell'anno.

- **Cornice del client (passo 6):**
  - rotta `#/amministrazione[/<sezione>[/<livelloId>]][?anno=<id>]`: sezione,
    livello e **anno di lavoro restano nella rotta** (decisione 16), mai in una
    preferenza; senza sezione: il Quadro per chi amministra l'istituto, le Scuole
    per il PLATFORM_ADMIN senza istituto attivo (l'URL resta `#/amministrazione`,
    come chiedono gli E2E esistenti);
  - menu delle sezioni (`nav` con `aria-current="page"`) solo con le sezioni
    realizzate e visibili all'utente; con una sola sezione non compare;
  - «Scuole» del PLATFORM_ADMIN è una sezione del menu (prima era in testa alla
    pagina unica); dopo la creazione di una scuola le credenziali si mostrano lì;
  - **anno su cui si lavora**: un collegamento per anno con il suo stato
    (`aria-current`), nessun `<select>`; compare solo nelle sezioni legate
    all'anno (Quadro, Calendario); l'anno predefinito arriva dal server;
  - **quadro**: «Cose da fare» come elenco di testi del catalogo, ognuno
    collegamento alla sezione in cui si sistema **solo se quella sezione esiste
    già**; «Riepilogo per livello» come tabella semplice (R-4: nessun numero
    grande, nessun riquadro);
  - **completezza delle traduzioni**: resta nella pagina iniziale, in coda al
    quadro, finché la sezione «Lingue e traduzioni» non sarà realizzata. Così
    resta raggiungibile dove l'E2E esistente dell'iterazione 1 la cerca (h3 nella
    prima vista dell'amministrazione).

- **Calendario nel client (passo 7):**
  - i pulsanti di ogni anno sono quelli ricevuti dal server (`azioni`); ogni
    transizione chiede conferma (`window.confirm`, come la reimpostazione della
    password), con un testo che nomina l'anno e le conseguenze;
  - «Passa al nuovo anno» compare come riquadro in testa agli anni quando
    esistono un anno attivo e uno in preparazione (`passaggio` dal server);
  - i periodi mostrati sono quelli dell'**anno di lavoro**; su un anno chiuso
    si leggono soltanto (nota, nessun pulsante, nessun modulo);
  - la modifica di un periodo avviene sul posto (il modulo sostituisce la riga,
    «Annulla» ridisegna); dopo ogni scrittura riuscita la vista si ridisegna dal
    server con «Modifica salvata.».

- **Livelli e classi nel client (passo 8):**
  - sezione «Livelli e classi»: elenco dei livelli (anche disattivati, con lo
    stato e il numero di classi attive dal server), «Classi» porta alle classi
    del livello (`#/amministrazione/classi/<livello>`, nel menu resta evidenziata
    «Livelli e classi», le briciole tornano ai livelli);
  - livelli: nuovo (nome, ordine facoltativo), modifica sul posto (nome e
    ordine), disattiva (con conferma), riattiva, elimina (con conferma, solo se
    il server la ammette);
  - classi: nuova, rinomina sul posto, disattiva (con conferma), riattiva,
    elimina (con conferma); in un livello disattivato niente modulo e una nota;
  - **nessuna azione «sposta in un altro livello»** (decisione 14).

- **E2E (passo 9):** tre test nuovi in coda a `tests/e2e.test.js`, ognuno su
  una scuola vuota creata via API dal PLATFORM_ADMIN (`zeta`, `passaggio`,
  `specchio`): il percorso completo con errore sul campo, axe-core su ogni vista;
  «passa al nuovo anno» annullato (nessuna richiesta) e poi confermato (una sola
  richiesta); RTL della cornice (menu, anni, percorso). Nessun test esistente
  toccato, salvo il commento d'intestazione del file.

## Preparazione dei dati di test adattata (nessuna asserzione modificata)
Il nuovo indice vieta un secondo anno `attivo` nello stesso tenant. Due test ne
creavano uno con il DEFAULT:
| File | Dove | Prima | Dopo |
|---|---|---|---|
| `tests/immutabilita.test.js` | `conFixture`, funzione `anno()` (anni Y1 e Y2) | `INSERT INTO school_years (tenant_id, nome, data_inizio, data_fine)` → stato `attivo` | stesso INSERT con `stato = 'chiuso'` |
| `tests/integration.test.js` | «DB (cross-year)…», anno `2027/2028` | stato `attivo` (DEFAULT) | `stato = 'chiuso'` |

In entrambi i casi lo stato dell'anno non entra nelle verifiche: i test lavorano
con SQL diretto sui trigger della 004 (immutabilità) o verificano un 400 prodotto
prima di ogni controllo sull'anno del nuovo record (cross-year: l'insegnamento è
nell'anno attivo del seed).

## Asserzioni esistenti modificate
Nessuna.
