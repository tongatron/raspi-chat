# Spec 005 — Restore consapevole della cifratura · Fatto

**Commit:** `01c0859` — *feat(chat): restore consapevole della cifratura + test (spec 005)*
**Data:** 2026-07-18 · **Autore:** Giovanni Bindi

## Obiettivo
Chiudere la regressione introdotta dalla spec 004: con `CHAT_DB_KEY` attiva il
`chat.db` su disco è cifrato e **non** inizia con l'header `SQLite format 3`, quindi
`POST /chat/admin/restore` (che validava proprio quei magic byte) rifiutava i backup
cifrati prodotti da `GET /chat/admin/backup`. Il ciclo backup→restore era di fatto
rotto su ogni deployment cifrato.

## Cosa è cambiato
| File | Modifica |
|------|----------|
| `src/routes/chat.js` | Nuova `validateRestorePayload(data, key)`: scrive il payload in un file temp, prova ad aprirlo con `openChatDatabase(tmp, CHAT_DB_KEY)` e sonda lo schema chat (tabella `messages`). Sostituisce il check magic-byte. Esportata per i test. Il restore ora usa questa validazione e rimuove i `-wal`/`-shm` del vecchio DB dopo lo swap. |
| `tests/restore.test.js` | 8 test: cifrato+chiave giusta ok, chiave errata/assente ko, in chiaro baseline ok, DB senza tabella `messages` ko, file <1024 byte ko, buffer non-SQLite ko. |
| `specs/005-restore-encrypted-backup/spec.md` | Specifica della feature. |

## Come funziona
- **Backup** (`GET /chat/admin/backup`): invariato — esporta il file `chat.db` così
  com'è. Su deployment cifrato il backup è cifrato (confidenzialità voluta da spec 004).
- **Restore** (`POST /chat/admin/restore`): accetta il file solo se apribile con la
  configurazione di cifratura **corrente** (in chiaro senza chiave, cifrato con quella
  chiave se impostata) e con lo schema chat. Rifiuta con 400 chiaro chiave errata,
  backup cifrato caricato senza chiave, file non-SQLite o privo di `messages`.

## Verifica
- Suite **20/20 verde** — `npm run check` + `npm test` (erano 12; +8 test restore).
- Pre-condizione verificata: un DB cifrato non ha l'header `SQLite format 3`, quindi il
  vecchio check lo avrebbe rifiutato; con la nuova validazione è accettato.

## Fuori scope
- Cifratura di `DB_PATH` (app/mail) e degli allegati in `data/uploads/` (come spec 004).
- Consistenza del backup rispetto al WAL attivo lato sorgente (il backup copia solo il
  file principale `chat.db`).
