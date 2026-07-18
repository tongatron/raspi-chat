'use strict';

// Test del login con credenziali VALIDE (spec 003-configurable-chat-db-path).
// Ora possibile in modo ermetico perche' chat.db usa CHAT_DB_PATH: puntiamo DB e
// file utenti a una tempdir e verifichiamo il flusso completo di autenticazione
// senza toccare i dati di produzione. File separato = processo separato sotto
// `node --test`, quindi l'env qui non interferisce con gli altri test.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const USERNAME = 'TestUser';
const PASSWORD = 'secret-pw-123';

const originalCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raspi-chat-login-'));
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(tmpRoot, 'chat-users.json'),
  JSON.stringify([{ username: USERNAME, password: PASSWORD, role: 'user' }]),
);

process.env.CHAT_USERS_FILE = path.join(tmpRoot, 'chat-users.json');
process.env.CHAT_DB_PATH = path.join(tmpRoot, 'data', 'chat.db');
process.env.DB_PATH = path.join(tmpRoot, 'data', 'app.db');
process.chdir(tmpRoot);

const { buildApp } = require(path.join(originalCwd, 'src', 'app'));

let app;

before(async () => {
  app = buildApp();
  await app.ready(); // qui avviene la sync degli utenti dal fixture nel chat.db isolato
});

after(async () => {
  if (app) await app.close();
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('POST /chat/login con credenziali valide risponde 200 e un token', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/chat/login',
    payload: { username: USERNAME, password: PASSWORD },
  });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.token, 'deve restituire un token di sessione');
  assert.strictEqual(body.username, USERNAME);
  assert.strictEqual(body.role, 'user');
});

test('POST /chat/login con utente valido ma password errata risponde 401', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/chat/login',
    payload: { username: USERNAME, password: 'password-errata' },
  });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.json().error, 'Invalid credentials');
});
