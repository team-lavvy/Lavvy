'use strict';

const { Queue } = require('./Queue');
const { Filters } = require('./Filters');

/**
 * Represents a guild audio player.
 */
class Player {
  /**
   * @param {import('./Lavvy').Lavvy} lavvy
   * @param {import('./Node').Node} node
   * @param {object} options
   */
  constructor(lavvy, node, options) {
    this.lavvy = lavvy;
    this.node = node;
    this.guildId = options.guildId;
    this.voiceChannelId = options.voiceChannelId ?? null;
    this.textChannelId = options.textChannelId ?? null;
    this.selfDeaf = options.selfDeaf ?? true;
    this.selfMute = options.selfMute ?? false;
    this.volume = options.volume ?? 100;
    this.playing = false;
    this.paused = false;
    this.position = 0;
    this.connected = false;
    this.queue = new Queue();
    this.filters = new Filters(this);
    this.voice = { sessionId: null, token: null, endpoint: null };
  }

  /**
   * Connect to the voice channel.
   * @returns {Promise<Player>}
   */
  async connect() {
    if (!this.voiceChannelId) throw new Error('No voice channel set');
    this.lavvy.sendGateway(this.guildId, this.voiceChannelId, this.selfMute, this.selfDeaf);
    this.connected = true;
    return this;
  }

  /**
   * Disconnect from the voice channel.
   * @returns {Promise<Player>}
   */
  async disconnect() {
    this.lavvy.sendGateway(this.guildId, null);
    this.voiceChannelId = null;
    this.connected = false;
    return this;
  }

  /**
   * Play a track or the next track in queue.
   * @param {object} [track] - Track object with `encoded` field
   * @param {object} [options] - Play options
   * @param {number} [options.startTime] - Start position in ms
   * @param {number} [options.endTime] - End position in ms
   * @param {boolean} [options.noReplace] - Don't replace current track
   * @returns {Promise<Player>}
   */
  async play(track, options = {}) {
    if (track) {
      this.queue.current = track;
    } else if (!this.queue.current) {
      this.queue.current = this.queue.next();
    }

    if (!this.queue.current) return this;

    const payload = {
      track: { encoded: this.queue.current.encoded },
      volume: this.volume,
    };

    if (options.startTime) payload.position = options.startTime;
    if (options.endTime) payload.endTime = options.endTime;

    await this.node.rest.updatePlayer(this.guildId, payload, !!options.noReplace);
    this.playing = true;
    this.paused = false;
    return this;
  }

  /**
   * Stop the current track.
   * @returns {Promise<Player>}
   */
  async stop() {
    await this.node.rest.updatePlayer(this.guildId, { track: { encoded: null } });
    this.playing = false;
    this.position = 0;
    return this;
  }

  /**
   * Pause playback.
   * @returns {Promise<Player>}
   */
  async pause() {
    await this.node.rest.updatePlayer(this.guildId, { paused: true });
    this.paused = true;
    this.playing = false;
    return this;
  }

  /**
   * Resume playback.
   * @returns {Promise<Player>}
   */
  async resume() {
    await this.node.rest.updatePlayer(this.guildId, { paused: false });
    this.paused = false;
    this.playing = true;
    return this;
  }

  /**
   * Seek to a position.
   * @param {number} position - Position in ms
   * @returns {Promise<Player>}
   */
  async seek(position) {
    await this.node.rest.updatePlayer(this.guildId, { position });
    return this;
  }

  /**
   * Set the player volume.
   * @param {number} volume - Volume (0-1000)
   * @returns {Promise<Player>}
   */
  async setVolume(volume) {
    this.volume = Math.max(0, Math.min(1000, volume));
    await this.node.rest.updatePlayer(this.guildId, { volume: this.volume });
    return this;
  }

  /**
   * Destroy the player and disconnect.
   * @returns {Promise<void>}
   */
  async destroy() {
    await this.disconnect();
    await this.node.rest.destroyPlayer(this.guildId);
    this.queue.clear();
    this.playing = false;
    this.lavvy.players.delete(this.guildId);
    this.lavvy.emit('playerDestroy', this);
  }

  /**
   * Handle a Lavalink player event.
   * @param {object} data - Event payload
   * @internal
   */
  handleEvent(data) {
    switch (data.type) {
      case 'TrackStartEvent':
        this.playing = true;
        this.paused = false;
        this.lavvy.emit('trackStart', this, data.track);
        break;

      case 'TrackEndEvent':
        this.playing = false;
        this.lavvy.emit('trackEnd', this, data.track, data.reason);
        if (['loadFailed', 'cleanup'].includes(data.reason)) break;

        const next = this.queue.next();
        if (next) {
          this.play();
        } else {
          this.queue.current = null;
          this.lavvy.emit('queueEnd', this);
        }
        break;

      case 'TrackExceptionEvent':
        this.lavvy.emit('trackError', this, data.track, data.exception);
        break;

      case 'TrackStuckEvent':
        this.lavvy.emit('trackStuck', this, data.track, data.thresholdMs);
        break;

      case 'WebSocketClosedEvent':
        this.lavvy.emit('playerWebSocketClosed', this, data);
        break;
    }
  }
}

module.exports = { Player };
