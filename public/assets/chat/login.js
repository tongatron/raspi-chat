'use strict';

// The login screen: the user cards, password entry, and the handover into the
// chat once a token is in hand. Also the authenticated fetch wrapper every
// other file uses to call the API.

/* global ONBOARDING_KEY, canCreateInvites:writable, canManageUsers:writable, canUseConsole:writable, clearStoredAuth, connect, currentRoomId, initPush, initScrollListener, isAdmin:writable, loadRoomsData, myName:writable, myToken:writable, renderUserRoomsMenu, resetSessionUi, roomUsersCache:writable, roomsCache:writable, selectedUsername:writable, sendLogout, setCurrentRoom, setView, ws */
/* exported backToUsers, loadLoginUsers, roomUsersCache, showOnboarding, submitUsername */

function getUserPalette(name) {
  var palettes = [
    ['#dbeafe', '#1d4ed8'],
    ['#dcfce7', '#15803d'],
    ['#fef3c7', '#b45309'],
    ['#fce7f3', '#be185d'],
    ['#ede9fe', '#6d28d9'],
    ['#e0f2fe', '#0369a1'],
    ['#f3f4f6', '#4b5563']
  ];
  var code = 0;
  for (var i = 0; i < name.length; i++) code += name.charCodeAt(i);
  return palettes[code % palettes.length];
}

function renderLoginUsers(users) {
  var list = document.getElementById('user-list');
  var empty = document.getElementById('user-list-empty');
  var manual = document.getElementById('username-form');
  list.innerHTML = '';
  if (!users.length) {
    // No cards to show: either private login is on, or this is a fresh install.
    // Either way, offer a plain username field rather than a dead end.
    empty.style.display = 'none';
    if (manual) manual.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  if (manual) manual.style.display = 'none';
  users.forEach(function(user) {
    var palette = getUserPalette(user.username);
    var btn = document.createElement('button');
    btn.className = 'user-btn';
    btn.type = 'button';
    btn.onclick = function() { selectUser(user.username); };

    var avatar = document.createElement('span');
    avatar.className = 'user-avatar';
    avatar.style.background = palette[0];
    avatar.style.color = palette[1];
    avatar.textContent = user.username.slice(0, 1).toUpperCase();
    btn.appendChild(avatar);

    var copy = document.createElement('span');
    copy.className = 'user-btn-copy';
    var head = document.createElement('span');
    head.className = 'user-btn-head';
    var name = document.createElement('span');
    name.textContent = user.username;
    head.appendChild(name);
    if (user.role === 'admin' || user.role === 'superuser') {
      var badge = document.createElement('span');
      badge.className = 'user-badge admin';
      badge.textContent = user.role === 'admin' ? 'ADMIN' : 'SUPER';
      head.appendChild(badge);
    }
    copy.appendChild(head);

    var role = document.createElement('span');
    role.className = 'user-role-copy';
    role.textContent = user.role === 'admin'
      ? 'Administrator'
      : (user.role === 'superuser' ? 'Superuser' : 'User');
    copy.appendChild(role);

    btn.appendChild(copy);
    list.appendChild(btn);
  });
}

async function loadLoginUsers() {
  try {
    var res = await fetch('/chat/login-users');
    if (!res.ok) throw new Error('User list error');
    renderLoginUsers(await res.json());
  } catch (e) {
    renderLoginUsers([
      { username: 'admin', role: 'admin' },
      { username: 'Operator', role: 'superuser' },
      { username: 'guest', role: 'user' },
      { username: 'Test', role: 'user' }
    ]);
  }
}

function authHeaders(headers) {
  var out = Object.assign({}, headers || {});
  if (myName && myToken) {
    out['X-Chat-Username'] = myName;
    out['X-Chat-Token'] = myToken;
  }
  return out;
}

async function authFetch(url, options) {
  var opts = Object.assign({}, options || {});
  opts.headers = authHeaders(opts.headers);
  var res = await fetch(url, opts);
  if (res.status === 401) {
    sendLogout();
    clearStoredAuth();
    localStorage.setItem(ONBOARDING_KEY, '1');
    resetSessionUi();
    throw new Error('Unauthorized');
  }
  return res;
}

function selectUser(name) {
  var palette = getUserPalette(name);
  selectedUsername = name;
  document.getElementById('sel-avatar').textContent = name.slice(0, 1).toUpperCase();
  document.getElementById('sel-avatar').style.cssText = 'background:'+palette[0]+';color:'+palette[1]+';width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.95rem;flex-shrink:0;';
  document.getElementById('sel-name').textContent = name;
  document.getElementById('login-error').textContent = '';
  document.getElementById('pwd-input').value = '';
  document.getElementById('step-users').style.display = 'none';
  document.getElementById('step-password').style.display = 'block';
  document.getElementById('pwd-input').focus();
}
function backToUsers() {
  document.getElementById('step-password').style.display = 'none';
  document.getElementById('step-users').style.display = 'block';
  selectedUsername = null;
}

// Used by the fallback username field when no user cards are shown. Reuses the
// same password step as a card click, so the rest of the flow is identical.
function submitUsername() {
  var input = document.getElementById('username-input');
  var name = (input.value || '').trim().slice(0, 30);
  if (name) selectUser(name);
  return false;
}
async function submitLogin() {
  var password = document.getElementById('pwd-input').value;
  if (!password) return;
  var btn = document.getElementById('login-submit');
  btn.disabled = true; btn.textContent = '...';
  document.getElementById('login-error').textContent = '';
  try {
    var res = await fetch('/chat/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username: selectedUsername, password: password }) });
    if (res.ok) {
      var data = await res.json();
      localStorage.setItem('chat-user', selectedUsername);
      localStorage.setItem('chat-token', data.token);
      await joinAs(selectedUsername, data.token);
    } else {
      document.getElementById('login-error').textContent = 'Wrong password';
      document.getElementById('pwd-input').value = '';
      document.getElementById('pwd-input').focus();
    }
  } catch(e) { document.getElementById('login-error').textContent = 'Network error'; }
  btn.disabled = false; btn.textContent = 'Sign in';
}
document.getElementById('pwd-input').onkeydown = function(e) { if (e.key === 'Enter') submitLogin(); };

async function joinAs(name, token) {
  myName = name; myToken = token;
  var session = await (await authFetch('/chat/me')).json();
  isAdmin = !!session.isAdmin;
  canManageUsers = !!session.canManageUsers;
  canCreateInvites = !!session.canCreateInvites;
  canUseConsole = !!session.canUseConsole;
  roomsCache = session.rooms || [];
  roomUsersCache = [];
  var initialRoom = roomsCache.find(function(room) { return room.id === currentRoomId; }) || roomsCache[0] || null;
  setCurrentRoom(initialRoom ? initialRoom.id : '', initialRoom ? initialRoom.name : 'Chat');
  document.getElementById('login').style.display = 'none';
  await enterChatApp();
}

function showOnboarding() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('chat').style.display = 'none';
  document.getElementById('onboarding').style.display = 'flex';
  document.getElementById('onboarding-home-url').textContent = location.origin + '/';
  document.getElementById('onboarding-chat-url').textContent = location.origin + '/chat';
}

async function enterChatApp() {
  document.getElementById('onboarding').style.display = 'none';
  document.getElementById('chat').style.display = 'flex';
  document.querySelectorAll('#settings-menu .manage-users-only').forEach(function(el) {
    el.style.display = canManageUsers ? '' : 'none';
  });
  document.querySelectorAll('#settings-menu .console-access-only').forEach(function(el) {
    el.style.display = canUseConsole ? '' : 'none';
  });
  document.querySelectorAll('#settings-menu .admin-access-only').forEach(function(el) {
    el.style.display = (canManageUsers || canCreateInvites || canUseConsole) ? '' : 'none';
  });
  document.querySelectorAll('#settings-menu .strict-admin-only').forEach(function(el) {
    el.style.display = isAdmin ? '' : 'none';
  });
  var adminMenuBtn = document.getElementById('admin-menu-btn');
  if (adminMenuBtn) adminMenuBtn.textContent = canManageUsers ? 'Users' : 'Invites';
  document.querySelectorAll('.manage-users-only').forEach(function(el) {
    el.style.display = canManageUsers ? '' : 'none';
  });
  var adminInviteCopy = document.getElementById('admin-invite-copy');
  if (adminInviteCopy) {
    adminInviteCopy.textContent = canManageUsers
      ? 'Create a one-time link with a random address. Whoever opens it can register with a name and password.'
      : 'Create a one-time link to invite a new user without opening full user management.';
  }
  document.getElementById('user-rooms-wrap').style.display = 'inline-block';
  renderUserRoomsMenu();
  renderUserRoomsMenu();
  initScrollListener();
  setView('chat');
  if (canManageUsers) await loadRoomsData();
  if (!ws || ws.readyState > 1) connect();
  setTimeout(initPush, 2000);
}
