## CHECKPOINT 008 — Le quattro migration e cosa applicano (11/10/2026)

**Riferimento al piano:** nessuno (verifica dello stato; chiude punti dei CHECKPOINT 000 e 007).

**Ramo e commit:** `visual-grammar-v2`, HEAD `dfa4e38` (anche su `origin`).
Nessun codice è cambiato dopo `623fada`: gli ultimi esiti noti restano
`npm test` 132/132 e `npm run test:e2e` 14/14 (CHECKPOINT 006).

**Natura di questa voce:** lettura dei file `migrations/000`–`003` e confronto
con lo schema reale di Neon (CHECKPOINT 007).

### Le migration
| File | Cosa fa | Rieseguibile? | Su Neon |
|---|---|---|---|
| `000_schema_base.sql` | Schema base multi-tenant e multi-utente; **sostituisce integralmente** lo schema del prototipo (dichiara che non c'erano dati reali da migrare). Contiene l'unico trigger (`trg_teaching_struttura_immutabile`) | No: `CREATE TABLE` senza `IF NOT EXISTS` | Applicata, per effetto (30 tabelle, trigger presente) |
| `001_ruoli_permessi_sistema.sql` | Dati di sistema: 4 ruoli (PLATFORM_ADMIN, TENANT_ADMIN, COORDINATOR, TEACHER), 17 permessi, 43 assegnazioni ruolo–permesso (17 + 12 + 6 + 8) | No: `INSERT` senza `ON CONFLICT`; una seconda esecuzione fallisce sui vincoli univoci, non duplica | **Da verificare:** conteggi attesi 4 / 17 / 43 |
| `002_audit_append_only.sql` | Crea `audit_owner` e `app_role`; sposta `audit_log` a `audit_owner`; a `app_role` concede solo INSERT e SELECT su `audit_log` e CRUD sulle altre tabelle esistenti | Sì (dichiarata) | Applicata, per effetto (UPDATE e DELETE su `audit_log` negati) |
| `003_lingua_contenuti_v2.sql` | Lingue, impostazioni di piattaforma, lingue per tenant, catalogo, traduzioni, lingua dei contenuti d'autore | No. Contiene un `UPDATE tenants` **senza `WHERE`** che porta tutti i tenant a `it`/`IT` | Applicata, per effetto (tabelle e vincolo differibile presenti) |

Nessuna tabella registra quali migration sono state eseguite (CHECKPOINT 007).
La 003 è sicura solo se eseguita una volta, o in una singola transazione che si
ferma al primo errore `[da confermare come lavora run-migration.js]`.

### Correzioni alle voci precedenti
- **CHECKPOINT 000, "Aperto":** "migration 001 mai eseguita su Neon" riguardava
  `001_vincoli_osservazioni.sql`, file del vecchio schema mono-tenant,
  sostituito dalla `000_schema_base.sql`. Non è più un punto aperto. L'attuale
  001 è un'altra cosa (ruoli e permessi).
- **CHECKPOINT 007, rilievo 3:** ora si sa cosa fanno le migration (tabella
  sopra). Resta aperta solo la verifica dei dati della 001.
- **CHECKPOINT 002, "Limiti dell'esportazione":** oltre ai tre indici, l'export
  ha perso altri predicati e un ordinamento: `idx_enrollments_class_year`
  (`WHERE attiva`), `idx_role_assignments_*` (`WHERE revoked_at IS NULL` e
  `IS NOT NULL`) e `idx_judgment_bands_lookup` (`soglia_minima DESC`).
- La 000 dichiara che all'epoca non esistevano dati reali su Neon. Gli 8 account
  attuali sono `[da confermare se di prova]`.

### Due numerazioni di specifica
Le migration citano **"sez. N"** per l'architettura multi-tenant (sez. 6, 7, 9,
10/11, 15, 16, 19–34, 41); la 003 cita **"V2 §28"** e C2, B-1…B-7, P3 per la
V2. I test usano entrambe: "sez. 28/38/39" nei test del database, "§7, §8, §17,
§29.12" in quelli dei report. Verosimilmente sono **due specifiche distinte**
(architettura multi-tenant e Visual Grammar V2) e nessuna è in `doc/`
`[da confermare]`. Il punto aperto "specifica della V2 in `doc/`" diventa:
**due documenti da mettere in `doc/`**.

### Rilievi nuovi
1. **`app_role` può scrivere ruoli e permessi.** Ha CRUD su tutte le tabelle
   tranne `audit_log`, comprese `roles`, `permissions`, `role_permissions`:
   dati di sistema che scrive solo la 001. Per il minimo privilegio basterebbe
   SELECT su queste tre. Prima di revocare va verificato che nessun codice o
   seed le scriva `[decisione tecnica]`.
2. **Ogni tabella nuova richiede un GRANT esplicito.** La 002 copre solo le
   tabelle esistenti e la 003 lo ripete a mano. I privilegi di default per
   `app_role` lo renderebbero automatico. Il rischio, finché resta manuale, è una
   migration futura che lo dimentica: l'applicazione fallirebbe a runtime.
3. **`SET ROLE app_role` è reversibile con `RESET ROLE`.** La protezione regge
   finché ogni query è parametrizzata (un solo statement). Verificare che
   nessuna query concateni testo.
4. **Nessuna RLS** (CHECKPOINT 007, rilievo 1): confermato che il confine di
   sicurezza è `app_role` e non esistono policy per tenant.

### Decisioni da registrare (tecniche)
- Ridurre i privilegi di `app_role` su ruoli e permessi (rilievo 1).
- Privilegi di default per le tabelle future (rilievo 2).
- Adottare RLS e un registro delle migration (CHECKPOINT 007).

### Aperto
- Conteggi dei dati della 001 su Neon e proprietario di `audit_log`
  (controlli 7–9 dello script `verifica-schema.js`, aggiornato).
- `.env`: non risulta ancora l'esito di `git check-ignore -v .env` e
  `git log --all --oneline -- .env`.
- Le cinque decisioni pedagogiche del CHECKPOINT 002 e D2, D4, D6, D5 (004).
- Due specifiche (architettura multi-tenant, V2) non ancora in `doc/`; passi 1–2
  e fase A.
- Riga di stato in testa alla specifica v2.6; dataset da rileggere con la
  Regola B.
- Unione del ramo in `main` e sincronizzazione della knowledge base.

### Prossimo passo
1. Rieseguire `verifica-schema.js` (versione aggiornata) e riportare gli esiti
   dei controlli 7, 8 e 9.
2. Eseguire i due comandi su `.env`.
3. Decidere su privilegi di `app_role`, privilegi di default, RLS e registro
   delle migration.
4. Mettere in `doc/` le due specifiche.
