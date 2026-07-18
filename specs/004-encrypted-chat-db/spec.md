# Feature Specification: Cifratura at-rest di chat.db (CHAT_DB_KEY)

**Feature Branch**: `004-encrypted-chat-db`

**Created**: 2026-07-18

**Status**: Implemented

**Input**: Passo successivo previsto dalla spec 003. Oggi `chat.db` (messaggi, utenti,
hash password, inviti, subscription push) è un file SQLite **in chiaro** su disco:
chiunque acceda al filesystem del Raspberry (backup, furto della SD, accesso ospite)
può leggerlo con `sqlite3`. Questa feature cifra l'intero file a riposo, in modo
trasparente per l'applicazione, mantenendo il default invariato per chi non imposta
una chiave.

## Decisioni chiave (da approvare)

- **DK-001 — Motore**: sostituire la dipendenza `better-sqlite3` con il drop-in
  `better-sqlite3-multiple-ciphers`. API identica (stesso `new Database(...)`,
  `.prepare`, `.pragma`, transazioni); aggiunge il supporto a `PRAGMA key`. Nessuna
  riscrittura delle 30+ query esistenti.
- **DK-002 — Chiave**: la chiave arriva da `process.env.CHAT_DB_KEY`.
  - Se **presente**: il DB viene aperto/creato cifrato (`PRAGMA key`).
  - Se **assente**: comportamento storico (DB in chiaro). Nessun breaking change per
    il deploy attuale; la cifratura è **opt-in** finché l'operatore non genera e
    imposta la chiave. Coerente col Principio "default di produzione invariato".
- **DK-003 — Migrazione dati esistenti**: script one-shot `ops/encrypt-db.js` che
  converte il `data/chat.db` in chiaro già presente sul Pi in un file cifrato,
  **previo backup automatico** (`chat.db.plain.bak`), usando `sqlcipher_export` /
  `PRAGMA rekey`. Idempotente e reversibile finché il backup esiste.
- **DK-004 — Cifratura DB della mail/app (`DB_PATH`)**: **fuori scope**. Questa spec
  copre solo `chat.db`. Eventuale estensione in una spec successiva.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chat cifrata a riposo (Priority: P1)

L'operatore imposta `CHAT_DB_KEY`; da quel momento il file `chat.db` sul disco non è
più leggibile con un `sqlite3` normale senza la chiave, ma l'app funziona identica.

**Why this priority**: È l'obiettivo della feature — proteggere messaggi e hash
password se il supporto fisico (SD del Raspberry, backup) finisce in mani altrui.

**Independent Test**: Con `CHAT_DB_KEY` impostata, creare l'app su una tempdir,
scrivere un messaggio, chiudere; verificare che (a) aprire il file con la chiave
giusta restituisce i dati, (b) aprirlo senza chiave / con chiave errata fallisce.

**Acceptance Scenarios**:

1. **Given** `CHAT_DB_KEY` impostata, **When** l'app parte e scrive dati, **Then** il file su disco è cifrato (i byte non contengono testo in chiaro dei messaggi).
2. **Given** un DB cifrato, **When** lo si riapre con la stessa chiave, **Then** i dati sono leggibili e integri.
3. **Given** un DB cifrato, **When** lo si apre senza chiave o con chiave errata, **Then** l'operazione fallisce con errore (nessun accesso).
4. **Given** `CHAT_DB_KEY` non impostata, **When** l'app parte, **Then** usa `chat.db` in chiaro come prima (comportamento baseline invariato).

### User Story 2 - Migrazione del DB di produzione esistente (Priority: P2)

L'operatore ha già un `data/chat.db` in chiaro con la cronologia. Esegue lo script di
migrazione una volta per cifrarlo, senza perdere dati.

**Acceptance Scenarios**:

1. **Given** un `chat.db` in chiaro e `CHAT_DB_KEY` impostata, **When** si esegue `node ops/encrypt-db.js`, **Then** viene creato un backup `chat.db.plain.bak` e `chat.db` diventa cifrato con gli stessi dati.
2. **Given** un `chat.db` già cifrato, **When** si riesegue lo script, **Then** rileva lo stato e non corrompe nulla (idempotente).

### Edge Cases

- **Chiave impostata su DB già in chiaro senza migrazione**: all'avvio l'apertura con
  `PRAGMA key` fallisce → l'app logga un errore chiaro che rimanda a `ops/encrypt-db.js`.
- **Chiave persa**: i dati cifrati sono irrecuperabili by design. La documentazione
  DEVE avvertire di conservare `CHAT_DB_KEY` nel gestore segreti / backup (come la
  keystore Android già gestita).
- **File WAL/SHM**: la modalità WAL resta attiva; il motore cifra anche i file
  ausiliari. La migrazione DEVE agire a DB chiuso (nessun processo che scrive).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema MUST aprire `chat.db` con `PRAGMA key` quando `CHAT_DB_KEY` è impostata, altrimenti in chiaro (fallback baseline).
- **FR-002**: Con chiave impostata, i dati scritti su `chat.db` MUST risultare cifrati su disco (non leggibili senza chiave).
- **FR-003**: Il comportamento senza `CHAT_DB_KEY` MUST restare identico alla baseline (nessun impatto sul deploy attuale).
- **FR-004**: MUST esistere uno script `ops/encrypt-db.js` che migra un `chat.db` in chiaro esistente a cifrato, creando un backup prima della conversione.
- **FR-005**: La suite di test MUST verificare: apertura/lettura con chiave corretta, fallimento con chiave errata/assente, e il fallback in chiaro.
- **FR-006**: `.env.example` e il README MUST documentare `CHAT_DB_KEY`, come generarla e l'avviso sulla perdita della chiave.

### Key Entities

- Nessuna nuova entità né modifica di schema. Cambia solo il livello di storage
  (file cifrato vs. in chiaro) delle tabelle esistenti (`users`, `messages`,
  `rooms`, `invites`, `push_subscriptions`, ...).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Con `CHAT_DB_KEY` impostata, un `grep` del testo di un messaggio nel file `chat.db` non trova corrispondenze in chiaro.
- **SC-002**: `npm test` include e supera i test di cifratura (lettura con chiave, fallimento senza).
- **SC-003**: In assenza di `CHAT_DB_KEY`, l'app e la suite si comportano come nella baseline.
- **SC-004**: La migrazione converte un DB reale preservando conteggio utenti e messaggi (verifica prima/dopo).

## Assumptions & Dependencies

- Costruisce sulla spec 003 (path configurabile) e 002 (suite di test).
- Nuova dipendenza runtime: `better-sqlite3-multiple-ciphers` (sostituisce
  `better-sqlite3`; richiede rebuild nativo su Raspberry, come l'attuale).
- La gestione/backup della chiave è responsabilità dell'operatore.
- Fuori scope: cifratura di `DB_PATH` (mail/app) e degli allegati in `data/uploads/`.
