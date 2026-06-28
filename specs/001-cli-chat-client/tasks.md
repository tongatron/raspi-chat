---

description: "Task list for CLI Chat Client"
---

# Tasks: CLI Chat Client

**Input**: Design documents from `specs/001-cli-chat-client/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Non richiesti (il progetto non ha framework di test; nessuna richiesta di TDD nella spec). La validazione end-to-end avviene via `quickstart.md` nella fase di Polish.

**Organization**: Task raggruppati per user story per consentire implementazione e test indipendenti.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Eseguibile in parallelo (file diversi, nessuna dipendenza)
- **[Story]**: User story di appartenenza (US1–US4)

## Path Conventions

CLI client autonomo sotto `cli/` a livello root (vedi plan.md). Il backend in `src/` non viene modificato.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Inizializzazione struttura CLI e configurazione

- [X] T001 Creare la struttura cartelle `cli/` e `cli/lib/` con file vuoti `cli/chat-cli.js`, `cli/lib/auth.js`, `cli/lib/connection.js`, `cli/lib/ui.js`
- [X] T002 Aggiungere lo script `"cli": "node cli/chat-cli.js"` a `package.json` e includere `cli/chat-cli.js` e i moduli `cli/lib/*.js` nello script `check` (node --check)
- [X] T003 Confermare in `src/config.js` la porta/host di default del server e fissare il default di `RASPI_CHAT_URL` coerente in `cli/lib/config` o in cima a `cli/chat-cli.js`

**Checkpoint**: struttura pronta, `npm run cli` eseguibile (anche se non fa ancora nulla)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Configurazione e utilità condivise da tutte le user story

**⚠️ CRITICAL**: Nessuna user story può iniziare prima del completamento di questa fase

- [X] T004 Implementare il parsing di configurazione in `cli/chat-cli.js`: leggere `RASPI_CHAT_URL` (default `http://localhost:3000`), flag `--url`, `--room` (default `cabras-giovanni`), `RASPI_CHAT_USER`/`RASPI_CHAT_PASS`; derivare `wsUrl` (http→ws, https→wss, append `/chat/ws`)
- [X] T005 [P] Implementare le primitive di rendering in `cli/lib/ui.js`: setup `readline`, prompt persistente, helper `printLine(text)` che cancella la riga corrente, stampa e ridisegna l'input parziale (`rl.line`) — base per FR-015
- [X] T006 [P] Implementare in `cli/lib/ui.js` i formattatori: `formatMessage({username,text,timestamp})` (ora locale), `formatOnline(users)`, e helper colori ANSI minimi (mittente vs proprio)

**Checkpoint**: configurazione e UI di base disponibili per tutte le story

---

## Phase 3: User Story 1 - Accedere e leggere la conversazione (Priority: P1) 🎯 MVP

**Goal**: Login con credenziali + connessione realtime + visualizzazione storico e messaggi in arrivo

**Independent Test**: avviare la CLI, autenticarsi con utente valido, vedere lo storico e ricevere entro ~3s un messaggio inviato da un altro client (quickstart V1, V2)

### Implementation for User Story 1

- [X] T007 [US1] Implementare `login({baseUrl, username, password})` in `cli/lib/auth.js`: `POST /chat/login` via `fetch`, ritornare `{token, username}`; gestire 400/401 con errori distinti (vedi contracts/login.md)
- [X] T008 [US1] Implementare in `cli/chat-cli.js` il prompt interattivo delle credenziali (usando env se presenti) con re-try su credenziali errate (FR-001, FR-010)
- [X] T009 [US1] Implementare `ChatConnection` in `cli/lib/connection.js`: apertura WebSocket (`ws`), invio handshake `join` con token+roomId all'evento `open`, emissione eventi per i messaggi server (contracts/ws-protocol.md)
- [X] T010 [US1] Gestire in `cli/lib/connection.js` i messaggi `history` e `message`: emetterli verso la UI (FR-003, FR-004)
- [X] T011 [US1] Collegare in `cli/chat-cli.js` la connection alla UI: al `history` stampare nome room + storico ordinato per timestamp; ad ogni `message` stampare via `printLine` senza corrompere l'input (FR-004, FR-015)
- [X] T012 [US1] Gestire `auth_error` come errore fatale in `cli/lib/connection.js`/`chat-cli.js`: messaggio chiaro + uscita non-zero, nessuna riconnessione (FR-010, edge case sessione invalida)

**Checkpoint**: US1 funzionante — login + storico + ricezione realtime. Validabile con quickstart V1/V2.

---

## Phase 4: User Story 2 - Inviare messaggi di testo (Priority: P1) 🎯 MVP

**Goal**: L'utente autenticato compone e invia messaggi di testo alla room

**Independent Test**: da sessione connessa, digitare un testo e verificarne la comparsa nella propria vista e in un altro client (quickstart V3)

### Implementation for User Story 2

- [X] T013 [US2] Implementare `sendMessage(text)` in `cli/lib/connection.js`: inviare `{type:'message', text}` solo se la connessione è in stato `joined` (contracts/ws-protocol.md)
- [X] T014 [US2] Collegare l'input readline in `cli/chat-cli.js`: ad ogni riga inviata chiamare `sendMessage`; ignorare input vuoto/solo-spazi (FR-006)
- [X] T015 [US2] Applicare il limite di 2000 caratteri all'input in `cli/chat-cli.js` o `cli/lib/connection.js`, con feedback all'utente quando troncato (FR-007)
- [X] T016 [US2] Gestire l'echo del proprio messaggio: poiché il server fa broadcast anche al mittente, evitare doppioni usando l'`id` ricevuto (data-model: dedup per `id`)

**Checkpoint**: US1 + US2 = MVP completo (chat bidirezionale da terminale). Validabile con quickstart V3.

---

## Phase 5: User Story 3 - Utenti online e selezione room (Priority: P2)

**Goal**: Mostrare gli utenti online e permettere la scelta della room

**Independent Test**: con due client nella stessa room verificare la lista online; avviare con `--room <id>` membro e vedere lo storico corretto; room non valida → errore chiaro (quickstart V4)

### Implementation for User Story 3

- [X] T017 [US3] Gestire il messaggio `online` in `cli/lib/connection.js` e mostrarlo in `cli/chat-cli.js` (riga di stato o comando `/online`) (FR-008)
- [X] T018 [US3] Usare il flag `--room` nell'handshake `join` e mostrare il `roomName` ricevuto in `history`; default `cabras-giovanni` (FR-009)
- [X] T019 [US3] Gestire `room_error` come errore non recuperabile con messaggio chiaro (room inesistente / non membro), senza stato bloccato (FR-011)
- [X] T020 [P] [US3] Gestire `room_removed` in `cli/lib/connection.js`/`chat-cli.js`: notificare l'utente e uscire in modo pulito (edge case)
- [X] T031 [US3] Implementare `listRooms({baseUrl, username, token})` in `cli/lib/auth.js`: `GET /chat/my-rooms` con header `x-chat-username`/`x-chat-token`, ritorna `[{id,name}]`, `[]` su errore/server giù (FR-009)
- [X] T032 [US3] Implementare `resolveRoom()` in `cli/chat-cli.js`: se `--room` assente, usa `listRooms` → auto-selezione se unica, prompt numerato se multiple, default se nessuna (FR-009)

**Checkpoint**: US1–US3 funzionanti indipendentemente. Validabile con quickstart V4.

---

## Phase 6: User Story 4 - Resilienza alle disconnessioni (Priority: P2)

**Goal**: Rilevare cadute di connessione, segnalarle e riconnettersi automaticamente senza re-login

**Independent Test**: fermare/riavviare il backend e verificare avviso di disconnessione + ripristino della room entro ~30s senza reinserire credenziali (quickstart V5)

### Implementation for User Story 4

- [X] T021 [US4] Implementare in `cli/lib/connection.js` la gestione dell'evento `close`/`error` del socket: emettere stato "disconnesso" e avviare la riconnessione (FR-012)
- [X] T022 [US4] Implementare il backoff esponenziale con jitter (start ~1s, tetto ~30s, retry indefiniti) in `cli/lib/connection.js`, riusando token e roomId correnti per il nuovo `join` (research R5, SC-004)
- [X] T023 [US4] Mostrare all'utente i messaggi di stato di disconnessione/riconnessione via `cli/lib/ui.js` senza corrompere l'input (FR-012, FR-015)
- [X] T024 [US4] Non riconnettere su `auth_error`/`room_error` (errori logici); riconnettere solo su close di rete (research R6)

**Checkpoint**: tutte le user story funzionanti. Validabile con quickstart V5.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Rifiniture trasversali

- [X] T025 Gestire SIGINT (Ctrl+C) in `cli/chat-cli.js`: chiudere il socket e uscire senza traceback (FR-014, quickstart V6)
- [X] T026 Gestire server irraggiungibile all'avvio in `cli/chat-cli.js`: messaggio chiaro + exit non-zero (edge case, SC-005)
- [X] T027 Mostrare placeholder `[immagine]` per messaggi con `imageUrl` e ignorare `replyTo`/`read`/`unread` (scope v1, data-model)
- [X] T028 [P] Scrivere `cli/README.md` con uso, variabili d'ambiente e flag; aggiungere una sezione "CLI" ai README principali (`README.md`, `README.it.md`)
- [X] T029 Eseguire `npm run check` e correggere eventuali errori di sintassi
- [X] T030 Eseguire la validazione manuale completa di `quickstart.md` (V1–V6) contro un backend locale

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: nessuna dipendenza
- **Foundational (Phase 2)**: dipende da Setup — BLOCCA tutte le user story
- **User Stories (Phase 3–6)**: dipendono da Foundational
  - US1 (P1) → US2 (P1) costituiscono l'MVP e condividono `cli/lib/connection.js`, quindi conviene farle in sequenza
  - US3 e US4 dipendono da US1 (connessione attiva) ma sono indipendenti tra loro
- **Polish (Phase 7)**: dopo le user story desiderate

### Within Each User Story

- `auth.js` e `connection.js` prima del wiring in `chat-cli.js`
- Connessione (US1) prima di invio (US2), online/room (US3), reconnect (US4)

### Parallel Opportunities

- T005 e T006 (Foundational, file `ui.js` — coordinare se stesso file) e in generale i task marcati [P] su file distinti
- US3 e US4 possono procedere in parallelo una volta completata US1

---

## Implementation Strategy

### MVP First (User Story 1 + 2)

1. Phase 1: Setup
2. Phase 2: Foundational
3. Phase 3 (US1) + Phase 4 (US2) → **STOP e VALIDARE** (quickstart V1–V3): chat bidirezionale da terminale funzionante
4. Demo

### Incremental Delivery

1. Setup + Foundational → base pronta
2. US1 + US2 → MVP (chat testuale)
3. US3 → utenti online + room
4. US4 → resilienza connessione
5. Polish → uscita pulita, docs, validazione completa

---

## Notes

- [P] = file diversi, nessuna dipendenza
- Backend in `src/` non modificato: la CLI rispetta i contratti in `contracts/`
- Commit dopo ogni task o gruppo logico
- Fermarsi ai checkpoint per validare ogni story in modo indipendente
