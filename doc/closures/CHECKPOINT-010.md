## CHECKPOINT 010 — Specifica Visual Grammar V2 e conformità del codice V2.1 (11/10/2026)

**Riferimento al piano:** `doc/VISUAL_GRAMMAR_V2_IMPLEMENTAZIONE.md` (§0–§35, "Visual Grammar V2 consolidata").

**Ramo e commit:** `main`; ultimo hash noto `4d19432` (unione). I commit dei
CHECKPOINT 009 e 010 seguono. I test non sono stati rieseguiti: ultimi esiti
noti 132/132 e 14/14.

**Natura di questa voce:** lettura della specifica normativa della V2 e
confronto con quanto risulta da commit e test. Nessun codice è stato letto
direttamente: le affermazioni sul codice vengono dai messaggi di commit e dai
nomi dei test.

### Cos'è il documento
- Specifica **normativa**: dove codice e specifica divergono "la specifica
  prevale" (§0). Ogni modifica alla grammatica richiede l'aggiornamento del
  documento nello stesso intervento (R-8); ogni nuovo segno va registrato nella
  specifica **prima** del codice (R-2).
- Pensata come contesto per agenti AI: §31 e Appendice B impongono di leggerla
  prima di toccare UI, motore, API dei report, localizzazione e test.

### Cosa chiude
- **Baseline:** §27 indica `0ff14284…`, che è il `main` precedente all'unione.
  Il lavoro sul ramo `visual-grammar-v2` era previsto e coincide.
- **ε della Regola B:** §14 chiedeva di recuperarlo dal repository; i test lo
  fissano a 1e-9 (CHECKPOINT 001). Chiuso.
- **Regole confermate dai test:** certezza (§9, test U2, U4, U10), confronto
  criterio↔nucleo con almeno 6 confrontabili e 2/3 concordi (§11, U11),
  Regola B e garanzia N-6 (§14, `regolaB.test.js`), esclusioni con motivo (§13),
  criticità (§10), valutazione del docente fuori dall'asse (§16, E4).
- **Radar:** vietato da R-4. Spiega perché è stato rimosso (`d616d46`) e
  conferma che D7, D8 e D11 della specifica v2.6 (CHECKPOINT 004) sono superate.
- **Passi 1–2 e fase A:** §28 apre con baseline, inventario del codice, verifica
  di ε e matrice di conformità, cioè lavoro di analisi senza commit. È
  verosimile che i passi 1–2 siano questi e che la fase A della V2.1 sia
  analoga `[inferenza, da confermare]`. I commit numerati seguono un piano di
  14 passi, diverso dai 19 punti di §28.

### Numerazione dei riferimenti nei test
Questo documento è la versione **consolidata**: i riferimenti nei test e nei
commenti (§7, §8, §17, §29.12, P3–P15, B-1…B-7) vengono con ogni probabilità
dalla numerazione **precedente al consolidamento**, che non è nel repository
`[inferenza]`. Corrispondenza plausibile per significato, da confermare con chi
ha l'originale:
| Nei test | Argomento | In questo documento |
|---|---|---|
| §7 | Certezza | §9 |
| §8 | Criticità | §10 |
| §17 | Testi e catalogo | §18 (localizzazione), §22 (identificatori) |
| §29.12, B-2/B-3 | Contenuto pedagogico multilingue | §20 |
Coincidono invece per nome: C2 (§21), N-6 e Regola B (§14), H3 (§9).
Non compaiono qui: P3–P15, C4, C5, E1–E4, "Decisione A", "vincolo 7": vengono
verosimilmente dalle richieste della V2.1 rev. 2.

### Divergenze tra la specifica e la V2.1 `[da riallineare con il proprietario]`
1. **Unità visiva.** La specifica descrive la **riga di livello con asse**
   (§1, §5, §7, §16). La V2.1 usa un **disco a settori** (raggio = valore) e
   mini-dischi.
2. **Colore.** §17 e R-4 vietano "colori per banda". La V2.1 assegna a ogni
   banda un colore dal server (E1) e colora i valori osservati con la banda
   (E2).
3. **Segni nuovi.** Il disco, il settore e il segno ⌒ (arco con terminali per
   la classe) non sono nel vocabolario chiuso di §5.2. R-2 e R-8 chiedono la
   registrazione nella specifica prima del codice.
4. **Andamento (§12).** La V2.1 elimina la colonna. §28 consente di rinviarlo
   "senza inventare una regola diversa": coerente.
5. **§25** cita `001_vincoli_osservazioni.sql`; nel repository la 001 è
   `001_ruoli_permessi_sistema.sql`, e la 003 non è citata.
La documentazione della V2.1 sta nel `README.md` (commit `71f9031`), non in
questa specifica.

### Rischio
Per §0 e l'Appendice B, un agente che legga questo file prima di modificare la
UI troverebbe il codice V2.1 in conflitto con la specifica e potrebbe
"ripristinare" righe di livello e assenza di colori per banda. Va aggiunta in
testa al file una nota di stato che dica quali sezioni sono da riallineare.

### Ramo parallelo
§27 cita `claude/vigilant-hamilton-g1n5rh`: lavoro sul report globale della
classe, fuori dalla V2. Dopo l'unione in `main`, rischia conflitti con il
"Quadro classe" della V2.1. Probabile legame con la specifica v2.6
`[da confermare]`. Va deciso se riallinearlo, archiviarlo o chiuderlo.

### Aperto
- Specifica della **V2.1 rev. 2** (P1–P15, C1–C5, E1–E4, "Decisione A",
  "vincolo 7"): non letta; probabilmente nel README o in una richiesta.
- Nota di stato in testa a `VISUAL_GRAMMAR_V2_IMPLEMENTAZIONE.md` e riallineamento
  delle sezioni 1, 4, 5, 7, 12, 16, 17 e R-4.
- Corrispondenza tra la numerazione dei test e quella consolidata.
- Esito di `git diff --stat main visual-grammar-v2` e `git log --all -- .env`.
- Immutabilità mancanti e regola dell'anno attivo (CHECKPOINT 009).
- Decisioni pedagogiche del CHECKPOINT 002 e D2, D4, D6, D5 (004).
- Sorte del ramo `claude/vigilant-hamilton-g1n5rh`.

### Prossimo passo
1. Aggiungere la nota di stato alla specifica V2 e fornire la V2.1 rev. 2.
2. Aprire un ramo nuovo da `main` per immutabilità e regola dell'anno attivo.
3. Decidere sul ramo parallelo.
