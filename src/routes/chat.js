'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const webpush = require('web-push');
const admin = require('firebase-admin');
const Database = require('better-sqlite3');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const serviceAccountPath = path.join(process.cwd(), 'firebase-service-account.json');
if (fs.existsSync(serviceAccountPath)) {
  admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
  console.log('[FCM] Firebase Admin initialized');
} else {
  console.log('[FCM] No service account found, FCM disabled');
}

const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads');
const PRIVATE_UPLOADS_DIR = path.join(process.cwd(), 'data', 'private-transfers');
const DB_PATH = path.join(process.cwd(), 'data', 'chat.db');
const CHAT_USERS_FILE = process.env.CHAT_USERS_FILE || path.join(process.cwd(), 'config', 'chat-users.json');
const PRIVATE_TRANSFER_OWNER = normalizeUsername(process.env.PRIVATE_TRANSFER_OWNER || 'Giovanni');
const PRIVATE_TRANSFER_MAX_MB = Math.max(parseInt(process.env.PRIVATE_TRANSFER_MAX_MB || '512', 10) || 512, 50);
const PRIVATE_TRANSFER_MAX_BYTES = PRIVATE_TRANSFER_MAX_MB * 1024 * 1024;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
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
    hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS private_transfers (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT,
    size_bytes INTEGER NOT NULL,
    note TEXT,
    timestamp TEXT NOT NULL
  );
`);
// Migration: add reply_to_id if missing (existing installs)
try { db.exec('ALTER TABLE messages ADD COLUMN reply_to_id TEXT'); } catch(e) {}

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
    if (!username || !password) {
      throw new Error(`[Auth] Each user in ${CHAT_USERS_FILE} must include non-empty username and password`);
    }
    const key = username.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`[Auth] Duplicate username "${username}" in ${CHAT_USERS_FILE}`);
    }
    seen.add(key);
    users.push({ username, password });
  }

  return users;
}

const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_COOKIE_NAME = 'chat_auth';

function normalizeUsername(value) {
  return String(value || '').trim().slice(0, 30);
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
  const cookieAuth = getCookieAuth(request);
  const headerUsername = normalizeUsername(request.headers['x-chat-username']);
  const username = headerUsername || cookieAuth?.username || '';
  const headerToken = String(request.headers['x-chat-token'] || '').trim();
  const token = headerToken || cookieAuth?.token || '';
  return validateToken(username, token) ? username : null;
}

function requireAuth(request, reply) {
  const username = getAuthenticatedUsername(request);
  if (!username) {
    reply.code(401).send({ error: 'Non autorizzato' });
    return null;
  }

  return username;
}

function requirePrivateAccess(request, reply) {
  const username = requireAuth(request, reply);
  if (!username) return null;
  if (username !== PRIVATE_TRANSFER_OWNER) {
    reply.code(403).send({ error: 'Area privata non disponibile' });
    return null;
  }

  return username;
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
  SELECT m.id, m.username, m.text, m.image_url AS imageUrl, m.timestamp, m.reply_to_id AS replyToId,
         rm.username AS replyUsername, rm.text AS replyText, rm.image_url AS replyImageUrl,
         GROUP_CONCAT(r.username) AS readBy
  FROM messages m
  LEFT JOIN message_reads r ON r.message_id = m.id
  LEFT JOIN messages rm ON rm.id = m.reply_to_id
  GROUP BY m.id
`;

const stmts = {
  insertMessage: db.prepare('INSERT INTO messages (id, username, text, image_url, timestamp, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)'),
  getHistory:    db.prepare(HISTORY_SQL + ' ORDER BY m.timestamp DESC LIMIT 100'),
  getPage:       db.prepare(HISTORY_SQL + ' HAVING m.timestamp < ? ORDER BY m.timestamp DESC LIMIT ?'),
  insertRead:    db.prepare('INSERT OR IGNORE INTO message_reads (message_id, username) VALUES (?, ?)'),
  deleteMessage: db.prepare('DELETE FROM messages WHERE id = ? AND username = ?'),
  deleteReads:   db.prepare('DELETE FROM message_reads WHERE message_id = ?'),
  getUser:       db.prepare('SELECT hash FROM users WHERE username = ?'),
  getById:       db.prepare('SELECT id, username, text, image_url AS imageUrl FROM messages WHERE id = ?'),
  syncUser:      db.prepare('INSERT INTO users (username, hash) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET hash = excluded.hash'),
  countUsers:    db.prepare('SELECT COUNT(*) AS count FROM users'),
  insertPrivateTransfer: db.prepare(`
    INSERT INTO private_transfers (id, username, original_name, stored_name, mime_type, size_bytes, note, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listPrivateTransfers: db.prepare(`
    SELECT id, username, original_name AS originalName, stored_name AS storedName,
           mime_type AS mimeType, size_bytes AS sizeBytes, note, timestamp
    FROM private_transfers
    WHERE username = ?
    ORDER BY timestamp DESC
    LIMIT 200
  `),
  getPrivateTransferByStoredName: db.prepare(`
    SELECT id, username, original_name AS originalName, stored_name AS storedName,
           mime_type AS mimeType, size_bytes AS sizeBytes, note, timestamp
    FROM private_transfers
    WHERE username = ? AND stored_name = ?
  `),
};

const configuredUsers = loadConfiguredUsers();
if (configuredUsers.length) {
  const syncUsers = db.transaction((users) => {
    for (const user of users) {
      stmts.syncUser.run(user.username, hashPassword(user.password));
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

function formatRow(row) {
  return {
    type: 'message',
    id: row.id,
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

function loadHistory() {
  return stmts.getHistory.all().reverse().map(formatRow);
}

function sanitizeUploadName(filename, fallback) {
  const raw = path.basename(String(filename || fallback || 'file'));
  const cleaned = raw.replace(/[^\w.\-() ]+/g, '_').trim();
  return cleaned || fallback || 'file';
}

function formatPrivateTransfer(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.originalName,
    mimeType: row.mimeType || 'application/octet-stream',
    sizeBytes: Number(row.sizeBytes) || 0,
    note: row.note || '',
    timestamp: row.timestamp,
    downloadUrl: `/chat/private-files/${encodeURIComponent(row.storedName)}`,
  };
}

const clients   = new Map();
const pushSubs  = new Map();
const fcmTokens = new Map();

function broadcast(msg) {
  const raw = JSON.stringify(msg);
  for (const { ws } of clients.values()) {
    if (ws.readyState === 1) ws.send(raw);
  }
}
function broadcastOnline() { broadcast({ type: 'online', users: onlineUsers() }); }
function onlineUsers() { return [...new Set([...clients.values()].filter(c => c.username).map(c => c.username))]; }

async function sendWebPush(msg, senderUsername) {
  const payload = JSON.stringify({ title: msg.username, body: msg.text ? msg.text.slice(0, 100) : '📎 Immagine', url: '/chat' });
  for (const [username, sub] of pushSubs) {
    if (username === senderUsername) continue;
    try { await webpush.sendNotification(sub, payload); }
    catch (err) { if (err.statusCode === 410 || err.statusCode === 404) pushSubs.delete(username); }
  }
}
async function sendFCMPush(msg, senderUsername) {
  if (!admin.apps.length) return;
  for (const [username, token] of fcmTokens) {
    if (username === senderUsername) continue;
    try {
      await admin.messaging().send({
        token,
        data: { title: msg.username, body: msg.text ? msg.text.slice(0, 100) : '📎 Immagine' },
        android: { priority: 'high', notification: { title: msg.username, body: msg.text ? msg.text.slice(0, 100) : '📎 Immagine', channelId: 'chat_messages', sound: 'default' } }
      });
    } catch (err) {
      if (err.code === 'messaging/registration-token-not-registered') fcmTokens.delete(username);
    }
  }
}
async function sendAllPush(msg, senderUsername) {
  await Promise.all([sendWebPush(msg, senderUsername), sendFCMPush(msg, senderUsername)]);
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
  let image = og('image') || meta('twitter:image');
  if (image && image.startsWith('/')) { const base = new URL(baseUrl); image = `${base.protocol}//${base.host}${image}`; }
  const siteName = og('site_name');
  const favicon = (() => {
    const m = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/i);
    if (!m) return null;
    const href = m[1];
    if (href.startsWith('http')) return href;
    const base = new URL(baseUrl);
    return href.startsWith('/') ? `${base.protocol}//${base.host}${href}` : `${base.protocol}//${base.host}/${href}`;
  })();
  const decode = s => s ? s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : s;
  return { title: decode(title), description: decode(description), image: decode(image), siteName: decode(siteName), favicon, url: baseUrl };
}

async function chatRoutes(app) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(PRIVATE_UPLOADS_DIR, { recursive: true });

  app.get('/sw.js', async (request, reply) =>
    reply.type('application/javascript').header('Service-Worker-Allowed', '/')
      .send(fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8')));

  app.get('/chat/manifest.json', async (request, reply) =>
    reply.type('application/manifest+json').send({
      name: 'Chat Tongatron', short_name: 'Chat', description: 'Chat privata in tempo reale',
      start_url: '/chat', scope: '/', display: 'standalone', orientation: 'portrait',
      background_color: '#f0f0f0', theme_color: '#3b82f6',
      icons: [
        { src: '/chat/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/chat/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/chat/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/chat/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }));

  app.get('/chat/icon-:size.png', async (request, reply) => {
    const filePath = path.join(process.cwd(), 'public', `icon-${request.params.size}.png`);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Not found' });
    return reply.type('image/png').send(fs.createReadStream(filePath));
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
    return { token };
  });

  app.post('/chat/logout', async (request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  // Pagination endpoint
  app.get('/chat/messages', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const { before } = request.query;
    if (!before) return reply.code(400).send({ error: 'before richiesto' });
    const limit = Math.min(parseInt(request.query.limit) || 50, 100);
    const rows = stmts.getPage.all(before, limit);
    return rows.reverse().map(formatRow);
  });

  app.post('/chat/push-subscribe', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const { subscription } = request.body || {};
    if (!subscription) return reply.code(400).send({ error: 'Dati mancanti' });
    pushSubs.set(username, subscription);
    return { ok: true };
  });
  app.delete('/chat/push-unsubscribe', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    pushSubs.delete(username);
    return { ok: true };
  });
  app.get('/chat/vapid-public-key', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    return { key: process.env.VAPID_PUBLIC_KEY };
  });

  app.post('/chat/fcm-register', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const token = String(request.body?.token || '').trim();
    if (!token) return reply.code(400).send({ error: 'Dati mancanti' });
    fcmTokens.set(username, token);
    return { ok: true };
  });

  app.get('/chat/test-push', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const { to } = request.query;
    const info = {
      webPushSubs: pushSubs.size, webPushUsers: [...pushSubs.keys()],
      fcmSubs: fcmTokens.size, fcmUsers: [...fcmTokens.keys()],
      vapidConfigured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      fcmConfigured: admin.apps.length > 0,
    };
    if (to && fcmTokens.has(to)) {
      try {
        await admin.messaging().send({ token: fcmTokens.get(to), android: { priority: 'high', notification: { title: 'Test', body: 'Notifica di test!', channelId: 'chat_messages' } } });
        info.fcmTestResult = 'sent';
      } catch (e) { info.fcmTestResult = 'error: ' + e.message; }
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

  app.get('/chat/download-app', async (request, reply) => {
    const filePath = path.join(process.cwd(), 'public', 'chat-tongatron.apk');
    return reply.type('application/vnd.android.package-archive')
      .header('Content-Disposition', 'attachment; filename=ChatTongatron.apk')
      .send(fs.createReadStream(filePath));
  });

  app.get('/chat/preview', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const { url } = request.query;
    if (!url || !/^https?:\/\/.+/i.test(url)) return reply.code(400).send({ error: 'URL non valido' });
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; ChatPreview/1.0)', accept: 'text/html' }, signal: AbortSignal.timeout(6000) });
      if (!(res.headers.get('content-type') || '').includes('text/html')) return reply.send({ url });
      return reply.send(extractMeta((await res.text()).slice(0, 80000), url));
    } catch { return reply.send({ url }); }
  });

  app.get('/chat', async (request, reply) =>
    reply.type('text/html').send(fs.readFileSync(path.join(process.cwd(), 'public', 'chat.html'), 'utf8')));

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

  app.get('/chat/private-transfers', async (request, reply) => {
    const username = requirePrivateAccess(request, reply);
    if (!username) return;
    return stmts.listPrivateTransfers.all(username).map(formatPrivateTransfer);
  });

  app.get('/chat/private-files/:filename', async (request, reply) => {
    const username = requirePrivateAccess(request, reply);
    if (!username) return;
    const storedName = path.basename(String(request.params.filename || ''));
    if (!storedName) return reply.code(404).send({ error: 'Not found' });
    const entry = stmts.getPrivateTransferByStoredName.get(username, storedName);
    if (!entry) return reply.code(404).send({ error: 'Not found' });
    const filePath = path.join(PRIVATE_UPLOADS_DIR, entry.storedName);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Not found' });
    return reply
      .type(entry.mimeType || 'application/octet-stream')
      .header('Content-Length', String(entry.sizeBytes || fs.statSync(filePath).size))
      .header('Content-Disposition', `attachment; filename=${JSON.stringify(entry.originalName)}`)
      .send(fs.createReadStream(filePath));
  });

  app.post('/chat/private-transfers/upload', { bodyLimit: 1024 * 1024 * 1024 }, async (request, reply) => {
    const username = requirePrivateAccess(request, reply);
    if (!username) return;

    const maxBytes = isLocalAccess(request)
      ? 1024 * 1024 * 1024
      : Math.min(PRIVATE_TRANSFER_MAX_BYTES, 250 * 1024 * 1024);
    let note = '';
    let uploaded = null;

    try {
      for await (const part of request.parts({
        limits: { files: 1, fields: 4, fileSize: maxBytes },
      })) {
        if (part.type === 'field') {
          if (part.fieldname === 'note') note = String(part.value || '').trim().slice(0, 400);
          continue;
        }

        if (uploaded) {
          part.file.resume();
          continue;
        }

        const originalName = sanitizeUploadName(part.filename, 'file');
        const ext = path.extname(originalName).slice(0, 24);
        const storedName = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`;
        const filePath = path.join(PRIVATE_UPLOADS_DIR, storedName);

        await pipeline(part.file, fs.createWriteStream(filePath));

        if (part.file.truncated) {
          fs.rmSync(filePath, { force: true });
          return reply.code(413).send({
            error: `File troppo grande. Limite ${Math.round(maxBytes / (1024 * 1024))} MB`
          });
        }

        const stats = fs.statSync(filePath);
        uploaded = {
          originalName,
          storedName,
          mimeType: String(part.mimetype || 'application/octet-stream'),
          sizeBytes: stats.size,
        };
      }
    } catch (err) {
      app.log.error(err, 'Private transfer upload failed');
      return reply.code(500).send({ error: 'Upload non riuscito' });
    }

    if (!uploaded) return reply.code(400).send({ error: 'Nessun file' });

    const record = {
      id: crypto.randomUUID(),
      username,
      originalName: uploaded.originalName,
      storedName: uploaded.storedName,
      mimeType: uploaded.mimeType,
      sizeBytes: uploaded.sizeBytes,
      note,
      timestamp: new Date().toISOString(),
    };

    stmts.insertPrivateTransfer.run(
      record.id,
      record.username,
      record.originalName,
      record.storedName,
      record.mimeType,
      record.sizeBytes,
      record.note,
      record.timestamp
    );

    return Object.assign(formatPrivateTransfer(record), {
      maxBytes,
      isLocalAccess: isLocalAccess(request),
    });
  });

  app.get('/chat/ws', { websocket: true }, (socket) => {
    const id = crypto.randomUUID();
    clients.set(id, { ws: socket, username: null });

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
        client.username = username;
        if (msg.fcmToken) { fcmTokens.set(username, msg.fcmToken); }
        socket.send(JSON.stringify({ type: 'history', messages: loadHistory() }));
        broadcastOnline();
        return;
      }

      if (!client?.username) return;

      if (msg.type === 'typing') {
        const out = JSON.stringify({ type: 'typing', username: client.username });
        for (const [cid, c] of clients) {
          if (cid !== id && c.ws.readyState === 1) c.ws.send(out);
        }
        return;
      }

      if (msg.type === 'read') {
        const ids = Array.isArray(msg.ids) ? msg.ids : [];
        const insertMany = db.transaction((ids, username) => {
          for (const msgId of ids) stmts.insertRead.run(msgId, username);
        });
        insertMany(ids, client.username);
        broadcast({ type: 'read', ids, reader: client.username });
        return;
      }

      if (msg.type === 'delete') {
        const msgId = msg.id ? String(msg.id).slice(0, 36) : null;
        if (!msgId) return;
        const result = stmts.deleteMessage.run(msgId, client.username);
        if (result.changes > 0) {
          stmts.deleteReads.run(msgId);
          broadcast({ type: 'deleted', id: msgId });
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
          const replied = stmts.getById.get(replyToId);
          if (replied) replyTo = { id: replied.id, username: replied.username, text: replied.text || '', imageUrl: replied.imageUrl || null };
        }
        const out = { type: 'message', id: crypto.randomUUID(), username: client.username, text, imageUrl, timestamp: new Date().toISOString(), readBy: [], replyTo };
        stmts.insertMessage.run(out.id, out.username, out.text, out.imageUrl, out.timestamp, replyToId);
        broadcast(out);
        sendAllPush(out, client.username);
      }
    });

    socket.on('close', () => {
      const client = clients.get(id);
      clients.delete(id);
      if (client?.username) broadcastOnline();
    });
  });
}

module.exports = chatRoutes;
