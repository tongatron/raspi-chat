'use strict';

// Test della validazione del restore (spec 005-restore-encrypted-backup).
// Verifica validateRestorePayload esportata da src/routes/chat.js:
//   - backup cifrato + chiave giusta -> valido
//   - backup cifrato + chiave errata / assente -> rifiutato
//   - backup in chiaro + nessuna chiave -> valido (baseline)
//   - DB valido ma senza schema chat (no tabella `messages`) -> rifiutato
//   - file troppo piccolo / non-SQLite -> rifiutato
// Regressione coperta: un DB cifrato non inizia con "SQLite format 3", quindi il
// vecchio check sui magic byte rifiutava i backup prodotti da /chat/admin/backup.
// File separato = processo separato: l'env qui non interferisce con gli altri test.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raspi-chat-restore-'));
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });

// Puntiamo il DB globale del modulo a una tempdir prima del require, così il solo
// import di chat.js non tocca i dati di produzione.
process.env.CHAT_DB_PATH = path.join(tmpRoot, 'data', 'module.db');
process.env.CHAT_USERS_FILE = path.join(tmpRoot, 'no-users.json');
process.chdir(tmpRoot);

const { openChatDatabase, validateRestorePayload } = require(path.join(originalCwd, 'src', 'routes', 'chat'));

const KEY = 'a'.repeat(64);       // finta chiave hex, come `openssl rand -hex 32`
const WRONG_KEY = 'b'.repeat(64);

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Costruisce un file di backup (i byte che /chat/admin/backup restituirebbe): un DB
// con lo schema chat minimo (tabella `messages`), eventualmente cifrato con `key`.
function makeBackup(name, key, { withMessages = true } = {}) {
  const dbPath = path.join(tmpRoot, 'data', name);
  const db = openChatDatabase(dbPath, key);
  if (withMessages) {
    db.exec('CREATE TABLE messages (id TEXT, text TEXT)');
    db.prepare('INSERT INTO messages (id, text) VALUES (?, ?)').run('1', 'ciao');
  } else {
    db.exec('CREATE TABLE items (id TEXT, name TEXT)');
    db.prepare('INSERT INTO items (id, name) VALUES (?, ?)').run('1', 'x');
  }
  db.close();
  const bytes = fs.readFileSync(dbPath);
  fs.rmSync(dbPath, { force: true });
  return bytes;
}

test('validateRestorePayload e\' esportata', () => {
  assert.strictEqual(typeof validateRestorePayload, 'function');
});

test('backup cifrato + chiave giusta: valido (regressione spec 004->005)', () => {
  const bytes = makeBackup('enc.db', KEY);
  // Pre-condizione: il backup cifrato NON ha l'header SQLite in chiaro.
  assert.strictEqual(bytes.slice(0, 16).toString('latin1').startsWith('SQLite format 3'), false);
  assert.deepStrictEqual(validateRestorePayload(bytes, KEY), { ok: true });
});

test('backup cifrato + chiave errata: rifiutato', () => {
  const bytes = makeBackup('enc.db', KEY);
  const res = validateRestorePayload(bytes, WRONG_KEY);
  assert.strictEqual(res.ok, false);
});

test('backup cifrato validato senza chiave: rifiutato', () => {
  const bytes = makeBackup('enc.db', KEY);
  const res = validateRestorePayload(bytes, '');
  assert.strictEqual(res.ok, false);
});

test('backup in chiaro + nessuna chiave: valido (baseline)', () => {
  const bytes = makeBackup('plain.db', '');
  assert.ok(bytes.slice(0, 16).toString('latin1').startsWith('SQLite format 3'));
  assert.deepStrictEqual(validateRestorePayload(bytes, ''), { ok: true });
});

test('DB valido ma senza tabella messages: rifiutato come non-chat', () => {
  const bytes = makeBackup('other.db', '', { withMessages: false });
  const res = validateRestorePayload(bytes, '');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'Not a valid chat database');
});

test('file troppo piccolo: rifiutato', () => {
  const res = validateRestorePayload(Buffer.alloc(100), '');
  assert.deepStrictEqual(res, { ok: false, error: 'Invalid file' });
});

test('buffer non-SQLite: rifiutato', () => {
  const res = validateRestorePayload(Buffer.alloc(4096, 0x41), '');
  assert.strictEqual(res.ok, false);
});
