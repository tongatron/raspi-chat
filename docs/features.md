# Features

## Private and public rooms

Rooms are **closed membership** by default: only the creator or an admin can add members (from the web client or via `POST /chat/rooms/:roomId/members`).

A user can also create a **public room**: any authenticated user can discover it and join on their own, without being invited.

- From the web client: **Rooms → + New room...** menu, check "Public room (anyone can find and join it)".
- To discover them: **Rooms → ⌘ Browse public rooms...** menu lists every public room with its member count; the **Join** button adds the user immediately (no approval needed).
- Via API: `POST /chat/my-rooms` accepts `{ name, members, isPublic: true }`; `GET /chat/public-rooms` lists public rooms; `POST /chat/public-rooms/:roomId/join` performs the join.

## Attachments: "+" menu, files, and location

The **+** button in the compose bar opens a menu with two choices:

- **Attach file** — opens the file picker, uploads to `/chat/upload` (images, video, audio, PDF, Office documents, text, zip). Images/video/audio get dedicated rendering in chat; other files show up as a downloadable link.
- **Send location** — uses the browser's Geolocation API and sends a `geo:<lat>,<lng>` message, rendered as a clickable card with a link to OpenStreetMap. Requires a secure context (HTTPS or localhost): on a Raspberry served over plain HTTP on the LAN, it may not be available.

## Favorite messages

Every message has a star in its meta row: clicking it marks it as a favorite. This is a **per-user private** state (not visible to other room members), persisted server-side and reloaded with the message history. The **Settings → Favorites** view lists the favorites for the active room; clicking one takes you back to the chat, scrolled to the original message.

## Encryption and backups

### Encrypting `chat.db`

By default, `chat.db` is a plain SQLite file. Set `CHAT_DB_KEY` to encrypt it at rest (messages, password hashes, invites). The **same key** also encrypts attachments in `data/uploads/`. It's **opt-in**: without a key, behavior stays unchanged.

```bash
# generate a strong key and add it to .env (git-ignored)
echo "CHAT_DB_KEY=$(openssl rand -hex 32)" >> .env

# encrypt an existing plaintext chat.db (creates a .plain.bak backup first)
CHAT_DB_KEY=... node ops/encrypt-db.js

# encrypt existing plaintext attachments (optional; backup in uploads.plain.bak/)
CHAT_DB_KEY=... node ops/encrypt-uploads.js
```

⚠️ **Keep the key outside the Pi** (password manager/backup). If you lose `CHAT_DB_KEY`, encrypted data is unrecoverable.

### Backup and restore

Only `admin` users can download or restore the database.

**From the web panel** (⚙ → *Admin* → *Backup & Restore*):
- **⬇ Download backup** — downloads `chat.db` as-is (`GET /chat/admin/backup`).
- **⬆ Restore from file** — uploads a `.db` file and overwrites the current database (`POST /chat/admin/restore`); asks for confirmation because it **overwrites all current data and restarts the server**.

**Via curl** (needs an admin token from `POST /chat/login`):

```bash
curl -H "X-Chat-Username: Admin" -H "X-Chat-Token: $TOKEN" \
  http://127.0.0.1:3000/chat/admin/backup -o chat-backup.db

curl -X POST -H "X-Chat-Username: Admin" -H "X-Chat-Token: $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @chat-backup.db \
  http://127.0.0.1:3000/chat/admin/restore
```

Notes:
- The backup is encrypted if `CHAT_DB_KEY` is set: keep it with the same care as the key.
- Restore only accepts a file readable with the encryption currently configured on the server; otherwise it's rejected (400). Before overwriting, the server still saves `chat.db.bak`.
- Restore restarts the process: under systemd it comes back on its own, with plain `npm start` it needs a manual restart.

## Web Push notifications

The setup wizard automatically generates VAPID keys. Notifications work as standard Web Push, both from the browser and from the Android app.

## Android app (APK)

Besides the PWA, the chat is also available as a native Android app via **TWA** (Trusted Web Activity): an APK that wraps the PWA, meant for personal sideload installation, without the Play Store.

**Installing on your phone:** open `https://<domain>/chat/app.apk` in the browser, download and install it (requires enabling "Install unknown apps"), grant the notification permission, and set the app's battery mode to **"Unrestricted"** for reliable notifications.

The APK needs to be placed on the server at `data/app.apk`; the APK↔domain association is served via `config/assetlinks.json`.

**Rebuilding the APK** (only needed if the icon, name, or colors change; the TWA project is generated with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)):

```bash
cd raspi-chat-android
BUBBLEWRAP_KEYSTORE_PASSWORD="$(cat signing-password.txt)" \
BUBBLEWRAP_KEY_PASSWORD="$(cat signing-password.txt)" \
  bubblewrap build
scp app-release-signed.apk giovanni@raspi4.local:/srv/apps/raspi-chat/data/app.apk
```

⚠️ Keep `android.keystore` and its password safe: without them, you can no longer publish updates on top of the existing app (only uninstall + reinstall would remain).
