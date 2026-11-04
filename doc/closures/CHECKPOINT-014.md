## CHECKPOINT 014 — Nota di stato V2.1 nella specifica V2 e chiusura delle verifiche su Neon (04/11/2026)

**Riferimento al piano:** prompt di ripresa, «Da fare» punto 3 (documentazione);
CHECKPOINT 010 («Rischio»); CHECKPOINT 013 («Non verificato», «Prossimo passo»).

**Ramo e commit:** `nota-stato-v2`, creato da `main` a `96232f3`. Commit
`13ce74b` («Documentazione: nota di stato V2.1 nella specifica V2; README con
migrazione 004 e Chromium»), più questo checkpoint. Nessun codice cambiato:
vale l'esito del CHECKPOINT 013 (145/145 e 14/14). Nessun test legge
`README.md` o la specifica V2 (verificato con una ricerca nei test).

**Natura di questa voce:** iterazione di sola documentazione, preparata dalla
chat di progetto e salvata dal proprietario. Registra anche esiti e correzioni
rimasti dal CHECKPOINT 013.

### Fatto
| File | Cosa |
|---|---|
| `doc/VISUAL_GRAMMAR_V2_IMPLEMENTAZIONE.md` | +42 righe in testa, resto invariato. **Nota di stato:** il codice di `main` implementa la V2.1 rev. 2 (descritta nel README) |
| `README.md` | +15 −1: migration 004 nella sequenza di installazione (con `ON_ERROR_STOP` e verifica dei 26 trigger) e nella catena dei test; comando `npx playwright-core install chromium` per la prima esecuzione degli E2E |

La nota di stato stabilisce:
- una **regola di prevalenza**: sulle sezioni elencate vale la V2.1 rev. 2,
  sulle altre la specifica resta normativa (§0);
- il **divieto di riportare il codice alla V2**: niente righe di livello,
  niente colori neutri, nessuna colonna andamento;
- la **tabella delle divergenze**: §1, §7, §4, §5.1, §5.2, §17, R-4, §12, §16,
  R-3, §25, §27;
- l'elenco delle sezioni **invariate**;
- il rimando al CHECKPOINT 010 per la numerazione dei riferimenti nei test.

### Decisioni `[CONCORDATO]`
- **Prevalenza della V2.1 rev. 2 sulla specifica V2** per le sezioni elencate,
  fino al riallineamento del documento. È una modifica formale ai sensi del §0.
  Approvata dal proprietario il 04/11/2026, salvando il commit `13ce74b`. Prima,
  il README la affermava solo per §12 e §16; la nota la estende alle divergenze
  del CHECKPOINT 010.

### Verificato
- `git diff --stat origin/main origin/nota-stato-v2`: 2 file, +56 −1 (chat di
  progetto, su GitHub). I due file su GitHub sono identici, byte per byte, a
  quelli preparati dalla chat.
- **Prova funzionale contro Neon** (`v2-visual-grammar`, dopo la 004): accesso,
  creazione di un'attività, salvataggio e cancellazione di un'osservazione.
  Esito positivo (proprietario, entro il 04/11/2026). Chiude il punto «Non
  verificato» del CHECKPOINT 013.

### Correzioni al CHECKPOINT 013
- Il ramo di backup su Neon si chiama **`backup-prima-migration004`** (genitore
  `v2-visual-grammar`), non `backup-prima-004`. La sua esistenza è confermata
  dal proprietario.
- La voce 013 è stata **corretta sul posto** con il commit `96232f3` (nome del
  backup e conferma), direttamente su `main`. Questo è in deroga alla regola 1
  del registro («solo in aggiunta»). Non si annulla: riscrivere la storia di
  `main` sarebbe peggio. La versione originale della voce è in `06a727e`. Da ora
  le conferme vanno nella voce successiva.

### Non toccato di proposito
- Il corpo della specifica V2: il **riallineamento** delle sezioni divergenti
  resta da fare (R-8).
- Codice, test, migration, Neon.

### Aperto
- **Riallineamento della specifica V2 alla V2.1 rev. 2**: riscrivere le sezioni
  della tabella, poi togliere la nota. In alternativa, una specifica V2.1
  separata (P1–P15, C1–C5, E1–E4, «Decisione A», «vincolo 7»).
- Corrispondenza tra la numerazione dei test e quella consolidata (CHECKPOINT
  010): da confermare con chi ha l'originale.
- `V1.1_Final_Security_Database_Integrity_Closure.md` in `doc/`: oggi è solo
  nella knowledge base del progetto.
- Le 2 vulnerabilità di `npm audit` (CHECKPOINT 013).
- Rami Git da riordinare: `claude/awesome-johnson-ac4qcm` e `checkpoint-013`
  (uniti, eliminabili), `visual-grammar-v2` (unito), `claude/vigilant-hamilton-g1n5rh`
  (da decidere). Rami Neon `production`, `v1-development`,
  `backup-prima-migration004`.
- Invariati dal CHECKPOINT 013:
  - **sicurezza e database:** privilegi, `sslmode`, email, indici, RLS,
    registro delle migration;
  - **movimenti di alunni e docenti;**
  - **decisioni pedagogiche:** D2, D4, D5, D6 e le altre aperte.

### Prossimo passo
1. Commit di questo checkpoint sul ramo `nota-stato-v2`, unione in `main` con
   `--no-ff`, push.
2. Prossima iterazione, candidati:
   - **(b) Sicurezza e database:** privilegi di `app_role` (conservando UPDATE
     su `school_years`), privilegi di default, `sslmode=verify-full`, indice su
     `lower(email)`, indici per gli `EXISTS`. Con Claude Code.
   - **(d) Vulnerabilità npm.**
   - **(e) Riordino dei rami** Git e Neon: rapido, a mano.
