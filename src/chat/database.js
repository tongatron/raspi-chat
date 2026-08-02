'use strict';

// chat.db: connection, schema, migrations and every prepared statement.
//
// The database is opened at import time and shared by the whole chat feature:
// SQLite in WAL mode handles a single process well, and a module-level handle
// keeps the prepared statements hot for the lifetime of the server.

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const Database = require('better-sqlite3-multiple-ciphers');
const { normalizeRole, normalizeRoomId, normalizeUsername } = require('../lib/normalize');

// Opens chat.db, applying at-rest encryption when `key` is set. Without a key
// the database stays in plaintext, which is the default. The migration script
// (ops/encrypt-db.js) and the test suite open databases through this same
// function, so they cannot drift from what the server does.
function openChatDatabase(dbPath, key, options) {
  const database = new Database(dbPath, options);
  const rawKey = String(key || '');
  if (rawKey) {
    // The value comes from CHAT_DB_KEY (e.g. `openssl rand -hex 32`). PRAGMA
    // takes a string literal, so single quotes are doubled to keep it intact.
    database.pragma(`key='${rawKey.replace(/'/g, "''")}'`);
    // Force a read straight away: a wrong or missing key on an encrypted
    // database fails loudly here instead of somewhere opaque later on.
    database.exec('SELECT count(*) FROM sqlite_schema');
  }
  return database;
}

// Validates a backup file before a restore. Checking for the "SQLite format 3"
// magic bytes is not enough: an encrypted database has no plaintext header, so
// that check rejected every encrypted backup and broke the backup/restore cycle
// whenever CHAT_DB_KEY was in use.
//
// Instead the file is really opened with the encryption settings in force right
// now — it must be readable (plaintext with no key, or encrypted with *that*
// key) and carry the chat schema (a `messages` table). Returns { ok, error }.
function validateRestorePayload(data, key) {
  if (!data || data.length < 1024) return { ok: false, error: 'Invalid file' };
  const tmpPath = path.join(os.tmpdir(), `raspi-chat-restore-${crypto.randomBytes(6).toString('hex')}.db`);
  try {
    fs.writeFileSync(tmpPath, data);
    const probe = openChatDatabase(tmpPath, key);
    try {
      const table = probe
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='messages'")
        .get();
      if (!table) return { ok: false, error: 'Not a valid chat database' };
      return { ok: true };
    } finally {
      probe.close();
    }
  } catch (err) {
    // Missing or wrong key on an encrypted backup, or a corrupt/non-SQLite file.
    return { ok: false, error: 'Not a valid database (wrong key or corrupt file)' };
  } finally {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(tmpPath + suffix, { force: true });
  }
}

const DB_PATH = process.env.CHAT_DB_PATH || path.join(process.cwd(), 'data', 'chat.db');
const CHAT_USERS_FILE = process.env.CHAT_USERS_FILE || path.join(process.cwd(), 'config', 'chat-users.json');
const DEFAULT_ADMIN_USERNAME = normalizeUsername(process.env.DEFAULT_ADMIN_USERNAME || 'admin');
// The id of the room every user joins on first run. It is a stable primary key
// referenced by every message row, so it must never change on an existing
// install — the fallback below is the historical value of the first deployment
// and is kept for exactly that reason. New installs should set DEFAULT_ROOM_ID
// in .env before the first start.
//
// normalizeRoomId is not cosmetic here: this value is interpolated into the
// column DEFAULT below, where a bound parameter is not allowed.
const DEFAULT_ROOM_ID = normalizeRoomId(process.env.DEFAULT_ROOM_ID) || 'cabras-giovanni';
const DEFAULT_ROOM_NAME = String(process.env.DEFAULT_ROOM_NAME || 'General').trim() || 'General';

// The data directory is created here rather than relying on another module
// having been imported first: chat.db is opened at import time, and SQLite will
// not create the parent directory for us.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = openChatDatabase(DB_PATH, process.env.CHAT_DB_KEY);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT NOT NULL,
    username TEXT NOT NULL,
    invited_by TEXT,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (room_id, username)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL DEFAULT '${DEFAULT_ROOM_ID}',
    username TEXT NOT NULL,
    text TEXT,
    image_url TEXT,
    timestamp TEXT NOT NULL,
    reply_to_id TEXT
  );
  CREATE TABLE IF NOT EXISTS message_reads (
    message_id TEXT NOT NULL,
    username TEXT NOT NULL,
    PRIMARY KEY (message_id, username)
  );
  CREATE TABLE IF NOT EXISTS message_favorites (
    message_id TEXT NOT NULL,
    username TEXT NOT NULL,
    PRIMARY KEY (message_id, username)
  );
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user'
  );
  CREATE TABLE IF NOT EXISTS invites (
    token TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    used_at TEXT,
    used_by TEXT
  );
`);
// Migration: add reply_to_id if missing (existing installs)
try { db.exec('ALTER TABLE messages ADD COLUMN reply_to_id TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE rooms ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0'); } catch(e) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN room_id TEXT NOT NULL DEFAULT '${DEFAULT_ROOM_ID}'`); } catch(e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"); } catch(e) {}
try { db.exec("ALTER TABLE invites ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"); } catch(e) {}
try { db.exec("ALTER TABLE invites ADD COLUMN created_at TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE invites ADD COLUMN used_at TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE invites ADD COLUMN used_by TEXT"); } catch(e) {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    username TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    subscription TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (username, endpoint)
  )
`); } catch(e) {}
// Migrate old single-subscription table (username PK) to multi-device table
try {
  const cols = db.prepare("PRAGMA table_info(push_subscriptions)").all().map(r => r.name);
  if (!cols.includes('endpoint')) {
    db.exec(`
      ALTER TABLE push_subscriptions RENAME TO push_subscriptions_old;
      CREATE TABLE push_subscriptions (
        username TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        subscription TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (username, endpoint)
      );
      INSERT INTO push_subscriptions (username, endpoint, subscription, updated_at)
        SELECT username, json_extract(subscription, '$.endpoint'), subscription, updated_at
        FROM push_subscriptions_old
        WHERE json_extract(subscription, '$.endpoint') IS NOT NULL;
      DROP TABLE push_subscriptions_old;
    `);
    console.log('[Push] Migrated push_subscriptions to multi-device schema');
  }
} catch(e) { console.error('[Push] Migration error:', e.message); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function loadConfiguredUsers() {
  if (!fs.existsSync(CHAT_USERS_FILE)) return [];

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(CHAT_USERS_FILE, 'utf8'));
  } catch (err) {
    throw new Error(`[Auth] Invalid JSON in ${CHAT_USERS_FILE}: ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`[Auth] ${CHAT_USERS_FILE} must contain an array of { username, password } objects`);
  }

  const users = [];
  const seen = new Set();
  for (const entry of parsed) {
    const username = normalizeUsername(entry?.username);
    const password = String(entry?.password || '');
    const role = normalizeRole(entry?.role || (username === DEFAULT_ADMIN_USERNAME ? 'admin' : 'user'));
    if (!username || !password) {
      throw new Error(`[Auth] Each user in ${CHAT_USERS_FILE} must include non-empty username and password`);
    }
    const key = username.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`[Auth] Duplicate username "${username}" in ${CHAT_USERS_FILE}`);
    }
    seen.add(key);
    users.push({ username, password, role });
  }

  return users;
}

const HISTORY_SQL = `
  SELECT m.id, m.room_id AS roomId, m.username, m.text, m.image_url AS imageUrl, m.timestamp, m.reply_to_id AS replyToId, m.kind,
         rm.username AS replyUsername, rm.text AS replyText, rm.image_url AS replyImageUrl,
         GROUP_CONCAT(r.username) AS readBy
  FROM messages m
  LEFT JOIN message_reads r ON r.message_id = m.id
  LEFT JOIN messages rm ON rm.id = m.reply_to_id
  WHERE m.room_id = ?
`;

const stmts = {
  insertMessage: db.prepare('INSERT INTO messages (id, room_id, username, text, image_url, timestamp, reply_to_id, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  getHistory:    db.prepare(HISTORY_SQL + ' GROUP BY m.id ORDER BY m.timestamp DESC LIMIT 100'),
  getPage:       db.prepare(HISTORY_SQL + ' AND m.timestamp < ? GROUP BY m.id ORDER BY m.timestamp DESC LIMIT ?'),
  insertRead:    db.prepare('INSERT OR IGNORE INTO message_reads (message_id, username) VALUES (?, ?)'),
  deleteMessage: db.prepare('DELETE FROM messages WHERE id = ? AND room_id = ? AND username = ?'),
  deleteReads:   db.prepare('DELETE FROM message_reads WHERE message_id = ?'),
  insertFavorite:    db.prepare('INSERT OR IGNORE INTO message_favorites (message_id, username) VALUES (?, ?)'),
  deleteFavorite:    db.prepare('DELETE FROM message_favorites WHERE message_id = ? AND username = ?'),
  deleteFavoritesForMessage: db.prepare('DELETE FROM message_favorites WHERE message_id = ?'),
  listFavoriteIdsForUser: db.prepare('SELECT message_id AS messageId FROM message_favorites WHERE username = ?'),
  listRoomFavorites: db.prepare(`
    SELECT m.id, m.username, m.text, m.image_url AS imageUrl, m.timestamp
    FROM message_favorites f
    JOIN messages m ON m.id = f.message_id
    WHERE f.username = ? AND m.room_id = ?
    ORDER BY m.timestamp DESC
  `),
  getUser:       db.prepare('SELECT hash, role FROM users WHERE username = ?'),
  getAuthUser:   db.prepare('SELECT username, role FROM users WHERE username = ?'),
  getById:       db.prepare('SELECT id, room_id AS roomId, username, text, image_url AS imageUrl FROM messages WHERE id = ? AND room_id = ?'),
  syncUser:      db.prepare(`
    INSERT INTO users (username, hash, role)
    VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET hash = excluded.hash, role = excluded.role
  `),
  upsertAdminUser: db.prepare(`
    INSERT INTO users (username, hash, role)
    VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      hash = COALESCE(excluded.hash, users.hash),
      role = excluded.role
  `),
  listUsers:     db.prepare(`
    SELECT username, role
    FROM users
    ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'superuser' THEN 1 ELSE 2 END, username COLLATE NOCASE ASC
  `),
  createRoom: db.prepare(`
    INSERT INTO rooms (id, name, created_by, created_at, is_public)
    VALUES (?, ?, ?, ?, ?)
  `),
  renameRoom: db.prepare(`
    UPDATE rooms
    SET name = ?
    WHERE id = ?
  `),
  addRoomMember: db.prepare(`
    INSERT OR IGNORE INTO room_members (room_id, username, invited_by, joined_at)
    VALUES (?, ?, ?, ?)
  `),
  getRoomMember: db.prepare(`
    SELECT room_id AS roomId, username
    FROM room_members
    WHERE room_id = ? AND username = ?
  `),
  getRoomById: db.prepare(`
    SELECT id, name, created_by AS createdBy, created_at AS createdAt, is_public AS isPublic
    FROM rooms
    WHERE id = ?
  `),
  listRoomsForUser: db.prepare(`
    SELECT r.id, r.name, r.created_by AS createdBy, r.created_at AS createdAt, r.is_public AS isPublic,
           GROUP_CONCAT(rm.username) AS members
    FROM rooms r
    JOIN room_members mine ON mine.room_id = r.id AND mine.username = ?
    LEFT JOIN room_members rm ON rm.room_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at ASC, r.name COLLATE NOCASE ASC
  `),
  listPublicRooms: db.prepare(`
    SELECT r.id, r.name, r.created_by AS createdBy, r.created_at AS createdAt, r.is_public AS isPublic,
           GROUP_CONCAT(rm.username) AS members
    FROM rooms r
    LEFT JOIN room_members rm ON rm.room_id = r.id
    WHERE r.is_public = 1
    GROUP BY r.id
    ORDER BY r.created_at ASC, r.name COLLATE NOCASE ASC
  `),
  listRoomMembers: db.prepare(`
    SELECT username
    FROM room_members
    WHERE room_id = ?
    ORDER BY username COLLATE NOCASE ASC
  `),
  deleteRoomMember: db.prepare(`
    DELETE FROM room_members
    WHERE room_id = ? AND username = ?
  `),
  deleteRoomMembershipsByUser: db.prepare('DELETE FROM room_members WHERE username = ?'),
  deleteRoom: db.prepare('DELETE FROM rooms WHERE id = ?'),
  deleteRoomMembers: db.prepare('DELETE FROM room_members WHERE room_id = ?'),
  deleteRoomMessages: db.prepare('DELETE FROM messages WHERE room_id = ?'),
  listRoomImages: db.prepare(`
    SELECT username, image_url AS imageUrl, timestamp
    FROM messages
    WHERE room_id = ? AND image_url IS NOT NULL AND image_url != ''
    ORDER BY timestamp DESC
  `),
  countUsers:    db.prepare('SELECT COUNT(*) AS count FROM users'),
  countAdmins:   db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'"),
  countMessages: db.prepare('SELECT COUNT(*) AS count FROM messages'),
  deleteUser:    db.prepare('DELETE FROM users WHERE username = ?'),
  upsertPushSub: db.prepare('INSERT OR REPLACE INTO push_subscriptions (username, endpoint, subscription, updated_at) VALUES (?, ?, ?, ?)'),
  deletePushSub: db.prepare('DELETE FROM push_subscriptions WHERE username = ? AND endpoint = ?'),
  deleteAllPushSubs: db.prepare('DELETE FROM push_subscriptions WHERE username = ?'),
  listPushSubs:  db.prepare('SELECT username, endpoint, subscription FROM push_subscriptions'),
  createInvite: db.prepare(`
    INSERT INTO invites (token, created_by, role, created_at)
    VALUES (?, ?, ?, ?)
  `),
  getInvite: db.prepare(`
    SELECT token, created_by AS createdBy, role, created_at AS createdAt, used_at AS usedAt, used_by AS usedBy
    FROM invites
    WHERE token = ?
  `),
  markInviteUsed: db.prepare(`
    UPDATE invites
    SET used_at = ?, used_by = ?
    WHERE token = ? AND used_at IS NULL
  `),
};

const configuredUsers = loadConfiguredUsers();
if (configuredUsers.length) {
  const syncUsers = db.transaction((users) => {
    for (const user of users) {
      stmts.syncUser.run(user.username, hashPassword(user.password), user.role);
    }
  });
  syncUsers(configuredUsers);
  console.log(`[Auth] Synced ${configuredUsers.length} chat users from ${CHAT_USERS_FILE}`);
} else {
  const userCount = stmts.countUsers.get().count;
  if (userCount === 0) {
    console.warn(`[Auth] No chat users configured. Create ${CHAT_USERS_FILE} from config/chat-users.example.json`);
  } else {
    console.log(`[Auth] No external chat user config found, keeping ${userCount} users from database`);
  }
}

const seedDefaultRoom = db.transaction(() => {
  const existingRoom = stmts.getRoomById.get(DEFAULT_ROOM_ID);
  if (!existingRoom) {
    stmts.createRoom.run(DEFAULT_ROOM_ID, DEFAULT_ROOM_NAME, DEFAULT_ADMIN_USERNAME || 'system', new Date().toISOString(), 0);
    const users = stmts.listUsers.all();
    const joinedAt = new Date().toISOString();
    for (const user of users) {
      stmts.addRoomMember.run(DEFAULT_ROOM_ID, user.username, DEFAULT_ADMIN_USERNAME || 'system', joinedAt);
    }
  }
  db.prepare(`UPDATE messages SET room_id = ? WHERE room_id IS NULL OR room_id = ''`).run(DEFAULT_ROOM_ID);
});
seedDefaultRoom();

module.exports = {
  CHAT_USERS_FILE,
  DB_PATH,
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_ROOM_ID,
  DEFAULT_ROOM_NAME,
  db,
  hashPassword,
  openChatDatabase,
  stmts,
  validateRestorePayload,
};
