'use strict';

// Public pages and service metadata: the landing page, the invite entry point,
// and the health/version/status endpoints used by monitoring and the CI smoke
// tests.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { formatUptimeSeconds } = require('../lib/format');

async function rootRoutes(app, options) {
  const { config } = options;

  app.get('/', async (request, reply) => {
    return reply
      .type('text/html')
      .header('Cache-Control', 'no-store')
      .send(fs.readFileSync(path.join(process.cwd(), 'public', 'landing.html'), 'utf8'));
  });

  app.get('/register', async (request, reply) => {
    return reply
      .type('text/html')
      .header('Cache-Control', 'no-store')
      .send(fs.readFileSync(path.join(process.cwd(), 'public', 'register-entry.html'), 'utf8'));
  });

  app.get('/service', async () => {
    return {
      service: config.appName,
      ok: true,
      env: config.env,
      docs: {
        health: '/health',
        version: '/version',
        chat: '/chat',
        setup: '/setup',
      },
    };
  });

  app.get('/status', async () => {
    return {
      ok: true,
      service: config.appName,
      raspberry: {
        hostname: os.hostname(),
        platform: os.platform(),
        uptimeSeconds: os.uptime(),
        uptimeHuman: formatUptimeSeconds(os.uptime()),
        loadAvg: os.loadavg(),
      },
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/health', async () => {
    return {
      ok: true,
      service: config.appName,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/version', async () => {
    return {
      name: config.appName,
      node: process.version,
      env: config.env,
    };
  });
}

module.exports = rootRoutes;
