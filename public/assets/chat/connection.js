'use strict';

// The WebSocket connection: connect, reconnect, heartbeat, and dispatch of
// every inbound frame to the right renderer.

// WebSocket
/* global WS_URL, clearStoredAuth, confirmSent, currentRoomId:writable, flushOutbox, hasMore:writable, heartbeatTimer:writable, incrementUnread, insertMessageEl, lastPong:writable, msgElements:writable, myName, myToken, oldestTimestamp:writable, playNotifSound, reconnectTimer:writable, refreshDateSeparators, renderUserRoomsMenu, scrollBottom, sendLogout, trackTimestamp, unreadRooms, updateOnline, updateUnreadBadge, ws:writable */
/* exported connect, hasMore, oldestTimestamp */

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  ws = new WebSocket(WS_URL);
  ws.onopen = function() {
    ws.send(JSON.stringify({ type: 'join', username: myName, token: myToken, roomId: currentRoomId }));
    flushOutbox();
    startHeartbeat();
  };
  ws.onmessage = function(e) { handleMsg(JSON.parse(e.data)); };
  ws.onclose = function() {
    stopHeartbeat();
    ws = null;
    if (!myName || !myToken) return;
    reconnectTimer = setTimeout(function() {
      reconnectTimer = null;
      connect();
    }, 2000);
  };
}

// Heartbeat: a zombie socket stays in state OPEN but delivers nothing. Send a
// ping periodically; if no pong arrives within the window the connection is
// dead, so close it to force a reconnect — which in turn resends whatever is
// still unconfirmed in the outbox.
function startHeartbeat() {
  stopHeartbeat();
  lastPong = Date.now();
  heartbeatTimer = setInterval(function() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastPong > 30000) {
      try { ws.close(); } catch (e) {}
      return;
    }
    try { ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
  }, 15000);
}
function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function handleMsg(msg) {
  if (msg.type === 'auth_error') {
    sendLogout();
    clearStoredAuth(); location.reload(); return;
  }
  if (msg.type === 'room_error') {
    currentRoomId = '';
    localStorage.removeItem('chat-room-id');
    location.reload();
    return;
  }
  if (msg.type === 'room_removed') {
    if (msg.roomId === currentRoomId) {
      currentRoomId = '';
      localStorage.removeItem('chat-room-id');
      location.reload();
      return;
    }
  }
  if (msg.type === 'history') {
    if (msg.roomId && msg.roomId !== currentRoomId) return;
    var containerEl = document.getElementById('messages');
    containerEl.innerHTML = '<div id="typing-indicator"></div>';
    msgElements = {};
    oldestTimestamp = null;
    hasMore = true;
    var unreadIds = [];
    msg.messages.forEach(function(m) {
      insertMessageEl(containerEl, null, m);
      trackTimestamp(m.timestamp);
      if (m.kind !== 'system' && m.username !== myName && (!m.readBy || m.readBy.indexOf(myName) === -1)) unreadIds.push(m.id);
    });
    hasMore = msg.messages.length >= 100;
    refreshDateSeparators(containerEl);
    scrollBottom();
    if (unreadIds.length && ws.readyState === 1) ws.send(JSON.stringify({ type: 'read', ids: unreadIds }));
  }
  else if (msg.type === 'online') { updateOnline(msg.users, msg.members); }
  else if (msg.type === 'ack') {
    confirmSent(msg.cid);
    return;
  }
  else if (msg.type === 'pong') {
    lastPong = Date.now();
    return;
  }
  else if (msg.type === 'message') {
    if (msg.cid && msg.username === myName) confirmSent(msg.cid);
    if (msg.id && msgElements[msg.id]) return;
    var messagesContainer = document.getElementById('messages');
    insertMessageEl(messagesContainer, null, msg);
    trackTimestamp(msg.timestamp);
    refreshDateSeparators(messagesContainer);
    scrollBottom();
    if (msg.kind !== 'system' && msg.username !== myName) {
      playNotifSound();
      if (document.hidden) incrementUnread();
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'read', ids: [msg.id] }));
    }
  }
  else if (msg.type === 'read') {
    msg.ids.forEach(function(id) {
      var entry = msgElements[id];
      if (entry && entry.statusEl) { entry.statusEl.textContent = ''; }
    });
  }
  else if (msg.type === 'unread') {
    unreadRooms[msg.roomId] = true;
    updateUnreadBadge();
    renderUserRoomsMenu();
  }
  else if (msg.type === 'favorite') {
    var favEntry = msgElements[msg.id];
    if (favEntry && favEntry.favBtn) {
      favEntry.favBtn.classList.toggle('active', !!msg.favorite);
      favEntry.favBtn.textContent = msg.favorite ? '★' : '☆';
    }
  }
  else if (msg.type === 'deleted') {
    var entry = msgElements[msg.id];
    if (entry && entry.wrap) {
      entry.wrap.style.transition = 'opacity .3s';
      entry.wrap.style.opacity = '0';
      setTimeout(function() { if (entry.wrap.parentNode) entry.wrap.parentNode.removeChild(entry.wrap); delete msgElements[msg.id]; }, 300);
    }
  }
}

