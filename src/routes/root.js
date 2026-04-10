const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function formatUptimeSeconds(totalSeconds) {
  const value = Math.max(Math.floor(totalSeconds || 0), 0);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days) return `${days}g ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

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
        items: `${config.apiPrefix}/items`,
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
