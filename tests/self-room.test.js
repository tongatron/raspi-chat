'use strict';

// Test della stanza personale: ogni utente ha una stanza con il proprio nome,
// con se stesso come unico membro, in cui puo' mandarsi messaggi da solo.
// Copre il backfill all'avvio, la privatezza verso gli altri utenti, la
// creazione dalla console e la rimozione insieme all'utente.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const ALICE = 'Alice';
const BOB = 'Bob';
const PASSWORD = 'secret-pw-123';

const originalCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raspi-chat-self-room-'));
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(tmpRoot, 'chat-users.json'),
  JSON.stringify([
    { username: ALICE, password: PASSWORD, role: 'admin' },
    { username: BOB, password: PASSWORD, role: 'user' },
  ]),
);

process.env.CHAT_USERS_FILE = path.join(tmpRoot, 'chat-users.json');
process.env.CHAT_DB_PATH = path.join(tmpRoot, 'data', 'chat.db');
process.chdir(tmpRoot);

const { buildApp } = require(path.join(originalCwd, 'src', 'app'));

let app;
let wsBase;
const FAR_FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

async function login(username, password) {
  const res = await app.inject({
    method: 'POST',
    url: '/chat/login',
    payload: { username, password: password || PASSWORD },
  });
  const body = res.json();
  return {
    username: body.username,
    token: body.token,
    headers: { 'X-Chat-Username': body.username, 'X-Chat-Token': body.token },
  };
}

async function myRooms(auth) {
  const res = await app.inject({ method: 'GET', url: '/chat/my-rooms', headers: auth.headers });
  return res.json().rooms || [];
}

function selfRoomOf(rooms, username) {
  return rooms.find((room) => room.name === username) || null;
}

function connectAndJoin(username, token, roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsBase + '/chat/ws');
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', username, token, roomId }));
    });
    ws.once('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'history') resolve({ ws, history: msg });
      else { ws.close(); reject(new Error('join rifiutato: ' + raw)); }
    });
  });
}

function waitForMatch(ws, predicate, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('timeout in attesa di: ' + label));
    }, 3000);
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(msg);
      }
    };
    ws.on('message', onMessage);
  });
}

before(async () => {
  app = buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  wsBase = `ws://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  if (app) await app.close();
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('ogni utente gia\' esistente riceve una stanza col proprio nome, privata e con un solo membro', async () => {
  for (const username of [ALICE, BOB]) {
    const auth = await login(username);
    const room = selfRoomOf(await myRooms(auth), username);
    assert.ok(room, `${username} deve avere una stanza chiamata come lui`);
    assert.deepStrictEqual(room.members, [username], 'unico membro: se stesso');
    assert.strictEqual(room.isPublic, false, 'la stanza personale non e\' pubblica');
    assert.strictEqual(room.isOwner, true, 'la stanza personale appartiene all\'utente');
  }
});

test('la stanza personale non compare tra le stanze degli altri ne\' tra le pubbliche', async () => {
  const alice = await login(ALICE);
  const bob = await login(BOB);
  const aliceRoom = selfRoomOf(await myRooms(alice), ALICE);

  const bobRooms = await myRooms(bob);
  assert.ok(!bobRooms.some((room) => room.id === aliceRoom.id), 'Bob non vede la stanza di Alice');

  const publicRes = await app.inject({ method: 'GET', url: '/chat/public-rooms', headers: bob.headers });
  const publicRooms = publicRes.json().rooms || [];
  assert.ok(!publicRooms.some((room) => room.id === aliceRoom.id), 'non e\' una stanza pubblica');

  const readRes = await app.inject({
    method: 'GET',
    url: `/chat/messages?roomId=${encodeURIComponent(aliceRoom.id)}&before=${encodeURIComponent(FAR_FUTURE)}`,
    headers: bob.headers,
  });
  assert.strictEqual(readRes.statusCode, 403, 'Bob non puo\' leggere la stanza personale di Alice');
});

test('l\'utente puo\' mandarsi un messaggio da solo e lo ritrova nello storico', async () => {
  const alice = await login(ALICE);
  const room = selfRoomOf(await myRooms(alice), ALICE);

  const { ws } = await connectAndJoin(ALICE, alice.token, room.id);
  const cid = 'cid-self-' + Math.random().toString(36).slice(2);
  const echoPromise = waitForMatch(ws, (m) => m.type === 'message' && m.cid === cid, 'eco del messaggio');
  ws.send(JSON.stringify({ type: 'message', cid, text: 'promemoria per me' }));
  const echoed = await echoPromise;
  assert.strictEqual(echoed.username, ALICE);
  ws.close();

  const { ws: ws2, history } = await connectAndJoin(ALICE, alice.token, room.id);
  assert.ok(
    history.messages.some((m) => m.id === echoed.id && m.text === 'promemoria per me'),
    'il messaggio resta nello storico della stanza personale',
  );
  ws2.close();
});

test('un utente creato dalla console riceve subito la sua stanza personale', async () => {
  const admin = await login(ALICE);
  const createRes = await app.inject({
    method: 'POST',
    url: '/chat/admin/users',
    headers: admin.headers,
    payload: { username: 'Carol', password: PASSWORD, role: 'user' },
  });
  assert.strictEqual(createRes.statusCode, 200);

  const carol = await login('Carol');
  const room = selfRoomOf(await myRooms(carol), 'Carol');
  assert.ok(room, 'Carol deve avere la sua stanza personale');
  assert.deepStrictEqual(room.members, ['Carol']);
});

test('cancellando un utente sparisce anche la sua stanza personale', async () => {
  const admin = await login(ALICE);
  await app.inject({
    method: 'POST',
    url: '/chat/admin/users',
    headers: admin.headers,
    payload: { username: 'Dave', password: PASSWORD, role: 'user' },
  });
  const dave = await login('Dave');
  const room = selfRoomOf(await myRooms(dave), 'Dave');
  assert.ok(room);

  const delRes = await app.inject({
    method: 'DELETE',
    url: '/chat/admin/users/Dave',
    headers: admin.headers,
  });
  assert.strictEqual(delRes.statusCode, 200);

  const readRes = await app.inject({
    method: 'GET',
    url: `/chat/messages?roomId=${encodeURIComponent(room.id)}&before=${encodeURIComponent(FAR_FUTURE)}`,
    headers: admin.headers,
  });
  assert.strictEqual(readRes.statusCode, 404, 'la stanza personale non esiste piu\'');
});
