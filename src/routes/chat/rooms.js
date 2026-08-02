'use strict';

// Rooms: the ones a user belongs to, the public ones anyone may join, and the
// full create/rename/delete plus membership management for room owners.

const crypto = require('node:crypto');

const { normalizeRoomName, normalizeUsername } = require('../../lib/normalize');

const { db, stmts } = require('../../chat/database');

const { requireAdmin, requireAuthUser, requireRoomMember } = require('../../chat/auth');
const { formatRoom, formatUser, loadRoomsForUser } = require('../../chat/serializers');
const { clients } = require('../../chat/presence');
const { sendWebPushToUser } = require('../../chat/push');

const { insertSystemMessage } = require('../../chat/rooms');

async function roomRoutes(app) {
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
    if (!name) return reply.code(400).send({ error: 'Missing room name' });
    const isPublic = request.body?.isPublic === true ? 1 : 0;

    const requestedMembers = Array.isArray(request.body?.members) ? request.body.members : [];
    const memberSet = new Set([user.username]);
    for (const entry of requestedMembers) {
      const username = normalizeUsername(entry);
      if (!username) continue;
      if (!stmts.getAuthUser.get(username)) return reply.code(400).send({ error: `User not found: ${username}` });
      memberSet.add(username);
    }

    const roomId = crypto.randomBytes(8).toString('hex');
    const createdAt = new Date().toISOString();
    const createRoom = db.transaction(() => {
      stmts.createRoom.run(roomId, name, user.username, createdAt, isPublic);
      for (const username of memberSet) {
        stmts.addRoomMember.run(roomId, username, user.username, createdAt);
      }
    });
    createRoom();

    for (const username of memberSet) {
      if (username === user.username) continue;
      insertSystemMessage(roomId, username, `${username} joined the chat.`);
      await sendWebPushToUser(username, {
        title: 'Raspi Chat',
        body: `You were added to ${name}.`,
        url: '/chat',
      });
    }

    return {
      ok: true,
      room: loadRoomsForUser(user.username).find((room) => room.id === roomId) || null,
      rooms: loadRoomsForUser(user.username),
    };
  });

  app.get('/chat/public-rooms', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user) return;
    return {
      rooms: stmts.listPublicRooms.all().map((row) => formatRoom(row, user.username)),
    };
  });

  app.post('/chat/public-rooms/:roomId/join', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user) return;

    const roomId = String(request.params.roomId || '').trim();
    const room = stmts.getRoomById.get(roomId);
    if (!room || !room.isPublic) return reply.code(404).send({ error: 'Public room not found' });

    if (!stmts.getRoomMember.get(roomId, user.username)) {
      stmts.addRoomMember.run(roomId, user.username, user.username, new Date().toISOString());
      insertSystemMessage(roomId, user.username, `${user.username} joined the chat.`);
    }

    return {
      ok: true,
      room: loadRoomsForUser(user.username).find((r) => r.id === roomId) || null,
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
    if (!name) return reply.code(400).send({ error: 'Missing room name' });
    const isPublic = request.body?.isPublic === true ? 1 : 0;

    const requestedMembers = Array.isArray(request.body?.members) ? request.body.members : [];
    const memberSet = new Set([user.username]);
    for (const entry of requestedMembers) {
      const username = normalizeUsername(entry);
      if (!username) continue;
      if (!stmts.getAuthUser.get(username)) return reply.code(400).send({ error: `User not found: ${username}` });
      memberSet.add(username);
    }

    const roomId = crypto.randomBytes(8).toString('hex');
    const createdAt = new Date().toISOString();
    const createRoom = db.transaction(() => {
      stmts.createRoom.run(roomId, name, user.username, createdAt, isPublic);
      for (const username of memberSet) {
        stmts.addRoomMember.run(roomId, username, user.username, createdAt);
      }
    });
    createRoom();

    for (const username of memberSet) {
      if (username === user.username) continue;
      insertSystemMessage(roomId, username, `${username} joined the chat.`);
      await sendWebPushToUser(username, {
        title: 'Raspi Chat',
        body: `You were added to ${name}.`,
        url: '/chat',
      });
    }

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
    if (!name) return reply.code(400).send({ error: 'Missing room name' });

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
    if (!roomId) return reply.code(400).send({ error: 'Missing room ID' });

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
      if (!stmts.getAuthUser.get(username)) return reply.code(400).send({ error: `User not found: ${username}` });
      normalized.push(username);
    }

    const joinedAt = new Date().toISOString();
    for (const username of normalized) {
      stmts.addRoomMember.run(roomId, username, user.username, joinedAt);
      insertSystemMessage(roomId, username, `${username} joined the chat.`);
      await sendWebPushToUser(username, {
        title: 'Raspi Chat',
        body: `You were added to ${access.room.name}.`,
        url: '/chat',
      });
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
      return reply.code(403).send({ error: 'Only an admin can remove users from rooms' });
    }

    const roomId = String(request.params.roomId || '').trim();
    const targetUsername = normalizeUsername(request.params.username);
    const access = requireRoomMember(request, reply, roomId, user);
    if (!access) return;
    if (!targetUsername) return reply.code(400).send({ error: 'Missing user' });
    if (targetUsername === access.room.createdBy) {
      return reply.code(400).send({ error: 'You cannot remove the room creator' });
    }

    const membership = stmts.getRoomMember.get(roomId, targetUsername);
    if (!membership) return reply.code(404).send({ error: 'User is not in the room' });

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

}

module.exports = roomRoutes;
