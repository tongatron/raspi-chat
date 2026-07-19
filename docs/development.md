# Development

## Useful endpoints

Public:
- `GET /chat`
- `POST /chat/login`
- `GET /chat/ws`
- `GET /chat/manifest.json`
- `GET /chat/app.apk`
- `GET /.well-known/assetlinks.json`
- `GET /sw.js`
- `GET /health`
- `GET /version`

Private (require authentication):
- `GET /chat/messages`
- `POST /chat/upload`
- `GET /chat/images/:filename`
- `GET /chat/preview`
- `GET /chat/console/data`
- `GET /chat/favorites`

## Quick check

```bash
curl http://127.0.0.1:3000/health

curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"Test","password":"..."}' \
  http://127.0.0.1:3000/chat/login

npm run check
```

## Tests

The test suite uses Node's built-in test runner (`node --test`, no extra dependency) and exercises the HTTP layer with `app.inject()`, without starting a server or touching production databases (tests run isolated in a temporary directory):

```bash
npm test
```

The same checks (`npm run check` + `npm test`) run automatically in CI on every push and pull request via GitHub Actions. Every new feature must ship with its own tests.
