# Phase 1 Data Model: CLI Chat Client

La CLI non possiede uno storage proprio: modella in memoria solo ciò che serve alla sessione corrente. La fonte di verità è il backend.

## Session

Stato della sessione utente dopo il login.

| Campo | Tipo | Descrizione | Validazione |
|-------|------|-------------|-------------|
| `username` | string | Identità autenticata (normalizzata dal server) | non vuota |
| `token` | string | Token di sessione ottenuto da `POST /chat/login` | richiesto per l'handshake `join` |
| `baseUrl` | string (URL) | Base HTTP del server | schema http/https valido |
| `wsUrl` | string (URL) | Derivato da `baseUrl` (http→ws) + `/chat/ws` | — |
| `roomId` | string | Room corrente | default `cabras-giovanni` |

**Transizioni**: `unauthenticated → authenticated` (login ok) → `joined` (handshake `join` + `history`) → `disconnected` (close socket) → `joined` (reconnect ok). `auth_error`/`room_error` → `terminated`.

## Room

Spazio di conversazione corrente (sottoinsieme dei dati server rilevanti per la UI).

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | string | Identificativo room |
| `name` | string | Nome visualizzato (da `history.roomName`) |

## Message

Unità mostrata e inviata. Riflette la forma del messaggio server (`type:'message'`), usando solo i campi in scope.

| Campo | Tipo | Descrizione | Note scope |
|-------|------|-------------|------------|
| `id` | string | UUID del messaggio | per dedup |
| `username` | string | Mittente | mostrato |
| `text` | string | Testo (≤ 2000 char) | mostrato |
| `timestamp` | string (ISO) | Orario | mostrato come ora locale |
| `imageUrl` | string \| null | Allegato | **fuori scope**: se presente, mostrare placeholder `[immagine]` |
| `replyTo` | object \| null | Messaggio citato | **fuori scope**: ignorato nella v1 |

**Regole**:
- Messaggi con `text` vuoto e senza testo utile non vengono inviati (FR-006).
- I messaggi in arrivo vengono accodati e renderizzati in ordine di `timestamp`.

## Presence

Lista utenti online nella room, da `type:'online'`.

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `users` | string[] | Username attualmente connessi |
| `members` | string[] | Membri della room (per contesto, opzionale in UI) |

**Regole**: aggiornata a ogni evento `online`; mostrata su richiesta/comando o in una riga di stato.

## ConnectionState (interno)

Macchina a stati del trasporto, non visibile all'utente se non come messaggi di stato.

`connecting → open → joined → (closed → reconnecting → connecting)` con contatore di retry e delay corrente (backoff R5).
