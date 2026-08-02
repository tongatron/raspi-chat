'use strict';

// Wiring: every DOM event handler that connects the markup to the functions
// above, plus the statistics view. Loaded last, when everything it references
// is already defined.

/* global ONBOARDING_KEY, authFetch, authHeaders, canCreateInvites, canManageUsers,
         canUseConsole, clearStoredAuth, copyInviteLink, createInvite, createRoom,
         currentView, deleteAdminUser, deleteRoom, inviteUsersToRoom, isAdmin,
         joinAs, loadAdminUsers, loadConsoleData, loadLoginUsers, loadRoomsData,
         onNotifBtnClick, removeUsersFromRoom, renameRoom, renderLoginUsers,
         resetAdminForm, resetSessionUi, saveAdminUser, savedToken, savedUser,
         selectedAdminUsername, sendLogout, setView, showLogin */
/* exported loadStats, openLightbox */

document.getElementById('settings-btn').onclick = function(e) {
  e.stopPropagation();
  document.getElementById('user-rooms-menu').classList.remove('open');
  var chatItem = document.querySelector('#settings-menu button[data-view="chat"]');
  if (chatItem) chatItem.style.display = (canManageUsers && currentView !== 'chat') ? '' : 'none';
  document.getElementById('settings-menu').classList.toggle('open');
};
document.getElementById('user-rooms-btn').onclick = function(e) {
  e.stopPropagation();
  document.getElementById('settings-menu').classList.remove('open');
  document.getElementById('user-rooms-menu').classList.toggle('open');
};
document.querySelectorAll('#settings-menu button[data-view]').forEach(function(btn) {
  btn.onclick = function(e) {
    e.stopPropagation();
    var view = btn.getAttribute('data-view');
    if (view === 'admin' && !(canManageUsers || canCreateInvites)) return;
    if (view === 'tools' && !isAdmin) return;
    if (view === 'console' && !canUseConsole) return;
    if (view === 'rooms' && !canManageUsers) return;
    document.getElementById('settings-menu').classList.remove('open');
    var nextView = currentView === view ? 'chat' : view;
    setView(nextView);
    if (nextView === 'console') loadConsoleData();
    else if (nextView === 'rooms') loadRoomsData();
    else if (nextView === 'admin' && canManageUsers) loadAdminUsers();
  };
});
document.addEventListener('click', function(e) {
  var settingsMenu = document.getElementById('settings-menu');
  var userRoomsMenu = document.getElementById('user-rooms-menu');
  if (e.target.closest('#settings-wrap') || e.target.closest('#user-rooms-wrap')) return;
  if (settingsMenu) settingsMenu.classList.remove('open');
  if (userRoomsMenu) userRoomsMenu.classList.remove('open');
});
document.getElementById('admin-save-btn').onclick = saveAdminUser;
document.getElementById('admin-reset-btn').onclick = resetAdminForm;
document.getElementById('admin-delete-btn').onclick = function() {
  if (selectedAdminUsername) deleteAdminUser(selectedAdminUsername);
};
document.getElementById('admin-invite-btn').onclick = createInvite;
document.getElementById('admin-copy-invite-btn').onclick = copyInviteLink;

document.getElementById('tools-test-notif-btn').onclick = function() {
  var status = document.getElementById('tools-test-notif-status');
  var win = window.open('/chat/notify-test', 'raspi-chat-notify-test', 'width=420,height=520');
  if (!win) { status.textContent = 'Popup blocked: allow popups for this site and try again.'; return; }
  status.textContent = 'Window opened — use it to send the test, then close or background this tab.';
};

document.getElementById('admin-backup-btn').onclick = function() {
  var a = document.createElement('a');
  a.href = '/chat/admin/backup';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

document.getElementById('admin-restore-input').onchange = async function() {
  var file = this.files[0];
  if (!file) return;
  var status = document.getElementById('admin-backup-status');
  if (!confirm('Are you sure? This operation overwrites all current data and restarts the server.')) {
    this.value = '';
    return;
  }
  status.textContent = 'Uploading...';
  status.style.color = 'var(--muted)';
  try {
    var buf = await file.arrayBuffer();
    var res = await authFetch('/chat/admin/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf
    });
    var data = await res.json();
    if (res.ok) {
      status.style.color = 'var(--success)';
      var secs = 6;
      function tick() {
        status.textContent = '✓ Database restored. Reloading in ' + secs + 's...';
        if (secs <= 0) { location.reload(); return; }
        secs--;
        setTimeout(tick, 1000);
      }
      tick();
    } else {
      status.textContent = '✗ ' + (data.error || 'Error');
      status.style.color = '#e53e3e';
    }
  } catch(e) {
    status.textContent = '✗ Upload error';
    status.style.color = '#e53e3e';
  }
  this.value = '';
};
document.getElementById('admin-purge-stress-btn').onclick = async function() {
  var status = document.getElementById('admin-purge-stress-status');
  if (!confirm('Delete all [stress-N] messages from every room?')) return;
  this.disabled = true;
  status.textContent = 'Deleting...';
  status.style.color = 'var(--muted)';
  try {
    var res = await authFetch('/chat/admin/purge-stress', { method: 'POST' });
    var data = await res.json();
    if (res.ok) {
      status.textContent = '✓ Deleted ' + data.deleted + ' message' + (data.deleted === 1 ? '' : 's') + '.';
      status.style.color = 'var(--success)';
    } else {
      status.textContent = '✗ ' + (data.error || 'Error');
      status.style.color = '#e53e3e';
    }
  } catch(e) {
    status.textContent = '✗ Network error';
    status.style.color = '#e53e3e';
  }
  this.disabled = false;
};

document.getElementById('admin-broadcast-btn').onclick = async function() {
  var text = document.getElementById('admin-broadcast-text').value.trim();
  var status = document.getElementById('admin-broadcast-status');
  if (!text) {
    status.textContent = 'Write a message before sending.';
    status.style.color = '#e53e3e';
    return;
  }
  this.disabled = true;
  status.textContent = 'Sending...';
  status.style.color = 'var(--muted)';
  try {
    var res = await authFetch('/chat/admin/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    var data = await res.json();
    if (res.ok) {
      status.textContent = '✓ Message sent to ' + data.rooms + ' room' + (data.rooms === 1 ? '' : 's') + '.';
      status.style.color = 'var(--success)';
      document.getElementById('admin-broadcast-text').value = '';
    } else {
      status.textContent = '✗ ' + (data.error || 'Error');
      status.style.color = '#e53e3e';
    }
  } catch(e) {
    status.textContent = '✗ Network error';
    status.style.color = '#e53e3e';
  }
  this.disabled = false;
};

document.getElementById('room-create-btn').onclick = createRoom;
document.getElementById('room-rename-btn').onclick = renameRoom;
document.getElementById('room-invite-btn').onclick = inviteUsersToRoom;
document.getElementById('room-remove-btn').onclick = removeUsersFromRoom;
document.getElementById('room-delete-btn').onclick = deleteRoom;

function openLightbox(src) { document.getElementById('lightbox-img').src = src; document.getElementById('lightbox').classList.add('open'); }
document.getElementById('lightbox').onclick = function() { document.getElementById('lightbox').classList.remove('open'); };

// ── Stats view ─────────────────────────────────────────────────────────────
function renderBarList(containerId, rows, labelKey, valKey, wide) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var max = rows.reduce(function(m, r) { return Math.max(m, r[valKey]); }, 0) || 1;
  el.innerHTML = rows.map(function(r) {
    var pct = Math.round((r[valKey] / max) * 100);
    return '<div class="stats-bar-row' + (wide ? ' wide' : '') + '">' +
      '<span class="stats-bar-label" title="' + r[labelKey] + '">' + r[labelKey] + '</span>' +
      '<div class="stats-bar-track"><div class="stats-bar-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="stats-bar-val">' + r[valKey] + '</span>' +
      '</div>';
  }).join('');
}

var DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function loadStats() {
  var statusEl = document.getElementById('stats-status-line');
  var gridEl   = document.getElementById('stats-grid');
  statusEl.textContent = 'Loading…';
  gridEl.hidden = true;
  fetch('/chat/admin/stats', { headers: authHeaders() })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(d) {
      document.getElementById('stats-total').textContent = d.total.toLocaleString();

      // Daily (last 30 days) — fill missing days with 0
      var dailyMap = {};
      (d.daily || []).forEach(function(r) { dailyMap[r.day] = r.count; });
      var dailyRows = [];
      for (var i = 29; i >= 0; i--) {
        var dt = new Date(); dt.setDate(dt.getDate() - i);
        var key = dt.toISOString().slice(0, 10);
        var label = dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
        dailyRows.push({ label: label, count: dailyMap[key] || 0 });
      }
      renderBarList('stats-daily', dailyRows, 'label', 'count', true);

      renderBarList('stats-by-user', d.byUser || [], 'username', 'count', false);

      var roomRows = (d.byRoom || []).map(function(r) {
        return { label: r.roomName || r.roomId, count: r.count };
      });
      renderBarList('stats-by-room', roomRows, 'label', 'count', false);

      var hourRows = [];
      for (var h = 0; h < 24; h++) {
        var found = (d.byHour || []).find(function(r) { return r.hour === h; });
        hourRows.push({ label: String(h).padStart(2, '0') + ':00', count: found ? found.count : 0 });
      }
      renderBarList('stats-by-hour', hourRows, 'label', 'count', true);

      var dowRows = DOW_NAMES.map(function(name, i) {
        var found = (d.byDow || []).find(function(r) { return r.dow === i; });
        return { label: name, count: found ? found.count : 0 };
      });
      renderBarList('stats-by-dow', dowRows, 'label', 'count', true);

      statusEl.textContent = '';
      gridEl.hidden = false;
    })
    .catch(function(err) {
      statusEl.textContent = 'Error loading statistics (' + err + ')';
    });
}

document.getElementById('onboarding-enter-btn').onclick = async function() {
  localStorage.setItem(ONBOARDING_KEY, '1');
  showLogin();
};

document.getElementById('notif-btn').onclick = onNotifBtnClick;

document.getElementById('logout-menu-btn').onclick = function() {
  sendLogout();
  clearStoredAuth();
  localStorage.setItem(ONBOARDING_KEY, '1');
  resetSessionUi();
};

// Boot. Runs last, once every handler above is attached: restore a stored
// session and jump straight into the chat, or fall back to the login screen.
if (savedUser && savedToken) {
  document.getElementById('login').style.display = 'none';
  document.getElementById('onboarding').style.display = 'none';
  renderLoginUsers([]);
  loadLoginUsers();
  joinAs(savedUser, savedToken);
} else {
  showLogin();
}
