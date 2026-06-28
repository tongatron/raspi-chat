# Feature Specification: CLI Chat Client

**Feature Branch**: `spec-kit-cli`

**Created**: 2026-06-28

**Status**: Draft

**Input**: User description: "Interfaccia CLI interattiva per la chat raspi-chat. Un'applicazione da terminale (TUI/REPL) che permette a un utente di usare la chat senza il browser, riusando il backend esistente: login con username/password, connessione realtime, visualizzazione storico, invio messaggi di testo, lista utenti online, selezione room, gestione errori di autenticazione/room e riconnessione."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Accedere e leggere la conversazione (Priority: P1)

Un utente avvia la chat dal terminale, inserisce le proprie credenziali e, una volta autenticato, vede lo storico recente dei messaggi della sua room e poi i nuovi messaggi che arrivano in tempo reale, senza dover aprire un browser.

**Why this priority**: È il valore minimo indispensabile. Senza autenticazione + visualizzazione realtime non esiste alcuna chat utilizzabile; tutto il resto si appoggia su questo.

**Independent Test**: Si avvia la CLI, si effettua il login con un utente valido e si verifica che lo storico venga mostrato e che un messaggio inviato da un altro client (es. il browser) compaia nel terminale entro pochi secondi.

**Acceptance Scenarios**:

1. **Given** un utente con credenziali valide, **When** avvia la CLI e completa il login, **Then** vede lo storico dei messaggi della room di default e l'indicazione di essere connesso.
2. **Given** una sessione CLI connessa, **When** un altro partecipante invia un messaggio nella stessa room, **Then** il messaggio appare nel terminale con mittente, testo e orario.
3. **Given** credenziali errate, **When** l'utente tenta il login, **Then** riceve un messaggio d'errore chiaro e gli viene data la possibilità di riprovare senza che l'applicazione si chiuda inaspettatamente.

---

### User Story 2 - Inviare messaggi di testo (Priority: P1)

Un utente autenticato digita un messaggio nel terminale e lo invia agli altri partecipanti della room.

**Why this priority**: Una chat che permette solo di leggere non è una chat. Insieme alla Story 1 forma l'MVP completo di comunicazione bidirezionale.

**Independent Test**: Da una sessione CLI autenticata si digita un testo e si verifica che compaia nella propria vista e che venga ricevuto da un altro client connesso alla stessa room.

**Acceptance Scenarios**:

1. **Given** una sessione connessa, **When** l'utente digita un testo e conferma l'invio, **Then** il messaggio viene recapitato agli altri partecipanti e mostrato nella propria conversazione.
2. **Given** un input vuoto, **When** l'utente conferma, **Then** non viene inviato alcun messaggio.
3. **Given** un testo molto lungo, **When** l'utente lo invia, **Then** il sistema applica lo stesso limite di lunghezza del resto della chat senza errori bloccanti.

---

### User Story 3 - Vedere chi è online e scegliere la room (Priority: P2)

Un utente vuole sapere chi è attualmente connesso e poter operare su una room diversa da quella di default.

**Why this priority**: Migliora l'usabilità e rende la CLI paritaria al client web, ma non è indispensabile per scambiare messaggi.

**Independent Test**: Con due client connessi alla stessa room si verifica che la CLI mostri entrambi come online; avviando la CLI con una room specificata si verifica che venga caricato lo storico corretto di quella room.

**Acceptance Scenarios**:

1. **Given** una sessione connessa, **When** un altro utente entra o esce dalla room, **Then** la lista degli utenti online si aggiorna.
2. **Given** un utente membro di più room, **When** specifica una room all'avvio, **Then** la CLI si unisce a quella room e ne mostra lo storico.
3. **Given** un utente non membro della room richiesta, **When** tenta di unirsi, **Then** riceve un messaggio d'errore chiaro e non resta in uno stato bloccato.

---

### User Story 4 - Resistere a cadute di connessione (Priority: P2)

Un utente con connessione instabile (tipico per un dispositivo casalingo come un Raspberry Pi) mantiene la sessione utilizzabile: quando la connessione cade, la CLI lo segnala e tenta di riconnettersi automaticamente.

**Why this priority**: Aumenta l'affidabilità nell'uso reale, ma la chat resta utilizzabile manualmente anche senza riconnessione automatica.

**Independent Test**: Si interrompe la rete o si riavvia il server e si verifica che la CLI segnali la disconnessione e ristabilisca la sessione (ri-autenticandosi e ri-unendosi alla room) una volta tornata raggiungibile.

**Acceptance Scenarios**:

1. **Given** una sessione attiva, **When** la connessione realtime cade, **Then** l'utente vede un avviso di disconnessione.
2. **Given** una connessione caduta, **When** il server torna raggiungibile, **Then** la CLI si riconnette automaticamente e ripristina la room corrente senza richiedere di reinserire le credenziali.
3. **Given** ripetuti tentativi falliti, **When** la riconnessione non riesce, **Then** la CLI continua a riprovare con intervalli crescenti senza saturare il sistema e senza terminare bruscamente.

---

### Edge Cases

- **Server non raggiungibile all'avvio**: la CLI mostra un errore comprensibile e termina con uno stato d'uscita non-zero invece di bloccarsi.
- **Sessione scaduta/invalida**: se il token non è più valido durante l'uso, l'utente viene informato e invitato a riautenticarsi.
- **Messaggi in arrivo mentre l'utente sta digitando**: la riga di input non deve essere corrotta dall'arrivo di nuovi messaggi.
- **Room inesistente o utente rimosso dalla room durante la sessione**: l'utente riceve una notifica e la sessione non resta in uno stato incoerente.
- **Terminale ridimensionato o molto stretto**: la visualizzazione resta leggibile.
- **Interruzione manuale (Ctrl+C)**: l'applicazione chiude in modo pulito la connessione.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema MUST permettere a un utente di autenticarsi fornendo username e password e ottenere una sessione valida riusando il meccanismo di autenticazione esistente del backend.
- **FR-002**: Il sistema MUST stabilire una connessione realtime con il backend dopo l'autenticazione e unirsi a una room.
- **FR-003**: Il sistema MUST mostrare lo storico recente dei messaggi della room appena connesso.
- **FR-004**: Il sistema MUST mostrare i nuovi messaggi in arrivo in tempo reale, indicando per ciascuno mittente, testo e orario.
- **FR-005**: Gli utenti MUST poter comporre e inviare messaggi di testo agli altri partecipanti della room.
- **FR-006**: Il sistema MUST ignorare gli invii di messaggi vuoti.
- **FR-007**: Il sistema MUST rispettare lo stesso limite di lunghezza dei messaggi applicato dal resto della chat.
- **FR-008**: Il sistema MUST mostrare e mantenere aggiornata la lista degli utenti attualmente online nella room.
- **FR-009**: Il sistema MUST permettere di selezionare la room a cui connettersi. Quando la room non è specificata esplicitamente, il sistema MUST elencare le room di cui l'utente è membro e sceglierne una automaticamente se è l'unica, oppure farla scegliere all'utente; in assenza di room disponibili usa un valore di default.
- **FR-010**: Il sistema MUST gestire gli errori di autenticazione mostrando un messaggio chiaro e consentendo un nuovo tentativo o un'uscita pulita.
- **FR-011**: Il sistema MUST gestire gli errori di accesso alla room (room inesistente o utente non membro) con un messaggio chiaro.
- **FR-012**: Il sistema MUST rilevare la caduta della connessione realtime, segnalarla all'utente e tentare la riconnessione automatica ripristinando la sessione e la room correnti.
- **FR-013**: Il sistema MUST leggere l'indirizzo del server da configurazione esterna (es. variabile d'ambiente), con un valore di default sensato.
- **FR-014**: Il sistema MUST gestire l'interruzione manuale chiudendo la connessione in modo pulito.
- **FR-015**: Il sistema MUST mantenere la riga di input dell'utente leggibile e non corrotta dall'arrivo di nuovi messaggi.

### Key Entities *(include if feature involves data)*

- **Sessione utente**: rappresenta l'utente autenticato; attributi chiave: identità dell'utente e credenziale di sessione ottenuta al login.
- **Room**: spazio di conversazione a cui l'utente è unito; attributi chiave: identificativo, nome, appartenenza dell'utente.
- **Messaggio**: unità di conversazione mostrata e inviata; attributi chiave: mittente, testo, orario.
- **Presenza online**: insieme degli utenti attualmente connessi alla room.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un utente con credenziali valide riesce ad avviare la CLI, autenticarsi e vedere lo storico in meno di 30 secondi senza usare un browser.
- **SC-002**: Un messaggio inviato da un altro client appare nella CLI entro 3 secondi nelle condizioni d'uso normali.
- **SC-003**: Un messaggio inviato dalla CLI viene recapitato e visualizzato agli altri partecipanti nel 100% dei casi quando la connessione è attiva.
- **SC-004**: Dopo una caduta di connessione, la CLI ripristina automaticamente una sessione utilizzabile entro 30 secondi dal ritorno di raggiungibilità del server, senza intervento manuale di re-login.
- **SC-005**: Tutti gli errori previsti (credenziali errate, room non valida, server irraggiungibile) producono un messaggio comprensibile e non causano un crash non gestito.

## Assumptions

- L'utente possiede già un account valido sulla chat; la registrazione di nuovi utenti è fuori scope.
- Si riusa il backend e i meccanismi di autenticazione/realtime esistenti; non vengono introdotte nuove modalità di accesso lato server.
- La CLI gira nello stesso runtime del progetto e viene eseguita da un terminale interattivo.
- Funzionalità avanzate sono fuori scope per questa versione: invio di immagini/allegati, risposta a messaggi (reply), eliminazione di messaggi, ricevute di lettura, funzioni di amministrazione e inviti.
- L'ambiente di esecuzione tipico è una rete domestica con possibile instabilità (es. Raspberry Pi).
