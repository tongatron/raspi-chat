# Funzionalità

## Stanze private e pubbliche

Le room sono a **membership chiusa** di default: solo il creatore o un admin può aggiungere membri (dal client web o via `POST /chat/rooms/:roomId/members`).

Un utente può anche creare una **room pubblica**: chiunque sia autenticato la può scoprire e unirsi da solo, senza essere invitato.

- Dal client web: menu **Rooms → + New room...**, spunta "Public room (anyone can find and join it)".
- Per scoprirle: menu **Rooms → ⌘ Browse public rooms...** elenca tutte le room pubbliche col numero di membri; il pulsante **Join** aggiunge l'utente immediatamente (nessuna approvazione richiesta).
- Via API: `POST /chat/my-rooms` accetta `{ name, members, isPublic: true }`; `GET /chat/public-rooms` elenca le room pubbliche; `POST /chat/public-rooms/:roomId/join` esegue il join.

## Allegati: menu "+", file e posizione

Il pulsante **+** nella barra di composizione apre un menu con due scelte:

- **Allega file** — apre il file picker, upload verso `/chat/upload` (immagini, video, audio, PDF, documenti Office, testo, zip). Le immagini/video/audio hanno un rendering dedicato in chat; gli altri file compaiono come link scaricabile.
- **Invia posizione** — usa la Geolocation API del browser e invia un messaggio `geo:<lat>,<lng>`, mostrato come card cliccabile con link a OpenStreetMap. Richiede un contesto sicuro (HTTPS o localhost): su un Raspberry servito in HTTP semplice sulla LAN potrebbe non essere disponibile.

## Messaggi preferiti

Ogni messaggio ha una stella nella riga meta: cliccandola lo marchi come preferito. È uno stato **privato per utente** (non visibile agli altri membri della stanza), persistito lato server e ricaricato nello storico. La vista **Impostazioni → Favorites** elenca i preferiti della stanza attiva; cliccandone uno si torna alla chat scorrendo al messaggio originale.

## Cifratura at-rest e backup

### Cifratura di `chat.db`

Di default `chat.db` è un file SQLite in chiaro. Imposta `CHAT_DB_KEY` per cifrarlo a riposo (messaggi, hash password, inviti). La **stessa chiave** cifra anche gli allegati in `data/uploads/`. È **opt-in**: senza chiave il comportamento resta invariato.

```bash
# genera una chiave forte e mettila nel .env (git-ignorato)
echo "CHAT_DB_KEY=$(openssl rand -hex 32)" >> .env

# cifra un chat.db in chiaro esistente (crea prima un backup .plain.bak)
CHAT_DB_KEY=... node ops/encrypt-db.js

# cifra gli allegati in chiaro esistenti (opzionale; backup in uploads.plain.bak/)
CHAT_DB_KEY=... node ops/encrypt-uploads.js
```

⚠️ **Conserva la chiave fuori dal Pi** (gestore password/backup). Se perdi `CHAT_DB_KEY`, i dati cifrati sono irrecuperabili.

### Backup e ripristino

Solo gli utenti `admin` possono scaricare o ripristinare il database.

**Dal pannello web** (⚙ → *Admin* → *Backup & Restore*):
- **⬇ Download backup** — scarica `chat.db` così com'è (`GET /chat/admin/backup`).
- **⬆ Restore from file** — carica un `.db` e sovrascrive il database corrente (`POST /chat/admin/restore`); chiede conferma perché **sovrascrive tutti i dati e riavvia il server**.

**Via curl** (serve un token admin da `POST /chat/login`):

```bash
curl -H "X-Chat-Username: Admin" -H "X-Chat-Token: $TOKEN" \
  http://127.0.0.1:3000/chat/admin/backup -o chat-backup.db

curl -X POST -H "X-Chat-Username: Admin" -H "X-Chat-Token: $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @chat-backup.db \
  http://127.0.0.1:3000/chat/admin/restore
```

Note:
- Il backup è cifrato se `CHAT_DB_KEY` è impostata: conservalo con la stessa cura della chiave.
- Il restore accetta solo un file leggibile con la cifratura attualmente configurata sul server; altrimenti viene rifiutato (400). Prima di sovrascrivere, il server salva comunque `chat.db.bak`.
- Il restore riavvia il processo: su systemd riparte da solo, con `npm start` semplice va riavviato a mano.

## Notifiche Web Push

Il wizard di setup genera automaticamente le chiavi VAPID. Le notifiche funzionano come Web Push standard, sia da browser che dall'app Android.

## App Android (APK)

Oltre alla PWA, la chat è disponibile come app Android nativa tramite **TWA** (Trusted Web Activity): un APK che incapsula la PWA, pensato per installazione personale tramite sideload, senza Play Store.

**Installazione sul telefono:** apri `https://<dominio>/chat/app.apk` nel browser, scarica e installa (serve abilitare "Installa app sconosciute"), concedi il permesso notifiche, e imposta l'app su batteria **"Senza restrizioni"** per notifiche affidabili.

L'APK va posizionato sul server in `data/app.apk`; l'associazione APK↔dominio è servita da `config/assetlinks.json`.

**Rigenerare l'APK** (necessario solo se cambiano icona, nome o colori; progetto TWA generato con [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)):

```bash
cd raspi-chat-android
BUBBLEWRAP_KEYSTORE_PASSWORD="$(cat signing-password.txt)" \
BUBBLEWRAP_KEY_PASSWORD="$(cat signing-password.txt)" \
  bubblewrap build
scp app-release-signed.apk giovanni@raspi4.local:/srv/apps/raspi-chat/data/app.apk
```

⚠️ Conserva con cura `android.keystore` e la relativa password: senza non è più possibile pubblicare aggiornamenti sopra l'app esistente.
