# Feature Specification: Restore consapevole della cifratura (backup/restore + CHAT_DB_KEY)

**Feature Branch**: `005-restore-encrypted-backup`

**Created**: 2026-07-18

**Status**: Implemented

**Input**: Regressione emersa dopo la spec 004. Con `CHAT_DB_KEY` impostata, `chat.db`
su disco è cifrato (SQLCipher): i suoi primi byte **non** sono l'header in chiaro
`SQLite format 3`. L'endpoint di backup `GET /chat/admin/backup` esporta il file
grezzo (quindi cifrato, cosa desiderabile), ma `POST /chat/admin/restore` validava il
file caricato controllando i magic byte `SQLite format 3`. Risultato: **il restore
rifiuta i backup cifrati prodotti dallo stesso sistema** (`Not a valid SQLite
database`), rompendo il ciclo backup→restore appena la cifratura è attiva.

## Decisioni chiave

- **DK-001 — Il backup resta cifrato**: `GET /chat/admin/backup` continua a esportare
  il file `chat.db` così com'è. Se il deployment è cifrato, il backup è cifrato: è la
  proprietà di confidenzialità voluta dalla spec 004. Nessuna modifica al backup.
- **DK-002 — Validazione by-open invece che by-magic-bytes**: `POST /chat/admin/restore`
  non controlla più i primi 16 byte. Scrive il payload in un file temporaneo e prova ad
  **aprirlo davvero** con `openChatDatabase(tmp, CHAT_DB_KEY)`, sondando lo schema chat
  (presenza della tabella `messages`). Se apre e ha lo schema → valido. La logica è
  estratta in `validateRestorePayload(data, key)`, esportata e testabile senza toccare
  l'endpoint (che chiama `process.exit` al termine).
- **DK-003 — Coerenza con la config di cifratura attuale**: il file caricato deve essere
  apribile con la configurazione **corrente**: in chiaro se `CHAT_DB_KEY` è assente,
  cifrato **con quella chiave** se è presente. Un backup cifrato con una chiave diversa,
  o un DB in chiaro caricato su un deployment cifrato, viene rifiutato: sarebbe comunque
  irrecuperabile/incoerente dopo il riavvio. Meglio un 400 chiaro che un DB illeggibile.
- **DK-004 — Pulizia WAL/SHM allo swap**: dopo aver scritto il nuovo `chat.db`, i file
  `chat.db-wal`/`chat.db-shm` del **vecchio** DB vengono rimossi: riferiscono pagine non
  più valide e, alla riapertura, potrebbero corrompere il DB ripristinato.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Restore di un backup cifrato (Priority: P1)

L'operatore ha attivato `CHAT_DB_KEY`, scarica un backup con `GET /chat/admin/backup`
(file cifrato) e più tardi lo ricarica con `POST /chat/admin/restore`. Il restore deve
accettarlo e ripristinare i dati.

**Why this priority**: È la regressione da chiudere. Senza il fix, chi ha seguito la
spec 004 non può più ripristinare i propri backup — la funzione di backup/restore è di
fatto rotta sui deployment cifrati.

**Independent Test**: Costruire i byte di un backup cifrato (DB con tabella `messages`,
cifrato con `KEY`) e verificare che `validateRestorePayload(bytes, KEY)` ritorni
`{ ok: true }`, mentre con chiave errata o assente ritorni `{ ok: false }`.

**Acceptance Scenarios**:

1. **Given** `CHAT_DB_KEY` impostata e un backup cifrato con quella chiave, **When** si valida il payload di restore, **Then** è accettato (`ok: true`).
2. **Given** un backup cifrato, **When** lo si valida con una chiave diversa, **Then** è rifiutato.
3. **Given** un backup cifrato, **When** lo si valida senza chiave, **Then** è rifiutato.
4. **Given** nessuna `CHAT_DB_KEY` e un backup in chiaro, **When** lo si valida, **Then** è accettato (baseline invariata).

### User Story 2 - Rifiuto di file non validi (Priority: P2)

Il restore deve continuare a rifiutare file che non sono un DB chat valido, con errore
chiaro invece di sovrascrivere `chat.db` con spazzatura.

**Acceptance Scenarios**:

1. **Given** un file più piccolo di 1024 byte, **When** lo si valida, **Then** è rifiutato con `Invalid file`.
2. **Given** un buffer non-SQLite, **When** lo si valida, **Then** è rifiutato.
3. **Given** un DB SQLite valido ma privo della tabella `messages`, **When** lo si valida, **Then** è rifiutato con `Not a valid chat database`.

### Edge Cases

- **Backup cifrato con chiave persa/diversa**: rifiutato in fase di validazione (nessuno
  swap del DB). L'operatore deve fornire la chiave corretta.
- **File temporaneo di validazione**: scritto in `os.tmpdir()` con nome random e rimosso
  in ogni caso (`finally`), insieme agli eventuali `-wal`/`-shm`.
- **WAL residui del vecchio DB**: rimossi dopo lo swap per evitare corruzione al riavvio.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `POST /chat/admin/restore` MUST accettare un backup cifrato con la chiave
  `CHAT_DB_KEY` corrente (chiudendo la regressione dei magic byte).
- **FR-002**: Il restore MUST validare il file aprendolo con la configurazione di
  cifratura attuale e verificando lo schema chat (tabella `messages`), non i magic byte.
- **FR-003**: Il restore MUST rifiutare, con errore chiaro, i file non apribili (chiave
  errata/assente, non-SQLite) o privi dello schema chat, senza sovrascrivere `chat.db`.
- **FR-004**: `GET /chat/admin/backup` MUST restare invariato (esporta il file così com'è,
  quindi cifrato se il deployment è cifrato).
- **FR-005**: Dopo lo swap, il restore MUST rimuovere i file `-wal`/`-shm` del vecchio DB.
- **FR-006**: La logica di validazione MUST essere esportata (`validateRestorePayload`) e
  coperta da test unitari senza invocare l'endpoint (che termina il processo).

### Key Entities

- Nessuna nuova entità né modifica di schema. Riusa la tabella `messages` come marcatore
  di "DB chat valido".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un backup cifrato prodotto da `GET /chat/admin/backup` è ri-accettato da
  `POST /chat/admin/restore` sullo stesso deployment (con la stessa chiave).
- **SC-002**: `npm test` include e supera i test di validazione del restore (cifrato
  ok/ko, in chiaro, non-chat, file invalido).
- **SC-003**: Senza `CHAT_DB_KEY`, backup e restore si comportano come nella baseline.

## Assumptions & Dependencies

- Costruisce sulla spec 004 (cifratura at-rest) e 003 (path configurabile).
- La gestione/backup della chiave resta responsabilità dell'operatore: un backup cifrato
  è ripristinabile solo con la sua chiave.
- Fuori scope: cifratura di `DB_PATH` (mail/app) e degli allegati; consistenza del backup
  rispetto al WAL attivo lato sorgente (il backup copia solo il file principale).
