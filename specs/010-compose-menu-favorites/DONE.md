# Spec 010 — Riepilogo implementazione

**Stato**: Implemented (2026-07-19)

## Cosa è stato fatto

- **Backend** (`src/routes/chat.js`): nuova tabella `message_favorites (message_id,
  username)`; WS `favorite`/`unfavorite` con ack diretto al socket (nessun broadcast di
  stanza); cleanup delle righe alla cancellazione del messaggio (handler `delete`);
  `loadHistory`/pagina `/chat/messages` ora calcolano `favorite: true/false` per utente;
  nuova route `GET /chat/favorites?roomId=` (stesso pattern di `/chat/media`).
- **Frontend** (`public/chat.html`): il pulsante clip è diventato un pulsante **+** che
  apre un menu con "Attach file" (comportamento invariato) e "Send location"
  (`navigator.geolocation` → messaggio `geo:<lat>,<lng>`, renderizzato come card con
  link a OpenStreetMap); stella preferiti nella riga meta di ogni messaggio; nuova vista
  "Favorites" nel menu Impostazioni con elenco per stanza e scroll al messaggio
  originale.
- **Test**: `tests/message-favorites.test.js` (5 test, WS + HTTP reali via
  `app.listen`) copre marcatura/persistenza, isolamento per utente, smarcatura,
  cleanup su cancellazione, e persistenza nello storico dopo rejoin.

## Verifica manuale

Server avviato in locale con utente dedicato (`Tester`/admin), isolato dal DB reale:

- Pulsante **+** apre il menu con le due voci attese.
- "Attach file" apre ancora il file picker esistente (nessuna regressione).
- "Send location" (geolocalizzazione simulata via script, non disponibile nel browser
  sandboxato di anteprima) invia un messaggio che appare come card "📍 Location" con
  link corretto a OpenStreetMap.
- La stella preferiti marca il messaggio, sopravvive al reload della pagina, compare
  nella vista Favorites, e cliccandola torna alla chat riportando al messaggio.
- Smarcare il preferito lo rimuove sia dalla stella sia dalla vista Favorites.

`npm test`: 48/48 verdi (43 preesistenti + 5 nuovi).

## Fuori scope (rimandato)

Vedi "Assumptions & Dependencies" in [spec.md](spec.md): trascrizione vocale, notifica
di ingresso in stanza, separatore di data, riordino menu Impostazioni, supporto CLI per
posizione/preferiti.
