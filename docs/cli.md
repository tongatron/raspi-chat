# CLI client

A terminal chat client that uses the same backend (HTTP login + WebSocket), no browser needed:

```bash
npm run cli                                   # defaults to http://localhost:3000
node cli/chat-cli.js --url http://pi.local:3000 --room cabras-giovanni
```

Credentials are requested interactively, or read from `RASPI_CHAT_USER` / `RASPI_CHAT_PASS`. The server URL comes from `--url` or `RASPI_CHAT_URL`.

Supports:
- realtime messaging
- online users
- room selection
- automatic reconnection with backoff
- outbox queue: messages written while disconnected are sent automatically on reconnect, without duplicates

More details in [`cli/README.md`](https://github.com/tongatron/raspi-chat/blob/main/cli/README.md) and [`cli/COMANDI.md`](https://github.com/tongatron/raspi-chat/blob/main/cli/COMANDI.md) in the repository.
