'use strict';

// Emoji picker: a lightweight panel with no external dependency, so it works
// offline and under a strict CSP. Inserts the emoji at the caret position.

// Emoji picker: a lightweight panel with no external dependency, so it works
// offline and under a strict CSP. Inserts the emoji at the caret position.
(function initEmojiPicker() {
  var EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤩','🥳','🙂','😉','😇','🤔','🤗','😴',
    '😅','😆','😜','😝','🤪','😭','😢','😤','😠','😡','🥺','😱','🙄','😏','😬','🤫',
    '👍','👎','👏','🙏','💪','🙌','👋','🤝','✌️','🤞','👌','🤙','🫶','🤟','☝️','🖐️',
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️','💕','💞','🔥','✨','⭐','🌟',
    '🎉','🎊','💯','✅','❌','❓','❗','⚡','☀️','🌙','☕','🍕','🍺','🍷','🎂','🎁',
    '📌','📎','📷','🎵','⚽','🚀','💩','🤖','👀','🎈'];
  var btn = document.getElementById('emoji-btn');
  var panel = document.getElementById('emoji-panel');
  var input = document.getElementById('msg-input');
  if (!btn || !panel || !input) return;

  function insertAtCursor(el, text) {
    var start = el.selectionStart, end = el.selectionEnd;
    if (start == null || end == null) {
      el.value += text;
    } else {
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      var pos = start + text.length;
      el.selectionStart = el.selectionEnd = pos;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  EMOJIS.forEach(function(emo) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = emo;
    b.setAttribute('aria-label', emo);
    b.addEventListener('click', function(ev) {
      ev.preventDefault();
      insertAtCursor(input, emo);
      setOpen(false);
      input.focus();
    });
    panel.appendChild(b);
  });

  function setOpen(open) {
    panel.hidden = !open;
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
  }

  btn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    setOpen(panel.hidden);
  });
  document.addEventListener('click', function(ev) {
    if (panel.hidden) return;
    if (!panel.contains(ev.target) && ev.target !== btn) setOpen(false);
  });
  document.addEventListener('keydown', function(ev) {
    if (ev.key === 'Escape' && !panel.hidden) setOpen(false);
  });
})();
