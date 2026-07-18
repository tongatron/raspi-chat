'use strict';

// Cifratura at-rest degli allegati (spec 007). Riusa la chiave CHAT_DB_KEY del DB
// cifrato (spec 004): quando è impostata, i file in data/uploads/ sono cifrati con
// AES-256-GCM; altrimenti restano in chiaro (baseline invariata, opt-in).
//
// Layout del file cifrato su disco:
//   MAGIC(6) || IV(12) || TAG(16) || ciphertext
// GCM fornisce riservatezza e integrità: una decifratura con chiave errata o su un
// file manomesso lancia invece di restituire dati corrotti.

const crypto = require('node:crypto');

const MAGIC = Buffer.from('RCEA1\n'); // Raspi-Chat Encrypted Attachment v1 (6 byte)
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + IV_LEN + TAG_LEN;

// CHAT_DB_KEY è ad alta entropia (openssl rand -hex 32); SHA-256 la normalizza a
// 32 byte a prescindere dal formato della stringa.
function deriveKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey || '')).digest();
}

// True se il buffer inizia col MAGIC di un allegato cifrato da questo modulo.
function isEncrypted(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= MAGIC.length &&
    buf.subarray(0, MAGIC.length).equals(MAGIC)
  );
}

// Cifra un buffer in chiaro; ritorna il buffer con header + ciphertext.
function encryptBuffer(plain, rawKey) {
  const key = deriveKey(rawKey);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, enc]);
}

// Decifra un buffer prodotto da encryptBuffer. Se il buffer non è cifrato (nessun
// MAGIC) viene restituito tal quale: passthrough per gli allegati in chiaro legacy
// serviti quando la chiave è stata attivata dopo (spec 007 DK-003). Lancia se il
// buffer è cifrato ma la chiave è errata o i dati sono manomessi (tag GCM).
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
