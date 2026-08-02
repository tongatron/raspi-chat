'use strict';

// raspi-chat - The open-registration entry page.
// Extracted from public/register-entry.html.

  var usernameInput = document.getElementById('username-input');
  var passwordInput = document.getElementById('password-input');
  var repeatInput = document.getElementById('password-repeat-input');
  var statusEl = document.getElementById('status');
  var openBtn = document.getElementById('open-invite-btn');

  function setStatus(message, kind) {
    statusEl.textContent = message || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  async function registerDirect() {
    var username = usernameInput.value.trim();
    var password = passwordInput.value;
    var repeat = repeatInput.value;
    if (!username) {
      setStatus('Enter a username.', 'error');
      return;
    }
    if (password.length < 4) {
      setStatus('Password must be at least 4 characters long.', 'error');
      return;
    }
    if (password !== repeat) {
      setStatus('Passwords do not match.', 'error');
      return;
    }
    openBtn.disabled = true;
    setStatus('Creating your account...');
    try {
      var res = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      localStorage.setItem('chat-user', data.username);
      localStorage.setItem('chat-token', data.token);
      if (data.firstRoomId) localStorage.setItem('chat-room-id', data.firstRoomId);
      setStatus('Account created. Signing you in...');
      setTimeout(function() {
        location.href = '/chat';
      }, 300);
    } catch (e) {
      setStatus(e.message || 'Registration failed', 'error');
      openBtn.disabled = false;
    }
  }

  openBtn.addEventListener('click', registerDirect);
  [usernameInput, passwordInput, repeatInput].forEach(function(input) {
    input.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        registerDirect();
      }
    });
  });
