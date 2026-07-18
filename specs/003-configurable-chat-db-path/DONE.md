# Spec 003 — CHAT_DB_PATH configurabile · Fatto

**Commit:** `4ca5765` — *feat(chat): CHAT_DB_PATH configurabile + test login valido (spec 003)*
**Data:** 2026-07-18 · **Autore:** Giovanni Bindi

## Obiettivo
Rendere configurabile il path di `chat.db` (default invariato) per poter testare
il login con credenziali valide in modo ermetico, senza toccare i dati di
produzione. Prerequisito per la futura cifratura at-rest.

## Cosa è cambiato
| File | Modifica |
|------|----------|
| `src/routes/chat.js` | `DB_PATH` legge `process.env.CHAT_DB_PATH` con fallback al path storico `data/chat.db`. Nessun impatto sul deploy di produzione. |
| `tests/login.test.js` | Nuovo test: login con credenziali valide (200 + token) e password errata (401), su DB e utenti isolati in tempdir. |
| `.env.example` | Documenta la variabile `CHAT_DB_PATH`. |
| `specs/003-configurable-chat-db-path/spec.md` | Specifica della feature. |

## Come usarla
```bash
# produzione: nessuna azione, resta data/chat.db
# test / dev isolato:
CHAT_DB_PATH=/tmp/test-chat.db npm start
```

## Verifica
Suite **6/6 verde** — `npm run check` + `npm test`.

## Impatto
- Nessuna migrazione né breaking change: default identico al comportamento storico.
- Sblocca test ermetici del percorso di autenticazione.
- Abilita il prossimo passo: cifratura del DB at-rest.
