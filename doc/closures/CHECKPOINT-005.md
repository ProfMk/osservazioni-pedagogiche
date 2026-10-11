## CHECKPOINT 005 — Commit di documentazione, `npm test` a HEAD e stato dei test E2E (11/10/2026)

**Riferimento al piano:** nessuno (manutenzione del registro e dello stato).

**Ramo e commit:** `visual-grammar-v2`, HEAD `623fada` (anche su `origin`).
Dovrebbe essere 14 commit davanti a `main` (11 + 3 nuovi) `[da confermare]`.

**Esito di `npm test` a `623fada`:** 132 test, 132 passati, 0 falliti,
0 saltati, 29,4 s. Stesso numero e stessi test della verifica precedente: i tre
commit nuovi contengono solo documentazione e `.gitignore`.

**Esito dei test E2E a `623fada`:** non eseguiti in questa sessione, esito non
noto. Comando: `npm run test:e2e`.

**Natura di questa voce:** registra i tre commit nuovi, l'esito dei test e
chiarisce lo stato dei test E2E, verificato sul repository.

### Commit nuovi
| Commit | Messaggio | Contenuto |
|---|---|---|
| `e35327d` | gitignore: strumenti locali di prova (connessione DB e seed) | Esclude `check-db.js`, `run-migration.js`, `run-seed-v2.js`, `seed_v2_serio_multitenant.sql`: restano solo sul computer locale |
| `6b2bfbd` | Documentazione: specifica report pedagogici v2.6 e registro dei checkpoint | `SPECIFICA_REPORT_PEDAGOGICI_v2.6.md` e `doc/closures/CHECKPOINTS.md` |
| `623fada` | checkpoint 4 | Il CHECKPOINT 004 |

### Test E2E: esistono (verificato)
- `tests/e2e.test.js` è tracciato in Git. Creato in `34256bb` (327 righe),
  riscritto in `5e44d0a` (509 righe modificate). Autore dei commit: Claude
  (Claude Code).
- Script in `package.json`: `test:e2e` = `node --test tests/e2e.test.js`;
  `test:all` = `npm test && npm run test:e2e`.
- Dipendenze di sviluppo: `playwright-core` 1.56.1 e `axe-core` 4.13.0.
  `README.md` e `package.json` citano Playwright.
- Contenuto dichiarato dal commit `5e44d0a`: 14 casi sul seed esteso: colori
  0/1/2/null, bande, valutazioni, riferimenti, certezza, criticità,
  mini-dischi, navigazione, tabella, RTL, bianco/nero, axe-core.
- **Non fanno parte di `npm test`**: sono uno script separato. Il risultato
  132/132 non copre quindi il browser, né la verifica di accessibilità con
  axe-core.
- `playwright-core` non include i browser: il test richiede un browser
  disponibile `[da confermare come lo trova]`.

### Comandi di verifica (da annotare nei checkpoint successivi)
| Comando | Cosa esegue |
|---|---|
| `npm test` | unitari, conformità statica, integrazione, lingua, seed, V2.1, geometria (132 test) |
| `npm run test:e2e` | suite da browser (`tests/e2e.test.js`) |
| `npm run test:all` | entrambi |

I test di integrazione hanno come dipendenza di sviluppo PGlite
(`@electric-sql/pglite`, con `tests/support/pglite.js`); su Postgres reale girano
solo con `PGTEST_URL` `[da confermare che questa esecuzione usi PGlite]`.

### Rilevato
- La riga `[errore]` (FK 23503 su `content_translations`, lingua `ar-XB`)
  compare identica anche in questa esecuzione, dentro un test che passa.
  Coerente con un caso negativo atteso, ma `[da confermare]`.
- Tempi dei test lenti, invariati: login 10,7 s, catalogo di piattaforma
  10,6 s, seed esteso 11,7 s, colori delle bande 4,9 s.

### Aperto
- Esito di `npm run test:e2e` a HEAD.
- Esiti delle query di verifica del CHECKPOINT 002 (indici parziali, hashing,
  email duplicate, vincolo circolare, trigger e RLS) e database di origine
  dell'esportazione dello schema.
- Migration su Neon `[da confermare]`.
- D2, D4, D6 e dettaglio di D5 (CHECKPOINT 004).
- Specifica della V2 (con §/P/C/E, passi e fasi) non ancora in `doc/`.
- Passi 1–2 e fase A: dove stanno.
- Riga di stato in testa alla specifica v2.6 `[da confermare se aggiunta]`.
- Dataset della specifica da rileggere con la Regola B (troncamento).
- Unione del ramo in `main`. La knowledge base del progetto si sincronizza con
  `main`, quindi questi checkpoint, che stanno sul ramo, non vi compaiono.

### Prossimo passo
1. Eseguire `npm run test:e2e` e annotare l'esito (poi `npm run test:all`
   come comando unico nei checkpoint).
2. Eseguire le query di sola lettura del CHECKPOINT 002 e riportare gli esiti.
3. Mettere in `doc/` la specifica della V2 e chiudere passi 1–2 e fase A.
4. Decidere sull'unione in `main` e sul ramo da sincronizzare con la knowledge
   base.
