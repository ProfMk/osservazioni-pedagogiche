# LAVORO IN CORSO — Iterazione 2, passo A (amministrazione dell'istituto)

**Ramo:** `claude/new-session-wd7goo` (assegnato dalla sessione cloud; il nome
`iterazione-2-passo-A` non era sceglibile), creato da `main` a `7bf0ca7`.
Push solo su questo ramo.

**Baseline a `7bf0ca7`:** `npm ci`, poi `npm test` → **181/181**.

## Passi
| Passo | Stato | Commit | Contenuto |
|---|---|---|---|
| 1 | fatto | `f849e04` | Migration 006 e test |
| 2 | fatto | `aa7b5a4` | Regola dell'anno |
| 3 | fatto | `783cf4f` | Server, calendario |
| 4 | fatto | `990b424` | Server, livelli e classi |
| 5 | fatto | (questo commit) | Server, quadro |
| 6 | da fare | | Client, cornice dell'amministrazione e quadro |
| 7 | da fare | | Client, calendario |
| 8 | da fare | | Client, livelli e classi |
| 9 | da fare | | E2E |
| 10 | da fare | | README |

## Ultimo esito dei test
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
