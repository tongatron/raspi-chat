'use strict';

// Input normalisation shared by the chat and setup routes. Every value that
// reaches the database or a generated config file goes through one of these, so
// the length limits here are the effective limits of the application.

const MAX_USERNAME_LENGTH = 30;
const MAX_ROOM_NAME_LENGTH = 60;
const MAX_SLUG_LENGTH = 24;

// Roles, from most to least privileged. `admin` manages users; `superuser` may
// create invites and open the console; `user` is the default.
const ROLES = ['admin', 'superuser', 'user'];

function normalizeUsername(value) {
  return String(value || '').trim().slice(0, MAX_USERNAME_LENGTH);
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return ROLES.includes(role) ? role : 'user';
}

function normalizeRoomName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_ROOM_NAME_LENGTH);
}

// A room id must survive being embedded in a SQL literal: it is the DEFAULT of
// the `messages.room_id` column, and a column default cannot be parameterised.
// Restricting it to `[a-z0-9._-]` means no quote can ever reach that statement.
function normalizeRoomId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
}

// A URL-safe fragment built from a username, used to compose direct-room ids.
function slugPart(value) {
  return normalizeUsername(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH) || 'user';
}

module.exports = {
  MAX_ROOM_NAME_LENGTH,
  MAX_USERNAME_LENGTH,
  ROLES,
  normalizeRole,
  normalizeRoomId,
  normalizeRoomName,
  normalizeUsername,
  slugPart,
};
