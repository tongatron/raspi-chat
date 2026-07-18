# Feature Specification: Path di chat.db configurabile (CHAT_DB_PATH)

**Feature Branch**: `003-configurable-chat-db-path`

**Created**: 2026-07-18

**Status**: Implemented

**Input**: Prerequisito emerso dalla spec 002. Il path di `chat.db` era hardcoded a
`process.cwd()/data/chat.db`, il che impediva di testare in modo ermetico il login
con credenziali valide (avrebbe scritto sul DB di produzione) e ostacola la futura
feature di cifratura at-rest, che dovrà comunque controllare l'apertura del DB.
Questa feature rende il path configurabile via env, a default invariato.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Testare il login valido senza toccare i dati reali (Priority: P1)

Uno sviluppatore esegue la suite di test e verifica il flusso completo di login
(credenziali valide → token) contro un database isolato, senza alterare
`data/chat.db` di produzione.

**Why this priority**: Sblocca la copertura del percorso di autenticazione più
importante (login riuscito), oggi non testabile in sicurezza, rispettando il
Principio V del constitution (nessun effetto collaterale sui dati reali).

**Independent Test**: Impostare `CHAT_DB_PATH` e `CHAT_USERS_FILE` su una tempdir
con un utente fixture, costruire l'app ed eseguire `POST /chat/login` con quelle
credenziali, verificando la risposta 200 con token.

**Acceptance Scenarios**:

1. **Given** `CHAT_DB_PATH` impostato su una tempdir e un utente nel file utenti, **When** l'app viene costruita, **Then** gli utenti sono sincronizzati in quel database isolato.
2. **Given** quell'ambiente, **When** si esegue `POST /chat/login` con credenziali valide, **Then** la risposta è 200 con `token`, `username` e `role`.
3. **Given** `CHAT_DB_PATH` non impostato, **When** l'app parte, **Then** usa il path storico `data/chat.db` (comportamento di produzione invariato).

---

### Edge Cases

- **`CHAT_DB_PATH` che punta a una directory inesistente**: responsabilità
  dell'operatore/ambiente creare la directory (come già per `data/`); il default di
  produzione non è interessato.
- **Coesistenza con `DB_PATH`**: `DB_PATH` (app.db) e `CHAT_DB_PATH` (chat.db) sono
  indipendenti e possono puntare a percorsi diversi.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema MUST leggere il path di `chat.db` da `process.env.CHAT_DB_PATH`, con fallback al path storico `process.cwd()/data/chat.db`.
- **FR-002**: Il comportamento di default (senza `CHAT_DB_PATH`) MUST restare identico alla baseline: nessun impatto sul deploy di produzione.
- **FR-003**: La suite di test MUST includere un test del login con credenziali valide che usa `CHAT_DB_PATH` per isolare il database.
- **FR-004**: `.env.example` MUST documentare `CHAT_DB_PATH`.

### Key Entities

- Nessuna nuova entità. Cambia solo la sorgente di configurazione del path DB.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `npm test` include e supera un test di login con credenziali valide.
- **SC-002**: In assenza di `CHAT_DB_PATH`, l'app usa `data/chat.db` come prima.
- **SC-003**: I test di login non creano né modificano `data/chat.db` di produzione.

## Assumptions & Dependencies

- Costruisce sul lavoro della spec 002 (suite di test + CI).
- Nessuna modifica allo schema o ai dati; solo la risoluzione del path di apertura.
- Prepara il terreno per la futura feature di cifratura at-rest (spec successiva),
  che intercetterà lo stesso punto di apertura del DB.
