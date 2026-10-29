## CHECKPOINT 013 — Unione in `main` e migrazione 004 applicata su Neon (28/10/2026)

**Riferimento al piano:** CHECKPOINT 011 e 012 («Prossimo passo», punti 2–4).

**Ramo e commit:** `main`, HEAD `b001f6a` (commit di unione, anche su `origin`).
Genitori: `103c0ca` (CHECKPOINT 010) e `3fa47ed` (CHECKPOINT 012, punta di
`claude/awesome-johnson-ac4qcm`). Entrano in `main`: `83e9025` (codice), `c73920c`
(CHECKPOINT 011), `3fa47ed` (CHECKPOINT 012).

**Esito dei test:** eseguiti dal proprietario sul suo computer (Windows), sul ramo
a `3fa47ed`, prima dell'unione: `npm run test:all` dà `npm test` **145/145** ed
E2E **14/14** (PGlite).

**L'esito vale per `main`:** la chat di progetto ha verificato su GitHub che
`git diff --stat origin/main origin/claude/awesome-johnson-ac4qcm` è vuoto. I
test non sono stati rieseguiti dopo l'unione.

**Natura di questa voce:** chiude l'iterazione dei CHECKPOINT 011–012. Registra
l'unione e la prima modifica di schema su Neon dopo la 003.

### Unione
- `git merge --no-ff claude/awesome-johnson-ac4qcm` su `main`, push `103c0ca..b001f6a`.
- Incidente prima dei test, senza conseguenze: `npm ci` è fallito con `EPERM`
  sul file nativo di `@node-rs/argon2`, tenuto aperto da un processo Node.
  Chiusi i processi, `npm ci` è riuscito (89 pacchetti).
- `npm ci` segnala **2 vulnerabilità** (1 moderata, 1 alta). Non trattate: vedi
  «Aperto».

### Neon
- **Rami del progetto Neon:** `production`, `v1-development`,
  `v2-visual-grammar`. Il proprietario lavora su **`v2-visual-grammar`**
  (dichiarato dal proprietario, 28/10/2026).
- **Correzione al CHECKPOINT 007:** le sue verifiche su «Neon» non indicavano il
  ramo. Lo stato registrato allora (30 tabelle, un solo trigger, 003 applicata)
  coincide con quello di `v2-visual-grammar`, quindi verosimilmente era quel
  ramo `[inferenza]`.
- **Stato prima della 004** (`v2-visual-grammar`, query di sola lettura): 30
  tabelle, 1 trigger, `teachings` presente (000), `languages` presente (003).
- **Backup:** ramo `backup-prima-004` con genitore `v2-visual-grammar`, creato
  secondo le istruzioni `[da confermare dal proprietario]`.
- **Applicazione:** `migrations/004_immutabilita_strutturale.sql` eseguita per
  intero dall'SQL Editor di Neon, su `v2-visual-grammar`, senza errori.
- **Verifica dopo la 004** (`pg_trigger`, trigger non interni):
  | Conteggio | Atteso | Ottenuto |
  |---|---|---|
  | `trg_%immutabil%` | 26 | **26** |
  | `%_riferimenti_immutabili` (Regola 1) | 20 | **20** |
  | `%_struttura_immutabile` (Regola 2) | 6 | **6** |
- **Rami `production` e `v1-development`:** non interrogati, stato ignoto. Non
  hanno la 004.

### Conformità alla chiusura V1.1, aggiornata (CHECKPOINT 009)
| # | Decisione | Stato |
|---|---|---|
| 2 | Immutabilità dei riferimenti strutturali | **Conforme**, nel codice e su Neon (`v2-visual-grammar`). Estesa ad `assessments` e alle colonne nate dopo la chiusura (CHECKPOINT 012) |
| 4 | Scritture solo su anno `attivo` | **Implementata e testata** per creazione di attività e salvataggio/cancellazione di osservazioni. Fuori per decisione: traduzioni, assegnazioni di ruolo |

Le decisioni 1, 3, 5, 6, 7 restano come nel CHECKPOINT 009.

### Non verificato
- **Prova funzionale contro Neon:** avviare l'applicazione su
  `v2-visual-grammar`, accedere, creare un'attività, salvare e cancellare
  un'osservazione. I test girano su PGlite: nessuna operazione applicativa è
  stata ancora eseguita contro Neon dopo la 004.

### Aperto
- Prova funzionale contro Neon (sopra).
- Le **2 vulnerabilità** di `npm audit`: leggere l'output di `npm audit` e
  trattarle su un ramo, mai con `npm audit fix` direttamente su `main`.
- Sorte dei rami Neon `production` e `v1-development` e del backup
  `backup-prima-004`. Va anche deciso quale ramo Neon farà da riferimento per i
  dati reali.
- Sorte dei rami Git `claude/awesome-johnson-ac4qcm` (già unito: si può
  eliminare) e `claude/vigilant-hamilton-g1n5rh`.
- Indici per gli `EXISTS` dei trigger (CHECKPOINT 011).
- Iterazione sui movimenti di alunni e docenti (CHECKPOINT 011 e 012).
- Dal piano, invariati:
  - **sicurezza e database:** privilegi di `app_role` su ruoli e permessi (va
    conservato UPDATE su `school_years` per il `FOR SHARE`, CHECKPOINT 011);
    privilegi di default; `sslmode=verify-full`; indice su `lower(email)`; RLS;
    registro delle migration;
  - **documentazione:** nota di stato in testa alla specifica V2 (CHECKPOINT 010,
    «Rischio»); specifica V2.1 rev. 2; `V1.1_Final_…Closure.md` in `doc/`;
    prerequisito Chromium nel README;
  - **decisioni pedagogiche:** D2, D4, D5, D6; conservazione di audit e dati;
    progresso su più anni; congelamento di soglie e scale; nota per criterio.

### Prossimo passo
1. Prova funzionale contro Neon (5 minuti, manuale).
2. Scegliere la prossima iterazione. Candidati:
   - **(a) Nota di stato nella specifica V2:** solo documentazione. Elimina il
     rischio che un agente «ripristini» la V2 sulla V2.1.
   - **(b) Sicurezza e database:** privilegi, `sslmode`, email, indici.
   - **(c) Movimenti di alunni e docenti:** prima vanno chiuse le decisioni
     aperte.
