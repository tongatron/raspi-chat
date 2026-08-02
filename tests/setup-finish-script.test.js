'use strict';

// Verifica che POST /setup/apply generi anche data/setup-generated/finish-setup.sh,
// lo script pensato per sostituire i comandi copiati a mano (cp + systemctl) descritti
// nei "Prossimi passi consigliati" del README ("setup guidato ancora più automatico").

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'raspi-chat-setup-'));
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });

process.env.CHAT_USERS_FILE = path.join(tmpRoot, 'config', 'chat-users.json');
process.env.CHAT_DB_PATH = path.join(tmpRoot, 'data', 'chat.db');
process.env.SETUP_STATE_FILE = path.join(tmpRoot, 'data', 'setup-complete.json');
process.env.FORCE_SETUP_MODE = '1';
process.chdir(tmpRoot);

const { buildApp } = require(path.join(originalCwd, 'src', 'app'));

let app;

before(async () => {
  app = buildApp();
  await app.ready();
});

after(async () => {
  if (app) await app.close();
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('POST /setup/apply genera un finish-setup.sh eseguibile con i comandi di attivazione', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/setup/apply',
    payload: {
      chatName: 'Test Chat',
      networkMode: 'lan',
      host: '127.0.0.1',
      port: 3000,
      adminUsername: 'Admin',
      adminPassword: 'super-secret-1',
      enableWebPush: false,
    },
  });

  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.generated.finishScript, 'la risposta deve indicare il path dello script');
  assert.deepStrictEqual(body.nextCommands, [`sudo bash ${body.generated.finishScript}`]);

  const scriptPath = body.generated.finishScript;
  assert.ok(fs.existsSync(scriptPath), 'lo script generato deve esistere su disco');

  const mode = fs.statSync(scriptPath).mode;
  assert.ok(mode & 0o111, 'lo script deve essere eseguibile');

  const content = fs.readFileSync(scriptPath, 'utf8');
  assert.match(content, /systemctl enable --now raspi-chat/);
  assert.doesNotMatch(content, /nginx/, 'in modalita lan non deve contenere i comandi nginx');
});

test('con networkMode nginx lo script include anche i comandi nginx', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/setup/apply',
    payload: {
      chatName: 'Test Chat',
      networkMode: 'nginx',
      host: '127.0.0.1',
      port: 3000,
      hostname: 'chat.example.com',
      adminUsername: 'Admin',
      adminPassword: 'super-secret-1',
      enableWebPush: false,
    },
  });

  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  const content = fs.readFileSync(body.generated.finishScript, 'utf8');
  assert.match(content, /sites-available\/raspi-chat\.conf/);
  assert.match(content, /nginx -t && systemctl reload nginx/);
});
