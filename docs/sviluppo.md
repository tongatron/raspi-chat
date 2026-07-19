# Sviluppo

## Endpoint utili

Pubblici:
- `GET /chat`
- `POST /chat/login`
- `GET /chat/ws`
- `GET /chat/manifest.json`
- `GET /chat/app.apk`
- `GET /.well-known/assetlinks.json`
- `GET /sw.js`
- `GET /health`
- `GET /version`

Privati (richiedono autenticazione):
- `GET /chat/messages`
- `POST /chat/upload`
- `GET /chat/images/:filename`
- `GET /chat/preview`
- `GET /chat/console/data`
- `GET /chat/favorites`

## Verifica veloce

```bash
curl http://127.0.0.1:3000/health

curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"Test","password":"..."}' \
  http://127.0.0.1:3000/chat/login

npm run check
```

## Test

La suite usa il runner nativo di Node (`node --test`, nessuna dipendenza aggiuntiva) e verifica il layer HTTP con `app.inject()`, senza avviare un server né toccare i database di produzione (i test girano isolati in una directory temporanea):

```bash
npm test
```

Gli stessi controlli (`npm run check` + `npm test`) girano automaticamente in CI su ogni push e pull request tramite GitHub Actions. Ogni nuova feature deve arrivare con i propri test.
