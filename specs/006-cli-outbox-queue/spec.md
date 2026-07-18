# Feature Specification: Coda dei messaggi in uscita nella CLI (outbox + reflush alla riconnessione)

**Feature Branch**: `006-cli-outbox-queue`

**Created**: 2026-07-18

**Status**: Implemented

**Input**: Il client web (`public/chat.html`) accoda già i messaggi in uscita in un
`outbox`, li rispedisce automaticamente dopo la riconnessione e li rimuove dalla coda
alla conferma del server (`ack`/eco con `cid`), con deduplica server-side via `cid`
(`recentCids` in `src/routes/chat.js`). Il client **CLI** (`cli/`) non ha questo
meccanismo: `ChatConnection.sendMessage()` **scarta** il messaggio quando il socket non
è `OPEN`/`joined`, restituendo `{ sent: false, reason: 'not_connected' }`
(`cli/lib/connection.js:145`). Un messaggio digitato durante una caduta di rete — lo
scenario tipico su Raspberry Pi (spec 001, US4) — va perso e l'utente deve riscriverlo e
ripremere Invio dopo la riconnessione. Questa spec porta nella CLI la stessa coda in
uscita già collaudata sul web, per parità di comportamento.

## Decisioni chiave

- **DK-001 — Outbox in-memory nella connection**: `ChatConnection` mantiene un array
  `outbox` di payload non ancora confermati. `sendMessage()` **accoda sempre** un
  messaggio valido (con un `cid` univoco) invece di scartarlo, e lo trasmette subito solo
  se il socket è `OPEN` e `joined`. La coda vive nel processo CLI: è volatile per
  costruzione (vedi Fuori scope).
- **DK-002 — Conferma by-`cid`, come il web**: ogni payload include un `cid`. Il server
  (invariato) fa broadcast dell'eco con lo stesso `cid` sul primo invio e rimanda un
  `ack` sui reinvii già visti (`recentCids`). La CLI rimuove dall'outbox l'elemento il cui
  `cid` combacia con un `message` **oppure** un `ack` ricevuto. Finché non arriva conferma,
  il messaggio resta in coda.
- **DK-003 — Flush al join confermato**: il reflush avviene quando il join è confermato,
  cioè alla ricezione di `history` (che già imposta `joined = true`). A quel punto il
  server accetta i messaggi della room e la deduplica via `cid` evita doppioni per ciò che
  era già stato consegnato prima della caduta.
- **DK-004 — Resilienza al socket "zombie" gratis**: poiché un messaggio esce dall'outbox
  **solo** su conferma, un invio su un socket `OPEN` ma morto (che non consegna né
  conferma) resta in coda e viene ritrasmesso alla riconnessione, senza perdersi in
  silenzio. Nessuna modifica alla logica di reconnect/backoff (spec 001, US4).
- **DK-005 — Display invariato**: la CLI continua a mostrare il proprio messaggio tramite
  l'**eco** del server, deduplicata per `id` (`seenIds`, spec 001). Il `cid` serve solo a
  gestire l'outbox e non cambia cosa viene stampato: nessun doppione a schermo.
- **DK-006 — Troncamento una sola volta**: il limite di 2000 caratteri (FR-007 spec 001)
  è applicato **all'accodamento**; il payload salvato è già troncato, quindi i reinvii non
  ritroncano né alterano il testo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Messaggio scritto durante una disconnessione (Priority: P1)

Un utente della CLI su una rete instabile digita e invia un messaggio proprio mentre la
connessione realtime è caduta (o si sta riconnettendo). Invece di perdere il testo, la
CLI lo accoda e lo consegna da sé appena il socket torna su, senza che l'utente debba
riscriverlo o ripremere Invio.

**Why this priority**: È il valore centrale della feature e chiude il divario con il
client web. Sul caso d'uso tipico (Raspberry Pi / rete domestica instabile della spec
001) evita la perdita silenziosa di messaggi.

**Independent Test**: Con una `ChatConnection` non connessa, `sendMessage('ciao')` ritorna
`{ sent: true, queued: true }` e mette un elemento in `outbox`; simulando la connessione e
il join (`history`), l'outbox viene svuotato inviando il payload; alla ricezione di un
`message`/`ack` con lo stesso `cid` l'elemento viene rimosso.

**Acceptance Scenarios**:

1. **Given** la CLI disconnessa, **When** l'utente invia un messaggio non vuoto, **Then** il messaggio viene accodato (non scartato) e l'utente viene informato che partirà alla riconnessione.
2. **Given** uno o più messaggi in coda, **When** la CLI si riconnette e completa il join, **Then** tutti i messaggi in coda vengono rispediti in ordine, una volta.
3. **Given** un messaggio in coda, **When** il server ne conferma la consegna (eco con `cid` o `ack`), **Then** il messaggio viene rimosso dall'outbox.

### User Story 2 - Nessun doppione dopo la riconnessione (Priority: P1)

Un messaggio consegnato correttamente poco prima di una micro-caduta non deve comparire
due volte quando la CLI si riconnette e rispedisce l'outbox residuo.

**Why this priority**: La coda è inutile se introduce duplicati. La correttezza del
reflush è parte inscindibile dell'MVP di questa feature.

**Acceptance Scenarios**:

1. **Given** un messaggio già consegnato (server lo ha in `recentCids`), **When** la CLI lo rispedisce alla riconnessione, **Then** il server risponde con `ack` e non crea un secondo messaggio, e la CLI lo rimuove dalla coda.
2. **Given** l'eco di un proprio messaggio già mostrato, **When** arriva con lo stesso `cid`, **Then** non viene mostrato un doppione a schermo (dedup per `id` invariata).

### Edge Cases

- **Invio su socket "zombie"** (`OPEN` ma morto): il messaggio resta in coda finché il
  socket non chiude; alla riconnessione viene ritrasmesso. Nessuna perdita silenziosa.
- **Input vuoto/solo spazi**: ignorato come prima (FR-006 spec 001), non entra in coda.
- **Testo > 2000 caratteri**: troncato una sola volta all'accodamento; l'utente è avvisato.
- **CLI chiusa con messaggi ancora in coda**: la coda è in-memory, quindi va persa
  (comportamento accettato — vedi Fuori scope).
- **Errore logico non recuperabile** (`auth_error`/`room_error`/`room_removed`): la CLI
  esce come prima; l'outbox non viene rispedito (nessuna riconnessione su errori logici,
  spec 001 US4).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `sendMessage()` MUST accodare ogni messaggio valido in un `outbox` in-memory
  con un `cid` univoco, invece di scartarlo quando non connesso.
- **FR-002**: Se il socket è `OPEN` e `joined`, il messaggio MUST essere trasmesso subito,
  restando comunque in `outbox` fino alla conferma del server.
- **FR-003**: Alla (ri)connessione, dopo il join confermato (`history`), la CLI MUST
  rispedire in ordine tutti i messaggi ancora presenti in `outbox` (flush).
- **FR-004**: La CLI MUST rimuovere un messaggio dall'`outbox` quando riceve dal server un
  `message` **oppure** un `ack` il cui `cid` combacia con quello del messaggio in coda.
- **FR-005**: Ogni payload inviato MUST includere il `cid`, così il server deduplica i
  reinvii (`recentCids`) evitando doppioni sul reflush.
- **FR-006**: `sendMessage()` MUST continuare a ignorare gli input vuoti/solo-spazi
  (FR-006 spec 001) e ad applicare il limite di 2000 caratteri (FR-007 spec 001) una sola
  volta, al momento dell'accodamento.
- **FR-007**: La UI MUST informare l'utente quando un messaggio è stato accodato per invio
  differito (non connesso), sostituendo il vecchio avviso "messaggio non inviato".
- **FR-008**: Il display MUST restare invariato: il proprio messaggio è mostrato tramite
  l'eco del server, deduplicato per `id`; il `cid` non deve produrre doppioni a schermo.
- **FR-009**: Il server (`src/routes/chat.js`) e il client web (`public/chat.html`) MUST
  restare invariati: questa spec tocca solo la CLI (`cli/`).

### Key Entities

- **Outbox**: coda in-memory di payload `{ type: 'message', cid, text }` non ancora
  confermati dal server. Vive nella `ChatConnection`. Nessuna modifica di schema DB.
- **cid** (client id): identificatore univoco del messaggio generato dalla CLI; già
  supportato e dedotto dal server via `recentCids`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un messaggio digitato mentre la CLI è disconnessa viene consegnato
  automaticamente entro pochi secondi dal ritorno di raggiungibilità del server, senza che
  l'utente lo riscriva o riprema Invio.
- **SC-002**: Rispedire un messaggio già consegnato non crea un secondo messaggio nella
  room (dedup server-side via `cid`) né un doppione a schermo nella CLI.
- **SC-003**: `npm test` include e supera test unitari dell'outbox: accodamento offline,
  flush al join, rimozione su `message` e su `ack`, no-invio su coda vuota.
- **SC-004**: Un messaggio inviato su un socket "zombie" non viene perso: resta in coda e
  viene ritrasmesso alla riconnessione.

## Assumptions & Dependencies

- Costruisce sulla spec 001 (CLI): riusa `ChatConnection`, la dedup per `id` (`seenIds`),
  il reconnect con backoff (US4) e il limite di 2000 caratteri.
- Riusa il supporto `cid`/`ack`/`recentCids` **già presente** nel server, introdotto per
  l'outbox del client web: nessuna modifica lato server.
- **Fuori scope**:
  - Persistenza dell'outbox su disco: se la CLI viene chiusa con messaggi in coda, questi
    si perdono (coda volatile in-memory).
  - Heartbeat/ping lato CLI per rilevare più in fretta i socket "zombie": il server già
    termina i socket morti e la CLI se ne accorge alla `close`. Possibile miglioramento
    futuro (il web ha un heartbeat dedicato).
  - Coda per allegati/immagini dalla CLI (invio immagini è fuori scope dalla spec 001).
