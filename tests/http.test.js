'use strict';

// Suite di smoke/integration sul layer HTTP (spec 002-test-suite-ci).
// Usa il test runner nativo di Node (`node --test`) e app.inject() di Fastify:
// nessuna porta di rete aperta, nessuna dipendenza esterna.
//
// Isolamento: prima di caricare l'app reindirizziamo cwd e gli store verso una
// directory temporanea. chat.db usa un path relativo a process.cwd() (hardcoded
// in src/routes/chat.js), quindi il chdir è l'unico modo per non toccare i DB di
// produzione senza modificare il runtime. Così i test sono ermetici e girano
// puliti anche in CI (niente .env, niente config/chat-users.json).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raspi-chat-test-'));
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });

// File utenti inesistente = nessun utente configurato: sufficiente per i
// percorsi di rifiuto del login testati qui.
process.env.CHAT_USERS_FILE = path.join(tmpRoot, 'chat-users.json');
process.chdir(tmpRoot);

const { buildApp } = require(path.join(originalCwd, 'src', 'app'));

let app;

before(async () => {
  app = buildApp();
  await app.ready();
});

after(async () => {
  if (app) await app.close();
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('GET /health risponde 200 con ok:true', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.ok, true);
  assert.ok(body.service, 'deve includere il nome del servizio');
});

test('GET /version risponde 200 con nome e versione Node', async () => {
  const res = await app.inject({ method: 'GET', url: '/version' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.name, 'deve includere il nome del servizio');
  assert.match(body.node, /^v\d+/, 'deve riportare la versione di Node');
});

test('POST /chat/login senza credenziali risponde 400', async () => {
  const res = await app.inject({ method: 'POST', url: '/chat/login', payload: {} });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.json().error, 'Missing credentials');
});

test('POST /chat/login con credenziali inesistenti risponde 401', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/chat/login',
    payload: { username: 'utente-inesistente', password: 'password-sbagliata' },
  });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.json().error, 'Invalid credentials');
});
