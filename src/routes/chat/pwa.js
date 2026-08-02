'use strict';

// Everything the browser and the Android app fetch before a session exists:
// the service worker, the PWA manifest, icons, the Digital Asset Links file
// that ties the TWA to this domain, and the static asset allow-list.

const path = require('node:path');
const fs = require('node:fs');

const ASSETS_DIR = path.join(process.cwd(), 'public', 'assets');

// Extensions this route will serve. Anything not listed is a 404, so a stray
// file dropped into public/assets/ cannot be handed out by accident.
const ASSET_MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

async function pwaRoutes(app) {
  app.get('/sw.js', async (request, reply) =>
    reply.type('application/javascript')
      .header('Service-Worker-Allowed', '/')
      .header('Cache-Control', 'no-store')
      .send(fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8')));

  // Digital Asset Links: links the TWA/APK (Android app) to this domain so the
  // wrapped PWA opens full-screen without the browser URL bar. Edit the SHA-256
  // fingerprint in config/assetlinks.json after building the APK with Bubblewrap.
  app.get('/.well-known/assetlinks.json', async (request, reply) => {
    const filePath = path.join(process.cwd(), 'config', 'assetlinks.json');
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Not configured' });
    return reply.type('application/json')
      .header('Cache-Control', 'no-store')
      .send(fs.readFileSync(filePath, 'utf8'));
  });

  // Direct download of the Android APK (place the built file at data/app.apk on
  // the server). Lets the phone install/update the app without manual transfer.
  app.get('/chat/app.apk', async (request, reply) => {
    const filePath = path.join(process.cwd(), 'data', 'app.apk');
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'APK not available' });
    return reply
      .type('application/vnd.android.package-archive')
      .header('Content-Disposition', 'attachment; filename="raspi-chat.apk"')
      .header('Cache-Control', 'no-store')
      .send(fs.createReadStream(filePath));
  });

  app.get('/chat/manifest.json', async (request, reply) =>
    reply.type('application/manifest+json')
      .header('Cache-Control', 'no-store')
      .send({
      name: 'Raspi Chat', short_name: 'Chat', description: 'Private real-time chat',
      start_url: '/chat', scope: '/', display: 'standalone', orientation: 'portrait',
      background_color: '#f0f0f0', theme_color: '#3b82f6',
      icons: [
        { src: '/chat/assets/icon-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/chat/assets/icon-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/chat/assets/icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/chat/assets/icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }));

  app.get('/chat/icon-:size.png', async (request, reply) => {
    const filePath = path.join(process.cwd(), 'public', 'assets', `icon-${request.params.size}.png`);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Not found' });
    return reply.type('image/png').header('Cache-Control', 'no-cache, must-revalidate').send(fs.createReadStream(filePath));
  });

  // public/assets/ is the only directory in public/ that is entirely safe to
  // expose: every other page under public/ has its own authenticated route.
  // Rather than a static-file plugin over all of public/, this route serves that
  // one directory, guarded by two checks — the extension must be known, and the
  // resolved path must still be inside ASSETS_DIR after any `..` is collapsed.
  app.get('/chat/assets/*', async (request, reply) => {
    const filePath = path.resolve(ASSETS_DIR, String(request.params['*'] || ''));
    if (!filePath.startsWith(ASSETS_DIR + path.sep)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const mime = ASSET_MIME[path.extname(filePath).toLowerCase()];
    if (!mime) return reply.code(404).send({ error: 'Not found' });
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply
      .type(mime)
      .header('Cache-Control', 'no-cache, must-revalidate')
      .send(fs.createReadStream(filePath));
  });

}

module.exports = pwaRoutes;
