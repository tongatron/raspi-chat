# Spec 006 — Coda dei messaggi in uscita nella CLI · Fatto

**Data:** 2026-07-18 · **Autore:** Giovanni Bindi
**Commit:** `7b93021` — *feat(cli): coda messaggi in uscita (outbox) + reflush alla riconnessione + test (spec 006)*

## Obiettivo
Portare nel client **CLI** la coda in uscita (`outbox`) già presente nel client web:
un messaggio scritto mentre la connessione realtime è caduta non viene più scartato, ma
accodato e rispedito automaticamente alla riconnessione, senza che l'utente lo riscriva o
riprema Invio. Chiude il divario di comportamento fra CLI e web sul caso d'uso tipico
(rete domestica instabile / Raspberry Pi, spec 001 US4).

## Contesto (perché ora)
Indagando i "Prossimi passi consigliati" del README è emerso che l'outbox **era già
implementato lato web** (`public/chat.html`: `outbox`, `flushOutbox()` all'`onopen`,
rimozione su `ack`, heartbeat anti-socket-zombie) e la relativa nota nel README era
**obsoleta**. Il divario reale era nella CLI, dove `sendMessage()` scartava il messaggio
con `{ sent:false, reason:'not_connected' }` quando il socket non era pronto.

## Cosa è cambiato
| File | Modifica |
|------|----------|
| `cli/lib/connection.js` | Nuovo `outbox` in-memory nella `ChatConnection`. `sendMessage()` ora **accoda sempre** (con `cid` univoco via `crypto.randomUUID()`) invece di scartare; trasmette subito solo se `OPEN`+`joined`. Nuovi `_trySend()`, `_flushOutbox()`, `_confirm(cid)`, `_newCid()`. Flush al join (`history`); rimozione dalla coda su `message`/`ack` con `cid` combaciante (nuovo case `ack`). |
| `cli/chat-cli.js` | Wiring `onLine`: il vecchio avviso "messaggio non inviato" è sostituito da "messaggio in coda, verrà inviato alla riconnessione" quando `res.queued`. |
| `tests/cli-outbox.test.js` | **9 test** unitari (fake socket): accodamento offline, flush al join in ordine, conferma via `message` e via `ack`, no-doppione a schermo, invio immediato quando connesso, troncamento a 2000, resilienza al socket "zombie", input vuoto ignorato. |
| `specs/006-cli-outbox-queue/spec.md` | Specifica della feature. |
| `README.md` / `README.it.md` | Rimossa la nota "Prossimi passi" obsoleta sull'outbox (ormai fatto web+CLI). |
| `cli/README.md` | Aggiunta la coda in uscita fra le funzionalità e nell'architettura. |

## Come funziona
- **Invio**: `sendMessage(text)` valida (vuoto → ignorato), tronca a 2000 una sola volta,
  crea `{ type:'message', cid, text }`, lo mette in `outbox` e prova a trasmetterlo. Ritorna
  `{ sent:true, truncated, queued }` (`queued=true` se non trasmesso subito).
- **Reflush**: alla ricezione di `history` (join confermato, `joined=true`) rispedisce in
  ordine tutti i payload ancora in coda.
- **Conferma**: il server (invariato) fa broadcast dell'eco col `cid` sul primo invio e
  rimanda `ack` sui reinvii già visti (`recentCids`). La CLI toglie dalla coda l'elemento
  col `cid` combaciante — via `message` **o** `ack`. Il display resta guidato dalla dedup
  per `id` (`seenIds`): nessun doppione a schermo.
- **Socket "zombie"**: un invio su socket `OPEN` ma morto (o su `send` che lancia) resta in
  coda e riparte al reflush: nessuna perdita silenziosa.

## Verifica
- Suite **29/29 verde** — `npm run check` + `npm test` (erano 20 test in 4 file; +9 in
  `tests/cli-outbox.test.js`, ora 5 file).
- Server e client web **non modificati**: la feature riusa il supporto `cid`/`ack`/
  `recentCids` già presente lato server per l'outbox del web.

## Fuori scope
- Persistenza dell'outbox su disco: la coda è in-memory, si perde se la CLI viene chiusa.
- Heartbeat/ping lato CLI per rilevare più in fretta i socket "zombie" (il server già
  termina i socket morti; la CLI se ne accorge alla `close`). Miglioramento futuro.
- Coda per allegati/immagini dalla CLI (invio immagini è fuori scope dalla spec 001).
