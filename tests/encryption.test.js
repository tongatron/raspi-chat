'use strict';

// Test della cifratura at-rest di chat.db (spec 004-encrypted-chat-db).
// Verifica il comportamento di openChatDatabase esportata da src/routes/chat.js:
//   - con chiave: i dati su disco sono cifrati (non leggibili senza chiave)
//   - riapertura con chiave giusta -> dati integri
//   - apertura senza chiave / con chiave errata -> errore
//   - senza chiave: DB in chiaro (fallback baseline)
// File separato = processo separato: l'env qui non interferisce con gli altri test.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raspi-chat-enc-'));
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });

// Puntiamo il DB globale del modulo a una tempdir prima del require, così il solo
// import di chat.js non tocca i dati di produzione.
process.env.CHAT_DB_PATH = path.join(tmpRoot, 'data', 'module.db');
process.env.CHAT_USERS_FILE = path.join(tmpRoot, 'no-users.json');
process.chdir(tmpRoot);

const { openChatDatabase } = require(path.join(originalCwd, 'src', 'routes', 'chat'));

const KEY = 'a'.repeat(64); // finta chiave hex, come `openssl rand -hex 32`
const SECRET = 'messaggio-super-segreto-42';

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('openChatDatabase e\' esportata', () => {
  assert.strictEqual(typeof openChatDatabase, 'function');
});

test('con chiave: scrittura, riapertura con stessa chiave, dati integri', () => {
  const dbPath = path.join(tmpRoot, 'data', 'enc.db');
  const w = openChatDatabase(dbPath, KEY);
  w.exec('CREATE TABLE messages (id TEXT, text TEXT)');
  w.prepare('INSERT INTO messages (id, text) VALUES (?, ?)').run('1', SECRET);
  w.close();

  const r = openChatDatabase(dbPath, KEY);
  const row = r.prepare('SELECT text FROM messages WHERE id = ?').get('1');
  r.close();
  assert.strictEqual(row.text, SECRET);
});

test('il file su disco e\' cifrato: il testo in chiaro non compare (SC-001)', () => {
  const dbPath = path.join(tmpRoot, 'data', 'enc.db');
  const bytes = fs.readFileSync(dbPath);
  assert.strictEqual(bytes.includes(Buffer.from(SECRET)), false, 'il testo del messaggio non deve comparire in chiaro');
  // Un DB SQLite in chiaro inizia con l'header "SQLite format 3\0"; quello cifrato no.
  assert.strictEqual(bytes.slice(0, 16).toString('latin1').startsWith('SQLite format 3'), false);
});

test('apertura con chiave errata: errore', () => {
  const dbPath = path.join(tmpRoot, 'data', 'enc.db');
  assert.throws(() => openChatDatabase(dbPath, 'b'.repeat(64)));
});

test('apertura senza chiave di un DB cifrato: la lettura fallisce', () => {
  const dbPath = path.join(tmpRoot, 'data', 'enc.db');
  const db = openChatDatabase(dbPath, ''); // nessuna chiave: apre ma non decifra
  assert.throws(() => db.prepare('SELECT count(*) FROM messages').get());
  db.close();
});

test('senza chiave: DB in chiaro leggibile come baseline (FR-003)', () => {
  const dbPath = path.join(tmpRoot, 'data', 'plain.db');
  const w = openChatDatabase(dbPath, '');
  w.exec('CREATE TABLE t (v TEXT)');
  w.prepare('INSERT INTO t (v) VALUES (?)').run('ciao');
  w.close();

  const bytes = fs.readFileSync(dbPath);
  assert.ok(bytes.slice(0, 16).toString('latin1').startsWith('SQLite format 3'), 'header SQLite in chiaro atteso');

  const r = openChatDatabase(dbPath, '');
  assert.strictEqual(r.prepare('SELECT v FROM t').get().v, 'ciao');
  r.close();
});
