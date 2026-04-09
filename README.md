# cabras-chat

Chat web self-hosted pensata per Raspberry Pi e piccoli server domestici.

Il progetto include:
- backend Node.js/Fastify
- frontend web/PWA senza framework
- messaggi realtime via WebSocket
- SQLite locale
- upload immagini
- preview link
- notifiche Web Push e FCM
- archivio privato per file/note
- wrapper Android in `android-chat/`

URL live di riferimento:

`https://chat.tongatron.org/chat`

Pagina pubblica per scaricare l'APK:

`https://chat.tongatron.org/chat/app`

## A chi serve

Questo progetto ha senso se vuoi:
- una chat semplice da self-hostare
- qualcosa di piu' leggero di Matrix, Rocket.Chat o simili
- un'app che possa girare bene anche su Raspberry vecchie
- una base chiara da adattare a chat privata, di famiglia o di piccola community

Non e' pensato come alternativa enterprise a Slack/Discord. E' una codebase pragmatica, piccola e modificabile.

## Stato attuale

La repo e' la source of truth della chat.

Contiene:
- web app e backend
- asset pubblici
- documentazione di deploy
- wrapper Android WebView con FCM

Non contiene:
- `.env`
- `config/chat-users.json`
- `firebase-service-account.json`
- `android-chat/app/google-services.json`

## Struttura

```text
cabras-chat/
├── android-chat/                Wrapper Android
├── config/                      Esempi configurazione utenti
├── ops/                         Esempi deploy Raspberry
├── public/                      Frontend, PWA, APK pubblica
├── src/                         Backend Fastify
├── .env.example
├── package.json
└── server.js
```

## Requisiti minimi

- Node.js 20+
- npm
- Linux o Raspberry Pi OS
- reverse proxy opzionale ma consigliato

Per Android wrapper:
- Android SDK
- JDK 17+
- `android-chat/app/google-services.json` locale

## Installazione rapida

### Locale

```bash
git clone https://github.com/tongatron/cabras-chat.git
cd cabras-chat
cp .env.example .env
cp config/chat-users.example.json config/chat-users.json
npm install
npm run check
npm start
```

La chat sara' disponibile su:

`http://127.0.0.1:3000/chat`

### Raspberry Pi

```bash
git clone https://github.com/tongatron/cabras-chat.git /srv/apps/cabras-chat
cd /srv/apps/cabras-chat
bash ops/install-rpi.sh
```

Poi:
1. modifica `.env`
2. modifica `config/chat-users.json`
3. copia [ops/fastify-api.service.example](/Users/tonga/Documents/GitHub/cabras-chat/ops/fastify-api.service.example) in `/etc/systemd/system/fastify-api.service`
4. opzionale: usa [ops/nginx.chat.example.conf](/Users/tonga/Documents/GitHub/cabras-chat/ops/nginx.chat.example.conf) come base per nginx
5. riavvia systemd

Comandi utili:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fastify-api
sudo systemctl status fastify-api
journalctl -u fastify-api -f
```

## Configurazione

### Utenti

Il file utenti e' esterno al codice:

`config/chat-users.json`

Esempio:

```json
[
  { "username": "Giovanni", "password": "change-me-giovanni" },
  { "username": "Cabras", "password": "change-me-cabras" }
]
```

### Variabili ambiente

Le principali sono gia' documentate in [.env.example](/Users/tonga/Documents/GitHub/cabras-chat/.env.example):

- `HOST`, `PORT`
- `CHAT_USERS_FILE`
- `TOKEN_SECRET`
- `PRIVATE_TRANSFER_OWNER`
- `PRIVATE_TRANSFER_MAX_MB`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`

## Deploy tipico

Assetto consigliato su Raspberry:

- app Node in ascolto su `127.0.0.1:3000`
- `systemd` per il processo
- `nginx` davanti
- opzionale tunnel Cloudflare o DNS pubblico

Percorso consigliato:

`/srv/apps/cabras-chat`

## Android wrapper

Il wrapper Android ora vive in:

[android-chat](/Users/tonga/Documents/GitHub/cabras-chat/android-chat)

Build debug:

```bash
cd android-chat
./gradlew assembleDebug
```

Output:

`android-chat/app/build/outputs/apk/debug/app-debug.apk`

Nota:
- il build richiede `android-chat/app/google-services.json`
- quel file resta locale e non va versionato

## Endpoint utili

Pubblici:
- `GET /chat`
- `POST /chat/login`
- `GET /chat/ws`
- `GET /chat/app`
- `GET /chat/download-app`
- `GET /chat/manifest.json`
- `GET /sw.js`
- `GET /health`
- `GET /version`

Privati:
- `GET /chat/messages`
- `POST /chat/upload`
- `GET /chat/images/:filename`
- `GET /chat/preview`
- `GET /chat/private-transfers`
- `POST /chat/private-transfers/upload`
- `POST /chat/private-transfers/note`
- `GET /chat/console/data`

## Verifica veloce

```bash
curl http://127.0.0.1:3000/health
```

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"Test","password":"..."}' \
  http://127.0.0.1:3000/chat/login
```

```bash
npm run check
```

## Posizionamento rispetto ad altri progetti

Se vuoi una chat molto strutturata e federata, esistono opzioni piu' grandi come Matrix o Snikket.

Se invece vuoi:
- poca dipendenza esterna
- deploy semplice
- storage locale
- facilità di modifica

allora `cabras-chat` e' una base piu' leggera e piu' adatta a Raspberry/home server.

## Prossimi passi consigliati

- creare una modalita' “public room” esplicita
- aggiungere un setup guidato ancora piu' automatico
- documentare backup/ripristino di `chat.db`
- aggiungere test automatici minimi
