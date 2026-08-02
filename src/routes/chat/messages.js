'use strict';

// Message history and everything attached to it: pagination, the media
// gallery, favourites, link previews, chat backgrounds, and attachment
// upload/download (transparently encrypted when CHAT_DB_KEY is set).

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { pipeline } = require('node:stream/promises');

const { encryptBuffer, decryptBuffer } = require('../../attachment-crypto');
const { DEFAULT_ROOM_ID, stmts } = require('../../chat/database');
const {
  ATTACHMENT_ALLOWED,
  ATTACHMENT_INLINE,
  ATTACHMENT_MIME,
  UPLOADS_DIR,
  UPLOAD_MAX_BYTES,
  attachmentDisplayName,
  isImageUrl,
  safeAttachmentBase,
} = require('../../chat/attachments');
const { requireAuth, requireAuthUser, requireRoomMember } = require('../../chat/auth');
const { favoriteIdSet, formatRow } = require('../../chat/serializers');

const {
  buildYoutubePreview,
  extractMeta,
  normalizeFacebookPreview,
} = require('../../chat/link-preview');

async function messageRoutes(app) {
  app.get('/chat/media', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user) return;
    const roomId = String(request.query?.roomId || DEFAULT_ROOM_ID);
    if (!stmts.getRoomMember.get(roomId, user.username)) {
      return reply.code(403).send({ error: 'Not a member of this room' });
    }
    const images = stmts.listRoomImages.all(roomId)
      .filter(row => isImageUrl(row.imageUrl))
      .map(row => ({ username: row.username, imageUrl: row.imageUrl, timestamp: row.timestamp }));
    return { images };
  });

  app.get('/chat/favorites', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user) return;
    const roomId = String(request.query?.roomId || DEFAULT_ROOM_ID);
    if (!stmts.getRoomMember.get(roomId, user.username)) {
      return reply.code(403).send({ error: 'Not a member of this room' });
    }
    const messages = stmts.listRoomFavorites.all(user.username, roomId)
      .map(row => ({ id: row.id, username: row.username, text: row.text || '', imageUrl: row.imageUrl || null, timestamp: row.timestamp }));
    return { messages };
  });

  // Pagination endpoint
  app.get('/chat/messages', async (request, reply) => {
    const user = requireAuthUser(request, reply);
    if (!user) return;
    const roomId = String(request.query.roomId || '').trim() || DEFAULT_ROOM_ID;
    const access = requireRoomMember(request, reply, roomId, user);
    if (!access) return;
    const {
  before } = request.query;
    if (!before) return reply.code(400).send({ error: 'before is required' });
    const limit = Math.min(parseInt(request.query.limit) || 50,
  100);
    const rows = stmts.getPage.all(roomId,
  before,
  limit);
    const favoriteIds = favoriteIdSet(user.username);
    return rows.reverse().map((row) => formatRow(row,
  favoriteIds));
  });

  const BACKGROUNDS_DIR = path.join(process.cwd(),
  'public',
  'backgrounds');
  fs.mkdirSync(BACKGROUNDS_DIR,
  { recursive: true });

  // List available backgrounds
  app.get('/chat/backgrounds',
  async (request,
  reply) => {
    const username = requireAuth(request,
  reply);
    if (!username) return;
    const files = fs.readdirSync(BACKGROUNDS_DIR)
      .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
      .map(f => ({ name: f,
  url: '/chat/backgrounds/' + f }));
    return files;
  });

  // Serve background images
  app.get('/chat/backgrounds/:filename',
  async (request,
  reply) => {
    const username = requireAuth(request,
  reply);
    if (!username) return;
    const filename = path.basename(request.params.filename);
    const filePath = path.join(BACKGROUNDS_DIR,
  filename);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Not found' });
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mime = { jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp' }[ext] || 'application/octet-stream';
    return reply.type(mime).send(fs.createReadStream(filePath));
  });

  // Upload a new background (authenticated users only)
  app.post('/chat/backgrounds/upload',
  async (request,
  reply) => {
    const username = requireAuth(request,
  reply);
    if (!username) return;
    const data = await request.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: 'No file provided' });
    const ext = path.extname(data.filename).toLowerCase();
    if (!['.jpg',
  '.jpeg',
  '.png',
  '.webp'].includes(ext)) return reply.code(400).send({ error: 'Unsupported format' });
    const filename = Date.now() + '-bg' + ext;
    const filePath = path.join(BACKGROUNDS_DIR,
  filename);
    const { pipeline: pl,
} = require('node:stream/promises');
    await pl(data.file, fs.createWriteStream(filePath));
    return { url: '/chat/backgrounds/' + filename, name: filename };
  });

  app.get('/chat/preview', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const { url } = request.query;
    if (!url || !/^https?:\/\/.+/i.test(url)) return reply.code(400).send({ error: 'Invalid URL' });
    try {
      const youtubePreview = await buildYoutubePreview(url);
      if (youtubePreview) return reply.send(youtubePreview);
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; ChatPreview/1.0)', accept: 'text/html' }, signal: AbortSignal.timeout(6000) });
      if (!(res.headers.get('content-type') || '').includes('text/html')) return reply.send({ url });
      return reply.send(normalizeFacebookPreview(extractMeta((await res.text()).slice(0, 80000), url), url));
    } catch { return reply.send({ url }); }
  });

  app.get('/chat/images/:filename', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const filename = path.basename(request.params.filename);
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Not found' });
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mime = ATTACHMENT_MIME[ext] || 'application/octet-stream';
    // Inline for media/pdf; force download for documents/archives (and anything unknown) to avoid serving executable content in-page.
    const downloadName = (attachmentDisplayName(filename) || filename).replace(/"/g, '');
    const disposition = ATTACHMENT_INLINE.has(ext) ? 'inline' : `attachment; filename="${downloadName}"`;
    // With CHAT_DB_KEY set, attachments are encrypted at rest: decrypt in memory
    // and serve the original bytes. Legacy plaintext files (no header) pass
    // through untouched. Without a key, stream straight from disk.
    if (process.env.CHAT_DB_KEY) {
      let out;
      try {
        out = decryptBuffer(fs.readFileSync(filePath), process.env.CHAT_DB_KEY);
      } catch {
        return reply.code(500).send({ error: 'Cannot decrypt attachment' });
      }
      return reply.type(mime).header('Content-Disposition', disposition).send(out);
    }
    return reply.type(mime).header('Content-Disposition', disposition).send(fs.createReadStream(filePath));
  });

  app.post('/chat/upload', async (request, reply) => {
    const username = requireAuth(request, reply);
    if (!username) return;
    const data = await request.file({ limits: { fileSize: UPLOAD_MAX_BYTES } });
    if (!data) return reply.code(400).send({ error: 'No file provided' });
    const ext = path.extname(data.filename).slice(1).toLowerCase();
    if (!ATTACHMENT_ALLOWED.has(ext)) return reply.code(400).send({ error: 'Unsupported format' });
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeAttachmentBase(data.filename)}.${ext}`;
    const dest = path.join(UPLOADS_DIR, filename);
    // With CHAT_DB_KEY set, encrypt the attachment at rest. The GCM tag is only
    // verifiable at the end of the file, so the upload is buffered (bounded by
    // UPLOAD_MAX_BYTES) rather than streamed. Without a key, stream as-is.
    if (process.env.CHAT_DB_KEY) {
      const plain = await data.toBuffer();
      if (data.file.truncated) return reply.code(413).send({ error: 'File too large' });
      fs.writeFileSync(dest, encryptBuffer(plain, process.env.CHAT_DB_KEY));
    } else {
      await pipeline(data.file, fs.createWriteStream(dest));
      if (data.file.truncated) {
        fs.unlink(dest, () => {});
        return reply.code(413).send({ error: 'File too large' });
      }
    }
    return { url: `/chat/images/${filename}`, name: data.filename };
  });

}

module.exports = messageRoutes;
