# Osservazioni pedagogiche — multi-tenant, Visual Grammar V2.1

Sistema di osservazioni pedagogiche strutturate, multi-tenant e
multiutente: più istituti (tenant), più ruoli (docente, coordinatore,
amministratore di istituto, amministratore di piattaforma), più materie,
più classi, più anni scolastici, ciascuno con la propria configurazione
pedagogica (livelli, materie, unità tematiche, criteri, scala di
osservazione, soglie di giudizio).

Questa versione **sostituisce integralmente** il prototipo mono-tenant
precedente (un solo docente identificato via header `X-Docente-Id`, senza
sessione, senza tenant, senza RBAC): quel modello è superato. La logica di
calcolo pedagogico (percentuali, giudizi, "Report classe" come fotografia
di una singola attività) è stata portata sul nuovo dominio.

## Visual Grammar V2.1 (revisione 2)

La presentazione dei dati segue la **Visual Grammar V2.1, revisione 2**, che prevale sulla
V2 per la rappresentazione (§12 e §16) lasciando invariata la semantica (Regola B,
aggregazioni, certezza, criticità, esclusioni, n/N):

- **Percorso unico** `Insegnamenti → materia → classe → {Quadro classe, Studenti,
  Attività, Valutazioni}`; dentro le viste, gerarchia L0 → L1 → L2 → L3 con lo **stesso
  disco** a ogni livello. Niente Dashboard, niente radar, niente andamento.
- **Disco**: settore = categoria (nucleo, poi criterio), tutti della stessa ampiezza;
  raggio del riempimento = valore (0% bordo interno, 100% bordo esterno); 1 elemento =
  cerchio, 2 = semicerchi, 3–6 = spicchi, oltre 6 solo carte e tabella.
- **Colore = banda**, assegnato dal server (`bande[].colore`), sempre insieme a numero ed
  etichetta. **Valore osservato ≠ non osservato**: ogni valore della scala 0…n è
  un'osservazione reale con la sua banda e il suo colore (`scala.valori[].bandaId`, stessa
  formula del motore: valore ÷ massimo × 100 con la Regola B); null = nessuna
  osservazione, grigio neutro tratteggiato, mai un colore di banda.
- **Certezza** = righe sopra il colore (●●● / ●●○); **criticità** = fascia interna della
  zona critica, bordo pieno (in banda critica) o tratteggiato con ⚠ (da verificare).
- **Riferimenti**: ⌒ arco scuro con terminali = classe; ◇ = storico dell'alunno.
  ▲ ▼ = nel profilo confrontano il nucleo con il complessivo dello stesso alunno.
- **Valutazione del docente** (■): usa il colore della banda solo se il giudizio coincide
  con l'etichetta di una banda (maiuscole e spazi ignorati); altrimenti nessun colore.
- **Navigazione a pila**: «← livello superiore», briciole, `history.pushState` (il tasto
  Indietro del browser torna al livello precedente; l'indirizzo riapre lo stesso livello).
- **Accessibilità**: ogni disco ha «Mostra come tabella» (equivalente, stampabile, per
  screen reader); i settori si aprono anche da tastiera.
- **Il server decide tutto il significato**: valori in centesimi interi (Regola B,
  `kc = floor((x + ε) × 100)`), bande, certezza, criticità (⚠ banda critica / da
  verificare), confronti confermati, esclusioni con motivo, posizioni sull'asse. Il
  client non calcola, non contiene testi e non sceglie la lingua.
- **Lingua (C2)**: prima della scelta del tenant vale la lingua di piattaforma; poi la
  preferenza dell'account se abilitata nel tenant, altrimenti la lingua predefinita del
  tenant; rivalutata a ogni richiesta, mai un parametro del client. Testi di sistema dal
  catalogo (`server/i18n/catalogo/<lingua>.json` + sovrascritture del tenant); un testo
  mancante è segnalato (`⟨?⟩`), mai sostituito da un'altra lingua. Contenuti pedagogici
  multilingue con ritorno alla lingua d'origine e attributo `lang`.
- **Errori come codici** `{ errore: { codice: 'ERR_*', parametri } }`, tradotti dal client.
- **RTL**: solo proprietà CSS logiche; il disco si specchia (settori nel verso di lettura).

Il catalogo `it.json` è un **catalogo di prova** (testi provvisori, non definitivi).

## Architettura in breve

Due assi distinti (il primo decide **chi può operare**, il secondo **su
cosa**):

```
IDENTITY -> ACCOUNT -> MEMBERSHIP -> TENANT -> ROLE ASSIGNMENT -> SCOPE -> PERMISSION -> RESOURCE
TENANT -> SCHOOL LEVEL -> SCHOOL YEAR -> SUBJECT -> PEDAGOGICAL UNIT -> CRITERION
                                                                            ↓
                                  CLASS -> ENROLLMENT -> TEACHING -> ACTIVITY -> OBSERVATION -> ASSESSMENT
```

- **Sessione server-side**: il browser riceve solo un token opaco casuale
  (cookie `session_token`, HttpOnly/Secure/SameSite=Lax); il database salva
  solo il suo hash SHA-256.
- **CSRF**: ogni mutazione (POST/PUT/PATCH/DELETE) richiede l'header
  `X-CSRF-Token`, derivato dalla sessione (`HMAC-SHA256(SESSION_SECRET, sessionId)`).
- **RBAC grant-only con scope**: `Role -> Permission`, `RoleAssignment ->
  Role + Scope (PLATFORM/TENANT/SCHOOL_LEVEL/CLASS/TEACHING/STUDENT)`.
  Nessun DENY: basta una concessione valida in uno scope applicabile.
- **Integrità cross-tenant/anno/classe/materia**: quasi interamente tramite
  chiavi esterne composte (non trigger) — vedi i commenti in
  `migrations/000_schema_base.sql`.
- **Audit append-only**: `audit_log` è di proprietà di un ruolo Postgres
  separato (`audit_owner`); l'applicazione opera sempre come `app_role`
  (`SET ROLE` a ogni connessione), che ha solo INSERT/SELECT su quella
  tabella.

## Struttura del progetto

```
migrations/
  000_schema_base.sql              Schema completo (tenant, RBAC, dominio pedagogico e operativo)
  001_ruoli_permessi_sistema.sql   Ruoli/permessi di sistema (PLATFORM_ADMIN, TENANT_ADMIN, COORDINATOR, TEACHER)
  002_audit_append_only.sql        Ruoli DB app_role/audit_owner e privilegi
  003_lingua_contenuti_v2.sql      V2: lingue, lingua di piattaforma/tenant/preferita, sovrascritture
                                   del catalogo, traduzioni dei contenuti, lingua dei contenuti d'autore
  004_immutabilita_strutturale.sql Trigger di immutabilità dei riferimenti strutturali
  005_account_primo_accesso.sql    Obbligo di cambio password, scadenza della password temporanea,
                                   unicità dell'email senza maiuscole
  006_anni_in_preparazione.sql     Stato «in_preparazione» degli anni scolastici; al più un anno attivo
                                   e uno in preparazione per tenant
seed/
  seed_multitenant.sql             Due tenant di esempio, utenti, classi, Teaching, Activity, Observation
server/
  db.js                            Pool pg, SET ROLE app_role, verifica schema applicato
  index.js                         Avvio del server Express
  lib/
    password.js                    Argon2id (@node-rs/argon2: binding precompilati, nessuna build locale)
    sessioni.js                    Sessioni: creazione, lookup, timeout, revoca, rotazione
    csrf.js                        Token CSRF derivato dalla sessione
    autorizzazione.js              RBAC: risoluzione dei permessi per scope
    audit.js                       Scrittura di audit_log nella stessa transazione della mutazione
    calcoloEsiti.js                Regola B: centesimi interi, ε unico, soglie, precisione di dettaglio/sintesi
    calcoloProgresso.js            Motore V2: certezza, criticità, confronti, copertura, distribuzione
    pubblicazione.js               Forma pubblica dei valori, delle bande e della scala
    lingua.js, catalogo.js         Risoluzione della lingua (C2/P3) e del catalogo di sistema
    contenuti.js                   Traduzioni dei contenuti pedagogici, completezza, audit
    erroreApplicativo.js           Errore applicativo: stato HTTP + codice ERR_* + parametri
    asincrono.js                   Wrapper per le route async
    validazione.js                 Validazione dei moduli dell'amministrazione (campi, date, 409 per FK)
  middleware/
    autenticazione.js              Legge il cookie di sessione
    csrf.js                        Verifica il token CSRF sulle mutazioni
    contestoTenant.js               Risolve/verifica il tenant attivo della sessione
  queries/
    account.js, tenant.js, rbac.js, configurazione.js, dominio.js, progresso.js
    calendario.js, struttura.js, quadro.js   Amministrazione dell'istituto: anni (anche il nome) e periodi,
                                   livelli e classi, quadro (cose da fare, riepilogo per livello)
  routes/
    auth.js, tenant.js, dominio.js, i18n.js, index.js (pipeline e gestore errori)
    amministrazione.js             /api/admin: calendario, livelli, classi, quadro (iterazione 2A)
  i18n/catalogo/it.json            Catalogo di sistema di prova
public/
  index.html                       Guscio senza testi
  css/app.css                      Stile (solo proprietà logiche)
  js/i18n.js                       Catalogo, plurali, formattazione Intl
  js/geometria.js                  Sola geometria grafica del disco (seno/coseno), nessuna semantica
  js/grammatica.js                 Componenti della grammatica visuale (disco, carta, tabella, segni)
  js/app.js                        Percorso unico e viste V2; griglia con salvataggio sul posto e reflow;
                                   partenza per ruolo; «Classi del mio livello»
tests/
  calcoli.test.js, regolaB.test.js Test puri del motore (nessun database)
  conformita.test.js               Controlli statici del client (proprietà logiche, testi, nessun calcolo)
  integration.test.js              Sessione, CSRF, tenant/RBAC, audit, integrità DB, viste V2
  lingua.test.js                   Lingua C2/P3, catalogo, errori come codici, contenuti multilingue
  v21.test.js                      Campi E1–E4 del payload V2.1 (colori, bande dei valori, complessivo, valutazioni)
  geometria.test.js                Geometria del disco (settori uguali, raggio = valore, RTL)
  primoAccesso.test.js             Migration 005, nuova scuola e primo amministratore, password temporanea,
                                   cambio obbligatorio, reimpostazione, nessuna password in audit e log
  sceltaIstituto.test.js           Selezione automatica dell'istituto, ruoli per scuola
  anniScolastici.test.js           Migration 006, regola dell'anno (docenti / configurazione), calendario
  strutturaIstituto.test.js        Livelli, classi e quadro dell'istituto
  inserimentoOsservazioni.test.js  Regola di scrittura (sola lettura), esito sul posto del salvataggio di una cella,
                                   controlli statici del salvataggio sul posto, partenza per ruolo, nome dell'anno
  e2e.test.js                      Browser sul seed esteso: viste V2.1, colori, navigazione, RTL, B/N, axe-core,
                                   creazione di una scuola e primo accesso, amministrazione dell'istituto,
                                   inserimento delle osservazioni (sola lettura, salvataggio sul posto, reflow
                                   da 320 px), partenza per ruolo, «Classi del mio livello», nome dell'anno
  support/pglite.js                Database di prova in memoria (PGlite) per i test, nessuna installazione richiesta
```

## Prerequisiti

- Node.js 18+
- Per l'uso reale: un PostgreSQL 14+ (locale o Neon). **Per i test non
  serve nulla**: usano PGlite (PostgreSQL compilato in WebAssembly),
  incluso come dipendenza di sviluppo.

## Installazione

```bash
npm install
cp .env.example .env
```

Modificare `.env`:
- `DATABASE_URL`: stringa di connessione al PostgreSQL.
- `SESSION_SECRET`: valore casuale lungo, es.
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `COOKIE_SECURE`: `false` solo per sviluppo locale su `http://` senza TLS;
  altrimenti sempre `true`.

## Preparare il database

Le migration vanno eseguite **in ordine numerico**, una sola volta, con un
ruolo che possa creare tabelle/ruoli/trigger (es. il ruolo owner del
database):

```bash
psql "$DATABASE_URL" -f migrations/000_schema_base.sql
psql "$DATABASE_URL" -f migrations/001_ruoli_permessi_sistema.sql
psql "$DATABASE_URL" -f migrations/002_audit_append_only.sql
psql "$DATABASE_URL" -f migrations/003_lingua_contenuti_v2.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/004_immutabilita_strutturale.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/005_account_primo_accesso.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/006_anni_in_preparazione.sql
```

La 003 non modifica i privilegi di `audit_log` stabiliti dalla 002 e concede
esplicitamente a `app_role` i privilegi sulle nuove tabelle.

La 004 aggiunge i trigger di immutabilità (decisione 2 della chiusura V1.1):
va eseguita con il ruolo proprietario delle tabelle, è rieseguibile e, a
fine esecuzione, `pg_trigger` deve contenere 26 trigger `trg_%immutabil%`.

La 005 aggiunge `accounts.deve_cambiare_password` (default `false`: gli account
esistenti non sono toccati), `accounts.password_temporanea_scade_il` e l'indice
univoco `uq_accounts_email_lower` su `lower(email)`. Se trova email doppie a
meno delle maiuscole si ferma senza applicare nulla e indica la query per
elencarle. È rieseguibile.

La 006 estende il CHECK di `school_years.stato` a `'in_preparazione'` (il
vincolo della 000 si cerca in `pg_constraint`) e crea due indici univoci
parziali: al più un anno `attivo` (`uq_school_years_un_attivo`) e al più uno
`in_preparazione` (`uq_school_years_una_preparazione`) per tenant. Se un tenant
ha già più di un anno attivo si ferma senza applicare nulla e indica la query
per elencarli. Il DEFAULT resta `'attivo'`; un anno creato dall'interfaccia
nasce in preparazione. È rieseguibile.

Poi, per un ambiente di sviluppo/collaudo con dati di esempio realistici
(due tenant, più utenti, classi, Teaching, Activity, Observation — **mai
su un database di produzione reale**):

```bash
psql "$DATABASE_URL" -f seed/seed_multitenant.sql
```

Per provare le viste V2 con più dati (sempre e solo in sviluppo), **dopo** il seed di
base si può applicare il seed esteso: 36 alunni in più in Alfa 2A/2B, 23 attività,
circa mille osservazioni con profili diversi, un criterio critico in 2A, difficoltà
generalizzata in 2B, un'iscrizione disattivata, valutazioni del primo quadrimestre.
È idempotente (una seconda esecuzione non fa nulla):

```bash
psql "$DATABASE_URL" -f seed/seed_esteso.sql
```

### Reset del database

Non esistono migration "down": per ripartire da zero, ricreare il database
(`DROP DATABASE` + `CREATE DATABASE`, o l'equivalente sul proprio provider)
e rieseguire la sequenza sopra. Questo è intenzionale (sez. 44 dell'
architettura: migration idempotenti/ripetibili, non reversibili riga per
riga) ed è lo stesso procedimento usato per ricreare il database di test a
ogni esecuzione della suite.

## Avvio

```bash
npm start        # produzione/uso normale
npm run dev       # riavvio automatico ai cambiamenti (node --watch)
```

Il server serve anche il frontend statico (`public/`) sulla stessa porta:
aprire `http://localhost:3000`.

## Test

```bash
npm test               # unitari + conformità + integrazione + lingua
npm run test:unit      # motore e controlli statici
npm run test:integration
npm run test:e2e       # nel browser (richiede Chromium per playwright-core)
npm run test:all       # tutto
```

`npm test` esegue, in quest'ordine: `calcoli`, `regolaB`, `conformita`, `integration`, `lingua`,
`seedEsteso`, `v21`, `geometria`, `immutabilita`, `primoAccesso`, `sceltaIstituto`, `anniScolastici`,
`strutturaIstituto`, `inserimentoOsservazioni` (tutti in `tests/`, `*.test.js`). Un file di test nuovo va
aggiunto agli script `test` e `test:integration` di `package.json`, altrimenti non viene eseguito.

**Prima esecuzione degli E2E su un computer nuovo:** installare una volta il
browser di Playwright, altrimenti tutti i casi E2E falliscono subito con
`Executable doesn't exist`:

```bash
npx playwright-core install chromium
```

I test di integrazione usano PGlite: un database Postgres reale (WASM),
ricreato da zero a ogni esecuzione con l'intera catena
`migrations/000 → 001 → 002 → 003 → 004 → 005 → 006 → seed/seed_multitenant.sql`. Nessuna
installazione di PostgreSQL è necessaria per eseguire la suite. Non
richiedono nemmeno una `DATABASE_URL` o un `SESSION_SECRET` propri: li
imposta `tests/support/pglite.js`.

## Utenti seed e credenziali di sviluppo

**Password di sviluppo per tutti gli account seminati: `Sviluppo!2026`**
(condivisa, solo per il primo collaudo — non è un valore da usare con dati
reali: sostituire con un provisioning vero prima di qualunque uso in
produzione).

| Email | Ruolo | Scope | Tenant |
|---|---|---|---|
| `platform.admin@platform.test` | PLATFORM_ADMIN | PLATFORM | — |
| `tenant.admin.a@alfa.test` | TENANT_ADMIN | TENANT | Alfa |
| `coordinator.a@alfa.test` | COORDINATOR | SCHOOL_LEVEL (Primaria) | Alfa |
| `teacher.math.a@alfa.test` | TEACHER | TEACHING (Matematica 2A **e** 2B) | Alfa |
| `teacher.italian.a@alfa.test` | TEACHER | TEACHING (Italiano 2A) | Alfa |
| `tenant.admin.b@beta.test` | TENANT_ADMIN | TENANT | Beta |
| `teacher.math.b@beta.test` | TEACHER | TEACHING (Matematica e Logica 2A) | Beta |
| `multitenant.user@example.test` | TEACHER (Alfa) / COORDINATOR (Beta) | TEACHING / SCHOOL_LEVEL | Alfa **e** Beta |

Tenant Alfa e Beta hanno configurazioni pedagogiche deliberatamente
diverse (nomi delle materie, scala di osservazione 0-2 vs 1-4, soglie di
giudizio), per dimostrare che la configurazione è realmente tenant-owned
(vedi `seed/seed_multitenant.sql`).

## Scenario di verifica end-to-end

```
POST /api/auth/login (teacher.math.a@alfa.test)
  → POST /api/auth/switch-tenant (Alfa)
  → GET /api/teachings                          (Matematica 2A/2B)
  → GET /api/teachings/:id/activities            ("Numeri entro il cento")
  → GET /api/activities/:id/griglia              (scrittura: { consentita: true, motivo: null })
  → PUT /api/activities/:id/enrollments/:e/criteria/:c  (osserva un alunno: cella ed esito della riga)
  → riga in audit_log nella stessa transazione

POST /api/auth/login (teacher.math.b@beta.test)
  → tenant Beta: nessun accesso alle risorse di Alfa (verificato dai test)

POST /api/auth/login (multitenant.user@example.test)
  → switch Alfa → switch Beta: il contesto cambia realmente

PLATFORM_ADMIN → GET/POST /api/platform/tenants (qualunque tenant)
```

### API introdotte o modificate dalla V2

| Metodo e percorso | Permesso | Contenuto |
|---|---|---|
| `GET /api/i18n` | nessuno | Catalogo risolto per la lingua della sessione (P3 senza tenant) |
| `GET /api/teachings` | sessione | Insegnamenti propri e leggibili per scope (percorso unico) |
| `GET /api/teachings/:id/class-overview` | `report.read` | Quadro classe: complessivo, distribuzione per banda, blocco attenzione, nuclei, criteri |
| `GET /api/teachings/:id/students-matrix` | `observation.read` | Matrice alunni × nuclei con `inZonaCritica` |
| `GET /api/teachings/:id/students/:e/progress` | `observation.read` | Profilo L0–L3: corrente, cumulativo (◇), riferimenti, osservazioni, esclusioni |
| `GET /api/teachings/:id/assessments` | `assessment.read` | Valutazioni con evidenza del periodo |
| `GET /api/activities/:id/griglia` | `observation.read` | Griglia di inserimento con esito per alunno |
| `GET /api/activities/:id/report-classe` | `report.read` | Esito dell'attività: distribuzione, base, aggregato, banda |
| `PUT /api/me/lingua` | sessione | Lingua preferita nel tenant attivo (se abilitata) |
| `GET /api/admin/traduzioni/completezza` | `tenant.manage_config` | Completezza delle traduzioni per lingua e campo |
| `PUT /api/admin/traduzioni` | `tenant.manage_config` | Traduzione di un contenuto pedagogico (con audit) |

Campi aggiunti dalla V2.1 (revisione 2), derivati senza calcoli nuovi e senza migrazioni:
`bande[].colore` e `bande[].inchiostro` (E1, in tutti i report), `scala.valori[].bandaId`
(E2: profilo, griglia, esito attività), `studenti[].complessivo` nella matrice (E3),
`valutazioni[].bandaId` (E4: profilo, valutazioni).

### API dell'amministrazione dell'istituto (iterazione 2A)

Tutte sotto `/api/admin`, con tenant attivo; ogni scrittura in una transazione
con il suo audit. Una risorsa di un'altra scuola risponde 404.

| Metodo e percorso | Permesso | Contenuto |
|---|---|---|
| `GET /api/admin/overview?anno=<id>` | `tenant.manage_config` | Quadro: cose da fare (`UI_TODO_*`, parametri, collegamento) e riepilogo per livello |
| `GET /api/admin/school-years` | `tenant.manage_config` | Anni con le azioni ammesse, anno di lavoro predefinito, passaggio proposto |
| `POST /api/admin/school-years` | `tenant.manage_config` | Nuovo anno (nasce `in_preparazione`) |
| `POST /api/admin/school-years/:id/activate`, `/close`, `/reopen`, `/switch-to` | `tenant.manage_config` | Transizioni; `switch-to` = «passa al nuovo anno» (atomico) |
| `DELETE /api/admin/school-years/:id` | `tenant.manage_config` | Solo un anno in preparazione senza dati collegati |
| `GET`, `POST /api/admin/school-years/:id/periods` | `tenant.manage_config` | Periodi di valutazione dell'anno |
| `PUT`, `DELETE /api/admin/periods/:id` | `tenant.manage_config` | Modifica ed eliminazione (solo senza giudizi) |
| `GET`, `POST /api/admin/school-levels` | `tenant.manage_config` | Livelli (anche disattivati) |
| `PUT`, `DELETE /api/admin/school-levels/:id`; `POST …/deactivate`, `…/reactivate` | `tenant.manage_config` | Rinomina e riordina, stato, eliminazione (solo senza dati) |
| `GET`, `POST /api/admin/school-levels/:id/classes` | `class.manage` | Classi del livello |
| `PUT`, `DELETE /api/admin/classes/:id`; `POST …/deactivate`, `…/reactivate` | `class.manage` | Rinomina, stato, eliminazione (solo senza dati) |

Regola dell'anno: le scritture dei docenti (attività, osservazioni) solo su un
anno `attivo` (`in_preparazione` → 409 `ERR_SCHOOL_YEAR_IN_PREPARATION`, `chiuso`
→ 409 `ERR_SCHOOL_YEAR_CLOSED`); quelle di configurazione (periodi, nome dell'anno) su
`attivo` e `in_preparazione`. Gli insegnamenti degli anni in preparazione non compaiono nel
percorso degli insegnamenti, per nessun ruolo.

### Inserimento delle osservazioni e partenza per ruolo (iterazione 2, lavoro 2)

| Metodo e percorso | Permesso | Contenuto |
|---|---|---|
| `GET /api/teachings/:id/scrittura` | `teaching.read` (ambito del Teaching; anno in preparazione → 404) | `{ attivita: { consentita, motivo }, osservazioni: { consentita, motivo } }` (`activity.create`, `observation.create`) |
| `GET /api/activities/:id/griglia` | `observation.read` | Campo aggiunto `scrittura: { consentita, motivo }` (`observation.create`) |
| `PUT /api/activities/:a/enrollments/:e/criteria/:c` | `observation.create` | Oltre a `observationId` ed `eliminato`: `cella: { criterionId, valore }` e `riga: { enrollmentId, valutazionePresenti, valutazioniTotali, esito }`, calcolati come nella griglia nella stessa transazione (anche per `valore: null`) |
| `GET /api/auth/me` (e login, `switch-tenant`, cambio password) | sessione | Campo aggiunto `partenza`: `scuole` (PLATFORM_ADMIN), `quadro` (TENANT_ADMIN), `classi` (COORDINATOR), `insegnamenti` (gli altri); precedenza nell'ordine; `null` senza tenant attivo |
| `PUT /api/admin/school-years/:annoId` | `tenant.manage_config` | `{ nome }`: nuovo nome di un anno attivo o in preparazione (anno chiuso → 409 `ERR_SCHOOL_YEAR_CLOSED`, nome occupato → 409 `ERR_SCHOOL_YEAR_NAME_TAKEN`); le date non cambiano; audit `school_year.rename` |
| `GET /api/admin/school-years` | `tenant.manage_config` | Campo aggiunto per anno `rinominabile` (l'elenco `azioni` non cambia) |

- **Regola unica di scrittura** (`regolaDiScrittura` in `server/queries/dominio.js`): `motivo` = chiave di catalogo
  del perché nessuno può scrivere ora (oggi l'anno chiuso), uguale per tutti i ruoli che leggono; `consentita` =
  nessun motivo e permesso del chiamante con l'ambito completo. Il 409 delle scritture dei docenti usa lo stesso
  punto (`motivoDiSolaLettura`).
- **Client**: avviso fisso di sola lettura (motivo dal server) sopra le schede dell'attività e nella scheda
  «Attività»; controlli della griglia e modulo «Nuova attività» solo se il server consente la scrittura.
  Salvataggio di una cella **sul posto**: nessun ridisegno, scritture in coda per alunno, esito della riga dal
  PUT, errore accanto al controllo con ritorno all'ultimo valore salvato. **Reflow**: nessuno scorrimento
  laterale della griglia da 320 px; quando la tabella non sta nel contenitore (larghezza misurata, non una soglia
  fissa) la stessa struttura diventa una scheda per alunno.
- **Rotte del client**: la partenza per ruolo vale per l'indirizzo vuoto o non riconosciuto, dopo l'accesso, dopo
  «Cambia istituto» e per il titolo dell'app (un indirizzo valido ha la precedenza). Nuove: `#/insegnamenti`
  (esplicita), `#/classi` («Classi del mio livello»: i livelli di cui l'utente è COORDINATOR, con le classi
  attive) e `#/classi/<classId>` (gli insegnamenti della classe, verso la scheda esistente della classe).

Tutti gli errori hanno la forma `{ "errore": { "codice": "ERR_*", "parametri": {…} } }`.

## Cosa NON è ancora incluso

Rinviato dalla Visual Grammar V2/V2.1: andamento (TREND_*: nessuna colonna e nessun indicatore finché non è definito),
quadro multi-materia, gruppi, forma definitiva del catalogo e testi definitivi
(il catalogo `it.json` è di prova), guida redazionale.

Dalla V1:

- Interfaccia di amministrazione per persone, insegnamenti, materie/unità/criteri
  e scale (iterazione 2, passi B–D; il passo A ha calendario, livelli, classi e
  quadro dell'istituto).
- Endpoint self-service di cambio password (la funzione di libreria
  `revocaTutteLeSessioni` esiste ed è testata, ma non c'è ancora una rotta
  HTTP che la usi).
- Row Level Security PostgreSQL (deliberatamente escluso dalla V1, sez. 43
  dell'architettura: hardening successivo).
- Viste analitiche per COORDINATOR/TENANT_ADMIN oltre al percorso unico.
