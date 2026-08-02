# Server optimization plan

A staged plan for making a `raspi-chat` deployment faster, leaner, and safer on
a Raspberry Pi, without changing what the app does. Each stage is independent:
do them in order of impact, and stop wherever the result is good enough.

Every item lists **why**, **how**, and **how to verify**. Nothing here is
required to run the app — the defaults work — but each step buys headroom on
modest hardware.

The reference deployment is: Node + Fastify behind nginx, a Cloudflare Tunnel
for TLS, SQLite in WAL mode, managed by systemd. The setup wizard (`/setup`)
generates the systemd, nginx, and Cloudflare files; the changes below belong in
those generated templates (`src/routes/setup.js`) so a fresh install inherits
them.

---

## Stage 1 — Static asset delivery (highest impact, lowest risk)

The chat client is now ~14 small JS files plus per-page CSS/JS. They are served
by `GET /chat/assets/*` with `Cache-Control: no-cache, must-revalidate`, so the
browser revalidates **every file on every load**. On a LAN that is wasteful; over
a tunnel it is the single biggest win available.

1. **Long-lived caching with content hashing.**
   - Why: turn dozens of conditional requests per page load into zero after the
     first visit.
   - How: append a content hash or version query to asset URLs
     (`chat/state.js?v=<hash>`) and serve hashed assets with
     `Cache-Control: public, max-age=31536000, immutable`. Keep HTML itself
     `no-store` (it already is) so a new deploy is picked up immediately.
   - Verify: reload the chat twice with DevTools open — the second load should
     show `200` for the HTML and `304`/memory-cache (or no request) for assets.

2. **Pre-compress text assets.**
   - Why: CSS/JS compress 3–5×; the Pi should not gzip on every request.
   - How: ship `.js.gz`/`.css.gz` (and `.br` if brotli is available) and let
     nginx `gzip_static on;` / `brotli_static on;` serve them. Alternatively
     enable Fastify's compression, but static pre-compression is cheaper.
   - Verify: `curl -H 'Accept-Encoding: br' -I https://<host>/chat/assets/chat/state.js`
     returns `Content-Encoding: br`.

3. **Consider concatenating the chat client for production.**
   - Why: 14 files is great for reading, not for HTTP/1.1 round-trips. Under
     HTTP/2 (which the tunnel provides) this matters less, so measure first.
   - How: an optional build step that concatenates `public/assets/chat/*.js` in
     the load order from `chat.html` into one file, used only in production. The
     split source stays the source of truth.
   - Verify: compare page-load waterfall before/after; only keep it if the
     round-trip count actually hurts.

---

## Stage 2 — SQLite tuning (medium impact, low risk)

`chat.db` opens with only `journal_mode = WAL`. A few more pragmas make it more
responsive and far kinder to the SD card. Set them in `src/chat/database.js`
right after the WAL line.

1. **`busy_timeout = 5000`** — wait instead of failing when a write briefly
   overlaps a read. Removes rare `SQLITE_BUSY` errors under concurrent load.
2. **`synchronous = NORMAL`** — safe with WAL, roughly halves fsync traffic.
   The only exposure is losing the last transaction on a power cut, which for a
   chat is acceptable.
3. **`cache_size = -8000`** (~8 MB) and **`mmap_size = 268435456`** (256 MB) —
   keep hot pages in memory; a Pi has the RAM to spare.
4. **`wal_autocheckpoint`** review + a periodic `PRAGMA wal_checkpoint(TRUNCATE)`
   (e.g. nightly) so the WAL file does not grow without bound.
5. **Scheduled `VACUUM`/`ANALYZE`** — monthly, off-peak, to reclaim space and
   refresh query plans after lots of deletes.

- Verify: `PRAGMA journal_mode; PRAGMA synchronous; PRAGMA busy_timeout;` return
  the expected values; run the test suite (it exercises the same open path) to
  confirm nothing regressed.

---

## Stage 3 — systemd hardening & resource limits (medium impact, low risk)

The generated unit only sets `Restart=always`. Add sandboxing and limits so a
bug or a bad day cannot take the whole Pi down. Put these in
`renderServiceFile()`.

```ini
[Service]
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/srv/apps/raspi-chat/data
MemoryMax=512M
MemoryHigh=400M
TasksMax=256
LimitNOFILE=8192
```

- Why: `ProtectSystem=strict` makes the filesystem read-only except the declared
  data path; `MemoryMax` turns a memory leak into a clean restart instead of an
  OOM freeze; `LimitNOFILE` gives WebSocket connections room.
- How: extend the template, keeping `ReadWritePaths` in sync with `data/`.
- Verify: `systemd-analyze security raspi-chat` (score should drop toward the
  green); restart the service and confirm the app still reads/writes `data/`.

Also: **journald log limits.** Fastify logs every request at `info`. Cap on-disk
logs (`SystemMaxUse=200M` in `journald.conf`, or lower Fastify to `warn` in
production) so logs do not fill the card.

---

## Stage 4 — nginx: compression, rate limiting, headers (medium impact)

The generated server block is a bare proxy. Harden and speed it up.

1. **Rate-limit authentication.** Login is not throttled in the app (see
   [SECURITY.md](../SECURITY.md)). Add a zone and apply it to `/chat/login`:
   ```nginx
   limit_req_zone $binary_remote_addr zone=login:10m rate=10r/m;
   location = /chat/login { limit_req zone=login burst=5 nodelay; proxy_pass ...; }
   ```
   - Verify: a burst of login requests starts returning `503` after the limit.

2. **Security headers** (belt-and-braces behind Cloudflare):
   `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
   `Referrer-Policy: strict-origin-when-cross-origin`, and a `Content-Security-Policy`.
   The app already avoids external scripts, so a strict CSP is realistic and
   worth pursuing.
   - Verify: [securityheaders.com](https://securityheaders.com) or
     `curl -I` shows them.

3. **Compression + static caching** at the proxy for `/chat/assets/*`
   (pairs with Stage 1): `gzip on;` for text types, and a long `expires` /
   `Cache-Control` for hashed assets.

4. **WebSocket timeouts.** The app sends a 30 s keepalive ping, but set
   `proxy_read_timeout 120s;` on the chat location so nginx does not drop a
   quiet-but-live socket first.
   - Verify: leave a chat tab idle for several minutes; the socket stays open
     (no reconnect in the console).

---

## Stage 5 — Backups & monitoring (operational safety)

1. **Automated encrypted backups.** The admin panel can download `chat.db`, but
   that is manual. Add a nightly job that copies `chat.db` (and `data/uploads/`)
   somewhere off the Pi. With `CHAT_DB_KEY` set, the file is already encrypted at
   rest, so the copy is safe to store remotely.
   - How: a timer unit running `sqlite3 chat.db ".backup"` (consistent even
     while running) plus `rsync`/`rclone` to an external target.
   - Verify: restore a backup into a throwaway dir and open it with the current
     key (`ops/encrypt-db.js` and the restore test show the pattern).

2. **Health alerting.** The console already reads CPU temperature, load, RAM and
   disk. Add a threshold alert (a small cron that hits `/status` or reads the
   same values and notifies) so a hot or full Pi is noticed before it fails.

3. **Uptime check.** A simple external ping on `/health` catches a tunnel or
   service outage that internal monitoring cannot see.

---

## Stage 6 — SD-card longevity (Pi-specific)

Flash wear is the most common way a Pi deployment dies.

1. Keep `synchronous = NORMAL` and periodic WAL truncation (Stage 2) — fewer
   writes.
2. Cap journald disk use, or make logs volatile (`Storage=volatile`) so request
   logs live in RAM.
3. Do **not** move `data/` to tmpfs — that is the database; losing it on reboot
   is not an option. Logs and caches are the safe things to keep in RAM.
4. Prefer a good-quality A2 card, or move `data/` to an external SSD for a
   heavily used instance.

---

## Suggested order

1. **Stage 1** and **Stage 2** first: pure wins, almost no risk, immediately
   noticeable.
2. **Stage 3** and **Stage 4** next: they mostly touch the generated deploy
   templates, so a fresh `/setup` inherits them.
3. **Stage 5** and **Stage 6** are ongoing operational hygiene rather than
   one-off changes.

Measure before and after where you can — the console's own CPU/RAM graphs and
the browser's network waterfall are enough to tell whether a change earned its
place.
