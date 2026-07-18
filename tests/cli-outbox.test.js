'use strict';

// Test dell'outbox della CLI (spec 006): la coda in uscita accoda i messaggi
// quando il socket non è pronto e li rispedisce al join, rimuovendoli solo alla
// conferma del server (message/ack con lo stesso cid). Test unitari puri: niente
// rete, iniettiamo un fake socket e invochiamo i metodi di ChatConnection.

const { test } = require('node:test');
const assert = require('node:assert');
const { ChatConnection } = require('../cli/lib/connection');

// Fake WebSocket: readyState=1 (OPEN, come ws.WebSocket.OPEN) e registra gli invii.
function fakeSocket() {
  const sent = [];
  return {
    readyState: 1,
    sent,
    send(data) { sent.push(JSON.parse(data)); },
    close() {},
  };
}

function newConn() {
  return new ChatConnection({
    wsUrl: 'ws://test/chat/ws',
    token: 't',
    username: 'me',
    roomId: 'room1',
  });
}

function history(extra = {}) {
  return JSON.stringify({ type: 'history', messages: [], roomName: 'Room', ...extra });
}

test('input vuoto non entra in coda e non è inviato (FR-006)', () => {
  const conn = newConn();
  const res = conn.sendMessage('   ');
  assert.deepStrictEqual(res, { sent: false, reason: 'empty' });
  assert.strictEqual(conn.outbox.length, 0);
});

test('messaggio inviato mentre disconnesso viene accodato, non scartato (FR-001, US1.1)', () => {
  const conn = newConn(); // ws=null, non joined
  const res = conn.sendMessage('ciao');
  assert.strictEqual(res.sent, true);
  assert.strictEqual(res.queued, true);
  assert.strictEqual(conn.outbox.length, 1);
  assert.strictEqual(conn.outbox[0].text, 'ciao');
  assert.ok(conn.outbox[0].cid, 'il payload deve avere un cid');
});

test('al join (history) la coda viene svuotata inviando i payload, in ordine (FR-003, US1.2)', () => {
  const conn = newConn();
  conn.sendMessage('uno');
  conn.sendMessage('due');
  // Arriva la connessione + join
  conn.ws = fakeSocket();
  conn._handleMessage(history());
  assert.strictEqual(conn.joined, true);
  assert.deepStrictEqual(conn.ws.sent.map((m) => m.text), ['uno', 'due']);
  // Restano in coda finché il server non conferma
  assert.strictEqual(conn.outbox.length, 2);
});

test('conferma via message con cid combaciante rimuove dalla coda (FR-004, US1.3)', () => {
  const conn = newConn();
  conn.ws = fakeSocket();
  conn._handleMessage(history()); // joined
  conn.sendMessage('hi'); // inviato subito
  const cid = conn.outbox[0].cid;
  assert.strictEqual(conn.outbox.length, 1);
  conn._handleMessage(JSON.stringify({ type: 'message', id: 'srv1', cid, username: 'me', text: 'hi' }));
  assert.strictEqual(conn.outbox.length, 0, 'l’eco con cid deve togliere il messaggio dalla coda');
});

test('conferma via ack (reinvio dedotto dal server) rimuove dalla coda (FR-004, US2.1)', () => {
  const conn = newConn();
  conn.ws = fakeSocket();
  conn._handleMessage(history());
  conn.sendMessage('hey');
  const cid = conn.outbox[0].cid;
  conn._handleMessage(JSON.stringify({ type: 'ack', cid }));
  assert.strictEqual(conn.outbox.length, 0);
});

test('nessun doppione a schermo: message con cid è emesso una volta; id già visto non riemesso (FR-008, US2.2)', () => {
  const conn = newConn();
  conn.ws = fakeSocket();
  conn._handleMessage(history());
  conn.sendMessage('yo');
  const cid = conn.outbox[0].cid;
  let emitted = 0;
  conn.on('message', () => { emitted += 1; });
  const echo = JSON.stringify({ type: 'message', id: 'srv-yo', cid, username: 'me', text: 'yo' });
  conn._handleMessage(echo); // prima eco: emessa + tolta dalla coda
  conn._handleMessage(echo); // stesso id: già visto, non riemessa
  assert.strictEqual(emitted, 1);
  assert.strictEqual(conn.outbox.length, 0);
});

test('quando connesso e joined il messaggio è trasmesso subito (queued:false) (FR-002)', () => {
  const conn = newConn();
  conn.ws = fakeSocket();
  conn._handleMessage(history());
  const res = conn.sendMessage('subito');
  assert.strictEqual(res.queued, false);
  assert.deepStrictEqual(conn.ws.sent.map((m) => m.text), ['subito']);
  assert.strictEqual(conn.outbox.length, 1); // resta finché non confermato
});

test('testo > 2000 caratteri troncato una sola volta, all’accodamento (FR-006/FR-007)', () => {
  const conn = newConn();
  const res = conn.sendMessage('x'.repeat(2500));
  assert.strictEqual(res.truncated, true);
  assert.strictEqual(conn.outbox[0].text.length, 2000);
});

test('socket "zombie": invio non perso, resta in coda e riparte al reflush (SC-004, DK-004)', () => {
  const conn = newConn();
  // Socket morto: readyState OPEN ma send lancia (consegna impossibile)
  conn.joined = true;
  conn.ws = { readyState: 1, send() { throw new Error('dead'); }, close() {} };
  const res = conn.sendMessage('perso?');
  assert.strictEqual(res.sent, true);
  assert.strictEqual(conn.outbox.length, 1, 'resta in coda: nessuna perdita silenziosa');
  // Riconnessione con socket sano + join → viene ritrasmesso
  conn.ws = fakeSocket();
  conn._handleMessage(history());
  assert.deepStrictEqual(conn.ws.sent.map((m) => m.text), ['perso?']);
});
