'use strict';

// Realtime transport to the raspi-chat backend.
// Contract: contracts/ws-protocol.md
// Handles the `join` handshake, inbound frames (history/message/online/...),
// sending text messages, and automatic reconnection with backoff.

const EventEmitter = require('node:events');
const crypto = require('node:crypto');
const WebSocket = require('ws');

const MAX_TEXT_LENGTH = 2000; // matches the server-side limit in src/routes/chat.js

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
    // Coda in uscita (spec 006): payload non ancora confermati dal server. Un
    // messaggio esce di qui solo su conferma (message/ack con lo stesso cid),
    // così un invio durante una disconnessione non va perso ma viene rispedito
    // al reflush dopo il join. Volatile: vive solo nel processo CLI.
    this.outbox = [];
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
        this._flushOutbox(); // reflush dei messaggi in coda dopo il join (FR-003)
        break;
      case 'message':
        if (msg.cid) this._confirm(msg.cid); // eco del proprio invio → toglilo dall'outbox (FR-004)
        if (msg.id && this.seenIds.has(msg.id)) return; // già visto (echo/storico)
        if (msg.id) this.seenIds.add(msg.id);
        this.emit('message', msg);
        break;
      case 'ack':
        // Reinvio di un messaggio già consegnato: il server conferma senza
        // rifare il broadcast. Toglilo dalla coda, niente da mostrare (FR-004).
        if (msg.cid) this._confirm(msg.cid);
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

  // Accoda un messaggio di testo e lo trasmette se il socket è pronto.
  // Ritorna { sent:false, reason:'empty' } per input vuoto; altrimenti
  // { sent:true, truncated, queued }: queued=true se non è stato trasmesso
  // subito (non connesso) e partirà al reflush dopo il join (spec 006).
  sendMessage(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return { sent: false, reason: 'empty' }; // FR-006
    let out = trimmed;
    let truncated = false;
    if (out.length > MAX_TEXT_LENGTH) {
      out = out.slice(0, MAX_TEXT_LENGTH); // FR-007: troncato una sola volta, all'accodamento
      truncated = true;
    }
    // Accoda sempre con un cid univoco: resta in coda finché il server non
    // conferma (message/ack). Il cid abilita la dedup server-side sui reinvii.
    const payload = { type: 'message', cid: this._newCid(), text: out };
    this.outbox.push(payload);
    const ready = this._trySend(payload); // trasmetti subito se possibile
    return { sent: true, truncated, queued: !ready };
  }

  _newCid() {
    return crypto.randomUUID();
  }

  // Trasmette un payload se il socket è OPEN e joined. Non rimuove nulla
  // dall'outbox: ci pensa la conferma del server. Ritorna true se trasmesso.
  _trySend(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.joined) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  // Rispedisce tutti i messaggi ancora in coda. Va chiamata dopo il join: il
  // server accetta i messaggi solo dopo il join e deduplica via cid, quindi il
  // reflush non crea doppioni per ciò che era già stato consegnato (FR-003).
  _flushOutbox() {
    for (const payload of this.outbox) this._trySend(payload);
  }

  // Rimuove dall'outbox il messaggio confermato dal server (FR-004).
  _confirm(cid) {
    const i = this.outbox.findIndex((p) => p.cid === cid);
    if (i !== -1) this.outbox.splice(i, 1);
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
