'use strict';

// At-rest encryption for attachments. Reuses CHAT_DB_KEY, the same key that
// encrypts chat.db: when it is set, files under data/uploads/ are written with
// AES-256-GCM; otherwise they stay in plaintext. Encryption is opt-in and the
// plaintext behaviour is unchanged.
//
// On-disk layout of an encrypted file:
//   MAGIC(6) || IV(12) || TAG(16) || ciphertext
// GCM gives both confidentiality and integrity: decrypting with the wrong key,
// or a tampered file, throws instead of returning corrupt data.

const crypto = require('node:crypto');

const MAGIC = Buffer.from('RCEA1\n'); // Raspi-Chat Encrypted Attachment v1 (6 bytes)
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + IV_LEN + TAG_LEN;

// CHAT_DB_KEY is already high-entropy (openssl rand -hex 32); SHA-256 only
// normalises it to the 32 bytes AES-256 needs, whatever the string looks like.
function deriveKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey || '')).digest();
}

// True when the buffer starts with the MAGIC of an attachment this module wrote.
function isEncrypted(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= MAGIC.length &&
    buf.subarray(0, MAGIC.length).equals(MAGIC)
  );
}

// Encrypts a plaintext buffer; returns header + ciphertext.
function encryptBuffer(plain, rawKey) {
  const key = deriveKey(rawKey);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, enc]);
}

// Decrypts a buffer produced by encryptBuffer. A buffer without the MAGIC is
// returned unchanged: that passthrough is what keeps legacy plaintext
// attachments readable on an install where the key was enabled later. Throws if
// the buffer is encrypted but the key is wrong or the data was tampered with.
function decryptBuffer(stored, rawKey) {
  if (!isEncrypted(stored)) return stored;
  const key = deriveKey(rawKey);
  const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = stored.subarray(MAGIC.length + IV_LEN, HEADER_LEN);
  const enc = stored.subarray(HEADER_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

module.exports = { encryptBuffer, decryptBuffer, isEncrypted, MAGIC };
