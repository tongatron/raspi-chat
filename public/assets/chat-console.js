'use strict';

// raspi-chat - The admin console page.
// Extracted from public/chat-console.html.

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return 'n/a';
    var units = ['B', 'KB', 'MB', 'GB'];
    var value = bytes;
    var idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx++;
    }
    var fixed = value >= 10 || idx === 0 ? 0 : 1;
    return value.toFixed(fixed) + ' ' + units[idx];
  }

  function formatLoadAvg(values) {
    return (values || []).map(function(v) { return Number(v || 0).toFixed(2); }).join(' • ');
  }

  function addStat(target, label, value) {
    var el = document.createElement('div');
    el.className = 'stat';
    el.innerHTML = '<div class="stat-label"></div><div class="stat-value"></div>';
    el.querySelector('.stat-label').textContent = label;
    el.querySelector('.stat-value').textContent = value;
    target.appendChild(el);
  }

  function addRow(target, label, value, klass) {
    var row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<div class="label"></div><div class="value"></div>';
    row.querySelector('.label').textContent = label;
    row.querySelector('.value').textContent = value;
    if (klass) row.querySelector('.value').classList.add(klass);
    target.appendChild(row);
  }

  function authHeaders(headers) {
    var out = Object.assign({}, headers || {});
    var username = localStorage.getItem('chat-user');
    var token = localStorage.getItem('chat-token');
    if (username && token) {
      out['X-Chat-Username'] = username;
      out['X-Chat-Token'] = token;
    }
    return out;
  }

  async function loadConsole() {
    var status = document.getElementById('status-line');
    var grid = document.getElementById('console-grid');
    status.textContent = 'Refreshing data...';
    try {
      var res = await fetch('/chat/console/data', { headers: authHeaders() });
      if (res.status === 401 || res.status === 403) {
        status.textContent = 'Invalid session or access denied. Go back to chat and sign in again with an admin account.';
        grid.hidden = true;
        return;
      }
      if (!res.ok) throw new Error('Console unavailable');
      var data = await res.json();

      var raspberry = document.getElementById('raspberry-stats');
      var chat = document.getElementById('chat-stats');
      var tests = document.getElementById('test-list');
      var network = document.getElementById('network-list');
      raspberry.innerHTML = '';
      chat.innerHTML = '';
      tests.innerHTML = '';
      network.innerHTML = '';

      addStat(raspberry, 'Hostname', data.raspberry.hostname || 'n/a');
      addStat(raspberry, 'Uptime', data.raspberry.uptimeHuman || 'n/a');
      addStat(raspberry, 'Temperature', data.raspberry.temperatureC != null ? (data.raspberry.temperatureC.toFixed(1) + ' °C') : 'n/a');
      addStat(raspberry, 'Load avg', formatLoadAvg(data.raspberry.loadAvg));
      addStat(raspberry, 'RAM used', formatBytes(data.raspberry.memory.used) + ' / ' + formatBytes(data.raspberry.memory.total));
      addStat(raspberry, 'Disk used', data.raspberry.disk ? (formatBytes(data.raspberry.disk.used) + ' / ' + formatBytes(data.raspberry.disk.total)) : 'n/a');

      addStat(chat, 'Online users', String(data.chat.onlineCount));
      addStat(chat, 'Chat messages', String(data.chat.messageCount));
      addStat(chat, 'Archive items', String(data.chat.privateTransferCount));
      addStat(chat, 'Web push', String(data.chat.pushSubscriptions));
      addStat(chat, 'Node', data.raspberry.node || 'n/a');

      addRow(tests, 'Auth cookie', data.tests.authCookiePresent ? 'OK' : 'Missing', data.tests.authCookiePresent ? 'ok' : 'warn');
      addRow(tests, 'SQLite', data.tests.sqliteOk ? 'OK' : 'Error', data.tests.sqliteOk ? 'ok' : 'warn');
      addRow(tests, 'Local access', data.tests.localAccess ? 'Yes' : 'No', data.tests.localAccess ? 'ok' : 'warn');
      addRow(tests, 'Remote upload limit', data.tests.uploadRemoteLimitMb + ' MB');
      addRow(tests, 'Local upload limit', data.tests.uploadLocalLimitMb + ' MB');
      addRow(tests, 'Push VAPID', data.chat.vapidConfigured ? 'Configured' : 'Missing', data.chat.vapidConfigured ? 'ok' : 'warn');

      addRow(network, 'Local IPs', (data.raspberry.localIps || []).join(', ') || 'n/a');
      addRow(network, 'CPU', (data.raspberry.cpuModel || 'n/a') + ' • ' + data.raspberry.cpuCount + ' core');
      addRow(network, 'Platform', data.raspberry.platform || 'n/a');
      addRow(network, 'Currently in chat', (data.chat.usersOnline || []).join(', ') || 'Nobody');

      document.getElementById('details').textContent = JSON.stringify(data, null, 2);
      status.textContent = 'Last update: ' + new Date(data.generatedAt).toLocaleString('en-GB');
      grid.hidden = false;
    } catch (err) {
      grid.hidden = true;
      status.textContent = 'Unable to load the console.';
    }
  }

  document.getElementById('refresh-btn').onclick = loadConsole;
  loadConsole();
