'use strict';

// HTML pages served by the chat: the app itself, the admin console, the invite
// landing page, and the two development pages.

const path = require('node:path');
const fs = require('node:fs');

async function pageRoutes(app) {
  app.get('/chat/console', async (request, reply) => {
    return reply.redirect('/chat');
  });

  app.get('/chat/invite/:token', async (request, reply) => {
    const token = String(request.params.token || '').trim();
    if (!token) return reply.code(404).send({ error: 'Invite not found' });
    return reply
      .type('text/html')
      .header('X-Robots-Tag', 'noindex, nofollow')
      .header('Cache-Control', 'no-store')
      .send(fs.readFileSync(path.join(process.cwd(), 'public', 'chat-register.html'), 'utf8'));
  });

  app.get('/chat', async (request, reply) =>
    reply.type('text/html')
      .header('Cache-Control', 'no-store')
      .send(fs.readFileSync(path.join(process.cwd(), 'public', 'chat.html'), 'utf8')));

  // Development-only pages: a theme preview and a Web Push test harness. They
  // are unauthenticated and carry placeholder content, so they are registered
  // only outside production — where they simply 404 like any unknown route.
  if (process.env.NODE_ENV !== 'production') {
    app.get('/chat/theme-lab', async (request, reply) =>
      reply.type('text/html')
        .header('Cache-Control', 'no-store')
        .send(fs.readFileSync(path.join(process.cwd(), 'public', 'theme-lab.html'), 'utf8')));

    app.get('/chat/notify-test', async (request, reply) =>
      reply.type('text/html')
        .header('Cache-Control', 'no-store')
        .send(fs.readFileSync(path.join(process.cwd(), 'public', 'notify-test.html'), 'utf8')));
  }

}

module.exports = pageRoutes;
