'use strict';

// Test della cifratura at-rest degli allegati (spec 007). Verifica il modulo
// src/attachment-crypto.js senza passare dall'HTTP: round-trip, chiave errata,
// manomissione, rilevamento header e passthrough dei file in chiaro legacy.

const { test } = require('node:test');
const assert = require('node:assert');
const { encryptBuffer, decryptBuffer, isEncrypted, MAGIC } = require('../src/attachment-crypto');

const KEY = 'a'.repeat(64); // finta chiave hex, come `openssl rand -hex 32`
const PLAIN = Buffer.from('contenuto-allegato-segreto   GIF89a fake bytes', 'utf8');

test('encryptBuffer produce header MAGIC e non contiene il testo in chiaro (SC-001)', () => {
  const enc = encryptBuffer(PLAIN, KEY);
  assert.ok(enc.subarray(0, MAGIC.length).equals(MAGIC), 'deve iniziare col MAGIC');
  assert.ok(isEncrypted(enc));
  assert.strictEqual(enc.includes(PLAIN), false, 'il contenuto in chiaro non deve comparire');
});

test('round-trip: decryptBuffer con stessa chiave restituisce l\'originale byte-identico (SC-002, US1)', () => {
  const enc = encryptBuffer(PLAIN, KEY);
  const back = decryptBuffer(enc, KEY);
  assert.ok(back.equals(PLAIN));
});

test('chiave errata: decryptBuffer lancia (autenticazione GCM) (FR-005, US1.3)', () => {
  const enc = encryptBuffer(PLAIN, KEY);
  assert.throws(() => decryptBuffer(enc, 'b'.repeat(64)));
});

test('manomissione del ciphertext: decryptBuffer lancia (FR-005)', () => {
  const enc = encryptBuffer(PLAIN, KEY);
  enc[enc.length - 1] ^= 0xff; // altera un byte
  assert.throws(() => decryptBuffer(enc, KEY));
});

test('passthrough: un buffer in chiaro (senza MAGIC) è restituito invariato (FR-004, US2.1)', () => {
  const legacy = Buffer.from('PNG plaintext legacy attachment');
  assert.strictEqual(isEncrypted(legacy), false);
  const out = decryptBuffer(legacy, KEY); // chiave presente, ma file non cifrato
  assert.ok(out.equals(legacy));
});

test('isEncrypted: false su buffer corti o non-buffer', () => {
  assert.strictEqual(isEncrypted(Buffer.from('ab')), false);
  assert.strictEqual(isEncrypted('non-un-buffer'), false);
  assert.strictEqual(isEncrypted(Buffer.alloc(0)), false);
});

test('IV random: due cifrature dello stesso input danno output diversi', () => {
  const a = encryptBuffer(PLAIN, KEY);
  const b = encryptBuffer(PLAIN, KEY);
  assert.strictEqual(a.equals(b), false);
  assert.ok(decryptBuffer(a, KEY).equals(decryptBuffer(b, KEY)));
});
