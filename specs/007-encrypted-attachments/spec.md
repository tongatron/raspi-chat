# Feature Specification: Cifratura at-rest degli allegati (data/uploads/, riusa CHAT_DB_KEY)

**Feature Branch**: `007-encrypted-attachments`

**Created**: 2026-07-18

**Status**: Implemented

**Input**: Estensione naturale del filone crittografico delle spec 004/005, dove la
cifratura di `data/uploads/` era esplicitamente **fuori scope**. Oggi i file caricati in
chat (immagini, video, audio, PDF, documenti) sono salvati **in chiaro** in
`data/uploads/`: chiunque acceda al filesystem del Raspberry (backup, furto della SD,
accesso ospite) può aprirli. A differenza di `DB_PATH` (che contiene solo la tabella demo
`items`), gli allegati sono **dati utente reali**. Questa spec li cifra a riposo riusando
la stessa chiave `CHAT_DB_KEY` già introdotta per `chat.db` (spec 004), mantenendo il
default invariato per chi non imposta la chiave.

## Decisioni chiave

- **DK-001 — Chiave riusata (`CHAT_DB_KEY`)**: nessuna nuova variabile. Se `CHAT_DB_KEY`
  è **presente**, gli allegati vengono cifrati/decifrati; se **assente**, restano in
  chiaro (baseline invariata, opt-in). Un'unica chiave da conservare per chat.db +
  allegati, coerente col principio "default di produzione invariato".
- **DK-002 — AES-256-GCM per file**: chiave a 32 byte derivata da `SHA-256(CHAT_DB_KEY)`
  (normalizza qualsiasi formato di chiave); IV random di 12 byte per file; authTag di 16
  byte. Formato su disco: `MAGIC(6) || IV(12) || TAG(16) || ciphertext`. GCM garantisce
  riservatezza **e** integrità (una decifratura con chiave errata o file manomesso
  fallisce).
- **DK-003 — Passthrough retrocompatibile**: un file **senza** il MAGIC (allegato in
  chiaro caricato prima dell'attivazione) viene servito tal quale anche con la chiave
  attiva. Attivare `CHAT_DB_KEY` **non rompe** gli allegati storici; la migrazione è
  opzionale.
- **DK-004 — Due soli punti toccati**: scrittura in `POST /chat/upload`, lettura in
  `GET /chat/images/:filename`. Nessun altro percorso serve i file di `data/uploads/`
  (i background in `public/backgrounds/` sono asset statici, fuori scope).
- **DK-005 — Modulo isolato e testabile**: la crittografia vive in
  `src/attachment-crypto.js` (`encryptBuffer`/`decryptBuffer`/`isEncrypted`), esportato e
  coperto da test unitari senza passare dall'HTTP.
- **DK-006 — Migrazione opzionale**: script `ops/encrypt-uploads.js` cifra in-place i file
  in chiaro esistenti, idempotente e con backup, sulla falsariga di `ops/encrypt-db.js`
  (spec 004).
- **DK-007 — Buffering in RAM**: il percorso cifrato bufferizza il file in memoria fino a
  `UPLOAD_MAX_BYTES` (50 MB) invece di fare streaming, perché il tag GCM si verifica a
  fine file. Accettabile per gli upload occasionali del caso d'uso domestico; il percorso
  in chiaro (senza chiave) resta streaming come oggi.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Allegati cifrati a riposo (Priority: P1)

L'operatore ha impostato `CHAT_DB_KEY`. Da quel momento i file caricati in chat non sono
più leggibili aprendo direttamente `data/uploads/` senza la chiave, ma in chat si vedono e
si scaricano identici a prima.

**Why this priority**: È l'obiettivo della feature — proteggere i contenuti caricati
(foto, documenti) se il supporto fisico (SD del Raspberry, backup) finisce in mani altrui.

**Independent Test**: `encryptBuffer(plain, KEY)` produce byte che iniziano col MAGIC e non
contengono il contenuto in chiaro; `decryptBuffer(enc, KEY)` restituisce l'originale
byte-identico; con chiave errata `decryptBuffer` lancia.

**Acceptance Scenarios**:

1. **Given** `CHAT_DB_KEY` impostata, **When** un utente carica un file, **Then** il file su disco è cifrato (i byte originali non vi compaiono).
2. **Given** un allegato cifrato, **When** viene richiesto via `GET /chat/images/:filename`, **Then** l'app lo decifra al volo e lo serve identico all'originale, con lo stesso mime e Content-Disposition.
3. **Given** un allegato cifrato, **When** si tenta di decifrarlo con chiave errata o dopo manomissione, **Then** l'operazione fallisce (autenticazione GCM) e non viene servito contenuto corrotto.
4. **Given** `CHAT_DB_KEY` non impostata, **When** un utente carica/scarica un file, **Then** il comportamento è identico alla baseline (in chiaro, streaming).

### User Story 2 - Attivazione senza rompere gli allegati esistenti (Priority: P2)

L'operatore attiva la chiave su un deployment che ha già allegati in chiaro. Quelli
vecchi devono continuare a funzionare; i nuovi nascono cifrati.

**Acceptance Scenarios**:

1. **Given** un allegato in chiaro preesistente e `CHAT_DB_KEY` ora impostata, **When** lo si richiede, **Then** viene servito correttamente (passthrough, nessun MAGIC → nessuna decifratura).
2. **Given** allegati in chiaro esistenti, **When** si esegue `node ops/encrypt-uploads.js`, **Then** vengono cifrati in-place (idempotente, con backup) senza perdere dati.

### Edge Cases

- **Chiave persa**: gli allegati cifrati sono irrecuperabili by design (come `chat.db`).
  La documentazione DEVE ribadire di conservare `CHAT_DB_KEY`.
- **File > 50 MB**: il limite `UPLOAD_MAX_BYTES` resta invariato; l'upload oltre soglia è
  rifiutato con 413 come oggi, anche nel percorso cifrato.
- **Chiave rimossa dopo aver cifrato**: un file cifrato servito senza chiave verrebbe
  inviato così com'è (illeggibile). Scenario "chiave persa", accettato.
- **Background in `public/backgrounds/`**: asset statici applicativi, non dati utente:
  fuori scope, restano in chiaro.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Con `CHAT_DB_KEY` impostata, i nuovi allegati MUST essere scritti cifrati
  (AES-256-GCM, IV random per file) in `data/uploads/`.
- **FR-002**: `GET /chat/images/:filename` MUST decifrare al volo e servire il contenuto
  originale (mime e Content-Disposition invariati) quando la chiave è impostata.
- **FR-003**: Senza `CHAT_DB_KEY` il comportamento di upload e serve MUST restare identico
  alla baseline (in chiaro, streaming): nessun impatto sul deploy attuale.
- **FR-004**: I file in chiaro preesistenti (senza header di cifratura) MUST continuare a
  essere serviti correttamente anche con la chiave attiva (passthrough).
- **FR-005**: Una decifratura con chiave errata o file manomesso MUST fallire senza
  servire dati corrotti (integrità garantita dal tag GCM).
- **FR-006**: La logica di cifratura MUST vivere in un modulo isolato ed esportato
  (`src/attachment-crypto.js`) coperto da test: round-trip, chiave errata, rilevamento
  header, passthrough in chiaro.
- **FR-007**: MUST esistere uno script `ops/encrypt-uploads.js` che cifra gli allegati in
  chiaro esistenti, idempotente e con backup.
- **FR-008**: `.env.example` e il README MUST documentare che `CHAT_DB_KEY` copre anche gli
  allegati in `data/uploads/`.

### Key Entities

- **Allegato cifrato**: file in `data/uploads/` con layout `MAGIC || IV || TAG ||
  ciphertext`. Nessuna modifica di schema DB: il record `messages.image_url` continua a
  puntare a `/chat/images/<filename>`; cambia solo il contenuto del file su disco.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Con `CHAT_DB_KEY` impostata, i byte in chiaro di un file caricato non
  compaiono nel file salvato in `data/uploads/`.
- **SC-002**: Un allegato caricato e poi scaricato via `GET /chat/images` è byte-identico
  all'originale (round-trip).
- **SC-003**: Senza `CHAT_DB_KEY`, upload/serve si comportano come baseline; `npm test`
  verde.
- **SC-004**: Un allegato in chiaro preesistente resta servito correttamente anche con la
  chiave attiva.

## Assumptions & Dependencies

- Riusa `CHAT_DB_KEY` (spec 004) come unica chiave; la gestione/backup della chiave resta
  responsabilità dell'operatore.
- Costruisce sulla spec 004 (chiave/cifratura) e 002 (suite di test).
- **Fuori scope**: cifratura dei background statici in `public/backgrounds/`; rotazione
  della chiave; streaming cifrato (i file sono bufferizzati in RAM fino a 50 MB);
  cifratura di `DB_PATH` (solo tabella demo `items`, valore trascurabile).
