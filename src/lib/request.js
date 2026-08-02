'use strict';

// Helpers for reading the incoming HTTP request. Shared by the chat and setup
// routes, which both need to tell a LAN visitor from an internet one and to read
// cookies without pulling in @fastify/cookie.

// Hostnames that are always treated as local, on top of the private IP ranges.
// `raspberrypi.local` is the default mDNS name of a stock Raspberry Pi OS image,
// so a browser on the same network reaches the Pi through it before any DNS or
// reverse proxy exists.
const LOCAL_HOSTNAMES = ['localhost', 'raspberrypi.local'];

// Private IPv4 ranges, per RFC 1918.
const PRIVATE_IPV4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
];

// The client address, preferring the proxy header: behind nginx or a Cloudflare
// tunnel `request.ip` is the proxy itself, not the visitor.
function getRequestAddress(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(request.ip || request.socket?.remoteAddress || '').trim();
}

// True when the request comes from the same machine or the local network.
// Used to gate the setup wizard and other operations that must not be reachable
// from the public internet.
function isLocalAccess(request) {
  const address = getRequestAddress(request)
    .replace(/^::ffff:/, '') // IPv4-mapped IPv6, e.g. ::ffff:192.168.1.10
    .replace(/^\[|\]$/g, '');
  const host = String(request.headers['x-forwarded-host'] || request.headers.host || '').toLowerCase();

  if (address === '127.0.0.1' || address === '::1' || address === '') return true;
  if (PRIVATE_IPV4.some((range) => range.test(address))) return true;
  return LOCAL_HOSTNAMES.some((name) => host.includes(name));
}

// Parses the Cookie header into a plain object. Values are returned raw (not
// URL-decoded); callers decode what they store.
function parseCookies(request) {
  const raw = String(request.headers.cookie || '');
  const cookies = {};
  for (const entry of raw.split(';')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    cookies[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return cookies;
}

module.exports = { getRequestAddress, isLocalAccess, parseCookies };
