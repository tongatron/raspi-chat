'use strict';

// Test dei messaggi preferiti (spec 010): message_favorites e' privata per utente
// (non visibile agli altri membri della stanza), sopravvive al reload (storico via
// GET /chat/favorites), e viene ripulita quando il messaggio viene cancellato.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const ALICE = 'Alice';
const BOB = 'Bob';
const PASSWORD = 'secret-pw-123';
const DEFAULT_ROOM_ID = 'cabras-giovanni';

const originalCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raspi-chat-favorites-'));
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

async function login(username) {
  const res = await app.inject({
    method: 'POST',
    url: '/chat/login',
    payload: { username, password: PASSWORD },
  });
  const body = res.json();
  return { username: body.username, token: body.token, headers: { 'X-Chat-Username': body.username, 'X-Chat-Token': body.token } };
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
      if (msg.type === 'history') resolve(ws);
      else reject(new Error('join fallito: ' + raw));
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

function sendMessageAndWaitEcho(ws, text) {
  const cid = 'cid-' + Math.random().toString(36).slice(2);
  const promise = waitForMatch(ws, (m) => m.type === 'message' && m.cid === cid, 'eco del messaggio');
  ws.send(JSON.stringify({ type: 'message', cid, text }));
  return promise;
}

before(async () => {
  app = buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  wsBase = `ws://127.0.0.1:${address.port}`;
});

after(async () => {
  if (app) await app.close();
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('marcare un messaggio preferito lo fa comparire in GET /chat/favorites (FR-006/007/009)', async () => {
  const alice = await login(ALICE);
  const ws = await connectAndJoin(ALICE, alice.token, DEFAULT_ROOM_ID);
  const echoed = await sendMessageAndWaitEcho(ws, 'ricordami questo');

  const ackPromise = waitForMatch(ws, (m) => m.type === 'favorite' && m.id === echoed.id, 'ack favorite');
  ws.send(JSON.stringify({ type: 'favorite', id: echoed.id }));
  const ack = await ackPromise;
  assert.strictEqual(ack.favorite, true);

  const listRes = await app.inject({
    method: 'GET',
    url: `/chat/favorites?roomId=${DEFAULT_ROOM_ID}`,
    headers: alice.headers,
  });
  assert.strictEqual(listRes.statusCode, 200);
  const favorites = listRes.json().messages;
  assert.ok(favorites.some((m) => m.id === echoed.id), 'il messaggio deve comparire tra i preferiti');

  ws.close();
});

test('il preferito e\' privato: non compare tra i preferiti di un altro utente (FR-008/SC-004)', async () => {
  const alice = await login(ALICE);
  const bob = await login(BOB);
  const aliceWs = await connectAndJoin(ALICE, alice.token, DEFAULT_ROOM_ID);
  const echoed = await sendMessageAndWaitEcho(aliceWs, 'solo per me');

  const ackPromise = waitForMatch(aliceWs, (m) => m.type === 'favorite' && m.id === echoed.id, 'ack favorite');
  aliceWs.send(JSON.stringify({ type: 'favorite', id: echoed.id }));
  await ackPromise;

  const bobListRes = await app.inject({
    method: 'GET',
    url: `/chat/favorites?roomId=${DEFAULT_ROOM_ID}`,
    headers: bob.headers,
  });
  assert.ok(!bobListRes.json().messages.some((m) => m.id === echoed.id), 'Bob non deve vedere il preferito di Alice');

  aliceWs.close();
});

test('smarcare un preferito lo rimuove da GET /chat/favorites (US3.1)', async () => {
  const alice = await login(ALICE);
  const ws = await connectAndJoin(ALICE, alice.token, DEFAULT_ROOM_ID);
  const echoed = await sendMessageAndWaitEcho(ws, 'poi lo tolgo');

  const addAck = waitForMatch(ws, (m) => m.type === 'favorite' && m.id === echoed.id, 'ack favorite');
  ws.send(JSON.stringify({ type: 'favorite', id: echoed.id }));
  await addAck;

  const removeAck = waitForMatch(ws, (m) => m.type === 'favorite' && m.id === echoed.id, 'ack unfavorite');
  ws.send(JSON.stringify({ type: 'unfavorite', id: echoed.id }));
  const ack = await removeAck;
  assert.strictEqual(ack.favorite, false);

  const listRes = await app.inject({
    method: 'GET',
    url: `/chat/favorites?roomId=${DEFAULT_ROOM_ID}`,
    headers: alice.headers,
  });
  assert.ok(!listRes.json().messages.some((m) => m.id === echoed.id));

  ws.close();
});

test('cancellare un messaggio preferito lo rimuove anche dai preferiti (FR-010/SC-005)', async () => {
  const alice = await login(ALICE);
  const ws = await connectAndJoin(ALICE, alice.token, DEFAULT_ROOM_ID);
  const echoed = await sendMessageAndWaitEcho(ws, 'messaggio da cancellare');

  const addAck = waitForMatch(ws, (m) => m.type === 'favorite' && m.id === echoed.id, 'ack favorite');
  ws.send(JSON.stringify({ type: 'favorite', id: echoed.id }));
  await addAck;

  const deletedAck = waitForMatch(ws, (m) => m.type === 'deleted' && m.id === echoed.id, 'ack deleted');
  ws.send(JSON.stringify({ type: 'delete', id: echoed.id }));
  await deletedAck;

  const listRes = await app.inject({
    method: 'GET',
    url: `/chat/favorites?roomId=${DEFAULT_ROOM_ID}`,
    headers: alice.headers,
  });
  assert.ok(!listRes.json().messages.some((m) => m.id === echoed.id), 'il messaggio cancellato non deve restare tra i preferiti');

  ws.close();
});

test('lo storico (join) riporta favorite:true per i messaggi gia\' marcati (FR-007)', async () => {
  const alice = await login(ALICE);
  const ws1 = await connectAndJoin(ALICE, alice.token, DEFAULT_ROOM_ID);
  const echoed = await sendMessageAndWaitEcho(ws1, 'persistente tra sessioni');

  const addAck = waitForMatch(ws1, (m) => m.type === 'favorite' && m.id === echoed.id, 'ack favorite');
  ws1.send(JSON.stringify({ type: 'favorite', id: echoed.id }));
  await addAck;
  ws1.close();

  const { msg: history, ws: ws2 } = await new Promise((resolve, reject) => {
    const ws2 = new WebSocket(wsBase + '/chat/ws');
    ws2.on('error', reject);
    ws2.on('open', () => ws2.send(JSON.stringify({ type: 'join', username: ALICE, token: alice.token, roomId: DEFAULT_ROOM_ID })));
    ws2.once('message', (raw) => resolve({ msg: JSON.parse(raw.toString()), ws: ws2 }));
  });
  const found = history.messages.find((m) => m.id === echoed.id);
  assert.ok(found, 'il messaggio deve essere nello storico');
  assert.strictEqual(found.favorite, true, 'lo storico deve riportare favorite:true dopo il rejoin');
  ws2.close();
});
