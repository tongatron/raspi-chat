'use strict';

// Switching between the chat and the secondary views (media gallery,
// favourites), and the rendering each of them needs.

/* global authFetch, canCreateInvites, canManageUsers, canUseConsole, currentRoomId, currentRoomName, currentView:writable, hasMore, isAdmin, loadMoreMessages, loadStats, maskSpoilers, msgElements, openLightbox, parseGeoText, scrollToMessage, startConsoleAutoRefresh, stopConsoleAutoRefresh */
/* exported currentView, formatBytes */

function setView(view) {
  var nextView = 'chat';
  if (view === 'rooms' && canManageUsers) nextView = 'rooms';
  if (view === 'console' && canUseConsole) nextView = 'console';
  if (view === 'admin' && (canManageUsers || canCreateInvites)) nextView = 'admin';
  if (view === 'tools' && isAdmin) nextView = 'tools';
  if (view === 'stats' && canUseConsole) nextView = 'stats';
  if (view === 'media' && currentRoomId) nextView = 'media';
  if (view === 'favorites' && currentRoomId) nextView = 'favorites';
  if (nextView !== 'console') stopConsoleAutoRefresh();
  currentView = nextView;
  document.body.classList.toggle('subpage-view', nextView !== 'chat');
  document.getElementById('chat-main-view').style.display = nextView === 'chat' ? 'contents' : 'none';
  document.getElementById('rooms-view').style.display = nextView === 'rooms' ? 'flex' : 'none';
  document.getElementById('console-view').style.display = nextView === 'console' ? 'flex' : 'none';
  document.getElementById('admin-view').style.display = nextView === 'admin' ? 'flex' : 'none';
  document.getElementById('tools-view').style.display = nextView === 'tools' ? 'flex' : 'none';
  document.getElementById('stats-view').style.display = nextView === 'stats' ? 'flex' : 'none';
  document.getElementById('media-view').style.display = nextView === 'media' ? 'flex' : 'none';
  document.getElementById('favorites-view').style.display = nextView === 'favorites' ? 'flex' : 'none';
  var consoleBtn = document.getElementById('console-btn');
  if (consoleBtn) {
    consoleBtn.classList.toggle('active', nextView === 'console');
    consoleBtn.textContent = 'Console';
  }
  var roomsBtn = document.getElementById('rooms-btn');
  if (roomsBtn) {
    roomsBtn.classList.toggle('active', nextView === 'rooms');
    roomsBtn.textContent = 'Rooms';
  }
  if (nextView === 'console') startConsoleAutoRefresh();
  if (nextView === 'stats') loadStats();
  if (nextView === 'media') loadMedia();
  if (nextView === 'favorites') loadFavorites();
}

var mediaItems = [];
async function loadMedia() {
  var titleEl = document.getElementById('media-title');
  var statusEl = document.getElementById('media-status');
  var gridEl = document.getElementById('media-grid');
  if (titleEl) titleEl.textContent = 'Media • ' + (currentRoomName || 'Chat');
  statusEl.style.display = '';
  statusEl.textContent = 'Loading…';
  gridEl.hidden = true;
  try {
    var res = await authFetch('/chat/media?roomId=' + encodeURIComponent(currentRoomId));
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    mediaItems = data.images || [];
    populateMediaFilter();
    renderMedia();
  } catch (e) {
    statusEl.textContent = 'Failed to load media: ' + e.message;
    gridEl.hidden = true;
  }
}

async function loadFavorites() {
  var titleEl = document.getElementById('favorites-title');
  var statusEl = document.getElementById('favorites-status');
  var listEl = document.getElementById('favorites-list');
  if (titleEl) titleEl.textContent = 'Favorites • ' + (currentRoomName || 'Chat');
  statusEl.style.display = '';
  statusEl.textContent = 'Loading…';
  listEl.hidden = true;
  try {
    var res = await authFetch('/chat/favorites?roomId=' + encodeURIComponent(currentRoomId));
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    var messages = data.messages || [];
    if (!messages.length) {
      statusEl.textContent = 'No favorite messages yet in this room.';
      listEl.hidden = true;
      return;
    }
    listEl.innerHTML = '';
    messages.forEach(function(m) {
      var item = document.createElement('div'); item.className = 'favorites-item';
      var name = document.createElement('div'); name.className = 'favorites-item-name'; name.textContent = m.username;
      var text = document.createElement('div'); text.className = 'favorites-item-text';
      var geo = m.text ? parseGeoText(m.text) : null;
      text.textContent = geo ? '📍 Location' : ((m.imageUrl && !m.text) ? '📎 Image' : maskSpoilers(m.text));
      item.appendChild(name); item.appendChild(text);
      item.onclick = function() { setView('chat'); scrollToMessageOrLoad(m.id); };
      listEl.appendChild(item);
    });
    statusEl.style.display = 'none';
    listEl.hidden = false;
  } catch (e) {
    statusEl.textContent = 'Failed to load favorites: ' + e.message;
    listEl.hidden = true;
  }
}

// Scrolls to the message if it is already loaded, otherwise keeps loading older
// pages until it turns up (capped at 20 pages so this cannot loop forever).
async function scrollToMessageOrLoad(id) {
  if (msgElements[id]) { scrollToMessage(id); return; }
  var attempts = 0;
  while (!msgElements[id] && hasMore && attempts < 20) {
    await loadMoreMessages();
    attempts++;
  }
  if (msgElements[id]) scrollToMessage(id);
}

function populateMediaFilter() {
  var select = document.getElementById('media-filter-select');
  var prev = select.value;
  var users = [];
  mediaItems.forEach(function(it) { if (users.indexOf(it.username) === -1) users.push(it.username); });
  users.sort(function(a, b) { return a.localeCompare(b); });
  select.innerHTML = '<option value="__all__">From everyone</option>';
  users.forEach(function(u) {
    var opt = document.createElement('option');
    opt.value = u; opt.textContent = 'From ' + u;
    select.appendChild(opt);
  });
  select.value = users.indexOf(prev) !== -1 ? prev : '__all__';
}

function renderMedia() {
  var statusEl = document.getElementById('media-status');
  var gridEl = document.getElementById('media-grid');
  var filter = document.getElementById('media-filter-select').value;
  var items = filter === '__all__' ? mediaItems : mediaItems.filter(function(it) { return it.username === filter; });
  gridEl.innerHTML = '';
  if (!items.length) {
    statusEl.style.display = '';
    statusEl.textContent = mediaItems.length ? 'No images for this filter.' : 'No images shared in this room.';
    gridEl.hidden = true;
    return;
  }
  statusEl.style.display = 'none';
  gridEl.hidden = false;
  items.forEach(function(it) {
    var cell = document.createElement('div');
    cell.className = 'media-cell';
    cell.onclick = function() { openLightbox(it.imageUrl); };
    var img = document.createElement('img');
    img.src = it.imageUrl; img.loading = 'lazy'; img.alt = '';
    img.onerror = function() { cell.remove(); };
    cell.appendChild(img);
    var who = document.createElement('span');
    who.className = 'media-who';
    who.textContent = it.username;
    cell.appendChild(who);
    gridEl.appendChild(cell);
  });
}

document.getElementById('media-filter-select').onchange = renderMedia;

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var value = bytes;
  var idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value = value / 1024;
    idx++;
  }
  var fixed = value >= 10 || idx === 0 ? 0 : 1;
  return value.toFixed(fixed) + ' ' + units[idx];
}
