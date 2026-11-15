const test = require('node:test'),
  assert = require('node:assert/strict'),
  { JSDOM } = require('jsdom');
require('../js/core.js');
const L = require('../js/lyrics.js');
const memStore = () => {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => {
      m[k] = String(v);
    },
  };
};
const REC = {
  id: 7,
  trackName: 'Last Dance',
  artistName: 'Wakadinali',
  albumName: 'Last Dance',
  duration: 200,
  instrumental: false,
  plainLyrics: 'one\ntwo',
  syncedLyrics: '[00:01.00]one\n[00:05.00]two',
};
const TR = { title: 'Last Dance', artist: 'Wakadinali', album: 'Last Dance', durationSec: 200 };
const mk = (routes) => {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const r = routes(new URL(url));
    return {
      ok: r !== null && r !== 'err',
      status: r === null ? 404 : r === 'err' ? 500 : 200,
      json: async () => r,
    };
  };
  f.calls = calls;
  return f;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = () => {
  const { window } = new JSDOM('<div id="r"></div>', { pretendToBeVisual: true });
  return { window, root: window.document.getElementById('r') };
};

test('parseLRC: multi-stamp lines, fractions, leading stamps only, collapses empty gaps', () => {
  const l = L.parseLRC(
    '[ar:X]\n[00:12.5]hi\n[01:00.25][00:30]twice <00:31.00>word\n[00:40.00] keep [00:41] inside\n' +
      '[00:50]\n[00:51]\n[00:55.123]end',
  );
  assert.deepEqual(
    l.map((x) => Math.round(x.t * 1000) / 1000),
    [12.5, 30, 40, 50, 55.123, 60.25],
  );
  assert.equal(l[1].text, 'twice word');
  assert.equal(l[2].text, 'keep [00:41] inside');
  assert.equal(l[3].text, '');
});
test('activeIndex: binary search, -1 before the first line', () => {
  const l = L.parseLRC('[00:01]a\n[00:05]b\n[00:09]c');
  assert.deepEqual(
    [0, 1, 4.99, 5, 8, 100].map((t) => L.activeIndex(l, t)),
    [-1, 0, 0, 1, 1, 2],
  );
});
test('pick: right version wins (title + artist + duration); wrong songs are rejected', () => {
  const tr = { title: 'Golden Hour (Official Video)', artist: 'Savanna Static - Topic', durationSec: 26 };
  const list = [
    { trackName: 'Golden Hour', artistName: 'Other Band', duration: 26, syncedLyrics: '[00:01]x' },
    { trackName: 'Golden Hour', artistName: 'Savanna Static', duration: 180, syncedLyrics: '[00:01]x' },
    { trackName: 'Golden Hour', artistName: 'Savanna Static', duration: 25, syncedLyrics: '[00:01]x', id: 3 },
  ];
  assert.equal(L.pick(tr, list).id, 3);
  assert.equal(L.pick({ title: 'Totally Different', artist: 'Nobody' }, list), null);
});
test('create(): /get then /search fallback; cached in memory and in storage', async () => {
  const f = mk((u) => (u.pathname.endsWith('/get') ? null : u.pathname.endsWith('/search') ? [REC] : null));
  const store = memStore(),
    lyr = L.create({ fetch: f, storage: store });
  const r = await lyr.get(TR);
  assert.equal(r.status, 'synced');
  assert.equal(r.cached, false);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0], /\/get\?/);
  assert.match(f.calls[1], /\/search\?/);
  assert.equal((await lyr.get(TR)).cached, true);
  assert.equal(f.calls.length, 2); // memory hit
  const r3 = await L.create({ fetch: f, storage: store }).get(TR); // fresh page load: storage hit
  assert.equal(r3.cached, true);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(
    r3.lines.map((x) => x.text),
    ['one', 'two'],
  );
});
test('create(): a /get hit needs one request; plain-only and instrumental records are shaped', async () => {
  const f = mk((u) => (u.pathname.endsWith('/get') ? REC : null));
  assert.equal((await L.create({ fetch: f, storage: memStore() }).get(TR)).status, 'synced');
  assert.equal(f.calls.length, 1);
  const plain = mk(() => [{ ...REC, syncedLyrics: null }]);
  assert.equal(
    (await L.create({ fetch: plain, storage: memStore() }).get({ title: 'Last Dance', artist: 'Wakadinali' }))
      .status,
    'plain',
  );
  const inst = mk(() => [{ ...REC, instrumental: true, plainLyrics: null, syncedLyrics: null }]);
  assert.equal(
    (await L.create({ fetch: inst, storage: memStore() }).get({ title: 'Last Dance', artist: 'Wakadinali' }))
      .status,
    'instrumental',
  );
});
test('create(): misses are cached, network errors are not', async () => {
  const none = mk(() => []),
    l2 = L.create({ fetch: none, storage: memStore() });
  assert.equal((await l2.get({ title: 'Nope', artist: 'Nobody' })).status, 'none');
  const n = none.calls.length;
  await l2.get({ title: 'Nope', artist: 'Nobody' });
  assert.equal(none.calls.length, n);
  const bad = mk(() => 'err'),
    l3 = L.create({ fetch: bad, storage: memStore() });
  assert.equal((await l3.get({ title: 'X', artist: 'Y' })).status, 'error');
  const c = bad.calls.length;
  await l3.get({ title: 'X', artist: 'Y' });
  assert.ok(bad.calls.length > c);
});
test('overlay: active line is bright, neighbours get data-d distance, click seeks, states render', async () => {
  const { root } = page();
  let t = 0,
    seeked = null;
  const ov = L.overlay(root, {
    getTime: () => t,
    seek: (s) => {
      seeked = s;
    },
    isPlaying: () => true,
  });
  try {
    ov.render({ status: 'synced', lines: L.parseLRC('[00:01.00]a\n[00:05.00]b\n[00:09.00]c\n[00:13.00]d') });
    const lines = () => [...root.querySelectorAll('.ly-line')];
    assert.equal(lines().length, 4);
    assert.equal(lines().filter((n) => n.classList.contains('on')).length, 0); // before the first line
    t = 5.2;
    await sleep(60);
    assert.ok(lines()[1].classList.contains('on'));
    assert.deepEqual(
      lines().map((n) => n.dataset.d),
      ['1', '0', '1', '2'],
    );
    lines()[2].click();
    assert.equal(seeked, 9);
    ov.setOffset(1); // offset > 0 shows lines earlier
    lines()[3].click();
    assert.equal(seeked, 12);
    ov.render({ status: 'none' });
    assert.match(root.querySelector('.ly-msg').textContent, /No lyrics/);
    ov.render({ status: 'plain', plain: 'x\n\ny' });
    assert.equal(root.querySelectorAll('.ly-plain').length, 3);
  } finally {
    ov.destroy();
  }
});
test('preview card: current + next line follow the clock; non-synced states are honest', () => {
  const { root } = page();
  let opened = 0;
  const pv = L.preview(root, { onOpen: () => opened++ });
  pv.render({ status: 'synced', lines: L.parseLRC('[00:01]a\n[00:05]b\n[00:09]c') });
  const cur = () => root.querySelector('.lp-cur').textContent,
    next = () => root.querySelector('.lp-next').textContent;
  assert.equal(cur(), '\u266a');
  pv.update(5.5);
  assert.equal(cur(), 'b');
  assert.equal(next(), 'c');
  pv.update(9.5);
  assert.equal(cur(), 'c');
  assert.equal(next(), '');
  assert.match(root.querySelector('.lp-label').textContent, /SYNCED LYRICS \u2022 LRCLIB/);
  root.click();
  assert.equal(opened, 1);
  pv.render({ status: 'none' });
  assert.match(cur(), /No synced lyrics/);
  assert.equal(root.querySelector('.lp-tag').hidden, true);
});
