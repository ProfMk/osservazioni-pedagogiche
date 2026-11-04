# LAVORO IN CORSO — Iterazione 2, passo A (amministrazione dell'istituto)

**Ramo:** `claude/new-session-wd7goo` (assegnato dalla sessione cloud; il nome
`iterazione-2-passo-A` non era sceglibile), creato da `main` a `7bf0ca7`.
Push solo su questo ramo.

**Baseline a `7bf0ca7`:** `npm ci`, poi `npm test` → **181/181**.

## Passi
| Passo | Stato | Commit | Contenuto |
|---|---|---|---|
| 1 | fatto | `f849e04` | Migration 006 e test |
| 2 | fatto | (questo commit) | Regola dell'anno |
| 3 | da fare | | Server, calendario |
| 4 | da fare | | Server, livelli e classi |
| 5 | da fare | | Server, quadro |
| 6 | da fare | | Client, cornice dell'amministrazione e quadro |
| 7 | da fare | | Client, calendario |
| 8 | da fare | | Client, livelli e classi |
| 9 | da fare | | E2E |
| 10 | da fare | | README |

## Ultimo esito dei test
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
