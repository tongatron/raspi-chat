# Contributing to raspi-chat

Thanks for taking a look. This is a small, framework-free project meant to stay
readable on a Raspberry Pi — contributions that keep it that way are very
welcome.

## Getting set up

```bash
git clone https://github.com/tongatron/raspi-chat.git
cd raspi-chat
npm install
npm start
```

Open `http://127.0.0.1:3000/setup` and follow the wizard, or copy `.env.example`
to `.env` and `config/chat-users.example.json` to `config/chat-users.json` by
hand. Neither `.env` nor the real users file is ever committed.

## Before you open a pull request

```bash
npm run lint    # ESLint, catches unused bindings and accidental globals
npm run check   # dependency-free syntax check (this one also runs on the Pi)
npm test        # Node's built-in test runner
```

All three run on every push and pull request via GitHub Actions. Please make
sure they are green locally first.

## How the code is organised

| Path | What lives there |
|------|------------------|
| `server.js` | Entry point: loads `.env`, builds the app, listens |
| `src/app.js` | Fastify instance and plugin registration |
| `src/lib/` | Small helpers shared across routes (request, normalisation, formatting) |
| `src/chat/` | The chat feature, one concern per module (see below) |
| `src/routes/chat/` | Chat routes, grouped by concern — thin, they delegate to `src/chat/` |
| `src/routes/` | The remaining routes: landing pages and the setup wizard |
| `public/` | HTML pages — markup only, no inline CSS or JS |
| `public/assets/chat/` | The chat client, one file per concern |
| `cli/` | Terminal chat client |
| `ops/` | Deploy scripts, encryption migrations, the syntax checker |
| `tests/` | `node --test` suites |
| `specs/` | One folder per feature, written before the code |

Inside `src/chat/`:

- `database.js` — connection, schema, migrations, every prepared statement
- `auth.js` — tokens, cookies, roles, route guards
- `serializers.js` — database rows to API/WebSocket payloads
- `presence.js` — live sockets, broadcast, who is online
- `push.js` — Web Push subscriptions and delivery
- `attachments.js` — allowed formats, filename handling
- `rooms.js` — registration and first-room lifecycle
- `link-preview.js` — OpenGraph, YouTube and Facebook previews
- `system-stats.js` — CPU temperature and disk usage for the admin console

## Conventions

- **Comments in English**, and only where the code cannot speak for itself —
  explain *why*, not *what*.
- **CommonJS on the server, classic scripts in the browser.** No build step, no
  transpiler, no bundler: what you read is what runs.
- **Frontend files declare their coupling.** The files under
  `public/assets/chat/` share one global scope, so each one starts with a
  `/* global */` header listing what it takes from its siblings (with
  `:writable` on anything it mutates) and an `/* exported */` header listing
  what it offers. ESLint enforces both, so those two lines cannot go stale.
  `bootstrap.js` loads last and owns all the DOM wiring and the boot sequence —
  put eager top-level code there, not in the module that defines the function.
- **New dependencies need a reason.** The runtime dependency list is short on
  purpose; it has to install on an old Pi.
- Route handlers stay thin: logic belongs in `src/chat/`.
- Every feature ships with tests. The suite runs against `app.inject()` in an
  isolated temporary directory and never touches real data.

## Specs

Larger changes start as a folder under `specs/`, numbered, describing the
behaviour before it is built. Look at an existing one for the shape. Small fixes
do not need this.

## Reporting bugs

Open an issue with what you expected, what happened, and how to reproduce it.
For anything security-related, read [SECURITY.md](SECURITY.md) first — please do
not open a public issue.
