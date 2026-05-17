'use strict';

const { EventEmitter } = require('node:events');
const { Node } = require('./Node');
const { Player } = require('./Player');

/**
 * Main Lavvy client — manages nodes, players, and voice state.
 *
 * @example
 * const lavvy = new Lavvy(client, [{ host: '127.0.0.1', port: 2333, password: 'youshallnotpass' }]);
 * client.on('ready', () => lavvy.init(client.user.id));
 * client.on('raw', (d) => lavvy.updateVoiceState(d));
 */
class Lavvy extends EventEmitter {
  /**
   * @param {object} client - Discord client instance
   * @param {object[]} nodeConfigs - Array of node connection options
   * @param {object} [options={}]
   * @param {string} [options.defaultSearchPlatform='ytsearch'] - Default search prefix
   * @param {Function} [options.send] - Custom gateway send function
   */
  constructor(client, nodeConfigs, options = {}) {
    super();
    this.client = client;
    this.userId = null;
    /** @type {Node[]} */
    this.nodes = [];
    /** @type {Map<string, Player>} */
    this.players = new Map();
    /** @type {Map<string, object>} */
    this._voiceStates = new Map();
    this._nodeConfigs = nodeConfigs;
    this._send = options.send ?? null;
    this.defaultSearchPlatform = options.defaultSearchPlatform ?? 'ytsearch';
    this._plugins = [];
  }

  /**
   * Initialize Lavvy and connect to all configured nodes.
   * @param {string} userId - The bot's user ID
   * @returns {Lavvy}
   */
  init(userId) {
    this.userId = userId;
    for (const cfg of this._nodeConfigs) {
      const node = new Node(this, cfg);
      this.nodes.push(node);
      node.connect();
    }
    for (const plugin of this._plugins) {
      if (typeof plugin.init === 'function') plugin.init(this);
    }
    return this;
  }

  /**
   * Register a plugin.
   * @param {object} plugin - Plugin with an optional `init(lavvy)` method
   * @returns {Lavvy}
   */
  use(plugin) {
    if (typeof plugin !== 'object') throw new Error('Plugin must be an object');
    this._plugins.push(plugin);
    if (this.userId && typeof plugin.init === 'function') plugin.init(this);
    return this;
  }

  /**
   * Get the best available node (least penalties).
   * @returns {Node}
   */
  idealNode() {
    const available = this.nodes.filter((n) => n.connected);
    if (!available.length) throw new Error('No available Lavalink nodes');
    return available.sort((a, b) => a.penalties - b.penalties)[0];
  }

  /**
   * Create or retrieve a player for a guild.
   * @param {object} options
   * @param {string} options.guildId
   * @param {string} [options.voiceChannelId]
   * @param {string} [options.textChannelId]
   * @param {boolean} [options.selfDeaf=true]
   * @param {boolean} [options.selfMute=false]
   * @param {number} [options.volume=100]
   * @param {Node} [options.node] - Specific node to use
   * @returns {Player}
   */
  createPlayer(options) {
    if (this.players.has(options.guildId)) return this.players.get(options.guildId);
    const node = options.node ?? this.idealNode();
    const player = new Player(this, node, options);
    this.players.set(options.guildId, player);
    this.emit('playerCreate', player);
    return player;
  }

  /**
   * Get an existing player.
   * @param {string} guildId
   * @returns {Player|undefined}
   */
  getPlayer(guildId) {
    return this.players.get(guildId);
  }

  /**
   * Destroy a player.
   * @param {string} guildId
   * @returns {Promise<void>}
   */
  async destroyPlayer(guildId) {
    const player = this.players.get(guildId);
    if (player) await player.destroy();
  }

  /**
   * Search for tracks.
   * @param {string} query - Search query or URL
   * @param {string} [source] - Search platform prefix
   * @returns {Promise<object>}
   */
  async search(query, source) {
    const node = this.idealNode();
    const identifier = /^https?:\/\//.test(query)
      ? query
      : `${source ?? this.defaultSearchPlatform}:${query}`;
    return node.rest.loadTracks(identifier);
  }

  /**
   * Handle raw gateway packets for voice state tracking.
   * Call this with every raw Discord gateway event.
   * @param {object} data - Raw gateway event (with t and d fields)
   */
  updateVoiceState(data) {
    if (!data.t || !data.d) return;

    if (data.t === 'VOICE_STATE_UPDATE') {
      if (data.d.user_id !== this.userId) return;
      const guildId = data.d.guild_id;
      const state = this._voiceStates.get(guildId) ?? {};
      state.sessionId = data.d.session_id;
      this._voiceStates.set(guildId, state);
      this._dispatchVoice(guildId);
    }

    if (data.t === 'VOICE_SERVER_UPDATE') {
      const guildId = data.d.guild_id;
      const state = this._voiceStates.get(guildId) ?? {};
      state.token = data.d.token;
      state.endpoint = data.d.endpoint;
      this._voiceStates.set(guildId, state);
      this._dispatchVoice(guildId);
    }
  }

  /**
   * Send a voice gateway payload to Discord.
   * @param {string} guildId
   * @param {string|null} channelId
   * @param {boolean} [mute=false]
   * @param {boolean} [deaf=true]
   * @internal
   */
  sendGateway(guildId, channelId, mute = false, deaf = true) {
    const payload = {
      op: 4,
      d: { guild_id: guildId, channel_id: channelId, self_mute: mute, self_deaf: deaf },
    };

    if (this._send) {
      this._send(guildId, payload);
      return;
    }

    // discord.js
    const guild = this.client.guilds?.cache?.get(guildId);
    if (guild?.shard) {
      guild.shard.send(payload);
    } else if (this.client.ws) {
      // eris-style or other
      const shard = this.client.ws.shards?.get(0) ?? this.client.ws;
      if (typeof shard.send === 'function') shard.send(JSON.stringify(payload));
    }
  }

  /**
   * Forward voice credentials to Lavalink when both parts arrive.
   * @param {string} guildId
   * @internal
   */
  _dispatchVoice(guildId) {
    const state = this._voiceStates.get(guildId);
    if (!state?.sessionId || !state?.token || !state?.endpoint) return;

    const player = this.players.get(guildId);
    if (!player) return;

    player.voice = { ...state };
    player.node.rest.updatePlayer(guildId, { voice: state }).catch((err) => {
      this.emit('nodeError', player.node, err);
    });

    this._voiceStates.delete(guildId);
  }
}

module.exports = { Lavvy };
