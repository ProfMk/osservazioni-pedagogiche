# Visual Grammar V2 — Specifica normativa e guida di implementazione

**Stato:** approvata per l'implementazione  
**Versione:** Visual Grammar V2 consolidata  
**Scopo:** documento normativo di progetto, da versionare nel repository e usare come contesto per agenti AI e sviluppatori.

---

## 0. Scopo e principio di prevalenza

Questo documento definisce la **Visual Grammar V2** del sistema di osservazioni pedagogiche.

La specifica stabilisce:

- semantica dei dati visualizzati;
- grammatica visiva;
- certezza dell'evidenza;
- criticità;
- confronti;
- andamento;
- precisione numerica;
- navigazione;
- viste;
- localizzazione;
- contenuto pedagogico multilingue;
- RTL;
- requisiti architetturali;
- criteri di conformità;
- ordine raccomandato di implementazione.

La specifica è normativa.

Quando codice, mockup, testi hardcoded o implementazioni precedenti sono in conflitto con questa specifica, **la specifica prevale**, salvo successiva modifica formale della specifica stessa.

Una modifica alla grammatica richiede l'aggiornamento di questo documento nello stesso intervento.

---

# 1. Obiettivo della V2

La V2 introduce una grammatica visiva unica per tutte le viste del Teaching.

L'unità fondamentale è la **riga di livello**.

Il principio è:

> Cambiando vista cambia l'oggetto descritto, non il linguaggio con cui viene descritto.

Cambiare lingua cambia le parole, non:

- significato;
- segni;
- colori;
- posizione semantica;
- regole;
- soglie;
- certezza;
- struttura della navigazione.

La grammatica deve consentire a un docente di leggere rapidamente:

1. dove si trova il livello;
2. quanto è solida l'evidenza;
3. se esiste una criticità;
4. se esiste un confronto valido;
5. se esiste un andamento determinabile;
6. quale sia la base numerica.

---

# 2. Principi fondamentali

## P-1 — Prima il significato, poi la forma

Nessun elemento visuale viene introdotto senza una funzione semantica.

## P-2 — Quattro strati distinti

Il sistema distingue sempre:

1. osservazione;
2. aggregazione;
3. sintesi derivata dalle osservazioni;
4. valutazione del docente.

## P-3 — Certezza accanto al valore

Nessun valore derivato viene presentato senza rendere visibile la certezza dell'evidenza.

## P-4 — Assenza ≠ zero

Dato non osservato, dato insufficiente e valore zero sono concetti diversi.

## P-5 — Un canale, un significato

Un canale visuale non può essere riutilizzato per comunicare una semantica diversa.

## P-6 — Nessuna classificazione senza regola

Confronti e andamenti compaiono solo quando esiste una regola approvata che li rende determinabili.

## P-7 — Densità professionale

La UI deve essere informativa e professionale, senza decorazioni.

## P-8 — Una grammatica a ogni livello

La stessa semantica deve essere rappresentata nello stesso modo in tutte le viste.

## P-9 — Quattro livelli architetturali

Semantica, configurazione pedagogica, localizzazione e presentazione sono separati.

## P-10 — Coerenza numerica

Il numero mostrato non può contraddire la banda assegnata.

---

# 3. Quattro livelli architetturali

| Livello | Contenuto | Proprietario | Lingua |
|---|---|---|---|
| Semantica del sistema | identificatori, concetti, regole | prodotto | indipendente |
| Configurazione pedagogica | bande, soglie, scale, descrittori, materie, nuclei, criteri, livelli, periodi | istituto | contenuto dell'istituto |
| Localizzazione | testo degli identificatori di sistema | prodotto + tenant | per lingua |
| Presentazione visuale | canali, segni, composizione | specifica | indipendente; RTL speculare |

### AR-1

Il codice conosce identificatori e regole, mai testi o valori pedagogici hardcoded.

### AR-2

Un livello non invade un altro.

---

# 4. Quattro strati del dato

| Strato | Identificatore | Segno | Unità | Asse | Firma |
|---|---|---|---|---|---|
| Osservazione | `OBSERVATION` | ● / ○ se esclusa | valore + descrittore scala | no | autore, data, attività |
| Aggregazione | `AGGREGATE` | ▬ + `n/N` | percentuale | sì | base |
| Sintesi | `OBSERVATION_DERIVED_LEVEL` | etichetta con contorno + eventuali segnali | banda | sì | sistema |
| Valutazione | `TEACHER_ASSESSMENT` | ■ | giudizio docente | mai | docente, data, periodo |

Regole:

- l'osservazione non mostra percentuali né bande;
- l'aggregazione mostra sempre la base;
- la sintesi usa il contorno e non il timbro;
- la valutazione sta fuori dall'asse;
- la valutazione non è mai precompilata;
- il timbro è visivamente più forte della sintesi.

---

# 5. Vocabolario visuale chiuso

## 5.1 Canali

| Canale | Significato |
|---|---|
| distanza dall'inizio della riga lungo l'asse | livello quantitativo |
| tipo di segno | strato del dato |
| riempimento e tratto | certezza |
| tinta di attenzione | banda critica |
| glifi relazionali | relazione con riferimento |
| segmenti di barra | numerosità |
| asse temporale | ordine cronologico |
| dimensione | livello gerarchico |

Tutto deve restare leggibile senza colore.

## 5.2 Segni

- `●` osservazione;
- `○` esclusa;
- `▬` aggregato;
- `▏` riferimento;
- `◇` storico;
- etichetta con contorno = sintesi;
- `■` valutazione docente;
- barra impilata = distribuzione;
- `⟦ ⟧` = finestra;
- frecce di andamento = forme, non caratteri testuali hardcoded.

## 5.3 Indicatori

- `CRITICAL_BAND` → ⚠ pieno;
- `CRITICAL_TO_VERIFY` → ⚠ a contorno;
- `COMPARISON_*` → ▲ / ▼ / =;
- `TREND_*` → freccia o segno neutro previsto;
- `BASE_COUNT` → `n/N`.

---

# 6. Presenza dei segnali

Sempre presenti:

- nome;
- asse con tacche;
- valore o traccia vuota;
- certezza;
- base.

Solo quando semanticamente necessari:

- criticità;
- confronto;
- storico;
- distribuzione;
- andamento;
- avviso;
- esclusioni.

Non aggiungere segnali solo per aumentare la ricchezza visiva.

---

# 7. Anatomia della riga

Ordine logico:

1. nome;
2. asse;
3. banda;
4. criticità;
5. confronto;
6. andamento;
7. certezza;
8. `n/N`.

Regole:

- asse invariabile tra viste;
- la riga selezionata diventa il contesto/intestazione della vista successiva;
- stesso concetto → stesso segno;
- un solo percorso di navigazione;
- un solo gesto di apertura;
- l'andamento viene disegnato solo quando la regola è implementata;
- la geometria deve essere descritta da inizio e fine, non da coordinate sinistra/destra.

---

# 8. Gerarchia percettiva

### 2–3 secondi

Devono emergere:

- avvisi;
- zone critiche;
- profilo delle posizioni;
- righe vuote o tratteggiate.

### 10–20 secondi

Devono emergere:

- bande;
- confronti;
- storico;
- basi;
- distribuzioni.

### Dettaglio

Devono essere disponibili:

- sequenze;
- conteggi dei confrontabili;
- esclusioni;
- note;
- precisione del dettaglio.

`ATTENTION_BLOCK` contiene solo righe con criticità confermata e certezza sufficiente, collegate alle righe pertinenti.

---

# 9. Certezza

| Grado | Studente | Classe | Nucleo H3 |
|---|---|---|---|
| `CERTAINTY_SUFFICIENT` | ≥3 osservazioni | > metà studenti | tutti i criteri valutati, ciascuno ≥3 osservazioni valide |
| `CERTAINTY_PARTIAL` | 1–2 | metà o meno | altrimenti |
| `CERTAINTY_ABSENT` | 0 | 0 | nessun criterio valutato |

Regole:

- a parità di banda, un dato parziale è sempre visivamente più debole;
- accanto al segno compare il termine specifico;
- un segno derivato eredita la certezza minima dei termini che lo producono;
- la certezza è sempre visibile;
- la certezza non viene codificata mediante colore.

---

# 10. Criticità

La criticità è una **zona dell'asse**, non un attributo personale.

Si applica agli oggetti di apprendimento, mai accanto al nome di una persona.

## `CRITICAL_BAND`

- ⚠ pieno;
- zona critica dell'asse;
- entra nel blocco di attenzione solo con certezza sufficiente.

## `CRITICAL_TO_VERIFY`

- ⚠ a contorno;
- evidenza parziale;
- fuori dal blocco di attenzione.

## `GENERALIZED_DIFFICULTY`

Avviso testuale generalizzato.

## `GENERALIZED_DIFFICULTY_DETAIL`

Dettaglio dell'avviso.

La spiegazione testuale della difficoltà generalizzata compare una sola volta.

Criticità e confronto sono indipendenti.

Con una sola banda configurata non esiste banda critica.

I testi predefiniti non devono usare aggettivi riferiti alla persona e devono essere orientati all'azione.

---

# 11. Confronti

Il riferimento è sempre:

`REFERENCE_MARK = ▏`

Il risultato è un glifo nella colonna confronto.

Confronti con glifo ammessi:

- criterio di classe ↔ nucleo;
- nucleo ↔ complessivo.

Il confronto criterio di classe ↔ nucleo richiede la regola approvata: almeno 2/3 nella stessa direzione e almeno 6 confrontabili.

Alunno ↔ classe e gruppo ↔ classe ai livelli L1–L2:

- solo tacca;
- nessun glifo comparativo.

La classe usa la distribuzione interna senza rendere riconoscibile la persona.

Le differenze sono differenze tra valori mostrati alla stessa precisione.

---

# 12. Tempo e andamento

## Rappresentazione

- `CURRENT_LEVEL` = posizione del valore attuale;
- evoluzione = sequenza di ● sulla griglia della scala;
- `OBSERVATION_WINDOW` = `⟦ ⟧`;
- `CURRENT_VS_HISTORICAL_GAP` = `◇`;
- numero dello scarto solo nel dettaglio;
- `TREND_UP`, `TREND_STABLE`, `TREND_DOWN` = freccia neutra;
- `TREND_UNDETERMINED`, `TREND_UNCONFIRMED` = trattino con certezza ereditata.

## Regola

Studente/criterio:

- banda finestra attuale vs banda delle 3 osservazioni precedenti;
- almeno 6 osservazioni valide.

Classe/criterio:

- la banda cambia;
- almeno 2/3 degli studenti con andamento determinabile nella stessa direzione;
- almeno 6 studenti.

Nucleo e complessivo: nessun andamento.

Non dedurre mai l'andamento dallo scarto storico.

Il motore restituisce codici, non testi.

---

# 13. Dati mancanti, insufficienti ed esclusi

## `NOT_CONFIGURED`

Riga attenuata e fuori dai confronti.

## `NOT_OBSERVED`

Traccia vuota.

Nessun numero.

## `INSUFFICIENT_DATA`

- valore tratteggiato;
- banda tenue;
- nessun confronto;
- esclusione dalle aggregazioni secondo le regole del dominio.

## `EXCLUDED`

`○` con motivo disponibile nel dettaglio.

Motivi:

- `EXCLUSION_ENROLLMENT_INACTIVE`;
- `EXCLUSION_UNIT_INACTIVE`;
- `EXCLUSION_CRITERION_INACTIVE`;
- `EXCLUSION_ACTIVITY_INACTIVE`;
- `EXCLUSION_SCALE_INCOMPATIBLE`.

---

# 14. Precisione numerica — Regola B

Il motore calcola un solo intero:

`kc = floor((x + ε) * 100)`

dove ε è la tolleranza già adottata dal motore corrente.

Le soglie vengono convertite in centesimi direttamente dal valore decimale configurato, senza floating point intermedio.

Da `kc` derivano esclusivamente:

- banda;
- valore del dettaglio;
- valore della sintesi;
- geometria.

`p_dettaglio = 2`.

`p_sintesi` = massimo numero di decimali significativi delle soglie applicabili.

Esempi:

- soglie intere → 0;
- soglie con un decimale → 1;
- soglie con due decimali → 2.

Il client non esegue calcoli.

Il server fornisce valori già determinati alla loro precisione semantica.

Il client li formatta secondo lingua e regione.

Le differenze sono calcolate sui valori mostrati alla stessa precisione.

### Garanzia N-6

Il numero mostrato raggiunge una soglia se e solo se la banda raggiunge quella soglia.

Questa proprietà è parte della specifica e deve essere coperta dai test.

**Nota:** il valore numerico di ε non viene inventato da questa specifica. Deve essere recuperato dalla definizione corrente nel repository; se non è univocamente definito, deve essere segnalato come gap tecnico.

---

# 15. Navigazione e rivelazione progressiva

Vista iniziale Teaching:

`VIEW_CLASS_OVERVIEW`

con:

- `VIEW_STUDENTS`;
- `VIEW_ACTIVITIES`.

Gerarchia:

`L0 → L1 → L2 → L3`

- L0 = quadro classe o profilo alunno;
- L1 = nucleo;
- L2 = criterio;
- L3 = osservazione.

Ogni livello mostra la propria base.

Stessa struttura per i ruoli; il ruolo cambia solo le righe accessibili.

`HOW_TO_READ` si apre su richiesta.

La visibilità dello storico `◇` è controllata in un solo punto per tutte le viste.

Non aggregare Teaching o materie in questa fase.

Il quadro su più materie è affiancamento, non nuova aggregazione.

---

# 16. Viste

## Quadro classe

Distribuzione, blocco attenzione, avviso.

Base in studenti.

Dati anonimi.

Emergono:

- zone di attenzione;
- certezza;
- dispersione.

## Profilo alunno

Nome nell'intestazione.

Mostra:

- sequenze;
- valutazione;
- tacca della classe L1–L2.

Emergono:

- aree da seguire;
- solidità dell'evidenza.

## Nucleo/criteri

Confronto con nucleo.

Emergono:

- scostamenti confermati;
- dati incompleti.

## Osservazioni

Griglia della scala, tempo, `⟦ ⟧`, esclusioni.

Emergono:

- cosa è stato osservato;
- cosa produce il valore attuale.

## Esito attività

Distribuzione dei valori della scala per criterio.

Nessun `◇`.

Nessuna finestra storica.

## Valutazione disciplinare

Timbro, periodo, autore.

Sintesi come evidenza.

Fuori dall'asse.

## Matrice alunni × nuclei

Celle come mini-righe.

Consentito:

- filtro per zona critica.

Vietato:

- ordinamento per livello.

L'ordine deve essere quello configurato per il contenuto, salvo le specifiche di ordinamento linguistico applicabili ai nomi delle persone.

---

# 17. Colori

Il colore non rappresenta la banda.

Non usare una scala rosso-verde.

La certezza non usa il colore.

Palette concettuale:

- inchiostro;
- inchiostro tenue;
- carta;
- carta scura per struttura/contenuto;
- terracotta scura per attenzione;
- terracotta molto chiara + tratteggio per zona critica;
- verde istituzionale solo per identità dell'applicazione.

I segni di attenzione devono rispettare almeno 4,5:1 di contrasto.

La grammatica deve restare leggibile in bianco e nero.

---

# 18. Localizzazione

## L-1

Il codice conosce solo identificatori semantici.

## L-2

Risoluzione:

`tenant override → default prodotto nella lingua attiva → segnalazione testo mancante`

Mai fallback a una lingua hardcoded.

## L-3

Il server risolve il catalogo per:

- tenant;
- lingua;
- versione.

## L-4

Testi parametrizzati:

- parametri nominati;
- categorie plurali della lingua.

Non implementare regole grammaticali specifiche della lingua nel codice.

## L-5

Numeri, date e percentuali:

- dati numerici dal server;
- formattazione sul client;
- lingua della sessione + regione del tenant.

## L-6

Ordinamento alfabetico solo quando previsto e secondo le regole della lingua attiva.

Per nuclei, criteri e materie, l'ordine configurato resta il riferimento.

## L-7

Errori server:

`codice semantico + parametri`

mai frase.

## L-8

Ogni glifo ha un nome accessibile risolto dal catalogo.

## L-9

I codici API non vengono mostrati direttamente.

## L-10

Cambiare lingua non cambia:

- segni;
- colori;
- posizione semantica;
- regole;
- struttura.

La UI deve reggere testi corti e lunghi.

## L-11

I testi predefiniti rispettano il lessico della grammatica.

Le sovrascritture del tenant sono responsabilità dell'istituto e devono seguire una guida editoriale.

---

# 19. RTL

In RTL si specchiano:

- asse;
- sequenza temporale;
- `⟦ ⟧`;
- frecce di andamento;
- barre di distribuzione.

Non si specchiano:

- cifre;
- segni verticali;
- segni simmetrici.

La semantica dell'asse resta:

> distanza dall'inizio della riga nella direzione di lettura.

Non usare `left/right` come concetti semantici.

---

# 20. Contenuto pedagogico multilingue

Traducibili:

- `judgment_bands.etichetta`;
- `observation_scale_values.etichetta`;
- `observation_scales.nome`;
- `subjects.nome`;
- `pedagogical_units.nome`;
- `criteria.descrizione`;
- `school_levels.nome`;
- `assessment_periods.nome`;
- nome visualizzato del tenant, se necessario.

Identità:

- `criteria.codice`;
- `classes.nome`;
- `school_years.nome`;
- `tenants.slug`;
- nomi e cognomi.

Contenuto professionale:

- `activities.nome`;
- `observations.note`;
- `assessments`;
- futuri gruppi.

Il contenuto professionale mantiene la lingua dell'autore.

Ogni valore deve poter esporre la lingua effettiva.

---

# 21. Modello linguistico C2

Il tenant possiede:

- lingue abilitate;
- lingua predefinita;
- lingua di origine dei contenuti;
- regione.

L'utente possiede una preferenza linguistica per tenant.

Risoluzione:

`preferenza utente se abilitata → lingua predefinita tenant`.

La lingua viene ricalcolata:

- al login;
- al cambio tenant;
- quando una lingua viene disabilitata.

La lingua non viene passata come parametro libero del client.

Documenti condivisi/ufficiali hanno una lingua esplicita.

---

# 22. Identificatori semantici

## Strati

`OBSERVATION`, `OBSERVATION_EXCLUDED`, `AGGREGATE`, `OBSERVATION_DERIVED_LEVEL`, `TEACHER_ASSESSMENT`

## Tempo

`CURRENT_LEVEL`, `HISTORICAL_LEVEL`, `CURRENT_VS_HISTORICAL_GAP`, `OBSERVATION_WINDOW`, `TREND_UP`, `TREND_STABLE`, `TREND_DOWN`, `TREND_UNDETERMINED`, `TREND_UNCONFIRMED`

## Certezza

`CERTAINTY_SUFFICIENT`, `CERTAINTY_PARTIAL`, `CERTAINTY_ABSENT`, `STUDENT_COVERAGE_INDICATIVE`, `STUDENT_COVERAGE_PROVISIONAL`, `STUDENT_COVERAGE_CONSOLIDATED`, `CLASS_COVERAGE_REPRESENTATIVE`, `CLASS_COVERAGE_UNDER_OBSERVED`, `CLASS_COVERAGE_NOT_OBSERVED`, `NUCLEUS_DATA_COMPLETE`, `NUCLEUS_DATA_INCOMPLETE`

## Criticità

`CRITICAL_BAND`, `CRITICAL_TO_VERIFY`, `GENERALIZED_DIFFICULTY`, `GENERALIZED_DIFFICULTY_DETAIL`

## Confronto

`REFERENCE_MARK`, `COMPARISON_ABOVE`, `COMPARISON_BELOW`, `COMPARISON_ALIGNED`, `COMPARISON_UNCONFIRMED`, `UNCONFIRMED_TOO_FEW_COMPARABLE`, `UNCONFIRMED_QUORUM_NOT_REACHED`

## Dati mancanti

`NOT_CONFIGURED`, `NOT_OBSERVED`, `INSUFFICIENT_DATA`, `EXCLUDED`, `EXCLUSION_ENROLLMENT_INACTIVE`, `EXCLUSION_UNIT_INACTIVE`, `EXCLUSION_CRITERION_INACTIVE`, `EXCLUSION_ACTIVITY_INACTIVE`, `EXCLUSION_SCALE_INCOMPATIBLE`

## Struttura

`BASE_COUNT`, `DISTRIBUTION`, `ATTENTION_BLOCK`, `HOW_TO_READ`, `VIEW_CLASS_OVERVIEW`, `VIEW_STUDENTS`, `VIEW_ACTIVITIES`, `VIEW_ACTIVITY_OUTCOME`, `VIEW_ASSESSMENT`, `COLUMN_*`

## Sistema

`ROLE_*`, `PERMISSION_*`, `STATUS_*`, `ERR_*`

I codici API esistenti come `poco_osservato` e `confrontabili_insufficienti` possono restare durante la transizione, purché non vengano mostrati all'utente.

---

# 23. Regole di coerenza

- **R-1:** vocabolario chiuso.
- **R-2:** ogni nuovo segnale richiede significato unico, canale libero, assenza di alternativa e registrazione nella specifica prima del codice.
- **R-3:** rappresentazioni ammesse: riga di livello, distribuzione, sequenza, timbro.
- **R-4:** vietati radar, torte, tachimetri, pannelli numerici decorativi, scale rosso-verde, colori per banda, emoji decorative, linee tra aggregati di periodi diversi senza regola temporale, animazioni che suggeriscono andamento.
- **R-5:** valori pedagogici dalla configurazione; testi dalla localizzazione.
- **R-6:** un componente per concetto.
- **R-7:** ogni segno ha equivalente testuale risolto per identificatore.
- **R-8:** modifica della grammatica = aggiornamento della specifica nello stesso intervento.
- **R-9:** nessun testo pedagogico o di sistema hardcoded nell'interfaccia o nei messaggi server.
- **R-10:** ogni nuovo concetto arriva con identificatore, semantica, ruolo visuale e testi predefiniti.
- **R-11:** configurazione pedagogica e localizzazione non si mescolano.
- **R-12:** nessuna geometria semantica sinistra/destra.
- **R-13:** il client non esegue calcoli pedagogici né numerici.

---

# 24. Conseguenze architetturali

## 24.1 Localizzazione

Necessari:

- lingue del tenant;
- lingua predefinita;
- lingua origine contenuti;
- regione;
- preferenza utente per tenant;
- catalogo per tenant × lingua × versione;
- override tenant;
- default prodotto;
- errori semantici;
- testi di ruoli, permessi e stati nel catalogo.

## 24.2 Contenuto multilingue

Necessari campi traducibili per le entità previste dalla sezione 20.

Necessaria lingua effettiva del contenuto.

## 24.3 Motore

Necessari:

- Regola B;
- confronto con interi;
- conversione soglie da valore decimale;
- sostituzione della formattazione numerica precedente;
- test di coerenza;
- differenze sui valori mostrati.

## 24.4 UI

Necessari:

- componenti unici;
- nessun testo hardcoded;
- nessuna coordinata sinistra/destra;
- rimozione di radar;
- rimozione di scala rosso-verde;
- rimozione di aiuti grammaticali hardcoded;
- rimozione di `it-IT` fisso;
- gestione RTL;
- accessibilità.

---

# 25. Database e migrazioni

Il riferimento operativo è il modello multi-tenant del repository.

I file SQL storici del progetto devono essere letti insieme:

- `000_schema_base.sql`;
- `001_vincoli_osservazioni.sql`;
- `002_audit_append_only.sql`.

`002_audit_append_only.sql` è parte integrante del modello di sicurezza.

Le nuove tabelle/migrazioni necessarie per localizzazione e contenuto multilingue devono:

- preservare multi-tenancy;
- rispettare RBAC;
- rispettare audit;
- non introdurre duplicazioni semantiche;
- mantenere la separazione tra configurazione pedagogica e catalogo di sistema.

La forma tecnica definitiva del catalogo può essere decisa durante la progettazione tecnica.

---

# 26. Sicurezza

La V2 visuale non modifica i vincoli di sicurezza esistenti.

Devono rimanere:

- autenticazione reale;
- isolamento tenant;
- RBAC;
- sessione server-side;
- audit append-only.

L'introduzione della preferenza linguistica non deve permettere al client di usare una lingua non abilitata dal tenant.

---

# 27. Branch di implementazione

L'implementazione V2 deve essere eseguita esclusivamente su:

`visual-grammar-v2`

Baseline:

`0ff14284bf96e6e682cfcfff95eee945ab5e940f`

Non modificare direttamente:

- `main`;
- branch di partenza;
- `claude/vigilant-hamilton-g1n5rh`.

La branch `claude/vigilant-hamilton-g1n5rh` contiene lavoro parallelo sul report globale della classe e **non fa parte della V2**.

Non effettuare merge automatici.

---

# 28. Ordine di implementazione raccomandato

1. verifica baseline;
2. inventario del codice attuale;
3. verifica definizione di ε;
4. matrice requisito → codice → gap → test;
5. Regola B;
6. identificatori semantici;
7. catalogo localizzazione;
8. errori come codici;
9. rimozione testi hardcoded;
10. formattazione lingua/regione;
11. certezza;
12. criticità;
13. confronti;
14. navigazione;
15. viste;
16. RTL;
17. accessibilità;
18. test di conformità;
19. revisione finale.

L'andamento può essere completato in una fase successiva se non è necessario per le viste iniziali, ma non va inventata una regola diversa.

---

# 29. Scope esplicitamente rinviato

Non fanno parte dell'obiettivo immediato:

- quadro completo multi-materia;
- definizione della dimensione minima dei gruppi;
- forma tecnica definitiva del catalogo prima della progettazione;
- guida editoriale completa per le sovrascritture;
- funzionalità non richieste dalla grammatica V2.

---

# 30. Criteri di accettazione

Una vista è conforme se:

1. usa solo il vocabolario della V2;
2. ogni valore mostra certezza e base;
3. non contiene testi hardcoded;
4. il client non calcola;
5. non usa semantica left/right;
6. criticità, confronto e andamento rispettano le condizioni previste;
7. rispetta N-6;
8. resta leggibile in bianco e nero;
9. è accessibile;
10. funziona in RTL;
11. supporta testi lunghi;
12. non cambia semantica con la lingua.

---

# 31. Metodo di lavoro per gli agenti AI

Prima di modificare il codice, l'agente deve:

1. leggere questa specifica;
2. leggere il repository;
3. leggere test e migrazioni;
4. identificare il comportamento corrente;
5. produrre una matrice di conformità;
6. evidenziare gap e conflitti;
7. proporre il piano;
8. implementare sulla branch V2;
9. eseguire test;
10. verificare regressioni;
11. riportare esplicitamente quali requisiti sono implementati, quali rinviati e quali bloccati.

L'agente **non deve chiedere nuovamente la V2** se questo documento è disponibile.

L'agente **non deve inventare**:

- testi pedagogici;
- soglie;
- ε;
- regole di confronto;
- regole di andamento;
- significati dei segni.

Quando la specifica non determina una scelta tecnica, l'agente deve proporre la soluzione tecnica più semplice che preservi la semantica e documentarla.

---

# 32. Opportunità introdotte dalla V2

La V2 non è soltanto un restyling della UI.

## 32.1 Coerenza cross-view

La stessa informazione è riconoscibile in qualsiasi vista.

Questo riduce il costo cognitivo del passaggio:

classe → alunno → nucleo → criterio → osservazione.

## 32.2 Separazione semantica

La separazione tra semantica, configurazione, localizzazione e presentazione permette di cambiare lingua o UI senza modificare le regole pedagogiche.

## 32.3 Multi-tenant reale

La localizzazione diventa configurazione del tenant anziché una caratteristica nascosta nel frontend.

## 32.4 Accessibilità

Ogni segno possiede un equivalente semantico testuale.

La grammatica non dipende dal colore.

## 32.5 RTL

La direzione della lettura diventa parte della presentazione senza modificare il significato.

## 32.6 Auditabilità

Le modifiche alla localizzazione e alla configurazione possono essere sottoposte all'audit esistente.

## 32.7 Stabilità numerica

La Regola B elimina la possibilità che il numero visualizzato contraddica la banda a causa di arrotondamenti o floating point.

## 32.8 Evoluzione futura

Il vocabolario chiuso permette di aggiungere viste senza inventare una nuova grammatica per ogni pagina.

---

# 33. Necessità introdotte dalla V2

L'implementazione richiederà probabilmente:

- nuove strutture di localizzazione;
- preferenze linguistiche per utente/tenant;
- configurazione lingue tenant;
- regione tenant;
- lingua origine contenuti;
- campi traducibili;
- catalogo versionato;
- risoluzione server-side;
- errori semantici;
- componenti visuali comuni;
- supporto RTL;
- test accessibilità;
- test numerici;
- test di localizzazione;
- test di regressione.

La forma tecnica di tali strutture deve essere progettata sulla base dello schema corrente e delle migration esistenti.

---

# 34. Regola di conservazione della semantica

Una modifica tecnica è accettabile se cambia:

- implementazione;
- struttura interna;
- componentizzazione;
- storage;

ma non cambia:

- significato;
- regola;
- soglia;
- certezza;
- segno;
- ordine semantico;
- condizioni di comparabilità;
- condizioni di andamento.

Se una modifica cambia uno di questi elementi, non è una semplice implementazione: è una modifica della specifica e deve essere approvata separatamente.

---

# 35. Definizione di completamento V2

La V2 è implementata quando:

- la grammatica è coerente tra le viste implementate;
- il codice non contiene testi di sistema hardcoded;
- la localizzazione è risolta server-side;
- il client non esegue calcoli pedagogici;
- la Regola B è verificata;
- certezza e base sono sempre rappresentate;
- criticità e confronti rispettano le condizioni;
- RTL è gestito;
- accessibilità è verificata;
- i test di conformità passano;
- la branch `visual-grammar-v2` contiene esclusivamente il lavoro V2 e i necessari test/migration;
- la baseline e le branch parallele non sono state modificate.

---

## Appendice A — principio sintetico

> **Stesso significato → stesso segno.  
> Stessa grammatica → tutte le viste.  
> Lingua diversa → parole diverse, non semantica diversa.  
> Dato incerto → segno più debole, non colore diverso.  
> Dato assente → non zero.  
> Numero e banda → una sola fonte numerica.  
> Client → presenta. Server → calcola.**

---

## Appendice B — regola per gli agenti AI

Questo file è un **documento di contesto normativo**.

Un agente AI che lavora sul progetto deve leggerlo prima di modificare:

- UI;
- motore pedagogico;
- API dei report;
- localizzazione;
- migrazioni relative alla V2;
- test della grammatica.

Se una richiesta futura contraddice questo documento, l'agente deve segnalare la contraddizione invece di applicarla silenziosamente.

Se la specifica viene modificata, questo documento deve essere aggiornato e versionato nello stesso intervento.
