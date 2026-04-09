# cabras-chat

<p align="center">
  <img src="public/logo.png" alt="Cabras Chat" width="220" />
</p>

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
npm install
npm run check
npm start
```

Se non hai ancora configurato il progetto, apri:

`http://127.0.0.1:3000/setup`

Se invece hai gia' `.env` e `config/chat-users.json`, la chat sara' disponibile su:

`http://127.0.0.1:3000/chat`

### Raspberry Pi

```bash
git clone https://github.com/tongatron/cabras-chat.git /srv/apps/cabras-chat
cd /srv/apps/cabras-chat
bash ops/install-rpi.sh
```

Poi:
1. avvia una volta l'app con `npm start`
2. apri il wizard su `http://raspberrypi.local:3000/setup` oppure `http://IP-DELLA-RASPBERRY:3000/setup`
3. completa i passaggi web
4. usa i file generati in `data/setup-generated/`
5. abilita `systemd`

Comandi utili:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fastify-api
sudo systemctl status fastify-api
journalctl -u fastify-api -f
```

## Setup guidato via web

Il percorso pensato per chi installa il progetto per la prima volta e':

1. `bash ops/install-rpi.sh`
2. `npm start`
3. apri `/setup`
4. compila i passaggi
5. copia i file generati
6. abilita il servizio

Lo wizard `/setup` fa queste cose:

- controlla che la cartella sia scrivibile
- raccoglie nome chat, host, porta e modalita' rete
- crea l'utente admin iniziale e gli utenti base
- imposta owner e limite dell'archivio privato
- genera automaticamente le chiavi VAPID per le Web Push
- scrive `.env`
- scrive `config/chat-users.json`
- crea `data/setup-complete.json`
- genera:
  - `data/setup-generated/fastify-api.service`
  - `data/setup-generated/nginx.chat.conf`
  - `data/setup-generated/cloudflared.config.yml`

Quando il setup e' completato, `/setup` si disattiva e la app torna a mostrare la chat normale.

Nota pratica:

- di default `/setup` e' accessibile solo da rete locale
- se vuoi forzarlo da remoto, puoi esportare `SETUP_ALLOW_REMOTE=1`

## Configurazione

### Utenti

Il file utenti e' esterno al codice:

`config/chat-users.json`

Esempio:

```json
[
  { "username": "Giovanni", "password": "change-me-giovanni", "role": "admin" },
  { "username": "Cabras", "password": "change-me-cabras", "role": "user" }
]
```

### Variabili ambiente

Le principali sono gia' documentate in [.env.example](/Users/tonga/Documents/GitHub/cabras-chat/.env.example):

- `HOST`, `PORT`
- `CHAT_USERS_FILE`
- `TOKEN_SECRET`
- `DEFAULT_ADMIN_USERNAME`
- `DEFAULT_ROOM_NAME`
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

## Cloudflare

Se vuoi esporre la chat su Internet senza aprire direttamente porte sulla Raspberry, il modo piu' pratico e' usare Cloudflare Tunnel con `cloudflared`.

Scenario tipico:

- app Node su `127.0.0.1:3000`
- `cloudflared` sulla Raspberry
- hostname pubblico tipo `chat.example.com`
- nessun port forwarding diretto verso casa

### Cosa ti serve prima

- un account Cloudflare
- un dominio gestito da Cloudflare
- il progetto gia' funzionante in locale su `http://127.0.0.1:3000/chat`

### Flusso consigliato

1. aggiungi il dominio a Cloudflare se non e' gia' li'
2. installa `cloudflared` sulla Raspberry seguendo la guida ufficiale
3. autentica `cloudflared` con il tuo account Cloudflare
4. crea un tunnel dedicato, per esempio `cabras-chat`
5. collega un hostname pubblico al tunnel, per esempio `chat.example.com`
6. configura l'ingress del tunnel verso `http://127.0.0.1:3000`
7. installa `cloudflared` come servizio systemd

### Comandi tipici

Dopo aver installato `cloudflared`:

```bash
cloudflared tunnel login
cloudflared tunnel create cabras-chat
cloudflared tunnel route dns cabras-chat chat.example.com
```

Config di esempio in `/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /home/giovanni/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: chat.example.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

Poi:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

Se usi il wizard, trovi gia' una base pronta in:

`data/setup-generated/cloudflared.config.yml`

### Cloudflare e nginx

Hai due opzioni sensate:

- tunnel diretto verso `http://127.0.0.1:3000`
- tunnel verso `nginx`, se vuoi usare nginx anche per altre regole locali

Se usi solo la chat, il tunnel diretto verso Fastify e' spesso la scelta piu' semplice.

### DNS e hostname

Con il comando `cloudflared tunnel route dns` Cloudflare crea il record DNS necessario per l'hostname pubblico associato al tunnel.

Esempio:

- hostname pubblico: `chat.example.com`
- servizio locale: `http://127.0.0.1:3000`

### WebSocket e chat realtime

La chat usa WebSocket su `/chat/ws`. Con Cloudflare Tunnel non serve una configurazione speciale aggiuntiva lato app: il tunnel inoltra il traffico HTTP/WebSocket verso il servizio locale configurato.

### Verifica finale

Prima controlla in locale:

```bash
curl http://127.0.0.1:3000/health
```

Poi verifica dal dominio pubblico:

```bash
curl -I https://chat.example.com/chat
```

Controlli utili:

- `sudo systemctl status fastify-api`
- `sudo systemctl status cloudflared`
- `journalctl -u cloudflared -f`
- `journalctl -u fastify-api -f`

### Note pratiche

- se usi PWA, APK e notifiche, il dominio pubblico stabile e' importante
- se cambi hostname, aggiorna eventuali riferimenti Android/FCM e link pubblici
- se vuoi protezione extra, puoi aggiungere in Cloudflare Access una policy davanti al dominio, ma per una chat pubblica di solito non serve

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
