'use strict';

// Trasporto realtime verso il backend raspi-chat.
// Contratto: contracts/ws-protocol.md
// Gestisce: handshake `join`, ricezione (history/message/online/...),
// invio messaggi di testo, riconnessione automatica con backoff (research R5).

const EventEmitter = require('node:events');
const WebSocket = require('ws');

const MAX_TEXT_LENGTH = 2000; // allineato a chat.js lato server (FR-007)

class ChatConnection extends EventEmitter {
  constructor({ wsUrl, token, username, roomId }) {
    super();
    this.wsUrl = wsUrl;
    this.token = token;
    this.username = username;
    this.roomId = roomId;
    this.ws = null;
    this.joined = false;
    this.closedByUser = false;
    this.fatal = false;
    this.retries = 0;
    this.reconnectTimer = null;
    this.seenIds = new Set(); // dedup dell'echo dei propri messaggi (data-model)
  }

  connect() {
    if (this.closedByUser || this.fatal) return;
    this.joined = false;
    let ws;
    try {
      ws = new WebSocket(this.wsUrl);
    } catch (err) {
      this.emit('status', `Connessione fallita: ${err.message}`);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.retries = 0;
      ws.send(
        JSON.stringify({
          type: 'join',
          username: this.username,
          token: this.token,
          roomId: this.roomId,
        })
      );
    });

    ws.on('message', (raw) => this._handleMessage(raw));

    ws.on('error', (err) => {
      this.emit('status', `Errore di connessione: ${err.message}`);
    });

    ws.on('close', () => {
      this.ws = null;
      const wasJoined = this.joined;
      this.joined = false;
      if (this.closedByUser || this.fatal) return;
      this.emit('disconnected', { wasJoined });
      this._scheduleReconnect();
    });
  }

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case 'history':
        this.joined = true;
        for (const m of msg.messages || []) if (m.id) this.seenIds.add(m.id);
        this.emit('history', msg);
        break;
      case 'message':
        if (msg.id && this.seenIds.has(msg.id)) return; // già visto (echo/storico)
        if (msg.id) this.seenIds.add(msg.id);
        this.emit('message', msg);
        break;
      case 'online':
        this.emit('online', msg);
        break;
      case 'deleted':
        this.emit('deleted', msg);
        break;
      case 'auth_error':
        this._fatal('Autenticazione rifiutata: token non valido o scaduto. Riautenticati.');
        break;
      case 'room_error':
        this._fatal(`Room non accessibile: "${this.roomId}" inesistente o non sei membro.`);
        break;
      case 'room_removed':
        this._fatal('Sei stato rimosso da questa room.');
        break;
      default:
        // read/unread e altri tipi fuori scope: ignorati.
        break;
    }
  }

  // Errore logico non recuperabile via reconnect.
  _fatal(message) {
    this.fatal = true;
    this._clearReconnect();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
    }
    this.emit('fatal', message);
  }

  _scheduleReconnect() {
    if (this.closedByUser || this.fatal) return;
    this._clearReconnect();
    // Backoff esponenziale con jitter: ~1s → tetto ~30s (research R5).
    const base = Math.min(1000 * 2 ** this.retries, 30000);
    const delay = Math.round(base / 2 + Math.random() * (base / 2));
    this.retries += 1;
    this.emit('status', `Riconnessione tra ${Math.round(delay / 1000)}s...`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // Invia un messaggio di testo. Ritorna { sent, truncated } o motivo del rifiuto.
  sendMessage(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return { sent: false, reason: 'empty' }; // FR-006
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.joined) {
      return { sent: false, reason: 'not_connected' };
    }
    let out = trimmed;
    let truncated = false;
    if (out.length > MAX_TEXT_LENGTH) {
      out = out.slice(0, MAX_TEXT_LENGTH); // FR-007
      truncated = true;
    }
    this.ws.send(JSON.stringify({ type: 'message', text: out }));
    return { sent: true, truncated };
  }

  close() {
    this.closedByUser = true;
    this._clearReconnect();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
  }
}

module.exports = { ChatConnection, MAX_TEXT_LENGTH };
