# raspi-chat CLI

Client interattivo da terminale per raspi-chat: usa la chat senza browser, riusando il backend esistente (login HTTP + WebSocket realtime).

## Requisiti

- Node.js ≥ 18 (per `fetch` globale)
- Backend raspi-chat in esecuzione (`npm start`)
- Un account valido sulla chat

## Avvio

```bash
# default: RASPI_CHAT_URL=http://localhost:3000, room cabras-giovanni
npm run cli

# server e room espliciti
node cli/chat-cli.js --url http://192.168.1.50:3000 --room cabras-giovanni
```

Le credenziali vengono chieste in modo interattivo, oppure lette da `RASPI_CHAT_USER` / `RASPI_CHAT_PASS`.

## Opzioni

| Opzione | Descrizione | Default |
|---------|-------------|---------|
| `--url <url>` | URL HTTP del server | `RASPI_CHAT_URL` o `http://localhost:3000` |
| `--room <id>` | Room a cui unirsi | se omesso, scelta dalle tue room |
| `-h`, `--help` | Mostra l'aiuto | — |

## Variabili d'ambiente

- `RASPI_CHAT_URL` — URL del server (l'URL WebSocket viene derivato: `http→ws`, `https→wss`, path `/chat/ws`)
- `RASPI_CHAT_USER` / `RASPI_CHAT_PASS` — credenziali (saltano il prompt)

## Comandi nella chat

- Digita e premi invio per inviare un messaggio
- `/online` — (l'ultimo stato online viene mostrato automaticamente agli aggiornamenti)
- `/quit` o `/exit` — esci
- `Ctrl+C` — uscita pulita

## Funzionalità

- Login con username/password
- Storico iniziale + messaggi in tempo reale
- Invio messaggi di testo (limite 2000 caratteri)
- Lista utenti online
- Selezione room: se non passi `--room`, la CLI elenca le tue room (`GET /chat/my-rooms`) e le sceglie automaticamente (se è una sola) o te le fa scegliere
- Riconnessione automatica con backoff in caso di caduta della rete (senza re-login)

## Fuori scope (v1)

Invio immagini/allegati, reply, eliminazione messaggi, ricevute di lettura, funzioni admin/inviti. I messaggi con immagine vengono mostrati come `[immagine]`.

## Architettura

- `chat-cli.js` — entry point: config, login, wiring UI↔connessione, segnali
- `lib/auth.js` — login HTTP (`POST /chat/login`)
- `lib/connection.js` — WebSocket, handshake `join`, invio, riconnessione
- `lib/ui.js` — rendering terminale (input non corrotto dai messaggi in arrivo)

Vedi i contratti in [`specs/001-cli-chat-client/contracts/`](../specs/001-cli-chat-client/contracts/).
