<p align="center">
  <picture>
    <img src=".github/assets/banner.png" alt="Lavvy" height="150" />
  </picture>
</p>

<p align="center">
  <b>Minimalist Lavalink v4 client for Node.js</b><br/>
  Zero dependencies. Clean code. No bloat.
</p>

<p align="center">
  <a href="https://github.com/team-lavvy/Lavvy"><img src="https://img.shields.io/github/stars/team-lavvy/Lavvy?style=flat-square&color=f97316" alt="Stars" /></a>
  <a href="https://www.npmjs.com/package/lavvy"><img src="https://img.shields.io/npm/v/lavvy?style=flat-square&color=f97316" alt="npm" /></a>
  <a href="https://github.com/team-lavvy/Lavvy/blob/main/LICENSE"><img src="https://img.shields.io/github/license/team-lavvy/Lavvy?style=flat-square&color=f97316" alt="License" /></a>
  <a href="https://github.com/team-lavvy/Lavvy/actions"><img src="https://img.shields.io/github/actions/workflow/status/team-lavvy/Lavvy/test.yml?style=flat-square&color=f97316&label=tests" alt="Tests" /></a>
</p>

---

## Why Lavvy?

Most Lavalink clients are bloated with abstractions you don't need. Lavvy is different — it gives you everything required to build a production music bot in under 500 lines of source, with zero external dependencies.

| | |
|---|---|
| **Full Lavalink v4** | WebSocket + REST, session resume, all endpoints covered |
| **Multi-node** | Auto failover and least-load balancing across nodes |
| **Audio filters** | Bassboost, nightcore, vaporwave, tremolo, karaoke, rotation, distortion |
| **Built-in queue** | Add, remove, shuffle, clear, loop modes (track and queue) |
| **Plugin system** | Extend behavior with `lavvy.use(plugin)` |
| **Zero dependencies** | Only Node.js built-ins — nothing to install, nothing to break |

---

## Install

```bash
npm install lavvy
```

## Quick Start

```js
const { Client, GatewayIntentBits } = require('discord.js');
const { Lavvy } = require('lavvy');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const lavvy = new Lavvy(client, [
  { name: 'Main', host: '127.0.0.1', port: 2333, password: 'youshallnotpass' },
]);

client.on('ready', () => {
  lavvy.init(client.user.id);
  console.log(`${client.user.tag} is online with Lavvy`);
});

// Forward raw gateway events for voice handling
client.on('raw', (d) => lavvy.updateVoiceState(d));

client.login('YOUR_BOT_TOKEN');
```

## Playing a Track

```js
async function play(guildId, voiceChannelId, query) {
  const player = lavvy.createPlayer({ guildId, voiceChannelId, selfDeaf: true });
  await player.connect();

  const result = await lavvy.search(query);
  if (result.loadType === 'search') {
    player.queue.add(result.data[0]);
    await player.play();
  }
}
```

## Queue

```js
player.queue.add(track);          // add a track
player.queue.add(tracks);         // add multiple tracks
player.queue.add(track, 0);       // insert at position
player.queue.remove(2);           // remove by index
player.queue.shuffle();           // shuffle the queue
player.queue.clear();             // clear the queue
player.queue.setLoop('track');    // 'off' | 'track' | 'queue'

player.queue.size;                // queued track count
player.queue.current;             // currently playing track
player.queue.duration;            // total queue duration (ms)
```

## Player Controls

```js
await player.play(track);         // play a specific track
await player.play();              // play next from queue
await player.pause();             // pause playback
await player.resume();            // resume playback
await player.stop();              // stop current track
await player.seek(30000);         // seek to 30s
await player.setVolume(80);       // volume (0-1000)
await player.destroy();           // destroy and disconnect
```

## Audio Filters

```js
await player.filters.bassboost();
await player.filters.nightcore();
await player.filters.vaporwave();
await player.filters.tremolo();
await player.filters.karaoke();
await player.filters.rotation();
await player.filters.distortion();
await player.filters.reset();

// Custom EQ
await player.filters.equalizer([
  { band: 0, gain: 0.5 },
  { band: 1, gain: 0.3 },
]);
```

## Events

```js
lavvy.on('nodeConnect',    (node) => { });
lavvy.on('nodeDisconnect', (node) => { });
lavvy.on('nodeError',      (node, error) => { });
lavvy.on('nodeReconnect',  (node, attempt) => { });
lavvy.on('trackStart',     (player, track) => { });
lavvy.on('trackEnd',       (player, track, reason) => { });
lavvy.on('trackError',     (player, track, error) => { });
lavvy.on('trackStuck',     (player, track, threshold) => { });
lavvy.on('queueEnd',       (player) => { });
lavvy.on('playerCreate',   (player) => { });
lavvy.on('playerDestroy',  (player) => { });
```

## Plugins

```js
const myPlugin = {
  init(lavvy) {
    lavvy.on('trackStart', (player, track) => {
      console.log(`Now playing: ${track.info.title}`);
    });
  },
};

lavvy.use(myPlugin);
```

## REST API

Each node exposes the full Lavalink v4 REST API:

```js
const node = lavvy.idealNode();

await node.rest.loadTracks('ytsearch:never gonna give you up');
await node.rest.decodeTrack(encodedTrack);
await node.rest.decodeTracks([track1, track2]);
await node.rest.getPlayers();
await node.rest.getPlayer(guildId);
await node.rest.updatePlayer(guildId, data);
await node.rest.destroyPlayer(guildId);
await node.rest.updateSession(data);
await node.rest.getInfo();
await node.rest.getStats();
await node.rest.getVersion();
await node.rest.getRoutePlannerStatus();
await node.rest.freeRoutePlannerAddress(address);
await node.rest.freeAllRoutePlannerAddresses();
```

## Multi-Node

```js
const lavvy = new Lavvy(client, [
  { name: 'US-East', host: 'us-east.example.com', port: 2333, password: 'pass1' },
  { name: 'EU-West', host: 'eu-west.example.com', port: 2333, password: 'pass2' },
]);
```

Lavvy picks the node with the lowest penalty score. If a node goes down, active players are automatically migrated to the next best node.

## Structure

```
src/
  Lavvy.js         Main client — nodes, players, voice state, plugins
  Node.js          WebSocket + REST per Lavalink node
  Player.js        Player controls per guild
  Queue.js         Queue with loop support
  Filters.js       Audio filter presets
index.js           Package entry point
```

## Requirements

- **Node.js** >= 18.0.0
- **Lavalink** v4

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built by <a href="https://github.com/team-lavvy">team-lavvy</a></sub>
</p>

## Contributors

<a href="https://github.com/team-lavvy/Lavvy/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=team-lavvy/Lavvy" />
</a>