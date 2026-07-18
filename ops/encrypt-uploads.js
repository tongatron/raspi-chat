'use strict';

// Migrazione one-shot: cifra gli allegati in chiaro esistenti (spec 007).
//
// Uso:
//   CHAT_DB_KEY=<chiave> node ops/encrypt-uploads.js [percorso/data/uploads]
//
// - Richiede CHAT_DB_KEY (la stessa del .env dell'app / di chat.db, spec 004).
// - Idempotente: i file già cifrati (con header RCEA1) vengono saltati.
// - Prima di cifrare ogni file lo copia in data/uploads.plain.bak/ (backup).
// - Serve solo per convertire gli allegati caricati PRIMA di attivare la chiave:
//   grazie al passthrough, quelli in chiaro restano comunque serviti, quindi la
//   migrazione è opzionale.

const fs = require('node:fs');
const path = require('node:path');
const { encryptBuffer, isEncrypted } = require('../src/attachment-crypto');

function fail(msg) {
  console.error(`[encrypt-uploads] ${msg}`);
  process.exit(1);
}

const key = String(process.env.CHAT_DB_KEY || '');
if (!key) {
  fail('CHAT_DB_KEY non impostata. Esempio: CHAT_DB_KEY=$(openssl rand -hex 32) node ops/encrypt-uploads.js');
}

const uploadsDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'data', 'uploads'));
if (!fs.existsSync(uploadsDir) || !fs.statSync(uploadsDir).isDirectory()) {
  fail(`Cartella uploads non trovata: ${uploadsDir}`);
}

const backupDir = path.join(path.dirname(uploadsDir), 'uploads.plain.bak');
fs.mkdirSync(backupDir, { recursive: true });

const entries = fs.readdirSync(uploadsDir, { withFileTypes: true }).filter((e) => e.isFile());
let encrypted = 0;
let skipped = 0;

for (const entry of entries) {
  const filePath = path.join(uploadsDir, entry.name);
  const data = fs.readFileSync(filePath);
  if (isEncrypted(data)) {
    skipped += 1;
    continue;
  }
  fs.writeFileSync(path.join(backupDir, entry.name), data); // backup dell'originale in chiaro
  fs.writeFileSync(filePath, encryptBuffer(data, key));
  encrypted += 1;
  console.log(`[encrypt-uploads] cifrato ${entry.name}`);
}

console.log(`[encrypt-uploads] Fatto: ${encrypted} cifrati, ${skipped} già cifrati (saltati), ${entries.length} totali.`);
console.log(`[encrypt-uploads] Backup in chiaro in ${backupDir} — rimuovilo solo dopo aver verificato che gli allegati si aprono in chat.`);
console.log('[encrypt-uploads] Conserva CHAT_DB_KEY: senza, gli allegati cifrati sono irrecuperabili.');
