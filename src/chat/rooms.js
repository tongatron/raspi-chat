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

// Ogni utente ha una stanza personale con un solo membro — un blocco note in cui
// mandarsi messaggi da solo. Si chiama come l'utente e non è pubblica.
const SELF_ROOM_PREFIX = 'self-';

// Due nomi diversi possono produrre lo stesso slug ("Gio." e "gio"): il secondo
// arrivato prende un id con un suffisso derivato dal nome esatto, così una
// stanza personale non finisce mai per essere condivisa fra due persone.
function selfRoomIdCandidates(username) {
  const base = SELF_ROOM_PREFIX + slugPart(username);
  const suffix = crypto.createHash('sha256').update(username).digest('hex').slice(0, 6);
  return [base, `${base}-${suffix}`];
}

function buildSelfRoomId(username) {
  return selfRoomIdCandidates(normalizeUsername(username))[0];
}

// L'id della stanza personale già esistente, o null se non c'è.
function findSelfRoomId(username) {
  const name = normalizeUsername(username);
  if (!name) return null;
  for (const roomId of selfRoomIdCandidates(name)) {
    const room = stmts.getRoomById.get(roomId);
    if (room && normalizeUsername(room.createdBy) === name) return roomId;
  }
  return null;
}

// Crea la stanza personale se manca e ci iscrive l'utente. Idempotente: viene
// richiamata alla registrazione, alla creazione da console e all'avvio.
function ensureSelfRoom(username, now) {
  const name = normalizeUsername(username);
  if (!name) return null;
  const joinedAt = now || new Date().toISOString();

  const existingId = findSelfRoomId(name);
  if (existingId) {
    stmts.addRoomMember.run(existingId, name, name, joinedAt);
    return existingId;
  }

  const [base, fallback] = selfRoomIdCandidates(name);
  const roomId = stmts.getRoomById.get(base) ? fallback : base;
  stmts.createRoom.run(roomId, name, name, joinedAt, 0);
  stmts.addRoomMember.run(roomId, name, name, joinedAt);
  return roomId;
}

// Elimina la stanza personale e i suoi messaggi: serve alla cancellazione di un
// utente, perché un omonimo creato in seguito non ne erediti gli appunti.
function deleteSelfRoom(username) {
  const roomId = findSelfRoomId(username);
  if (!roomId) return null;
  stmts.deleteRoomMessages.run(roomId);
  stmts.deleteRoomMembers.run(roomId);
  stmts.deleteRoom.run(roomId);
  return roomId;
}

// Backfill all'avvio: gli utenti già registrati prima di questa funzionalità (e
// quelli sincronizzati da config/chat-users.json) ricevono la loro stanza.
const ensureSelfRoomsForAllUsers = db.transaction(() => {
  const now = new Date().toISOString();
  let created = 0;
  for (const user of stmts.listUsers.all()) {
    if (!findSelfRoomId(user.username)) created += 1;
    ensureSelfRoom(user.username, now);
  }
  return created;
});

function insertSystemMessage(roomId, username, text) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  stmts.insertMessage.run(id, roomId, username, text, null, timestamp, null, 'system');
  const msg = formatRow({ id, roomId, username, text, imageUrl: null, timestamp, readBy: null, replyToId: null, kind: 'system' });
  broadcastToRoom(roomId, msg);
  return msg;
}

function createInitialRoomForUser(username, createdBy, now) {
  ensureSelfRoom(username, now);
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
  buildSelfRoomId,
  createInitialRoomForUser,
  deleteSelfRoom,
  ensureSelfRoom,
  ensureSelfRoomsForAllUsers,
  findSelfRoomId,
  insertSystemMessage,
  registerUserDirect,
  registerUserFromInvite,
};
