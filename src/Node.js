'use strict';

const http = require('node:http');
const https = require('node:https');
const { randomBytes } = require('node:crypto');
const { EventEmitter } = require('node:events');

// ─── Minimal WebSocket client (supports custom headers) ─────────────────────

const OPCODES = { TEXT: 0x01, CLOSE: 0x08, PING: 0x09, PONG: 0x0a };

function unmask(data, mask) {
  for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
  return data;
}

function buildFrame(opcode, payload) {
  const data = Buffer.from(payload);
  const mask = randomBytes(4);
  const len = data.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | len;
    mask.copy(header, 2);
  } else if (len < 65536) {
    header = Buffer.alloc(8);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    mask.copy(header, 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
    mask.copy(header, 10);
  }

  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  return Buffer.concat([header, masked]);
}

class WS extends EventEmitter {
  constructor(url, headers = {}) {
    super();
    this.open = false;
    this._buffer = Buffer.alloc(0);
    this._socket = null;
    this._connect(url, headers);
  }

  _connect(url, headers) {
    const parsed = new URL(url);
    const secure = parsed.protocol === 'wss:';
    const port = parsed.port || (secure ? 443 : 80);
    const key = randomBytes(16).toString('base64');
    const mod = secure ? https : http;

    const req = mod.request({
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        ...headers,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });

    req.on('upgrade', (res, socket) => {
      this._socket = socket;
      this.open = true;
      this.emit('open');
      socket.on('data', (chunk) => this._onData(chunk));
      socket.on('close', () => this._onClose());
      socket.on('error', (err) => this.emit('error', err));
    });

    req.on('error', (err) => this.emit('error', err));
    req.end();
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);

    while (this._buffer.length >= 2) {
      const fin = (this._buffer[0] & 0x80) !== 0;
      const opcode = this._buffer[0] & 0x0f;
      const masked = (this._buffer[1] & 0x80) !== 0;
      let payloadLen = this._buffer[1] & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this._buffer.length < 4) return;
        payloadLen = this._buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this._buffer.length < 10) return;
        payloadLen = Number(this._buffer.readBigUInt64BE(2));
        offset = 10;
      }

      if (masked) offset += 4;
      if (this._buffer.length < offset + payloadLen) return;

      let data = this._buffer.subarray(offset, offset + payloadLen);
      if (masked) {
        const mask = this._buffer.subarray(offset - 4, offset);
        data = unmask(Buffer.from(data), mask);
      }

      this._buffer = this._buffer.subarray(offset + payloadLen);

      if (!fin) continue; // skip fragmented (rare for Lavalink)

      switch (opcode) {
        case OPCODES.TEXT:
          this.emit('message', data.toString('utf8'));
          break;
        case OPCODES.CLOSE:
          this._onClose();
          break;
        case OPCODES.PING:
          this._socket?.write(buildFrame(OPCODES.PONG, data));
          break;
      }
    }
  }

  send(data) {
    if (!this.open || !this._socket) return;
    this._socket.write(buildFrame(OPCODES.TEXT, data));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const buf = Buffer.alloc(2 + Buffer.byteLength(reason));
    buf.writeUInt16BE(code, 0);
    buf.write(reason, 2);
    this._socket?.write(buildFrame(OPCODES.CLOSE, buf));
    this._onClose();
  }

  _onClose() {
    if (!this.open) return;
    this.open = false;
    this._socket?.destroy();
    this._socket = null;
    this.emit('close');
  }
}

// ─── REST wrapper ───────────────────────────────────────────────────────────

class Rest {
  /** @param {Node} node */
  constructor(node) {
    this.node = node;
    this.base = `http${node.secure ? 's' : ''}://${node.host}:${node.port}`;
  }

  /**
   * Make an HTTP request to the Lavalink REST API.
   * @param {string} method
   * @param {string} path
   * @param {object} [body]
   * @returns {Promise<any>}
   */
  async request(method, path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: this.node.password,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Lavalink REST ${method} ${path}: ${res.status}`);
    if (res.status === 204) return null;
    return res.json();
  }

  /** @param {string} identifier */
  loadTracks(identifier) {
    return this.request('GET', `/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`);
  }

  /** @param {string} encoded */
  decodeTrack(encoded) {
    return this.request('GET', `/v4/decodetrack?encodedTrack=${encodeURIComponent(encoded)}`);
  }

  /** @param {string[]} tracks */
  decodeTracks(tracks) {
    return this.request('POST', '/v4/decodetracks', tracks);
  }

  getPlayers() {
    return this.request('GET', `/v4/sessions/${this.node.sessionId}/players`);
  }

  /** @param {string} guildId */
  getPlayer(guildId) {
    return this.request('GET', `/v4/sessions/${this.node.sessionId}/players/${guildId}`);
  }

  /**
   * @param {string} guildId
   * @param {object} data
   * @param {boolean} [noReplace=false]
   */
  updatePlayer(guildId, data, noReplace = false) {
    const q = noReplace ? '?noReplace=true' : '';
    return this.request('PATCH', `/v4/sessions/${this.node.sessionId}/players/${guildId}${q}`, data);
  }

  /** @param {string} guildId */
  destroyPlayer(guildId) {
    return this.request('DELETE', `/v4/sessions/${this.node.sessionId}/players/${guildId}`);
  }

  /** @param {object} data */
  updateSession(data) {
    return this.request('PATCH', `/v4/sessions/${this.node.sessionId}`, data);
  }

  getInfo() { return this.request('GET', '/v4/info'); }
  getStats() { return this.request('GET', '/v4/stats'); }
  getVersion() { return this.request('GET', '/version'); }

  getRoutePlannerStatus() {
    return this.request('GET', '/v4/routeplanner/status');
  }

  /** @param {string} address */
  freeRoutePlannerAddress(address) {
    return this.request('POST', '/v4/routeplanner/free/address', { address });
  }

  freeAllRoutePlannerAddresses() {
    return this.request('POST', '/v4/routeplanner/free/all');
  }
}

// ─── Node ───────────────────────────────────────────────────────────────────

/**
 * Represents a connection to a Lavalink node.
 */
class Node {
  /**
   * @param {import('./Lavvy').Lavvy} lavvy
   * @param {object} options
   */
  constructor(lavvy, options) {
    this.lavvy = lavvy;
    this.name = options.name ?? `${options.host}:${options.port ?? 2333}`;
    this.host = options.host;
    this.port = options.port ?? 2333;
    this.password = options.password ?? 'youshallnotpass';
    this.secure = options.secure ?? false;
    this.sessionId = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectInterval = options.reconnectInterval ?? 5000;
    this.resumeTimeout = options.resumeTimeout ?? 60;
    this.stats = { players: 0, playingPlayers: 0, cpu: {}, memory: {}, uptime: 0 };
    this.ws = null;
    this.rest = new Rest(this);
    this._reconnectTimer = null;
  }

  /** Penalty score for load balancing (lower = better). */
  get penalties() {
    const cpu = this.stats.cpu?.systemLoad
      ? (Math.pow(1.05, 100 * this.stats.cpu.systemLoad) * 10 - 10) : 0;
    const deficit = this.stats.frameStats?.deficit ?? 0;
    const nulled = this.stats.frameStats?.nulled ?? 0;
    return cpu + deficit * 0.5 + nulled * 0.5 + this.stats.playingPlayers;
  }

  /** Open a WebSocket connection to this node. */
  connect() {
    if (this.ws) this.ws.close();

    const headers = {
      Authorization: this.password,
      'User-Id': this.lavvy.userId,
      'Client-Name': 'Lavvy/1.0.0',
    };
    if (this.sessionId) headers['Session-Id'] = this.sessionId;

    const url = `ws${this.secure ? 's' : ''}://${this.host}:${this.port}/v4/websocket`;
    this.ws = new WS(url, headers);

    this.ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      clearTimeout(this._reconnectTimer);
      this.lavvy.emit('nodeConnect', this);
    });

    this.ws.on('message', (raw) => this._onMessage(raw));

    this.ws.on('close', () => {
      this.connected = false;
      this.lavvy.emit('nodeDisconnect', this);
      this._attemptReconnect();
    });

    this.ws.on('error', (err) => {
      this.lavvy.emit('nodeError', this, err);
    });
  }

  /** Disconnect from this node. */
  disconnect() {
    clearTimeout(this._reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  /** @internal */
  _onMessage(raw) {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    switch (data.op) {
      case 'ready':
        this.sessionId = data.sessionId;
        this.rest.updateSession({ resuming: true, timeout: this.resumeTimeout }).catch(() => {});
        break;

      case 'stats':
        this.stats = data;
        break;

      case 'playerUpdate': {
        const player = this.lavvy.players.get(data.guildId);
        if (player) {
          player.position = data.state.position ?? 0;
          player.connected = data.state.connected ?? false;
        }
        break;
      }

      case 'event': {
        const player = this.lavvy.players.get(data.guildId);
        if (player) player.handleEvent(data);
        break;
      }
    }
  }

  /** @internal */
  _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.lavvy.emit('nodeError', this, new Error(`Max reconnect attempts reached for ${this.name}`));
      this._movePlayersToNextNode();
      return;
    }
    this.reconnectAttempts++;
    this._reconnectTimer = setTimeout(() => {
      this.lavvy.emit('nodeReconnect', this, this.reconnectAttempts);
      this.connect();
    }, this.reconnectInterval * this.reconnectAttempts);
  }

  /** @internal */
  _movePlayersToNextNode() {
    const available = this.lavvy.nodes.filter((n) => n !== this && n.connected);
    if (!available.length) return;

    for (const [guildId, player] of this.lavvy.players) {
      if (player.node !== this) continue;
      const target = available.sort((a, b) => a.penalties - b.penalties)[0];
      player.node = target;
      if (player.playing || player.paused) {
        player.play().catch(() => {});
      }
    }
  }
}

module.exports = { Node, Rest };
