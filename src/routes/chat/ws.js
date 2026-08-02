'use strict';

// The WebSocket endpoint: join handshake, presence, message fan-out, reads,
// favourites and deletions. This is where the realtime protocol lives.

const crypto = require('node:crypto');

const { normalizeUsername } = require('../../lib/normalize');

const { DEFAULT_ROOM_ID, db, stmts } = require('../../chat/database');

const { validateToken } = require('../../chat/auth');
const { loadHistory } = require('../../chat/serializers');
const {
  broadcastOnline,
  broadcastToRoom,
  clients,
  notifyUnread,
  recentCids,
} = require('../../chat/presence');
const { sendAllPush } = require('../../chat/push');

async function websocketRoutes(app) {
  app.get('/chat/ws', { websocket: true }, (socket) => {
    const id = crypto.randomUUID();
    clients.set(id, { ws: socket, username: null, roomId: null });

    // Server-side keepalive, using protocol-level WebSocket pings. With no
    // traffic, nginx (proxy_read_timeout 60s) and Cloudflare (~100s) close the
    // idle connection: it becomes a zombie and messages are lost silently. The
    // ping keeps it alive and detects dead sockets. Browsers answer with a pong
    // on their own, so this protects old clients too.
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    const keepAlive = setInterval(() => {
      if (socket.isAlive === false) { try { socket.terminate(); } catch {} return; }
      socket.isAlive = false;
      try { socket.ping(); } catch {}
    }, 30000);
    keepAlive.unref?.();

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const client = clients.get(id);

      if (msg.type === 'ping') {
        try { socket.send(JSON.stringify({ type: 'pong' })); } catch {}
        return;
      }

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
          messages: loadHistory(roomId, username),
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
          stmts.deleteFavoritesForMessage.run(msgId);
          broadcastToRoom(client.roomId, { type: 'deleted', id: msgId, roomId: client.roomId });
        }
        return;
      }

      if (msg.type === 'favorite' || msg.type === 'unfavorite') {
        const msgId = msg.id ? String(msg.id).slice(0, 36) : null;
        if (!msgId) return;
        const favorite = msg.type === 'favorite';
        if (favorite) stmts.insertFavorite.run(msgId, client.username);
        else stmts.deleteFavorite.run(msgId, client.username);
        try { socket.send(JSON.stringify({ type: 'favorite', id: msgId, favorite })); } catch {}
        return;
      }

      if (msg.type === 'message') {
        const text = String(msg.text || '').trim().slice(0, 2000);
        const imageUrl = msg.imageUrl ? String(msg.imageUrl) : null;
        const replyToId = msg.replyToId ? String(msg.replyToId).slice(0, 36) : null;
        const cid = msg.cid ? String(msg.cid).slice(0, 64) : null;
        if (!text && !imageUrl) return;
        // A resend of a message that was already delivered (after a reconnect):
        // do not store it twice, but still ack so the client clears its outbox.
        if (cid && recentCids.has(cid)) {
          try { socket.send(JSON.stringify({ type: 'ack', cid })); } catch {}
          return;
        }
        let replyTo = null;
        if (replyToId) {
          const replied = stmts.getById.get(replyToId, client.roomId);
          if (replied) replyTo = { id: replied.id, username: replied.username, text: replied.text || '', imageUrl: replied.imageUrl || null };
        }
        const out = { type: 'message', cid, id: crypto.randomUUID(), roomId: client.roomId, username: client.username, text, imageUrl, timestamp: new Date().toISOString(), readBy: [], replyTo };
        stmts.insertMessage.run(out.id, out.roomId, out.username, out.text, out.imageUrl, out.timestamp, replyToId, 'text');
        if (cid) recentCids.set(cid, Date.now());
        broadcastToRoom(client.roomId, out);
        const roomRow = stmts.getRoomById.get(client.roomId);
        notifyUnread(client.roomId, roomRow ? roomRow.name : '', client.username);
        sendAllPush(out, client.username, client.roomId);
      }
    });

    socket.on('close', () => {
      clearInterval(keepAlive);
      const client = clients.get(id);
      clients.delete(id);
      if (client?.username && client.roomId) broadcastOnline(client.roomId);
    });
  });

}

module.exports = websocketRoutes;
