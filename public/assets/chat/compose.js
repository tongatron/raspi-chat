'use strict';

// Composing and sending: the input box, the outbox that survives a dropped
// connection, the attach menu, and file uploads.

// Send
/* global authFetch, cancelReply, connect, newCid, openLightbox, outbox, pendingImageUrl:writable, replyTo, ws */
/* exported confirmSent, flushOutbox, renderAttachment */

var msgInput = document.getElementById('msg-input');
document.getElementById('send-btn').onclick = sendMessage;
msgInput.onkeydown = function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
msgInput.oninput = function() {
  msgInput.style.height = 'auto'; msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
};

function sendMessage() {
  var text = msgInput.value.trim();
  if (!text && !pendingImageUrl) return;
  var payload = { type: 'message', cid: newCid(), text: text, imageUrl: pendingImageUrl };
  if (replyTo) { payload.replyToId = replyTo.id; }
  // The message stays in the outbox until the server confirms it (echo or ack).
  // A zombie socket (readyState OPEN but the connection is dead) accepts the
  // send without delivering it; without that confirmation the message would be
  // lost silently.
  outbox.push(payload);
  trySend(payload);
  msgInput.value = ''; msgInput.style.height = 'auto';
  clearImagePreview(); cancelReply();
}

// Sends the current position as the text message "geo:<lat>,<lng>",
// riconosciuto e renderizzato come card mappa da renderMessageText().
function sendLocation() {
  if (!navigator.geolocation) { alert('Location: not supported by this browser.'); return; }
  navigator.geolocation.getCurrentPosition(function(pos) {
    var lat = pos.coords.latitude.toFixed(6);
    var lng = pos.coords.longitude.toFixed(6);
    var payload = { type: 'message', cid: newCid(), text: 'geo:' + lat + ',' + lng, imageUrl: null };
    if (replyTo) { payload.replyToId = replyTo.id; }
    outbox.push(payload);
    trySend(payload);
    cancelReply();
  }, function(err) {
    alert('Location: ' + (err && err.message ? err.message : 'permission denied or unavailable'));
  }, { enableHighAccuracy: true, timeout: 10000 });
}

// Sends a payload over the socket when it is open; otherwise (or on error)
// forces a reconnect. Nothing is removed from the outbox here — only the
// server's confirmation does that.
function trySend(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(payload)); return; } catch (e) {}
  }
  connect();
}

// Resends every message that has not been confirmed yet. Must be called after
// the join — the server drops messages from a client that has not joined — and
// server-side deduplication prevents duplicates for anything already delivered.
function flushOutbox() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (var i = 0; i < outbox.length; i++) {
    try { ws.send(JSON.stringify(outbox[i])); } catch (e) { connect(); return; }
  }
}

// Removes from the outbox the message the server has confirmed.
function confirmSent(cid) {
  if (!cid) return;
  for (var i = 0; i < outbox.length; i++) {
    if (outbox[i].cid === cid) { outbox.splice(i, 1); return; }
  }
}

// Compose menu ("+"): Attach file / Send location
var composeMenu = document.getElementById('compose-menu');
var composeMenuBtn = document.getElementById('attach-btn');
function closeComposeMenu() { composeMenu.classList.remove('open'); composeMenuBtn.setAttribute('aria-expanded', 'false'); }
composeMenuBtn.onclick = function(e) {
  e.stopPropagation();
  var willOpen = !composeMenu.classList.contains('open');
  composeMenu.classList.toggle('open', willOpen);
  composeMenuBtn.setAttribute('aria-expanded', String(willOpen));
};
document.addEventListener('click', function(e) {
  if (e.target.closest('#compose-menu') || e.target === composeMenuBtn) return;
  closeComposeMenu();
});

document.getElementById('compose-location-btn').onclick = function() { closeComposeMenu(); sendLocation(); };

// File upload
var fileInput = document.getElementById('file-input');
document.getElementById('compose-attach-btn').onclick = function() { closeComposeMenu(); fileInput.click(); };
fileInput.onchange = async function() { var f = fileInput.files[0]; if (!f) return; fileInput.value = ''; await uploadImage(f, f.name); };
document.getElementById('remove-img').onclick = clearImagePreview;
function clearImagePreview() { pendingImageUrl = null; document.getElementById('image-preview').style.display = 'none'; }

var ATTACH_IMAGE = ['jpg','jpeg','png','gif','webp'];
var ATTACH_VIDEO = ['mov','mp4','webm','m4v'];
var ATTACH_AUDIO = ['mp3','wav','ogg','m4a'];
function attachExt(url) { var m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url || ''); return m ? m[1].toLowerCase() : ''; }
function attachKind(url) {
  var ext = attachExt(url);
  if (ATTACH_IMAGE.indexOf(ext) !== -1) return 'image';
  if (ATTACH_VIDEO.indexOf(ext) !== -1) return 'video';
  if (ATTACH_AUDIO.indexOf(ext) !== -1) return 'audio';
  return 'file';
}
// Original filename embedded in the stored name `<ts>-<hex>-<name>.<ext>`; '' for legacy uploads without it.
function attachName(url) {
  var seg = (url || '').split('/').pop().split('?')[0].split('#')[0];
  try { seg = decodeURIComponent(seg); } catch (e) {}
  var m = /^\d+-[0-9a-f]+-(.+)$/i.exec(seg);
  return m ? m[1] : '';
}
function attachNameEl(url) {
  var name = attachName(url);
  if (!name) return null;
  var cap = document.createElement('div'); cap.className = 'attach-name'; cap.textContent = name; cap.title = name;
  return cap;
}
function renderAttachment(url) {
  var kind = attachKind(url);
  if (kind === 'image') {
    var img = document.createElement('img'); img.src = url; img.className = 'msg-img'; img.alt = '';
    img.onclick = function(){ openLightbox(url); }; return img;
  }
  if (kind === 'video' || kind === 'audio') {
    var box = document.createElement('div'); box.className = 'attach-media';
    var media = document.createElement(kind); media.src = url; media.controls = true; media.preload = 'metadata';
    if (kind === 'video') media.className = 'msg-img';
    box.appendChild(media);
    var cap = attachNameEl(url); if (cap) box.appendChild(cap);
    return box;
  }
  var link = document.createElement('a'); link.className = 'msg-file'; link.href = url; link.target = '_blank'; link.rel = 'noopener';
  link.textContent = '\u{1F4CE} ' + (attachName(url) || (attachExt(url) ? attachExt(url).toUpperCase() + ' file' : 'file'));
  return link;
}

async function uploadImage(file, name) {
  var btn = document.getElementById('attach-btn'); btn.textContent = '...'; btn.disabled = true;
  try {
    var form = new FormData(); form.append('file', file, name);
    var res = await authFetch('/chat/upload', {method:'POST',body:form});
    var txt = await res.text(); var data;
    try { data = JSON.parse(txt); } catch(e) { throw new Error(txt.slice(0,120)); }
    if (!res.ok || !data.url) throw new Error(data.error || 'Error');
    pendingImageUrl = data.url;
    var previewImg = document.getElementById('preview-img');
    if (attachKind(data.url) === 'image') { previewImg.src = data.url; previewImg.style.display = ''; }
    else { previewImg.removeAttribute('src'); previewImg.style.display = 'none'; }
    document.getElementById('preview-name').textContent = name;
    document.getElementById('image-preview').style.display = 'flex';
  } catch(e) { alert('Upload: ' + e.message); }
  finally { btn.textContent = '\u{1F4CE}'; btn.disabled = false; }
}

document.addEventListener('paste', async function(e) {
  var items = Array.from((e.clipboardData && e.clipboardData.items) || []);
  var img = items.find(function(it){return it.type.indexOf('image/') === 0;});
  if (!img) return; var f = img.getAsFile(); if (f) await uploadImage(f, 'screenshot.png');
});
