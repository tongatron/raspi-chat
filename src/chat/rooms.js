'use strict';

// Room lifecycle around registration: creating a new member's first room and
// posting the system messages that announce it.
//
// Registration runs inside a SQLite transaction so a half-registered user — one
// that exists but belongs to no room — can never be observed.

const crypto = require('node:crypto');
const { normalizeRole, normalizeUsername, slugPart } = require('../lib/normalize');
const {
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_ROOM_ID,
  DEFAULT_ROOM_NAME,
  db,
  hashPassword,
  stmts,
} = require('./database');
const { broadcastToRoom } = require('./presence');
const { formatRow } = require('./serializers');

function buildDirectRoomId(userA, userB) {
  return ['dm', slugPart(userA), slugPart(userB)].join('-');
}

function insertSystemMessage(roomId, username, text) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  stmts.insertMessage.run(id, roomId, username, text, null, timestamp, null, 'system');
  const msg = formatRow({ id, roomId, username, text, imageUrl: null, timestamp, readBy: null, replyToId: null, kind: 'system' });
  broadcastToRoom(roomId, msg);
  return msg;
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
    stmts.createRoom.run(roomId, roomName, owner, now, 0);
  }
  stmts.addRoomMember.run(roomId, owner, owner, now);
  stmts.addRoomMember.run(roomId, username, owner, now);
  stmts.insertMessage.run(
    crypto.randomUUID(),
    roomId,
    'Raspi Chat',
    `${username} completed registration and joined the room.`,
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
  if (!invite) return { error: 'Invite not found', status: 404 };
  if (invite.usedAt) return { error: 'Invite already used', status: 410 };
  if (stmts.getUser.get(username)) return { error: 'Name already taken', status: 409 };

  const role = normalizeRole(invite.role);
  const createdBy = normalizeUsername(invite.createdBy) || DEFAULT_ADMIN_USERNAME;

  stmts.syncUser.run(username, hashPassword(password), role);
  const result = stmts.markInviteUsed.run(now, username, token);
  if (!result.changes) return { error: 'Invite no longer available', status: 409 };
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
  if (stmts.getUser.get(username)) return { error: 'Name already taken', status: 409 };
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

module.exports = {
  buildDirectRoomId,
  createInitialRoomForUser,
  insertSystemMessage,
  registerUserDirect,
  registerUserFromInvite,
};
