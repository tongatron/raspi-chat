'use strict';

// Authentication and authorisation for the chat.
//
// Sessions are stateless: the token is an HMAC of the username under
// TOKEN_SECRET, sent either in the `x-chat-*` headers (CLI, WebSocket) or in a
// HttpOnly cookie (browser). Nothing is stored server-side, so a token stays
// valid until TOKEN_SECRET changes.

const crypto = require('node:crypto');
const { parseCookies } = require('../lib/request');
const { normalizeRole, normalizeUsername } = require('../lib/normalize');
const { stmts } = require('./database');
const { formatRoom } = require('./serializers');

const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_COOKIE_NAME = 'chat_auth';

function canManageUsers(user) {
  return !!user && user.role === 'admin';
}

function canCreateInvites(user) {
  return !!user && (user.role === 'admin' || user.role === 'superuser');
}

function canUseConsole(user) {
  return !!user && (user.role === 'admin' || user.role === 'superuser');
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

function getCookieAuth(request) {
  const cookies = parseCookies(request);
  return decodeSessionCookie(cookies[SESSION_COOKIE_NAME]);
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
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }

  return user.username;
}

function requireAuthUser(request, reply) {
  const user = getAuthenticatedUser(request);
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  return user;
}

function requireAdmin(request, reply) {
  const user = getAuthenticatedUser(request);
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  if (!canManageUsers(user)) {
    reply.code(403).send({ error: 'Insufficient permissions' });
    return null;
  }
  return user;
}

function requireInviteAccess(request, reply) {
  const user = getAuthenticatedUser(request);
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  if (!canCreateInvites(user)) {
    reply.code(403).send({ error: 'Insufficient permissions' });
    return null;
  }
  return user;
}

function requireConsoleAccess(request, reply) {
  const user = getAuthenticatedUser(request);
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  if (!canUseConsole(user)) {
    reply.code(403).send({ error: 'Insufficient permissions' });
    return null;
  }
  return user;
}

function requireRoomMember(request, reply, roomId, user) {
  const authenticatedUser = user || requireAuthUser(request, reply);
  if (!authenticatedUser) return null;
  const room = stmts.getRoomById.get(roomId);
  if (!room) {
    reply.code(404).send({ error: 'Room not found' });
    return null;
  }
  const membership = stmts.getRoomMember.get(roomId, authenticatedUser.username);
  if (!membership) {
    reply.code(403).send({ error: 'Room access denied' });
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

module.exports = {
  SESSION_COOKIE_NAME,
  TOKEN_SECRET,
  canCreateInvites,
  canManageUsers,
  canUseConsole,
  clearSessionCookie,
  decodeSessionCookie,
  encodeSessionCookie,
  generateToken,
  getAuthenticatedUser,
  getCookieAuth,
  requireAdmin,
  requireAuth,
  requireAuthUser,
  requireConsoleAccess,
  requireInviteAccess,
  requireRoomMember,
  setSessionCookie,
  validateToken,
};
