'use strict';

// raspi-chat - The public landing page.
// Extracted from public/landing.html.

  fetch('/status', { cache: 'no-store' })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var ok = !!(data && data.ok);
      var dot = document.getElementById('status-dot');
      var badge = document.getElementById('status-badge-text');
      dot.className = 'status-dot ' + (ok ? 'online' : 'offline');
      badge.textContent = ok ? 'Raspberry online' : 'Raspberry offline';
    })
    .catch(function() {
      var dot = document.getElementById('status-dot');
      var badge = document.getElementById('status-badge-text');
      dot.className = 'status-dot offline';
      badge.textContent = 'Raspberry offline';
    });
