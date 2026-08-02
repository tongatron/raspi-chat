'use strict';

// The chat feature's route surface, split by concern. This file only wires the
// groups together and sets up what they all depend on; every handler lives in
// one of the modules below, and the logic behind them in src/chat/.

const fs = require('node:fs');

const { UPLOADS_DIR } = require('../../chat/attachments');
const { openChatDatabase, validateRestorePayload } = require('../../chat/database');
const { ensureSelfRoomsForAllUsers } = require('../../chat/rooms');

const routeGroups = [
  require('./pwa'),
  require('./session'),
  require('./rooms'),
  require('./messages'),
  require('./push'),
  require('./admin'),
  require('./pages'),
  require('./ws'),
];

async function chatRoutes(app) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  // Chi era già registrato prima che le stanze personali esistessero (o è stato
  // sincronizzato da config/chat-users.json) riceve la sua qui.
  const created = ensureSelfRoomsForAllUsers();
  if (created) app.log.info(`[Rooms] Created ${created} personal rooms`);

  // Raw binary bodies, needed by the database restore endpoint. Registered here
  // so it is in scope for every group registered below.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  for (const group of routeGroups) app.register(group);
}

module.exports = chatRoutes;
// Re-exported for the migration script (ops/encrypt-db.js) and the test suite,
// which need to open a chat database without going through Fastify. The plugin
// function stays the default export, so app.register() is unaffected.
module.exports.openChatDatabase = openChatDatabase;
module.exports.validateRestorePayload = validateRestorePayload;
