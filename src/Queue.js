'use strict';

/**
 * Track queue with loop support.
 */
class Queue {
  constructor() {
    /** @type {object[]} */
    this.tracks = [];
    /** @type {object|null} */
    this.current = null;
    /** @type {object|null} */
    this.previous = null;
    /** @type {'off'|'track'|'queue'} */
    this.loop = 'off';
  }

  /** @returns {number} Number of tracks in queue */
  get size() { return this.tracks.length; }

  /** @returns {boolean} Whether queue is empty */
  get empty() { return this.tracks.length === 0; }

  /** @returns {number} Total duration of queued tracks in ms */
  get duration() {
    return this.tracks.reduce((a, t) => a + (t.info?.length ?? 0), 0);
  }

  /**
   * Add one or more tracks to the queue.
   * @param {object|object[]} track - Track or array of tracks
   * @param {number} [position] - Insert position (appends if omitted)
   */
  add(track, position) {
    const items = Array.isArray(track) ? track : [track];
    if (typeof position === 'number') {
      this.tracks.splice(position, 0, ...items);
    } else {
      this.tracks.push(...items);
    }
  }

  /**
   * Remove a track by index.
   * @param {number} index
   * @returns {object|null} Removed track or null
   */
  remove(index) {
    if (index < 0 || index >= this.tracks.length) return null;
    return this.tracks.splice(index, 1)[0];
  }

  /** Clear all tracks from the queue. */
  clear() { this.tracks = []; }

  /** Shuffle the queue using Fisher-Yates. */
  shuffle() {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
  }

  /**
   * Advance to the next track, respecting loop mode.
   * @returns {object|null} The next track or null
   */
  next() {
    this.previous = this.current;

    if (this.loop === 'track' && this.current) return this.current;

    if (this.loop === 'queue' && this.current) {
      this.tracks.push(this.current);
    }

    this.current = this.tracks.shift() ?? null;
    return this.current;
  }

  /**
   * Set the loop mode.
   * @param {'off'|'track'|'queue'} mode
   */
  setLoop(mode) {
    if (!['off', 'track', 'queue'].includes(mode)) {
      throw new Error(`Invalid loop mode: ${mode}`);
    }
    this.loop = mode;
  }
}

module.exports = { Queue };
