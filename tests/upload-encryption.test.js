'use strict';

// Integrazione (spec 007): upload cifrato + serve decifrato attraverso l'app reale.
// Verifica il wiring in src/routes/chat.js (che i test del solo modulo non coprono):
// con CHAT_DB_KEY il file su disco è cifrato e GET /chat/images lo restituisce
// identico all'originale. Tempdir isolata: non tocca i dati di produzione.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const USERNAME = 'UpUser';
const PASSWORD = 'pw-123456';

const originalCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raspi-chat-upload-'));
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(tmpRoot, 'chat-users.json'),
  JSON.stringify([{ username: USERNAME, password: PASSWORD, role: 'user' }]),
);

const KEY = 'c'.repeat(64);
process.env.CHAT_DB_KEY = KEY;
process.env.CHAT_USERS_FILE = path.join(tmpRoot, 'chat-users.json');
process.env.CHAT_DB_PATH = path.join(tmpRoot, 'data', 'chat.db');
process.env.DB_PATH = path.join(tmpRoot, 'data', 'app.db');
process.chdir(tmpRoot);

const { buildApp } = require(path.join(originalCwd, 'src', 'app'));

const PLAIN = Buffer.from('\x89PNG\r\n\x1a\n-immagine-super-segreta-di-esempio-42', 'binary');
let app;
let token;

before(async () => {
  app = buildApp();
  await app.ready();
  const res = await app.inject({
    method: 'POST',
    url: '/chat/login',
    payload: { username: USERNAME, password: PASSWORD },
  });
  token = JSON.parse(res.body).token;
});

after(async () => {
  if (app) await app.close();
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CHAT_DB_KEY;
});

function multipart(fieldName, filename, content) {
  const boundary = '----rc' + Math.random().toString(16).slice(2);
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
    'Content-Type: application/octet-stream\r\n\r\n';
  const tail = `\r\n--${boundary}--\r\n`;
  return {
    body: Buffer.concat([Buffer.from(head), content, Buffer.from(tail)]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

test('login riuscito, token presente', () => {
  assert.ok(token, 'il login deve restituire un token');
});

test('upload con CHAT_DB_KEY: file cifrato su disco e servito decifrato (SC-001, SC-002)', async () => {
  const { body, contentType } = multipart('file', 'foto.png', PLAIN);
  const up = await app.inject({
    method: 'POST',
    url: '/chat/upload',
    headers: { 'x-chat-username': USERNAME, 'x-chat-token': token, 'content-type': contentType },
    payload: body,
  });
  assert.strictEqual(up.statusCode, 200, up.body);
  const { url } = JSON.parse(up.body);
  assert.ok(url.startsWith('/chat/images/'), url);

  // Su disco: cifrato, il contenuto in chiaro non compare
  const filename = url.split('/').pop();
  const onDisk = fs.readFileSync(path.join(tmpRoot, 'data', 'uploads', filename));
  assert.strictEqual(onDisk.includes(PLAIN), false, 'il file su disco non deve contenere il contenuto in chiaro');

  // Serve: decifrato, byte-identico all'originale
  const got = await app.inject({
    method: 'GET',
    url,
    headers: { 'x-chat-username': USERNAME, 'x-chat-token': token },
  });
  assert.strictEqual(got.statusCode, 200);
  assert.ok(got.rawPayload.equals(PLAIN), 'lo scaricato deve essere byte-identico all\'originale');
});
