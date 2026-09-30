# Osservazioni pedagogiche — V1 multi-tenant

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
    calcoloEsiti.js                Percentuali/giudizi, parametrici rispetto a scala e soglie del tenant
    erroreApplicativo.js           Errore applicativo con stato HTTP esplicito
    asincrono.js                   Wrapper per le route async
  middleware/
    autenticazione.js              Legge il cookie di sessione
    csrf.js                        Verifica il token CSRF sulle mutazioni
    contestoTenant.js               Risolve/verifica il tenant attivo della sessione
  queries/
    account.js, tenant.js, rbac.js, configurazione.js, dominio.js
  routes/
    auth.js, tenant.js, dominio.js, index.js (pipeline e gestore errori)
public/index.html                  Frontend minimo: login, switch tenant, Teaching → Activity → griglia → Report classe
tests/
  calcoli.test.js                  Test puri di calcolo (nessun database)
  integration.test.js              Sessione, CSRF, tenant/RBAC, audit, integrità DB, Report classe
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
```

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
npm test              # tutta la suite (unitari + integrazione)
npm run test:unit      # solo calcoli.test.js
npm run test:integration
```

I test di integrazione usano PGlite: un database Postgres reale (WASM),
ricreato da zero a ogni esecuzione con l'intera catena
`migrations/000 → 001 → 002 → seed/seed_multitenant.sql`. Nessuna
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

## Cosa NON è ancora incluso (fuori dallo scope di questa V1)

- Interfaccia di amministrazione per configurare materie/unità/criteri/scale
  (oggi solo lettura via query, popolabili via seed/SQL diretto).
- Endpoint self-service di cambio password (la funzione di libreria
  `revocaTutteLeSessioni` esiste ed è testata, ma non c'è ancora una rotta
  HTTP che la usi).
- Le viste storiche "progresso studente nel tempo" con media mobile delle
  ultime osservazioni, presenti nel prototipo mono-tenant, non sono state
  riportate sul nuovo schema: la sola vista storica riportata è il "Report
  classe" (fotografia di una singola attività, senza media mobile).
- Row Level Security PostgreSQL (deliberatamente escluso dalla V1, sez. 43
  dell'architettura: hardening successivo).
- Dashboard analitiche per COORDINATOR/TENANT_ADMIN oltre agli endpoint di
  lettura già disponibili.
