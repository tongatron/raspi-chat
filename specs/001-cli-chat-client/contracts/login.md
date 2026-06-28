# Contract: HTTP Login

**Endpoint**: `POST {baseUrl}/chat/login`
**Source of truth**: `src/routes/chat.js` (handler `app.post('/chat/login', ...)`)

## Request

```http
POST /chat/login
Content-Type: application/json

{ "username": "<string>", "password": "<string>" }
```

## Responses

| Status | Body | Significato CLI |
|--------|------|-----------------|
| 200 | `{ "token": "<string>", "username": "<string>", "role": "...", ... }` | Login ok. Conservare `token` e `username` per l'handshake `join`. |
| 400 | `{ "error": "Missing credentials" }` | username o password mancanti → richiedere di nuovo. |
| 401 | `{ "error": "Invalid credentials" }` | credenziali errate → mostrare errore e riprovare. |

## Note per la CLI

- Serve solo il campo `token` dalla risposta (più `username` normalizzato). I cookie di sessione **non** sono necessari: il WebSocket si autentica passando il `token` nel messaggio `join`.
- Il `baseUrl` proviene da `RASPI_CHAT_URL` / `--url`.
