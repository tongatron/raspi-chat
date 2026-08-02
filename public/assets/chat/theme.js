'use strict';

// Light/dark theme switch. The choice is stored in localStorage and applied
// before anything else renders, so the page never flashes the wrong theme.

function applyTheme(theme) {
  var isLight = theme === 'light';
  document.body.classList.toggle('theme-light', isLight);
  var btn = document.getElementById('theme-toggle-btn');
  // The switch reads as "Dark theme": checked when the dark theme is active.
  if (btn) btn.setAttribute('aria-checked', isLight ? 'false' : 'true');
}
applyTheme(localStorage.getItem('chat-theme') || 'dark');
document.getElementById('theme-toggle-btn').onclick = function(e) {
  e.stopPropagation();
  var next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
  localStorage.setItem('chat-theme', next);
  applyTheme(next);
};
