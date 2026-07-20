# Spec 011 — Annuncio di ingresso in stanza + separatore di data · Fatto

**Data:** 2026-07-20 · **Autore:** Giovanni Bindi

## Obiettivo
Due voci dei "Prossimi passi consigliati" del README: notifica + messaggio di sistema
centrato quando un utente viene aggiunto a una stanza, e separatore di data centrato
quando cambia il giorno in chat.

## Cosa è cambiato
| File | Modifica |
|------|----------|
| `src/routes/chat.js` | Colonna `messages.kind` (migrazione, default `'text'`); nuova `insertSystemMessage()`; annuncio + push (tranne self-join) in `POST /chat/my-rooms`, `POST /chat/rooms`, `POST /chat/rooms/:roomId/members`, `POST /chat/public-rooms/:roomId/join`; **fix di un bug preesistente** in `stmts.getPage` (vedi spec.md) che poteva far perdere messaggi durante la paginazione. |
| `public/chat.html` | `buildSystemMessage`/`.msg-system` (pill centrata); separatore di data (`dayKey`/`formatDayLabel`/`buildDateSeparator`/`refreshDateSeparators`, ricalcolato da zero ad ogni batch); nuovo `insertMessageEl()` usato nei 3 punti di rendering (history, realtime, paginazione). |
| `tests/room-join-message.test.js` | 3 test: messaggio di sistema su add-membro, nessun duplicato su self-join ripetuto, annuncio per ogni invitato tranne il creatore alla creazione stanza (quest'ultimo ha scoperto il bug di paginazione). |
| `specs/011-join-system-messages/spec.md` | Spec compatta + sezione dedicata al bug scoperto. |
| `README.md` / `README.it.md` | Rimossi i due punti dai "Prossimi passi consigliati"/"Suggested next steps"; in `README.md` ripulite anche 2 voci già obsolete (spec 010, riordino menu) mai rimosse in precedenza. |

## Verifica
- `npm test` — 51/51 verdi, ripetuto 5 volte di seguito per escludere flakiness residua
  dopo il fix della query di paginazione.
- Verifica manuale in browser (server locale isolato, utenti sintetici `AdminV`/`BobV`,
  DB temporaneo separato da quello reale): creata "Team Room" come AdminV, aggiunto BobV
  dalla pagina Rooms → è comparso in tempo reale il separatore "Today" seguito dal
  messaggio centrato "BobV joined the chat."; un messaggio normale inviato subito dopo
  si è renderizzato come bubble senza duplicare il separatore di data.

## Fuori scope
- Nessun annuncio per la rimozione di un membro da una stanza.
- Nessuna gestione da CLI.
- Il messaggio di benvenuto esistente ("Raspi Chat" su registrazione via invito) resta
  invariato (`kind:'text'`).
