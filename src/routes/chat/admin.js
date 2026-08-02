'use strict';

// Admin-only operations: user management, invite creation, database backup and
// restore, broadcasts, and the statistics feeding the console.

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');

const { formatUptimeSeconds } = require('../../lib/format');
const { isLocalAccess } = require('../../lib/request');
const { normalizeUsername, normalizeRole } = require('../../lib/normalize');

const { DB_PATH, db, hashPassword, stmts, validateRestorePayload } = require('../../chat/database');

const {
  getCookieAuth,
  requireAdmin,
  requireAuthUser,
  requireConsoleAccess,
  requireInviteAccess,
} = require('../../chat/auth');
const { formatInvite, formatUser } = require('../../chat/serializers');
const { broadcastToRoom, onlineUsers } = require('../../chat/presence');
const { pushSubs } = require('../../chat/push');
const { deleteSelfRoom, ensureSelfRoom } = require('../../chat/rooms');

const { readDiskUsage, readTemperatureC } = require('../../chat/system-stats');

async function adminRoutes(app) {
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

    if (!username) return reply.code(400).send({ error: 'Missing username' });
    if (!['admin', 'superuser', 'user'].includes(role)) return reply.code(400).send({ error: 'Invalid role' });

    const existing = stmts.getUser.get(username);
    if (!existing && !password) return reply.code(400).send({ error: 'Password is required for a new user' });

    if (existing && existing.role === 'admin' && role !== 'admin' && stmts.countAdmins.get().count <= 1) {
      return reply.code(400).send({ error: 'At least one admin must remain' });
    }

    const hash = password ? hashPassword(password) : existing?.hash || null;
    stmts.upsertAdminUser.run(username, hash, role);
    ensureSelfRoom(username);

    return {
      ok: true,
      users: stmts.listUsers.all().map(formatUser),
    };
  });

  app.delete('/chat/admin/users/:username', async (request, reply) => {
    const adminUser = requireAdmin(request, reply);
    if (!adminUser) return;

    const username = normalizeUsername(request.params.username);
    if (!username) return reply.code(400).send({ error: 'Missing username' });
    if (username === adminUser.username) {
      return reply.code(400).send({ error: 'You cannot delete your own user while signed in' });
    }
    const existing = stmts.getUser.get(username);
    if (!existing) return reply.code(404).send({ error: 'User not found' });
    if (normalizeRole(existing.role) === 'admin' && stmts.countAdmins.get().count <= 1) {
      return reply.code(400).send({ error: 'At least one admin must remain' });
    }

    // La stanza personale se ne va con l'utente: se domani viene creato un
    // omonimo non deve ritrovarsi gli appunti di qualcun altro.
    const removeUser = db.transaction(() => {
      deleteSelfRoom(username);
      stmts.deleteRoomMembershipsByUser.run(username);
      stmts.deleteUser.run(username);
    });
    removeUser();
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

  // ── Backup / Restore ─────────────────────────────────────────────────────
  app.get('/chat/admin/backup', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'Forbidden' });
    const date = new Date().toISOString().slice(0, 10);
    reply.header('Content-Disposition', `attachment; filename="chat-backup-${date}.db"`);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Cache-Control', 'no-store');
    return reply.send(fs.createReadStream(DB_PATH));
  });

  app.post('/chat/admin/restore', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'Forbidden' });
    const data = request.body;   // Buffer, parsed by addContentTypeParser above
    // The file must open under the current encryption settings and carry the
    // chat schema, so encrypted backups are accepted and unrecoverable ones are
    // rejected before anything is overwritten.
    const check = validateRestorePayload(data, process.env.CHAT_DB_KEY);
    if (!check.ok) return reply.code(400).send({ error: check.error });
    const backupPath = DB_PATH + '.bak';
    fs.copyFileSync(DB_PATH, backupPath);
    fs.writeFileSync(DB_PATH, data);
    // Drop the old WAL/SHM files: they reference pages that no longer exist
    // once the database file underneath has been swapped.
    for (const suffix of ['-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true });
    reply.send({ ok: true, message: 'Database restored. Restarting...' });
    setTimeout(() => process.exit(0), 500);
  });

  // ── Purge stress-test messages ───────────────────────────────────────────
  app.post('/chat/admin/purge-stress', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'Forbidden' });
    const result = db.prepare("DELETE FROM messages WHERE text LIKE '[stress-%'").run();
    return { ok: true, deleted: result.changes };
  });

  // ── Broadcast to all rooms ────────────────────────────────────────────────
  app.post('/chat/admin/broadcast', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'Forbidden' });
    const { text } = request.body || {};
    if (!text || !text.trim()) return reply.code(400).send({ error: 'Empty text' });
    const allRooms = db.prepare('SELECT id FROM rooms').all();
    const now = new Date().toISOString();
    let count = 0;
    for (const room of allRooms) {
      const out = {
        type: 'message',
        id: crypto.randomUUID(),
        roomId: room.id,
        username: user.username,
        text: text.trim(),
        imageUrl: null,
        timestamp: now,
        readBy: [],
        replyTo: null,
        broadcast: true,
      };
      stmts.insertMessage.run(out.id, out.roomId, out.username, out.text, out.imageUrl, out.timestamp, null, 'text');
      broadcastToRoom(room.id, out);
      count++;
    }
    return { ok: true, rooms: count };
  });

  app.get('/chat/admin/stats', async (request, reply) => {
    const user = requireConsoleAccess(request, reply);
    if (!user) return;

    const byUser = db.prepare(`
      SELECT username, COUNT(*) AS count FROM messages GROUP BY username ORDER BY count DESC
    `).all();

    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', timestamp, 'localtime') AS INTEGER) AS hour, COUNT(*) AS count
      FROM messages GROUP BY hour ORDER BY hour
    `).all();

    const byDow = db.prepare(`
      SELECT CAST(strftime('%w', timestamp, 'localtime') AS INTEGER) AS dow, COUNT(*) AS count
      FROM messages GROUP BY dow ORDER BY dow
    `).all();

    const byRoom = db.prepare(`
      SELECT m.room_id AS roomId, r.name AS roomName, COUNT(*) AS count
      FROM messages m LEFT JOIN rooms r ON r.id = m.room_id
      GROUP BY m.room_id ORDER BY count DESC
    `).all();

    const daily = db.prepare(`
      SELECT DATE(timestamp, 'localtime') AS day, COUNT(*) AS count
      FROM messages WHERE DATE(timestamp, 'localtime') >= DATE('now', 'localtime', '-30 days')
      GROUP BY day ORDER BY day
    `).all();

    const total = db.prepare('SELECT COUNT(*) AS count FROM messages').get().count;

    return { total, byUser, byHour, byDow, byRoom, daily };
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
      pushSubscriptions: [...pushSubs.values()].reduce((n, m) => n + m.size, 0),
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

}

module.exports = adminRoutes;
