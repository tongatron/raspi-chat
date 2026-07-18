# Feature Specification: raspi-chat — Baseline Versione Uno (v1.0.0)

**Feature Branch**: `main`

**Created**: 2026-07-18

**Status**: Ratified (baseline)

**Input**: Documentazione retroattiva dello stato dell'applicazione al momento
del rilascio `v1.0.0`. Questa spec non descrive lavoro da fare: fotografa ciò che
l'app **già fa**, per fissare il punto di partenza da cui evolvono le feature
successive (`specs/002-...` in poi). Le convenzioni seguono spec-kit; la baseline
è esente dal requisito test-first del constitution (Principio III), che si applica
dalla v1.1.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chattare in tempo reale dal browser (Priority: P1)

Un utente registrato apre la web app, effettua il login e scambia messaggi di
testo in tempo reale con gli altri membri della propria room, vedendo lo storico
recente e chi è online.

**Why this priority**: È il cuore del prodotto. Senza login + messaggistica
realtime non esiste chat.

**Independent Test**: Aprire `/chat`, autenticarsi con un utente valido, inviare
un messaggio da un secondo client e verificare che appaia entro pochi secondi con
mittente, testo e orario.

**Acceptance Scenarios**:

1. **Given** un utente con credenziali valide, **When** effettua il login su `/chat`, **Then** vede lo storico recente della room e lo stato di connessione.
2. **Given** due client nella stessa room, **When** uno invia un messaggio, **Then** l'altro lo riceve via WebSocket entro pochi secondi.
3. **Given** credenziali errate, **When** l'utente tenta il login, **Then** riceve un errore chiaro senza crash.

---

### User Story 2 - Condividere immagini e allegati (Priority: P2)

Un utente allega e invia immagini o file (pdf, video, audio, documenti, zip) che
gli altri partecipanti possono visualizzare/scaricare, con anteprima dei link.

**Why this priority**: Estende il valore della chat oltre il testo; è già
implementato e in uso, ma non è indispensabile allo scambio base.

**Independent Test**: Caricare un file via `/chat/upload` e verificare che compaia
nella conversazione con nome file e sia scaricabile via `/chat/images/:filename`.

**Acceptance Scenarios**:

1. **Given** una sessione attiva, **When** l'utente carica un'immagine, **Then** viene mostrata inline agli altri partecipanti.
2. **Given** un allegato non-immagine, **When** viene inviato, **Then** è mostrato con il nome del file ed è scaricabile.
3. **Given** un URL in un messaggio, **When** il messaggio è inviato, **Then** viene mostrata un'anteprima del link quando disponibile.

---

### User Story 3 - Ricevere notifiche anche ad app chiusa (Priority: P2)

Un utente installa la PWA (o l'APK Android via TWA) e riceve notifiche Web Push
dei nuovi messaggi anche quando l'app non è in primo piano.

**Why this priority**: Rende la chat usabile come messaggistica reale su mobile;
additivo rispetto al core.

**Independent Test**: Concedere il permesso notifiche, chiudere l'app, inviare un
messaggio da un altro client e verificare la ricezione della notifica push.

**Acceptance Scenarios**:

1. **Given** un utente con permesso notifiche concesso, **When** arriva un nuovo messaggio ad app chiusa, **Then** riceve una notifica Web Push.
2. **Given** la PWA installata, **When** l'utente la apre dalla home, **Then** accede direttamente alla chat.

---

### User Story 4 - Usare la chat da terminale (CLI) (Priority: P3)

Un utente usa un client da terminale che riusa lo stesso backend (login HTTP +
WebSocket) per leggere e inviare messaggi senza browser. (Vedi
`specs/001-cli-chat-client/`.)

**Why this priority**: Comodità per utenti tecnici; del tutto opzionale.

**Independent Test**: `npm run cli`, login, invio di un messaggio e verifica che
compaia sul client web.

**Acceptance Scenarios**:

1. **Given** credenziali valide, **When** l'utente avvia la CLI e fa login, **Then** vede lo storico e i messaggi realtime.
2. **Given** una caduta del WebSocket, **When** il server torna raggiungibile, **Then** la CLI si riconnette automaticamente.

---

### User Story 5 - Installare e configurare via wizard (Priority: P2)

Un nuovo operatore installa il progetto su un Raspberry e completa la
configurazione tramite un wizard web `/setup` che genera `.env`, utenti, chiavi
VAPID e i file di servizio (systemd, nginx, cloudflared).

**Why this priority**: Abbassa la barriera d'ingresso per chi self-hosta; centrale
per l'obiettivo "pubblicabile e riusabile", ma non parte del runtime di chat.

**Independent Test**: Su un'installazione pulita, aprire `/setup`, completare i
passaggi e verificare la generazione dei file in `data/setup-generated/` e la
disattivazione automatica di `/setup` a fine configurazione.

**Acceptance Scenarios**:

1. **Given** un'installazione senza `.env`, **When** l'operatore completa `/setup`, **Then** vengono scritti `.env` e `config/chat-users.json` e creati i file di servizio.
2. **Given** il setup completato, **When** si riapre `/setup`, **Then** è disattivato e l'app mostra la chat.
3. **Given** una richiesta a `/setup` da rete non locale, **When** `SETUP_ALLOW_REMOTE` non è impostato, **Then** l'accesso è negato.

---

### Edge Cases

- **WebSocket caduto durante l'invio**: il messaggio viene messo in coda e
  spedito alla riconnessione (comportamento introdotto prima della v1.0.0).
- **Socket "zombie"**: keepalive/heartbeat lato server evitano socket morti che
  fanno perdere messaggi.
- **Aggiornamento in produzione**: `git pull` sulla working dir non tocca `.env`,
  `data/`, `config/`, `node_modules/` (in `.gitignore`).
- **Accesso `/setup` da remoto**: negato di default salvo override esplicito.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema MUST autenticare gli utenti via username/password contro `config/chat-users.json`, emettendo una sessione (token).
- **FR-002**: Il sistema MUST recapitare messaggi di testo in tempo reale tra i membri di una room via WebSocket (`/chat/ws`).
- **FR-003**: Il sistema MUST mostrare lo storico recente dei messaggi al login.
- **FR-004**: Il sistema MUST persistere messaggi e stato in SQLite locale (`chat.db` per la chat, `app.db` per gli item), sotto `data/`.
- **FR-005**: Il sistema MUST permettere upload e download di immagini e allegati (pdf, video, audio, doc, zip) con visualizzazione del nome file.
- **FR-006**: Il sistema MUST generare anteprime dei link presenti nei messaggi quando disponibili.
- **FR-007**: Il sistema MUST supportare notifiche Web Push (VAPID) verso i client sottoscritti.
- **FR-008**: Il sistema MUST servire una PWA installabile e i relativi asset (`manifest.json`, `sw.js`), oltre a un APK Android via TWA e `assetlinks.json`.
- **FR-009**: Il sistema MUST offrire un wizard `/setup` che genera `.env`, utenti, chiavi VAPID e i file di servizio, disattivandosi a configurazione completata; accessibile solo da rete locale salvo `SETUP_ALLOW_REMOTE`.
- **FR-010**: Il sistema MUST esporre endpoint operativi `/health` e `/version`.
- **FR-011**: Il sistema MUST fornire un client CLI che riusa login HTTP + WebSocket, con riconnessione automatica.
- **FR-012**: Il sistema MUST mettere in coda i messaggi in uscita quando il WebSocket è chiuso e spedirli alla riconnessione.
- **FR-013**: Il sistema MUST supportare temi chiaro/scuro (default scuro) e un layout mobile a header singola riga.
- **FR-014**: Il sistema MUST permettere l'esportazione di un backup di `chat.db` via endpoint dedicato.

### Key Entities *(include if feature involves data)*

- **Utente**: identità con ruolo (`admin`/`superuser`/`user`), definita in `config/chat-users.json`.
- **Room**: spazio di conversazione con membri e storico.
- **Messaggio**: mittente, testo/allegato, orario; persistito in `chat.db`.
- **Allegato**: file caricato in `data/uploads/`.
- **Sottoscrizione push**: endpoint/chiavi per l'invio di notifiche Web Push.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un utente valido completa login e vede lo storico su `/chat` senza errori.
- **SC-002**: Un messaggio inviato da un client appare agli altri della stessa room entro pochi secondi con connessione attiva.
- **SC-003**: Un allegato caricato è visibile/scaricabile dagli altri partecipanti.
- **SC-004**: Con permesso concesso, una notifica push arriva ad app chiusa alla ricezione di un nuovo messaggio.
- **SC-005**: `curl /health` risponde 200 su un'istanza avviata correttamente.
- **SC-006**: L'app gira in modo stabile su Raspberry Pi 4 (target verificato in produzione) con footprint compatibile con hardware modesto.

## Assumptions

- Gli account esistono già in `config/chat-users.json`; non c'è auto-registrazione pubblica.
- Il deploy di riferimento è systemd + reverse proxy (nginx) + tunnel Cloudflare opzionale.
- La baseline v1.0.0 **non** ha test automatici né CI: colmarli è la prima feature post-baseline (`specs/002-test-suite-ci/`).
- E2E encryption dei messaggi è fuori scope per la v1; l'eventuale cifratura riguarderà lo storage at-rest ed è una feature futura opzionale.
