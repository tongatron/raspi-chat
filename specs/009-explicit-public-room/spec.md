# Spec 009 — Modalità "public room" esplicita

## Obiettivo

Fino ad ora ogni room era a **membership chiusa**: solo il creatore (o un admin) poteva
aggiungere membri via `POST /chat/rooms/:roomId/members` o alla creazione. Non esisteva
modo per un utente di scoprire una room e unirsi da solo. Questo era l'ultimo punto
rimasto nei "Prossimi passi consigliati" del README.

## Cosa cambia

- Nuova colonna `rooms.is_public INTEGER NOT NULL DEFAULT 0` (migrazione
  `ALTER TABLE ... ADD COLUMN`, retrocompatibile).
- `POST /chat/my-rooms` e `POST /chat/rooms` accettano `isPublic: true` nel body; la room
  creata ha quel flag.
- `formatRoom()` espone `isPublic` e `joined` (se l'utente corrente e' gia' membro).
- Nuova `GET /chat/public-rooms`: qualunque utente autenticato ottiene l'elenco delle
  room con `isPublic=true`, incluse quelle di cui non e' ancora membro.
- Nuova `POST /chat/public-rooms/:roomId/join`: qualunque utente autenticato puo'
  aggiungersi da solo come membro di una room pubblica (404 se la room non esiste o non
  e' pubblica). Idempotente: se e' gia' membro non fa nulla di distruttivo.
- UI web (`public/chat.html`): checkbox "Public room" nel dialog di creazione stanza;
  nuova voce di menu "⌘ Browse public rooms..." che apre un dialog con elenco e pulsante
  **Join** per ciascuna room pubblica non ancora unita (o **Open** se gia' membro).

## Non-goal

- Nessuna moderazione/approvazione del join (chi si unisce entra subito, come richiesto:
  "esplicita" significa scoperta+join libero, non una coda di richieste).
- Nessuna modifica alle room private esistenti: il comportamento di default (creazione
  senza `isPublic`) resta identico a prima.
- Nessuna gestione da CLI (`cli/`): la modalità è disponibile solo via web/API per ora.

## Test

`tests/public-room.test.js` (3 test):
- una room pubblica compare in `/chat/public-rooms` anche per chi non ne è membro,
  con `joined:false`;
- `POST /chat/public-rooms/:roomId/join` aggiunge il chiamante ai membri, verificato
  anche via `/chat/my-rooms` lato joiner;
- una room privata non compare nell'elenco pubblico e il join viene rifiutato (404).

Verificato anche manualmente in browser: Admin crea "Community" pubblica, Bob (utente
diverso) la scopre via "Browse public rooms..." e si unisce con un click, senza essere
stato invitato.
