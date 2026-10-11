## CHECKPOINT 004 — Specifica dei report v2.6 e decisioni D1–D11 (11/10/2026)

**Riferimento al piano:** Prompt 2.6 (`SPECIFICA_REPORT_PEDAGOGICI_v2.6.md`).

**Ramo e commit:** `visual-grammar-v2`, HEAD `459613a` al momento della
scrittura; i commit di documentazione che aggiungono questa voce seguono.
Esito di `npm test` e dei test E2E a quel commit: da annotare.

**Natura di questa voce:** registra `SPECIFICA_REPORT_PEDAGOGICI_v2.6.md`
(3/10/2026, "Prompt 2.6") e come si rapporta al codice del ramo. Non è
un'iterazione di sviluppo.

### Cos'è questo documento e cosa non è
- È la specifica matematica dei report **prima della V2**: formule per
  criterio, nucleo, studente e classe, scale, attività disattivate,
  co-docenza, lista studenti, dataset calcolati a mano e le decisioni D1–D11.
  Riferimenti di commit: `main` `64aa558`, pre-multitenant `bfbb386`,
  "checkpoint multitenant" `5f7515e`.
- **Non è il documento citato dai test del ramo.** Qui §7 è la co-docenza e §8
  la lista studenti; nei test §7 è la certezza e §8 la criticità. Mancano
  inoltre i riferimenti P1–P14, C1–C5, E1–E4, §17, §29.12, sez. 28/38/39,
  "Decisione A" e "vincolo 7". La specifica con i passi e le fasi della V2 non
  è ancora tra i documenti.
- Il suo stato dichiara "in attesa delle decisioni D1–D11, nessun codice
  modificato": è fermo al 3/10 e non riflette più il codice.

### Cosa i test confermano
Coerenti con la specifica: finestra di 3 osservazioni, complessivo dello
studente = media dei criteri valutati, classe rappresentativa con più del 50%
di studenti valutati, confronto criterio↔nucleo con almeno 6 confrontabili e
2/3 concordi, co-docenza per Teaching, attività disattivate escluse con storico
conservato, "non valutato" mai 0. Il dataset 1 (criterio NUM-1: 83,33%
DISTINTO, cumulativo 62,5% DISCRETO) coincide con il test U1.

### Chiusa una domanda aperta
- **Ordine delle osservazioni per "le ultime 3":** data osservazione, poi data
  attività, poi id attività `[CONCORDATO]` (§2.A). Risponde alla domanda posta
  nel CHECKPOINT 002 su quale data usare.

### Stato di D1–D11, desunto dai nomi dei test `[da confermare]`
| ID | Esito desunto | Base |
|---|---|---|
| D1 | Valore/massimo anche sull'asse: il minimo di una scala 1–4 vale 25%. Non la posizione normalizzata | test U6, E2 |
| D2 | Non desumibile | — |
| D3 | I pari contano al denominatore | test U11 |
| D4 | Non desumibile | — |
| D5 | Storico conservato con il motivo distinto; la sezione "Criteri non più attivi" non desumibile | test report V2 |
| D6 | Non desumibile; esiste la matrice alunni × nuclei (P12) | — |
| D7, D8, D11 | Superate: il radar è stato rimosso (`d616d46`), il disco usa `geometria.js` | test V1 rimossa, geometria |
| D9 | Superata da criticità, allineato e difficoltà generalizzata | test Semantica |
| D10 | In parte: copertura indicativa/provvisoria/consolidata; certezza assente/parziale/sufficiente | test U2 |

### Discrepanza da sistemare: arrotondamento
La specifica dichiara "arrotondamento a 2 decimali solo per mostrare" e i suoi
dataset sono arrotondati. Il codice applica la Regola B: **troncamento** alla
precisione semantica. Alcuni valori della specifica differiscono quindi di
0,01 da quelli mostrati: 54,17 → 54,16; 42,86 → 42,85; 58,13 → 58,12. Prima di
usare i dataset della specifica come riferimento per le cifre vanno riletti
con la Regola B.

### Aperto
- Specifica con passi, fasi e riferimenti §/P/C/E: ancora da mettere in `doc/`.
- D2, D4, D6 e il dettaglio di D5: chiedere a chi ha deciso.
- Passi 1–2 e fase A: non chiariti da questo documento.

### Prossimo passo
1. Prima del commit, aggiungere in testa alla specifica una riga di stato
   (in parte superata dalla V2; decisioni in CHECKPOINT 004), così il file non
   dice "in attesa" su funzioni già implementate.
2. Mettere in `doc/` la specifica della V2.
3. Rileggere i dataset con la Regola B.
