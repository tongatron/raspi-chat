'use strict';

// raspi-chat - The guided setup wizard.
// Extracted from public/setup.html.

  'use strict';

  var state = null;
  var currentStep = 0;
  var stepLabels = [
    ['Checks', 'Verify folder, permissions, and prerequisites'],
    ['Base', 'Chat name, host, port, and network'],
    ['Users', 'Admin and first users'],
    ['Push', 'Web Push notifications'],
    ['Install', 'Summary and final write']
  ];

  function qs(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setError(message) {
    var box = qs('error-box');
    if (!message) {
      box.classList.remove('visible');
      box.textContent = '';
      return;
    }
    box.textContent = message;
    box.classList.add('visible');
  }

  function buildSteps() {
    qs('steps').innerHTML = stepLabels.map(function(step, index) {
      return '<div class="step' + (index === currentStep ? ' active' : '') + '" data-step-index="' + index + '">' +
        '<strong>' + escapeHtml(step[0]) + '</strong>' +
        '<small>' + escapeHtml(step[1]) + '</small>' +
        '</div>';
    }).join('');
    Array.from(document.querySelectorAll('.step')).forEach(function(node) {
      node.onclick = function() {
        currentStep = Number(node.dataset.stepIndex || '0');
        syncStepUi();
      };
    });
  }

  function syncStepUi() {
    buildSteps();
    Array.from(document.querySelectorAll('.section')).forEach(function(section, index) {
      section.classList.toggle('active', index === currentStep);
    });
    qs('prev-btn').disabled = currentStep === 0;
    qs('next-btn').style.visibility = currentStep >= stepLabels.length - 1 ? 'hidden' : 'visible';
    renderSummary();
    setError('');
  }

  function checkCard(label, value, ok) {
    return '<div class="card"><strong>' + escapeHtml(label) + '</strong><span class="' + (ok ? 'status-ok' : 'status-warn') + '">' + escapeHtml(value) + '</span></div>';
  }

  function renderChecks() {
    var checks = state.checks;
    qs('checks-grid').innerHTML = [
      checkCard('Node', checks.nodeVersion, true),
      checkCard('Platform', checks.platform, true),
      checkCard('Project folder', checks.cwd, true),
      checkCard('Project root writable', checks.rootWritable ? 'OK' : 'Not writable', checks.rootWritable),
      checkCard('.env file', checks.envFileExists ? 'Already present' : 'Will be created', true),
      checkCard('Users file', checks.usersFileExists ? 'Already present' : 'Will be created', true),
      checkCard('Cloudflared', checks.cloudflaredDetected ? 'Detected' : 'Not detected', checks.cloudflaredDetected),
      checkCard('Setup mode', state.setupMode ? 'Active' : 'Already completed', state.setupMode)
    ].join('');
  }

  function addUserRow(user) {
    var wrap = document.createElement('div');
    wrap.className = 'user-row';
    wrap.innerHTML =
      '<div class="cols-3">' +
        '<label>Username<input class="user-name" placeholder="User" value="' + escapeHtml(user && user.username || '') + '" /></label>' +
        '<label>Password<input class="user-pass" type="password" placeholder="password" /></label>' +
        '<label>Role<select class="user-role"><option value="user">user</option><option value="admin">admin</option></select></label>' +
        '<button class="danger remove-user" type="button">Remove</button>' +
      '</div>';
    wrap.querySelector('.user-role').value = user && user.role === 'admin' ? 'admin' : 'user';
    wrap.querySelector('.remove-user').onclick = function() { wrap.remove(); renderSummary(); };
    wrap.querySelectorAll('input,select').forEach(function(input) { input.oninput = renderSummary; input.onchange = renderSummary; });
    qs('users-list').appendChild(wrap);
  }

  function readUsers() {
    return Array.from(document.querySelectorAll('.user-row')).map(function(row) {
      return {
        username: row.querySelector('.user-name').value.trim(),
        password: row.querySelector('.user-pass').value,
        role: row.querySelector('.user-role').value
      };
    }).filter(function(user) { return user.username || user.password; });
  }

  function formData() {
    return {
      chatName: qs('chat-name').value.trim(),
      networkMode: qs('network-mode').value,
      host: qs('app-host').value.trim(),
      port: Number(qs('app-port').value || 3000),
      hostname: qs('public-hostname').value.trim(),
      adminUsername: qs('admin-username').value.trim(),
      adminPassword: qs('admin-password').value,
      enableWebPush: qs('enable-push').checked,
      vapidEmail: qs('vapid-email').value.trim(),
      users: readUsers()
    };
  }

  function validateCurrentStep() {
    var data = formData();
    if (currentStep === 1) {
      if (!data.chatName) return 'A chat name is required.';
      if ((data.networkMode === 'nginx' || data.networkMode === 'cloudflare') && !data.hostname) return 'A public hostname is required for nginx or Cloudflare.';
    }
    if (currentStep === 2) {
      if (!data.adminUsername) return 'An admin username is required.';
      if (!data.adminPassword || data.adminPassword.length < 8) return 'Admin password must be at least 8 characters long.';
    }
    return '';
  }

  function renderSummary() {
    var data = formData();
    qs('summary-box').innerHTML = [
      '<div><strong>Chat</strong><div class="muted">' + escapeHtml(data.chatName || '-') + '</div></div>',
      '<div><strong>Network</strong><div class="muted">' + escapeHtml(data.networkMode) + (data.hostname ? ' · ' + escapeHtml(data.hostname) : ' · local only') + '</div></div>',
      '<div><strong>Fastify</strong><div class="muted">' + escapeHtml((data.host || '127.0.0.1') + ':' + (data.port || 3000)) + '</div></div>',
      '<div><strong>Admin</strong><div class="muted">' + escapeHtml(data.adminUsername || '-') + '</div></div>',
      '<div><strong>Push</strong><div class="muted">' + (data.enableWebPush ? 'Web Push enabled' : 'Disabled') + '</div></div>',
      '<div><strong>Extra users</strong><div class="muted">' + escapeHtml(String(data.users.filter(function(user) { return user.username; }).length)) + '</div></div>'
    ].join('');
  }

  async function loadState() {
    var response = await fetch('/setup/state', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to read setup state');
    state = await response.json();
    if (!state.setupMode) {
      location.href = '/chat';
      return;
    }
    renderChecks();
    var defaults = state.defaults;
    qs('chat-name').value = defaults.chatName || 'Raspi Chat';
    qs('network-mode').value = defaults.networkMode || 'lan';
    qs('app-host').value = defaults.host || '127.0.0.1';
    qs('app-port').value = defaults.port || 3000;
    qs('public-hostname').value = defaults.hostname || '';
    qs('admin-username').value = defaults.adminUsername || 'admin';
    qs('enable-push').checked = defaults.enableWebPush !== false;
    qs('vapid-email').value = (defaults.vapidEmail || '').replace(/^mailto:/, '');
    (defaults.users || []).filter(function(user) {
      return user.username && user.username !== defaults.adminUsername;
    }).forEach(addUserRow);
    syncStepUi();
  }

  async function applySetup() {
    var data = formData();
    var response = await fetch('/setup/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    var payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Setup failed');
    var result = qs('result-box');
    result.classList.add('visible');
    result.innerHTML = [
      '<strong>Installation completed.</strong>',
      '<div class="muted">Generated files:</div>',
      '<pre>' + escapeHtml(
        'ENV: ' + payload.generated.envFile + '\n' +
        'Users: ' + payload.generated.usersFile + '\n' +
        'Service: ' + payload.generated.serviceFile + '\n' +
        'Nginx: ' + payload.generated.nginxFile + '\n' +
        'Cloudflare: ' + payload.generated.cloudflareFile
      ) + '</pre>',
      '<div class="muted">Next commands:</div>',
      '<pre>' + escapeHtml(payload.nextCommands.map(function(command) { return 'sudo ' + command; }).join('\n')) + '</pre>',
      '<div class="muted">Expected URL:</div>',
      '<pre>' + escapeHtml(payload.publicUrl) + '</pre>'
    ].join('');
    qs('apply-btn').disabled = true;
    qs('next-btn').style.visibility = 'hidden';
  }

  qs('prev-btn').onclick = function() {
    if (currentStep > 0) {
      currentStep -= 1;
      syncStepUi();
    }
  };
  qs('next-btn').onclick = function() {
    var error = validateCurrentStep();
    if (error) {
      setError(error);
      return;
    }
    if (currentStep < stepLabels.length - 1) {
      currentStep += 1;
      syncStepUi();
    }
  };
  qs('add-user-btn').onclick = function() { addUserRow({ role: 'user' }); };
  qs('apply-btn').onclick = async function() {
    try {
      setError('');
      qs('apply-btn').disabled = true;
      await applySetup();
    } catch (error) {
      qs('apply-btn').disabled = false;
      setError(error.message || String(error));
    }
  };
  ['chat-name', 'network-mode', 'app-host', 'app-port', 'public-hostname', 'admin-username', 'admin-password', 'enable-push', 'vapid-email'].forEach(function(id) {
    var node = qs(id);
    node.oninput = renderSummary;
    node.onchange = renderSummary;
  });

  loadState().catch(function(error) {
    setError(error.message || String(error));
  });
