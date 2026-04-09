const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { config } = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

function run(sql, params = []) {
  return Promise.resolve(db.prepare(sql).run(params));
}

function get(sql, params = []) {
  return Promise.resolve(db.prepare(sql).get(params) || null);
}

function all(sql, params = []) {
  return Promise.resolve(db.prepare(sql).all(params));
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

module.exports = {
  all,
  get,
  initDb,
  run,
};
