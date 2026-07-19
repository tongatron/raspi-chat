# Installazione

## Requisiti minimi

- Node.js 20+
- npm
- Linux o Raspberry Pi OS
- reverse proxy opzionale ma consigliato

## Installazione locale

```bash
git clone https://github.com/tongatron/raspi-chat.git
cd raspi-chat
npm install
npm run check
npm start
```

Se non hai ancora configurato il progetto, apri `http://127.0.0.1:3000/setup`.
Se hai già `.env` e `config/chat-users.json`, la chat è disponibile su `http://127.0.0.1:3000/chat`.

## Installazione su Raspberry Pi

```bash
git clone https://github.com/tongatron/raspi-chat.git /srv/apps/raspi-chat
cd /srv/apps/raspi-chat
bash ops/install-rpi.sh
```

Poi:
1. avvia una volta l'app con `npm start`
2. apri il wizard su `http://raspi4.local:3000/setup` (o l'IP della Raspberry)
3. completa i passaggi web
4. usa i file generati in `data/setup-generated/`
5. abilita `systemd`

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now raspi-chat
sudo systemctl status raspi-chat
journalctl -u raspi-chat -f
```

## Setup guidato via web

Percorso consigliato per la prima installazione:

1. `bash ops/install-rpi.sh`
2. `npm start`
3. apri `/setup`
4. compila i passaggi
5. esegui `sudo bash data/setup-generated/finish-setup.sh`

Il wizard `/setup`:
- controlla che la cartella sia scrivibile
- raccoglie nome chat, host, porta e modalità rete
- crea l'utente admin iniziale e gli utenti base
- genera automaticamente le chiavi VAPID per le Web Push
- scrive `.env` e `config/chat-users.json`
- crea `data/setup-complete.json`
- genera `raspi-chat.service`, `nginx.chat.conf`, `cloudflared.config.yml` e lo script eseguibile `finish-setup.sh`

Quando il setup è completato, `/setup` si disattiva e l'app torna a mostrare la chat normale. Con la modalità `cloudflare` va comunque completato a mano `cloudflared.config.yml` (serve il tunnel ID) e avviato `cloudflared` separatamente: il wizard non può automatizzare quella parte.

Di default `/setup` è accessibile solo da rete locale; per forzarlo da remoto esporta `SETUP_ALLOW_REMOTE=1`.

## Configurazione utenti

Il file utenti è esterno al codice: `config/chat-users.json`

```json
[
  { "username": "Giovanni", "password": "change-me-giovanni", "role": "admin" },
  { "username": "Operatore", "password": "change-me-operatore", "role": "superuser" },
  { "username": "Cabras", "password": "change-me-cabras", "role": "user" }
]
```

## Variabili ambiente

Le principali sono documentate in `.env.example`:

- `HOST`, `PORT`
- `CHAT_USERS_FILE`
- `CHAT_DB_PATH`
- `CHAT_DB_KEY` — cifratura at-rest, vedi [Funzionalità → Cifratura e backup](funzionalita.md#cifratura-at-rest-e-backup)
- `TOKEN_SECRET`
- `DEFAULT_ADMIN_USERNAME`
- `DEFAULT_ROOM_NAME`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`
