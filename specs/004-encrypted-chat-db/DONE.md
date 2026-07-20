# Spec 004 — Cifratura at-rest di chat.db · Fatto

**Commit:** `2711041` — *feat(chat): cifratura at-rest di chat.db via CHAT_DB_KEY (spec 004)*
**Data:** 2026-07-18 · **Autore:** Giovanni Bindi

## Obiettivo
Cifrare `chat.db` a riposo (messaggi, hash password, inviti, subscription push) in
modo trasparente per l'app, così che il file su disco non sia leggibile senza chiave
(backup, furto della SD, accesso al filesystem). Feature **opt-in**: senza chiave il
comportamento resta identico alla baseline.

## Cosa è cambiato
| File | Modifica |
|------|----------|
| `package.json` | `better-sqlite3` sostituito dal drop-in `better-sqlite3-multiple-ciphers` (API identica + `PRAGMA key`). |
| `src/routes/chat.js` | Nuova `openChatDatabase(path, key)`: apre con `PRAGMA key` se `CHAT_DB_KEY` è presente, con probe immediato per errore chiaro su chiave errata. Esportata per riuso. |
| `src/db.js` | Passato allo stesso drop-in; `app.db` resta in chiaro (fuori scope). |
| `ops/encrypt-db.js` | Script di migrazione one-shot: backup `.plain.bak` automatico → `PRAGMA rekey` in-place → verifica conteggi. Idempotente. |
| `tests/encryption.test.js` | 6 test: cifratura su disco, riapertura con chiave, chiave errata/assente, fallback in chiaro. |
| `.env.example`, `README.md`, `README.it.md` | Documentano `CHAT_DB_KEY`, generazione chiave e avviso perdita chiave. |

## Come usarla
```bash
# 1. genera la chiave e mettila nel .env (git-ignorato)
echo "CHAT_DB_KEY=$(openssl rand -hex 32)" >> .env

# 2. cifra il chat.db esistente (app FERMA)
CHAT_DB_KEY=... node ops/encrypt-db.js

# 3. riavvia l'app
```

## Verifica
- Suite **12/12 verde** — `npm run check` + `npm test`.
- Migrazione testata end-to-end: DB in chiaro → cifrato, riapertura con chiave OK,
  idempotenza alla riesecuzione, testo in chiaro assente dal file.

## Deploy sul Raspberry
1. `npm install` sul Pi (modulo nativo → rebuild per ARM, come `better-sqlite3`).
2. Genera/salva `CHAT_DB_KEY` (anche nel gestore password: se persa, dati irrecuperabili).
3. `CHAT_DB_KEY=... node ops/encrypt-db.js` ad app ferma, poi riavvio.

## Fuori scope
- Cifratura di `DB_PATH` (app.db/mail) e degli allegati in `data/uploads/`.

## Attivazione in produzione — 2026-07-20
La feature era pronta dal 18/07 ma non attiva su `raspi4` (`.env` senza `CHAT_DB_KEY`).
Attivata oggi:
1. Chiave generata sul Pi (`openssl rand -hex 32`), consegnata all'operatore per il
   password manager — non conservata altrove nella repo o nei log.
2. `raspi-chat.service` fermato, `node ops/encrypt-db.js` eseguito: backup automatico
   `chat.db.plain.bak`, poi `PRAGMA rekey` in-place. Verifica conteggi ok (6 utenti,
   7506 messaggi, invariati prima/dopo).
3. `CHAT_DB_KEY` aggiunta a `.env`, servizio riavviato: log puliti, nessun errore di
   apertura DB, traffico reale servito subito dopo il riavvio.
4. Operatore ha verificato manualmente login e apertura di un vecchio allegato:
   confermato funzionante.
5. Backup in chiaro (`chat.db.plain.bak`) cancellato dopo la verifica.

Vedi anche [specs/007-encrypted-attachments/DONE.md](../007-encrypted-attachments/DONE.md)
per l'attivazione della cifratura degli allegati, fatta nella stessa sessione.
