'use strict';

// Uploaded attachments: where they live, which formats are accepted, and how a
// stored filename maps back to what the user originally uploaded.
//
// Stored names have the shape `<timestamp>-<random hex>-<sanitised base>.<ext>`,
// which keeps them unique, safe to put in a URL, and still recognisable.

const path = require('node:path');

const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads');

// Attachment handling: extended whitelist + MIME map shared by upload and serve routes.
const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const ATTACHMENT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf',
  mov: 'video/quicktime', mp4: 'video/mp4', webm: 'video/webm', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
};
// Extensions we let the browser render inline (image/video/audio/pdf); everything else is forced as a download.
const ATTACHMENT_INLINE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'mov', 'mp4', 'webm', 'm4v', 'mp3', 'wav', 'ogg', 'm4a']);
const ATTACHMENT_ALLOWED = new Set(Object.keys(ATTACHMENT_MIME));
// Extensions the Media gallery treats as images.
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
function isImageUrl(url) {
  const ext = String(url || '').split('.').pop().toLowerCase();
  return IMAGE_EXTS.has(ext);
}

// Sanitize an uploaded filename into a URL/filesystem-safe base (no extension), preserving readability.
function safeAttachmentBase(originalName) {
  const base = path.basename(String(originalName || ''), path.extname(String(originalName || '')));
  const cleaned = base.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, 60);
  return cleaned || 'file';
}

// Recover the display filename from a stored name `<ts>-<hex>-<base>.<ext>`; returns '' for legacy names without the base.
function attachmentDisplayName(storedName) {
  const m = /^\d+-[a-f0-9]+-(.+)$/.exec(String(storedName || ''));
  return m ? m[1] : '';
}

module.exports = {
  ATTACHMENT_ALLOWED,
  ATTACHMENT_INLINE,
  ATTACHMENT_MIME,
  UPLOADS_DIR,
  UPLOAD_MAX_BYTES,
  attachmentDisplayName,
  isImageUrl,
  safeAttachmentBase,
};
