'use strict';

// Process-wide settings read once at startup. Chat-specific paths and secrets
// (CHAT_DB_PATH, CHAT_DB_KEY, CHAT_USERS_FILE, ...) are read where they are used,
// in src/routes/chat.js, so this file stays limited to the HTTP server itself.
const config = {
  appName: process.env.APP_NAME || 'raspi-chat',
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
};

module.exports = { config };
