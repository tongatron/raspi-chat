'use strict';

// ESLint flat config. Kept deliberately small: the project has no build step and
// no frontend framework, so the linter's job is to catch real mistakes (unused
// bindings, accidental globals, unreachable code) rather than to enforce style —
// formatting is handled by .editorconfig.
//
// ESLint is a devDependency only. The Raspberry Pi installs with
// `npm ci --omit=dev`, so production never needs it; `npm run check`
// (ops/syntax-check.js) is the dependency-free gate that runs everywhere.

const js = require('@eslint/js');

// Explicit global maps instead of the `globals` package: one dependency fewer,
// and the list doubles as documentation of which runtime each folder targets.
const nodeGlobals = {
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  exports: 'writable',
  fetch: 'readonly',
  global: 'readonly',
  module: 'writable',
  process: 'readonly',
  require: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  structuredClone: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortSignal: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
};

const browserGlobals = {
  AudioContext: 'readonly',
  Blob: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  CustomEvent: 'readonly',
  document: 'readonly',
  Event: 'readonly',
  fetch: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  FormData: 'readonly',
  Headers: 'readonly',
  history: 'readonly',
  Image: 'readonly',
  localStorage: 'readonly',
  location: 'readonly',
  MutationObserver: 'readonly',
  navigator: 'readonly',
  Notification: 'readonly',
  requestAnimationFrame: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  WebSocket: 'readonly',
  window: 'readonly',
  crypto: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  prompt: 'readonly',
};

const serviceWorkerGlobals = {
  caches: 'readonly',
  clients: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  self: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
};

const sharedRules = {
  ...js.configs.recommended.rules,
  // Unused function arguments are common in Fastify handlers (`request`, `reply`)
  // and in catch blocks; only flag them when they are clearly dead.
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  // `catch {}` used as a deliberate "best effort" guard is idiomatic here and
  // always carries a comment; an empty block elsewhere is still a mistake.
  'no-empty': ['error', { allowEmptyCatch: true }],
  eqeqeq: ['warn', 'smart'],
  'no-var': 'off',
  'prefer-const': 'off',
};

module.exports = [
  {
    ignores: ['node_modules/**', 'data/**', '.specify/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: sharedRules,
  },
  {
    // Browser code served from public/ (frontend scripts extracted from the
    // HTML pages). Written as classic scripts, not modules.
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: browserGlobals,
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: serviceWorkerGlobals,
    },
  },
];
