async function rootRoutes(app, options) {
  const { config } = options;

  app.get('/', async () => {
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
