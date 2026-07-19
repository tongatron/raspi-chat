# Client CLI

Un client chat da terminale che usa lo stesso backend (login HTTP + WebSocket), senza browser:

```bash
npm run cli                                   # default http://localhost:3000
node cli/chat-cli.js --url http://pi.local:3000 --room cabras-giovanni
```

Le credenziali sono richieste in modo interattivo, oppure lette da `RASPI_CHAT_USER` / `RASPI_CHAT_PASS`. L'URL del server viene da `--url` o `RASPI_CHAT_URL`.

Supporta:
- messaggi in tempo reale
- utenti online
- selezione room
- riconnessione automatica con backoff
- coda dei messaggi in uscita (outbox): i messaggi scritti da disconnesso partono da soli alla riconnessione, senza duplicati

Dettagli aggiuntivi in [`cli/README.md`](https://github.com/tongatron/raspi-chat/blob/main/cli/README.md) e [`cli/COMANDI.md`](https://github.com/tongatron/raspi-chat/blob/main/cli/COMANDI.md) nel repository.
