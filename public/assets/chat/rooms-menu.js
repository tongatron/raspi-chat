'use strict';

// The room switcher: the user's own rooms, the public-room browser, and the
// dialogs for creating or joining one.

/* global authFetch, currentRoomId, myName, openRoom, roomsCache:writable, unreadRooms */
/* exported createUserRoom, sendLogout */

function renderUserRoomsMenu() {
  var wrap = document.getElementById('user-rooms-wrap');
  var menu = document.getElementById('user-rooms-menu');
  if (!wrap || !menu) return;
  wrap.style.display = 'inline-block';
  menu.classList.remove('open');
  menu.innerHTML = '';
  roomsCache.forEach(function(room) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
    var label = document.createElement('span');
    label.textContent = room.id === currentRoomId ? (room.name + ' \u2022') : room.name;
    if (room.id === currentRoomId) label.style.color = 'var(--primary)';
    btn.appendChild(label);
    if (unreadRooms[room.id]) {
      var dot = document.createElement('span');
      dot.className = 'room-unread-dot';
      btn.appendChild(dot);
    }
    btn.onclick = function(e) {
      e.stopPropagation();
      menu.classList.remove('open');
      openRoom(room.id, false);
    };
    menu.appendChild(btn);
  });
  var sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:rgba(229,239,252,.14);margin:4px 0;';
  menu.appendChild(sep);
  var newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.setAttribute('role', 'menuitem');
  newBtn.textContent = '+ New room...';
  newBtn.style.color = 'var(--primary)';
  newBtn.onclick = function(e) {
    e.stopPropagation();
    menu.classList.remove('open');
    openNewRoomDialog();
  };
  menu.appendChild(newBtn);

  var browseBtn = document.createElement('button');
  browseBtn.type = 'button';
  browseBtn.setAttribute('role', 'menuitem');
  browseBtn.textContent = '⌘ Browse public rooms...';
  browseBtn.style.color = 'var(--primary)';
  browseBtn.onclick = function(e) {
    e.stopPropagation();
    menu.classList.remove('open');
    openPublicRoomsDialog();
  };
  menu.appendChild(browseBtn);
}

async function openPublicRoomsDialog() {
  var dialog = document.getElementById('public-rooms-dialog');
  var list = document.getElementById('public-rooms-list');
  list.innerHTML = '<div style="color:var(--muted);padding:8px">Loading...</div>';
  dialog.classList.add('open');
  try {
    var res = await authFetch('/chat/public-rooms');
    var data = await res.json();
    var rooms = data.rooms || [];
    list.innerHTML = '';
    if (!rooms.length) {
      list.innerHTML = '<div style="color:var(--muted);padding:8px">No public rooms yet.</div>';
      return;
    }
    rooms.forEach(function(room) {
      var row = document.createElement('div');
      row.className = 'public-room-row';
      var label = document.createElement('span');
      label.textContent = room.name + ' (' + room.memberCount + ')';
      row.appendChild(label);
      var btn = document.createElement('button');
      btn.type = 'button';
      if (room.joined) {
        btn.textContent = 'Open';
        btn.onclick = function() {
          dialog.classList.remove('open');
          openRoom(room.id, false);
        };
      } else {
        btn.textContent = 'Join';
        btn.onclick = function() { joinPublicRoom(room.id, btn); };
      }
      row.appendChild(btn);
      list.appendChild(row);
    });
  } catch(e) {
    list.innerHTML = '<div style="color:var(--muted)">Unable to load public rooms</div>';
  }
}

async function joinPublicRoom(roomId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Joining...'; }
  try {
    var res = await authFetch('/chat/public-rooms/' + encodeURIComponent(roomId) + '/join', { method: 'POST' });
    var data = await res.json();
    if (data.ok && data.room) {
      roomsCache = data.rooms || roomsCache;
      renderUserRoomsMenu();
      document.getElementById('public-rooms-dialog').classList.remove('open');
      openRoom(data.room.id, false);
    } else {
      alert(data.error || 'Join failed');
      if (btn) { btn.disabled = false; btn.textContent = 'Join'; }
    }
  } catch(e) {
    alert('Network error');
    if (btn) { btn.disabled = false; btn.textContent = 'Join'; }
  }
}

async function openNewRoomDialog() {
  var dialog = document.getElementById('new-room-dialog');
  var usersList = document.getElementById('new-room-users');
  document.getElementById('new-room-name').value = '';
  document.getElementById('new-room-public').checked = false;
  usersList.innerHTML = '<div style="color:var(--muted);padding:8px">Loading...</div>';
  dialog.classList.add('open');
  try {
    var res = await authFetch('/chat/my-rooms');
    var data = await res.json();
    usersList.innerHTML = '';
    (data.users || []).forEach(function(u) {
      if (u.username === myName) return;
      var label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:.92rem;';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = u.username;
      cb.className = 'new-room-cb';
      label.appendChild(cb);
      label.appendChild(document.createTextNode(u.username));
      usersList.appendChild(label);
    });
  } catch(e) {
    usersList.innerHTML = '<div style="color:var(--muted)">Unable to load users</div>';
  }
}

async function createUserRoom() {
  var name = document.getElementById('new-room-name').value.trim();
  if (!name) { alert('Enter a room name'); return; }
  var members = [];
  document.querySelectorAll('.new-room-cb:checked').forEach(function(cb) { members.push(cb.value); });
  var isPublic = document.getElementById('new-room-public').checked;
  try {
    var res = await authFetch('/chat/my-rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, members: members, isPublic: isPublic })
    });
    var data = await res.json();
    if (data.ok && data.room) {
      roomsCache = data.rooms || roomsCache;
      renderUserRoomsMenu();
      document.getElementById('new-room-dialog').classList.remove('open');
      openRoom(data.room.id, false);
    } else {
      alert(data.error || 'Creation failed');
    }
  } catch(e) {
    alert('Network error');
  }
}

function sendLogout() {
  try { fetch('/chat/logout', { method: 'POST', keepalive: true }); } catch(e) {}
}
