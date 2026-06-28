#!/usr/bin/env node
'use strict';

// raspi-chat CLI — client interattivo da terminale.
// Uso:  npm run cli   oppure   node cli/chat-cli.js [--url http://host:port] [--room <id>]
// Env:  RASPI_CHAT_URL, RASPI_CHAT_USER, RASPI_CHAT_PASS

const readline = require('node:readline');
const { login, listRooms, AuthError } = require('./lib/auth');
const { ChatConnection } = require('./lib/connection');
const ui = require('./lib/ui');

const DEFAULT_URL = 'http://localhost:3000';
const DEFAULT_ROOM = 'cabras-giovanni';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') opts.url = argv[++i];
    else if (a === '--room') opts.room = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function deriveWsUrl(baseUrl) {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = u.pathname.replace(/\/$/, '') + '/chat/ws';
  return u.toString();
}

function printHelp() {
  process.stdout.write(
    [
      'raspi-chat CLI',
      '',
      'Uso: node cli/chat-cli.js [opzioni]',
      '',
      'Opzioni:',
      '  --url <url>    URL del server (default da RASPI_CHAT_URL o ' + DEFAULT_URL + ')',
      '  --room <id>    Room a cui unirsi (default ' + DEFAULT_ROOM + ')',
      '  -h, --help     Mostra questo aiuto',
      '',
      'Variabili d\'ambiente: RASPI_CHAT_URL, RASPI_CHAT_USER, RASPI_CHAT_PASS',
      '',
    ].join('\n')
  );
}

// Domanda singola su stdin (per credenziali), con mascheramento opzionale.
function ask(question, { mask = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (mask) {
      const onData = (char) => {
        const s = char.toString();
        if (s === '\n' || s === '\r' || s === '') {
          process.stdin.removeListener('data', onData);
        } else {
          readline.moveCursor(process.stdout, -1, 0);
          readline.clearLine(process.stdout, 1);
          process.stdout.write('*');
        }
      };
      process.stdin.on('data', onData);
    }
    rl.question(question, (answer) => {
      rl.close();
      if (mask) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function authenticate(baseUrl) {
  let username = process.env.RASPI_CHAT_USER || '';
  let password = process.env.RASPI_CHAT_PASS || '';
  for (;;) {
    if (!username) username = await ask('Username: ');
    if (!password) password = await ask('Password: ', { mask: true });
    try {
      const session = await login({ baseUrl, username, password });
      return session;
    } catch (err) {
      if (err instanceof AuthError && err.recoverable) {
        process.stderr.write(`✗ ${err.message}\n`);
        username = '';
        password = '';
        continue; // FR-010: ritenta
      }
      // Non recuperabile (server down, ecc.) → propaga
      throw err;
    }
  }
}

// Risolve la room: rispetta --room se passato; altrimenti interroga le room
// dell'utente (GET /chat/my-rooms) e ne sceglie una — auto se unica, prompt se multiple.
async function resolveRoom({ baseUrl, session, requested }) {
  if (requested) return requested;
  const rooms = await listRooms({ baseUrl, username: session.username, token: session.token });
  if (rooms.length === 0) {
    process.stdout.write(`Nessuna room trovata, uso il default "${DEFAULT_ROOM}".\n`);
    return DEFAULT_ROOM;
  }
  if (rooms.length === 1) {
    process.stdout.write(`Room: ${rooms[0].name} (${rooms[0].id})\n`);
    return rooms[0].id;
  }
  process.stdout.write('\nLe tue room:\n');
  rooms.forEach((r, i) => {
    process.stdout.write(`  ${i + 1}) ${r.name}  ${ui.colors.dim('(' + r.id + ')')}\n`);
  });
  for (;;) {
    const answer = await ask(`Scegli una room [1-${rooms.length}] (default 1): `);
    if (answer === '') return rooms[0].id;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= rooms.length) return rooms[n - 1].id;
    process.stdout.write('Scelta non valida.\n');
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }

  const baseUrl = opts.url || process.env.RASPI_CHAT_URL || DEFAULT_URL;
  let wsUrl;
  try {
    wsUrl = deriveWsUrl(baseUrl);
  } catch {
    process.stderr.write(`✗ URL server non valido: ${baseUrl}\n`);
    return 1;
  }

  process.stdout.write(`Server: ${baseUrl}\n`);

  let session;
  try {
    session = await authenticate(baseUrl);
  } catch (err) {
    process.stderr.write(`✗ ${err.message}\n`); // server irraggiungibile all'avvio (SC-005)
    return 1;
  }

  process.stdout.write(`✓ Autenticato come ${session.username}.\n`);

  // Selezione room: --room esplicito oppure scelta dalle room dell'utente.
  const roomId = await resolveRoom({ baseUrl, session, requested: opts.room });

  process.stdout.write('Connessione in corso...\n');

  const conn = new ChatConnection({
    wsUrl,
    token: session.token,
    username: session.username,
    roomId,
  });

  let exitCode = 0;
  let shuttingDown = false;
  const shutdown = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    exitCode = code;
    conn.close();
    ui.close();
    process.exit(exitCode);
  };

  conn.on('history', (msg) => {
    ui.info(`— connesso alla room "${msg.roomName || roomId}" —`);
    const history = msg.messages || [];
    if (history.length === 0) ui.info('(nessun messaggio precedente)');
    for (const m of history) ui.printLine(ui.formatMessage(m, session.username));
  });

  conn.on('message', (m) => ui.printLine(ui.formatMessage(m, session.username)));
  conn.on('online', (m) => ui.printLine(ui.formatOnline(m.users)));
  conn.on('deleted', (m) => ui.info(`(messaggio ${String(m.id).slice(0, 8)} eliminato)`));
  conn.on('status', (s) => ui.info(s));
  conn.on('disconnected', () => ui.warn('⚠ Disconnesso dal server.'));
  conn.on('fatal', (message) => {
    ui.error(`✗ ${message}`);
    shutdown(1);
  });

  ui.createPrompt({
    onLine: (line) => {
      const text = line;
      if (text.trim() === '/quit' || text.trim() === '/exit') return shutdown(0);
      if (text.trim() === '/online') return; // l'ultimo stato online è già stato stampato
      const res = conn.sendMessage(text);
      if (!res.sent) {
        if (res.reason === 'not_connected') ui.warn('⚠ Non connesso: messaggio non inviato.');
        // 'empty' → silenzioso (FR-006)
      } else if (res.truncated) {
        ui.warn('⚠ Messaggio troncato a 2000 caratteri.');
      }
    },
    onClose: () => shutdown(exitCode),
  });

  conn.connect();

  process.on('SIGINT', () => {
    ui.printLine('');
    shutdown(0); // FR-014: uscita pulita
  });
}

main().then(
  (code) => {
    if (typeof code === 'number' && code !== 0) process.exit(code);
  },
  (err) => {
    process.stderr.write(`✗ Errore inatteso: ${err.stack || err.message}\n`);
    process.exit(1);
  }
);
