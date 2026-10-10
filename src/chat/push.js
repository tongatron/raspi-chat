'use strict';

// Web Push notifications (VAPID).
//
// Subscriptions are persisted so they survive a restart, and are dropped as soon
// as the push service reports them gone (404/410). Push is optional: without
// VAPID keys the whole module degrades to a no-op.

const webpush = require('web-push');
const { stmts } = require('./database');

const hasVapidConfig = !!(
  process.env.VAPID_EMAIL &&
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY
);
if (hasVapidConfig) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.log('[Push] VAPID keys missing, web push disabled until configured');
}

// pushSubs: Map<username, Map<endpoint, subscriptionObject>>
const pushSubs  = new Map();

// Load persisted push subscriptions
for (const row of stmts.listPushSubs.all()) {
  try {
    if (!pushSubs.has(row.username)) pushSubs.set(row.username, new Map());
    pushSubs.get(row.username).set(row.endpoint, JSON.parse(row.subscription));
  } catch(e) {}
}
const totalSubs = [...pushSubs.values()].reduce((n, m) => n + m.size, 0);
console.log(`[Push] Loaded ${totalSubs} persisted subscriptions for ${pushSubs.size} users`);

// Grouped notifications: a device that opted in gets a single push per sender
// and room, then stays quiet until its user looks at that room again (or
// writes in it). Kept in memory only: after a restart the worst case is one
// extra notification.
// groupedPending: Set<"recipient\nroomId\nsender">
const groupedPending = new Set();

function clearGroupedPending(username, roomId) {
  const prefix = `${username}\n${roomId}\n`;
  for (const key of groupedPending) if (key.startsWith(prefix)) groupedPending.delete(key);
}

async function sendWebPushToUser(username, payload) {
  const devices = pushSubs.get(username);
  if (!devices || devices.size === 0) return false;
  let sent = false;
  for (const [endpoint, sub] of devices) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent = true;
    } catch (err) {
      console.error(`[Push] Direct WebPush failed for ${username}: ${err.statusCode || err.code || 'unknown'} ${err.message || err}`);
      if (err.statusCode === 410 || err.statusCode === 404) {
        devices.delete(endpoint);
        stmts.deletePushSub.run(username, endpoint);
        if (devices.size === 0) pushSubs.delete(username);
      }
    }
  }
  return sent;
}

async function sendWebPush(msg, senderUsername, roomId) {
  const members = new Set(stmts.listRoomMembers.all(roomId).map(r => r.username));
  const roomRow = stmts.getRoomById.get(roomId);
  const roomName = roomRow ? roomRow.name : 'Chat';
  const payload = JSON.stringify({
    title: `${msg.username} · ${roomName}`,
    body: msg.text ? msg.text.replace(/\|\|[\s\S]+?\|\|/g, '███').slice(0, 100) : '📎 Image',
    url: '/chat'
  });
  for (const [username, devices] of pushSubs) {
    if (username === senderUsername) continue;
    if (!members.has(username)) continue;
    const groupKey = `${username}\n${roomId}\n${senderUsername}`;
    const alreadyNotified = groupedPending.has(groupKey);
    // Marked before sending: two messages in a row must not both get through.
    if (!alreadyNotified && [...devices.values()].some(sub => sub.grouped)) groupedPending.add(groupKey);
    for (const [endpoint, sub] of devices) {
      if (sub.grouped && alreadyNotified) continue;
      try {
        await webpush.sendNotification(sub, payload);
        console.log(`[Push] WebPush sent to ${username} for room ${roomId}`);
      } catch (err) {
        console.error(`[Push] WebPush failed for ${username}: ${err.statusCode || err.code || 'unknown'} ${err.message || err}`);
        if (err.statusCode === 410 || err.statusCode === 404) {
          devices.delete(endpoint);
          stmts.deletePushSub.run(username, endpoint);
          if (devices.size === 0) pushSubs.delete(username);
        }
      }
    }
  }
}
async function sendAllPush(msg, senderUsername, roomId) {
  await sendWebPush(msg, senderUsername, roomId);
}

module.exports = {
  clearGroupedPending,
  hasVapidConfig,
  pushSubs,
  sendAllPush,
  sendWebPush,
  sendWebPushToUser,
};
