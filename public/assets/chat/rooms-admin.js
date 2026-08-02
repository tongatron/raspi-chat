'use strict';

// Room management for owners: create, rename, delete, and invite or remove
// members.

/* global authFetch, connect, currentRoomId, getCurrentRoom, hasMore:writable, isAdmin, loadingMore:writable, msgElements:writable, myName, myToken, oldestTimestamp:writable, renderUserRoomsMenu, roomUsersCache:writable, roomsCache:writable, setCurrentRoom, setView, ws:writable */
/* exported createRoom, deleteRoom, hasMore, inviteUsersToRoom, loadingMore, msgElements, oldestTimestamp, removeUsersFromRoom, renameRoom */

function renderRoomMemberOptions(targetId, users, selectedNames) {
  var target = document.getElementById(targetId);
  target.innerHTML = '';
  var selectedSet = new Set(selectedNames || []);
  var options = (users || []).filter(function(user) { return user.username !== myName; });
  if (!options.length) {
    var empty = document.createElement('div');
    empty.className = 'rooms-empty';
    empty.textContent = 'No other users available.';
    target.appendChild(empty);
    return;
  }
  options.forEach(function(user) {
    var label = document.createElement('label');
    label.className = 'room-member-option';
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = user.username;
    checkbox.checked = selectedSet.has(user.username);
    label.appendChild(checkbox);
    var text = document.createElement('span');
    text.textContent = user.username + (
      user.role === 'admin' ? ' • admin' :
      (user.role === 'superuser' ? ' • superuser' : '')
    );
    label.appendChild(text);
    target.appendChild(label);
  });
}

function getCheckedUsernames(targetId) {
  return Array.from(document.querySelectorAll('#' + targetId + ' input[type="checkbox"]:checked'))
    .map(function(input) { return input.value; });
}

function renderRooms(rooms, users) {
  roomsCache = rooms || [];
  roomUsersCache = users || roomUsersCache;
  var list = document.getElementById('rooms-list-body');
  var status = document.getElementById('rooms-status');
  var activeRoomNameInput = document.getElementById('room-active-name-input');
  list.innerHTML = '';
  if (!roomsCache.length) {
    var empty = document.createElement('div');
    empty.className = 'rooms-empty';
    empty.textContent = 'No rooms available.';
    list.appendChild(empty);
  } else {
    roomsCache.forEach(function(room) {
      var item = document.createElement('div');
      item.className = 'room-item' + (room.id === currentRoomId ? ' active' : '');

      var main = document.createElement('div');
      main.className = 'room-item-main';
      main.onclick = function() { selectRoom(room.id, false); };
      var state = document.createElement('div');
      state.className = 'room-item-state';
      state.textContent = room.id === currentRoomId ? 'Active room' : 'Room';
      main.appendChild(state);
      var name = document.createElement('div');
      name.className = 'room-item-name';
      name.textContent = room.name;
      main.appendChild(name);
      var meta = document.createElement('div');
      meta.className = 'room-item-meta';
      meta.textContent = room.members.join(', ') || 'Only you';
      main.appendChild(meta);
      item.appendChild(main);

      var openBtn = document.createElement('button');
      openBtn.className = 'room-open-btn';
      openBtn.type = 'button';
      openBtn.textContent = room.id === currentRoomId ? 'Active' : 'Open';
      openBtn.onclick = function(event) {
        event.stopPropagation();
        openRoom(room.id, false);
      };
      item.appendChild(openBtn);
      list.appendChild(item);
    });
  }

  var activeRoom = getCurrentRoom();
  renderRoomMemberOptions('room-create-members', roomUsersCache, []);
  renderRoomMemberOptions('room-invite-members', roomUsersCache.filter(function(user) {
    return !activeRoom || activeRoom.members.indexOf(user.username) === -1;
  }), []);
  renderRoomMemberOptions('room-remove-members', roomUsersCache.filter(function(user) {
    return activeRoom && activeRoom.members.indexOf(user.username) !== -1 && user.username !== myName && user.username !== activeRoom.createdBy;
  }), []);
  activeRoomNameInput.value = activeRoom ? activeRoom.name : '';
  document.getElementById('room-invite-btn').disabled = !activeRoom;
  document.getElementById('room-rename-btn').disabled = !activeRoom;
  document.getElementById('room-remove-btn').disabled = !activeRoom || !isAdmin;
  document.getElementById('room-delete-btn').disabled = !activeRoom || !isAdmin;
  document.getElementById('room-panel-title').textContent = activeRoom ? activeRoom.name : 'No room selected';
  document.getElementById('room-panel-copy').textContent = activeRoom
    ? 'You can rename the active room or manage who belongs to it.'
    : 'Open a room from the left column to edit it.';
  document.getElementById('room-invite-title').textContent = activeRoom ? ('Add to ' + activeRoom.name) : 'Add people';
  document.getElementById('room-invite-copy').textContent = activeRoom
    ? 'Add already registered users to the active room.'
    : 'Select a room first.';
  document.getElementById('room-remove-title').textContent = activeRoom ? ('Remove from ' + activeRoom.name) : 'Remove people';
  document.getElementById('room-remove-copy').textContent = activeRoom
    ? (isAdmin ? 'Select one or more users to remove from the active room.' : 'Only the admin can remove people from rooms.')
    : 'Select a room first.';
  if (status && !status.textContent) status.textContent = '';
}

async function loadRoomsData() {
  if (!myName || !myToken) return;
  var res = await authFetch('/chat/rooms');
  var data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Room error');
  if (!currentRoomId || !(data.rooms || []).some(function(room) { return room.id === currentRoomId; })) {
    var firstRoom = (data.rooms || [])[0] || null;
    setCurrentRoom(firstRoom ? firstRoom.id : '', firstRoom ? firstRoom.name : 'Chat');
  } else {
    var current = (data.rooms || []).find(function(room) { return room.id === currentRoomId; });
    if (current) setCurrentRoom(current.id, current.name);
  }
  renderRooms(data.rooms || [], data.users || []);
}

async function createRoom() {
  var name = document.getElementById('room-name-input').value.trim();
  var status = document.getElementById('rooms-status');
  if (!name) {
    status.textContent = 'Enter a room name.';
    return;
  }
  status.textContent = 'Creating room...';
  try {
    var res = await authFetch('/chat/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, members: getCheckedUsernames('room-create-members') }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Creation failed');
    document.getElementById('room-name-input').value = '';
    await loadRoomsData();
    if (data.room) openRoom(data.room.id, true);
    status.textContent = 'Room created.';
  } catch (e) {
    status.textContent = e.message || 'Room creation failed.';
  }
}

async function renameRoom() {
  var room = getCurrentRoom();
  var status = document.getElementById('rooms-status');
  var name = document.getElementById('room-active-name-input').value.trim();
  if (!room) {
    status.textContent = 'Select a room first.';
    return;
  }
  if (!name) {
    status.textContent = 'Enter a room name.';
    return;
  }
  if (name === room.name) {
    status.textContent = 'The room name is already up to date.';
    return;
  }
  status.textContent = 'Renaming room...';
  try {
    var res = await authFetch('/chat/rooms/' + encodeURIComponent(room.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Rename failed');
    await loadRoomsData();
    if (data.room) {
      setCurrentRoom(data.room.id, data.room.name);
      renderRooms(roomsCache, roomUsersCache);
    }
    status.textContent = 'Room renamed.';
  } catch (e) {
    status.textContent = e.message || 'Rename failed.';
  }
}

async function inviteUsersToRoom() {
  var room = getCurrentRoom();
  var status = document.getElementById('rooms-status');
  if (!room) {
    status.textContent = 'Select a room first.';
    return;
  }
  var members = getCheckedUsernames('room-invite-members');
  if (!members.length) {
    status.textContent = 'Select at least one user to invite.';
    return;
  }
  status.textContent = 'Inviting users...';
  try {
    var res = await authFetch('/chat/rooms/' + encodeURIComponent(room.id) + '/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: members }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Invite failed');
    await loadRoomsData();
    status.textContent = 'Invites sent.';
  } catch (e) {
    status.textContent = e.message || 'Invite failed.';
  }
}

async function removeUsersFromRoom() {
  var room = getCurrentRoom();
  var status = document.getElementById('rooms-status');
  if (!room) {
    status.textContent = 'Select a room first.';
    return;
  }
  if (!isAdmin) {
    status.textContent = 'Only the admin can remove people from rooms.';
    return;
  }
  var members = getCheckedUsernames('room-remove-members');
  if (!members.length) {
    status.textContent = 'Select at least one user to remove.';
    return;
  }
  status.textContent = 'Removing users...';
  try {
    for (var i = 0; i < members.length; i++) {
      var res = await authFetch('/chat/rooms/' + encodeURIComponent(room.id) + '/members/' + encodeURIComponent(members[i]), {
        method: 'DELETE'
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Removal failed');
    }
    await loadRoomsData();
    status.textContent = 'Users removed from the room.';
  } catch (e) {
    status.textContent = e.message || 'Removal failed.';
  }
}

async function deleteRoom() {
  var room = getCurrentRoom();
  if (!room) return;
  if (!confirm('Delete the room "' + room.name + '" and all its messages?')) return;
  var status = document.getElementById('rooms-status');
  try {
    var res = await authFetch('/chat/rooms/' + encodeURIComponent(room.id), { method: 'DELETE' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Deletion failed');
    roomsCache = data.rooms || [];
    var first = roomsCache[0];
    if (first) { setCurrentRoom(first.id, first.name); } else { setCurrentRoom('', 'Chat'); }
    renderRooms(roomsCache, data.users || roomUsersCache);
    renderUserRoomsMenu();
    status.textContent = 'Room deleted.';
  } catch (e) {
    status.textContent = e.message || 'Deletion failed.';
  }
}

function selectRoom(roomId, fromFreshData) {
  var room = roomsCache.find(function(entry) { return entry.id === roomId; });
  if (!room) return;
  setCurrentRoom(room.id, room.name);
  renderRooms(roomsCache, roomUsersCache);
  if (!fromFreshData) document.getElementById('rooms-status').textContent = 'Active room: ' + room.name;
  oldestTimestamp = null;
  hasMore = true;
  loadingMore = false;
  document.getElementById('messages').innerHTML = '<div id="typing-indicator"></div>';
  msgElements = {};
  if (ws && ws.readyState <= 1) {
    try { ws.onclose = null; ws.close(); } catch (e) {}
    ws = null;
    connect();
  } else {
    connect();
  }
}

function openRoom(roomId, fromFreshData) {
  selectRoom(roomId, fromFreshData);
  setView('chat');
}
