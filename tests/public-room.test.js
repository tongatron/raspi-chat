'use strict';

// Test della modalita' "public room" esplicita (spec 009). Prima di questa feature
// le room erano sempre a membership chiusa: solo il creatore/admin poteva aggiungere
// membri. Con isPublic=true chiunque sia autenticato puo' scoprirla via
// GET /chat/public-rooms e unirsi da solo via POST /chat/public-rooms/:id/join.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OWNER = 'Owner';
const JOINER = 'Joiner';
const PASSWORD = 'secret-pw-123';

const originalCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raspi-chat-public-room-'));
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(tmpRoot, 'chat-users.json'),
  JSON.stringify([
    { username: OWNER, password: PASSWORD, role: 'admin' },
    { username: JOINER, password: PASSWORD, role: 'user' },
  ]),
);

process.env.CHAT_USERS_FILE = path.join(tmpRoot, 'chat-users.json');
process.env.CHAT_DB_PATH = path.join(tmpRoot, 'data', 'chat.db');
process.chdir(tmpRoot);

const { buildApp } = require(path.join(originalCwd, 'src', 'app'));

let app;

async function login(username) {
  const res = await app.inject({
    method: 'POST',
    url: '/chat/login',
    payload: { username, password: PASSWORD },
  });
  const body = res.json();
  return { 'X-Chat-Username': body.username, 'X-Chat-Token': body.token };
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

test('una room pubblica compare in /chat/public-rooms anche per chi non ne e ancora membro', async () => {
  const ownerAuth = await login(OWNER);

  const createRes = await app.inject({
    method: 'POST',
    url: '/chat/my-rooms',
    headers: ownerAuth,
    payload: { name: 'Community', isPublic: true },
  });
  assert.strictEqual(createRes.statusCode, 200);
  const created = createRes.json();
  assert.strictEqual(created.room.isPublic, true);
  const roomId = created.room.id;

  const joinerAuth = await login(JOINER);
  const listRes = await app.inject({ method: 'GET', url: '/chat/public-rooms', headers: joinerAuth });
  assert.strictEqual(listRes.statusCode, 200);
  const publicRooms = listRes.json().rooms;
  const found = publicRooms.find((r) => r.id === roomId);
  assert.ok(found, 'la room pubblica deve comparire nella lista');
  assert.strictEqual(found.joined, false, 'il joiner non ne e ancora membro');
});

test('POST /chat/public-rooms/:roomId/join aggiunge il chiamante come membro senza invito', async () => {
  const ownerAuth = await login(OWNER);
  const createRes = await app.inject({
    method: 'POST',
    url: '/chat/my-rooms',
    headers: ownerAuth,
    payload: { name: 'Open Room', isPublic: true },
  });
  const roomId = createRes.json().room.id;

  const joinerAuth = await login(JOINER);
  const joinRes = await app.inject({
    method: 'POST',
    url: `/chat/public-rooms/${roomId}/join`,
    headers: joinerAuth,
  });
  assert.strictEqual(joinRes.statusCode, 200);
  const joinBody = joinRes.json();
  assert.ok(joinBody.ok);
  assert.ok(joinBody.room.members.includes(JOINER));

  const myRoomsRes = await app.inject({ method: 'GET', url: '/chat/my-rooms', headers: joinerAuth });
  const myRooms = myRoomsRes.json().rooms;
  assert.ok(myRooms.some((r) => r.id === roomId), 'la room deve comparire fra le room del joiner dopo il join');
});

test('una room privata non compare in /chat/public-rooms e il join viene rifiutato', async () => {
  const ownerAuth = await login(OWNER);
  const createRes = await app.inject({
    method: 'POST',
    url: '/chat/my-rooms',
    headers: ownerAuth,
    payload: { name: 'Private Room' },
  });
  const roomId = createRes.json().room.id;
  assert.strictEqual(createRes.json().room.isPublic, false);

  const joinerAuth = await login(JOINER);
  const listRes = await app.inject({ method: 'GET', url: '/chat/public-rooms', headers: joinerAuth });
  assert.ok(!listRes.json().rooms.some((r) => r.id === roomId), 'la room privata non deve essere elencata');

  const joinRes = await app.inject({
    method: 'POST',
    url: `/chat/public-rooms/${roomId}/join`,
    headers: joinerAuth,
  });
  assert.strictEqual(joinRes.statusCode, 404);
});
