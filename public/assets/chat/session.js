'use strict';

// Session lifecycle: restoring a stored login, clearing it, and resetting the
// interface between the login screen and the chat.

/* global canCreateInvites:writable, canManageUsers:writable, canUseConsole:writable, currentRoomId:writable, currentRoomName:writable, isAdmin:writable, loadLoginUsers, myName:writable, myToken:writable, reconnectTimer:writable, renderLoginUsers, renderUserRoomsMenu, roomUsersCache:writable, roomsCache:writable, unreadRooms:writable, ws:writable */
/* exported canCreateInvites, canManageUsers, canUseConsole, clearStoredAuth, getCurrentRoom, isAdmin, myName, myToken, resetSessionUi, roomUsersCache, savedToken, savedUser, selectedUsername, setCurrentRoom, showLogin */

var selectedUsername = null;
var savedUser  = localStorage.getItem('chat-user');
var savedToken = localStorage.getItem('chat-token');

function clearStoredAuth() {
  localStorage.removeItem('chat-user');
  localStorage.removeItem('chat-token');
}

function resetSessionUi() {
  myName = null;
  myToken = null;
  isAdmin = false;
  canManageUsers = false;
  canCreateInvites = false;
  canUseConsole = false;
  roomsCache = [];
  roomUsersCache = [];
  currentRoomId = '';
  currentRoomName = 'Chat';
  unreadRooms = {};
  selectedUsername = null;
  if (ws) {
    try { ws.onclose = null; ws.close(); } catch (e) {}
    ws = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  document.getElementById('chat').style.display = 'none';
  document.getElementById('onboarding').style.display = 'none';
  document.getElementById('login').style.display = 'flex';
  document.getElementById('step-password').style.display = 'none';
  document.getElementById('step-users').style.display = 'block';
  document.getElementById('pwd-input').value = '';
  document.getElementById('login-error').textContent = '';
  document.querySelector('header h2').textContent = 'Chat';
  document.getElementById('online-list').innerHTML = '';
  renderLoginUsers([]);
  loadLoginUsers();
}

function showLogin() {
  document.getElementById('onboarding').style.display = 'none';
  document.getElementById('chat').style.display = 'none';
  document.getElementById('login').style.display = 'flex';
  renderLoginUsers([]);
  loadLoginUsers();
}

function setCurrentRoom(roomId, roomName) {
  currentRoomId = roomId || '';
  currentRoomName = roomName || 'Chat';
  if (currentRoomId) localStorage.setItem('chat-room-id', currentRoomId);
  delete unreadRooms[currentRoomId];
  document.querySelector('header h2').textContent = currentRoomName || 'Chat';
  renderUserRoomsMenu();
  updateUnreadBadge();
}

function updateUnreadBadge() {
  var btn = document.getElementById('user-rooms-btn');
  if (!btn) return;
  var count = Object.keys(unreadRooms).length;
  var dot = document.getElementById('rooms-unread-dot');
  if (count > 0) {
    if (!dot) {
      dot = document.createElement('span');
      dot.id = 'rooms-unread-dot';
      btn.appendChild(dot);
    }
    dot.textContent = count;
    dot.style.display = 'inline-flex';
  } else if (dot) {
    dot.style.display = 'none';
  }
}

function getCurrentRoom() {
  return roomsCache.find(function(room) { return room.id === currentRoomId; }) || null;
}
