const path = require('node:path');

const config = {
  appName: process.env.APP_NAME || 'fastify-api',
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  dbPath: process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.db'),
};

module.exports = { config };
