# raspi-chat

Chat web self-hosted pensata per Raspberry Pi e piccoli server domestici.

Il progetto include:
- backend Node.js/Fastify
- frontend web/PWA senza framework
- messaggi realtime via WebSocket
- SQLite locale
- upload immagini e allegati, con anteprima link
- notifiche Web Push
- cifratura at-rest opzionale (chat.db + allegati)
- client CLI da terminale
- app Android via TWA (sideload, senza Play Store)

URL live di riferimento: `https://chat.tongatron.org/chat`

## A chi serve

Questo progetto ha senso se vuoi:
- una chat semplice da self-hostare
- qualcosa di più leggero di Matrix, Rocket.Chat o simili
- un'app che giri bene anche su Raspberry vecchie
- una base chiara da adattare a chat privata, di famiglia o di piccola community

Non è pensato come alternativa enterprise a Slack/Discord: è una codebase pragmatica, piccola e modificabile.

Se vuoi una chat molto strutturata e federata, esistono opzioni più grandi come Matrix o Snikket. Se invece vuoi poca dipendenza esterna, deploy semplice, storage locale e facilità di modifica, `raspi-chat` è una base più leggera e più adatta a Raspberry/home server.

## Da dove iniziare

- [Installazione](installazione.md) — come mettere in piedi il progetto in locale o su Raspberry Pi
- [Funzionalità](funzionalita.md) — cosa sa fare la chat: stanze, allegati, cifratura, preferiti, notifiche
- [Client CLI](cli.md) — usare la chat da terminale
- [Deploy](deploy.md) — systemd, nginx, Cloudflare Tunnel
- [Sviluppo](sviluppo.md) — API, test, verifica
- [Roadmap](roadmap.md) — prossimi passi in programma

Il codice sorgente è su [GitHub](https://github.com/tongatron/raspi-chat).
