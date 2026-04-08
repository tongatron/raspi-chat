require('dotenv').config({ quiet: true });
const { buildApp } = require('./src/app');
const { config } = require('./src/config');
const { initDb } = require('./src/db');

const app = buildApp();

const start = async () => {
  try {
    await initDb();
    await app.listen({ host: config.host, port: config.port });
    app.log.info(`API listening on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
