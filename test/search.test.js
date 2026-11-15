const test = require('node:test'),
  assert = require('node:assert/strict');
require('../js/core.js');
const S = require('../js/search.js');
const T = (id, title, artist, album = '', plays = 0) => ({ id, title, artist, album, plays, source: 't' });
const cat = [
  T(1, 'Hotel California', 'Eagles', 'Hotel California'),
  T(2, 'Umbrella', 'Rihanna', 'Good Girl Gone Bad'),
  T(3, 'Diamonds', 'Rihanna', 'Unapologetic'),
  T(4, 'Rihanna Style', 'Some Cover Band'),
  T(5, 'Hello', 'Adele', '25'),
  T(6, 'Hello Goodbye', 'The Beatles'),
  T(7, 'Last Dance', 'Wakadinali'),
  T(8, 'Umbrella Season', 'Kilifi Kites'),
  T(9, 'Ume Tii', 'Wakadinali'),
];
const idx = () => new S.Index().add(cat);
const top = (q) =>
  idx()
    .search(q)
    .map((r) => r.track.title);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('exact, prefix (type-ahead) and short tokens', () => {
  assert.equal(top('hotel california')[0], 'Hotel California');
  assert.equal(top('hote')[0], 'Hotel California');
  assert.equal(top('ume tii')[0], 'Ume Tii');
  assert.deepEqual(top('wakadinali').sort(), ['Last Dance', 'Ume Tii']);
});
test('typos: missing letter, transposition, substitution', () => {
  assert.ok(
    idx()
      .search('rihana')
      .some((r) => r.track.artist === 'Rihanna'),
  );
  assert.equal(top('umbrlela')[0], 'Umbrella');
  assert.equal(top('hotal california')[0], 'Hotel California');
});
test('multi-token: artist disambiguates; exact title outranks longer titles', () => {
  assert.equal(top('hello adele')[0], 'Hello');
  assert.equal(top('hello beatles')[0], 'Hello Goodbye');
  assert.equal(top('hello')[0], 'Hello');
});
test('popularity breaks ties', () => {
  const i = new S.Index().add([T(1, 'Hello', 'A'), T(2, 'Hello', 'B')]);
  assert.equal(i.search('hello')[0].track.id, 1);
  i.bump(T(2, 'Hello', 'B'));
  i.bump(T(2, 'Hello', 'B'));
  assert.equal(i.search('hello')[0].track.id, 2);
});
test('nothing matches -> empty', () => assert.deepEqual(top('zzzzqq'), []));
test('rrf: dedupes by title+artist and rewards agreement between lists', () => {
  const a = [T(1, 'A', 'x'), T(2, 'B', 'x'), T(3, 'C', 'x')],
    b = [T(9, 'B', 'x'), T(8, 'D', 'x')];
  const out = S.rrf([a, b]).map((t) => t.title);
  assert.equal(out[0], 'B');
  assert.equal(out.length, 4);
});
test('run(): sync local results; stale remote responses dropped; in-flight request aborted', async () => {
  const index = idx(),
    seen = [];
  let aborted = 0;
  const src = {
    async search(q, { signal }) {
      signal.addEventListener('abort', () => aborted++);
      await sleep(q === 'umb' ? 40 : 5);
      if (signal.aborted) throw Object.assign(new Error('a'), { name: 'AbortError' });
      return [T('r-' + q, 'Remote ' + q, 'R')];
    },
  };
  const s = S.create({ index, sources: [src], debounceMs: 1 });
  let local = false;
  s.run('umb', {
    onLocal: () => {
      local = true;
    },
    onRemote: () => seen.push('umb'),
  });
  assert.ok(local);
  await sleep(10);
  s.run('umbr', { onRemote: () => seen.push('umbr') });
  await sleep(100);
  assert.deepEqual(seen, ['umbr']);
  assert.equal(aborted, 1);
  assert.ok(index.search('remote umbr').length > 0); // learned: the next search is a local hit
});
test('run(): all sources failing -> onError; top() binds "title artist" to a track', async () => {
  const bad = {
    search: async () => {
      throw new Error('offline');
    },
  };
  let err = null;
  S.create({ index: idx(), sources: [bad], debounceMs: 1 }).run('hello', {
    onError: (e) => {
      err = e;
    },
  });
  await sleep(30);
  assert.match(err.message, /offline/);
  const t = await S.create({ index: idx(), sources: [] }).top('Umbrella Rihanna');
  assert.equal(t.title, 'Umbrella');
});
