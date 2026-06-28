# Phase 0 Research: CLI Chat Client

## R1 — Libreria WebSocket client

- **Decision**: usare `ws` (già in `package.json`).
- **Rationale**: è già una dipendenza del progetto (usata lato server), zero installazioni nuove, API stabile e ampiamente nota. Espone `readyState`, eventi `open/message/close/error` sufficienti.
- **Alternatives considered**: `WebSocket` globale di Node (sperimentale/variabile tra versioni, rischioso su Pi con Node più vecchio); librerie TUI con socket integrato (overkill).

## R2 — REPL/Input nel terminale senza corrompere la riga in digitazione (FR-015)

- **Decision**: `node:readline` con prompt persistente; prima di stampare un messaggio in arrivo, cancellare la riga corrente (`readline.clearLine`/`cursorTo`), stampare il messaggio, poi richiamare `rl.prompt(true)` per ridisegnare l'input parziale.
- **Rationale**: tecnica standard per chat da terminale, nessuna dipendenza esterna, gestisce correttamente il buffer di input dell'utente (`rl.line`).
- **Alternatives considered**: `blessed`/`ink` (TUI complete) → troppe dipendenze e peso per un Raspberry; scrivere direttamente su stdout senza readline → input non editabile e facilmente corrotto.

## R3 — Login HTTP

- **Decision**: `fetch` globale di Node verso `POST {baseUrl}/chat/login` con body JSON `{username, password}`; leggere `token` dalla risposta JSON.
- **Rationale**: il backend ritorna esplicitamente `{ token, username, role, ... }` nel body (vedi `src/routes/chat.js`), quindi non serve gestire i cookie di sessione: il token basta per l'handshake WebSocket `join`. `fetch` è built-in da Node 18.
- **Alternatives considered**: modulo `http`/`https` (più verboso); riuso del cookie `chat_auth` (non necessario perché il WS si autentica col token nel messaggio `join`).

## R4 — Configurazione URL server

- **Decision**: variabile d'ambiente `RASPI_CHAT_URL` (default `http://localhost:3000`), con override opzionale via flag `--url`. L'URL WebSocket si deriva sostituendo lo schema (`http→ws`, `https→wss`) e aggiungendo `/chat/ws`.
- **Rationale**: coerente con il resto del progetto che usa env + `dotenv`; un default sensato permette l'uso locale immediato.
- **Open**: la porta di default reale va confermata in `src/config.js` durante l'implementazione (T-setup) e riflessa nel default.

## R5 — Strategia di riconnessione (FR-012, SC-004)

- **Decision**: backoff esponenziale con jitter, partendo da ~1s fino a un tetto di ~30s, retry indefiniti finché l'utente non esce. Dopo ogni riconnessione del socket, rifare automaticamente l'handshake `join` con token e room correnti; il server reinvia `history`.
- **Rationale**: l'ambiente target (rete domestica/Pi) è instabile; il token resta valido tra le riconnessioni quindi non serve re-login. Il tetto evita di saturare il sistema.
- **Alternatives considered**: retry a intervallo fisso (o troppo aggressivo o troppo lento); terminare alla prima caduta (peggiora l'esperienza, viola FR-012).

## R6 — Gestione errori applicativi dal server

- **Decision**: trattare `{type:'auth_error'}` come errore non recuperabile (token non valido → uscita con invito a riautenticarsi), `{type:'room_error'}` come errore di room (messaggio chiaro, possibilità di indicare un'altra room), e la chiusura inattesa del socket come trigger di riconnessione (R5).
- **Rationale**: distinzione necessaria perché auth/room error sono problemi logici (riprovare a connettersi non li risolve), mentre una close di rete sì.
- **Alternatives considered**: trattare tutti gli errori allo stesso modo → loop di riconnessione inutile su credenziali errate.

## R7 — Limite lunghezza messaggi (FR-007)

- **Decision**: troncare/limitare l'input a 2000 caratteri lato client, allineato al limite del server (`.slice(0, 2000)` in `chat.js`).
- **Rationale**: feedback immediato all'utente e coerenza col comportamento server.
- **Alternatives considered**: nessun limite client (il server tronca comunque, ma l'utente non se ne accorge).
