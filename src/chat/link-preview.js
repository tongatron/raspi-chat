'use strict';

// Link previews for URLs posted in the chat.
//
// The server fetches the target page and reads its OpenGraph/Twitter tags, so
// the client never talks to third-party sites directly. YouTube goes through
// oEmbed instead, and Facebook needs a nudge because it serves placeholder tags
// to logged-out crawlers.

function getYoutubeVideoId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? id.slice(0, 32) : null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v');
        return id ? id.slice(0, 32) : null;
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed') {
        return parts[1] ? parts[1].slice(0, 32) : null;
      }
    }
  } catch {}

  return null;
}

async function buildYoutubePreview(url) {
  const videoId = getYoutubeVideoId(url);
  if (!videoId) return null;

  const fallback = {
    url,
    siteName: 'YouTube',
    title: 'YouTube video',
    description: null,
    image: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    favicon: 'https://www.youtube.com/s/desktop/fe6f5d8b/img/logos/favicon_32x32.png',
  };

  try {
    const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ChatPreview/1.0)', accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    return {
      url,
      siteName: 'YouTube',
      title: String(data.title || fallback.title).trim() || fallback.title,
      description: data.author_name ? `Channel: ${String(data.author_name).trim()}` : null,
      image: data.thumbnail_url || fallback.image,
      favicon: fallback.favicon,
    };
  } catch {
    return fallback;
  }
}

function decodeHtmlEntities(value) {
  if (!value) return value;
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return _; }
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return _; }
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function resolveMetaUrl(value, baseUrl) {
  if (!value) return null;
  try {
    return new URL(decodeHtmlEntities(value), baseUrl).toString();
  } catch {
    return decodeHtmlEntities(value);
  }
}

function extractMeta(html, baseUrl) {
  const og = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']{1,500})["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']{1,500})["'][^>]+property=["']og:${prop}["']`, 'i'));
    return m ? m[1].trim() : null;
  };
  const meta = (name) => {
    const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']{1,500})["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']{1,500})["'][^>]+name=["']${name}["']`, 'i'));
    return m ? m[1].trim() : null;
  };
  const titleM = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const title = og('title') || meta('twitter:title') || (titleM ? titleM[1].trim() : null);
  const description = og('description') || meta('description') || meta('twitter:description');
  const rawImage = og('image') || og('image:secure_url') || meta('twitter:image') || meta('twitter:image:src');
  const image = resolveMetaUrl(rawImage, baseUrl);
  const siteName = og('site_name');
  const favicon = (() => {
    const m = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/i);
    if (!m) return null;
    const href = m[1];
    return resolveMetaUrl(href, baseUrl);
  })();
  return {
    title: decodeHtmlEntities(title),
    description: decodeHtmlEntities(description),
    image,
    siteName: decodeHtmlEntities(siteName),
    favicon,
    url: baseUrl
  };
}

function normalizeFacebookPreview(meta, url) {
  if (!meta) return meta;
  const hostname = (() => {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
  })();
  if (!hostname.includes('facebook.com') && !hostname.includes('fb.com') && !hostname.includes('fb.watch')) {
    return meta;
  }
  const title = meta.title && meta.title !== 'Facebook' ? meta.title : 'Facebook';
  const description = meta.description && meta.description !== title ? meta.description : null;
  return Object.assign({}, meta, {
    siteName: meta.siteName || 'Facebook',
    title,
    description,
    image: meta.image || null,
    favicon: meta.favicon || 'https://static.xx.fbcdn.net/rsrc.php/yD/r/d4ZIVX-5C-b.ico',
  });
}

module.exports = {
  buildYoutubePreview,
  decodeHtmlEntities,
  extractMeta,
  getYoutubeVideoId,
  normalizeFacebookPreview,
  resolveMetaUrl,
};
