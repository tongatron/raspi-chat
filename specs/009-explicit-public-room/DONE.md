# Spec 009 — Modalità "public room" esplicita · Fatto

**Data:** 2026-07-19 · **Autore:** Giovanni Bindi

## Obiettivo
Ultimo punto dei "Prossimi passi consigliati": permettere a un utente qualsiasi di
creare una room che chiunque puo' scoprire e a cui puo' unirsi da solo, senza dover
essere invitato dal creatore/admin.

## Cosa è cambiato
| File | Modifica |
|------|----------|
| `src/routes/chat.js` | Colonna `rooms.is_public` (migrazione); `createRoom`/`getRoomById`/`listRoomsForUser` aggiornate; nuova `listPublicRooms`; `formatRoom()` espone `isPublic`/`joined`; `POST /chat/my-rooms` e `POST /chat/rooms` accettano `isPublic`; nuove `GET /chat/public-rooms` e `POST /chat/public-rooms/:roomId/join`. |
| `public/chat.html` | Checkbox "Public room" nel dialog "New room"; nuovo dialog "Public rooms" con elenco + pulsante Join/Open; voce di menu "⌘ Browse public rooms...". |
| `tests/public-room.test.js` | 3 test: room pubblica elencata anche per non-membri, join aggiunge membership, room privata non elencata e join rifiutato (404). |
| `README.md` / `README.it.md` | Nuova sezione "Public rooms" / "Stanze pubbliche"; rimosso il punto dai "Prossimi passi consigliati" (lista ora vuota). |

## Verifica
- `npm run check` — ok
- `npm test` — 43/43 verdi (inclusi i 3 nuovi)
- Verifica manuale in browser (due tab, due utenti): Admin crea la room pubblica
  "Community", Bob la scopre in "Browse public rooms..." e si unisce con un click; la
  room risultava poi "Admin, Bob" per entrambi.

## Fuori scope
- Nessuna gestione da CLI.
- Nessuna moderazione/approvazione: il join è immediato.
