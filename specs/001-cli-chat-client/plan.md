# Implementation Plan: CLI Chat Client

**Branch**: `spec-kit-cli` | **Date**: 2026-06-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-cli-chat-client/spec.md`

## Summary

Aggiungere un client da terminale interattivo a raspi-chat che riusa il backend Fastify esistente: autenticazione via `POST /chat/login` per ottenere il token di sessione, connessione realtime via WebSocket `GET /chat/ws` con handshake `join`, visualizzazione dello storico e dei messaggi in arrivo, invio di messaggi di testo, lista utenti online, selezione room, gestione errori e riconnessione automatica con backoff. L'implementazione resta dentro lo stesso runtime e lo stesso `package.json` del progetto, senza nuove dipendenze (riusa `ws`, già presente, `fetch` globale di Node e `readline` integrato).

## Technical Context

**Language/Version**: Node.js (CommonJS, `require`), allineato al runtime del progetto (Node ≥ 18 per `fetch` globale; consigliato 20+).

**Primary Dependencies**: `ws` (già in `package.json`) per il WebSocket client; `node:readline` e `node:readline/promises` (built-in) per la REPL; `fetch` globale per il login HTTP. Nessuna nuova dipendenza.

**Storage**: Nessuna persistenza locale. Lo stato (token, room, storico in memoria) vive per la durata della sessione. La verità rimane sul backend (SQLite `data/chat.db`).

**Testing**: `node --check` per la sintassi (coerente con lo script `check` esistente) + uno smoke test manuale via `quickstart.md` contro un server locale. Nessun framework di test introdotto (il progetto non ne ha).

**Target Platform**: Terminale interattivo (TTY) su Linux/macOS, incluso Raspberry Pi.

**Project Type**: CLI single-process che parla con un web-service esistente.

**Performance Goals**: Visualizzazione dei messaggi in arrivo entro ~3s (SC-002); riconnessione utilizzabile entro 30s dal ritorno del server (SC-004). Carico trascurabile (un solo socket).

**Constraints**: Nessuna nuova dipendenza pesante; la riga di input non deve essere corrotta dai messaggi in arrivo (FR-015); chiusura pulita su SIGINT (FR-014); backoff esponenziale con tetto sui retry (FR-012).

**Scale/Scope**: Uso personale/familiare, pochi utenti per room. Un solo file CLI + un piccolo modulo di trasporto.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

La constitution del progetto è ancora un template non compilato (`.specify/memory/constitution.md`), quindi non impone gate formali. Si applicano i principi impliciti desumibili dal codebase:

- **Riuso del backend esistente**: ✅ nessuna modifica lato server; si usano endpoint e protocollo già esistenti.
- **Minimalismo dipendenze**: ✅ solo built-in + `ws` già presente.
- **Coerenza di stile**: ✅ CommonJS, `'use strict'`, stesso stile di `src/`.

Nessuna violazione → nessuna voce in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-cli-chat-client/
├── plan.md              # Questo file
├── spec.md              # Specifica
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── login.md         # Contratto HTTP login
│   └── ws-protocol.md   # Contratto messaggi WebSocket
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
cli/
├── chat-cli.js          # Entry point: parsing args/env, orchestrazione REPL
├── lib/
│   ├── auth.js          # login() via POST /chat/login → token
│   ├── connection.js    # ChatConnection: WebSocket + join + reconnect/backoff
│   └── ui.js            # rendering messaggi/online + gestione readline senza corruzione input
└── README.md            # Uso della CLI (richiamato dal README principale)
```

Si aggiunge inoltre uno script in `package.json`:

```json
"scripts": {
  "cli": "node cli/chat-cli.js"
}
```

**Structure Decision**: nuova cartella `cli/` a livello root, parallela a `src/` (che resta il backend). La CLI è un client autonomo: non importa codice da `src/` (il server gira come processo separato, potenzialmente su un'altra macchina), ma ne rispetta i contratti documentati in `contracts/`. Separazione `auth` / `connection` / `ui` per testabilità e per isolare la logica di reconnect dal rendering.

## Complexity Tracking

> Nessuna violazione della constitution: sezione non applicabile.
