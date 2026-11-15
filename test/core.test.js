const test = require('node:test'),
  assert = require('node:assert/strict');
const C = require('../js/core.js');

test('norm: accents, punctuation, case, ampersand', () => {
  assert.equal(C.norm('  Beyonc\u00e9 \u2014 Halo!! '), 'beyonce halo');
  assert.equal(C.norm('Salt & Sun'), 'salt and sun');
});
test('dl: bounded Damerau-Levenshtein', () => {
  assert.equal(C.dl('teh', 'the', 1), 1); // a transposition costs 1
  assert.equal(C.dl('rihana', 'rihanna', 1), 1);
  assert.equal(C.dl('abc', 'xyz', 1), 2); // beyond max returns max + 1
  assert.equal(C.dl('same', 'same'), 0);
});
test('LRU: evicts least recently used, honours ttl', async () => {
  const c = new C.LRU(2);
  c.set('a', 1);
  c.set('b', 2);
  c.get('a');
  c.set('c', 3);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  c.set('t', 9, 5);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(c.get('t'), undefined);
});
test('backoff: exponential with jitter, capped', () => {
  for (let n = 0; n < 8; n++) {
    const d = C.backoff(n, 500, 8000),
      top = Math.min(8000, 500 * 2 ** n);
    assert.ok(d >= top / 2 && d <= top);
  }
});
test('Ewma moves toward the new level', () => {
  const e = new C.Ewma(0.5);
  e.push(100);
  e.push(200);
  assert.equal(e.v, 150);
});
test('pickBitrate keeps a safety margin and falls back to the lowest rung', () => {
  assert.equal(C.pickBitrate([64, 128, 256], 200), 128); // 200 * 0.7 = 140
  assert.equal(C.pickBitrate([64, 128, 256], 40), 64);
});
test('gains: equal-power crossfade (out^2 + in^2 = 1)', () => {
  for (let p = 0; p <= 1; p += 0.1) {
    const g = C.gains(p);
    assert.ok(Math.abs(g.out ** 2 + g.in ** 2 - 1) < 1e-9);
  }
});
test('retry: retries then succeeds; AbortError is never retried', async () => {
  let n = 0;
  assert.equal(
    await C.retry(
      async () => {
        if (++n < 3) throw new Error('x');
        return 'ok';
      },
      { base: 1, cap: 2 },
    ),
    'ok',
  );
  const a = Object.assign(new Error('a'), { name: 'AbortError' });
  let m = 0;
  await assert.rejects(
    C.retry(
      async () => {
        m++;
        throw a;
      },
      { base: 1 },
    ),
    /a/,
  );
  assert.equal(m, 1);
});
test('safeUrl: only http(s), blob and data:image; quotes are encoded', () => {
  assert.equal(C.safeUrl('javascript:alert(1)'), '');
  assert.equal(C.safeUrl('https://x.io/a b"c.png'), 'https://x.io/a%20b%22c.png');
});
test('uid works when crypto.randomUUID is missing (http:// origins)', () => {
  const d = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    assert.match(C.uid(), /^id-/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', d);
  }
});
test('storage(): falls back to memory when localStorage is unavailable', () => {
  const s = C.storage();
  s.setItem('k', 'v');
  assert.equal(s.getItem('k'), 'v');
  assert.equal(s.getItem('nope'), null);
});
