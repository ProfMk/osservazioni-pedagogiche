## CHECKPOINT 006 — Prima verifica completa: unitari, integrazione ed E2E (11/10/2026)

**Riferimento al piano:** nessuno (manutenzione dello stato).

**Ramo e commit:** `visual-grammar-v2`, HEAD `fea8c5b` (anche su `origin`).
Dovrebbe essere 15 commit davanti a `main` `[da confermare con
git rev-list --count origin/main..HEAD]`.

**Esito dei test:**
| Suite | Comando | Risultato | Durata | Commit |
|---|---|---|---|---|
| Unitari, conformità, integrazione | `npm test` | 132 test, 132 passati, 0 falliti | 29,4 s | `623fada` |
| Browser (E2E) | `npm run test:e2e` | 14 test, 14 passati, 0 falliti | 22,3 s | `fea8c5b` |

I tre commit tra `623fada` e `fea8c5b` contengono solo documentazione, quindi
l'esito di `npm test` vale anche per `fea8c5b`. I due comandi sono stati
lanciati separatamente; `npm run test:all` non è stato eseguito come comando
unico.

**Natura di questa voce:** è la prima fotografia in cui tutte le suite sono
verdi. Chiude il punto aperto sul browser dei CHECKPOINT 003 e 005.

### Test E2E
- Prima esecuzione fallita per un motivo ambientale, non del codice: il browser
  di Playwright non era installato (`Executable doesn't exist ...
  chromium_headless_shell-1194`). I 14 casi fallivano in pochi millisecondi
  perché si fermavano al lancio di Chromium.
- Dopo l'installazione di Chromium con `npx playwright-core install chromium`
  `[da confermare il comando usato]`, tutti i casi passano.
- **Requisito per ogni nuovo computer o integrazione continua:** installare
  Chromium una volta (si scarica nella cache `ms-playwright` dell'utente),
  altrimenti gli E2E falliscono come nella prima esecuzione. Non è scritto nel
  README `[da confermare]`.
- I 14 casi coprono: schermata di accesso senza testi nel guscio; tutte le viste
  con il disco, senza testi mancanti, errori, andamento o violazioni di
  accessibilità (axe-core); colori 0/1/2/null; geometria del disco; riferimenti
  (classe, storico, certezza parziale); criticità; valutazione del docente;
  confronto nel profilo; mini-dischi; navigazione a pila; tabella alternativa;
  RTL; testo mancante segnalato dal marcatore; bianco e nero.
- Quindi **accessibilità, RTL e bianco/nero hanno un controllo automatico** e
  oggi passano.

### Rilevato
- La riga `[errore]` (FK 23503 su `content_translations`, lingua `ar-XB`) è
  presente in ogni esecuzione di `npm test`, dentro un test che passa. Coerente
  con un caso negativo atteso `[da confermare]`.
- Test lenti, invariati: login 10,7 s, catalogo di piattaforma 10,6 s, seed
  esteso 11,7 s, colori delle bande 4,9 s.

### Aperto
- Esiti delle query di verifica del CHECKPOINT 002 (indici parziali, hashing,
  email duplicate, vincolo circolare, trigger e RLS) e database di origine
  dell'esportazione dello schema.
- Migration su Neon `[da confermare]`.
- D2, D4, D6 e dettaglio di D5 (CHECKPOINT 004).
- Specifica della V2 (con §/P/C/E, passi e fasi) non ancora in `doc/`.
- Passi 1–2 e fase A: dove stanno.
- Riga di stato in testa alla specifica v2.6 `[da confermare se aggiunta]`.
- Dataset della specifica da rileggere con la Regola B (troncamento).
- Prerequisito degli E2E non documentato nel README.
- Unione del ramo in `main`. La knowledge base del progetto si sincronizza con
  `main`, quindi i checkpoint sul ramo non vi compaiono.

### Prossimo passo
1. Eseguire le query di sola lettura del CHECKPOINT 002 e riportare gli esiti:
   sono l'ultima verifica prima di usare dati reali.
2. Mettere in `doc/` la specifica della V2 e chiudere passi 1–2 e fase A.
3. Aggiungere al README il comando di installazione di Chromium per gli E2E.
4. Decidere sull'unione in `main` e sul ramo da sincronizzare con la knowledge
   base.
5. Da ora citare nei checkpoint l'esito di `npm run test:all`.
