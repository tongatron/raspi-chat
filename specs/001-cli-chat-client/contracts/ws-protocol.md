# Contract: WebSocket Protocol

**Endpoint**: `GET {wsUrl}` dove `wsUrl = baseUrl con http→ws/https→wss` + `/chat/ws`
**Source of truth**: `src/routes/chat.js` (`app.get('/chat/ws', { websocket: true }, ...)`)

Tutti i messaggi sono JSON (testo) con un campo discriminante `type`.

## Client → Server

### join (handshake, obbligatorio per primo)

```json
{ "type": "join", "username": "<string>", "token": "<string>", "roomId": "<string opzionale>" }
```

- `roomId` assente/vuoto ⇒ il server usa `cabras-giovanni` (default).
- Va reinviato dopo ogni riconnessione del socket.

### message (invio testo)

```json
{ "type": "message", "text": "<string ≤ 2000>", "replyToId": null, "imageUrl": null }
```

- In scope solo `text`. `replyToId`/`imageUrl` lasciati `null` nella v1.
- Inviabile solo dopo un `join` andato a buon fine.

> **Fuori scope v1** (definiti dal server ma non usati): `read`, `delete`.

## Server → Client

| `type` | Payload (campi rilevanti) | Azione CLI |
|--------|---------------------------|------------|
| `history` | `{ roomId, roomName, messages: [...] }` | Render storico iniziale; impostare nome room. |
| `message` | `{ id, roomId, username, text, imageUrl, timestamp, replyTo, readBy }` | Render nuovo messaggio (mittente, testo, ora). |
| `online` | `{ roomId, users: [...], members: [...] }` | Aggiornare lista utenti online. |
| `auth_error` | — | Token non valido → terminare con invito a riautenticarsi. **Niente reconnect.** |
| `room_error` | — | Room inesistente o utente non membro → errore chiaro. **Niente reconnect.** |
| `read` | `{ ids, reader, roomId }` | **Fuori scope**: ignorare. |
| `deleted` | `{ id, roomId }` | **Fuori scope**: opzionale, può rimuovere il messaggio dalla vista. |
| `unread` | `{ roomId, roomName, from }` | **Fuori scope**: ignorare (riguarda altre room). |
| `room_removed` | `{ roomId, username }` | L'utente è stato rimosso dalla room → notificare e uscire/cambiare room. |

## Sequenza nominale

```
CLI                         Server
 |--- (login HTTP) --------->|   200 { token }
 |=== WS connect ===========>|
 |--- join(token, room) ---->|
 |<-- history --------------|
 |<-- online ---------------|
 |--- message(text) ------->|
 |<-- message (broadcast) --|
 ...
 |   (socket close)          |
 |=== WS reconnect =========>|
 |--- join(token, room) ---->|   (backoff R5)
 |<-- history --------------|
```
