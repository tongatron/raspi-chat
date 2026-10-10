'use strict';

// Test delle notifiche raggruppate: un dispositivo che ha attivato l'opzione
// riceve una sola push per mittente e stanza, finche' l'utente non guarda di
// nuovo quella stanza (o ci scrive). Gli altri dispositivi le ricevono tutte.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const ALICE = 'Alice';
const BOB = 'Bob';
const PASSWORD = 'secret-pw-123';
const GROUPED_ENDPOINT = 'https://push.example/grouped';
const PLAIN_ENDPOINT = 'https://push.example/plain';

const originalCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raspi-chat-push-grouping-'));
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

// Nessuna push reale: si registra solo a quale endpoint sarebbe partita.
const webpush = require(path.join(originalCwd, 'node_modules', 'web-push'));
const sent = [];
webpush.sendNotification = async (sub) => { sent.push(sub.endpoint); };

const { buildApp } = require(path.join(originalCwd, 'src', 'app'));

let app;
let wsBase;
let roomId;
let aliceWs;
let bobWs;

async function login(username) {
  const res = await app.inject({ method: 'POST', url: '/chat/login', payload: { username, password: PASSWORD } });
  const body = res.json();
  return {
    username: body.username,
    token: body.token,
    headers: { 'X-Chat-Username': body.username, 'X-Chat-Token': body.token },
  };
}

function connectAndJoin(auth, room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsBase + '/chat/ws');
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', username: auth.username, token: auth.token, roomId: room }));
    });
    ws.once('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'history') resolve(ws);
      else { ws.close(); reject(new Error('join rifiutato: ' + raw)); }
    });
  });
}

// Manda un messaggio e aspetta l'ack: a quel punto il server ha gia' deciso
// (in modo sincrono) a chi notificarlo.
function sendAndWait(ws, text) {
  const cid = 'cid-' + Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout in attesa del messaggio: ' + text)), 3000);
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'message' || msg.cid !== cid) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      setTimeout(resolve, 50);
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ type: 'message', text, cid }));
  });
}

function sentTo(endpoint) {
  return sent.filter((e) => e === endpoint).length;
}

before(async () => {
  app = buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  wsBase = `ws://127.0.0.1:${app.server.address().port}`;

  const alice = await login(ALICE);
  const bob = await login(BOB);
  const rooms = (await app.inject({ method: 'GET', url: '/chat/my-rooms', headers: bob.headers })).json().rooms;
  roomId = rooms.find((room) => room.members.includes(ALICE) && room.members.includes(BOB)).id;

  for (const [endpoint, grouped] of [[GROUPED_ENDPOINT, true], [PLAIN_ENDPOINT, false]]) {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/push-subscribe',
      headers: bob.headers,
      payload: { subscription: { endpoint, keys: { p256dh: 'x', auth: 'y' } }, grouped },
    });
    assert.strictEqual(res.statusCode, 200);
  }

  aliceWs = await connectAndJoin(alice, roomId);
  bobWs = await connectAndJoin(bob, roomId);
});

after(async () => {
  if (aliceWs) aliceWs.close();
  if (bobWs) bobWs.close();
  if (app) await app.close();
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('il dispositivo raggruppato riceve una sola notifica, l\'altro le riceve tutte', async () => {
  await sendAndWait(aliceWs, 'uno');
  await sendAndWait(aliceWs, 'due');
  await sendAndWait(aliceWs, 'tre');
  assert.strictEqual(sentTo(GROUPED_ENDPOINT), 1, 'una sola push al dispositivo raggruppato');
  assert.strictEqual(sentTo(PLAIN_ENDPOINT), 3, 'tutte le push al dispositivo normale');
});

test('il solo "read" non riattiva le notifiche: serve che la stanza sia davvero a schermo', async () => {
  bobWs.send(JSON.stringify({ type: 'read', ids: [] }));
  await sendAndWait(aliceWs, 'quattro');
  assert.strictEqual(sentTo(GROUPED_ENDPOINT), 1);
});

test('dopo "seen" il messaggio successivo notifica di nuovo, una volta sola', async () => {
  bobWs.send(JSON.stringify({ type: 'seen' }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await sendAndWait(aliceWs, 'cinque');
  await sendAndWait(aliceWs, 'sei');
  assert.strictEqual(sentTo(GROUPED_ENDPOINT), 2);
});

test('anche rispondere nella stanza riattiva le notifiche', async () => {
  await sendAndWait(bobWs, 'risposta');
  await sendAndWait(aliceWs, 'sette');
  assert.strictEqual(sentTo(GROUPED_ENDPOINT), 3);
});
