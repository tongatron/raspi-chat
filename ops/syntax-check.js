#!/usr/bin/env node
'use strict';

// Parses every JavaScript file in the project and fails on the first syntax
// error. This is the dependency-free gate that also runs on the Raspberry Pi,
// where devDependencies (and therefore ESLint) are not installed.
//
// It replaces the hand-maintained list of `node --check` calls that used to
// live in package.json and silently went stale whenever a file was added.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['src', 'cli', 'ops', 'tests', 'public'];
const ROOT_FILES = ['server.js'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'assets']);

function collect(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, found);
    else if (entry.isFile() && entry.name.endsWith('.js')) found.push(full);
  }
  return found;
}

const files = ROOT_FILES.map((name) => path.join(ROOT, name)).filter((file) => fs.existsSync(file));
for (const dir of SCAN_DIRS) {
  const full = path.join(ROOT, dir);
  if (fs.existsSync(full)) collect(full, files);
}

const failures = [];
for (const file of files) {
  try {
    // `new vm.Script` compiles without executing — the same parse that
    // `node --check` performs, but without spawning a process per file.
    new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
  } catch (err) {
    failures.push({ file: path.relative(ROOT, file), message: err.message });
  }
}

for (const failure of failures) {
  console.error(`x ${failure.file}\n  ${failure.message}`);
}

if (failures.length) {
  console.error(`\n${failures.length} file(s) failed the syntax check.`);
  process.exit(1);
}

console.log(`OK - ${files.length} JavaScript files parsed without syntax errors.`);
