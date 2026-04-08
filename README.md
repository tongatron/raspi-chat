# fastify-api

API e chat real-time per Raspberry Pi, costruita con Fastify, WebSocket, SQLite, nginx e systemd.

## Avvio

```bash
cp .env.example .env   # configura le variabili d'ambiente
npm install
npm start
```

## Variabili d'ambiente (.env)

| Variabile | Descrizione |
|---|---|
| `PORT` | Porta del server (default: 3000) |
| `HOST` | Host di ascolto (default: 127.0.0.1) |
| `VAPID_PUBLIC_KEY` | Chiave pubblica per Web Push |
| `VAPID_PRIVATE_KEY` | Chiave privata per Web Push |
| `VAPID_EMAIL` | Email per Web Push |
| `TOKEN_SECRET` | Segreto HMAC per i token di sessione (persistente tra riavvii) |
| `DB_PATH` | Percorso database SQLite (default: `data/app.db`) |

## Chat (`/chat`)

Chat privata real-time accessibile su `http://raspberrypi.local/chat`.

### Funzionalità

- **Messaggi real-time** via WebSocket
- **Persistenza** su SQLite — i messaggi sopravvivono ai riavvii
- **Autenticazione** con password per utente + token di sessione
- **Paginazione** — carica i 100 messaggi più recenti, scorri in su per i precedenti
- **Reply/Quote** — rispondi a un messaggio specifico con citazione
- **Immagini** — upload e invio di immagini (max 10 MB)
- **Link preview** — anteprima automatica degli URL
- **Notifiche push** — Web Push (browser) e FCM (app Android)
- **Suono** — notifica sonora alla ricezione di nuovi messaggi
- **Badge** — contatore messaggi non letti sull'icona dell'app
- **Indicatore di scrittura** — mostra quando un utente sta scrivendo
- **Stato lettura** — "Inviato" / "✓ Letto"
- **PWA** — installabile come app su Android e iOS
- **APK Android** — scaricabile da `/chat/download-app`

### Utenti

Gli utenti sono definiti in `src/routes/chat.js` (array `SEED_USERS`).
Le password vengono salvate con hash **scrypt** nel database al primo avvio.

### Endpoint chat

| Metodo | Endpoint | Descrizione |
|---|---|---|
| `GET` | `/chat` | Interfaccia web |
| `POST` | `/chat/login` | Autenticazione → restituisce token |
| `GET` | `/chat/ws` | WebSocket real-time |
| `GET` | `/chat/messages?before=<ISO>&limit=50` | Paginazione messaggi |
| `POST` | `/chat/upload` | Upload immagine |
| `GET` | `/chat/images/:filename` | Serve immagini caricate |
| `GET` | `/chat/preview?url=<url>` | Anteprima link |
| `POST` | `/chat/push-subscribe` | Registra Web Push |
| `DELETE` | `/chat/push-unsubscribe` | Rimuovi Web Push |
| `GET` | `/chat/vapid-public-key` | Chiave VAPID pubblica |
| `POST` | `/chat/fcm-register` | Registra token FCM Android |
| `GET` | `/chat/download-app` | Scarica APK Android |
| `GET` | `/chat/manifest.json` | Manifest PWA |

## Database

I dati sono salvati in `data/chat.db` (SQLite, WAL mode).

**Tabelle:**
- `messages` — messaggi con id, username, testo, immagine, timestamp, reply_to_id
- `message_reads` — stato lettura per messaggio e utente
- `users` — credenziali utenti (hash scrypt)

## Struttura

```
fastify-api/
├── server.js                  # Entry point
├── src/
│   └── routes/
│       └── chat.js            # Logica chat completa
├── public/
│   ├── chat.html              # Frontend chat (PWA)
│   ├── sw.js                  # Service Worker
│   ├── icon-192.png
│   ├── icon-512.png
│   └── chat-tongatron.apk     # App Android
├── data/
│   ├── chat.db                # Database SQLite
│   └── uploads/               # Immagini caricate
└── .env                       # Variabili d'ambiente
```

## Gestione servizio

```bash
sudo systemctl start fastify-api
sudo systemctl stop fastify-api
sudo systemctl restart fastify-api
sudo systemctl status fastify-api
sudo journalctl -u fastify-api -f   # log in tempo reale
```
