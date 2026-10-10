'use strict';

// Web Push subscription management and the diagnostic endpoint used to verify
// that a device really receives notifications.

const webpush = require('web-push');

const { stmts } = require('../../chat/database');

const { requireAuth } = require('../../chat/auth');

const { pushSubs } = require('../../chat/push');

async function pushRoutes(app) {
  app.post('/chat/push-subscribe', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const { subscription, grouped } = request.body || {};
    if (!subscription || !subscription.endpoint) return reply.code(400).send({ error: 'Missing data' });
    // `grouped` is a per-device preference, stored alongside the subscription.
    const stored = { ...subscription, grouped: grouped === true };
    if (!pushSubs.has(username)) pushSubs.set(username, new Map());
    pushSubs.get(username).set(stored.endpoint, stored);
    stmts.upsertPushSub.run(username, stored.endpoint, JSON.stringify(stored), new Date().toISOString());
    return { ok: true };
  });
  app.delete('/chat/push-unsubscribe', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const { endpoint } = request.body || {};
    if (endpoint) {
      pushSubs.get(username)?.delete(endpoint);
      if (pushSubs.get(username)?.size === 0) pushSubs.delete(username);
      stmts.deletePushSub.run(username, endpoint);
    } else {
      pushSubs.delete(username);
      stmts.deleteAllPushSubs.run(username);
    }
    return { ok: true };
  });
  app.get('/chat/vapid-public-key', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    return { key: process.env.VAPID_PUBLIC_KEY };
  });

  app.get('/chat/test-push', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const { to } = request.query;
    const totalSubs = [...pushSubs.values()].reduce((n, m) => n + m.size, 0);
    const info = {
      webPushSubs: totalSubs,
      webPushUsers: Object.fromEntries([...pushSubs.entries()].map(([u, d]) => [u, d.size])),
      vapidConfigured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    };
    if (to && pushSubs.has(to)) {
      const results = [];
      for (const [endpoint, sub] of pushSubs.get(to)) {
        try {
          await webpush.sendNotification(sub, JSON.stringify({ title: 'Test', body: 'Test Web Push notification!', url: '/chat' }));
          results.push({ endpoint: endpoint.slice(-20), result: 'sent' });
        } catch (e) {
          results.push({ endpoint: endpoint.slice(-20), result: 'error: ' + e.message });
        }
      }
      info.webPushTestResult = results;
    } else if (to) {
      info.webPushTestResult = 'missing-subscription';
    }
    return info;
  });

}

module.exports = pushRoutes;
