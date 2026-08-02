'use strict';

// HTTP authentication against the raspi-chat backend.
// Contract: contracts/login.md — POST {baseUrl}/chat/login { username, password }
// Replies 200 { token, username, ... }, or 400/401 with { error }.

class AuthError extends Error {
  constructor(message, { recoverable = true } = {}) {
    super(message);
    this.name = 'AuthError';
    this.recoverable = recoverable; // true means retrying with other credentials makes sense
  }
}

async function login({ baseUrl, username, password }) {
  const url = baseUrl.replace(/\/$/, '') + '/chat/login';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (err) {
    // Server irraggiungibile / problema di rete: non recuperabile cambiando password.
    throw new AuthError(`Impossibile contattare il server (${url}): ${err.message}`, {
      recoverable: false,
    });
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* corpo non-JSON: ignora */
  }

  if (res.status === 200 && data.token) {
    return { token: data.token, username: data.username || username };
  }
  if (res.status === 400) {
    throw new AuthError(data.error || 'Credenziali mancanti', { recoverable: true });
  }
  if (res.status === 401) {
    throw new AuthError(data.error || 'Credenziali non valide', { recoverable: true });
  }
  throw new AuthError(`Login fallito (HTTP ${res.status})`, { recoverable: false });
}

// Recupera le room di cui l'utente è membro.
// Auth via header x-chat-username / x-chat-token (alternativa al cookie di sessione,
// supportata dal backend in src/routes/chat.js → getAuthenticatedUser).
// Ritorna un array di { id, name, ... }; [] se la chiamata non è disponibile.
async function listRooms({ baseUrl, username, token }) {
  const url = baseUrl.replace(/\/$/, '') + '/chat/my-rooms';
  let res;
  try {
    res = await fetch(url, {
      headers: { 'x-chat-username': username, 'x-chat-token': token },
    });
  } catch {
    return [];
  }
  if (res.status !== 200) return [];
  let data = {};
  try {
    data = await res.json();
  } catch {
    return [];
  }
  return Array.isArray(data.rooms) ? data.rooms : [];
}

module.exports = { login, listRooms, AuthError };
