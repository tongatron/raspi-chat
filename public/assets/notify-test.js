'use strict';

// raspi-chat - A development page for exercising Web Push.
// Extracted from public/notify-test.html.

var username = localStorage.getItem('chat-user');
var token = localStorage.getItem('chat-token');
var statusEl = document.getElementById('status');
var btn = document.getElementById('send-btn');

if (!username || !token) {
  document.getElementById('intro').textContent = 'You need to be logged in to the chat first.';
  btn.disabled = true;
}

btn.onclick = async function() {
  btn.disabled = true;
  statusEl.className = '';
  statusEl.textContent = 'Sending…';
  try {
    var res = await fetch('/chat/test-push?to=' + encodeURIComponent(username), {
      headers: { 'X-Chat-Username': username, 'X-Chat-Token': token },
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    if (!data.webPushTestResult) {
      statusEl.className = 'err';
      statusEl.textContent = 'No push subscription found for ' + username + '. Enable notifications in the chat first (bell icon), then try again.';
    } else {
      var results = data.webPushTestResult;
      var failed = Array.isArray(results) && results.some(function(r) { return r.result !== 'sent'; });
      statusEl.className = failed ? 'err' : 'ok';
      statusEl.textContent = JSON.stringify(results, null, 2);
    }
  } catch (e) {
    statusEl.className = 'err';
    statusEl.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
  }
};
