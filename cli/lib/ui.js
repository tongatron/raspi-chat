'use strict';

// Rendering del terminale per la CLI chat.
// Obiettivo chiave (FR-015): stampare messaggi in arrivo senza corrompere
// la riga che l'utente sta digitando. La tecnica: cancellare la riga corrente,
// stampare il messaggio, poi lasciare che readline ridisegni il prompt + input.

const readline = require('node:readline');

// Colori ANSI minimi (disattivati se stdout non è un TTY).
const useColor = process.stdout.isTTY;
const c = (code, s) => (useColor ? `[${code}m${s}[0m` : String(s));
const dim = (s) => c('2', s);
const cyan = (s) => c('36', s);
const green = (s) => c('32', s);
const yellow = (s) => c('33', s);
const red = (s) => c('31', s);

let rl = null;

function createPrompt({ onLine, onClose }) {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });
  rl.on('line', (line) => {
    if (onLine) onLine(line);
    rl.prompt(true);
  });
  if (onClose) rl.on('close', onClose);
  rl.prompt(true);
  return rl;
}

// Stampa una riga preservando l'input parziale dell'utente.
function printLine(text) {
  if (rl && process.stdout.isTTY) {
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(text + '\n');
    rl.prompt(true);
  } else {
    process.stdout.write(text + '\n');
  }
}

function formatTime(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Formatta un messaggio di chat. `selfUsername` evidenzia i propri messaggi.
function formatMessage({ username, text, imageUrl, timestamp }, selfUsername) {
  const time = dim(`[${formatTime(timestamp)}]`);
  const isSelf = selfUsername && username === selfUsername;
  const name = isSelf ? green(username) : cyan(username);
  let body = text || '';
  if (imageUrl) body = (body ? body + ' ' : '') + dim('[immagine]'); // scope v1
  return `${time} ${name}: ${body}`;
}

function formatOnline(users) {
  const list = Array.isArray(users) && users.length ? users.join(', ') : '(nessuno)';
  return dim(`— online: ${list}`);
}

const info = (s) => printLine(dim(s));
const warn = (s) => printLine(yellow(s));
const error = (s) => printLine(red(s));

function close() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

module.exports = {
  createPrompt,
  printLine,
  formatMessage,
  formatOnline,
  formatTime,
  info,
  warn,
  error,
  close,
  colors: { dim, cyan, green, yellow, red },
};
