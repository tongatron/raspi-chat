'use strict';

// Web Push on the client: permission, subscription, and keeping the
// notification button in sync with the real browser state.

// Push
/* global authFetch, myName, swReg:writable */
/* exported initPush, onNotifBtnClick */

function urlBase64ToUint8Array(b64) {
  var pad = '='.repeat((4 - b64.length % 4) % 4);
  var base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  var raw = atob(base64); var arr = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
var pushBusy = false;
function notifSupported() {
  return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
}
async function getSwReg() {
  if (!swReg) {
    swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    swReg = await navigator.serviceWorker.ready;
  }
  return swReg;
}
async function currentPushSub() {
  try { var reg = await getSwReg(); return await reg.pushManager.getSubscription(); } catch(e) { return null; }
}
// Subscribe (or re-subscribe if the server VAPID key changed) and register on the server.
async function subscribePush() {
  var reg = await getSwReg();
  var vapidResp = await authFetch('/chat/vapid-public-key');
  var serverKey = (await vapidResp.json()).key;
  if (!serverKey) throw new Error('Server VAPID key not configured');
  var appKey = urlBase64ToUint8Array(serverKey);
  var savedKey = localStorage.getItem('chat-vapid-key');
  var sub = await reg.pushManager.getSubscription();
  // Drop any existing subscription created with a different key.
  if (sub && savedKey !== serverKey) { try { await sub.unsubscribe(); } catch(e) {} sub = null; }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    } catch (err) {
      // "push service error"/AbortError often comes from a stale or orphaned FCM
      // registration. Clear whatever exists and retry once after a short wait.
      try { var orphan = await reg.pushManager.getSubscription(); if (orphan) await orphan.unsubscribe(); } catch(e) {}
      await new Promise(function(r){ setTimeout(r, 1500); });
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    }
  }
  localStorage.setItem('chat-vapid-key', serverKey);
  await authFetch('/chat/push-subscribe', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username: myName, subscription: sub.toJSON()}) });
  return sub;
}
async function unsubscribePush() {
  var sub = await currentPushSub();
  if (sub) {
    var ep = sub.endpoint;
    try { await sub.unsubscribe(); } catch(e) {}
    try { await authFetch('/chat/push-unsubscribe', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ endpoint: ep }) }); } catch(e) {}
  }
  localStorage.removeItem('chat-vapid-key');
}
async function refreshNotifBtn() {
  var btn = document.getElementById('notif-btn');
  if (!btn) return;
  if (!notifSupported()) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  var perm = Notification.permission;
  var sub = (perm === 'granted') ? await currentPushSub() : null;
  btn.classList.remove('notif-on', 'notif-off', 'notif-blocked');
  if (perm === 'denied') {
    btn.classList.add('notif-blocked');
    btn.innerHTML = '&#x1f515;';
    btn.title = 'Notifications blocked in browser settings';
  } else if (sub) {
    btn.classList.add('notif-on');
    btn.innerHTML = '&#x1f514;';
    btn.title = 'Notifications on — tap to turn off';
  } else {
    btn.classList.add('notif-off');
    btn.innerHTML = '&#x1f515;';
    btn.title = 'Notifications off — tap to turn on';
  }
  btn.setAttribute('aria-label', btn.title);
}
async function onNotifBtnClick() {
  if (pushBusy) return;
  if (!notifSupported()) { alert('Notifications are not supported on this browser.'); return; }
  if (Notification.permission === 'denied') {
    alert('Notifications are blocked for this site in your browser settings. Unblock them there to turn notifications back on.');
    return;
  }
  pushBusy = true;
  var btn = document.getElementById('notif-btn');
  if (btn) btn.disabled = true;
  try {
    var sub = (Notification.permission === 'granted') ? await currentPushSub() : null;
    if (sub) {
      await unsubscribePush();
    } else {
      var perm = Notification.permission;
      if (perm !== 'granted') perm = await Notification.requestPermission();
      if (perm === 'granted') await subscribePush();
    }
  } catch(e) {
    alert('Notifications error: ' + (e && e.name ? e.name + ' — ' : '') + (e && e.message ? e.message : e));
  }
  pushBusy = false;
  if (btn) btn.disabled = false;
  refreshNotifBtn();
}
// On load: only (re)subscribe silently if permission is already granted.
// Requesting permission needs a user gesture (required on iOS), handled by the bell.
async function initPush() {
  try {
    if (!notifSupported()) { refreshNotifBtn(); return; }
    await getSwReg();
    if (Notification.permission === 'granted') await subscribePush();
  } catch(e) {}
  refreshNotifBtn();
}

