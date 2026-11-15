const test = require('node:test'),
  assert = require('node:assert/strict');
const sw = require('../sw.js');
const req = (url, o = {}) => ({
  url,
  method: 'GET',
  destination: '',
  mode: 'no-cors',
  headers: { get: () => null },
  ...o,
});

test('parseRange: a-b, a-, -n, invalid', () => {
  assert.deepEqual(sw.parseRange('bytes=0-99', 1000), [0, 99]);
  assert.deepEqual(sw.parseRange('bytes=900-', 1000), [900, 999]);
  assert.deepEqual(sw.parseRange('bytes=-100', 1000), [900, 999]);
  assert.deepEqual(sw.parseRange('bytes=0-5000', 1000), [0, 999]);
  for (const bad of ['bytes=2000-', 'bytes=5-1', 'bytes=-', 'items=0-1', '', null])
    assert.equal(sw.parseRange(bad, 1000), null);
});
test('rangeResponse answers Range requests with 206 + Content-Range, others with 200', async () => {
  const buf = new Uint8Array(1000).map((_, i) => i % 256).buffer;
  const r = sw.rangeResponse(buf, 'bytes=10-19', 'audio/mpeg');
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('Content-Range'), 'bytes 10-19/1000');
  assert.equal((await r.arrayBuffer()).byteLength, 10);
  const full = sw.rangeResponse(buf, null);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('Accept-Ranges'), 'bytes');
});
test('strategy: audio / navigation / static / lyrics / api / cross-origin', () => {
  const o = 'https://app.test';
  assert.equal(sw.strategy(req(o + '/a.mp3', { destination: 'audio' }), o), 'audio');
  assert.equal(sw.strategy(req(o + '/', { mode: 'navigate' }), o), 'nav');
  assert.equal(sw.strategy(req(o + '/assets/app.abc123.js'), o), 'swr');
  assert.equal(sw.strategy(req('https://lrclib.net/api/get?x=1'), o), 'swr');
  assert.equal(sw.strategy(req(o + '/api/search?q=a'), o), 'network');
  assert.equal(sw.strategy(req('https://cdn.example/x.js'), o), 'network');
  assert.equal(sw.strategy(req(o + '/x', { method: 'POST' }), o), 'network');
});
