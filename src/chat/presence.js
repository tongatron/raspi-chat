'use strict';

// Live WebSocket connections: who is connected, and how a payload reaches them.
//
// `clients` is the single source of truth for presence; there is no separate
// online table, so a dropped socket is all it takes to go offline.

const { stmts } = require('./database');

const clients   = new Map();

// recentCids: cid -> timestamp. Deduplicates client resends — after a
// reconnect the client may resend a message that was already delivered. The
// entry lets the server skip the duplicate and still reply with an ack, so the
// client can clear its outbox. Swept periodically.
const recentCids = new Map();
const CID_TTL_MS = 10 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - CID_TTL_MS;
  for (const [cid, ts] of recentCids) if (ts < cutoff) recentCids.delete(cid);
}, CID_TTL_MS).unref?.();


function broadcastToRoom(roomId, msg) {
  const raw = JSON.stringify(msg);
  for (const client of clients.values()) {
    if (client.roomId !== roomId) continue;
    if (client.ws.readyState === 1) client.ws.send(raw);
  }
}
function broadcastOnline(roomId) {
  const members = stmts.listRoomMembers.all(roomId).map(r => r.username);
  broadcastToRoom(roomId, { type: 'online', users: onlineUsers(roomId), members, roomId });
}
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

module.exports = {
  broadcastOnline,
  broadcastToRoom,
  clients,
  notifyUnread,
  onlineUsers,
  recentCids,
};
