'use strict';

// Database rows in, API/WebSocket payloads out.
//
// Every message, room, user and invite the client sees is shaped here, so the
// REST responses and the WebSocket frames cannot drift apart.

const { normalizeRoomName, normalizeRole, normalizeUsername } = require('../lib/normalize');
const { stmts } = require('./database');

function formatRow(row, favoriteIds) {
  return {
    type: 'message',
    id: row.id,
    roomId: row.roomId,
    username: row.username,
    text: row.text || '',
    imageUrl: row.imageUrl || null,
    timestamp: row.timestamp,
    kind: row.kind || 'text',
    readBy: row.readBy ? row.readBy.split(',') : [],
    favorite: favoriteIds ? favoriteIds.has(row.id) : false,
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
    isPublic: !!row.isPublic,
    joined: currentUsername ? members.includes(currentUsername) : false,
  };
}

function loadRoomsForUser(username) {
  return stmts.listRoomsForUser.all(username).map((row) => formatRoom(row, username));
}

function favoriteIdSet(username) {
  return new Set(stmts.listFavoriteIdsForUser.all(username).map((r) => r.messageId));
}

function loadHistory(roomId, username) {
  const favoriteIds = favoriteIdSet(username);
  return stmts.getHistory.all(roomId).reverse().map((row) => formatRow(row, favoriteIds));
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

module.exports = {
  favoriteIdSet,
  formatInvite,
  formatRoom,
  formatRow,
  formatUser,
  loadHistory,
  loadRoomsForUser,
};
