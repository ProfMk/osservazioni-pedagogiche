# Osservazioni pedagogiche strutturate — prototipo (Matematica)

Implementazione del modulo descritto nell'analisi del database Access
(`Analisi_Access_Osservazioni_Pedagogiche.md`) e nello script di verifica
(`verifica_schema_e_dati.sql`), per la sola materia Matematica.

## Due limiti reali di questo ambiente (da leggere prima del resto)

1. **Nessun accesso di rete al database Neon reale.** Questo ambiente di
   sviluppo non riesce a raggiungere l'host Postgres di Neon (connessione
   scaduta su tutte le porte tentate). Di conseguenza:
   - la migration (`migrations/001_vincoli_osservazioni.sql`) **non è stata
     eseguita su Neon**: è pronta, verificata, ma va eseguita da chi ha
     accesso al database reale, dopo aver letto la sezione "Prima di
     eseguire la migration su Neon" più sotto;
   - tutti i test qui descritti sono stati eseguiti su un **PostgreSQL
     locale**, con uno schema identico a quello di Access/Neon (stesse
     tabelle, colonne, tipi) e con dati equivalenti a quelli descritti
     nell'analisi — non sui dati reali della scuola.
2. **Non esiste un sistema di login.** Le 13 tabelle analizzate non
   contengono credenziali, password o sessioni. `server/auth.js`
   implementa un meccanismo di sviluppo (header `X-Docente-Id`)
   esplicitamente NON sicuro, da sostituire prima di qualunque uso reale.
   Tutto il resto del sistema (autorizzazione, calcoli) non dipende da
   come l'identità viene stabilita: sostituire `auth.js` con un login vero
   basta a rendere sicuro il resto.

## Struttura del progetto

```
migrations/001_vincoli_osservazioni.sql   Migration sicura (vedi sotto)
server/
  config/valutazione.js   Scala, soglie del giudizio, calcolo: PUNTO UNICO
  lib/erroreApplicativo.js
  lib/autorizzazione.js   Verifica lato server della catena di appartenenza
  db.js                   Connessione (da DATABASE_URL, mai hardcoded)
  queries.js              Query applicative (griglia, salvataggio, storico...)
  auth.js                 Identificazione del docente — NON un login reale
  routes/attivita.js       Endpoint HTTP
  index.js                Avvio del server Express
public/index.html          Interfaccia: griglia di classe + scheda alunno
tests/
  calcoli.test.js          Test unitari (nessun database) — Casi A-F
  integration.test.js      Test contro un Postgres locale — Casi F-I, K3
```

## 1. Cosa è stato centralizzato (richiesta esplicita del prompt)

Tutto ciò che riguarda la scala di valutazione, il valore massimo (2), le
etichette (Non manifestato/Con supporto/Autonomo) e le soglie del giudizio
vive **solo** in `server/config/valutazione.js`. Nessun altro file contiene
i numeri 0/1/2 come "punteggio massimo", né le stringhe OTTIMO/DISTINTO/...,
né le soglie 90/80/70/60/50. Quando la scala o le soglie diventeranno
configurabili per scuola/materia/nucleo (sezione 10 dell'analisi), si
sostituisce l'implementazione di questo file con una lettura da tabella:
il resto del codice non cambia, perché usa solo le funzioni esportate
(`calcolaEsito`, `calcolaGiudizio`, `isPunteggioValido`, `valoreMassimo`).

**Le soglie usate sono quelle corrette che hai indicato per ultime**
(90-100 OTTIMO, 80-89 DISTINTO, 70-79 BUONO, 60-69 DISCRETO, 50-59
SUFFICIENTE, 0-49 NON SUFFICIENTE), non quelle del documento originale
(90-100/75-89/60-74/45-59/30-44/0-29). Questo cambia l'esito atteso del
**Caso A** del prompt originale: 66,67% con le soglie originali dava
BUONO, con le soglie corrette dà **DISCRETO**. Il calcolo (8/12, 66,67%)
è identico; cambia solo l'etichetta, come richiesto.

## 2. Modello pedagogico implementato

- Una sola osservazione per `(attivita_id, iscrizione_id)`: vincolo
  `UNIQUE` (migration), più verifica applicativa.
- Una sola valutazione per `(osservazione_id, criterio_id)`: vincolo
  `UNIQUE` già presente, upsert applicativo (`ON CONFLICT ... DO UPDATE`).
- **"Non valutato" non è mai 0**: è l'assenza della riga in
  `valutazioni_criteri`. Selezionare "Non valutato" esegue un `DELETE`
  della riga, se esiste; non scrive mai 0, `NULL` o altri valori sentinella.
- I criteri si leggono sempre da `criteri_osservazione` filtrando per
  `nucleo_tematico_id` dell'attività: nessun nome di nucleo o criterio è
  scritto nel codice (frontend incluso). Se un nucleo non ha criteri, la
  griglia segnala esplicitamente "non configurata" (nessun criterio è
  mai inventato).
- Percentuali e giudizio (attività, criterio, nucleo) si basano sempre
  sul numero di **valutazioni realmente presenti**, mai su un numero
  teorico di criteri o attività. Lo 0 entra nel denominatore; "non
  valutato" no. Il giudizio usa la percentuale esatta, non arrotondata.

## 3. Sicurezza lato server

`server/lib/autorizzazione.js` verifica, per ogni operazione, l'intera
catena richiesta:

- `verificaAttivitaDelDocente`: attività → insegnamento → **docente**
  (deve coincidere con l'identità autenticata) → materia → nucleo (la
  materia del nucleo deve coincidere con quella dell'insegnamento);
- `verificaIscrizioneCoerente`: l'iscrizione deve avere la stessa classe
  e lo stesso anno scolastico dell'insegnamento dell'attività (mai
  presa per buona dal client);
- `verificaCriterioDelNucleo`: il criterio deve appartenere al nucleo
  dell'attività.

Ogni endpoint chiama queste verifiche **prima** di leggere o scrivere
qualunque dato; nessuna informazione (classe, anno, materia, docente)
viene mai presa da un parametro del client. Un tentativo di accedere a
un'attività di un altro docente, o di valutare con un criterio di un
altro nucleo, restituisce **404** (non 403), per non rivelare l'esistenza
della risorsa (coerente con l'analisi, R10).

## 4. Cosa NON è stato implementato ora (per scelta, coerente con le istruzioni)

- Nessuna interfaccia per configurare scala, formule, soglie o criteri.
- Nessuna colonna `scuola_id`, nessuna modifica alla multi-tenancy.
- Nessun vero login (vedi sopra).
- Nessuna migrazione dei dati storici: la migration aggiunge solo
  vincoli, non tocca righe esistenti.

## 5. Migration: cosa fa e come va usata

`migrations/001_vincoli_osservazioni.sql` aggiunge, **solo se sicuro**:

1. `UNIQUE(attivita_id, iscrizione_id)` su `osservazioni`;
2. `CHECK(punteggio IN (0,1,2))` su `valutazioni_criteri`;
3. la FK `valutazioni_criteri.criterio_id → criteri_osservazione.id`;
4. la FK `osservazioni.docente_id → persone.id`.

Ogni blocco **verifica prima** (duplicati, valori fuori scala, righe
orfane) e si ferma con un errore esplicito, senza modificare nulla, se
non è sicuro procedere. È idempotente: rieseguirla quando i vincoli
esistono già non fa nulla (nessun errore).

**Non l'ho applicata su Neon** (nessun accesso di rete). Prima di
eseguirla sul database reale:

1. eseguire `verifica_schema_e_dati.sql` (sezione 14) su Neon;
2. se segnala duplicati in `osservazioni` o valori fuori scala in
   `valutazioni_criteri`, risolverli esplicitamente (la migration non
   decide da sola quale riga tenere in caso di duplicati: si ferma e
   basta);
3. eseguire questo file su Neon (es. `psql "$DATABASE_URL" -f migrations/001_vincoli_osservazioni.sql`).

### Cosa ho verificato di questa migration (in locale, non su Neon)

- **Si ferma senza applicare nulla** su un database con un duplicato in
  `osservazioni` (testato: l'errore compare, e dopo il tentativo nessun
  vincolo risulta aggiunto).
- **Si applica con successo** su un database senza anomalie.
- **È idempotente**: rieseguita subito dopo, non fallisce e non duplica
  i vincoli.

## 6. Test — eseguiti davvero, non solo scritti

```bash
npm install
# Tutti i test, senza installare PostgreSQL (database di prova PGlite in memoria):
npm test
# Solo unitari / solo integrazione:
npm run test:unit
npm run test:integration
# Integrazione su un PostgreSQL reale già preparato (necessario per il Caso I, concorrenza):
PGTEST_URL="postgres://utente@localhost:5432/nome_db_di_prova" npm test
```

Preparazione del database reale, contenuto dei dati di prova e limiti di
PGlite: `tests/README_DATI_DI_PROVA.md`.

**Risultato dell'ultima esecuzione: 18/18 test passati** (8 unitari + 10
di integrazione), ripetuta due volte di seguito per escludere fragilità
nel test di concorrenza.

| Caso del prompt | Dove è testato | Esito verificato |
|---|---|---|
| A (8/12, 66,67%) | unitario | Punteggio corretto; giudizio **DISCRETO** con le soglie corrette (non BUONO: vedi sezione 1) |
| B (griglia parziale, 4/4) | unitario | Non usa il numero teorico di criteri (12) |
| C (0 isolato, 0/2) | unitario | Lo 0 entra nel denominatore |
| D (nessuna valutazione) | unitario + integrazione | Percentuale nulla, giudizio vuoto |
| E (sviluppo cumulativo, 25%) | unitario + integrazione (dati reali via query SQL) | Somma tra attività diverse dello stesso nucleo |
| F (punteggio 3 rifiutato) | integrazione | Rifiutato dal livello applicativo **e** dal `CHECK` del database (doppia difesa) |
| G (criterio di un altro nucleo) | integrazione + HTTP manuale | Rifiutato (404) prima di qualunque scrittura |
| H (attività di un altro insegnamento) | integrazione | Rifiutato (404) sia in lettura sia in scrittura |
| I (duplicato concorrente) | integrazione (due connessioni reali, transazioni sovrapposte) | Il vincolo `UNIQUE` blocca la seconda scrittura con `23505` |
| K3 (alunno di un'altra classe) | integrazione | Rifiutato (404): non nel piano originale, ma nell'analisi (sezione 7) |

Ho inoltre avviato il server reale (Express, non un mock) contro il
database Postgres locale migrato e verificato con richieste HTTP vere:
pagina servita, `401` senza identità, elenco insegnamenti/attività,
lettura e scrittura della griglia, scheda alunno, storico del criterio,
riepilogo del nucleo, rifiuto per criterio di un nucleo estraneo. I dati
di prova sono stati ripristinati allo stato iniziale al termine.

## 7. Cosa resta aperto

- **Eseguire la migration su Neon** (sezione 5), dopo le verifiche.
- **Sostituire `server/auth.js`** con un'autenticazione reale.
- Le decisioni ancora aperte elencate nell'analisi (sezioni 9.1 e 10.6):
  in particolare D7 (unicità dei criteri per nome), D11 (aggregazione del
  nucleo per anno), D10 (docente diverso dal proprietario dell'attività).
  Il codice qui implementato assume, dove necessario scegliere: nucleo
  aggregato per anno scolastico (come Access), nessuna unicità aggiuntiva
  per nome dei criteri, e il docente dell'osservazione deve sempre
  coincidere con il proprietario dell'insegnamento.
- Non è stata implementata una vista "storico dell'intera carriera
  dell'alunno" su più anni scolastici (la Q7 dell'analisi): l'interfaccia
  attuale mostra lo storico nell'anno scolastico dell'attività aperta.
- Nessuna gestione di più docenti in compresenza sulla stessa attività
  (D10): oggi un solo docente per insegnamento può scrivere osservazioni.

---

## 8. Correzione funzionale (seconda iterazione)

### 8.1 Causa dell'errore "Impossibile salvare: Errore interno"

**Confermata riproducendo l'errore, non per ipotesi.** Il salvataggio usa
`INSERT ... ON CONFLICT (attivita_id, iscrizione_id)`, che richiede il
vincolo `UNIQUE` introdotto da `migrations/001_vincoli_osservazioni.sql`.
Su un database in cui quella migration non è stata applicata, **ogni**
tentativo di creare o modificare una valutazione fallisce con l'errore
Postgres `42P10` ("no unique or exclusion constraint matching the ON
CONFLICT specification"), che il gestore generico trasformava in un
anonimo "Errore interno".

La causa profonda non era un bug di logica: **non avevo mai consegnato lo
schema di base del database** (`migrations/000_schema_base.sql`, aggiunto
ora). Chi doveva creare un database di prova locale non aveva un punto di
partenza affidabile per farlo, quindi con ogni probabilità la migration
non risultava applicata.

Riprodotto: creato un database con solo lo schema originale (senza
migration) → stesso identico errore, stesso codice `42P10`. Applicata la
migration sullo stesso database, stessa richiesta → funziona.

### 8.2 File modificati (e perché)

| File | Cosa è cambiato |
|---|---|
| `migrations/000_schema_base.sql` | **Nuovo.** Lo schema di base (le 13 tabelle originali), mai consegnato prima: è la causa della migration mancante. Non tocca il modello concordato, lo rende solo riproducibile in locale. |
| `seed/dati_esempio_matematica.sql` | **Nuovo.** Dati minimi di prova, per evitare che ognuno inventi i propri dati (altra fonte di possibili mismatch). |
| `server/db.js` | Aggiunta `verificaVincoliRichiesti()`: controlla che i vincoli della migration 001 esistano. |
| `server/index.js` | Il server ora chiama `verificaVincoliRichiesti()` **prima** di accettare richieste: se la migration manca, si ferma con un messaggio chiaro invece di fallire a ogni salvataggio. |
| `server/routes/attivita.js` | Diagnostica in console per errori inattesi: endpoint, metodo, parametri, corpo, codice e messaggio PostgreSQL (mai credenziali). Traduzione dei codici PostgreSQL noti (`23514`, `23505`, `42P10`) in risposte più chiare. Aggiunte le route per l'elenco dei nuclei e la creazione di una nuova attività. |
| `server/queries.js` | Aggiunte `getNucleiDellaMateria` e `creaAttivita` (punto 1 della richiesta). Import mancante di `nonTrovato` corretto (bug trovato dai test, vedi 8.4). |
| `public/index.html` | Le intestazioni della griglia mostrano il **nome completo** del criterio (non più il numero); la tabella scorre orizzontalmente in un contenitore dedicato senza spostare il resto della pagina; nella pagina dell'insegnamento è stato aggiunto il modulo per creare una nuova attività (titolo, data, nucleo scelto tra quelli già configurati per la materia). |
| `tests/integration.test.js` | Aggiunti i test A-J richiesti (mappatura in 8.5) e due test di regressione sui due bug reali trovati (8.1 e 8.4). |

**Cosa NON ho toccato**, come richiesto: nessuna modifica al modello dati
concordato (nessuna nuova colonna, nessun vincolo diverso da quelli già
decisi), nessuna modifica alla logica di calcolo o alle soglie del
giudizio, nessuna modifica alla scheda individuale (già completa dei
campi richiesti al punto 5).

### 8.3 Le altre richieste (2-5)

- **Punto 1 (creare una nuova attività):** implementato. Il nucleo si
  sceglie da un elenco caricato dal server (`GET
  /api/insegnamenti/:id/nuclei`), mai scritto nel frontend; il server
  verifica comunque, alla creazione, che il nucleo scelto appartenga alla
  materia dell'insegnamento (server-side, non solo nell'interfaccia). I
  criteri non si toccano in questa schermata: derivano dal nucleo quando
  l'attività viene aperta, come già avveniva.
- **Punto 3 (nomi dei criteri, non numeri):** corretto in
  `public/index.html`. Confermato via test (Caso J) che il server
  restituisce già il nome di ciascun criterio; il difetto era solo nel
  frontend, che mostrava `c.ordine` invece di `c.nome`.
- **Punto 4 (non modificare le regole):** confermato invariato
  `server/config/valutazione.js` (unico punto con scala, formula, soglie:
  90/80/70/60/50, invariate dall'iterazione precedente).
- **Punto 5 (scheda del singolo alunno):** già completa dei campi
  richiesti (alunno, classe, anno, attività, data, nucleo, criteri, nota,
  riepilogo, storico); nessuna modifica necessaria.

### 8.4 Un secondo bug reale, trovato dai test appena scritti

Scrivendo il test "creazione su un insegnamento non proprio è rifiutata",
è emerso un `ReferenceError: nonTrovato is not defined` in
`server/queries.js`: la funzione `creaAttivita()` usava `nonTrovato(...)`
senza che fosse importata (era stata importata solo `datiNonValidi`).
Senza questo test il bug sarebbe rimasto latente fino al primo tentativo
reale di creare un'attività su un insegnamento non proprio. Corretto
l'import; il test ora passa.

Un terzo problema, minore, è emerso testando la diagnostica del punto 2:
in Express 5, `req.params` e in parte `req.body` **non sono affidabili**
dentro un middleware di gestione errori a livello di router — risultano
vuoti anche quando la rotta li aveva popolati (verificato con un caso
isolato, riproducibile a prescindere da questo progetto). Corretto
catturando parametri e corpo nel punto in cui l'errore viene intercettato
(non nel gestore finale) e allegandoli all'errore stesso.

### 8.5 Test eseguiti (per davvero) e risultati

```
npm run test:unit           # 8 test, nessun database
PGTEST_URL=... npm run test:integration   # 19 test, Postgres locale
```

**Risultato: 27/27 test passati**, ripetuto due volte di seguito. Nessun
test è stato dichiarato superato senza eseguirlo.

| Caso richiesto | Test | Esito |
|---|---|---|
| A. creazione/modifica/eliminazione di una valutazione | `Round-trip: salva un punteggio, lo aggiorna, poi lo elimina` | ✅ |
| B. 0 accettato | `Casi B/C/D: 0, 1 e 2 sono tutti accettati...` | ✅ |
| C. 1 accettato | idem | ✅ |
| D. 2 accettato | idem | ✅ |
| E. 3 rifiutato | `Caso F: punteggio 3 è rifiutato...` + verifica diretta del CHECK del database | ✅ |
| F. "Non valutato" elimina la riga | incluso nel test A (Round-trip) | ✅ |
| G. criterio del nucleo corretto accettato | `Caso G (esplicito): un criterio del nucleo corretto viene accettato` | ✅ |
| H. criterio di un altro nucleo rifiutato | `Caso G: un criterio di un altro nucleo viene rifiutato` (nome storico, stesso caso) | ✅ |
| I. docente non autorizzato rifiutato | `Caso H: un docente non può leggere/scrivere...` | ✅ |
| J. intestazioni con i nomi dei criteri | `Caso J: la griglia restituisce il NOME di ciascun criterio...` | ✅ |
| — | Regressione: server non si avvia senza la migration (causa reale del punto 2) | ✅ |
| — | Regressione: diagnostica con parametri ed errore Postgres corretti | ✅ |
| — | Nuova attività: nuclei solo della materia giusta; creazione valida; nucleo di materia sbagliata rifiutato (400); insegnamento non proprio rifiutato (404) | ✅ (4 test) |

Ho inoltre ripetuto manualmente, via richieste HTTP reali contro un
server avviato per l'occasione, l'intero percorso: creazione di una
nuova attività sul nucleo "Spazio e figure", verifica che la griglia
mostri i nomi completi dei 6 criteri di quel nucleo, salvataggio di una
valutazione, e verifica della diagnostica su un errore reale (mostra
endpoint, parametri, codice e messaggio PostgreSQL, nessuna credenziale).

### 8.6 Problemi ancora non verificabili

- **Non ho potuto verificare se questo è esattamente lo scenario che hai
  incontrato tu**: ho riprodotto il codice di errore `42P10` a partire
  dall'ipotesi più probabile (migration non applicata sul tuo database di
  prova), coerente al 100% con il sintomo descritto (fallisce su
  qualunque inserimento o modifica). Se il tuo database aveva già la
  migration applicata e l'errore persiste comunque, la causa è diversa da
  quella qui corretta: in tal caso servirebbe il log esatto del server al
  momento dell'errore (ora molto più leggibile, vedi 8.1) per continuare.
- Resta valido tutto quanto già segnalato nella sezione 7 (nessun accesso
  a Neon da questo ambiente; nessun login reale).
