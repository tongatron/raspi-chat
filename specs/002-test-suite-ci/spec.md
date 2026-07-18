# Feature Specification: Suite di test + Integrazione Continua (CI)

**Feature Branch**: `002-test-suite-ci`

**Created**: 2026-07-18

**Status**: Draft

**Input**: Prima feature post-baseline (v1.1). Il constitution (Principio III)
impone test-first da qui in avanti; la baseline v1.0.0 è senza test né CI. Questa
feature colma il debito minimo: una suite di test automatici sul layer HTTP e un
workflow GitHub Actions che la esegue a ogni push/PR. Obiettivo primario:
trasformare la percezione della repo su GitHub (una repo con test + badge CI verde
legge come "manutenuta"), e creare la rete di sicurezza per le feature successive
(cifratura opzionale, Docker).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Il contributore vede la CI verde su ogni push/PR (Priority: P1)

Chi apre la repo o una pull request vede automaticamente girare i controlli
(`npm run check` + suite di test) e un esito verde/rosso, senza dover eseguire
nulla localmente.

**Why this priority**: È il segnale di qualità a più alto impatto per il pubblico
GitHub e la porta che protegge `main` dalle regressioni.

**Independent Test**: Aprire una PR con una modifica banale e verificare che il
workflow GitHub Actions parta e riporti lo stato dei check.

**Acceptance Scenarios**:

1. **Given** un push su un branch, **When** GitHub Actions esegue il workflow, **Then** gira `npm ci`, `npm run check` e `npm test` e ne riporta l'esito.
2. **Given** un test che fallisce, **When** la CI gira, **Then** il workflow termina con stato rosso.
3. **Given** tutti i controlli passano, **When** la CI gira, **Then** il workflow termina con stato verde.

---

### User Story 2 - Lo sviluppatore verifica il layer HTTP in locale (Priority: P1)

Uno sviluppatore esegue `npm test` e ottiene in pochi secondi la conferma che gli
endpoint operativi e la validazione del login funzionano, senza avviare un server
né toccare dati di produzione.

**Why this priority**: Senza test locali veloci il Principio III (test-first) non è
praticabile. La velocità e l'assenza di effetti collaterali sono ciò che rende i
test davvero usati.

**Independent Test**: Eseguire `npm test` su una checkout pulita e verificare che
la suite passi senza rete esterna e senza scrivere in `data/` file di produzione.

**Acceptance Scenarios**:

1. **Given** la app costruita con `buildApp()`, **When** si interroga `/health`, **Then** risponde 200 con `ok: true`.
2. **Given** la app costruita, **When** si interroga `/version`, **Then** risponde 200 con nome servizio e versione Node.
3. **Given** `POST /chat/login` senza credenziali, **When** viene chiamato, **Then** risponde 400 con errore "Missing credentials".
4. **Given** `POST /chat/login` con credenziali inesistenti, **When** viene chiamato, **Then** risponde 401 con errore "Invalid credentials".

---

### Edge Cases

- **Esecuzione in CI senza `.env` né `config/chat-users.json`**: i test devono
  passare comunque (gli endpoint testati non richiedono utenti configurati).
- **Assenza di `data/`**: la costruzione dell'app non deve fallire per directory
  dati mancante in un ambiente pulito.
- **Nessuna rete esterna disponibile in CI**: i test non devono dipendere da
  chiamate di rete verso servizi esterni.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il progetto MUST includere una suite di test eseguibile con `npm test`, basata sul test runner nativo di Node (`node --test`), senza nuove dipendenze di runtime.
- **FR-002**: I test MUST usare `app.inject()` di Fastify contro `buildApp()`, senza aprire una porta di rete.
- **FR-003**: I test MUST coprire almeno: `/health`, `/version`, e i percorsi di rifiuto di `POST /chat/login` (400 credenziali mancanti, 401 credenziali non valide).
- **FR-004**: I test MUST essere eseguibili in un ambiente pulito privo di `.env` e `config/chat-users.json` e non MUST dipendere da rete esterna.
- **FR-005**: I test NON MUST scrivere né modificare file di dati di produzione (`data/app.db`, `data/chat.db`, `data/uploads/`).
- **FR-006**: Il progetto MUST includere un workflow GitHub Actions che, su `push` e `pull_request`, esegue `npm ci`, `npm run check` e `npm test` su Node 20.
- **FR-007**: Lo script `test` in `package.json` MUST essere aggiornato da placeholder a un comando reale.
- **FR-008**: Il README MUST documentare come eseguire i test.

### Key Entities

- Nessuna nuova entità dati. La feature riguarda tooling e verifica.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `npm test` passa in locale in meno di ~10 secondi su hardware di sviluppo.
- **SC-002**: La CI gira automaticamente su ogni push/PR e riflette correttamente pass/fail.
- **SC-003**: Introdurre volontariamente una regressione in un endpoint testato fa fallire sia `npm test` sia la CI.
- **SC-004**: I test girano senza `.env`/utenti configurati e senza alterare i DB di produzione.

## Assumptions & Dependencies

- **Prerequisito noto per estendere la copertura**: il path di `chat.db` è oggi
  hardcoded in `src/routes/chat.js` (non configurabile via env). Testare il login
  con credenziali **valide** in modo ermetico richiede prima di rendere quel path
  configurabile (es. `CHAT_DB_PATH`). Questa spec **non** lo include: si limita ai
  percorsi che non necessitano di uno store isolato. La configurabilità del path
  DB è tracciata come lavoro separato (candidata alla feature "cifratura at-rest",
  che dovrà comunque toccare l'apertura del DB).
- Si riusa `buildApp()` già esportato da `src/app.js`, senza modifiche al runtime.
- Il runner è `node --test` (Node 20+), nessuna dipendenza di test aggiuntiva.
