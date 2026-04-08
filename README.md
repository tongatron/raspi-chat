# cabras-chat

Chat privata in tempo reale per Raspberry Pi, con frontend web/PWA, upload immagini, notifiche push e persistenza SQLite.

Questa repo e' la source of truth del progetto chat che gira sulla Raspberry in:

`/srv/apps/fastify-api`

URL pubblico attuale:

`https://chat.tongatron.org/chat`

## Cosa contiene

- backend Node.js/Fastify
- chat realtime via WebSocket
- frontend web in file statico unico
- PWA con service worker e manifest
- wrapper Android WebView con FCM
- upload immagini e sfondi personalizzati
- notifiche Web Push e Firebase Cloud Messaging
- configurazione utenti esterna al codice

## Stato attuale

Il progetto e' in uso reale sulla Raspberry e al momento funziona con questo assetto:

- servizio `fastify-api` gestito da `systemd`
- reverse proxy `nginx` verso `127.0.0.1:3000`
- tunnel Cloudflare verso `chat.tongatron.org`
- database chat in `data/chat.db`
- utenti sincronizzati da `config/chat-users.json`

## Funzionalita' principali

- login per utente con password
- cronologia messaggi persistente
- stato online utenti
- typing indicator
- reply/quote ai messaggi
- read receipts
- eliminazione dei propri messaggi
- upload immagini
- preview automatica del primo link nel messaggio
- sfondi chat personalizzabili
- suono e badge per nuovi messaggi
- PWA installabile
- supporto push browser e Android

## Architettura

### Backend

- `server.js`
  Entry point. Carica `.env`, inizializza il DB legacy `items` e avvia Fastify.

- `src/app.js`
  Registra i plugin Fastify e monta le route.

- `src/routes/chat.js`
  Cuore del progetto. Contiene:
  - autenticazione
  - cookie di sessione per media protetti
  - WebSocket chat
  - persistenza messaggi
  - upload immagini
  - preview link
  - background personalizzati
  - push Web Push e FCM

- `src/routes/root.js`
  Endpoint base come `/`, `/health`, `/version`.

- `src/routes/items.js`
  CRUD legacy su `items`. Non e' il cuore della chat ma e' ancora montato.

- `src/db.js`
  Gestione del DB legacy `items`.

### Frontend

- `public/chat.html`
  Interfaccia completa della chat. Nessun framework frontend.

- `public/sw.js`
  Service worker per push notification e riapertura della chat.

- `android-chat/`
  Wrapper Android della chat, con WebView, picker file e FCM.

### Configurazione

- `config/chat-users.example.json`
  Esempio utenti.

- `config/chat-users.json`
  File reale non versionato con gli utenti e le password in chiaro da convertire in hash nel DB all'avvio.

- `public/chat-tongatron.apk`
  APK debug pubblicabile via `GET /chat/download-app`.

## Modello di autenticazione

Lato browser oggi la chat usa due meccanismi insieme:

- token applicativo restituito da `POST /chat/login`
- cookie `HttpOnly` `chat_auth` impostato dal server

Il token viene usato dal frontend per:

- chiamate HTTP private via header `X-Chat-Username` e `X-Chat-Token`
- join autenticato del WebSocket

La cookie viene usata soprattutto per:

- proteggere immagini e sfondi serviti via `<img>` e `background-image`

### Hardening gia' applicato

- lo storico WebSocket non viene piu' inviato prima del `join` autenticato
- gli endpoint HTTP privati rispondono `401` senza credenziali valide
- immagini e sfondi non sono piu' pubblici
- gli utenti non sono piu' hardcoded nel sorgente
- i riferimenti a `OpenClaw` sono stati rimossi dal progetto e dalla configurazione

## Endpoint principali

### Pubblici

- `GET /chat`
- `POST /chat/login`
- `POST /chat/logout`
- `GET /chat/ws`
- `GET /chat/download-app`
- `GET /chat/manifest.json`
- `GET /chat/icon-192.png`
- `GET /chat/icon-512.png`
- `GET /sw.js`
- `GET /health`
- `GET /version`

Nota: `/chat/ws` e' pubblico come handshake HTTP, ma la chat vera parte solo dopo `join` autenticato.

### Privati

- `GET /chat/messages?before=<ISO>&limit=<n>`
- `POST /chat/upload`
- `GET /chat/images/:filename`
- `GET /chat/preview?url=<url>`
- `GET /chat/backgrounds`
- `GET /chat/backgrounds/:filename`
- `POST /chat/backgrounds/upload`
- `POST /chat/push-subscribe`
- `DELETE /chat/push-unsubscribe`
- `GET /chat/vapid-public-key`
- `POST /chat/fcm-register`
- `GET /chat/test-push`

### Legacy

- `GET /api/v1/items`
- `GET /api/v1/items/:id`
- `POST /api/v1/items`
- `PUT /api/v1/items/:id`
- `DELETE /api/v1/items/:id`

## Database e storage

### Chat

Percorso:

`data/chat.db`

Tabelle:

- `messages`
- `message_reads`
- `users`

Asset su filesystem:

- `data/uploads/` per le immagini inviate
- `public/backgrounds/` per gli sfondi caricati

Nota importante:

- eliminare un messaggio oggi non elimina automaticamente il file immagine associato dal filesystem

### Legacy items

Percorso:

`data/app.db`

Usato dalla parte `items`, non dalla chat.

## Configurazione

### `.env`

Variabili supportate:

| Variabile | Descrizione |
|---|---|
| `APP_NAME` | Nome del servizio |
| `NODE_ENV` | Ambiente Node |
| `HOST` | Host di bind del server |
| `PORT` | Porta di ascolto |
| `API_PREFIX` | Prefix per la REST API legacy |
| `DB_PATH` | DB SQLite della parte `items` |
| `CHAT_USERS_FILE` | Path del file utenti chat |
| `TOKEN_SECRET` | Segreto HMAC dei token |
| `VAPID_PUBLIC_KEY` | Chiave pubblica Web Push |
| `VAPID_PRIVATE_KEY` | Chiave privata Web Push |
| `VAPID_EMAIL` | Email associata alle chiavi VAPID |

### File sensibili non nel repo

- `.env`
- `config/chat-users.json`
- `firebase-service-account.json`
- eventuale `google-services.json` dell'app Android esterna
- `android-chat/app/google-services.json`
- `android-chat/local.properties`

## Setup

### Setup minimo

```bash
cp .env.example .env
mkdir -p config
cp config/chat-users.example.json config/chat-users.json
# modifica config/chat-users.json con gli utenti reali
npm install
npm start
```

### Nota importante sul runtime Node

Sulla Raspberry il servizio gira con:

- `/usr/bin/node`
- Node `v20.19.2`

Nella shell utente puo' esserci anche NVM con una versione diversa di Node. Questo conta perche' il progetto usa moduli nativi SQLite.

Se lanci il progetto con una versione diversa di Node rispetto a quella con cui sono stati compilati i moduli, puoi vedere errori tipo:

- `better-sqlite3 ... compiled against a different Node.js version`

Per lavorare senza sorprese sulla Raspberry, conviene usare lo stesso binario del servizio:

```bash
/usr/bin/node server.js
```

## Nota sulla dipendenza `sqlite3`

La chat usa `better-sqlite3`, ma la parte legacy `items` usa ancora `sqlite3` in `src/db.js`.

Nel deployment attuale della Raspberry questa parte funziona perche' `sqlite3` e' disponibile nell'ambiente di sistema di `/usr/bin/node`.

Se cloni il repo su un'altra macchina, il solo `npm install` potrebbe non bastare per eseguire tutta l'app senza sistemare anche questa dipendenza legacy o senza allineare l'ambiente.

## Deploy sulla Raspberry

Percorso applicazione:

`/srv/apps/fastify-api`

Unit file:

`/etc/systemd/system/fastify-api.service`

Configurazione attuale:

- `User=giovanni`
- `WorkingDirectory=/srv/apps/fastify-api`
- `ExecStart=/usr/bin/node /srv/apps/fastify-api/server.js`
- `HOST=127.0.0.1`
- `PORT=3000`

Comandi utili:

```bash
ssh giovanni@raspberrypi.local
cd /srv/apps/fastify-api
sudo systemctl status fastify-api
sudo systemctl restart fastify-api
journalctl -u fastify-api -f
```

## App Android

Il wrapper Android ora vive dentro questa repo:

`android-chat/`

APK pubblica attuale:

`https://chat.tongatron.org/chat/download-app`

Pagina condivisibile con avviso prima del download:

`https://chat.tongatron.org/chat/app`

Nota pratica:

- il link scarica direttamente un file APK Android
- su molti telefoni Android comparira' un avviso perche' l'app non arriva dal Play Store
- per rigenerare l'APK serve anche `android-chat/app/google-services.json`, che resta locale e non versionato

## Verifiche manuali utili

### Smoke test base

```bash
curl http://127.0.0.1:3000/health
```

### Login

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"Test","password":"..."}' \
  http://127.0.0.1:3000/chat/login
```

### Verifica endpoint privato

```bash
curl -i \
  'http://127.0.0.1:3000/chat/messages?before=9999-12-31T23:59:59.999Z&limit=1'
```

Deve rispondere `401` senza credenziali.

## Struttura repo

```text
cabras-chat/
├── android-chat/
│   ├── app/
│   ├── gradle/
│   ├── build.gradle
│   ├── gradle.properties
│   └── settings.gradle
├── config/
│   └── chat-users.example.json
├── public/
│   ├── chat.html
│   ├── chat-tongatron.apk
│   ├── sw.js
│   ├── icon.png
│   ├── icon-192.png
│   ├── icon-512.png
│   └── backgrounds/
├── src/
│   ├── app.js
│   ├── config.js
│   ├── db.js
│   └── routes/
│       ├── chat.js
│       ├── items.js
│       └── root.js
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── README.md
└── server.js
```

## Confini del repo

Questa repo copre il progetto chat web/PWA, il backend e il wrapper Android.

Non copre in modo completo:

- l'infrastruttura generale della Raspberry
- la dashboard risorse
- altri servizi ospitati sulla stessa macchina
Se esiste documentazione operativa in altre repo, dovrebbe linkare qui per tutto cio' che riguarda la chat.

## Stato test

Non ci sono ancora test automatici nel progetto.

Le verifiche fatte finora sono principalmente manuali direttamente sulla Raspberry, inclusi:

- login
- cronologia messaggi
- protezione endpoint privati
- protezione immagini e sfondi
- restart servizio
- rimozione completa dei riferimenti a `OpenClaw` dal progetto
