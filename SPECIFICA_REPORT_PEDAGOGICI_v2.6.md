# Specifica matematica e funzionale dei report pedagogici — Prompt 2.6

**Stato:** specifica chiusa, in attesa delle decisioni D1–D11. Nessun codice modificato.
**Riferimenti:** codice attuale `64aa558` (main), versione pre-multitenant `bfbb386`, checkpoint multitenant `5f7515e`.
**Data:** 2026-10-03.

Ogni regola porta la sua fonte:

- **[CODICE]** comportamento del codice attuale (`64aa558`), verificato;
- **[STORICO]** comportamento di `bfbb386`, verificato;
- **[CONCORDATO]** deciso nella conversazione di progetto;
- **[DECISIONE PROPOSTA]** proposta progettuale, non ancora decisa.

Convenzioni valide ovunque:

- M = massimo della scala, m₀ = minimo della scala;
- calcoli sui valori esatti, arrotondamento a 2 decimali solo per mostrare, giudizio sul valore esatto [CODICE];
- un dato mancante è escluso, mai zero, mai stimato [CONCORDATO].

---

## 2. Specifica matematica

### A. Criterio

| Elemento | Regola | Fonte |
|---|---|---|
| Osservazioni valide | quelle su attività attive del Teaching | CONCORDATO |
| Ordine | data osservazione, poi data attività, poi id attività | CONCORDATO |
| Finestra | ultime k = min(3, n) | CODICE, STORICO |
| Media mobile | m = somma della finestra / k | CODICE |
| Percentuale | R = m / M × 100 | CODICE; vedi sezione 5 |
| Giudizio | prima banda del tenant con soglia ≤ R | CODICE |
| Fuori finestra | restano nello storico, non entrano in R, entrano nel cumulativo | CODICE, STORICO |
| Cumulativo | Cum = somma di tutte / (n × M) × 100 | STORICO; oggi assente |

Comportamento per numero di osservazioni, scala 0–2, soglie di Alfa (90/80/70/60/50/0):

| n | Osservazioni | Finestra | m | R | Cum | Etichetta |
|---|---|---|---|---|---|---|
| 0 | — | — | nullo | nullo | nullo | Non valutato |
| 1 | 1 | 1 | 1,00 | 50% SUFFICIENTE | 50% | indicativo |
| 2 | 2, 0 | 2, 0 | 1,00 | 50% SUFFICIENTE | 50% | provvisorio |
| 3 | 0, 1, 2 | 0, 1, 2 | 1,00 | 50% SUFFICIENTE | 50% | consolidato |
| 4 | 0, 1, 2, 2 | 1, 2, 2 | 1,67 | 83,33% DISTINTO | 62,5% | consolidato |

L'etichetta "provvisorio" sotto le 3 osservazioni è [CONCORDATO]. La distinzione in quattro livelli (0, 1, 2, 3+) è richiesta dal committente; i nomi "indicativo" e "consolidato" sono [DECISIONE PROPOSTA].

### B. Nucleo tematico

- Tutti i criteri hanno peso 1, qualunque sia il numero di osservazioni [CODICE, STORICO, CONCORDATO].
- Entrano solo i criteri attivi con almeno un'osservazione valida [CODICE, CONCORDATO].
- Percentuale: N = media semplice degli R di quei criteri.
- Giudizio: bande applicate a N esatto [CODICE].
- Nessun criterio valutato: N nullo, "Non valutato". Nessun criterio configurato: "griglia non configurata" [CODICE].
- Sempre mostrato "X criteri valutati su Y" [CONCORDATO].
- Cumulativo del nucleo: [DECISIONE PROPOSTA] media semplice dei Cum dei criteri valutati. [STORICO] sommava tutte le osservazioni, quindi pesava per numero di osservazioni.

Esempio: R = 83,33, 50, 50 e un criterio non valutato → N = 61,11% DISCRETO, 3 su 4. Cumulativi 62,5, 50, 50 → proposta 54,17%; storico (5+2+1)/14 = 57,14%.

### C. Studente

Il complessivo **non** aggrega i nuclei: G = media semplice degli R di tutti i criteri valutati della materia [CODICE, STORICO, CONCORDATO].

Esempio: Numeri con R = 83,33, 50, 50; Spazio con R = 50 → G = 233,33 / 4 = 58,33% SUFFICIENTE. La media dei due nuclei darebbe 55,56%.

Il report produce:

- complessivo corrente [CODICE] e cumulativo [STORICO, da ripristinare];
- per ogni nucleo: N, cumulativo, criteri valutati su totali, valore per il radar;
- per ogni criterio: m, R, giudizio, Cum, livello di copertura;
- storico completo, con il segno su quali osservazioni sono nella finestra [CODICE] e quali non sono conteggiate [CONCORDATO].

### D. Classe

Passaggio dalle osservazioni al risultato aggregato [CONCORDATO]:

1. Per ogni studente e criterio si calcola R(s,c), come nel report individuale.
2. Criterio di classe: K(c) = media degli R(s,c) degli studenti con almeno un'osservazione valida.
3. Copertura: studenti valutati / studenti totali.
4. Rappresentativo: studenti valutati > 50% dei totali.
5. Nucleo di classe: media semplice dei K(c) dei criteri rappresentativi.
6. Complessivo di classe: media semplice dei K(c) di tutti i criteri rappresentativi della materia.

Confronto delle strategie:

| Strategia | Vantaggi | Svantaggi e distorsioni |
|---|---|---|
| 1. Media dei risultati individuali (nucleo o complessivo di ogni studente) | semplice; ogni alunno conta uno | uno studente valutato su un solo criterio pesa quanto uno valutato su tutti; non si scompone per criterio, quindi non può dire quali criteri sono deboli |
| 2. Pooling di tutte le osservazioni | usa tutti i dati | pesa di più chi è stato riosservato, spesso chi è in difficoltà; reintroduce osservazioni già fuori finestra; non è "stato corrente" |
| 3. Media dei risultati correnti per criterio, poi media dei criteri | ogni alunno conta uno per criterio; stesso numero del report individuale; ogni valore è la media della riga sotto | un criterio osservato su pochi alunni distorce il nucleo → corretto dalla rappresentatività |
| 4. Media pesata per numero di osservazioni | premia i dati più solidi | pesi arbitrari; non verificabile a mano; nasconde la copertura dentro il numero |

La strategia 3 è già [CONCORDATO] ed è la più coerente col sistema.

Esempio (8 studenti): C1 = 85,42% su 8; C2 = 42,86% su 7; C3 = 79,17% su 8; C4 = 100% su 1, non rappresentativo. Nucleo = (85,42 + 42,86 + 79,17) / 3 = 69,15% DISCRETO. La strategia 1 darebbe 71,18%.

---

## 3. Radar dello studente

- **Assi:** un asse per nucleo attivo della materia, nell'ordine configurato [CONCORDATO].
- **Valore:** il risultato **corrente** del nucleo, senza ricalcolo [CONCORDATO].
- **Corrente o cumulativo:** il corrente. Risponde a "dove è lo studente adesso", ed è il numero che decide il giudizio. Il cumulativo mescola livelli superati.
- **Cumulativo sul radar:** [DECISIONE PROPOSTA] disegnarlo come secondo contorno tratteggiato, così la distanza tra i due mostra il miglioramento o il calo.
- **Normalizzazione:** dipende dalla decisione D1. Proposta: posizione P = (m − m₀) / (M − m₀) × 100, da 0 (minimo della scala) a 100 (massimo), con le soglie delle bande convertite allo stesso modo per disegnare gli anelli.
- **Nucleo senza valutazioni:** asse presente e tratteggiato, dicitura "Non valutato", nessun punto; il poligono non lo attraversa [CONCORDATO].
- **Meno di 3 nuclei:** barre orizzontali [CONCORDATO].

Esempi di posizione:

| Scala | Valori → posizione |
|---|---|
| 0–2 | 0 → 0; 1 → 50; 2 → 100 (coincide con la percentuale) |
| 1–4 | 1 → 0; 2 → 33,33; 3 → 66,67; 4 → 100 |
| 0–4 | 0 → 0; 1 → 25; 2 → 50; 3 → 75; 4 → 100 |

Soglie di Beta (85/70/55) convertite in posizione per gli anelli: 55% → 40; 70% → 60; 85% → 80.

Per non far sembrare equivalenti un nucleo poco osservato e uno ampiamente osservato, [DECISIONE PROPOSTA]:

- punto **pieno** se tutti i criteri del nucleo sono valutati e ciascuno ha almeno 3 osservazioni;
- punto **vuoto**, con i lati del poligono tratteggiati verso quel punto, in ogni altro caso valutato;
- accanto al nome dell'asse sempre "X criteri su Y" e il numero di osservazioni.

Questa regola usa solo "tutti" e la finestra di 3: nessuna soglia nuova.

---

## 4. Punti di forza e debolezza (classe)

**Verifica sul codice:** `judgment_bands` contiene solo soglia minima ed etichetta. Non esiste nello schema né nel codice un'indicazione di quale banda sia "la sufficienza". Una soglia assoluta andrebbe quindi inventata.

**Assoluta o relativa:**

- Una soglia assoluta non distingue "criterio debole" da "nucleo tutto basso"; quest'ultimo si legge già dal giudizio del nucleo.
- Deviazione standard e percentili non sono adatti: circa 20 alunni e una scala a tre livelli danno pochi valori distinti.
- La regola adottata è mista: livello assoluto (bande del tenant) più confronto relativo dentro lo stesso studente.

**Regola [CONCORDATO]**, solo per criteri rappresentativi:

- **Confrontabili** = studenti valutati sul criterio e su almeno un altro criterio rappresentativo del nucleo.
- **Debole:** banda di K(c) inferiore a quella del nucleo, e almeno 2/3 dei confrontabili hanno sul criterio un risultato inferiore alla propria media degli altri criteri.
- **Forte:** simmetrico.
- Con meno di 6 confrontabili nessuna classificazione: il criterio è "nella norma".
- Non rappresentativo → "non sufficientemente osservato"; nessuno studente → "non osservato".

Esempio (dataset 3 in fondo): C2 a 42,86% in un nucleo DISCRETO, 7 inferiori su 7 confrontabili → debole. C1 a 85,42%, 7 superiori su 8 → forte.

Resta aperto solo il trattamento dei pari (D3).

---

## 5. Scale di valutazione

Le opzioni A (valore / massimo) e C (comportamento attuale) coincidono: è ciò che fa il codice oggi. Il confronto reale è tra quella e la B, più una terza via.

| | A/C: valore / massimo | B: (valore − min) / (max − min) | Ibrida: percentuale A + posizione B |
|---|---|---|---|
| Scala 0–2 (Alfa) | 0, 50, 100 | identica | identica |
| Scala 1–4 (Beta) | 25, 50, 75, 100 | 0, 33,33, 66,67, 100 | entrambe |
| Giudizi di Beta (soglie 85/70/55) | "Intermedio" (3) → 75% BUONO | "Intermedio" → 66,67% SUFFICIENTE | invariati |
| Report attività e test esistenti | invariati | cambiano (il test Beta passa da 75% a 66,67%) | invariati |
| Radar | zona interna sotto il 25% mai usata | tutta l'area usata | tutta l'area usata |
| Confronto tra nuclei | corretto: stessa scala nel Teaching | corretto | corretto |
| Confronto tra tenant | non comparabile | comparabile | comparabile sul radar |

- Il confronto tra tenant non è una funzione del prodotto: i tenant sono isolati.
- **[CONCORDATO]** era stato confermato "non normalizzare il minimo a 0" per le percentuali, e poi richiesto il radar normalizzato tra minimo e massimo. Le due richieste sono compatibili solo con la via ibrida. È la decisione D1.

---

## 6. Attività e criteri disattivati

**Cosa determina il codice:**

- Lo stato `disattivata` esiste nello schema, ma nessuna funzione del server o della UI lo imposta.
- L'elenco attività, la griglia, il report attività e il progresso studente non filtrano per stato.
- Il codice quindi **non determina** un comportamento: è una lacuna mai esercitata.
- I criteri disattivati sono già esclusi dalla griglia e dalla struttura del progresso [CODICE]; le loro osservazioni restano nel database.

**Regola [CONCORDATO]:**

- Le attività non attive non entrano in media mobile, criterio, nucleo, complessivo, cumulativo, report di classe.
- Le osservazioni non vengono cancellate; nello storico dello studente sono marcate "non conteggiata".

Esempio: 0, 1, 2, 2 con l'ultima attività disattivata → finestra 0, 1, 2 → 50% invece di 83,33%.

Resta aperta la visibilità dei criteri disattivati (D5).

---

## 7. Co-docenza

| Opzione | Significato pedagogico | RBAC |
|---|---|---|
| A. Per Teaching | "cosa ho osservato io in questa classe" | coincide con lo scope attuale |
| B. Aggregato materia/classe | "come va la classe in Matematica, da tutti i docenti" | Coordinatore e Tenant Admin hanno già `observation.read` sul livello o sul tenant; il Docente no, e vedrebbe osservazioni di un collega |
| C. Entrambi | A per il docente, B per chi coordina | B solo per chi ha già lo scope più ampio |

**[CONCORDATO]:** A, senza unioni automatiche. B resta fuori da questa fase e non richiede decisioni ora: se un giorno servirà, sarà una vista distinta riservata a Coordinatore e Tenant Admin.

---

## 8. Lista studenti

- [STORICO] ogni riga mostrava risultato corrente complessivo, criteri valutati su totali, risultato per nucleo e storico.
- [CODICE] oggi mostra solo cognome e nome (cliccabili verso il report individuale).

[DECISIONE PROPOSTA] ripristinare una sintesi leggera per riga: giudizio e percentuale complessivi, "X criteri valutati su Y", un indicatore di copertura. Niente dettaglio per nucleo: quello sta nel report individuale. La lista resta una vista operativa, ordinata per cognome.

Conseguenza: serve un endpoint che calcoli la sintesi per tutti gli iscritti, con permesso `observation.read`. È una decisione (D6).

---

## 9. Report studente — struttura concettuale

**Immediatamente visibile:**

1. Intestazione: studente, materia, classe, dicitura sul perimetro del Teaching.
2. Risultato complessivo: giudizio, percentuale, criteri valutati su totali; accanto, il cumulativo come dato secondario.
3. Radar dei nuclei (o barre).
4. Sintesi punti di forza e di debolezza.
5. Elenco dei nuclei, **chiusi** [CONCORDATO]: nome, giudizio, percentuale, criteri valutati, copertura.

**Espandibile:**

6. Criteri del nucleo: risultato corrente, cumulativo, livello di copertura.
7. Ultime 3 osservazioni, evidenziate.
8. Storico completo, con le osservazioni non conteggiate in grigio.

Il cumulativo non è una sezione in fondo: sta accanto a ogni risultato corrente, con etichetta distinta.

La sintesi del punto 4 richiede una regola per il singolo studente, che non esiste né nel codice né negli accordi. [DECISIONE PROPOSTA]: un nucleo è punto di forza se il suo giudizio è in una banda superiore a quella del complessivo, punto di debolezza se inferiore. Con punto vuoto sul radar porta l'etichetta "provvisorio".

Codifica cromatica dei giudizi [CONCORDATO]: accessibile e mai basata solo sul colore (sempre etichetta testuale e simbolo).

---

## 10. Report globale classe — struttura e dati dell'API

**Struttura:**

- Intestazione: classe, materia, risultato complessivo, numero di studenti.
- Una sezione per nucleo: giudizio e percentuale, copertura, numero di osservazioni.
- Dentro ogni nucleo, quattro gruppi: punti di forza, attenzione, nella norma, osservazioni insufficienti (poco osservati e non osservati).
- Nota richiudibile "Come leggere questo report", senza formule [CONCORDATO].
- Nessuna riga per alunno [CONCORDATO].

**Dati che l'API deve restituire**, perché la UI non calcoli nulla:

- per nucleo: percentuale, giudizio, livello della banda, criteri rappresentativi su totali, copertura in studenti, osservazioni totali;
- per criterio:
  - percentuale, giudizio, livello della banda;
  - copertura: studenti valutati, totali, consolidati;
  - osservazioni totali e flag rappresentativo;
  - **stato già calcolato**;
  - conteggi del confronto: confrontabili, inferiori, superiori, pari;
  - distribuzione degli studenti per banda;
- bande, scala, parametri della regola.

La UI compone solo la frase ("14 su 18 studenti…") dai conteggi. Nessun identificativo o nome di studente nella risposta.

---

## 11. Decisioni che richiedono approvazione

| ID | Domanda | Opzioni | Raccomandazione | Conseguenza tecnica |
|---|---|---|---|---|
| **D1** | Come si trattano le scale con minimo diverso da 0? | (a) solo valore/massimo; (b) normalizzare tutto; (c) percentuale invariata + posizione per il radar | (c) | (c): un campo `posizione` in più, nessun report esistente cambia. (b): cambiano report attività, giudizi di Beta e un test esistente |
| **D2** | Cumulativo di nucleo e complessivo | (a) media dei cumulativi dei criteri; (b) tutte le osservazioni insieme, come nello storico | (a) | (a) mantiene il peso 1 per criterio; (b) riproduce `bfbb386` ma pesa per osservazioni |
| **D3** | Nei 2/3 dei confrontabili, i pari contano al denominatore? | (a) sì; (b) no | (a), più prudente | Cambia una riga di calcolo e i valori attesi dei test |
| **D4** | Copertura del nucleo nel report di classe | (a) studenti con almeno un'osservazione su almeno un criterio; (b) media delle coperture dei criteri | (a) | Solo il conteggio restituito |
| **D5** | Criteri disattivati con osservazioni nel report studente | (a) sezione chiusa "Criteri non più attivi", senza risultato; (b) non mostrati | (a) | (a) richiede di leggere anche i criteri non attivi che hanno osservazioni |
| **D6** | Sintesi nella lista studenti | (a) sintesi leggera per riga; (b) lista com'è oggi | (a) | (a) richiede un endpoint di sintesi con `observation.read` |
| **D7** | Cumulativo sul radar | (a) secondo contorno tratteggiato; (b) solo corrente | (a) | Solo frontend |
| **D8** | Segnale visivo di affidabilità sul radar | (a) punto pieno/vuoto secondo la regola proposta; (b) solo testo "X su Y" | (a) | Un flag per nucleo nella risposta |
| **D9** | Punti di forza e debolezza dello studente | (a) confronto di banda tra nucleo e complessivo; (b) nessuna sintesi, solo radar | (a) | Uno stato per nucleo nella risposta |
| **D10** | Nomi dei livelli di copertura | "Non valutato / indicativo / provvisorio / consolidato", o altri | questi | Solo testi |
| **D11** | File `public/radar.js` separato | (a) sì; (b) tutto in `index.html` | (a) | Con (b) il radar non è coperto da `npm test` |

---

## 12. Conclusione

- Formule, aggregazioni, radar, report studente e report classe: definiti.
- Scale: definite nelle alternative, lasciate alla decisione D1.
- Attività disattivate, co-docenza, punti forti e deboli: definiti.
- Tutte le ambiguità residue sono in D1–D11.

**SPECIFICA PRONTA PER PROMPT 3: SÌ**, a condizione che siano date le risposte a D1–D11.

---

## Appendice — Dataset di verifica (calcolati a mano)

### Dataset 1 — studente, scala 0–2, soglie Alfa (90/80/70/60/50/0)

| Criterio | Osservazioni | Finestra | R | Cum | Copertura |
|---|---|---|---|---|---|
| NUM-1 | 0, 1, 2, 2 | 1, 2, 2 | 83,33 DISTINTO | 5/8 = 62,5 | consolidato |
| NUM-2 | 2, 0 | 2, 0 | 50 SUFFICIENTE | 2/4 = 50 | provvisorio |
| NUM-3 | 1 | 1 | 50 SUFFICIENTE | 1/2 = 50 | indicativo |
| NUM-4 | — | — | non valutato | — | non valutato |
| SPA-1 | 2, 2, 2, 1, 0 | 2, 1, 0 | 50 SUFFICIENTE | 7/10 = 70 | consolidato |

- Numeri: N = (83,33 + 50 + 50) / 3 = **61,11% DISCRETO**, 3 su 4; cumulativo (proposta D2a) = (62,5 + 50 + 50) / 3 = **54,17%**.
- Spazio e figure: N = **50% SUFFICIENTE**, 1 su 4; cumulativo 70%. Lo studente è in calo: corrente sotto il cumulativo.
- Relazioni, dati e previsioni: non valutato.
- Complessivo: G = (83,33 + 50 + 50 + 50) / 4 = **58,33% SUFFICIENTE**; cumulativo = (62,5 + 50 + 50 + 70) / 4 = **58,13%**.
- Radar: Numeri 61,11; Spazio 50; Relazioni senza punto.
- Variante: ultima attività di NUM-1 disattivata → 0, 1, 2 → R = 50%, Cum = 50%.
- Controllo sul cumulativo "vecchio stile" di Numeri (D2b): (5 + 2 + 1) / 14 = 57,14%, diverso da 54,17% perché NUM-1 peserebbe quattro volte NUM-3.

### Dataset 2 — studente, scala 1–4, soglie Beta (85/70/55/0)

| Criterio | Osservazioni | m | R | Giudizio | Posizione | Cum |
|---|---|---|---|---|---|---|
| A | 2, 4, 3, 4 | 3,67 | 91,67 | ECCELLENTE | 88,89 | 13/16 = 81,25 |
| B | 1 | 1,00 | 25 | INSUFFICIENTE | 0 | 25 |
| C | 2, 3 | 2,50 | 62,5 | SUFFICIENTE | 50 | 5/8 = 62,5 |

- Nucleo: N = (91,67 + 25 + 62,5) / 3 = **59,72% SUFFICIENTE**.
- Posizione del nucleo = (88,89 + 0 + 50) / 3 = **46,30**; calcolata da N dà lo stesso valore.
- Cumulativo del nucleo (D2a) = (81,25 + 25 + 62,5) / 3 = **56,25%**.
- Anelli del radar a 40, 60 e 80.

### Dataset 3 — classe, 8 studenti, soglie Alfa

Valori R(s,c) in percentuale.

| | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | K(c) | Valutati |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 | 100 | 83,33 | 100 | 66,67 | 83,33 | 100 | 66,67 | 83,33 | 85,42 DISTINTO | 8 |
| C2 | 50 | 33,33 | 66,67 | 16,67 | 50 | 50 | 33,33 | — | 42,86 NON SUFFICIENTE | 7 |
| C3 | 83,33 | 66,67 | 100 | 83,33 | 66,67 | 83,33 | 50 | 100 | 79,17 BUONO | 8 |
| C4 | 100 | — | — | — | — | — | — | — | 100 | 1 |

- C4: 1 su 8, non rappresentativo → "non sufficientemente osservato", fuori dal nucleo.
- Nucleo = (85,42 + 42,86 + 79,17) / 3 = **69,15% DISCRETO**; copertura 8 su 8.
- Con C4 incluso il nucleo sarebbe 76,86% (BUONO): un solo alunno sposterebbe il giudizio.

| Criterio | Banda rispetto al nucleo | Inferiori / superiori / pari | Regola (D3a) | Stato |
|---|---|---|---|---|
| C1 | superiore | 1 / 7 / 0, q = 8 | 7×3 = 21 ≥ 8×2 = 16 | **forte** |
| C2 | inferiore | 7 / 0 / 0, q = 7 | 7×3 = 21 ≥ 7×2 = 14 | **debole** |
| C3 | superiore | 0 / 6 / 2, q = 8 | 6×3 = 18 ≥ 8×2 = 16 | **forte** |

Variante di controllo: con soli 5 studenti confrontabili, nessun criterio è forte o debole.
