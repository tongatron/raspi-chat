#!/usr/bin/env node
'use strict';

// One-shot migration: encrypts an existing plaintext chat.db.
//
// Usage:
//   CHAT_DB_KEY=<key> node ops/encrypt-db.js [path/to/chat.db]
//
// - Requires CHAT_DB_KEY, the same key you will put in the app's .env.
// - Backs the plaintext file up to <db>.plain.bak BEFORE converting.
// - Idempotent: an already-encrypted database is left untouched.
// - Run it with the app STOPPED: no other process may be writing to the DB.

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3-multiple-ciphers');

const DEFAULT_DB = path.join(process.cwd(), 'data', 'chat.db');
const dbPath = process.argv[2] || process.env.CHAT_DB_PATH || DEFAULT_DB;
const key = String(process.env.CHAT_DB_KEY || '');

function fail(message) {
  console.error(`[encrypt-db] ${message}`);
  process.exit(1);
}

if (!key) {
  fail('CHAT_DB_KEY non impostata. Esempio: CHAT_DB_KEY=$(openssl rand -hex 32) node ops/encrypt-db.js');
}
if (!fs.existsSync(dbPath)) {
  fail(`File non trovato: ${dbPath}`);
}

// Rileva se il file è già cifrato: aprendolo senza chiave, un DB in chiaro si legge,
// uno cifrato solleva "file is not a database".
function isPlaintext(file) {
  const probe = new Database(file, { readonly: true });
  try {
    probe.exec('SELECT count(*) FROM sqlite_schema');
    return true;
  } catch {
    return false;
  } finally {
    probe.close();
  }
}

if (!isPlaintext(dbPath)) {
  console.log(`[encrypt-db] ${dbPath} risulta già cifrato (o non in chiaro): niente da fare.`);
  process.exit(0);
}

const backupPath = `${dbPath}.plain.bak`;
if (fs.existsSync(backupPath)) {
  fail(`Esiste già un backup ${backupPath}: rimuovilo o spostalo prima di rieseguire.`);
}
fs.copyFileSync(dbPath, backupPath);
console.log(`[encrypt-db] Backup del DB in chiaro creato: ${backupPath}`);

// Conta prima/dopo, per verifica finale.
function counts(db) {
  const q = (sql) => { try { return db.prepare(sql).get().n; } catch { return null; } };
  return {
    users: q('SELECT count(*) AS n FROM users'),
    messages: q('SELECT count(*) AS n FROM messages'),
  };
}

const escKey = key.replace(/'/g, "''");
const src = new Database(dbPath);
// Checkpoint del WAL e passaggio a rollback journal: PRAGMA rekey deve riscrivere
// ogni pagina su un file consolidato, senza -wal/-shm pendenti.
try { src.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
try { src.pragma('journal_mode = DELETE'); } catch {}

const before = counts(src);

// Cifra il database in-place: da qui `src` è già agganciato alla nuova chiave.
src.pragma(`rekey='${escKey}'`);
const after = counts(src);
src.close();

if (before.users !== after.users || before.messages !== after.messages) {
  fail(`Verifica fallita (prima ${JSON.stringify(before)}, dopo ${JSON.stringify(after)}). Ripristina dal backup: cp '${backupPath}' '${dbPath}'`);
}

// Riverifica da zero: il file deve aprirsi con la chiave e fallire senza.
const check = new Database(dbPath);
check.pragma(`key='${escKey}'`);
if (counts(check).messages !== after.messages) {
  check.close();
  fail(`Riapertura cifrata incoerente. Ripristina dal backup: cp '${backupPath}' '${dbPath}'`);
}
check.close();

console.log(`[encrypt-db] Fatto. ${dbPath} è ora cifrato (utenti: ${after.users}, messaggi: ${after.messages}).`);
console.log('[encrypt-db] Metti CHAT_DB_KEY nel .env e riavvia l\'app. Conserva la chiave: senza, i dati sono irrecuperabili.');
console.log(`[encrypt-db] Verificato tutto? Elimina il backup in chiaro: rm ${backupPath}`);
