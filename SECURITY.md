# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's
[private vulnerability reporting](https://github.com/tongatron/raspi-chat/security/advisories/new)
instead. Include what you found, how to reproduce it, and what an attacker could
do with it. Expect a first reply within a week.

## What this project is, and is not

raspi-chat is a self-hosted chat for a small, trusted group — family, friends, a
few colleagues. It is not an enterprise messenger and does not claim the threat
model of one. Knowing where the line is drawn matters more than a long list of
features, so the current model is written out below.

## Security model

**Passwords** are stored with `scrypt` and a per-user random salt. They are never
logged and never leave the server.

**Sessions** are stateless. The token is `HMAC-SHA256(username, TOKEN_SECRET)`,
sent either in the `x-chat-token` header (CLI, WebSocket) or in a `HttpOnly`,
`SameSite=Strict` cookie scoped to `/chat`.

Two consequences worth stating plainly:

- A token **does not expire** and is the same on every login. There is no
  per-session nonce, so an individual token cannot be revoked.
- Rotating `TOKEN_SECRET` invalidates **every** token at once. That is the only
  way to force a global logout, and it is what to do if a token leaks.

**At-rest encryption** is opt-in via `CHAT_DB_KEY`. When it is set, `chat.db` is
encrypted by SQLCipher and attachments in `data/uploads/` with AES-256-GCM. This
protects a stolen SD card, a misplaced backup, or a snapshot of the filesystem.
It does **not** protect against an attacker who can already run code as the app
user: the key is in the process environment, so anything the app can read, they
can read. Messages are **not** end-to-end encrypted — the server sees plaintext.

**Roles** are `admin` (manages users), `superuser` (invites, console) and `user`.
Room membership is enforced on every REST route and on the WebSocket `join`.

**The user list is public by default.** `GET /chat/login-users` needs no
authentication: it returns every username and role, including which account is
the admin. That is deliberate — the login screen shows one card per user to
click. Set `CHAT_PRIVATE_LOGIN=1` to turn this off: the endpoint then returns
nothing and the login screen asks for a typed username, so usernames and roles
stay private. Recommended for internet-facing instances.

**Login attempts are not rate-limited.** `scrypt` makes each attempt costly, but
nothing stops an attacker from trying indefinitely. If you expose the instance
to the internet, put rate limiting in front of it (nginx `limit_req`, or
Cloudflare) and choose strong passwords.

**Attachments** are limited to an allow-list of extensions. Only media and PDFs
are served inline; everything else is forced as a download, so an uploaded file
cannot execute in the context of the page.

**The setup wizard** (`/setup`) is reachable only from localhost or a private
network address, and only until setup is marked complete.

## Deployment expectations

- Put the app behind TLS. The session cookie is not marked `Secure`, so plain
  HTTP over an untrusted network exposes it.
- Set a long random `TOKEN_SECRET`. The value in `.env.example` is a
  placeholder; if it is left unset, a random one is generated at boot and every
  restart logs everyone out.
- Keep `CHAT_DB_KEY` somewhere other than the Pi. **Lose it and the encrypted
  data is unrecoverable.**
- `.env`, `config/chat-users.json`, `data/` and any keystore are git-ignored.
  Check `git status` before pushing anyway.

## Supported versions

The latest commit on `main` is the only supported version.
