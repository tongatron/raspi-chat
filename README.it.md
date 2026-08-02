<div align="center">

<img src="public/assets/logo-v4.png" alt="raspi-chat" width="120" />

# raspi-chat

**Chat web self-hosted pensata per Raspberry Pi e piccoli home server.**

Realtime, PWA, senza framework — leggera abbastanza per un vecchio Pi, hackerabile abbastanza da renderla tua.

[![CI](https://github.com/tongatron/raspi-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/tongatron/raspi-chat/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D20-3C873A.svg?logo=node.js&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8.svg)
![Raspberry Pi](https://img.shields.io/badge/Raspberry%20Pi-ready-C51A4A.svg?logo=raspberrypi&logoColor=white)
![License](https://img.shields.io/badge/license-ISC-blue.svg)

[**Demo live**](https://chat.tongatron.org/chat) · [Documentazione](#-documentazione) · [🇬🇧 Read in English](README.md)

<br />

<img src="public/assets/screenshot-desktop.png" alt="raspi-chat su desktop" width="620" />
<br />
<img src="public/assets/screenshot-mobile.png" alt="raspi-chat su mobile" width="260" />

</div>

---

## Indice

- [Perché raspi-chat](#perché-raspi-chat)
- [Funzionalità](#-funzionalità)
- [Avvio rapido](#-avvio-rapido)
- [Documentazione](#-documentazione)
- [Stack tecnologico](#-stack-tecnologico)
- [Struttura del progetto](#-struttura-del-progetto)
- [Sicurezza](#-sicurezza)
- [Test & CI](#-test--ci)
- [Roadmap](#-roadmap)
- [Licenza](#-licenza)

## Perché raspi-chat

`raspi-chat` ha senso se vuoi:

- una **chat semplice da self-hostare** per famiglia, amici o una piccola comunità
- qualcosa di **più leggero di** Matrix, Rocket.Chat o Slack/Discord
- un'app che **gira bene anche su Raspberry Pi datati**
- un **codebase chiaro e senza framework**, che puoi davvero leggere e adattare

Non è un messenger enterprise. È un codebase pragmatico, piccolo e facile da modificare — con poche dipendenze esterne, storage locale e un deploy semplice.

## ✨ Funzionalità

- 💬 **Messaggi in tempo reale** via WebSocket (`/chat/ws`), con lista utenti online
- 🔒 **Stanze private e pubbliche** — stanze a membership chiusa di default, più stanze pubbliche che chiunque può scoprire e a cui unirsi da solo
- 📎 **Allegati e posizione** — un menu `+` per caricare immagini, video, audio, PDF, documenti Office, testo e zip (renderizzati inline), o condividere la posizione come card OpenStreetMap
- 🔗 **Anteprima dei link** per gli URL incollati in chat
- ⭐ **Messaggi preferiti** — segnalibri privati per utente, con una vista Preferiti dedicata
- 📅 **Avvisi di ingresso e separatori di data** — messaggio di sistema centrato "utente entrato" e divisori di data una volta al giorno
- 🔔 **Notifiche Web Push** — push VAPID standard, dal browser e dall'app Android
- 📱 **PWA + app Android** — PWA installabile e APK TWA in sideload (senza Play Store)
- 🖥️ **Client CLI da terminale** — chatta dalla shell, con riconnessione automatica e coda di invio offline
- 🔐 **Cifratura at-rest (opt-in)** — cifra `chat.db` e gli allegati caricati con un'unica `CHAT_DB_KEY`
- 💾 **Backup e ripristino admin** — scarica e ripristina il database dal pannello web o via `curl`, consapevole della cifratura
- 🧙 **Setup guidato via web** — un wizard `/setup` che scrive la configurazione e genera i file per systemd, nginx e Cloudflare
- 👥 **Ruoli** — `admin`, `superuser` e `user`

> Vedi la [**guida alle funzionalità**](docs/features.md) per il dettaglio di ciascuna.

## 🚀 Avvio rapido

### In locale

```bash
git clone https://github.com/tongatron/raspi-chat.git
cd raspi-chat
npm install
npm run check
npm start
```

- Non ancora configurato? Apri **`http://127.0.0.1:3000/setup`** e segui il wizard.
- Hai già `.env` e `config/chat-users.json`? La chat è su **`http://127.0.0.1:3000/chat`**.

### Su Raspberry Pi

```bash
git clone https://github.com/tongatron/raspi-chat.git /srv/apps/raspi-chat
cd /srv/apps/raspi-chat
bash ops/install-rpi.sh
```

Poi avvia l'app una volta (`npm start`), apri `/setup`, completa i passaggi ed esegui
`sudo bash data/setup-generated/finish-setup.sh` per installare e abilitare il servizio systemd.

> Procedura completa — wizard guidato, utenti e variabili d'ambiente — nella [**guida all'installazione**](docs/installation.md).

## 📖 Documentazione

La documentazione dettagliata è in [`docs/`](docs/) (in inglese). Parti da qui:

| Guida | Cosa contiene |
|-------|---------------|
| 📥 [Installation](docs/installation.md) | Setup locale e su Raspberry Pi, wizard web guidato, utenti, variabili d'ambiente |
| ✨ [Features](docs/features.md) | Stanze, allegati, preferiti, cifratura, backup/ripristino, notifiche, app Android |
| 🖥️ [CLI client](docs/cli.md) | Usare la chat da terminale |
| 🚀 [Deploy](docs/deploy.md) | systemd, nginx, Cloudflare Tunnel |
| 🛠️ [Development](docs/development.md) | Endpoint API, test, verifiche rapide |
| 🗺️ [Roadmap](docs/roadmap.md) | Prossimi passi previsti |

La cartella `docs/` è strutturata anche come indice [GitBook](docs/SUMMARY.md).

## 🧱 Stack tecnologico

- **Backend** — [Node.js](https://nodejs.org/) 20+ · [Fastify 5](https://fastify.dev/) · WebSocket [`ws`](https://github.com/websockets/ws)
- **Storage** — SQLite locale via [`better-sqlite3-multiple-ciphers`](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) (cifratura at-rest trasparente)
- **Frontend** — HTML/CSS/JS senza framework, **PWA** installabile con service worker
- **Notifiche** — [Web Push](https://developer.mozilla.org/docs/Web/API/Push_API) con VAPID ([`web-push`](https://github.com/web-push-libs/web-push))
- **Android** — TWA generata con [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) che incapsula la PWA
- **Tooling** — nessun framework di test: runner integrato `node --test` + CI su GitHub Actions

## 🗂️ Struttura del progetto

```text
raspi-chat/
├── src/
│   ├── app.js        Istanza Fastify e registrazione dei plugin
│   ├── chat/         La feature chat, un modulo per responsabilità
│   │                   database · auth · serializers · presence · push
│   │                   attachments · rooms · link-preview · system-stats
│   ├── lib/          Helper condivisi tra le route
│   ├── routes/
│   │   ├── chat/     Rotte chat per gruppo — sottili, delegano a src/chat/
│   │   │               pwa · session · rooms · messages · push · admin
│   │   │               pages · ws
│   │   └── ...       Landing page e wizard di setup
│   └── attachment-crypto.js   Cifratura at-rest degli allegati
├── public/           Pagine HTML — solo markup, nessun CSS o JS inline
│   └── assets/
│       ├── chat/     Il client della chat, un file per responsabilità
│       └── *.css/js  Stili e script delle altre pagine
├── cli/              Client chat da terminale
├── ops/              Script di deploy, migrazioni di cifratura, syntax check
├── config/           Esempi di configurazione utenti e asset-link
├── docs/             Documentazione (GitBook)
├── specs/            Specifiche delle feature (una cartella per feature)
├── tests/            Suite node --test
├── .env.example
├── package.json
└── server.js
```

> La repo è la source of truth dell'app. **Non** contiene il tuo `.env` né `config/chat-users.json`: vengono creati in locale o dal wizard di setup.

## 🔐 Sicurezza

`chat.db` e gli allegati caricati possono essere cifrati **a riposo** con un'unica chiave opt-in:

```bash
# genera una chiave forte e mettila nel .env (git-ignorato)
echo "CHAT_DB_KEY=$(openssl rand -hex 32)" >> .env

# cifra database e allegati in chiaro esistenti (ognuno crea prima un backup)
CHAT_DB_KEY=... node ops/encrypt-db.js
CHAT_DB_KEY=... node ops/encrypt-uploads.js
```

Senza chiave il comportamento resta invariato (in chiaro, baseline). **Conserva `CHAT_DB_KEY` fuori dal Pi**: se la perdi, i dati cifrati sono irrecuperabili. Dettagli e backup/ripristino admin nella [guida alle funzionalità](docs/features.md#encryption-and-backups).

> Sul deploy di riferimento (`raspi4`), la cifratura at-rest di `chat.db` e di tutti gli allegati è **attiva in produzione dal 2026-07-20**.

## 🧪 Test & CI

La suite usa il runner integrato di Node (nessuna dipendenza extra) ed esercita il livello HTTP con `app.inject()` in una directory temporanea isolata — non avvia mai un server né tocca i dati di produzione.

```bash
npm run lint    # ESLint — binding inutilizzati, global accidentali, codice morto
npm run check   # controllo sintattico di ogni file sorgente, senza dipendenze
npm test        # esegue la suite di test
```

Le stesse verifiche girano automaticamente a ogni push e pull request via [GitHub Actions](.github/workflows/ci.yml). Dalla v1.1 in poi, ogni nuova feature arriva con i propri test.

## 🗺️ Roadmap

I prossimi passi previsti sono tracciati in [`docs/roadmap.md`](docs/roadmap.md).

## 📄 Licenza

Rilasciato con licenza **ISC** — vedi [`LICENSE`](LICENSE).
