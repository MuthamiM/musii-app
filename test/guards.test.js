const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const dir = path.join(__dirname, '..', 'js');
const src = Object.fromEntries(
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]),
);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('logout can never wipe playlists: no storage clear / deleteDatabase in any module', () => {
  for (const [f, s] of Object.entries(src))
    assert.doesNotMatch(strip(s), /(local|session)Storage\.clear\(|indexedDB\.deleteDatabase/, f);
});
test('track and lyric text is rendered with textContent only', () => {
  for (const [f, s] of Object.entries(src))
    assert.doesNotMatch(strip(s), /\.innerHTML|insertAdjacentHTML|document\.write|\beval\(/, f);
});
test('audio is never paused because the page was hidden (player + mediasession)', () => {
  for (const f of ['player.js', 'mediasession.js'])
    assert.doesNotMatch(strip(src[f]), /visibilitychange|pagehide|\bblur\b/, f);
});
test('no demo, sample or fake data ships in the modules', () => {
  for (const [f, s] of Object.entries(src))
    assert.doesNotMatch(strip(s), /\bdemo\b|lorem ipsum|fake data|synthesi[sz]ed/i, f);
});
