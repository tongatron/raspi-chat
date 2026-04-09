'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const focused = wins.some(w => w.focused && w.url.includes('/chat'));
      if (focused) return;
      return self.registration.showNotification(data.title || 'Chat', {
        body: data.body || '',
        icon: '/chat/icon-192-v2.png',
        badge: '/chat/icon-192-v2.png',
        data: { url: '/chat' },
        vibrate: [100, 50, 100],
        tag: 'chat-message',
        renotify: true,
      });
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(wins => {
      for (const w of wins) {
        if (w.url.includes('/chat') && 'focus' in w) return w.focus();
      }
      return self.clients.openWindow('/chat');
    })
  );
});
