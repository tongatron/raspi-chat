'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const webpush = require('web-push');
const Database = require('better-sqlite3');

const hasVapidConfig = !!(
  process.env.VAPID_EMAIL &&
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY
);
if (hasVapidConfig) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.log('[Push] VAPID keys missing, web push disabled until configured');
}

const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads');
const DB_PATH = path.join(process.cwd(), 'data', 'chat.db');
const CHAT_USERS_FILE = process.env.CHAT_USERS_FILE || path.join(process.cwd(), 'config', 'chat-users.json');
const DEFAULT_ADMIN_USERNAME = normalizeUsername(process.env.DEFAULT_ADMIN_USERNAME || 'Giovanni');
const DEFAULT_ROOM_ID = 'cabras-giovanni';
const DEFAULT_ROOM_NAME = String(process.env.DEFAULT_ROOM_NAME || 'Cabras Giovanni').trim() || 'Cabras Giovanni';

const db = new Database(DB_PATH);
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
try { db.exec(`ALTER TABLE messages ADD COLUMN room_id TEXT NOT NULL DEFAULT '${DEFAULT_ROOM_ID}'`); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"); } catch(e) {}
try { db.exec("ALTER TABLE invites ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"); } catch(e) {}
try { db.exec("ALTER TABLE invites ADD COLUMN created_at TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE invites ADD COLUMN used_at TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE invites ADD COLUMN used_by TEXT"); } catch(e) {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    username TEXT PRIMARY KEY,
    subscription TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`); } catch(e) {}

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

const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_COOKIE_NAME = 'chat_auth';

function normalizeUsername(value) {
  return String(value || '').trim().slice(0, 30);
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'admin') return 'admin';
  if (role === 'superuser') return 'superuser';
  return 'user';
}

function canManageUsers(user) {
  return !!user && user.role === 'admin';
}

function canCreateInvites(user) {
  return !!user && (user.role === 'admin' || user.role === 'superuser');
}

function canUseConsole(user) {
  return !!user && (user.role === 'admin' || user.role === 'superuser');
}

function normalizeRoomName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function slugPart(value) {
  return normalizeUsername(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'user';
}

function buildDirectRoomId(userA, userB) {
  return ['dm', slugPart(userA), slugPart(userB)].join('-');
}

function encodeSessionCookie(username, token) {
  return Buffer.from(JSON.stringify({ username, token }), 'utf8').toString('base64url');
}

function decodeSessionCookie(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    return {
      username: normalizeUsername(parsed.username),
      token: String(parsed.token || '').trim(),
    };
  } catch {
    return null;
  }
}

function generateToken(username) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(username).digest('hex');
}
function validateToken(username, token) {
  if (!username || !token) return false;
  try {
    const expected = Buffer.from(generateToken(username));
    const given    = Buffer.from(token);
    if (expected.length !== given.length) return false;
    return crypto.timingSafeEqual(expected, given);
  } catch { return false; }
}

function parseCookies(request) {
  const raw = String(request.headers.cookie || '');
  const cookies = {};
  for (const entry of raw.split(';')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    cookies[key] = value;
  }
  return cookies;
}

function getCookieAuth(request) {
  const cookies = parseCookies(request);
  return decodeSessionCookie(cookies[SESSION_COOKIE_NAME]);
}

function getAuthenticatedUsername(request) {
  const user = getAuthenticatedUser(request);
  return user ? user.username : null;
}

function getAuthenticatedUser(request) {
  const cookieAuth = getCookieAuth(request);
  const headerUsername = normalizeUsername(request.headers['x-chat-username']);
  const username = headerUsername || cookieAuth?.username || '';
  const headerToken = String(request.headers['x-chat-token'] || '').trim();
  const token = headerToken || cookieAuth?.token || '';
  if (!validateToken(username, token)) return null;
  const user = stmts.getAuthUser.get(username);
  if (!user) return null;
  return {
    username: normalizeUsername(user.username),
    role: normalizeRole(user.role),
  };
}

function requireAuth(request, reply) {
  const user = getAuthenticatedUser(request);
  if (!user) {
    reply.code(401).send({ error: 'Non autorizzato' });
    return null;
  }

  return user.username;
}

function requireAuthUser(request, reply) {
  const user = getAuthenticatedUser(request);
  if (!user) {
    reply.code(401).send({ error: 'Non autorizzato' });
    return null;
  }
  return user;
}

function requireAdmin(request, reply) {
  const user = getAuthenticatedUser(request);
  if (!user) {
    reply.code(401).send({ error: 'Non autorizzato' });
    return null;
  }
  if (!canManageUsers(user)) {
    reply.code(403).send({ error: 'Permessi insufficienti' });
    return null;
  }
  return user;
}

function requireInviteAccess(request, reply) {
  const user = getAuthenticatedUser(request);
  if (!user) {
    reply.code(401).send({ error: 'Non autorizzato' });
    return null;
  }
  if (!canCreateInvites(user)) {
    reply.code(403).send({ error: 'Permessi insufficienti' });
    return null;
  }
  return user;
}

function requireConsoleAccess(request, reply) {
  const user = getAuthenticatedUser(request);
  if (!user) {
    reply.code(401).send({ error: 'Non autorizzato' });
    return null;
  }
  if (!canUseConsole(user)) {
    reply.code(403).send({ error: 'Permessi insufficienti' });
    return null;
  }
  return user;
}

function requireRoomMember(request, reply, roomId, user) {
  const authenticatedUser = user || requireAuthUser(request, reply);
  if (!authenticatedUser) return null;
  const room = stmts.getRoomById.get(roomId);
  if (!room) {
    reply.code(404).send({ error: 'Stanza non trovata' });
    return null;
  }
  const membership = stmts.getRoomMember.get(roomId, authenticatedUser.username);
  if (!membership) {
    reply.code(403).send({ error: 'Accesso stanza non consentito' });
    return null;
  }
  return {
    user: authenticatedUser,
    room: formatRoom({
      id: room.id,
      name: room.name,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
      members: stmts.listRoomMembers.all(roomId).map((entry) => entry.username).join(','),
    }, authenticatedUser.username),
  };
}

function getRequestAddress(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(request.ip || request.socket?.remoteAddress || '').trim();
}

function isLocalAccess(request) {
  const address = getRequestAddress(request)
    .replace(/^::ffff:/, '')
    .replace(/^\[|\]$/g, '');
  const host = String(request.headers['x-forwarded-host'] || request.headers.host || '').toLowerCase();

  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '' ||
    address.startsWith('10.') ||
    address.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address) ||
    host.includes('raspberrypi.local') ||
    host.includes('localhost')
  );
}

function setSessionCookie(reply, username, token) {
  const value = encodeSessionCookie(username, token);
  reply.header(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${value}; Path=/chat; HttpOnly; SameSite=Strict; Max-Age=2592000`
  );
}

function clearSessionCookie(reply) {
  reply.header(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/chat; HttpOnly; SameSite=Strict; Max-Age=0`
  );
}

const HISTORY_SQL = `
  SELECT m.id, m.room_id AS roomId, m.username, m.text, m.image_url AS imageUrl, m.timestamp, m.reply_to_id AS replyToId,
         rm.username AS replyUsername, rm.text AS replyText, rm.image_url AS replyImageUrl,
         GROUP_CONCAT(r.username) AS readBy
  FROM messages m
  LEFT JOIN message_reads r ON r.message_id = m.id
  LEFT JOIN messages rm ON rm.id = m.reply_to_id
  WHERE m.room_id = ?
  GROUP BY m.id
`;

const stmts = {
  insertMessage: db.prepare('INSERT INTO messages (id, room_id, username, text, image_url, timestamp, reply_to_id) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  getHistory:    db.prepare(HISTORY_SQL + ' ORDER BY m.timestamp DESC LIMIT 100'),
  getPage:       db.prepare(HISTORY_SQL + ' AND m.timestamp < ? ORDER BY m.timestamp DESC LIMIT ?'),
  insertRead:    db.prepare('INSERT OR IGNORE INTO message_reads (message_id, username) VALUES (?, ?)'),
  deleteMessage: db.prepare('DELETE FROM messages WHERE id = ? AND room_id = ? AND username = ?'),
  deleteReads:   db.prepare('DELETE FROM message_reads WHERE message_id = ?'),
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
    INSERT INTO rooms (id, name, created_by, created_at)
    VALUES (?, ?, ?, ?)
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
    SELECT id, name, created_by AS createdBy, created_at AS createdAt
    FROM rooms
    WHERE id = ?
  `),
  listRoomsForUser: db.prepare(`
    SELECT r.id, r.name, r.created_by AS createdBy, r.created_at AS createdAt,
           GROUP_CONCAT(rm.username) AS members
    FROM rooms r
    JOIN room_members mine ON mine.room_id = r.id AND mine.username = ?
    LEFT JOIN room_members rm ON rm.room_id = r.id
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
  countUsers:    db.prepare('SELECT COUNT(*) AS count FROM users'),
  countAdmins:   db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'"),
  countMessages: db.prepare('SELECT COUNT(*) AS count FROM messages'),
  deleteUser:    db.prepare('DELETE FROM users WHERE username = ?'),
  upsertPushSub: db.prepare('INSERT OR REPLACE INTO push_subscriptions (username, subscription, updated_at) VALUES (?, ?, ?)'),
  deletePushSub: db.prepare('DELETE FROM push_subscriptions WHERE username = ?'),
  listPushSubs:  db.prepare('SELECT username, subscription FROM push_subscriptions'),
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
    stmts.createRoom.run(DEFAULT_ROOM_ID, DEFAULT_ROOM_NAME, DEFAULT_ADMIN_USERNAME || 'system', new Date().toISOString());
    const users = stmts.listUsers.all();
    const joinedAt = new Date().toISOString();
    for (const user of users) {
      stmts.addRoomMember.run(DEFAULT_ROOM_ID, user.username, DEFAULT_ADMIN_USERNAME || 'system', joinedAt);
    }
  }
  db.prepare(`UPDATE messages SET room_id = ? WHERE room_id IS NULL OR room_id = ''`).run(DEFAULT_ROOM_ID);
});
seedDefaultRoom();

function formatRow(row) {
  return {
    type: 'message',
    id: row.id,
    roomId: row.roomId,
    username: row.username,
    text: row.text || '',
    imageUrl: row.imageUrl || null,
    timestamp: row.timestamp,
    readBy: row.readBy ? row.readBy.split(',') : [],
    replyTo: row.replyToId ? {
      id: row.replyToId,
      username: row.replyUsername || '',
      text: row.replyText || '',
      imageUrl: row.replyImageUrl || null,
    } : null,
  };
}

function formatRoom(row, currentUsername) {
  const members = String(row.members || '')
    .split(',')
    .map((item) => normalizeUsername(item))
    .filter(Boolean);
  return {
    id: row.id,
    name: normalizeRoomName(row.name),
    createdBy: normalizeUsername(row.createdBy),
    createdAt: row.createdAt,
    members,
    memberCount: members.length,
    isOwner: normalizeUsername(row.createdBy) === currentUsername,
  };
}

function loadRoomsForUser(username) {
  return stmts.listRoomsForUser.all(username).map((row) => formatRoom(row, username));
}

function loadHistory(roomId) {
  return stmts.getHistory.all(roomId).reverse().map(formatRow);
}

function formatUser(row) {
  const username = normalizeUsername(row.username);
  const role = normalizeRole(row.role);
  return {
    username,
    role,
    isAdmin: role === 'admin',
  };
}

function formatInvite(row, request) {
  if (!row) return null;
  const protocol = String(request.headers['x-forwarded-proto'] || request.protocol || 'http').split(',')[0].trim() || 'http';
  const host = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
  const pathName = `/chat/invite/${encodeURIComponent(row.token)}`;
  return {
    token: row.token,
    role: normalizeRole(row.role),
    createdBy: normalizeUsername(row.createdBy),
    createdAt: row.createdAt,
    usedAt: row.usedAt || null,
    usedBy: row.usedBy ? normalizeUsername(row.usedBy) : null,
    isUsed: !!row.usedAt,
    url: host ? `${protocol}://${host}${pathName}` : pathName,
    path: pathName,
  };
}

function sendWebPushToUser(username, payload) {
  const sub = pushSubs.get(username);
  if (!sub) return Promise.resolve(false);
  return webpush.sendNotification(sub, JSON.stringify(payload))
    .then(() => true)
    .catch((err) => {
      console.error(`[Push] Direct WebPush failed for ${username}: ${err.statusCode || err.code || 'unknown'} ${err.message || err}`);
      if (err.statusCode === 410 || err.statusCode === 404) {
        pushSubs.delete(username);
        stmts.deletePushSub.run(username);
      }
      return false;
    });
}

function createInitialRoomForUser(username, createdBy, now) {
  const owner = normalizeUsername(createdBy) || DEFAULT_ADMIN_USERNAME;
  if (!owner || owner === username) {
    stmts.addRoomMember.run(DEFAULT_ROOM_ID, username, owner || 'system', now);
    return {
      invitedBy: owner || null,
      firstRoomId: DEFAULT_ROOM_ID,
      firstRoomName: DEFAULT_ROOM_NAME,
    };
  }

  const roomId = buildDirectRoomId(owner, username);
  const roomName = `${owner}, ${username}`;
  if (!stmts.getRoomById.get(roomId)) {
    stmts.createRoom.run(roomId, roomName, owner, now);
  }
  stmts.addRoomMember.run(roomId, owner, owner, now);
  stmts.addRoomMember.run(roomId, username, owner, now);
  stmts.insertMessage.run(
    crypto.randomUUID(),
    roomId,
    'Raspi Chat',
    `${username} ha completato la registrazione ed e' entrato nella stanza.`,
    null,
    now,
    null
  );
  return {
    invitedBy: owner,
    firstRoomId: roomId,
    firstRoomName: roomName,
  };
}

const registerUserFromInvite = db.transaction(({ token, username, password, now }) => {
  const invite = stmts.getInvite.get(token);
  if (!invite) return { error: 'Invito non trovato', status: 404 };
  if (invite.usedAt) return { error: 'Invito gia usato', status: 410 };
  if (stmts.getUser.get(username)) return { error: 'Nome gia usato', status: 409 };

  const role = normalizeRole(invite.role);
  const createdBy = normalizeUsername(invite.createdBy) || DEFAULT_ADMIN_USERNAME;

  stmts.syncUser.run(username, hashPassword(password), role);
  const result = stmts.markInviteUsed.run(now, username, token);
  if (!result.changes) return { error: 'Invito non piu disponibile', status: 409 };
  const roomInfo = createInitialRoomForUser(username, createdBy, now);

  return {
    ok: true,
    role,
    invitedBy: roomInfo.invitedBy,
    firstRoomId: roomInfo.firstRoomId,
    firstRoomName: roomInfo.firstRoomName,
  };
});

const registerUserDirect = db.transaction(({ username, password, now }) => {
  if (stmts.getUser.get(username)) return { error: 'Nome gia usato', status: 409 };
  stmts.syncUser.run(username, hashPassword(password), 'user');
  const roomInfo = createInitialRoomForUser(username, DEFAULT_ADMIN_USERNAME, now);
  return {
    ok: true,
    role: 'user',
    invitedBy: roomInfo.invitedBy,
    firstRoomId: roomInfo.firstRoomId,
    firstRoomName: roomInfo.firstRoomName,
  };
});

function readCommand(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', timeout: 2000 }).trim();
  } catch {
    return null;
  }
}

function readTemperatureC() {
  const vcgencmd = readCommand('vcgencmd', ['measure_temp']);
  if (vcgencmd) {
    const match = vcgencmd.match(/temp=([\d.]+)/i);
    if (match) return Number(match[1]);
  }

  try {
    const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
    if (raw) return Number(raw) / 1000;
  } catch {}

  return null;
}

function readDiskUsage(targetPath) {
  try {
    const stats = fs.statfsSync(targetPath);
    const total = Number(stats.bsize) * Number(stats.blocks);
    const free = Number(stats.bsize) * Number(stats.bavail);
    const used = Math.max(total - free, 0);
    return { total, used, free };
  } catch {
    return null;
  }
}

function formatUptimeSeconds(totalSeconds) {
  const value = Math.max(Math.floor(totalSeconds || 0), 0);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days) return `${days}g ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getYoutubeVideoId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? id.slice(0, 32) : null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v');
        return id ? id.slice(0, 32) : null;
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed') {
        return parts[1] ? parts[1].slice(0, 32) : null;
      }
    }
  } catch {}

  return null;
}

async function buildYoutubePreview(url) {
  const videoId = getYoutubeVideoId(url);
  if (!videoId) return null;

  const fallback = {
    url,
    siteName: 'YouTube',
    title: 'Video YouTube',
    description: null,
    image: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    favicon: 'https://www.youtube.com/s/desktop/fe6f5d8b/img/logos/favicon_32x32.png',
  };

  try {
    const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ChatPreview/1.0)', accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    return {
      url,
      siteName: 'YouTube',
      title: String(data.title || fallback.title).trim() || fallback.title,
      description: data.author_name ? `Canale: ${String(data.author_name).trim()}` : null,
      image: data.thumbnail_url || fallback.image,
      favicon: fallback.favicon,
    };
  } catch {
    return fallback;
  }
}

const clients   = new Map();
const pushSubs  = new Map();

// Load persisted push subscriptions
for (const row of stmts.listPushSubs.all()) {
  try { pushSubs.set(row.username, JSON.parse(row.subscription)); } catch(e) {}
}
console.log(`[Push] Loaded ${pushSubs.size} persisted subscriptions`);

function broadcast(msg) {
  const raw = JSON.stringify(msg);
  for (const client of clients.values()) {
    if (client.ws.readyState === 1) client.ws.send(raw);
  }
}
function broadcastToRoom(roomId, msg) {
  const raw = JSON.stringify(msg);
  for (const client of clients.values()) {
    if (client.roomId !== roomId) continue;
    if (client.ws.readyState === 1) client.ws.send(raw);
  }
}
function broadcastOnline(roomId) { broadcastToRoom(roomId, { type: 'online', users: onlineUsers(roomId), roomId }); }
function notifyUnread(roomId, roomName, senderUsername) {
  const members = stmts.listRoomMembers.all(roomId).map(r => r.username);
  const note = JSON.stringify({ type: 'unread', roomId, roomName, from: senderUsername });
  for (const client of clients.values()) {
    if (client.roomId === roomId) continue;
    if (!client.username || !members.includes(client.username)) continue;
    if (client.username === senderUsername) continue;
    if (client.ws.readyState === 1) client.ws.send(note);
  }
}
function onlineUsers(roomId) {
  return [...new Set([...clients.values()]
    .filter((c) => c.username && (!roomId || c.roomId === roomId))
    .map((c) => c.username))];
}

async function sendWebPush(msg, senderUsername, roomId) {
  // Only send to members of the room who are NOT currently active in it
  const members = new Set(stmts.listRoomMembers.all(roomId).map(r => r.username));
  const activeInRoom = new Set();
  for (const client of clients.values()) {
    if (client.roomId === roomId && client.username) activeInRoom.add(client.username);
  }
  const roomRow = stmts.getRoomById.get(roomId);
  const roomName = roomRow ? roomRow.name : 'Chat';
  const payload = JSON.stringify({
    title: `${msg.username} · ${roomName}`,
    body: msg.text ? msg.text.slice(0, 100) : '📎 Immagine',
    url: '/chat'
  });
  for (const [username, sub] of pushSubs) {
    if (username === senderUsername) continue;       // non mandare al mittente
    if (!members.has(username)) continue;            // solo membri della stanza
    if (activeInRoom.has(username)) continue;        // già connesso in questa stanza
    try {
      await webpush.sendNotification(sub, payload);
      console.log(`[Push] WebPush sent to ${username} for room ${roomId}`);
    } catch (err) {
      console.error(`[Push] WebPush failed for ${username}: ${err.statusCode || err.code || 'unknown'} ${err.message || err}`);
      if (err.statusCode === 410 || err.statusCode === 404) { pushSubs.delete(username); stmts.deletePushSub.run(username); }
    }
  }
}
async function sendAllPush(msg, senderUsername, roomId) {
  await sendWebPush(msg, senderUsername, roomId);
}

function decodeHtmlEntities(value) {
  if (!value) return value;
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return _; }
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return _; }
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function resolveMetaUrl(value, baseUrl) {
  if (!value) return null;
  try {
    return new URL(decodeHtmlEntities(value), baseUrl).toString();
  } catch {
    return decodeHtmlEntities(value);
  }
}

function extractMeta(html, baseUrl) {
  const og = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']{1,500})["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']{1,500})["'][^>]+property=["']og:${prop}["']`, 'i'));
    return m ? m[1].trim() : null;
  };
  const meta = (name) => {
    const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']{1,500})["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']{1,500})["'][^>]+name=["']${name}["']`, 'i'));
    return m ? m[1].trim() : null;
  };
  const titleM = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const title = og('title') || meta('twitter:title') || (titleM ? titleM[1].trim() : null);
  const description = og('description') || meta('description') || meta('twitter:description');
  const rawImage = og('image') || og('image:secure_url') || meta('twitter:image') || meta('twitter:image:src');
  const image = resolveMetaUrl(rawImage, baseUrl);
  const siteName = og('site_name');
  const favicon = (() => {
    const m = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/i);
    if (!m) return null;
    const href = m[1];
    return resolveMetaUrl(href, baseUrl);
  })();
  return {
    title: decodeHtmlEntities(title),
    description: decodeHtmlEntities(description),
    image,
    siteName: decodeHtmlEntities(siteName),
    favicon,
    url: baseUrl
  };
}

function normalizeFacebookPreview(meta, url) {
  if (!meta) return meta;
  const hostname = (() => {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
  })();
  if (!hostname.includes('facebook.com') && !hostname.includes('fb.com') && !hostname.includes('fb.watch')) {
    return meta;
  }
  const title = meta.title && meta.title !== 'Facebook' ? meta.title : 'Facebook';
  const description = meta.description && meta.description !== title ? meta.description : null;
  return Object.assign({}, meta, {
    siteName: meta.siteName || 'Facebook',
    title,
    description,
    image: meta.image || null,
    favicon: meta.favicon || 'https://static.xx.fbcdn.net/rsrc.php/yD/r/d4ZIVX-5C-b.ico',
  });
}

async function chatRoutes(app) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  app.get('/sw.js', async (request, reply) =>
    reply.type('application/javascript')
      .header('Service-Worker-Allowed', '/')
      .header('Cache-Control', 'no-store')
      .send(fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8')));

  app.get('/chat/manifest.json', async (request, reply) =>
    reply.type('application/manifest+json')
      .header('Cache-Control', 'no-store')
      .send({
      name: 'Chat Tongatron', short_name: 'Chat', description: 'Chat privata in tempo reale',
      start_url: '/chat', scope: '/', display: 'standalone', orientation: 'portrait',
      background_color: '#f0f0f0', theme_color: '#3b82f6',
      icons: [
        { src: '/chat/assets/icon-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/chat/assets/icon-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/chat/assets/icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/chat/assets/icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }));

  app.get('/chat/icon-:size.png', async (request, reply) => {
    const filePath = path.join(process.cwd(), 'public', 'assets', `icon-${request.params.size}.png`);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Not found' });
    return reply.type('image/png').header('Cache-Control', 'no-cache, must-revalidate').send(fs.createReadStream(filePath));
  });

  app.get('/chat/assets/:assetName', async (request, reply) => {
    const assetName = path.basename(String(request.params.assetName || ''));
    const allowedAssets = new Map([
      ['logo.png', 'image/png'],
      ['logo-v2.png', 'image/png'],
      ['logo-v3.png', 'image/png'],
      ['logo-v4.png', 'image/png'],
      ['raspinew.png', 'image/png'],
      ['raspinew-home.png', 'image/png'],
      ['icon.png', 'image/png'],
      ['icon-v2.png', 'image/png'],
      ['icon-192.png', 'image/png'],
      ['icon-192-v2.png', 'image/png'],
      ['icon-512.png', 'image/png'],
      ['icon-512-v2.png', 'image/png'],
      ['favicon.ico', 'image/x-icon'],
      ['favicon-v2.ico', 'image/x-icon'],
      ['favicon-16.png', 'image/png'],
      ['favicon-16-v2.png', 'image/png'],
      ['favicon-32.png', 'image/png'],
      ['favicon-32-v2.png', 'image/png'],
    ]);
    if (!allowedAssets.has(assetName)) return reply.code(404).send({ error: 'Not found' });
    const filePath = path.join(process.cwd(), 'public', 'assets', assetName);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Not found' });
    return reply.type(allowedAssets.get(assetName)).header('Cache-Control', 'no-cache, must-revalidate').send(fs.createReadStream(filePath));
  });

  app.get('/chat/login-users', async () => {
    return stmts.listUsers.all().map(formatUser);
  });

  app.post('/chat/login', async (request, reply) => {
    const username = normalizeUsername(request.body?.username);
    const password = String(request.body?.password || '');
    if (!username || !password) return reply.code(400).send({ error: 'Dati mancanti' });
    const user = stmts.getUser.get(username);
    if (!user) return reply.code(401).send({ error: 'Credenziali non valide' });
    const [saltHex, hashHex] = user.hash.split(':');
    const inputHash  = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
    const storedHash = Buffer.from(hashHex, 'hex');
    if (!crypto.timingSafeEqual(inputHash, storedHash)) return reply.code(401).send({ error: 'Credenziali non valide' });
    const token = generateToken(username);
    setSessionCookie(reply, username, token);
    const normalizedRole = normalizeRole(user.role);
    return {
      token,
      username,
      role: normalizedRole,
      isAdmin: normalizedRole === 'admin',
      canManageUsers: normalizedRole === 'admin',
      canCreateInvites: normalizedRole === 'admin' || normalizedRole === 'superuser',
      canUseConsole: normalizedRole === 'admin' || normalizedRole === 'superuser',
    };
  });

  app.post('/chat/logout', async (request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/chat/me', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user) return;
    const rooms = loadRoomsForUser(user.username);
    return {
      username: user.username,
      role: user.role,
      isAdmin: canManageUsers(user),
      canManageUsers: canManageUsers(user),
      canCreateInvites: canCreateInvites(user),
      canUseConsole: canUseConsole(user),
      rooms,
      defaultRoomId: rooms[0]?.id || DEFAULT_ROOM_ID,
    };
  });

  app.get('/chat/my-rooms', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user) return;
    return {
      rooms: loadRoomsForUser(user.username),
      users: stmts.listUsers.all().map(u => ({ username: u.username })),
    };
  });

  app.post('/chat/my-rooms', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user) return;

    const name = normalizeRoomName(request.body?.name);
    if (!name) return reply.code(400).send({ error: 'Nome stanza mancante' });

    const requestedMembers = Array.isArray(request.body?.members) ? request.body.members : [];
    const memberSet = new Set([user.username]);
    for (const entry of requestedMembers) {
      const username = normalizeUsername(entry);
      if (!username) continue;
      if (!stmts.getAuthUser.get(username)) return reply.code(400).send({ error: `Utente non trovato: ${username}` });
      memberSet.add(username);
    }

    const roomId = crypto.randomBytes(8).toString('hex');
    const createdAt = new Date().toISOString();
    const createRoom = db.transaction(() => {
      stmts.createRoom.run(roomId, name, user.username, createdAt);
      for (const username of memberSet) {
        stmts.addRoomMember.run(roomId, username, user.username, createdAt);
      }
    });
    createRoom();

    return {
      ok: true,
      room: loadRoomsForUser(user.username).find((room) => room.id === roomId) || null,
      rooms: loadRoomsForUser(user.username),
    };
  });

  app.get('/chat/rooms', async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;
    return {
      rooms: loadRoomsForUser(user.username),
      users: stmts.listUsers.all().map(formatUser),
    };
  });

  app.post('/chat/rooms', async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    const name = normalizeRoomName(request.body?.name);
    if (!name) return reply.code(400).send({ error: 'Nome stanza mancante' });

    const requestedMembers = Array.isArray(request.body?.members) ? request.body.members : [];
    const memberSet = new Set([user.username]);
    for (const entry of requestedMembers) {
      const username = normalizeUsername(entry);
      if (!username) continue;
      if (!stmts.getAuthUser.get(username)) return reply.code(400).send({ error: `Utente non trovato: ${username}` });
      memberSet.add(username);
    }

    const roomId = crypto.randomBytes(8).toString('hex');
    const createdAt = new Date().toISOString();
    const createRoom = db.transaction(() => {
      stmts.createRoom.run(roomId, name, user.username, createdAt);
      for (const username of memberSet) {
        stmts.addRoomMember.run(roomId, username, user.username, createdAt);
      }
    });
    createRoom();

    return {
      ok: true,
      room: loadRoomsForUser(user.username).find((room) => room.id === roomId) || null,
      rooms: loadRoomsForUser(user.username),
    };
  });

  app.patch('/chat/rooms/:roomId', async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    const roomId = String(request.params.roomId || '').trim();
    const access = requireRoomMember(request, reply, roomId, user);
    if (!access) return;

    const name = normalizeRoomName(request.body?.name);
    if (!name) return reply.code(400).send({ error: 'Nome stanza mancante' });

    stmts.renameRoom.run(name, roomId);

    return {
      ok: true,
      room: loadRoomsForUser(user.username).find((room) => room.id === roomId) || null,
      rooms: loadRoomsForUser(user.username),
    };
  });

  app.delete('/chat/rooms/:roomId', async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    const roomId = String(request.params.roomId || '').trim();
    if (!roomId) return reply.code(400).send({ error: 'ID stanza mancante' });

    const deleteAll = db.transaction(() => {
      stmts.deleteRoomMessages.run(roomId);
      stmts.deleteRoomMembers.run(roomId);
      stmts.deleteRoom.run(roomId);
    });
    deleteAll();

    return {
      ok: true,
      rooms: loadRoomsForUser(user.username),
      users: stmts.listUsers.all().map(formatUser),
    };
  });

  app.post('/chat/rooms/:roomId/members', async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    const roomId = String(request.params.roomId || '').trim();
    const access = requireRoomMember(request, reply, roomId, user);
    if (!access) return;

    const requestedMembers = Array.isArray(request.body?.members) ? request.body.members : [];
    const normalized = [];
    for (const entry of requestedMembers) {
      const username = normalizeUsername(entry);
      if (!username || username === user.username) continue;
      if (!stmts.getAuthUser.get(username)) return reply.code(400).send({ error: `Utente non trovato: ${username}` });
      normalized.push(username);
    }

    const joinedAt = new Date().toISOString();
    for (const username of normalized) {
      stmts.addRoomMember.run(roomId, username, user.username, joinedAt);
    }

    return {
      ok: true,
      room: loadRoomsForUser(user.username).find((room) => room.id === roomId) || access.room,
      rooms: loadRoomsForUser(user.username),
    };
  });

  app.delete('/chat/rooms/:roomId/members/:username', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user) return;
    if (user.role !== 'admin') {
      return reply.code(403).send({ error: 'Solo un admin puo rimuovere utenti dalle stanze' });
    }

    const roomId = String(request.params.roomId || '').trim();
    const targetUsername = normalizeUsername(request.params.username);
    const access = requireRoomMember(request, reply, roomId, user);
    if (!access) return;
    if (!targetUsername) return reply.code(400).send({ error: 'Utente mancante' });
    if (targetUsername === access.room.createdBy) {
      return reply.code(400).send({ error: 'Non puoi rimuovere il creatore della stanza' });
    }

    const membership = stmts.getRoomMember.get(roomId, targetUsername);
    if (!membership) return reply.code(404).send({ error: 'Utente non presente nella stanza' });

    stmts.deleteRoomMember.run(roomId, targetUsername);

    for (const client of clients.values()) {
      if (client.username === targetUsername && client.roomId === roomId) {
        try {
          client.ws.send(JSON.stringify({ type: 'room_removed', roomId, username: targetUsername }));
          client.ws.close();
        } catch {}
      }
    }

    return {
      ok: true,
      room: loadRoomsForUser(user.username).find((room) => room.id === roomId) || null,
      rooms: loadRoomsForUser(user.username),
    };
  });

  app.get('/chat/admin/users', async (request, reply) => {
    const adminUser = requireAdmin(request, reply);
    if (!adminUser) return;
    return {
      currentUser: adminUser.username,
      users: stmts.listUsers.all().map(formatUser),
    };
  });

  app.post('/chat/admin/users', async (request, reply) => {
    const adminUser = requireAdmin(request, reply);
    if (!adminUser) return;
    const username = normalizeUsername(request.body?.username);
    const password = String(request.body?.password || '');
    const role = normalizeRole(request.body?.role);

    if (!username) return reply.code(400).send({ error: 'Username mancante' });
    if (!['admin', 'superuser', 'user'].includes(role)) return reply.code(400).send({ error: 'Ruolo non valido' });

    const existing = stmts.getUser.get(username);
    if (!existing && !password) return reply.code(400).send({ error: 'Password richiesta per il nuovo utente' });

    if (existing && existing.role === 'admin' && role !== 'admin' && stmts.countAdmins.get().count <= 1) {
      return reply.code(400).send({ error: 'Deve esistere almeno un admin' });
    }

    const hash = password ? hashPassword(password) : existing?.hash || null;
    stmts.upsertAdminUser.run(username, hash, role);

    return {
      ok: true,
      users: stmts.listUsers.all().map(formatUser),
    };
  });

  app.delete('/chat/admin/users/:username', async (request, reply) => {
    const adminUser = requireAdmin(request, reply);
    if (!adminUser) return;

    const username = normalizeUsername(request.params.username);
    if (!username) return reply.code(400).send({ error: 'Username mancante' });
    if (username === adminUser.username) {
      return reply.code(400).send({ error: 'Non puoi eliminare il tuo utente mentre sei collegato' });
    }
    const existing = stmts.getUser.get(username);
    if (!existing) return reply.code(404).send({ error: 'Utente non trovato' });
    if (normalizeRole(existing.role) === 'admin' && stmts.countAdmins.get().count <= 1) {
      return reply.code(400).send({ error: 'Deve esistere almeno un admin' });
    }

    stmts.deleteRoomMembershipsByUser.run(username);
    stmts.deleteUser.run(username);
    return {
      ok: true,
      users: stmts.listUsers.all().map(formatUser),
    };
  });

  app.post('/chat/admin/invites', async (request, reply) => {
    const user = requireInviteAccess(request, reply);
    if (!user) return;

    const role = normalizeRole(request.body?.role || 'user');
    const token = crypto.randomBytes(24).toString('hex');
    const createdAt = new Date().toISOString();
    stmts.createInvite.run(token, user.username, role, createdAt);

    return {
      ok: true,
      invite: formatInvite(stmts.getInvite.get(token), request),
    };
  });

  app.get('/chat/invite/:token/data', async (request, reply) => {
    const token = String(request.params.token || '').trim();
    if (!token) return reply.code(404).send({ error: 'Invito non trovato' });
    const invite = stmts.getInvite.get(token);
    if (!invite) return reply.code(404).send({ error: 'Invito non trovato' });
    if (invite.usedAt) {
      return reply.code(410).send({
        error: 'Invito gia usato',
        invite: formatInvite(invite, request),
      });
    }

    return {
      ok: true,
      invite: formatInvite(invite, request),
    };
  });

  app.post('/chat/invite/:token/register', async (request, reply) => {
    const token = String(request.params.token || '').trim();
    const invite = stmts.getInvite.get(token);
    if (!invite) return reply.code(404).send({ error: 'Invito non trovato' });
    if (invite.usedAt) return reply.code(410).send({ error: 'Invito gia usato' });

    const username = normalizeUsername(request.body?.username);
    const password = String(request.body?.password || '');
    if (!username) return reply.code(400).send({ error: 'Nome mancante' });
    if (password.length < 4) return reply.code(400).send({ error: 'Password troppo corta' });
    const result = registerUserFromInvite({ token, username, password, now: new Date().toISOString() });
    if (!result.ok) return reply.code(result.status || 400).send({ error: result.error || 'Registrazione non riuscita' });

    const tokenValue = generateToken(username);
    setSessionCookie(reply, username, tokenValue);
    if (result.firstRoomId && result.invitedBy && result.invitedBy !== username) {
      notifyUnread(result.firstRoomId, result.firstRoomName || 'Nuova stanza', 'Raspi Chat');
      await sendWebPushToUser(result.invitedBy, {
        title: 'Raspi Chat',
        body: `${username} si e' registrato ed e' entrato nella tua stanza.`,
        url: '/chat',
      });
    }

    return {
      ok: true,
      username,
      role: result.role,
      token: tokenValue,
      firstRoomId: result.firstRoomId || DEFAULT_ROOM_ID,
      firstRoomName: result.firstRoomName || DEFAULT_ROOM_NAME,
      loginUrl: '/chat',
    };
  });

  app.post('/register', async (request, reply) => {
    const username = normalizeUsername(request.body?.username);
    const password = String(request.body?.password || '');
    if (!username) return reply.code(400).send({ error: 'Nome mancante' });
    if (password.length < 4) return reply.code(400).send({ error: 'Password troppo corta' });
    const result = registerUserDirect({ username, password, now: new Date().toISOString() });
    if (!result.ok) return reply.code(result.status || 400).send({ error: result.error || 'Registrazione non riuscita' });

    const tokenValue = generateToken(username);
    setSessionCookie(reply, username, tokenValue);
    if (result.firstRoomId && result.invitedBy && result.invitedBy !== username) {
      notifyUnread(result.firstRoomId, result.firstRoomName || 'Nuova stanza', 'Raspi Chat');
      await sendWebPushToUser(result.invitedBy, {
        title: 'Raspi Chat',
        body: `${username} si e' registrato ed e' entrato nella tua stanza.`,
        url: '/chat',
      });
    }

    return {
      ok: true,
      username,
      role: result.role,
      token: tokenValue,
      firstRoomId: result.firstRoomId || DEFAULT_ROOM_ID,
      firstRoomName: result.firstRoomName || DEFAULT_ROOM_NAME,
      loginUrl: '/chat',
    };
  });

  // Pagination endpoint
  app.get('/chat/messages', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user) return;
    const roomId = String(request.query.roomId || '').trim() || DEFAULT_ROOM_ID;
    const access = requireRoomMember(request, reply, roomId, user);
    if (!access) return;
    const { before } = request.query;
    if (!before) return reply.code(400).send({ error: 'before richiesto' });
    const limit = Math.min(parseInt(request.query.limit) || 50, 100);
    const rows = stmts.getPage.all(roomId, before, limit);
    return rows.reverse().map(formatRow);
  });

  app.post('/chat/push-subscribe', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const { subscription } = request.body || {};
    if (!subscription) return reply.code(400).send({ error: 'Dati mancanti' });
    pushSubs.set(username, subscription);
    stmts.upsertPushSub.run(username, JSON.stringify(subscription), new Date().toISOString());
    return { ok: true };
  });
  app.delete('/chat/push-unsubscribe', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    pushSubs.delete(username);
    stmts.deletePushSub.run(username);
    return { ok: true };
  });
  app.get('/chat/vapid-public-key', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    return { key: process.env.VAPID_PUBLIC_KEY };
  });

  app.get('/chat/test-push', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const { to } = request.query;
    const info = {
      webPushSubs: pushSubs.size, webPushUsers: [...pushSubs.keys()],
      vapidConfigured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    };
    if (to && pushSubs.has(to)) {
      try {
        await webpush.sendNotification(
          pushSubs.get(to),
          JSON.stringify({ title: 'Test', body: 'Notifica Web Push di test!', url: '/chat' })
        );
        info.webPushTestResult = 'sent';
      } catch (e) {
        info.webPushTestResult = 'error: ' + e.message;
      }
    } else if (to) {
      info.webPushTestResult = 'missing-subscription';
    }
    return info;
  });


  const BACKGROUNDS_DIR = path.join(process.cwd(), 'public', 'backgrounds');
  fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });

  // List available backgrounds
  app.get('/chat/backgrounds', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const files = fs.readdirSync(BACKGROUNDS_DIR)
      .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
      .map(f => ({ name: f, url: '/chat/backgrounds/' + f }));
    return files;
  });

  // Serve background images
  app.get('/chat/backgrounds/:filename', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const filename = path.basename(request.params.filename);
    const filePath = path.join(BACKGROUNDS_DIR, filename);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Not found' });
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] || 'application/octet-stream';
    return reply.type(mime).send(fs.createReadStream(filePath));
  });

  // Upload a new background (authenticated users only)
  app.post('/chat/backgrounds/upload', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const data = await request.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: 'Nessun file' });
    const ext = path.extname(data.filename).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return reply.code(400).send({ error: 'Formato non supportato' });
    const filename = Date.now() + '-bg' + ext;
    const filePath = path.join(BACKGROUNDS_DIR, filename);
    const { pipeline: pl } = require('node:stream/promises');
    await pl(data.file, fs.createWriteStream(filePath));
    return { url: '/chat/backgrounds/' + filename, name: filename };
  });

  app.get('/chat/preview', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const { url } = request.query;
    if (!url || !/^https?:\/\/.+/i.test(url)) return reply.code(400).send({ error: 'URL non valido' });
    try {
      const youtubePreview = await buildYoutubePreview(url);
      if (youtubePreview) return reply.send(youtubePreview);
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; ChatPreview/1.0)', accept: 'text/html' }, signal: AbortSignal.timeout(6000) });
      if (!(res.headers.get('content-type') || '').includes('text/html')) return reply.send({ url });
      return reply.send(normalizeFacebookPreview(extractMeta((await res.text()).slice(0, 80000), url), url));
    } catch { return reply.send({ url }); }
  });

  app.get('/chat/console', async (request, reply) => {
    return reply.redirect('/chat');
  });

  app.get('/chat/invite/:token', async (request, reply) => {
    const token = String(request.params.token || '').trim();
    if (!token) return reply.code(404).send({ error: 'Invito non trovato' });
    return reply
      .type('text/html')
      .header('X-Robots-Tag', 'noindex, nofollow')
      .header('Cache-Control', 'no-store')
      .send(fs.readFileSync(path.join(process.cwd(), 'public', 'chat-register.html'), 'utf8'));
  });

  app.get('/chat/console/data', async (request, reply) => {
    const user = requireConsoleAccess(request, reply);
    if (!user) return;

    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const disk = readDiskUsage(process.cwd());
    const online = onlineUsers();
    const chatHealth = {
      ok: true,
      usersOnline: online,
      onlineCount: online.length,
      messageCount: stmts.countMessages.get().count,
      pushSubscriptions: pushSubs.size,
      vapidConfigured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    };

    return {
      generatedAt: new Date().toISOString(),
      raspberry: {
        hostname: os.hostname(),
        platform: `${os.platform()} ${os.release()}`,
        arch: os.arch(),
        uptimeSeconds: os.uptime(),
        uptimeHuman: formatUptimeSeconds(os.uptime()),
        processUptimeSeconds: process.uptime(),
        processUptimeHuman: formatUptimeSeconds(process.uptime()),
        node: process.version,
        cpuModel: os.cpus()[0]?.model || null,
        cpuCount: os.cpus().length,
        loadAvg: os.loadavg(),
        temperatureC: readTemperatureC(),
        memory: {
          total: memTotal,
          free: memFree,
          used: memTotal - memFree,
        },
        disk,
        localIps: Object.values(os.networkInterfaces())
          .flat()
          .filter(Boolean)
          .filter((item) => item.family === 'IPv4' && !item.internal)
          .map((item) => item.address),
      },
      chat: chatHealth,
      tests: {
        authCookiePresent: !!getCookieAuth(request),
        localAccess: isLocalAccess(request),
        sqliteOk: true,
      },
    };
  });

  app.get('/chat', async (request, reply) =>
    reply.type('text/html')
      .header('Cache-Control', 'no-store')
      .send(fs.readFileSync(path.join(process.cwd(), 'public', 'chat.html'), 'utf8')));

  app.get('/chat/images/:filename', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const filename = path.basename(request.params.filename);
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Not found' });
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] || 'application/octet-stream';
    return reply.type(mime).send(fs.createReadStream(filePath));
  });

  app.post('/chat/upload', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const data = await request.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: 'Nessun file' });
    const ext = path.extname(data.filename).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return reply.code(400).send({ error: 'Formato non supportato' });
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    await pipeline(data.file, fs.createWriteStream(path.join(UPLOADS_DIR, filename)));
    return { url: `/chat/images/${filename}` };
  });

  app.get('/chat/ws', { websocket: true }, (socket) => {
    const id = crypto.randomUUID();
    clients.set(id, { ws: socket, username: null, roomId: null });

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const client = clients.get(id);

      if (msg.type === 'join') {
        const username = normalizeUsername(msg.username);
        if (!username) return;
        if (!validateToken(username, msg.token)) {
          socket.send(JSON.stringify({ type: 'auth_error' }));
          socket.close();
          return;
        }
        const roomId = String(msg.roomId || '').trim() || DEFAULT_ROOM_ID;
        const room = stmts.getRoomById.get(roomId);
        const membership = room ? stmts.getRoomMember.get(roomId, username) : null;
        if (!room || !membership) {
          socket.send(JSON.stringify({ type: 'room_error' }));
          socket.close();
          return;
        }
        const previousRoomId = client.roomId;
        client.username = username;
        client.roomId = roomId;
        socket.send(JSON.stringify({
          type: 'history',
          roomId,
          roomName: room.name,
          messages: loadHistory(roomId),
        }));
        if (previousRoomId && previousRoomId !== roomId) broadcastOnline(previousRoomId);
        broadcastOnline(roomId);
        return;
      }

      if (!client?.username) return;

      if (msg.type === 'read') {
        const ids = Array.isArray(msg.ids) ? msg.ids : [];
        const insertMany = db.transaction((ids, username) => {
          for (const msgId of ids) stmts.insertRead.run(msgId, username);
        });
        insertMany(ids, client.username);
        broadcastToRoom(client.roomId, { type: 'read', ids, reader: client.username, roomId: client.roomId });
        return;
      }

      if (msg.type === 'delete') {
        const msgId = msg.id ? String(msg.id).slice(0, 36) : null;
        if (!msgId) return;
        const result = stmts.deleteMessage.run(msgId, client.roomId, client.username);
        if (result.changes > 0) {
          stmts.deleteReads.run(msgId);
          broadcastToRoom(client.roomId, { type: 'deleted', id: msgId, roomId: client.roomId });
        }
        return;
      }

      if (msg.type === 'message') {
        const text = String(msg.text || '').trim().slice(0, 2000);
        const imageUrl = msg.imageUrl ? String(msg.imageUrl) : null;
        const replyToId = msg.replyToId ? String(msg.replyToId).slice(0, 36) : null;
        if (!text && !imageUrl) return;
        let replyTo = null;
        if (replyToId) {
          const replied = stmts.getById.get(replyToId, client.roomId);
          if (replied) replyTo = { id: replied.id, username: replied.username, text: replied.text || '', imageUrl: replied.imageUrl || null };
        }
        const out = { type: 'message', id: crypto.randomUUID(), roomId: client.roomId, username: client.username, text, imageUrl, timestamp: new Date().toISOString(), readBy: [], replyTo };
        stmts.insertMessage.run(out.id, out.roomId, out.username, out.text, out.imageUrl, out.timestamp, replyToId);
        broadcastToRoom(client.roomId, out);
        const roomRow = stmts.getRoomById.get(client.roomId);
        notifyUnread(client.roomId, roomRow ? roomRow.name : '', client.username);
        sendAllPush(out, client.username, client.roomId);
      }
    });

    socket.on('close', () => {
      const client = clients.get(id);
      clients.delete(id);
      if (client?.username && client.roomId) broadcastOnline(client.roomId);
    });
  });
}

module.exports = chatRoutes;
