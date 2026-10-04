# Osservazioni pedagogiche — multi-tenant, Visual Grammar V2

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

## Visual Grammar V2

La presentazione dei dati segue la **Visual Grammar V2** (prevale sulla V1):

- **Percorso unico** `Insegnamenti → materia → classe → {Quadro classe, Studenti,
  Attività, Valutazioni}`; dentro le viste, gerarchia L0 → L1 → L2 → L3 in cui la riga
  scelta diventa l'intestazione del livello successivo. Niente Dashboard, niente radar.
- **Riga V2** con ordine fisso: nome · asse · banda · criticità · confronto · andamento
  (colonna riservata, andamento fuori ambito) · certezza · n/N.
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
- **RTL**: solo proprietà CSS logiche; l'asse si specchia da sé.

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
  middleware/
    autenticazione.js              Legge il cookie di sessione
    csrf.js                        Verifica il token CSRF sulle mutazioni
    contestoTenant.js               Risolve/verifica il tenant attivo della sessione
  queries/
    account.js, tenant.js, rbac.js, configurazione.js, dominio.js, progresso.js
  routes/
    auth.js, tenant.js, dominio.js, i18n.js, index.js (pipeline e gestore errori)
  i18n/catalogo/it.json            Catalogo di sistema di prova
public/
  index.html                       Guscio senza testi
  css/app.css                      Stile (solo proprietà logiche)
  js/i18n.js                       Catalogo, plurali, formattazione Intl
  js/grammatica.js                 Componenti della grammatica visuale (riga, asse, segni)
  js/app.js                        Percorso unico e viste V2
tests/
  calcoli.test.js, regolaB.test.js Test puri del motore (nessun database)
  conformita.test.js               Controlli statici del client (proprietà logiche, testi, nessun calcolo)
  integration.test.js              Sessione, CSRF, tenant/RBAC, audit, integrità DB, viste V2
  lingua.test.js                   Lingua C2/P3, catalogo, errori come codici, contenuti multilingue
  e2e.test.js                      Browser: percorso, viste, RTL, bianco/nero, accessibilità (axe-core)
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
```

La 003 non modifica i privilegi di `audit_log` stabiliti dalla 002 e concede
esplicitamente a `app_role` i privilegi sulle nuove tabelle.

Poi, per un ambiente di sviluppo/collaudo con dati di esempio realistici
(due tenant, più utenti, classi, Teaching, Activity, Observation — **mai
su un database di produzione reale**):

```bash
psql "$DATABASE_URL" -f seed/seed_multitenant.sql
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

I test di integrazione usano PGlite: un database Postgres reale (WASM),
ricreato da zero a ogni esecuzione con l'intera catena
`migrations/000 → 001 → 002 → 003 → seed/seed_multitenant.sql`. Nessuna
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
  → GET /api/activities/:id/griglia
  → PUT /api/activities/:id/enrollments/:e/criteria/:c  (osserva un alunno)
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

Tutti gli errori hanno la forma `{ "errore": { "codice": "ERR_*", "parametri": {…} } }`.

## Cosa NON è ancora incluso

Rinviato dalla Visual Grammar V2: andamento (TREND_*, la colonna è riservata),
quadro multi-materia, gruppi, forma definitiva del catalogo e testi definitivi
(il catalogo `it.json` è di prova), guida redazionale.

Dalla V1:

- Interfaccia di amministrazione per configurare materie/unità/criteri/scale
  (oggi solo lettura via query, popolabili via seed/SQL diretto).
- Endpoint self-service di cambio password (la funzione di libreria
  `revocaTutteLeSessioni` esiste ed è testata, ma non c'è ancora una rotta
  HTTP che la usi).
- Row Level Security PostgreSQL (deliberatamente escluso dalla V1, sez. 43
  dell'architettura: hardening successivo).
- Viste analitiche per COORDINATOR/TENANT_ADMIN oltre al percorso unico.
