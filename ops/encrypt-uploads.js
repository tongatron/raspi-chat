'use strict';

// One-shot migration: encrypts existing plaintext attachments.
//
// Usage:
//   CHAT_DB_KEY=<key> node ops/encrypt-uploads.js [path/to/data/uploads]
//
// - Requires CHAT_DB_KEY, the same key used by the app's .env and by chat.db.
// - Idempotent: files that already carry the RCEA1 header are skipped.
// - Every file is copied to data/uploads.plain.bak/ before being encrypted.
// - Only needed for attachments uploaded BEFORE the key was enabled. Plaintext
//   files keep being served thanks to the passthrough in decryptBuffer, so this
//   migration is optional.

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
