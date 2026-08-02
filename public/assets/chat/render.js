'use strict';

// Turning messages into DOM: linkified text, spoilers, location cards, link
// previews, attachments, date separators and the presence line.

// URL linkify
/* global authFetch, msgElements, myName, renderAttachment, scrollToMessage,
         startReply, ws */
/* exported insertMessageEl, refreshDateSeparators, scrollBottom, updateOnline */

var URL_RE = /(https?:\/\/[^\s<>"']+)/g;
function linkifyNode(text) {
  var frag = document.createDocumentFragment();
  text.split(URL_RE).forEach(function(part) {
    if (URL_RE.test(part)) { var a = document.createElement('a'); a.href = part; a.target = '_blank'; a.rel = 'noopener'; a.textContent = part; frag.appendChild(a); }
    else if (part) frag.appendChild(document.createTextNode(part));
    URL_RE.lastIndex = 0;
  });
  return frag;
}
function extractUrls(text) { return Array.from(text.matchAll(/(https?:\/\/[^\s<>"']+)/g)).map(function(m){return m[1];}); }

// Spoilers: ||text|| becomes a clickable block that reveals itself on tap.
var SPOILER_RE = /\|\|([\s\S]+?)\|\|/g;
function renderText(text) {
  var frag = document.createDocumentFragment();
  var last = 0, m;
  SPOILER_RE.lastIndex = 0;
  while ((m = SPOILER_RE.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(linkifyNode(text.slice(last, m.index)));
    var s = document.createElement('span');
    s.className = 'spoiler';
    s.title = 'Spoiler nascosto – tocca per rivelare';
    s.appendChild(linkifyNode(m[1]));
    s.addEventListener('click', function() {
      if (!this.classList.contains('revealed')) this.classList.add('revealed');
    });
    frag.appendChild(s);
    last = SPOILER_RE.lastIndex;
  }
  if (last < text.length) frag.appendChild(linkifyNode(text.slice(last)));
  return frag;
}
// For previews and quotes: replaces spoiler content with a placeholder.
function maskSpoilers(text) { return (text || '').replace(/\|\|[\s\S]+?\|\|/g, '███'); }

// Messaggi "posizione": testo nel formato geo:<lat>,<lng> (vedi sendLocation()).
var GEO_RE = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;
function parseGeoText(text) {
  var m = GEO_RE.exec(String(text || '').trim());
  return m ? { lat: m[1], lng: m[2] } : null;
}
function renderLocationCard(geo) {
  var link = document.createElement('a'); link.className = 'msg-file'; link.target = '_blank'; link.rel = 'noopener';
  link.href = 'https://www.openstreetmap.org/?mlat=' + geo.lat + '&mlon=' + geo.lng + '#map=16/' + geo.lat + '/' + geo.lng;
  link.textContent = '\u{1F4CD} Location (' + geo.lat + ', ' + geo.lng + ')';
  return link;
}

async function attachLinkPreviews(bubble, urls) {
  try {
    var res = await authFetch('/chat/preview?url=' + encodeURIComponent(urls[0]));
    var data = await res.json();

    // Always hide the raw link in the bubble text
    bubble.querySelectorAll('a').forEach(function(el) {
      try { if (!el.classList.contains('link-preview') && new URL(el.href).href === new URL(urls[0]).href) el.style.display = 'none'; } catch(e) {}
    });

    if (!data.title && !data.image) {
      // No metadata available: fall back to a compact styled link
      var fb = document.createElement('a');
      fb.href = urls[0]; fb.target = '_blank'; fb.rel = 'noopener';
      fb.className = 'link-read-more';
      fb.textContent = 'Leggi articolo →';
      bubble.appendChild(fb);
      return;
    }

    // Preview card completa
    var a = document.createElement('a'); a.href = urls[0]; a.target = '_blank'; a.className = 'link-preview';
    if (data.image) { var img = document.createElement('img'); img.src = data.image; img.className = 'link-preview-img'; img.onerror = function(){this.remove();}; a.appendChild(img); }
    var body = document.createElement('div'); body.className = 'link-preview-body';
    var site = document.createElement('div'); site.className = 'link-preview-site';
    if (data.favicon) { var fav = document.createElement('img'); fav.src = data.favicon; fav.onerror = function(){this.remove();}; site.appendChild(fav); }
    site.appendChild(document.createTextNode(data.siteName || new URL(urls[0]).hostname)); body.appendChild(site);
    if (data.title) { var t = document.createElement('div'); t.className = 'link-preview-title'; t.textContent = data.title; body.appendChild(t); }
    if (data.description) { var d = document.createElement('div'); d.className = 'link-preview-desc'; d.textContent = data.description; body.appendChild(d); }
    a.appendChild(body); bubble.appendChild(a);
  } catch(e){}
}

// Build message DOM element (does NOT append)
function buildMessage(msg) {
  var isMe = msg.username === myName;
  var wrap = document.createElement('div'); wrap.className = 'msg-wrap ' + (isMe ? 'me' : 'other');

  if (!isMe) { var nm = document.createElement('div'); nm.className = 'msg-name'; nm.textContent = msg.username; wrap.appendChild(nm); }

  var bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.setAttribute('translate', 'no');

  // Reply quote
  if (msg.replyTo) {
    var rq = document.createElement('div'); rq.className = 'reply-quote';
    (function(rid) { rq.onclick = function() { scrollToMessage(rid); }; })(msg.replyTo.id);
    var rqName = document.createElement('div'); rqName.className = 'rq-name'; rqName.textContent = msg.replyTo.username; rq.appendChild(rqName);
    var rqText = document.createElement('div'); rqText.className = 'rq-text';
    rqText.textContent = (msg.replyTo.imageUrl && !msg.replyTo.text) ? '📎 Image' : (parseGeoText(msg.replyTo.text) ? '📍 Location' : maskSpoilers(msg.replyTo.text));
    rq.appendChild(rqText); bubble.appendChild(rq);
  }

  if (msg.imageUrl) { bubble.appendChild(renderAttachment(msg.imageUrl)); }
  var geo = msg.text ? parseGeoText(msg.text) : null;
  if (geo) {
    bubble.appendChild(renderLocationCard(geo));
  } else if (msg.text) {
    var p = document.createElement('p'); p.appendChild(renderText(msg.text)); bubble.appendChild(p); var urls = extractUrls(msg.text); if (urls.length) attachLinkPreviews(bubble, urls);
  }
  if (msg.imageUrl && !msg.text && !msg.replyTo) bubble.classList.add('image-only');
  wrap.appendChild(bubble);

  // Meta row
  var meta = document.createElement('div'); meta.className = 'msg-meta';

  // Reply button
  var replyBtn = document.createElement('button'); replyBtn.className = 'reply-btn'; replyBtn.textContent = '↩'; replyBtn.title = 'Reply';
  (function(m) { replyBtn.onclick = function(e) { e.stopPropagation(); startReply(m); }; })(msg);
  meta.appendChild(replyBtn);

  // Favorite button (star)
  var favBtn = null;
  if (msg.id) {
    favBtn = document.createElement('button'); favBtn.className = 'fav-btn'; favBtn.title = 'Favorite';
    favBtn.textContent = msg.favorite ? '★' : '☆';
    favBtn.classList.toggle('active', !!msg.favorite);
    (function(mid, btn) {
      btn.onclick = function(e) {
        e.stopPropagation();
        var next = !btn.classList.contains('active');
        btn.classList.toggle('active', next);
        btn.textContent = next ? '★' : '☆';
        ws.send(JSON.stringify({ type: next ? 'favorite' : 'unfavorite', id: mid }));
      };
    })(msg.id, favBtn);
    meta.appendChild(favBtn);
  }

  var time = document.createElement('span');
  time.textContent = new Date(msg.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  meta.appendChild(time);

  var statusEl = null;
  // Delete button (own messages only)
  if (isMe && msg.id) {
    var delBtn = document.createElement("button"); delBtn.className = "delete-btn"; delBtn.textContent = "🗑"; delBtn.title = "Delete message";
    (function(mid) { delBtn.onclick = function(e) { e.stopPropagation(); if (confirm("Delete this message?")) ws.send(JSON.stringify({ type: "delete", id: mid })); }; })(msg.id);
    meta.appendChild(delBtn);
  }

  wrap.appendChild(meta);

  // Track for read receipts, reply scrolling, status updates
  if (msg.id) msgElements[msg.id] = { wrap: wrap, statusEl: statusEl, favBtn: favBtn };

  return wrap;
}

// Centered system announcement (e.g. "X joined the chat.")
function buildSystemMessage(msg) {
  var wrap = document.createElement('div'); wrap.className = 'msg-system';
  var pill = document.createElement('span'); pill.textContent = msg.text || '';
  wrap.appendChild(pill);
  return wrap;
}

function renderMessageEl(msg) {
  return msg.kind === 'system' ? buildSystemMessage(msg) : buildMessage(msg);
}

// Date separator ("Today" / "Yesterday" / full date)
function dayKey(ts) {
  var d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function formatDayLabel(day) {
  var p = day.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2]);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === yesterday.getTime()) return 'Yesterday';
  var opts = { month: 'long', day: 'numeric' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}
function buildDateSeparator(day) {
  var el = document.createElement('div'); el.className = 'date-sep';
  var pill = document.createElement('span'); pill.textContent = formatDayLabel(day);
  el.appendChild(pill);
  return el;
}

// Insert a message (or system announcement) and tag it with its calendar day
function insertMessageEl(container, beforeNode, msg) {
  var el = renderMessageEl(msg);
  el.dataset.day = dayKey(msg.timestamp);
  if (beforeNode) container.insertBefore(el, beforeNode); else container.appendChild(el);
  return el;
}

// Recompute date separators from scratch across all currently loaded messages.
// Safer than incremental placement: pagination inserts older batches before the
// #typing-indicator sentinel, which can end up sandwiched mid-history.
function refreshDateSeparators(container) {
  var old = container.querySelectorAll('.date-sep');
  for (var i = 0; i < old.length; i++) old[i].remove();
  var kids = Array.prototype.slice.call(container.children);
  var lastDay = null;
  kids.forEach(function(child) {
    var day = child.dataset.day;
    if (!day) return;
    if (day !== lastDay) { container.insertBefore(buildDateSeparator(day), child); lastDay = day; }
  });
}

function updateOnline(users, members) {
  var el = document.getElementById('online-list');
  if (!el) return;
  var onlineSet = new Set(users);
  var all = members && members.length ? members : users;
  if (!all.length) { el.innerHTML = ''; return; }
  el.innerHTML = all.map(function(u) {
    var isOnline = onlineSet.has(u);
    return '<span class="member-chip' + (isOnline ? ' online' : '') + '">' +
      '<span class="member-chip-dot"></span>' + u + '</span>';
  }).join('');
}

function scrollBottom() { var m = document.getElementById('messages'); m.scrollTop = m.scrollHeight; }

