'use strict';

/** Filter presets for Lavalink v4. */
const Presets = {
  bassboost: {
    equalizer: [
      { band: 0, gain: 0.6 }, { band: 1, gain: 0.7 },
      { band: 2, gain: 0.8 }, { band: 3, gain: 0.55 },
      { band: 4, gain: 0.25 },
    ],
  },
  nightcore: {
    timescale: { speed: 1.3, pitch: 1.3, rate: 1.0 },
  },
  vaporwave: {
    timescale: { speed: 0.85, pitch: 0.9, rate: 1.0 },
    equalizer: [
      { band: 0, gain: 0.3 }, { band: 1, gain: 0.3 },
    ],
  },
  tremolo: {
    tremolo: { frequency: 4.0, depth: 0.75 },
  },
  karaoke: {
    karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 },
  },
  rotation: {
    rotation: { rotationHz: 0.2 },
  },
  distortion: {
    distortion: {
      sinOffset: 0, sinScale: 1, cosOffset: 0, cosScale: 1,
      tanOffset: 0, tanScale: 1, offset: 0, scale: 1,
    },
  },
};

/**
 * Audio filter manager for a player.
 */
class Filters {
  /** @param {import('./Player').Player} player */
  constructor(player) {
    this.player = player;
    /** @type {object} Currently active filter state */
    this.active = {};
  }

  /**
   * Apply raw filter data to the player.
   * @param {object} filters - Lavalink filter payload
   */
  async apply(filters) {
    Object.assign(this.active, filters);
    return this.player.node.rest.updatePlayer(this.player.guildId, { filters: this.active });
  }

  /**
   * Apply a named preset.
   * @param {string} name - Preset name
   */
  async set(name) {
    const preset = Presets[name];
    if (!preset) throw new Error(`Unknown filter preset: ${name}`);
    return this.apply(preset);
  }

  /** @param {object[]} bands - EQ band array */
  async equalizer(bands) { return this.apply({ equalizer: bands }); }

  async bassboost() { return this.set('bassboost'); }
  async nightcore() { return this.set('nightcore'); }
  async vaporwave() { return this.set('vaporwave'); }
  async tremolo() { return this.set('tremolo'); }
  async karaoke() { return this.set('karaoke'); }
  async rotation() { return this.set('rotation'); }
  async distortion() { return this.set('distortion'); }

  /** Reset all filters. */
  async reset() {
    this.active = {};
    return this.player.node.rest.updatePlayer(this.player.guildId, { filters: {} });
  }
}

module.exports = { Filters, Presets };
