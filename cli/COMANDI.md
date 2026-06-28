# Comandi CLI — pronti da copiare

Guida rapida per usare la chat dal terminale. Per i dettagli completi vedi [README.md](README.md).

---

## 1. Dal tuo Mac → chat pubblica (consigliato)

Non serve avviare niente: il server gira già sulla Raspberry.

```bash
cd /Users/tonga/Documents/GitHub/raspi-chat
node cli/chat-cli.js --url https://chat.tongatron.org
```

Poi inserisci **username** e **password** del tuo account reale.
Se ometti `--room`, la CLI ti elenca le tue room e te le fa scegliere.

---

## 2. Direttamente sulla Raspberry (in locale)

```bash
ssh giovanni@raspberrypi.local
cd /srv/apps/raspi-chat
npm run cli
```

(`npm run cli` punta a `http://localhost:3000`.)

---

## 3. Server locale di sviluppo (sul Mac)

Serve solo se vuoi testare un backend locale. Richiede **due terminali**.

**Terminale A — avvia il backend (lascialo aperto):**
```bash
cd /Users/tonga/Documents/GitHub/raspi-chat
npm start
```

**Terminale B — avvia la CLI:**
```bash
cd /Users/tonga/Documents/GitHub/raspi-chat
npm run cli
```

> ⚠️ Il DB locale (`data/chat.db`) è separato da quello della Pi: gli utenti
> vanno creati a parte in `config/chat-users.json` (vedi `config/chat-users.example.json`).

---

## Opzioni e scorciatoie

| Comando | Cosa fa |
|---------|---------|
| `node cli/chat-cli.js --help` | Mostra l'aiuto |
| `node cli/chat-cli.js --url <URL>` | Sceglie il server |
| `node cli/chat-cli.js --room <id>` | Entra in una room specifica (salta la scelta) |
| `npm run cli` | Avvia con i default (`http://localhost:3000`) |
| `npm run cli -- --room test` | Con `npm run`, gli argomenti vanno dopo `--` |

### Credenziali senza prompt (variabili d'ambiente)

```bash
RASPI_CHAT_USER="Giovanni" RASPI_CHAT_PASS="laTuaPassword" \
  node cli/chat-cli.js --url https://chat.tongatron.org
```

Altre variabili: `RASPI_CHAT_URL` (al posto di `--url`).

---

## Dentro la chat

- scrivi un messaggio e premi **Invio** per inviarlo
- `/quit` oppure `/exit` per uscire
- **Ctrl+C** per uscire in qualsiasi momento

La CLI si **riconnette da sola** se la rete cade, senza richiedere di nuovo le credenziali.
