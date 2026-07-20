# Spec 007 — Cifratura at-rest degli allegati · Fatto

**Data:** 2026-07-18 · **Autore:** Giovanni Bindi
**Commit:** `56dceaa` — *feat(chat): cifratura at-rest degli allegati (data/uploads/) + test (spec 007)*

## Obiettivo
Cifrare a riposo i file caricati in chat (`data/uploads/`: immagini, video, audio, PDF,
documenti) riusando la stessa chiave `CHAT_DB_KEY` di `chat.db` (spec 004). Chiude in modo
**utile** il filone crittografico: a differenza di `DB_PATH` (solo tabella demo `items`,
scartato), gli allegati sono dati utente reali. Opt-in: senza chiave, tutto resta come la
baseline.

## Cosa è cambiato
| File | Modifica |
|------|----------|
| `src/attachment-crypto.js` | **Nuovo modulo**: `encryptBuffer`/`decryptBuffer`/`isEncrypted`. AES-256-GCM, chiave = `SHA-256(CHAT_DB_KEY)`, IV random 12B per file, tag 16B. Layout su disco `MAGIC(6)‖IV(12)‖TAG(16)‖ciphertext`. `decryptBuffer` fa passthrough dei buffer senza MAGIC (allegati in chiaro legacy). |
| `src/routes/chat.js` | `POST /chat/upload`: con `CHAT_DB_KEY` bufferizza (`data.toBuffer()`) e scrive cifrato; senza chiave, streaming in chiaro come prima. `GET /chat/images/:filename`: con chiave legge e decifra in memoria (passthrough legacy), 500 se non decifrabile; senza chiave, streaming come prima. + import del modulo. |
| `ops/encrypt-uploads.js` | **Nuovo** script di migrazione: cifra in-place gli allegati in chiaro esistenti, idempotente (salta i già cifrati), backup in `data/uploads.plain.bak/`. |
| `tests/attachment-crypto.test.js` | **7 test** del modulo: header MAGIC/no-plaintext, round-trip, chiave errata, manomissione, passthrough, `isEncrypted`, IV random. |
| `tests/upload-encryption.test.js` | **2 test** d'integrazione (app reale via `inject`): login + upload cifrato su disco + serve decifrato byte-identico. |
| `package.json` | `check`: aggiunti `node --check` per i due nuovi sorgenti. |
| `README.md` / `README.it.md` / `.env.example` | Documentato che `CHAT_DB_KEY` copre anche gli allegati + comando `ops/encrypt-uploads.js`. |

## Come funziona
- **Upload** (chiave attiva): il file viene bufferizzato (fino a `UPLOAD_MAX_BYTES` 50 MB,
  perché il tag GCM si verifica a fine file), cifrato e scritto in `data/uploads/`.
- **Serve** (chiave attiva): il file viene letto e decifrato in memoria; mime e
  Content-Disposition restano invariati. Un file senza MAGIC (in chiaro legacy) passa
  invariato → attivare la chiave non rompe gli allegati storici.
- **Integrità**: GCM autentica i dati; chiave errata o file manomesso → `decryptBuffer`
  lancia e il serve risponde 500 invece di servire byte corrotti.
- **Senza chiave**: upload/serve in streaming in chiaro, identici alla baseline.

## Verifica
- Suite **38/38 verde** — `npm run check` + `npm test` (erano 29; +7 modulo, +2 integrazione).
- End-to-end confermato: con `CHAT_DB_KEY`, il file su disco **non** contiene i byte in
  chiaro e `GET /chat/images` restituisce l'originale byte-identico.

## Fuori scope
- Cifratura dei background statici in `public/backgrounds/` (asset app, non dati utente).
- Rotazione della chiave; streaming cifrato (i file sono bufferizzati in RAM fino a 50 MB).
- Cifratura di `DB_PATH` (solo tabella demo `items`, valore trascurabile — scartata dopo
  verifica del contenuto).

## Attivazione in produzione — 2026-07-20
Attivata insieme alla spec 004 (stessa `CHAT_DB_KEY`), nella stessa sessione operativa:
1. `raspi-chat.service` fermo, `node ops/encrypt-uploads.js` eseguito su
   `data/uploads/`: 975 file su 975 cifrati (0 già cifrati), backup di ognuno in
   `data/uploads.plain.bak/` prima della conversione.
2. Servizio riavviato con `CHAT_DB_KEY` in `.env`; operatore ha aperto in chat un
   vecchio allegato e confermato che viene servito correttamente decifrato.
3. Backup in chiaro (`data/uploads.plain.bak/`, ~637 MB) cancellato dopo la verifica.

Vedi anche [specs/004-encrypted-chat-db/DONE.md](../004-encrypted-chat-db/DONE.md) per
il dettaglio dell'attivazione lato `chat.db`.
