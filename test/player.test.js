const test = require('node:test'),
  assert = require('node:assert/strict');
require('../js/core.js');
require('../js/mediasession.js');
const P = require('../js/player.js');
globalThis.MediaMetadata = class {
  constructor(x) {
    Object.assign(this, x);
  }
};

class FakeAudio extends EventTarget {
  constructor() {
    super();
    this._src = null;
    this.srcSets = 0;
    this.paused = true;
    this.ended = false;
    this.currentTime = 0;
    this.duration = NaN;
    this.volume = 1;
    this.muted = false;
    this.playbackRate = 1;
    this.buffered = { length: 0, end: () => 0 };
  }
  get src() {
    return this._src || '';
  }
  set src(v) {
    this._src = v;
    this.srcSets++;
    this.duration = 30;
    this.currentTime = 0;
    this.ended = false;
  }
  getAttribute(k) {
    return k === 'src' ? this._src : null;
  }
  removeAttribute(k) {
    if (k === 'src') {
      this._src = null;
      this.duration = NaN;
    }
  }
  load() {}
  play() {
    if (this.block) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    this.paused = false;
    queueMicrotask(() => this.dispatchEvent(new Event('playing')));
    return Promise.resolve();
  }
  pause() {
    if (!this.paused) {
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    }
  }
  fire(n) {
    this.dispatchEvent(new Event(n));
  }
  end() {
    this.currentTime = this.duration;
    this.ended = true;
    this.paused = true;
    this.fire('pause');
    this.fire('ended');
  }
}
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const tr = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: 'k' + i, title: 'T' + i, artist: 'A', source: 't' }));
function rig(extra = {}) {
  const calls = [],
    audios = [new FakeAudio(), new FakeAudio()],
    handlers = {};
  const ms = {
    setActionHandler: (k, f) => {
      handlers[k] = f;
    },
    setPositionState() {},
    playbackState: 'none',
    metadata: null,
  };
  const resolve = async (t) => {
    calls.push(t.id);
    if (extra.fail && extra.fail(t, calls.length)) throw new Error('boom');
    return { url: 'u:' + t.id, bitrate: 128 };
  };
  const player = P.create({ audios, resolve, mediaSession: ms, retryBase: 1, ...(extra.opts || {}) });
  const activeEl = () => audios.find((a) => !a.paused),
    idleEl = () => audios.find((a) => a.paused);
  return { player, audios, calls, handlers, ms, activeEl, idleEl };
}

test('starts, publishes Media Session metadata and registers lock-screen handlers', async () => {
  const r = rig();
  await r.player.setQueue(tr(3), 0);
  await tick();
  assert.equal(r.player.state(), 'playing');
  assert.equal(r.ms.metadata.title, 'T0');
  assert.equal(r.ms.playbackState, 'playing');
  for (const a of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto'])
    assert.equal(typeof r.handlers[a], 'function');
});
test('preloads the next track on the idle element; advancing on ended does not re-resolve', async () => {
  const r = rig();
  await r.player.setQueue(tr(3), 0);
  await tick();
  const a = r.activeEl(),
    idle = r.idleEl();
  assert.equal(idle.getAttribute('src'), 'u:k1');
  const before = r.calls.filter((c) => c === 'k1').length;
  a.end();
  await tick();
  assert.equal(r.player.current().id, 'k1');
  assert.equal(r.calls.filter((c) => c === 'k1').length, before);
  assert.equal(r.activeEl(), idle);
  assert.equal(idle.srcSets, 1); // the preloaded element was reused as is (src set once, by the preload)
  assert.equal(a.getAttribute('src'), 'u:k2'); // the freed element now preloads k2
});
test('a media error evicts the cached URL, re-resolves a fresh one and resumes at the same position', async () => {
  const r = rig();
  await r.player.setQueue(tr(2), 0);
  await tick();
  const a = r.activeEl();
  a.currentTime = 12;
  a.fire('timeupdate');
  a.error = { code: 4 };
  a.fire('error');
  await tick(40);
  assert.equal(r.calls.filter((c) => c === 'k0').length, 2); // second resolve = fresh URL, not the cached one
  assert.equal(r.player.state(), 'playing');
  assert.equal(r.player.current().id, 'k0');
  assert.equal(r.activeEl().currentTime, 12);
});
test('repeat modes: off ends the queue, all wraps, one replays', async () => {
  let r = rig();
  await r.player.setQueue(tr(2), 0);
  await tick();
  let ended = 0;
  r.player.on('queue-end', () => ended++);
  r.activeEl().end();
  await tick();
  r.activeEl().end();
  await tick();
  assert.equal(ended, 1);
  assert.equal(r.player.state(), 'paused');
  r = rig();
  r.player.setRepeat('all');
  await r.player.setQueue(tr(2), 0);
  await tick();
  r.activeEl().end();
  await tick();
  r.activeEl().end();
  await tick();
  assert.equal(r.player.current().id, 'k0');
  assert.equal(r.player.state(), 'playing');
  r = rig();
  r.player.setRepeat('one');
  await r.player.setQueue(tr(3), 0);
  await tick();
  r.activeEl().end();
  await tick();
  assert.equal(r.player.current().id, 'k0');
  assert.equal(r.player.state(), 'playing');
});
test('prev: restarts after 3 s, otherwise goes back; seekto handler seeks', async () => {
  const r = rig();
  await r.player.setQueue(tr(3), 1);
  await tick();
  r.activeEl().currentTime = 5;
  r.player.prev();
  await tick();
  assert.equal(r.player.index(), 1);
  assert.equal(r.activeEl().currentTime, 0);
  r.player.prev();
  await tick();
  assert.equal(r.player.index(), 0);
  r.handlers.seekto({ seekTime: 7 });
  assert.equal(r.activeEl().currentTime, 7);
});
test('shuffle keeps the current track first, is a permutation, and restores order when turned off', async () => {
  const r = rig();
  await r.player.setQueue(tr(8), 3);
  await tick();
  r.player.setShuffle(true);
  assert.equal(r.player.current().id, 'k3');
  assert.equal(r.player.index(), 0);
  assert.deepEqual(
    r.player
      .queue()
      .map((t) => t.id)
      .sort(),
    tr(8)
      .map((t) => t.id)
      .sort(),
  );
  r.player.setShuffle(false);
  assert.equal(r.player.index(), 3);
  assert.deepEqual(
    r.player.queue().map((t) => t.id),
    tr(8).map((t) => t.id),
  );
});
test('a failed resolve is retried with backoff, then playback starts', async () => {
  const r = rig({ fail: (t, n) => n === 1 });
  let retries = 0;
  r.player.on('retry', () => retries++);
  await r.player.setQueue(tr(2), 0);
  await tick(40);
  assert.equal(retries, 1);
  assert.equal(r.player.state(), 'playing');
  assert.equal(r.player.current().id, 'k0');
});
test('after the retries are used up the track is skipped and an error is emitted', async () => {
  const r = rig({ fail: (t) => t.id === 'k0' });
  let errors = 0;
  r.player.on('error', () => errors++);
  await r.player.setQueue(tr(2), 0);
  await tick(80);
  assert.equal(errors, 1);
  assert.equal(r.player.current().id, 'k1');
  assert.equal(r.player.state(), 'playing');
});
test('autoplay blocked by the browser -> "blocked" event, state paused (no error / skip)', async () => {
  const r = rig();
  r.audios[1].block = true;
  let blocked = 0,
    errors = 0;
  r.player.on('blocked', () => blocked++);
  r.player.on('error', () => errors++);
  await r.player.setQueue(tr(2), 0);
  await tick();
  assert.equal(blocked, 1);
  assert.equal(errors, 0);
  assert.equal(r.player.state(), 'paused');
});
test('resolved URLs are cached: replaying a track does not call resolve again', async () => {
  const r = rig();
  await r.player.setQueue(tr(1), 0);
  await tick();
  await r.player.setQueue(tr(1), 0);
  await tick();
  assert.equal(r.calls.filter((c) => c === 'k0').length, 1);
});
test('crossfade: the next track starts before the end; the outgoing element is released afterwards', async () => {
  const r = rig({ opts: { crossfadeMs: 120 } });
  await r.player.setQueue(tr(2), 0);
  await tick();
  const a = r.activeEl(),
    idle = r.idleEl();
  a.currentTime = 29.95;
  a.fire('timeupdate');
  await tick(250);
  assert.equal(r.player.current().id, 'k1');
  assert.equal(idle.volume, 1);
  assert.equal(idle.paused, false);
  assert.equal(a.getAttribute('src'), null);
});
test('imported tracks (source "import") are matched to a playable track before resolving', async () => {
  const seen = [];
  const r = rig({
    opts: { match: async (t) => ({ id: 'real', title: t.title, artist: 'Real', source: 't' }) },
  });
  r.player.on('track', (t) => seen.push(t.id));
  await r.player.setQueue([{ id: 'imp-1', title: 'X', artist: 'Y', source: 'import' }], 0);
  await tick();
  assert.equal(r.player.current().id, 'real');
  assert.deepEqual(r.calls, ['real']);
});
