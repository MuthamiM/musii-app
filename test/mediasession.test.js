const test = require('node:test'),
  assert = require('node:assert/strict');
require('../js/core.js');
const MS = require('../js/mediasession.js');
globalThis.MediaMetadata = class {
  constructor(x) {
    Object.assign(this, x);
  }
};
const fake = () => {
  const h = {};
  return {
    h,
    s: {
      setActionHandler: (k, f) => {
        h[k] = f;
      },
      setPositionState(x) {
        this.pos = x;
      },
      playbackState: 'none',
      metadata: null,
    },
  };
};

test('registers only the actions it was given; seek helpers use time()', () => {
  const { h, s } = fake();
  let seeked = null;
  const m = MS.create(
    {
      play() {},
      pause() {},
      next() {},
      seek: (x) => {
        seeked = x;
      },
      time: () => 50,
    },
    { session: s },
  );
  assert.deepEqual(Object.keys(h).sort(), [
    'nexttrack',
    'pause',
    'play',
    'seekbackward',
    'seekforward',
    'seekto',
  ]);
  h.seekto({ seekTime: 12 });
  assert.equal(seeked, 12);
  h.seekforward({});
  assert.equal(seeked, 60);
  h.seekbackward({ seekOffset: 5 });
  assert.equal(seeked, 45);
  m.destroy();
  assert.equal(h.play, null);
});
test('metadata, playback state and throttled / clamped position state', () => {
  const { s } = fake();
  const m = MS.create({ play() {} }, { session: s });
  m.setTrack({ title: 'T', artist: 'A', cover: 'https://x/y.jpg' });
  assert.equal(s.metadata.title, 'T');
  assert.equal(s.metadata.artwork[0].src, 'https://x/y.jpg');
  m.setState('playing');
  assert.equal(s.playbackState, 'playing');
  m.setState('idle');
  assert.equal(s.playbackState, 'none');
  m.setPosition(10, 200, 1, true);
  assert.deepEqual(s.pos, { duration: 200, playbackRate: 1, position: 10 });
  s.pos = null;
  m.setPosition(11, 200);
  assert.equal(s.pos, null); // throttled to 1 per second
  m.setPosition(300, 200, 1, true);
  assert.equal(s.pos.position, 200); // clamped to the duration
  s.pos = null;
  m.setPosition(1, NaN, 1, true);
  assert.equal(s.pos, null); // unknown duration: ignored
});
test('no Media Session support: every call is a harmless no-op', () => {
  const m = MS.create({ play() {} }, { session: null });
  assert.equal(m.supported, false);
  m.setTrack({ title: 'x' });
  m.setState('playing');
  m.setPosition(1, 2, 1, true);
  m.destroy();
});
