'use strict';

// The admin area: user management, invite links, and the server console with
// its live charts.

/* global adminUsersCache:writable, adminUsersLoading:writable, authFetch, canCreateInvites, canManageUsers, canUseConsole, consoleAutoRefresh:writable, consoleHistory, consoleLoading:writable, currentView, formatBytes, latestInviteUrl:writable, loadLoginUsers, myName, selectedAdminUsername:writable */
/* exported copyInviteLink, createInvite, loadAdminUsers, saveAdminUser,
           startConsoleAutoRefresh */

function renderAdminUsers(users, currentUsername) {
  var list = document.getElementById('admin-user-list');
  list.innerHTML = '';
  if (!users.length) {
    var empty = document.createElement('div');
    empty.className = 'admin-empty';
    empty.textContent = 'No users found.';
    list.appendChild(empty);
    return;
  }

  users.forEach(function(user) {
    var item = document.createElement('div');
    item.className = 'admin-user';
    if (selectedAdminUsername && user.username === selectedAdminUsername) item.classList.add('selected');

    var main = document.createElement('div');
    main.className = 'admin-user-main';
    var name = document.createElement('div');
    name.className = 'admin-user-name';
    name.textContent = user.username;
    main.appendChild(name);

    var meta = document.createElement('div');
    meta.className = 'admin-user-meta';
    meta.textContent = formatRoleLabel(user.role) + (user.username === currentUsername ? ' • you' : '');
    main.appendChild(meta);
    item.appendChild(main);

    var badge = document.createElement('span');
    badge.className = 'user-badge' + ((user.role === 'admin' || user.role === 'superuser') ? ' admin' : '');
    badge.textContent = user.role === 'superuser' ? 'SUPER' : user.role.toUpperCase();
    var actions = document.createElement('div');
    actions.className = 'admin-user-actions';

    var editBtn = document.createElement('button');
    editBtn.className = 'admin-user-btn';
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.onclick = function() { startAdminEdit(user); };
    actions.appendChild(editBtn);

    if (user.username !== currentUsername) {
      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'admin-user-btn danger';
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Delete';
      deleteBtn.onclick = function() { deleteAdminUser(user.username); };
      actions.appendChild(deleteBtn);
    }

    actions.appendChild(badge);
    item.appendChild(actions);

    list.appendChild(item);
  });
}

function formatRoleLabel(role) {
  if (role === 'admin') return 'administrator';
  if (role === 'superuser') return 'superuser';
  return 'user';
}

function resetAdminForm() {
  selectedAdminUsername = '';
  document.getElementById('admin-form-title').textContent = 'Create or edit user';
  document.getElementById('admin-form-copy').textContent = 'To update an existing user, use the same username. Leave the password empty to keep it unchanged.';
  document.getElementById('admin-username').value = '';
  document.getElementById('admin-username').readOnly = false;
  document.getElementById('admin-role').value = 'user';
  document.getElementById('admin-password').value = '';
  document.getElementById('admin-save-btn').textContent = 'Save user';
  document.getElementById('admin-delete-btn').disabled = true;
  if (adminUsersCache.length) renderAdminUsers(adminUsersCache, myName);
}

function startAdminEdit(user) {
  selectedAdminUsername = user.username;
  document.getElementById('admin-form-title').textContent = 'Edit user';
  document.getElementById('admin-form-copy').textContent = 'You are editing an existing user. The username stays fixed; leave the password empty to keep it unchanged.';
  document.getElementById('admin-username').value = user.username;
  document.getElementById('admin-username').readOnly = true;
  document.getElementById('admin-role').value = user.role;
  document.getElementById('admin-password').value = '';
  document.getElementById('admin-save-btn').textContent = 'Save changes';
  document.getElementById('admin-delete-btn').disabled = user.username === myName;
  renderAdminUsers(adminUsersCache, myName);
}

async function loadAdminUsers() {
  if (!canManageUsers || adminUsersLoading) return;
  adminUsersLoading = true;
  var status = document.getElementById('admin-status');
  try {
    var res = await authFetch('/chat/admin/users');
    if (!res.ok) throw new Error('Admin error');
    var data = await res.json();
    adminUsersCache = data.users || [];
    renderAdminUsers(adminUsersCache, data.currentUser);
    if (selectedAdminUsername) {
      var selected = adminUsersCache.find(function(user) { return user.username === selectedAdminUsername; });
      if (!selected) resetAdminForm();
    }
    status.textContent = '';
  } catch (e) {
    status.textContent = 'Unable to load users.';
  }
  adminUsersLoading = false;
}

async function saveAdminUser() {
  if (!canManageUsers) return;
  var username = document.getElementById('admin-username').value.trim();
  var role = document.getElementById('admin-role').value;
  var password = document.getElementById('admin-password').value;
  var status = document.getElementById('admin-status');
  var button = document.getElementById('admin-save-btn');
  if (!username) {
    status.textContent = 'Enter a username.';
    return;
  }
  button.disabled = true;
  status.textContent = 'Saving user...';
  try {
    var res = await authFetch('/chat/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, role: role, password: password }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save error');
    adminUsersCache = data.users || [];
    renderAdminUsers(adminUsersCache, myName);
    resetAdminForm();
    status.textContent = 'User saved.';
    loadLoginUsers();
  } catch (e) {
    status.textContent = e.message || 'Save failed.';
  } finally {
    button.disabled = false;
  }
}

async function deleteAdminUser(username) {
  if (!canManageUsers || !username) return;
  var status = document.getElementById('admin-status');
  if (!confirm('Delete user ' + username + '?')) return;
  status.textContent = 'Deleting user...';
  try {
    var res = await authFetch('/chat/admin/users/' + encodeURIComponent(username), {
      method: 'DELETE'
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Delete error');
    adminUsersCache = data.users || [];
    renderAdminUsers(adminUsersCache, myName);
    if (selectedAdminUsername === username) resetAdminForm();
    status.textContent = 'User deleted.';
    loadLoginUsers();
  } catch (e) {
    status.textContent = e.message || 'Deletion failed.';
  }
}

function formatLoadAvg(values) {
  return (values || []).map(function(v) { return Number(v || 0).toFixed(2); }).join(' • ');
}

function stopConsoleAutoRefresh() {
  if (consoleAutoRefresh) {
    clearInterval(consoleAutoRefresh);
    consoleAutoRefresh = null;
  }
}

function startConsoleAutoRefresh() {
  if (!canUseConsole || currentView !== 'console' || consoleAutoRefresh) return;
  consoleAutoRefresh = setInterval(function() {
    if (currentView !== 'console') {
      stopConsoleAutoRefresh();
      return;
    }
    loadConsoleData();
  }, 2000);
}

function pushConsolePoint(series, value) {
  if (value == null || Number.isNaN(value)) return;
  series.push({ t: Date.now(), v: value });
  while (series.length > 60) series.shift();
}

function formatChartValue(key, value) {
  if (value == null || Number.isNaN(value)) return '--';
  if (key === 'temp') return value.toFixed(1) + ' °C';
  if (key === 'load') {
    var cores = window.consoleCpuCount || 0;
    return value.toFixed(2) + (cores ? (' / ' + cores + ' core') : '');
  }
  if (key === 'ram') return value.toFixed(0) + '%';
  if (key === 'online') return String(Math.round(value));
  return String(value);
}

function renderConsoleChart(key, color) {
  var svg = document.getElementById('chart-' + key);
  if (!svg) return;
  var points = consoleHistory[key] || [];
  var currentEl = document.getElementById('chart-' + key + '-value');
  var minEl = document.getElementById('chart-' + key + '-min');
  var maxEl = document.getElementById('chart-' + key + '-max');
  if (!points.length) {
    svg.innerHTML = '';
    if (currentEl) currentEl.textContent = '--';
    if (minEl) minEl.textContent = '--';
    if (maxEl) maxEl.textContent = '--';
    return;
  }

  var width = 320;
  var height = 110;
  var padX = 8;
  var padY = 8;
  var values = points.map(function(point) { return point.v; });
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  var isFlatSeries = min === max;
  if (min === max) {
    var flatValue = min;
    if (key === 'load') {
      min = 0;
      max = Math.max(1, flatValue * 1.25);
    } else if (key === 'online') {
      min = 0;
      max = Math.max(1, flatValue);
    } else if (key === 'ram') {
      min = Math.max(0, flatValue - 5);
      max = Math.min(100, flatValue + 5);
      if (min === max) max = Math.min(100, min + 1);
    } else {
      min = flatValue - 1;
      max = flatValue + 1;
    }
  }

  function getX(index) {
    if (points.length === 1) return width / 2;
    return padX + ((width - padX * 2) * index / (points.length - 1));
  }
  function getY(value) {
    var ratio = (value - min) / (max - min);
    return height - padY - ratio * (height - padY * 2);
  }

  var polyline = points.map(function(point, index) {
    return getX(index).toFixed(1) + ',' + getY(point.v).toFixed(1);
  }).join(' ');
  var area = polyline + ' ' + getX(points.length - 1).toFixed(1) + ',' + (height - padY).toFixed(1) + ' ' + getX(0).toFixed(1) + ',' + (height - padY).toFixed(1);
  var latest = points[points.length - 1];

  svg.innerHTML =
    '<line class="grid-line" x1="' + padX + '" y1="' + (height - padY) + '" x2="' + (width - padX) + '" y2="' + (height - padY) + '"></line>' +
    '<line class="grid-line" x1="' + padX + '" y1="' + (height / 2).toFixed(1) + '" x2="' + (width - padX) + '" y2="' + (height / 2).toFixed(1) + '"></line>' +
    '<line class="grid-line" x1="' + padX + '" y1="' + padY + '" x2="' + (width - padX) + '" y2="' + padY + '"></line>' +
    '<polygon class="area" fill="' + color + '" points="' + area + '"></polygon>' +
    '<polyline class="line" stroke="' + color + '" points="' + polyline + '"></polyline>' +
    '<circle class="dot" cx="' + getX(points.length - 1).toFixed(1) + '" cy="' + getY(latest.v).toFixed(1) + '" r="4" stroke="' + color + '"></circle>';

  if (currentEl) currentEl.textContent = formatChartValue(key, latest.v);
  if (minEl) minEl.textContent = isFlatSeries ? ('steady ' + formatChartValue(key, latest.v)) : ('min ' + formatChartValue(key, min));
  if (maxEl) maxEl.textContent = isFlatSeries ? 'latest value' : ('max ' + formatChartValue(key, max));
}

function updateConsoleCharts(data) {
  pushConsolePoint(consoleHistory.temp, data.raspberry.temperatureC);
  pushConsolePoint(consoleHistory.load, data.raspberry.loadAvg && data.raspberry.loadAvg.length ? Number(data.raspberry.loadAvg[0]) : null);
  pushConsolePoint(consoleHistory.ram, data.raspberry.memory && data.raspberry.memory.total ? (data.raspberry.memory.used / data.raspberry.memory.total) * 100 : null);
  pushConsolePoint(consoleHistory.online, Number(data.chat.onlineCount || 0));
  renderConsoleChart('temp', '#ff7a59');
  renderConsoleChart('load', '#7cb6ff');
  renderConsoleChart('ram', '#8bdb81');
  renderConsoleChart('online', '#f5c94a');
}

function addConsoleStat(target, label, value) {
  var el = document.createElement('div');
  el.className = 'console-stat';
  el.innerHTML = '<div class="console-stat-label"></div><div class="console-stat-value"></div>';
  el.querySelector('.console-stat-label').textContent = label;
  el.querySelector('.console-stat-value').textContent = value;
  target.appendChild(el);
}

function addConsoleRow(target, label, value, klass) {
  var row = document.createElement('div');
  row.className = 'console-row';
  row.innerHTML = '<div class="label"></div><div class="value"></div>';
  row.querySelector('.label').textContent = label;
  row.querySelector('.value').textContent = value;
  if (klass) row.querySelector('.value').classList.add(klass);
  target.appendChild(row);
}

async function loadConsoleData() {
  if (!canUseConsole || consoleLoading) return;
  consoleLoading = true;
  var status = document.getElementById('console-status-line');
  var grid = document.getElementById('console-grid');
  status.textContent = 'Refreshing data...';
  try {
    var res = await authFetch('/chat/console/data');
    if (res.status === 403) {
      status.textContent = 'Console access denied.';
      grid.hidden = true;
      return;
    }
    if (!res.ok) throw new Error('Console unavailable');
    var data = await res.json();
    window.consoleCpuCount = Number(data.raspberry.cpuCount || 0);

    var raspberry = document.getElementById('raspberry-stats');
    var chat = document.getElementById('chat-stats');
    var tests = document.getElementById('test-list');
    var network = document.getElementById('network-list');
    raspberry.innerHTML = '';
    chat.innerHTML = '';
    tests.innerHTML = '';
    network.innerHTML = '';

    addConsoleStat(raspberry, 'Hostname', data.raspberry.hostname || 'n/a');
    addConsoleStat(raspberry, 'Uptime', data.raspberry.uptimeHuman || 'n/a');
    addConsoleStat(raspberry, 'Temperature', data.raspberry.temperatureC != null ? (data.raspberry.temperatureC.toFixed(1) + ' °C') : 'n/a');
    addConsoleStat(raspberry, 'Load avg', formatLoadAvg(data.raspberry.loadAvg));
    addConsoleStat(raspberry, 'RAM used', formatBytes(data.raspberry.memory.used) + ' / ' + formatBytes(data.raspberry.memory.total));
    addConsoleStat(raspberry, 'Disk used', data.raspberry.disk ? (formatBytes(data.raspberry.disk.used) + ' / ' + formatBytes(data.raspberry.disk.total)) : 'n/a');

    addConsoleStat(chat, 'Online users', String(data.chat.onlineCount));
    addConsoleStat(chat, 'Chat messages', String(data.chat.messageCount));
    addConsoleStat(chat, 'Web push', String(data.chat.pushSubscriptions));
    addConsoleStat(chat, 'Node', data.raspberry.node || 'n/a');

    addConsoleRow(tests, 'Auth cookie', data.tests.authCookiePresent ? 'OK' : 'Missing', data.tests.authCookiePresent ? 'console-ok' : 'console-warn');
    addConsoleRow(tests, 'SQLite', data.tests.sqliteOk ? 'OK' : 'Error', data.tests.sqliteOk ? 'console-ok' : 'console-warn');
    addConsoleRow(tests, 'Local access', data.tests.localAccess ? 'Yes' : 'No', data.tests.localAccess ? 'console-ok' : 'console-warn');
    addConsoleRow(tests, 'Push VAPID', data.chat.vapidConfigured ? 'Configured' : 'Missing', data.chat.vapidConfigured ? 'console-ok' : 'console-warn');

    addConsoleRow(network, 'Local IPs', (data.raspberry.localIps || []).join(', ') || 'n/a');
    addConsoleRow(network, 'CPU', (data.raspberry.cpuModel || 'n/a') + ' • ' + data.raspberry.cpuCount + ' core');
    addConsoleRow(network, 'Platform', data.raspberry.platform || 'n/a');
    addConsoleRow(network, 'Currently in chat', (data.chat.usersOnline || []).join(', ') || 'Nobody');

    updateConsoleCharts(data);
    status.textContent = 'Last update: ' + new Date(data.generatedAt).toLocaleString('en-GB');
    grid.hidden = false;
  } catch (e) {
    grid.hidden = true;
    status.textContent = 'Unable to load the console.';
  } finally {
    consoleLoading = false;
  }
}

function renderInvite(invite) {
  latestInviteUrl = invite && invite.url ? invite.url : '';
  document.getElementById('admin-invite-link').value = latestInviteUrl;
  document.getElementById('admin-copy-invite-btn').disabled = !latestInviteUrl;
  document.getElementById('admin-invite-meta').textContent = latestInviteUrl
    ? 'One-time invite created just now. Share it only with the right person.'
    : 'This link is meant for one use only.';
}

async function createInvite() {
  if (!canCreateInvites) return;
  var button = document.getElementById('admin-invite-btn');
  var copyBtn = document.getElementById('admin-copy-invite-btn');
  var meta = document.getElementById('admin-invite-meta');
  button.disabled = true;
  copyBtn.disabled = true;
  meta.textContent = 'Creating private link...';
  try {
    var res = await authFetch('/chat/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Invite creation error');
    renderInvite(data.invite || null);
  } catch (e) {
    meta.textContent = e.message || 'Invite creation failed.';
  } finally {
    button.disabled = false;
  }
}

async function copyInviteLink() {
  if (!latestInviteUrl) return;
  var meta = document.getElementById('admin-invite-meta');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(latestInviteUrl);
    } else {
      var input = document.getElementById('admin-invite-link');
      input.focus();
      input.select();
      document.execCommand('copy');
    }
    meta.textContent = 'Link copied.';
  } catch (e) {
    meta.textContent = 'Unable to copy the link from here.';
  }
}
