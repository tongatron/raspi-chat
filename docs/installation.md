# Installation

## Minimum requirements

- Node.js 20+
- npm
- Linux or Raspberry Pi OS
- reverse proxy optional but recommended

## Local installation

```bash
git clone https://github.com/tongatron/raspi-chat.git
cd raspi-chat
npm install
npm run check
npm start
```

If you haven't configured the project yet, open `http://127.0.0.1:3000/setup`.
If you already have `.env` and `config/chat-users.json`, the chat is available at `http://127.0.0.1:3000/chat`.

## Installation on Raspberry Pi

```bash
git clone https://github.com/tongatron/raspi-chat.git /srv/apps/raspi-chat
cd /srv/apps/raspi-chat
bash ops/install-rpi.sh
```

Then:
1. start the app once with `npm start`
2. open the wizard at `http://raspi4.local:3000/setup` (or the Raspberry Pi's IP)
3. complete the web steps
4. use the files generated in `data/setup-generated/`
5. enable `systemd`

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now raspi-chat
sudo systemctl status raspi-chat
journalctl -u raspi-chat -f
```

## Guided web setup

Recommended path for a first install:

1. `bash ops/install-rpi.sh`
2. `npm start`
3. open `/setup`
4. fill in the steps
5. run `sudo bash data/setup-generated/finish-setup.sh`

The `/setup` wizard:
- checks that the folder is writable
- collects chat name, host, port, and network mode
- creates the initial admin user and base users
- automatically generates VAPID keys for Web Push
- writes `.env` and `config/chat-users.json`
- creates `data/setup-complete.json`
- generates `raspi-chat.service`, `nginx.chat.conf`, `cloudflared.config.yml`, and the executable script `finish-setup.sh`

Once setup is complete, `/setup` disables itself and the app goes back to showing the normal chat. With `cloudflare` mode, you still need to manually complete `cloudflared.config.yml` (it needs the tunnel ID) and start `cloudflared` separately: the wizard can't automate that part.

By default `/setup` is only reachable from the local network; to force it remotely, export `SETUP_ALLOW_REMOTE=1`.

## User configuration

The users file lives outside the codebase: `config/chat-users.json`

```json
[
  { "username": "Giovanni", "password": "change-me-giovanni", "role": "admin" },
  { "username": "Operatore", "password": "change-me-operatore", "role": "superuser" },
  { "username": "Cabras", "password": "change-me-cabras", "role": "user" }
]
```

## Environment variables

The main ones are documented in `.env.example`:

- `HOST`, `PORT`
- `CHAT_USERS_FILE`
- `CHAT_DB_PATH`
- `CHAT_DB_KEY` — at-rest encryption, see [Features → Encryption and backups](features.md#encryption-and-backups)
- `TOKEN_SECRET`
- `DEFAULT_ADMIN_USERNAME`
- `DEFAULT_ROOM_NAME`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`
