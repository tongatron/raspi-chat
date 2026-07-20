# Spec 011 — Annuncio di ingresso in stanza + separatore di data

## Obiettivo

Due voci dei "Prossimi passi consigliati" del README:

1. Quando un utente viene aggiunto a una stanza (o si unisce da solo a una pubblica),
   mandargli una notifica push e mostrare in chat un messaggio di sistema centrato
   ("X joined the chat.") visibile a tutti i membri.
2. Mostrare un separatore di data centrato ogni volta che cambia il giorno all'interno
   di una chat (una sola volta per giorno), incluso scorrendo indietro nella history.

## Cosa cambia

- Nuova colonna `messages.kind TEXT NOT NULL DEFAULT 'text'` (migrazione
  `ALTER TABLE ... ADD COLUMN`, retrocompatibile). I messaggi utente restano `'text'`;
  i nuovi annunci di ingresso usano `'system'`. `HISTORY_SQL` e `formatRow()` espongono
  il campo `kind` al client.
- Nuova funzione `insertSystemMessage(roomId, username, text)` in `src/routes/chat.js`:
  inserisce il messaggio (`kind='system'`) e lo propaga in tempo reale a chi ha la
  stanza aperta via `broadcastToRoom`.
- Applicata nei 4 punti che aggiungono un membro a una stanza:
  - `POST /chat/my-rooms` e `POST /chat/rooms` (creazione stanza con membri iniziali):
    annuncio + push a ciascun invitato (non al creatore).
  - `POST /chat/rooms/:roomId/members` (admin aggiunge membri a stanza esistente):
    annuncio + push al nuovo membro.
  - `POST /chat/public-rooms/:roomId/join` (self-join stanza pubblica): solo annuncio
    (nessuna push verso se stessi), e solo al primo join effettivo.
  - La push riusa `sendWebPushToUser()` già esistente (stesso schema di
    `{title, body, url}` usato per notificare l'invitante in fase di registrazione).
- UI web (`public/chat.html`): nuovo rendering "pill" centrato per i messaggi di
  sistema (`buildSystemMessage`/`.msg-system`), applicato ai 3 punti che inseriscono
  messaggi (history, realtime, paginazione) tramite il nuovo `insertMessageEl()`.
  Gli annunci di sistema non generano suono di notifica né badge non-letti.
- Separatore di data 100% client-side (`dayKey`/`formatDayLabel`/`buildDateSeparator`/
  `refreshDateSeparators`): dopo ogni batch di messaggi renderizzati, ricalcola da zero
  i separatori confrontando il giorno solare locale di ciascun messaggio con il
  precedente. Etichette: "Today", "Yesterday", altrimenti data estesa (con anno solo se
  diverso da quello corrente).

## Bug preesistente scoperto e corretto

Scrivendo il test "creare una stanza con membri iniziali annuncia ogni invitato" è
emerso un bug **preesistente** (non introdotto da questa feature, presente da sempre in
`stmts.getPage`): la concatenazione `HISTORY_SQL + ' AND m.timestamp < ? ORDER BY ...'`
appendeva `AND m.timestamp < ?` **dopo** `GROUP BY m.id` invece che nella `WHERE`.
SQLite interpreta questo come `GROUP BY (m.id AND m.timestamp < ?)`: siccome `m.id` è
una stringa (UUID) che SQLite forza a numero (spesso `0`), quasi tutte le righe finivano
raggruppate nella stessa chiave, e la paginazione (`GET /chat/messages`, usata anche da
`loadMoreMessages()` scrollando in alto in chat) restituiva **in modo non deterministico
meno messaggi di quelli realmente presenti** — un vero bug di perdita messaggi in
produzione, non solo un problema del test. Corretto spostando `GROUP BY m.id` fuori da
`HISTORY_SQL` condivisa e aggiungendolo in coda a ciascuna query derivata (`getHistory`,
`getPage`), dopo la clausola `WHERE` completa.

## Non-goal

- Nessuna modifica al messaggio di benvenuto esistente (`Raspi Chat` su registrazione
  via invito, `chat.js:763`): resta `kind='text'`, rendering bubble invariato.
- Nessun annuncio per la rimozione di un membro da una stanza (`DELETE
  /chat/rooms/:roomId/members/:username`): fuori scope, non richiesto dal backlog.
- Nessuna gestione da CLI (`cli/`): solo web/API, come per le feature precedenti.

## Test

`tests/room-join-message.test.js`:
- Admin aggiunge un membro a una stanza esistente → appare un messaggio `kind:'system'`
  con testo `"<user> joined the chat."` nella history della stanza.
- Self-join su stanza pubblica chiamato due volte → un solo messaggio di sistema (nessun
  duplicato al secondo tentativo, utente già membro).
- Creazione stanza con membri iniziali → un messaggio di sistema per ciascun invitato,
  nessuno per il creatore.

Verificato anche manualmente in browser (due sessioni): l'annuncio compare in tempo
reale per chi ha la chat aperta; scorrendo una chat con messaggi di più giorni compaiono
i separatori "Today"/"Yesterday"/data estesa, anche paginando verso messaggi più vecchi.
