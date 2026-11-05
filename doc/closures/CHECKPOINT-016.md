## CHECKPOINT 016 — Iterazione 2, passo A: anni in preparazione, calendario, livelli e classi, Quadro dell'istituto (04/11/2026)

**Riferimento al piano:** seconda delle quattro iterazioni per preparare una scuola
dall'interfaccia (CHECKPOINT 015, «Prossimo passo» 5; decisioni del proprietario del
04/11/2026). Prompt: `prompt-claude-code-iterazione-2-passo-A.md`.

**Ramo e commit:** `claude/new-session-wd7goo`, creato da `main` a `7bf0ca7` dalla
sessione cloud di Claude Code (il nome `iterazione-2-passo-A` non era sceglibile).
Dieci commit, uno per passo:

| Passo | Commit | Contenuto |
|---|---|---|
| 1 | `f849e04` | Migration 006 e test |
| 2 | `aa7b5a4` | Regola dell'anno: docenti solo su anno attivo, configurazione anche su anno in preparazione |
| 3 | `783cf4f` | Server del calendario: anni con transizioni, periodi di valutazione |
| 4 | `990b424` | Server di livelli e classi |
| 5 | `3d5d121` | Server del Quadro dell'istituto |
| 6 | `9855774` | Client: cornice dell'amministrazione (menu, anno di lavoro, Quadro) |
| 7 | `4feb47a` | Client del calendario (anni con azioni e conferme, periodi) |
| 8 | `e60a2a0` | Client di livelli e classi |
| 9 | `c8b4227` | E2E dell'amministrazione dell'istituto |
| 10 | `2971013` | README (migration 006, catena dei test, API) |

**Esito dei test a `2971013`:**
| Dove | `npm test` | `npm run test:e2e` |
|---|---|---|
| Computer del proprietario (Windows), comando ufficiale | **206/206** (45,0 s) | **22/22** (41,6 s) |
| Chat di progetto (verifica indipendente, clone di GitHub) | 206/206 | 22/22, comando ufficiale |
| Sessione cloud di Claude Code | 206/206 | 22/22, **con un accorgimento** fuori dal repository |

206 = 181 preesistenti + 25 nuovi (`tests/anniScolastici.test.js`,
`tests/strutturaIstituto.test.js`). 22 E2E = 19 preesistenti + 3 nuovi.

**Natura di questa voce:** chiude il passo A dell'iterazione 2. Sostituisce
`doc/closures/LAVORO-IN-CORSO-iterazione-2A.md`, che si rimuove nello stesso commit;
la versione completa resta nella storia di Git a `2971013`. Registra anche le note
d'uso del proprietario e le decisioni prese dopo la prova a mano.

### Cosa si può fare ora
- **Il TENANT_ADMIN prepara il calendario.** Crea un anno scolastico (nasce
  *in preparazione*), lo attiva, oppure usa **«Passa al nuovo anno»**: chiude l'anno
  attivo e attiva quello in preparazione in un'unica operazione. Riapre un anno
  chiuso solo se non ce n'è un altro attivo. Elimina un anno in preparazione senza
  dati.
- **Periodi di valutazione liberi:** dentro le date dell'anno, sovrapponibili
  (per esempio due bimestri dentro un quadrimestre), nome unico nell'anno.
- **Livelli e classi:** crea, rinomina, riordina, disattiva, riattiva, elimina (solo
  senza dati collegati). In un livello disattivato non si creano classi.
- **Quadro dell'istituto:** «Cose da fare» nell'ordine in cui si sistemano, con
  collegamento alla sezione quando esiste; riepilogo per livello (classi, alunni,
  docenti, insegnamenti dell'anno); completezza delle traduzioni in coda.
- **Anno di lavoro** come elenco di collegamenti (Quadro e Calendario), deciso dal
  server.
- **I docenti non vedono gli anni in preparazione** e non vi scrivono (409).

### Migration 006 (`migrations/006_anni_in_preparazione.sql`)
- Controllo preventivo: se un tenant ha più di un anno `attivo` la migration si ferma
  con una eccezione e un suggerimento, senza applicare nulla.
- Sostituisce il CHECK su `school_years.stato` con `ck_school_years_stato`:
  `attivo`, `in_preparazione`, `chiuso`.
- Indici univoci parziali per tenant: `uq_school_years_un_attivo`,
  `uq_school_years_una_preparazione`.
- Transazione unica, rieseguibile. Il DEFAULT di `stato` resta `attivo`.
- **Senza la 006 il codice di `main` non funziona sul ramo Neon.**

### Verificato
- **Test:** tabella sopra.
- **Verifica indipendente** (chat di progetto): il ramo ha `7bf0ca7` come antenato;
  la 006 è stata letta; le sole righe tolte ai test esistenti sono le due di
  preparazione dati (sotto).
- **Preparazione dati di test adattata** (nessuna asserzione modificata): il nuovo
  indice vieta un secondo anno `attivo` nello stesso tenant. In
  `tests/immutabilita.test.js` (funzione `anno()` di `conFixture`) e in
  `tests/integration.test.js` («DB (cross-year)…», anno 2027/2028) l'INSERT di
  `school_years` passa da stato `attivo` (DEFAULT) a `chiuso`. Lo stato non entra
  nelle verifiche di quei test.
- **Asserzioni esistenti modificate:** nessuna.
- **Prova a mano** (proprietario, 04/11/2026): eseguita su `localhost`, con esiti
  nelle note d'uso qui sotto. Il nome del ramo Neon di prova e l'applicazione della
  006 su di esso: `[da confermare dal proprietario]`.

### Decisioni `[CONCORDATO]` — proprietario, 04/11/2026
1. **Schema dei menu** dell'amministrazione: valido «per ora», con modifiche in
   itinere. Genitori **fuori** dall'iterazione 2. Curricolo del TENANT_ADMIN
   «come riserva». Partenza: calendario e struttura.
2. **Nuovo anno scolastico:** stato *in preparazione*. **Riapertura** di un anno
   chiuso: dal TENANT_ADMIN (e dal PLATFORM_ADMIN). **Periodi liberi.**
3. **Riapertura con il nuovo anno già attivo:** resta com'è, 409
   `ERR_SCHOOL_YEAR_ACTIVE_EXISTS`. Si chiude prima il nuovo anno, poi si riapre il
   vecchio.
4. **Periodi per livello:** i periodi di valutazione dovranno appartenere al livello
   (calendari diversi per livelli diversi). Si realizza nell'**iterazione 3**
   (curricolo per livello), con la **migration 007**; tocca valutazioni e snapshot.
5. **Giudizio del docente per periodo:** **automatico**, calcolato dai risultati,
   con **override del docente** e **registro degli override**. Dettagli aperti
   (vedi «Aperto»).
6. **Sospensione di una scuola = sola lettura**, per tutti i ruoli, a ogni livello.
   Nessuna cancellazione di dati. Vedi «Sospensione» sotto.
7. **Gestione delle scuole** (PLATFORM_ADMIN): rinominare, sospendere e riattivare
   una scuola, aggiungere altri amministratori anche a una scuola che non ne ha.
   Il TENANT_ADMIN assegna altri amministratori e ruoli della propria scuola (passo
   B); rinominare e sospendere restano solo al PLATFORM_ADMIN.
8. **Ordine dei lavori:** (1) chiusura del passo A; (2) inserimento osservazioni
   (note 6, 7, 8) con le note 1 e 2; (3) Gestione delle scuole; (4) passo B
   (persone e ruoli), poi C (scala e soglie), D (insegnamenti), curricolo con periodi
   per livello (007), import degli alunni.
9. **Schermate:** il requisito è il *reflow*, non una larghezza minima. Nessuno
   scorrimento laterale da 320 px in su; la matrice alunni × criteri si dispone a
   schede o a colonne impilate quando lo spazio è poco.

### Sospensione di una scuola `[CONCORDATO]` con precisazione
- Una scuola sospesa resta **leggibile** da tutti i suoi utenti. Ogni scrittura è
  rifiutata dal server con un 409 e un codice proprio, **qualunque sia il ruolo**.
  Compare un avviso fisso «Istituto sospeso: sola lettura».
- Eccezioni: **logout** e **cambio della propria password**.
- **Precisazione** (domanda del proprietario: «come può il PLATFORM_ADMIN
  riattivarla?»): la sola lettura riguarda i **dati della scuola** (anni, classi,
  osservazioni, account della scuola…). Sospendere, riattivare e rinominare sono
  operazioni **di piattaforma** sulla scheda della scuola, fatte dalla Gestione
  scuole, che non richiede una scuola attiva. Il PLATFORM_ADMIN può quindi
  riattivare anche mentre, dentro la scuola, vede solo in lettura.
- Il controllo cambia due comportamenti esistenti: oggi un tenant `sospeso` non si
  può selezionare (`auth.js`, `switch-tenant`) e nell'elenco del PLATFORM_ADMIN
  compaiono solo le scuole attive. Con la sola lettura entrambi vanno rivisti.
- Oggi non risulta un controllo dello stato del tenant a ogni richiesta (il campo
  `tenants.stato` esiste, `attivo`/`sospeso`, ma è letto solo in quei due punti):
  il prompt deve imporre un **unico punto di controllo** e provarlo con **un test per
  ogni famiglia di rotte di scrittura**.
- Una riga di audit per ogni sospensione e riattivazione.

### Decisioni proposte da Claude Code: **validate** dal proprietario, 04/11/2026
Elenco ricostruito dal file di lavoro `LAVORO-IN-CORSO-iterazione-2A.md` a `2971013`.
1. Scrittura di un docente su un anno in preparazione → 409
   `ERR_SCHOOL_YEAR_IN_PREPARATION`.
2. Gli anni in preparazione non compaiono tra gli insegnamenti del docente; le
   letture rispondono 404, le scritture 409.
3. DEFAULT di `stato` resta `attivo`; l'anno creato dall'interfaccia nasce
   `in_preparazione` per decisione del server.
4. Azioni ammesse su un anno e anno di lavoro predefinito decisi dal server (R-13).
5. «Passa al nuovo anno» = `switch-to`; audit con due righe `school_year.switch` e
   stesso `correlation_id`.
6. **Validata con modifica:** nome e date di un anno non si modificano *oggi*. Da
   fare nel lavoro successivo: il **nome** diventa modificabile, le **date** restano
   fisse (governano i periodi).
7. Eliminando un periodo o un livello si eliminano le sue traduzioni.
8. In un livello disattivato non si creano né si riattivano classi.
9. Nessuna rotta scrive `school_level_id`.
10. Le «Cose da fare» del Quadro hanno un collegamento solo se la sezione esiste.
11. Completezza delle traduzioni in coda al Quadro (provvisorio).
12. «Scuole» del PLATFORM_ADMIN è una voce del menu.
13. Anno di lavoro come elenco di collegamenti, nessun `<select>`.
14. Ordine di un nuovo livello in coda, facoltativo.
15. **Precisazione:** la regola «basta un giorno in comune» riguarda gli **anni
    scolastici** (due anni non si sovrappongono), **non i periodi**. I periodi sono
    liberi e sovrapponibili (decisione 2 sopra). Nella tabella della chat di
    progetto l'avevo attribuita per errore ai periodi.
16. Ogni transizione di anno chiede conferma con `window.confirm`. Accettato per
    ora; una conferma nel corpo della pagina sarebbe più accessibile `[da valutare]`.

### Note d'uso del proprietario (prova a mano, 04/11/2026)
| # | Nota | Esito / destinazione |
|---|---|---|
| 1 | Amministratori (di piattaforma e di scuola) atterrano su «Insegnamenti», vista del docente. | Difetto confermato (partenza sempre `#/insegnamenti`). **Partenza per ruolo:** TENANT_ADMIN → Quadro, PLATFORM_ADMIN → Amministrazione, COORDINATOR → classi del suo livello, TEACHER → Insegnamenti. Lavoro 2. |
| 2 | Onboarding semplice; confusione tra livello e ordine. | Etichette e testo d'aiuto più chiari nel catalogo. Lavoro 2. |
| 3 | I periodi dovrebbero stare dentro i livelli. | Concordato: iterazione 3, migration 007. |
| 4 | Il PLATFORM_ADMIN dovrebbe poter gestire le scuole. | Oggi **non può** rinominare, sospendere, riattivare né aggiungere amministratori; il TENANT_ADMIN non può assegnare altri amministratori. Lavoro 3 (scuole) e passo B (persone). |
| 5 | Da dove vengono i dati della scheda VALUTAZIONI di `teacher.math.a@alfa.test`? | Sono righe di `assessments` inserite da `seed/seed_multitenant.sql`. Non si formano alla chiusura del periodo e **nell'app non esiste alcuna scrittura** (solo `GET …/assessments`). Decisione 5 sopra. |
| 6 | In un anno chiuso manca un messaggio chiaro di sola lettura. | Avviso fisso appena si entra in un'attività di anno chiuso. Lavoro 2. |
| 7 | La schermata di valutazione richiede scorrimento laterale. | Reflow, nessuna larghezza minima (decisione 9). Lavoro 2. |
| 8 | Ogni scelta di livello ridisegna la pagina. | Salvataggio sul posto: cambia solo il controllo toccato, senza ridisegnare né perdere la posizione; risultati aggiornati senza ricaricare tutto. Lavoro 2. |
| — | Riapertura solo per TENANT_ADMIN e PLATFORM_ADMIN. | Conforme alla decisione 2. |

Le note 6, 7 e 8 riguardano la schermata di inserimento delle osservazioni, che il
passo A non ha toccato `[da verificare nel codice dal lavoro 2]`.

### Non toccato di proposito
- `main` (finché non si fa l'unione), seed, motore e viste dei report, Neon
  `v2-visual-grammar`.
- Passi B, C, D; curricolo; import degli alunni; movimenti di alunni e docenti.

### Aperto
- **Dettagli del giudizio automatico con override:**
  - quando si calcola: alla chiusura del periodo oppure a richiesta;
  - motivazione obbligatoria dell'override?
  - il giudizio calcolato resta sempre visibile accanto a quello del docente?
  - chi può fare l'override e come funziona con la co-docenza (privacy tra docenti);
  - rapporto con lo snapshot per periodo e con i periodi sovrapponibili: un
    risultato non può dedurre un solo periodo dalla data.
- **Gestione delle scuole:** può il PLATFORM_ADMIN aggiungere un amministratore a una
  scuola sospesa? Proposta: sì, è un'operazione di piattaforma `[DECISIONE PROPOSTA]`.
- Nome dell'anno modificabile (validata, da realizzare); conferma nel corpo della
  pagina al posto di `window.confirm`.
- Nome di periodi e livelli scritto nella lingua dei contenuti del tenant: se la
  sessione è in un'altra lingua, la modifica sovrascrive il testo di origine. Da
  rivedere con la sezione «Lingue e traduzioni».
- «Lingue e traduzioni» come sezione del menu.
- Le cose da fare su alunni, insegnamenti e password temporanee non hanno
  collegamento: arriveranno con i passi B e D.
- Le letture di un insegnamento di un anno in preparazione rispondono 404 e le
  scritture 409: un id noto rivela l'esistenza al docente titolare. Accettato.
- Indici per gli `EXISTS` del Quadro e delle eliminazioni.
- Ambiente E2E del cloud: `playwright-core` 1.56.1 cerca Chromium rev. 1194, l'ambiente
  ha la 1243.
- **Dal CHECKPOINT 015:** limite ai tentativi di accesso; durata delle sessioni;
  elenco degli account con password temporanea non ancora cambiata; riga
  `person.create` nell'audit; voci di catalogo inutilizzate (`UI_TENANT`,
  `UI_TENANT_NONE`, `UI_SELECT_TENANT_PROMPT`).
- **Dal CHECKPOINT 014 e precedenti:** sicurezza e database (privilegi di `app_role`
  conservando UPDATE su `school_years` per il `FOR SHARE`, `sslmode=verify-full`, RLS,
  registro delle migration); 2 vulnerabilità di `npm audit` (da trattare su ramo,
  mai `npm audit fix` su `main`); riordino dei rami Git (`claude/awesome-johnson-ac4qcm`,
  `checkpoint-013`, `nota-stato-v2`, `claude/laughing-clarke-1vc5f1`,
  `visual-grammar-v2`, `claude/vigilant-hamilton-g1n5rh`) e Neon (`test-iterazione-1`
  e il ramo di prova del passo A, i backup, `production`, `v1-development`);
  `V1.1_Final_Security_Database_Integrity_Closure.md` da aggiungere a `doc/`;
  riallineamento della specifica V2 alla V2.1; decisioni pedagogiche D2, D4, D5, D6;
  firma dello scrutinio in supplenza lunga; docente uscente; promozione anticipata;
  movimenti di alunni e docenti (M1/M3, cambio sezione, snapshot, seconda iscrizione
  nello stesso anno oggi vietata da UNIQUE).

### Prossimo passo
1. Commit di questo checkpoint sul ramo `claude/new-session-wd7goo`, con rimozione di
   `doc/closures/LAVORO-IN-CORSO-iterazione-2A.md` nello stesso commit; unione in
   `main` con `--no-ff`; verifica con `git diff --stat` vuoto.
2. **006 su `v2-visual-grammar`:** ramo di backup `backup-prima-migration006` (genitore
   `v2-visual-grammar`); controllo preventivo (nessun tenant con più di un anno
   `attivo`: zero righe); applicazione; verifica (`ck_school_years_stato` e i due
   indici); `.env` di nuovo su `v2-visual-grammar`; login di prova.
3. Lavoro 2: inserimento osservazioni (note 6, 7, 8) con le note 1 e 2, più il nome
   dell'anno modificabile.
4. Lavoro 3: Gestione delle scuole (PLATFORM_ADMIN) con sospensione in sola lettura.
5. Passo B, poi C, D, curricolo con periodi per livello (007), import degli alunni.
