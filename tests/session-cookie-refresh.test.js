'use strict';

// Regressione: gli allegati sono caricati dal browser come <img>/<video>/<a>,
// senza gli header `x-chat-*`, quindi dipendono solo dal cookie di sessione.
// Il cookie dura 30 giorni ed era impostato solo al login, mentre il client
// resta autenticato a tempo indeterminato col token in localStorage: scaduto o
// perso il cookie, la chat continuava a funzionare ma le immagini sparivano.
// GET /chat/me (chiamata a ogni avvio dell'app) deve rinnovare il cookie.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const USERNAME = 'CookieUser';
const PASSWORD = 'pw-123456';

const originalCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raspi-chat-cookie-'));
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(tmpRoot, 'chat-users.json'),
  JSON.stringify([{ username: USERNAME, password: PASSWORD, role: 'user' }]),
);

process.env.CHAT_USERS_FILE = path.join(tmpRoot, 'chat-users.json');
process.env.CHAT_DB_PATH = path.join(tmpRoot, 'data', 'chat.db');
process.chdir(tmpRoot);

const { buildApp } = require(path.join(originalCwd, 'src', 'app'));

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
});

function authHeaders() {
  return { 'x-chat-username': USERNAME, 'x-chat-token': token };
}

function multipart(filename, content) {
  const boundary = '----rc' + Math.random().toString(16).slice(2);
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    'Content-Type: application/octet-stream\r\n\r\n';
  const tail = `\r\n--${boundary}--\r\n`;
  return {
    body: Buffer.concat([Buffer.from(head), content, Buffer.from(tail)]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

test('GET /chat/me rinnova il cookie di sessione anche se il client si autentica con i soli header', async () => {
  const res = await app.inject({ method: 'GET', url: '/chat/me', headers: authHeaders() });
  assert.strictEqual(res.statusCode, 200);
  const setCookie = String(res.headers['set-cookie'] || '');
  assert.match(setCookie, /^chat_auth=/, 'la risposta deve reimpostare chat_auth');
  assert.match(setCookie, /Max-Age=2592000/, 'il cookie deve ripartire da 30 giorni');
  assert.match(setCookie, /HttpOnly/);
});

test('il cookie rinnovato serve un allegato caricato come <img>, cioe senza header', async () => {
  const png = Buffer.from('\x89PNG\r\n\x1a\n-contenuto-di-prova', 'binary');
  const { body, contentType } = multipart('screenshot.png', png);
  const up = await app.inject({
    method: 'POST',
    url: '/chat/upload',
    headers: { ...authHeaders(), 'content-type': contentType },
    payload: body,
  });
  assert.strictEqual(up.statusCode, 200);
  const url = JSON.parse(up.body).url;

  // Senza cookie (quello del login scaduto) l'immagine non e raggiungibile.
  const anonymous = await app.inject({ method: 'GET', url });
  assert.strictEqual(anonymous.statusCode, 401);

  const me = await app.inject({ method: 'GET', url: '/chat/me', headers: authHeaders() });
  const cookie = String(me.headers['set-cookie'] || '').split(';')[0];
  const served = await app.inject({ method: 'GET', url, headers: { cookie } });
  assert.strictEqual(served.statusCode, 200);
  assert.strictEqual(served.rawPayload.toString('binary'), png.toString('binary'));
});
