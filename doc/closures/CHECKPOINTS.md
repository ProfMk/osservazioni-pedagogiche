# Registro dei checkpoint — Osservazioni pedagogiche

Registro cronologico dell'avanzamento del progetto. Pensato per il passaggio
di mano tra chi definisce i requisiti (ChatGPT / docente) e chi implementa
(Claude Code).

## Regole d'uso

1. **Solo in aggiunta.** Le voci già scritte non si modificano né si cancellano.
   Un errore si corregge con una nuova voce che rimanda a quella sbagliata.
2. **Un checkpoint per iterazione chiusa**, scritto da chi l'ha eseguita, prima
   di passare al lavoro successivo.
3. **Decisioni pedagogiche e scelte tecniche stanno in due elenchi separati.**
   Ogni decisione pedagogica indica chi l'ha validata e quando.
4. **Ogni affermazione di verifica dice dove è stata verificata**: PGlite,
   Postgres locale o Neon reale. Un test non eseguito non è "passato".
5. **Cosa è aperto e cosa è bloccato** va sempre elencato, anche se invariato.
6. **Nuovo chat o nuova sessione = si parte leggendo l'ultimo checkpoint.**

Legenda: `[da confermare]` = dedotto, non verificato da chi scrive.

---

## CHECKPOINT 000 — Baseline (11/10/2026)

**Natura di questa voce:** fotografia iniziale, ricostruita dal README e
dall'albero delle cartelle. Non è il resoconto di un'iterazione. Va
confermata e corretta da chi ha lavorato in locale.

### Obiettivo del progetto
Gestione e analisi delle osservazioni pedagogiche degli alunni della scuola
primaria: raccolta, valutazione per criteri e nuclei tematici, storico,
indicatori di progresso individuale e di classe. Primo modulo: Matematica.

### Decisioni pedagogiche (validate)
- Scala dei punteggi 0 / 1 / 2: Non manifestato / Con supporto / Autonomo.
- "Non valutato" non è mai 0: è l'assenza della riga di valutazione.
- Soglie del giudizio: 90–100 OTTIMO, 80–89 DISTINTO, 70–79 BUONO,
  60–69 DISCRETO, 50–59 SUFFICIENTE, 0–49 NON SUFFICIENTE. Sostituiscono le
  soglie del documento originale (90/75/60/45/30/0). Effetto: il Caso A
  (66,67%) passa da BUONO a DISCRETO.
- Una sola osservazione per (attività, iscrizione); una sola valutazione per
  (osservazione, criterio).
- Risultato corrente di un criterio = media delle ultime 3 osservazioni;
  il nucleo e la materia sono la media a pesi uguali dei criteri valutati;
  il cumulativo da inizio anno è un'informazione secondaria.
- Un docente vede solo le proprie attività, anche nella stessa classe.

### Scelte tecniche
- Scala, formula e soglie vivono solo in `server/config/valutazione.js`.
- Autorizzazione verificata sempre lato server (`server/lib/autorizzazione.js`);
  risorsa altrui = 404, non 403.
- Migration sicura `001_vincoli_osservazioni.sql`: verifica prima, si ferma
  senza modificare nulla se trova anomalie, è idempotente.
- All'avvio il server verifica che i vincoli della migration esistano.
- Test: unitari senza database; integrazione su PGlite (in memoria) o su
  Postgres reale con `PGTEST_URL`.

### Stato verificato nel README (ultimo stato documentato)
- 27/27 test passati su Postgres locale (8 unitari + 19 integrazione).
- Creazione attività, nomi dei criteri in griglia, scheda alunno e progresso
  studente implementati.
- Due bug reali trovati dai test e corretti (import mancante di `nonTrovato`;
  `req.params` vuoto nel gestore errori di Express 5).

### Visto nell'albero delle cartelle, ma non documentato `[da confermare]`
- `@node-rs/argon2`: hashing delle password → esiste un login vero?
  Il README dice ancora che `auth.js` è solo un meccanismo di sviluppo.
- `server/middleware/`, `server/queries/` (cartella), `server/i18n/catalogo/`:
  da descrivere (internazionalizzazione? da quale lingua a quale?).
- `playwright-core` e `axe-core`: test da browser e verifica di accessibilità?
- `doc/`: contenuto da censire.
- `public/css`, `public/js`: frontend separato dal singolo `index.html`.

### Aperto e bloccato
- Migration 001 mai eseguita sul database Neon reale (nessuna rete
  dall'ambiente di sviluppo). Prima: `verifica_schema_e_dati.sql`, sezione 14.
  `[da confermare se nel frattempo è stata eseguita]`
- Test mai eseguiti su dati reali della scuola.
- Test di concorrenza (Caso I) eseguibile solo su Postgres vero.
- Non implementati per scelta: interfaccia di configurazione di scala/soglie/
  criteri, `scuola_id` e multi-tenancy, migrazione dei dati storici.
- Questo registro, finora assente.

### Prossimo passo
1. Chi ha il codice locale corregge la voce "da confermare" con un
   CHECKPOINT 001 (login, i18n, test browser, doc/).
2. Decidere se eseguire la migration su Neon prima di nuove funzioni.

---

## CHECKPOINT 001 — Correzione della baseline dopo `npm test` (11/10/2026)

**Natura di questa voce:** corregge la 000 usando l'output di `npm test`
eseguito in locale (Windows). Non descrive una nuova iterazione di sviluppo.
La 000 resta com'è: dove dice altro, vale questa voce.

### Verificato
- 132 test, 132 passati, 0 falliti, 0 saltati, 22,1 s.
- Otto file di test: `calcoli`, `regolaB`, `conformita`, `integration`,
  `lingua`, `seedEsteso`, `v21`, `geometria`.
- Su quale database girano (PGlite o Postgres) l'output non lo dice
  `[da confermare]`.

### Correzioni alla baseline 000
- **Test:** 132, non 27.
- **Login: esiste.** Sessione con cookie HttpOnly e csrfToken; logout con
  revoca; scadenza assoluta e per inattività; revoca di tutte le sessioni al
  cambio password; account disabilitato rifiutato; stesso 401 per password
  errata e account inesistente; protezione CSRF sulle mutazioni.
  Algoritmo di hashing `[da confermare: argon2]`.
- **Multi-tenancy: esiste** (la 000 la dava come non implementata). Tenant
  Alfa con scala 0–2 e Beta con scala 1–4; isolamento verificato in lettura e
  in scrittura; cambio di tenant; platform admin che crea e amministra tenant.
- **Ruoli e permessi:** TEACHER, COORDINATOR (con scope di livello scolastico),
  TENANT_ADMIN, platform admin. Un docente non può assegnarsi ruoli superiori
  e non ha `class.read`. Le assegnazioni di ruolo sono registrate in audit.
- **Audit:** `audit_log` append-only per `app_role`; prima/dopo scritti nella
  stessa transazione.
- **Database:** tutte le query girano sotto `app_role`. Vincoli verificati:
  nessun incrocio tra tenant, classi, anni o materie diverse; FK
  (scala, valore); RESTRICT sulle unità pedagogiche referenziate; trigger di
  immutabilità del Teaching dopo la creazione di un'Activity.
- **Vocabolario del modello dati in inglese** (Tenant, Teaching, Activity,
  Observation, Enrollment, Criterion, PedagogicalUnit, Assessment). Il README
  usa ancora i termini italiani `[da confermare la corrispondenza]`.
- **Internazionalizzazione: esiste.** Il client non contiene testi né fissa
  lingua, locale o direzione; catalogo con sovrascritture per tenant; lingua
  di piattaforma, di tenant e di sessione; errori come `{codice, parametri}`;
  contenuti d'autore con la loro lingua; traduzioni con audit; CSS senza
  proprietà fisiche sinistra/destra.
- **Report:** profilo studente V2, quadro classe, matrice alunni × nuclei,
  esito attività, con autorizzazione verificata (docente, coordinatore, altro
  tenant, co-docenza).

### Decisioni pedagogiche emerse dai test
Validazione: `[da confermare chi e quando]`. I riferimenti nei nomi dei test
(§7, §8, §17, §29.12, P3–P14, C2–C5, E1–E4, B-2…) rimandano a una
specifica che non è nella knowledge base del progetto.

- Scala e bande (soglie) configurate per tenant. Percentuale = media /
  massimo della scala × 100; in scala 1–4 il minimo vale 25%.
- **Regola B:** i valori si troncano, non si arrotondano. Tolleranza ε = 1e-9,
  la stessa del motore. Il numero mostrato raggiunge una soglia se e solo se
  la banda la raggiunge (49,99999999999999 vale 50).
- Risultato corrente di un criterio = media delle ultime 3 osservazioni
  (0,1,2,2 → 83,33%); il cumulativo da inizio anno (62,5%) è secondario.
- Complessivo dello studente = media dei criteri valutati della materia.
- Un criterio non osservato è NOT_OBSERVED, mai 0.
- **Certezza:** 0 osservazioni assente, 1–2 parziale, 3 o più sufficiente; la
  certezza del complessivo è il minimo dei criteri valutati.
- **Criticità:** zona della banda più bassa, in due gradi secondo la
  certezza; l'avviso compare solo con certezza sufficiente.
- **Classe:** media degli studenti valutati; con esattamente metà valutati
  non è rappresentativa; confronto criterio↔nucleo solo con almeno 6
  confrontabili e 2/3 concordi; distribuzione per banda senza nomi di persone.
- Il colore di ogni banda è assegnato dal server, mai scritto nel client.
- Grafici a settori: al massimo 6 settori; oltre, niente disco.

### Non toccato / rimosso di proposito
- Nessun radar, nessuna Dashboard, nessun percorso duplicato (V1 rimossa).

### Aperto
- Migration su Neon `[da confermare se eseguita]`. I test citano la
  migrazione 003, quindi esistono almeno tre migration.
- Playwright e axe-core sono installati, ma tra gli otto file di `npm test`
  non c'è nessun test da browser. Se esistono, vanno censiti e collegati.
- Nell'output c'è una riga `[errore]` (FK 23503 su `content_translations`,
  lingua `ar-XB`) dentro un test che passa. Probabilmente è un caso negativo
  atteso `[da confermare]`.
- Test lenti ma non bloccanti: login 9,4 s, catalogo di piattaforma 8,9 s,
  seed esteso 9,9 s, colori delle bande 4,6 s.
- Il README descrive ancora lo stato di 27 test, senza login né tenant.
- Contenuto di `doc/` non censito; specifica di riferimento assente dalla
  knowledge base.

### Prossimo passo
1. Aggiornare il README (o rimandare a questo registro) per l'architettura
   attuale.
2. Mettere la specifica con i riferimenti §/P/C/E in `doc/` e sincronizzarla.
3. Decidere se eseguire le migration su Neon prima di nuove funzioni.

---

## CHECKPOINT 002 — Valutazione dello schema del database (11/10/2026)

**Natura di questa voce:** completa la baseline 000/001 con una valutazione
dell'esportazione DDL dello schema `public` (30 tabelle). Valuta ciò che è
visibile nel DDL; non ho eseguito nulla sul database. Il database di origine
(locale o Neon) resta `[da confermare]`.

### Limiti dell'esportazione: non è una fonte affidabile da sola
- **Mancano** trigger, funzioni, grant, ruoli (`app_role`), RLS, dati di seed e
  una tabella che registri le migration applicate. I test citano invece
  `app_role` e un trigger di immutabilità del Teaching: vivono altrove.
- **Predicati `WHERE` degli indici parziali persi.** Tre indici compaiono come
  univoci senza condizione: `uq_observation_scale_default` (solo `tenant_id`),
  `uq_assessment_materia` e `uq_assessment_criterio`. Scritti così
  impedirebbero dati legittimi (più scale per livello, valutazioni per
  criterio accanto a quella di materia). Con ogni probabilità sono parziali.
- **Non rieseguibile così com'è:** `CREATE SCHEMA "public"` fallisce se esiste,
  e l'indice `uq_content_translation` ha le espressioni `COALESCE(...)` tra
  virgolette come se fossero nomi di colonna.
- **Vincolo circolare** `tenants` ↔ `tenant_languages`: inserire un tenant
  richiede vincoli `DEFERRABLE`, che l'export non mostra. Il test di creazione
  tenant passa, quindi lo sono oppure l'export ha perso l'attributo.
- Gli indici univoci duplicati (`*_key` e `CREATE UNIQUE INDEX`) sono un
  effetto dell'esportazione, non un difetto.

### Punti di forza
- **Isolamento a livello di database:** chiavi esterne composite che portano
  insieme tenant, anno, classe, materia o unità pedagogica. Un'osservazione
  non può riferirsi a un'iscrizione di un'altra classe, a un criterio di
  un'altra unità, a un'altra scala o a un altro tenant.
- Una sola osservazione per (attività, iscrizione, criterio); valore vincolato
  alla scala con FK (scala, valore).
- `teachings` richiede una Membership attiva nel tenant (FK) e ammette la
  co-docenza (stesso corso, più account).
- `role_assignments`: CHECK che rende coerenti tipo di scope e colonne di scope.
- `sessions` salva solo l'hash del token (`char(64)`, univoco), con revoca,
  motivo, ultimo accesso e scadenza.
- `content_translations`: CHECK che lega ogni campo traducibile al suo
  riferimento; `languages` con direzione ltr/rtl.
- Nessun `ON DELETE CASCADE`: coerente con i test RESTRICT.
- Dati personali minimi: delle persone solo nome e cognome.

### Rilievi, per priorità

**Alta**
1. **Email case-sensitive.** `accounts.email` è UNIQUE su `varchar` e non c'è un
   indice su `lower(email)`: `Mario@scuola.it` e `mario@scuola.it` possono
   essere due account, salvo normalizzazione nel codice.
2. **Audit e dati dei minori.** `audit_log.prima/dopo` (jsonb) copiano note e
   valori degli alunni; la tabella è append-only e non esiste una regola di
   conservazione o anonimizzazione. Anche `sessions.ip` e `user_agent` sono
   dati personali. Serve una decisione scritta su conservazione e
   cancellazione, prima di usare dati reali.
3. **`role_assignments` senza unicità e senza legame con la Membership.** Si
   può assegnare due volte lo stesso ruolo nello stesso scope, e assegnare un
   ruolo a un account che non ha Membership in quel tenant (solo `teachings`
   ha la FK verso `memberships`). Oggi l'isolamento regge per i controlli
   applicativi, non per il database.
4. **Verificare i tre indici parziali** (vedi query sotto): se non lo sono,
   bloccano dati validi.

**Media**
5. **Cambio di classe a metà anno.** `enrollments` è unico per
   (tenant, anno, studente) e le osservazioni puntano a (iscrizione, classe)
   senza `ON UPDATE CASCADE`: dal solo schema non vedo come spostare uno
   studente in un'altra classe se ha già osservazioni. Serve una regola
   pedagogica: cosa succede alle osservazioni della classe precedente?
6. **Nessun legame tra anni.** Unità pedagogiche e criteri sono per anno
   scolastico, senza riferimento all'anno precedente. Il progresso
   "da inizio anno" funziona; il progresso su più anni della primaria no, se
   serve.
7. **`judgment_bands` senza vincoli di coerenza:** nessuna unicità su
   (tenant, livello, soglia) e nessun obbligo di una banda a 0, quindi
   percentuali senza banda e soglie duplicate sono possibili.
8. **Scala compatibile con il livello:** il database accetta qualunque scala
   del tenant; la compatibilità è un controllo applicativo (c'è un test).
9. **Soglie e scale retroattive.** I report calcolano la banda con le soglie
   correnti; solo `assessments.giudizio` è congelato (testo libero, senza FK
   alle bande, confrontato per etichetta come da E4). Decidere se le soglie si
   congelano alla chiusura del periodo.
10. **Nessuna tabella delle migration applicate** in `public`: non c'è un
    modo, nel database, di sapere quali migration sono state eseguite.
11. **Blocco dei tentativi di login:** nessuna colonna (contatore, blocco fino
    a). Può stare in memoria, ma allora si perde al riavvio e non funziona con
    più istanze.

**Bassa**
12. `tenants.lingua_contenuti` e `activities.lingua_contenuto` non sono legate
    alle lingue abilitate del tenant (solo `lingua_predefinita` lo è).
13. Molti vincoli univoci compositi sovrapposti (servono da bersaglio delle FK
    composite): costo trascurabile a questa scala.
14. Alcune colonne FK senza indice (per esempio in `content_translations`):
    irrilevante con pochi dati.

### Cambiamenti di modello rispetto al README `[mappatura da confermare]`
- Convenzione: tabelle in inglese, colonne in italiano (`nome`, `stato`,
  `data_attivita`).
- Corrispondenza probabile: insegnamenti→`teachings`, attività→`activities`,
  nuclei tematici→`pedagogical_units`, criteri→`criteria`,
  iscrizioni→`enrollments`, persone→`people`; docente→`account`.
- **`observations` ora è una riga per criterio** (valore + criterio + nota);
  prima c'erano `osservazioni` (una per alunno e attività) e
  `valutazioni_criteri`. **La nota è quindi per criterio, non per attività
  dell'alunno.** Decisione da registrare come pedagogica.
- Nuove aree: `tenants`, `memberships`, `roles`/`permissions`/
  `role_assignments`, `sessions`, `accounts`, `audit_log`, scale e bande per
  tenant, `assessment_periods`/`assessments`, lingue e traduzioni.

### Decisioni da registrare (pedagogiche)
- Su quale data si ordinano "le ultime 3 osservazioni": `data_osservazione`
  o `data_attivita`.
- Regola per il cambio di classe a metà anno (punto 5).
- Se il progresso deve attraversare più anni (punto 6).
- Se soglie e scale si congelano alla chiusura del periodo (punto 9).
- Politica di conservazione dei dati degli alunni (punto 2).

### Query di verifica (solo lettura)
```sql
-- 1) Indici parziali: il predicato WHERE c'è?
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('uq_observation_scale_default','uq_assessment_materia','uq_assessment_criterio');

-- 2) Algoritmo di hashing, senza esporre gli hash
SELECT split_part(password_hash, '$', 2) AS algoritmo, count(*) FROM accounts GROUP BY 1;

-- 3) Email duplicate per maiuscole
SELECT lower(email), count(*) FROM accounts GROUP BY 1 HAVING count(*) > 1;

-- 4) Vincolo circolare tenant/lingue: è differibile?
SELECT conname, condeferrable, condeferred FROM pg_constraint
WHERE conname = 'fk_tenant_lingua_predefinita_abilitata';

-- 5) Ciò che l'export non mostra: trigger e RLS
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal;
SELECT relname, relrowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';
```

### Aperto
- Esito delle query sopra; database di origine dell'export.
- Migration su Neon `[da confermare]`.
- Le cinque decisioni pedagogiche elencate.

### Prossimo passo
1. Eseguire le query 1–5 e riportare gli esiti in un CHECKPOINT 003.
2. Chiudere con il docente le decisioni su cambio di classe e conservazione dei
   dati: sono quelle che toccano dati reali di minori.

---

## CHECKPOINT 003 — Ramo `visual-grammar-v2` (11/10/2026)

**Ramo e commit:** `visual-grammar-v2` (anche su `origin`), HEAD `459613a`,
11 commit davanti a `main`. Il ramo non è stato unito a `main`.
Esito di `npm test`: 132/132, ma non è indicato a quale commit è stato
eseguito `[da confermare: HEAD 459613a]`.

**Natura di questa voce:** ancora la fotografia dello stato, ora ancorata ai
commit. Ricostruisce la storia del ramo dai messaggi di commit.

### Storia del ramo (dal più vecchio al più recente)
| Commit | Fase | Contenuto |
|---|---|---|
| `4e3da94` | V2 passo 3 | Regola B nel motore numerico |
| `c5cb664` | V2 passi 5–6 | Lingua C2, catalogo di sistema, contenuti multilingue, errori come codici |
| `d616d46` | V2 passi 4 e 7–14 | Payload semantico, viste V2, client senza testi né calcoli, rimozione del radar |
| `34256bb` | V2 conformità | Controlli statici e verifica nel browser (RTL, bianco/nero, testi mancanti, accessibilità) |
| `f99d4f2` | V2 documentazione | README con grammatica visuale, migrazione 003, API, test |
| `a52f562` | V2 RTL | Date isolate con `bdi` nel testo misto |
| `46a0a76` | Seed | Seed esteso per provare le viste V2 con dati ampi |
| `55b3330` | V2.1 rev. 2, fase B | Payload E1–E4 (campi derivati, motore invariato) |
| `5e44d0a` | V2.1 rev. 2, fasi C–G | Disco, viste, navigazione a pila, accessibilità, test E2E |
| `71f9031` | V2.1 rev. 2, documentazione | README con disco, colori, E1–E4, navigazione, test |
| `459613a` | V2.1 conformità (vincolo 7) | Giudizio → banda solo come compatibilità con l'etichetta configurata |

I passi 1–2 e la fase A non compaiono in questi 11 commit `[da confermare dove
stanno: in `main` o in un ramo precedente]`.

### Cosa chiarisce rispetto alle voci precedenti
- **Perché il README e la knowledge base sembravano vecchi.** La knowledge base
  del progetto si sincronizza con `main`. I commit del ramo non toccano
  login, tenant, ruoli o audit, quindi questi sono già in `main`: la
  sincronizzazione è un'istantanea più vecchia di `main` `[inferenza]`.
  I README aggiornati stanno sul ramo (`f99d4f2`, `71f9031`).
- **Test da browser: esistono.** `34256bb` e `5e44d0a` citano verifica nel
  browser, accessibilità e test E2E. Non fanno parte di `npm test`: come si
  lanciano va registrato `[da confermare il comando]`.
- **Migrazione 003** nasce in questo ramo (documentata in `f99d4f2`). Le tabelle
  `languages`, `catalog_overrides`, `content_translations` e `tenant_languages`
  dell'esportazione del CHECKPOINT 002 sembrano appartenere a 003: quel
  database ha quindi già le migration del ramo `[probabile]`. Su un database
  fermo a `main` non ci sono.
- Il numero dei passi e delle fasi (V2 passi 1–14, V2.1 fasi A–G, vincolo 7)
  indica che esiste una specifica con un piano numerato. Le voci di questo
  registro possono usare quegli stessi numeri come titoli.

### Aperto
- Unione del ramo in `main` (e quindi in knowledge base): non fatta.
- Comando dei test E2E e loro esito a HEAD.
- Dove stanno i passi 1–2 e la fase A.
- Esiti delle query del CHECKPOINT 002 e decisioni pedagogiche elencate lì.

### Prossimo passo
1. Eseguire `npm test` e i test E2E a `459613a` e annotare il risultato.
2. Decidere se unire il ramo in `main` o proseguire sul ramo; in entrambi i
   casi, far puntare la sincronizzazione della knowledge base al ramo giusto.
3. Mettere in `doc/` la specifica con i passi e le fasi.

---

## Modello per le nuove voci (copiare e aggiungere sopra questa sezione)

## CHECKPOINT NNN — Titolo breve (gg/mm/aaaa)

**Ramo e commit:** (ramo, hash di HEAD, commit davanti a `main`, esito di
`npm test` e dei test E2E a quel commit)

**Obiettivo dell'iterazione:**

**Decisioni pedagogiche** (cosa, chi ha validato):
-

**Scelte tecniche:**
-

**Fatto** (file toccati):
-

**Verificato** (test eseguiti, esito, dove: PGlite / Postgres locale / Neon):
-

**Non toccato di proposito:**
-

**Aperto / bloccato:**
-

**Prossimo passo e criteri di accettazione:**
-
