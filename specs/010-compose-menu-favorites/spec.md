# Feature Specification: Pulsante "+" (Allega file / Invia posizione) + messaggi preferiti

**Feature Branch**: `010-compose-menu-favorites`

**Created**: 2026-07-19

**Status**: Implemented

**Input**: Primo punto dei "Prossimi passi consigliati" del README: sostituire l'icona
"clip" di allegato con un pulsante **+** che apre un menu di scelte (*Allega file*,
*Invia posizione*), valutando anche *Aggiungi messaggio ai preferiti* come funzione
collegata.

## Decisioni chiave

- **DK-001 — "Allega file" invariato**: la voce di menu riusa esattamente il codice
  esistente (`fileInput.click()` → `uploadImage()`), senza toccare upload/cifratura
  allegati (spec 007). Il pulsante `#attach-btn` diventa il toggle del menu invece di
  aprire subito il file picker.
- **DK-002 — Posizione come messaggio di testo `geo:`**: "Invia posizione" usa
  `navigator.geolocation.getCurrentPosition()` e invia un messaggio di testo nel formato
  `geo:<lat>,<lng>`. Nessuna modifica allo schema DB (`messages.text` esiste già). Il
  client (web e CLI) che non riconosce il formato lo mostra come testo grezzo — degrado
  elegante, nessuna rottura di compatibilità.
- **DK-003 — Rendering posizione lato web**: `buildMessage()` riconosce il pattern
  `geo:` e mostra una card "📍 Posizione" con link che apre OpenStreetMap
  (`https://www.openstreetmap.org/?mlat=..&mlon=..#map=16/../..`) in una nuova scheda.
  Nessuna chiamata di rete server-side (a differenza delle link preview generiche),
  quindi funziona anche senza che il Raspberry abbia accesso a internet.
- **DK-004 — Preferiti persistiti lato server, per utente**: nuova tabella
  `message_favorites (message_id, username)` — stesso pattern già usato da
  `message_reads` (spec esistente). Ogni utente vede solo i propri preferiti; non è un
  dato visibile agli altri membri della stanza (a differenza delle "letture").
  Persistenza server-side (non solo `localStorage`) per restare consistente tra più
  dispositivi/sessioni dello stesso utente, coerente con come l'app già gestisce letture
  e stanze.
- **DK-005 — Nessun broadcast di stanza per i preferiti**: a differenza di `read`, il
  toggle preferito/non-preferito viene confermato solo al socket che l'ha richiesto
  (ack diretto), non trasmesso all'intera stanza: non è un'informazione da mostrare agli
  altri utenti.
- **DK-006 — Vista "Favorites" per stanza**: nuova voce nel menu Impostazioni (visibile
  a tutti, non solo agli admin, come "Media") che apre un elenco dei messaggi preferiti
  nella stanza attiva, con click per scorrere al messaggio originale
  (`GET /chat/favorites?roomId=`, stesso pattern di `GET /chat/media?roomId=`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Menu "+" per allegare file (Priority: P1)

Un utente vuole allegare un file al messaggio, come già poteva fare prima.

**Why this priority**: comportamento esistente e già testato; non deve regredire.

**Acceptance Scenarios**:

1. **Given** la chat aperta, **When** l'utente clicca il pulsante **+**, **Then** si apre
   un menu con "📎 Allega file" e "📍 Invia posizione".
2. **Given** il menu aperto, **When** l'utente sceglie "Allega file", **Then** si apre il
   file picker e il flusso di upload/anteprima funziona esattamente come prima.

### User Story 2 - Invio posizione (Priority: P2)

Un utente vuole condividere la propria posizione attuale in chat.

**Acceptance Scenarios**:

1. **Given** il menu "+" aperto, **When** l'utente sceglie "Invia posizione" e concede il
   permesso di geolocalizzazione, **Then** viene inviato un messaggio che appare in chat
   come card "📍 Posizione" con link a una mappa.
2. **Given** il permesso di geolocalizzazione negato o non disponibile, **When** l'utente
   sceglie "Invia posizione", **Then** l'app mostra un errore chiaro e non invia nulla.

### User Story 3 - Messaggi preferiti (Priority: P3)

Un utente vuole segnare un messaggio come preferito per ritrovarlo facilmente più tardi.

**Acceptance Scenarios**:

1. **Given** un messaggio in chat, **When** l'utente clicca l'icona stella nella riga
   meta del messaggio, **Then** il messaggio viene marcato preferito (stella piena) e la
   marcatura sopravvive a un ricaricamento della pagina.
2. **Given** almeno un messaggio preferito nella stanza attiva, **When** l'utente apre
   Impostazioni → Favorites, **Then** vede l'elenco dei propri messaggi preferiti in
   quella stanza, e cliccandone uno viene riportato al messaggio originale in chat.
3. **Given** un messaggio preferito da Utente A, **When** Utente B (stesso room, utente
   diverso) guarda lo stesso messaggio, **Then** non vede alcuna indicazione che sia
   preferito da A (i preferiti sono privati per utente).

### Edge Cases

- **Geolocalizzazione su HTTP non-localhost**: molti browser richiedono un contesto
  sicuro (HTTPS o localhost) per `navigator.geolocation`; su un Raspberry servito in
  HTTP semplice sulla LAN la funzione potrebbe non essere disponibile. Documentato come
  limite noto, non bloccante per le altre funzioni del menu.
- **Messaggio preferito poi cancellato**: la cancellazione di un messaggio (funzione
  esistente) elimina anche le eventuali righe `message_favorites` collegate, così non
  restano riferimenti a un messaggio inesistente nella vista Favorites.
- **Utente non più membro della stanza**: `GET /chat/favorites` richiede membership
  attiva nella stanza, stesso controllo già usato da `GET /chat/media`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il pulsante di allegato MUST diventare un pulsante **+** che apre un menu
  con le voci "Allega file" e "Invia posizione", invece di aprire direttamente il file
  picker.
- **FR-002**: La voce "Allega file" MUST riusare il comportamento di upload esistente
  senza modifiche (stesso endpoint `/chat/upload`, stessa anteprima).
- **FR-003**: La voce "Invia posizione" MUST usare la Geolocation API del browser e, in
  caso di successo, inviare un messaggio di testo `geo:<lat>,<lng>`.
- **FR-004**: Il client web MUST renderizzare un messaggio nel formato `geo:<lat>,<lng>`
  come card con link a una mappa, non come testo grezzo.
- **FR-005**: Un fallimento della geolocalizzazione (permesso negato, non supportata)
  MUST mostrare un messaggio di errore e non deve inviare alcun messaggio.
- **FR-006**: Ogni messaggio MUST esporre un controllo (stella) per marcarlo/smarcarlo
  come preferito dall'utente corrente.
- **FR-007**: Lo stato preferito MUST essere persistito lato server per coppia
  (messaggio, utente) e ricaricato nello storico (`favorite: true/false` su ogni
  messaggio restituito all'utente che ha fatto login).
- **FR-008**: Lo stato preferito di un utente NON MUST essere visibile ad altri utenti
  della stanza.
- **FR-009**: MUST esistere un endpoint `GET /chat/favorites?roomId=` che restituisce i
  messaggi preferiti dall'utente corrente in quella stanza, ordinati dal più recente,
  con lo stesso controllo di membership già usato da `/chat/media`.
- **FR-010**: La cancellazione di un messaggio (handler WS `delete` esistente) MUST
  eliminare anche le righe `message_favorites` associate a quel messaggio.
- **FR-011**: MUST esistere una vista "Favorites" raggiungibile dal menu Impostazioni,
  visibile a tutti gli utenti autenticati (non solo admin), che elenca i preferiti della
  stanza attiva e permette di scorrere al messaggio originale con un click.

### Key Entities

- **message_favorites**: tabella `(message_id TEXT, username TEXT, PRIMARY KEY
  (message_id, username))`, stesso pattern di `message_reads`. Nessuna modifica allo
  schema di `messages`.
- **Messaggio "posizione"**: nessuna nuova entità DB; è un messaggio ordinario con
  `text` nel formato `geo:<lat>,<lng>`, riconosciuto solo lato rendering client.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Cliccando **+** → "Allega file" il flusso di upload/anteprima funziona
  identico a prima della modifica (nessuna regressione).
- **SC-002**: Un messaggio `geo:41.9,12.5` inviato appare come card "📍 Posizione"
  cliccabile, non come testo grezzo `geo:41.9,12.5`.
- **SC-003**: Marcare un messaggio preferito, ricaricare la pagina: il messaggio risulta
  ancora preferito (stella piena) e compare nella vista Favorites della stanza.
- **SC-004**: Il preferito marcato da un utente non è visibile nello stato di altri
  utenti che guardano lo stesso messaggio.
- **SC-005**: Cancellare un messaggio preferito lo rimuove anche dalla vista Favorites,
  senza errori.
- **SC-006**: `npm test` verde, inclusi i nuovi test su `message_favorites`.

## Assumptions & Dependencies

- Riusa l'infrastruttura WebSocket esistente (`type: 'message'`, `type: 'delete'`) e ne
  segue lo stile per i nuovi tipi `favorite`/`unfavorite`.
- La vista Favorites è scoperta per stanza attiva, coerente con "Media"; non è prevista
  una vista aggregata cross-stanza in questa spec.
- **Fuori scope**: trascrizione vocale (voce separata del backlog, "da
  valutare/prototipare"); riordino menu Impostazioni; notifica di ingresso in stanza;
  separatore di data; supporto CLI per posizione/preferiti (solo web per ora, come la
  modalità public room di spec 009).
