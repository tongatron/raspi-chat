'use strict';

const Fastify = require('fastify');
const { config } = require('./config');
const rootRoutes = require('./routes/root');
const itemRoutes = require('./routes/items');
const setupRoutes = require('./routes/setup');
const chatRoutes = require('./routes/chat');

function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 32 * 1024 * 1024 }); // 32 MB

  app.register(require('@fastify/websocket'));
  app.register(require('@fastify/multipart'));

  app.register(rootRoutes, { config });
  app.register(itemRoutes, { prefix: config.apiPrefix });
  app.register(setupRoutes);
  app.register(chatRoutes);

  return app;
}

module.exports = { buildApp };
