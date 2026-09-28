# Dati di prova dei test di integrazione

I test di integrazione (`tests/integration.test.js`) lavorano su un database
costruito, in quest'ordine, da:

1. `migrations/000_schema_base.sql`: le 13 tabelle originali;
2. `migrations/001_vincoli_osservazioni.sql`: i vincoli richiesti dall'applicazione;
3. `seed/dati_esempio_matematica.sql`: dati minimi di esempio;
4. `tests/dati_di_prova.sql`: le osservazioni in più usate dai test.

**Non eseguire mai questi file su Neon**: sono dati di prova, non dati reali.

## Due modi di eseguire i test

### 1. Senza installare nulla (predefinito)

```bash
npm install
npm test
```

Senza `PGTEST_URL`, i test usano **PGlite**, cioè PostgreSQL compilato in
WebAssembly, in memoria (`tests/support/pglite.js`). Il database viene
ricreato da zero dai quattro file sopra a ogni esecuzione, quindi i
risultati sono riproducibili.

In questa modalità **un solo test viene saltato**, e lo dichiara: il
*Caso I* (due transazioni concorrenti). PGlite ha una sola sessione e non
può simulare la concorrenza.

### 2. Su un PostgreSQL reale (per il Caso I)

```bash
createdb osservazioni_test
psql -d osservazioni_test \
  -f migrations/000_schema_base.sql \
  -f migrations/001_vincoli_osservazioni.sql \
  -f seed/dati_esempio_matematica.sql \
  -f tests/dati_di_prova.sql
PGTEST_URL="postgres://utente@localhost:5432/osservazioni_test" npm test
```

Ogni test lavora in una transazione annullata alla fine. Fa eccezione il
Caso I, che deve fare COMMIT e poi rimuove la riga che ha creato. Per
sicurezza, i test si rifiutano di partire se `PGTEST_URL` punta a Neon.

Per eseguire anche il test di regressione sulla migration 001, imposta
`PGTEST_URL_SENZA_MIGRATION` su un secondo database creato solo con
`000_schema_base.sql`. Con PGlite questo database viene creato automaticamente.

## Contenuto

| Dato | Valore |
|---|---|
| Docente | persona 1 (Mario Docente) |
| Docente "estraneo" (nessun insegnamento) | persona 4 |
| Insegnamento 1 | docente 1 · Matematica · 3A · 2025/2026 |
| Iscrizione 1 | Anna (persona 2), 3A |
| Iscrizione 2 | Luca (persona 3), 3A |
| Iscrizione 3 | Sara (persona 4), **3B**: altra classe, per i controlli di coerenza |
| Nuclei | 1 Numeri (criteri 1–6), 2 Spazio e figure (7–12), 3 Relazioni, dati e previsioni (13–18) |
| Attività 1 | "Addizioni e sottrazioni", 01/10/2025, nucleo 1 |
| Attività 2 | "Moltiplicazioni", 08/10/2025, nucleo 1 |

| Osservazione | Alunno | Attività | Valutazioni | Origine |
|---|---|---|---|---|
| 1 | Anna | 1 | criteri 1–6: 0, 2, 1, 1, 2, 2 | seed |
| 2 | Luca | 1 | criterio 1: 2 (gli altri non valutati) | `dati_di_prova.sql` |
| 3 | Anna | 2 | criterio 1: 1 | `dati_di_prova.sql` |

I test su "Studenti della classe" e sul risultato corrente creano i propri
dati (studenti, attività, un secondo docente, una seconda materia) dentro la
transazione di prova, quindi non dipendono da questa tabella.
