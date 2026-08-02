'use strict';

// raspi-chat - The invite-registration page.
// Extracted from public/chat-register.html.

  var token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  var form = document.getElementById('register-form');
  var statusEl = document.getElementById('status');
  var inviteMetaEl = document.getElementById('invite-meta');
  var submitBtn = document.getElementById('submit-btn');
  var inviteOk = false;

  function setStatus(message, kind) {
    statusEl.textContent = message || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  async function loadInvite() {
    try {
      var res = await fetch('/chat/invite/' + encodeURIComponent(token) + '/data', { cache: 'no-store' });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invite unavailable');
      inviteOk = true;
      inviteMetaEl.textContent = 'Invite ready. The new account will be created as ' + (data.invite && data.invite.role === 'admin' ? 'admin' : 'user') + '.';
      setStatus('');
    } catch (e) {
      inviteOk = false;
      inviteMetaEl.textContent = 'This link is not available.';
      setStatus(e.message || 'Invalid invite', 'error');
      submitBtn.disabled = true;
    }
  }

  form.onsubmit = async function(event) {
    event.preventDefault();
    if (!inviteOk) return;
    var username = document.getElementById('username').value.trim();
    var password = document.getElementById('password').value;
    var repeat = document.getElementById('password-repeat').value;
    if (!username) return setStatus('Enter a name.', 'error');
    if (password.length < 4) return setStatus('Password must be at least 4 characters long.', 'error');
    if (password !== repeat) return setStatus('Passwords do not match.', 'error');

    submitBtn.disabled = true;
    setStatus('Creating your account...');
    try {
      var res = await fetch('/chat/invite/' + encodeURIComponent(token) + '/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      localStorage.setItem('chat-user', data.username);
      localStorage.setItem('chat-token', data.token);
      if (data.firstRoomId) localStorage.setItem('chat-room-id', data.firstRoomId);
      setStatus('Account created. Signing you in...', 'ok');
      inviteMetaEl.textContent = 'Registration completed. Taking you to chat.';
      setTimeout(function() {
        location.href = '/chat';
      }, 300);
    } catch (e) {
      setStatus(e.message || 'Registration failed', 'error');
      submitBtn.disabled = false;
    }
  };

  loadInvite();
