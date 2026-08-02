'use strict';

// Signing in and signing up: the login screen's user list, login/logout, the
// current session, and the two registration paths (open registration and an
// invite token).

const crypto = require('node:crypto');

const { normalizeUsername, normalizeRole } = require('../../lib/normalize');

const { DEFAULT_ROOM_ID, DEFAULT_ROOM_NAME, stmts } = require('../../chat/database');

const {
  canCreateInvites,
  canManageUsers,
  canUseConsole,
  clearSessionCookie,
  generateToken,
  requireAuthUser,
  setSessionCookie,
} = require('../../chat/auth');
const { formatInvite, formatUser, loadRoomsForUser } = require('../../chat/serializers');
const { notifyUnread } = require('../../chat/presence');
const { sendWebPushToUser } = require('../../chat/push');

const { registerUserDirect, registerUserFromInvite } = require('../../chat/rooms');

// When set, the login screen no longer advertises the account list: usernames
// and roles stay private and the client falls back to a plain username field.
// Off by default, so the clickable user cards remain the standard experience.
// See SECURITY.md.
const PRIVATE_LOGIN = /^(1|true|yes)$/i.test(String(process.env.CHAT_PRIVATE_LOGIN || ''));

async function sessionRoutes(app) {
  app.get('/chat/login-users', async () => {
    if (PRIVATE_LOGIN) return [];
    return stmts.listUsers.all().map(formatUser);
  });

  app.post('/chat/login', async (request, reply) => {
    const username = normalizeUsername(request.body?.username);
    const password = String(request.body?.password || '');
    if (!username || !password) return reply.code(400).send({ error: 'Missing credentials' });
    const user = stmts.getUser.get(username);
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });
    const [saltHex, hashHex] = user.hash.split(':');
    const inputHash  = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
    const storedHash = Buffer.from(hashHex, 'hex');
    if (!crypto.timingSafeEqual(inputHash, storedHash)) return reply.code(401).send({ error: 'Invalid credentials' });
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

  app.get('/chat/invite/:token/data', async (request, reply) => {
    const token = String(request.params.token || '').trim();
    if (!token) return reply.code(404).send({ error: 'Invite not found' });
    const invite = stmts.getInvite.get(token);
    if (!invite) return reply.code(404).send({ error: 'Invite not found' });
    if (invite.usedAt) {
      return reply.code(410).send({
        error: 'Invite already used',
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
    if (!invite) return reply.code(404).send({ error: 'Invite not found' });
    if (invite.usedAt) return reply.code(410).send({ error: 'Invite already used' });

    const username = normalizeUsername(request.body?.username);
    const password = String(request.body?.password || '');
    if (!username) return reply.code(400).send({ error: 'Missing name' });
    if (password.length < 4) return reply.code(400).send({ error: 'Password is too short' });
    const result = registerUserFromInvite({ token, username, password, now: new Date().toISOString() });
    if (!result.ok) return reply.code(result.status || 400).send({ error: result.error || 'Registration failed' });

    const tokenValue = generateToken(username);
    setSessionCookie(reply, username, tokenValue);
    if (result.firstRoomId && result.invitedBy && result.invitedBy !== username) {
      notifyUnread(result.firstRoomId, result.firstRoomName || 'New room', 'Raspi Chat');
      await sendWebPushToUser(result.invitedBy, {
        title: 'Raspi Chat',
        body: `${username} registered and joined your room.`,
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
    if (!username) return reply.code(400).send({ error: 'Missing name' });
    if (password.length < 4) return reply.code(400).send({ error: 'Password is too short' });
    const result = registerUserDirect({ username, password, now: new Date().toISOString() });
    if (!result.ok) return reply.code(result.status || 400).send({ error: result.error || 'Registration failed' });

    const tokenValue = generateToken(username);
    setSessionCookie(reply, username, tokenValue);
    if (result.firstRoomId && result.invitedBy && result.invitedBy !== username) {
      notifyUnread(result.firstRoomId, result.firstRoomName || 'New room', 'Raspi Chat');
      await sendWebPushToUser(result.invitedBy, {
        title: 'Raspi Chat',
        body: `${username} registered and joined your room.`,
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

}

module.exports = sessionRoutes;
