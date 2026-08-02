'use strict';

// Shared client state and the small helpers that read it.
//
// These files are classic scripts sharing one global scope, so everything
// declared here is visible to the others. Each sibling declares what it uses
// in its own /* global */ header.

/* global authFetch, insertMessageEl, maskSpoilers, parseGeoText,
         refreshDateSeparators */
/* exported ONBOARDING_KEY, WS_URL, adminUsersCache, adminUsersLoading,
           canCreateInvites, canManageUsers, canUseConsole, cancelReply,
           consoleAutoRefresh, consoleHistory, consoleLoading, currentRoomName,
           currentView, heartbeatTimer, incrementUnread, initScrollListener, isAdmin,
           lastPong, latestInviteUrl, myName, myToken, newCid, outbox,
           pendingImageUrl, playNotifSound, reconnectTimer, replyTo, roomUsersCache,
           roomsCache, scrollToMessage, selectedAdminUsername, startReply, swReg,
           unreadRooms, ws */

var WS_URL = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/chat/ws';
var ws, myName, myToken, pendingImageUrl = null, swReg = null, reconnectTimer = null, outbox = [];
var heartbeatTimer = null, lastPong = 0;
function newCid() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}
var msgElements = {}; // id -> { wrap, statusEl }

// Reply state
var replyTo = null;

// Pagination state
var oldestTimestamp = null;
var hasMore = true;
var loadingMore = false;

// Unread badge
var unreadCount = 0;
var currentView = 'chat';
var isAdmin = false;
var canManageUsers = false;
var canCreateInvites = false;
var canUseConsole = false;
var adminUsersLoading = false;
var scrollListenerBound = false;
var latestInviteUrl = '';
var consoleLoading = false;
var consoleAutoRefresh = null;
var consoleHistory = {
  temp: [],
  load: [],
  ram: [],
  online: []
};
var selectedAdminUsername = '';
var adminUsersCache = [];
var roomsCache = [];
var roomUsersCache = [];
var currentRoomId = localStorage.getItem('chat-room-id') || '';
var unreadRooms = {};
var currentRoomName = 'Chat';
var ONBOARDING_KEY = 'chat-onboarding-seen-v1';

function playNotifSound() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

function incrementUnread() {
  unreadCount++;
  document.title = '(' + unreadCount + ') Chat';
  if (navigator.setAppBadge) navigator.setAppBadge(unreadCount);
}
function clearUnread() {
  unreadCount = 0;
  document.title = 'Chat';
  if (navigator.clearAppBadge) navigator.clearAppBadge();
}
document.addEventListener('visibilitychange', function() { if (!document.hidden) clearUnread(); });
window.addEventListener('focus', clearUnread);

// Reply functions
function startReply(msg) {
  replyTo = msg;
  document.getElementById('reply-bar-name').textContent = msg.username;
  document.getElementById('reply-bar-text').textContent = (msg.imageUrl && !msg.text) ? '📎 Image' : (parseGeoText(msg.text) ? '📍 Location' : maskSpoilers(msg.text));
  document.getElementById('reply-bar').style.display = 'flex';
  document.getElementById('msg-input').focus();
}
function cancelReply() {
  replyTo = null;
  document.getElementById('reply-bar').style.display = 'none';
}

// Scroll to a message
function scrollToMessage(id) {
  var entry = msgElements[id];
  if (!entry) return;
  entry.wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  entry.wrap.classList.add('msg-highlight');
  setTimeout(function() { entry.wrap.classList.remove('msg-highlight'); }, 700);
}

// Pagination
async function loadMoreMessages() {
  if (loadingMore || !hasMore || !oldestTimestamp || !currentRoomId) return;
  loadingMore = true;
  try {
    var res = await authFetch('/chat/messages?roomId=' + encodeURIComponent(currentRoomId) + '&before=' + encodeURIComponent(oldestTimestamp) + '&limit=50');
    var messages = await res.json();
    if (!messages.length) {
      hasMore = false;
      return;
    }
    var container = document.getElementById('messages');
    var sentinel  = document.getElementById('typing-indicator');
    var oldHeight = container.scrollHeight;
    // prepend in order (messages already sorted oldest-first by server)
    messages.forEach(function(m) {
      insertMessageEl(container, sentinel, m);
      trackTimestamp(m.timestamp);
    });
    refreshDateSeparators(container);
    container.scrollTop += container.scrollHeight - oldHeight;
    if (messages.length < 50) {
      hasMore = false;
    }
  } catch(e) {}
  loadingMore = false;
}

// Auto-load on scroll near top
var messagesEl;
function initScrollListener() {
  if (scrollListenerBound) return;
  scrollListenerBound = true;
  messagesEl = document.getElementById('messages');
  messagesEl.addEventListener('scroll', function() {
    if (messagesEl.scrollTop < 80 && hasMore && !loadingMore) loadMoreMessages();
  });
}

function trackTimestamp(ts) {
  if (!oldestTimestamp || ts < oldestTimestamp) oldestTimestamp = ts;
}

