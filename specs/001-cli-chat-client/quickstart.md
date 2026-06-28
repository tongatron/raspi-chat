# Quickstart: CLI Chat Client

Guida per avviare e validare la CLI end-to-end contro un'istanza locale del backend raspi-chat.

## Prerequisiti

- Node ≥ 18 (per `fetch` globale).
- Backend in esecuzione: dalla root del progetto `npm start` (default `http://localhost:<porta>` — vedi `src/config.js`).
- Un utente valido esistente nella chat (username + password).

## Avvio

```bash
# usa il default RASPI_CHAT_URL=http://localhost:3000
npm run cli

# oppure specificando server e room
RASPI_CHAT_URL=http://192.168.1.50:3000 node cli/chat-cli.js --room cabras-giovanni
```

Al primo avvio la CLI chiede username e password (oppure li legge da `RASPI_CHAT_USER` / `RASPI_CHAT_PASS` se impostati).

## Scenari di validazione

### V1 — Login + storico (US1, FR-001/003)
1. Avvia `npm run cli` e inserisci credenziali valide.
2. **Atteso**: messaggio "connesso" + storico recente della room mostrato.
3. Con credenziali errate → messaggio d'errore chiaro, possibilità di riprovare, nessun crash (FR-010, SC-005).

### V2 — Ricezione realtime (US1, FR-004, SC-002)
1. Con la CLI connessa, invia un messaggio dal client web nella stessa room.
2. **Atteso**: il messaggio appare nella CLI entro ~3s con mittente, testo e ora.

### V3 — Invio messaggi (US2, FR-005/006/007, SC-003)
1. Digita un testo nella CLI e premi invio.
2. **Atteso**: compare nella tua vista e nel client web.
3. Invia stringa vuota → nessun messaggio inviato (FR-006).
4. Incolla > 2000 caratteri → troncato/limitato senza errori (FR-007).

### V4 — Utenti online + room (US3, FR-008/009/011)
1. Connetti un secondo client alla stessa room → **atteso**: appare nella lista online (FR-008).
2. Avvia con `--room <id>` di cui sei membro → **atteso**: storico corretto.
3. Avvia con room inesistente o di cui non sei membro → **atteso**: messaggio `room_error` chiaro, nessuno stato bloccato (FR-011).

### V5 — Riconnessione (US4, FR-012, SC-004)
1. Con la CLI connessa, ferma il backend (Ctrl+C nel processo server).
2. **Atteso**: avviso di disconnessione; la CLI ritenta con backoff crescente.
3. Riavvia il backend → **atteso**: la CLI si riconnette e ripristina la room entro ~30s senza chiedere di nuovo le credenziali.

### V6 — Uscita pulita (FR-014)
1. Premi Ctrl+C nella CLI.
2. **Atteso**: il socket viene chiuso e il processo termina senza traceback.

## Riferimenti

- Forma dei messaggi: [contracts/ws-protocol.md](contracts/ws-protocol.md)
- Login: [contracts/login.md](contracts/login.md)
- Entità in memoria: [data-model.md](data-model.md)
