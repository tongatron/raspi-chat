'use strict';

// Test degli annunci di ingresso in stanza (spec 011): quando un utente viene
// aggiunto a una room (o si unisce da solo a una pubblica) deve comparire un
// messaggio di sistema (kind:'system') visibile a tutti i membri della stanza.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ADMIN = 'Admin';
const BOB = 'Bob';
const CAROL = 'Carol';
const PASSWORD = 'secret-pw-123';

const originalCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raspi-chat-join-message-'));
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(tmpRoot, 'chat-users.json'),
  JSON.stringify([
    { username: ADMIN, password: PASSWORD, role: 'admin' },
    { username: BOB, password: PASSWORD, role: 'user' },
    { username: CAROL, password: PASSWORD, role: 'user' },
  ]),
);

process.env.CHAT_USERS_FILE = path.join(tmpRoot, 'chat-users.json');
process.env.CHAT_DB_PATH = path.join(tmpRoot, 'data', 'chat.db');
process.env.DB_PATH = path.join(tmpRoot, 'data', 'app.db');
process.chdir(tmpRoot);

const { buildApp } = require(path.join(originalCwd, 'src', 'app'));

let app;
const FAR_FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

async function login(username) {
  const res = await app.inject({
    method: 'POST',
    url: '/chat/login',
    payload: { username, password: PASSWORD },
  });
  const body = res.json();
  return { 'X-Chat-Username': body.username, 'X-Chat-Token': body.token };
}

async function roomMessages(auth, roomId) {
  const res = await app.inject({
    method: 'GET',
    url: `/chat/messages?roomId=${encodeURIComponent(roomId)}&before=${encodeURIComponent(FAR_FUTURE)}&limit=100`,
    headers: auth,
  });
  return res.json();
}

before(async () => {
  app = buildApp();
  await app.ready();
});

after(async () => {
  if (app) await app.close();
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('aggiungere un membro a una stanza esistente crea un messaggio di sistema', async () => {
  const adminAuth = await login(ADMIN);
  const createRes = await app.inject({
    method: 'POST',
    url: '/chat/rooms',
    headers: adminAuth,
    payload: { name: 'Team Room' },
  });
  const roomId = createRes.json().room.id;

  const addRes = await app.inject({
    method: 'POST',
    url: `/chat/rooms/${roomId}/members`,
    headers: adminAuth,
    payload: { members: [BOB] },
  });
  assert.strictEqual(addRes.statusCode, 200);

  const messages = await roomMessages(adminAuth, roomId);
  const systemMsg = messages.find((m) => m.kind === 'system');
  assert.ok(systemMsg, 'deve esserci un messaggio di sistema');
  assert.strictEqual(systemMsg.text, `${BOB} joined the chat.`);
});

test('self-join su stanza pubblica crea un solo messaggio di sistema anche se richiamato due volte', async () => {
  const adminAuth = await login(ADMIN);
  const createRes = await app.inject({
    method: 'POST',
    url: '/chat/my-rooms',
    headers: adminAuth,
    payload: { name: 'Public Room', isPublic: true },
  });
  const roomId = createRes.json().room.id;

  const bobAuth = await login(BOB);
  const join1 = await app.inject({ method: 'POST', url: `/chat/public-rooms/${roomId}/join`, headers: bobAuth });
  assert.strictEqual(join1.statusCode, 200);
  const join2 = await app.inject({ method: 'POST', url: `/chat/public-rooms/${roomId}/join`, headers: bobAuth });
  assert.strictEqual(join2.statusCode, 200);

  const messages = await roomMessages(adminAuth, roomId);
  const systemMsgs = messages.filter((m) => m.kind === 'system');
  assert.strictEqual(systemMsgs.length, 1, 'nessun duplicato al secondo join');
  assert.strictEqual(systemMsgs[0].text, `${BOB} joined the chat.`);
});

test('creare una stanza con membri iniziali annuncia ogni invitato ma non il creatore', async () => {
  const adminAuth = await login(ADMIN);
  const createRes = await app.inject({
    method: 'POST',
    url: '/chat/rooms',
    headers: adminAuth,
    payload: { name: 'Fresh Room', members: [BOB, CAROL] },
  });
  const roomId = createRes.json().room.id;

  const messages = await roomMessages(adminAuth, roomId);
  const systemTexts = messages.filter((m) => m.kind === 'system').map((m) => m.text).sort();
  assert.deepStrictEqual(systemTexts, [`${BOB} joined the chat.`, `${CAROL} joined the chat.`].sort());
});
