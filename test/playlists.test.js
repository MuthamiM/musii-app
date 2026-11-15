const test = require('node:test'),
  assert = require('node:assert/strict'),
  { JSDOM } = require('jsdom');
require('../js/core.js');
const P = require('../js/playlists.js');
const memStore = () => {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => {
      m[k] = String(v);
    },
  };
};
const tr = (id, title, artist = 'A') => ({ id, title, artist, source: 'x', durationSec: 100 });
const CSV =
  'Track URI,Track Name,Album Name,Artist Name(s),Duration (ms)\n' +
  'uri:1,"Hello, World",Alb,Adele;Other,215000\nuri:2,Second,Alb2,Eagles,180500\n';

test('playlists survive logout, login and a fresh page load; users are isolated', () => {
  const st = memStore(),
    s = P.create({ storage: st, userId: 'musa' });
  const p = s.create('Road trip', [tr('1', 'One'), tr('2', 'Two')]);
  s.setUser(null); // logout -> guest bucket, nothing deleted
  assert.equal(s.list().length, 0);
  s.setUser('musa'); // login again
  assert.equal(s.get(p.id).tracks.length, 2);
  assert.equal(P.create({ storage: st, userId: 'musa' }).get(p.id).name, 'Road trip'); // page reload
  assert.equal(P.create({ storage: st, userId: 'amina' }).list().length, 0);
});
test('rename: trims, keeps names unique (case-insensitive), ignores empty, own name is not a clash', () => {
  const s = P.create({ storage: memStore() }),
    a = s.create('Mix'),
    b = s.create('Other');
  s.rename(b.id, '  mix  ');
  assert.equal(s.get(b.id).name, 'mix (2)');
  s.rename(b.id, '');
  assert.equal(s.get(b.id).name, 'mix (2)');
  s.rename(a.id, 'Mix');
  assert.equal(s.get(a.id).name, 'Mix');
});
test('tracks: duplicates refused, removal works, delete hides the playlist', () => {
  const s = P.create({ storage: memStore() }),
    p = s.create('L');
  assert.equal(s.addTrack(p.id, tr('1', 'One')), true);
  assert.equal(s.addTrack(p.id, tr('1', 'One')), false);
  assert.equal(s.addTrack(p.id, tr('2', 'Two')), true);
  assert.equal(s.removeTrack(p.id, tr('1', 'One')), true);
  assert.deepEqual(
    s.get(p.id).tracks.map((t) => t.id),
    ['2'],
  );
  assert.equal(s.remove(p.id), true);
  assert.equal(s.get(p.id), null);
  assert.equal(s.list().length, 0);
});
test('import CSV (quoted commas, multi-artist, ms durations) creates a NEW playlist named after the file', () => {
  const s = P.create({ storage: memStore() }),
    old = s.create('Keep me', [tr('9', 'Nine')]);
  const p = s.importText('Road_Trip.csv', CSV);
  assert.notEqual(p.id, old.id);
  assert.equal(p.name, 'Road Trip');
  assert.equal(p.tracks.length, 2);
  assert.deepEqual(
    [p.tracks[0].title, p.tracks[0].artist, p.tracks[0].durationSec, p.tracks[0].source],
    ['Hello, World', 'Adele, Other', 215, 'import'],
  );
  assert.equal(s.get(old.id).tracks.length, 1); // the existing playlist is untouched
  assert.equal(s.importText('Road_Trip.csv', CSV).name, 'Road Trip (2)'); // same file again -> another new playlist
});
test('import JSON (Spotify-style items), M3U and plain text; own export round-trips', () => {
  const j = JSON.stringify({
    name: 'From JSON',
    items: [
      {
        track: {
          name: 'Umbrella',
          artists: [{ name: 'Rihanna' }],
          album: { name: 'GGGB' },
          duration_ms: 275000,
        },
      },
      { track: { name: 'Hello', artists: [{ name: 'Adele' }] } },
    ],
  });
  const a = P.parseImport('x.json', j);
  assert.equal(a.name, 'From JSON');
  assert.deepEqual(
    a.tracks.map((t) => [t.title, t.artist, t.durationSec]),
    [
      ['Umbrella', 'Rihanna', 275],
      ['Hello', 'Adele', 0],
    ],
  );
  const m3u =
    '#EXTM3U\n#EXTINF:215,Adele - Hello\nhttp://x/hello.mp3\n/music/Eagles - Hotel California.mp3\n';
  assert.deepEqual(
    P.parseImport('list.m3u8', m3u).tracks.map((t) => [t.artist, t.title, t.durationSec]),
    [
      ['Adele', 'Hello', 215],
      ['Eagles', 'Hotel California', 0],
    ],
  );
  assert.deepEqual(
    P.parseImport('notes.txt', '# my list\nRihanna - Umbrella\nJust A Title\n').tracks.map((t) => t.title),
    ['Umbrella', 'Just A Title'],
  );
  const s = P.create({ storage: memStore() }),
    p = s.create('Mine', [tr('1', 'One'), tr('2', 'Two')]);
  const copy = s.importText('Copy.json', s.exportJSON(p.id));
  assert.deepEqual(
    copy.tracks.map((t) => [t.id, t.source]),
    [
      ['1', 'x'],
      ['2', 'x'],
    ],
  );
});
test('imports are sanitised: control chars, long strings, javascript: covers, junk rows; bad input throws', () => {
  const j = JSON.stringify([
    { title: 'A\u0007B', artist: 'x'.repeat(500), cover: 'javascript:alert(1)' },
    { artist: 'no title' },
    42,
  ]);
  const r = P.parseImport('s.json', j);
  assert.equal(r.tracks.length, 1);
  assert.equal(r.tracks[0].title, 'A B');
  assert.equal(r.tracks[0].artist.length, 200);
  assert.equal(r.tracks[0].cover, '');
  const s = P.create({ storage: memStore() });
  assert.throws(() => s.importText('e.txt', '\n\n'), /No songs/);
  assert.throws(() => P.parseImport('b.json', '{bad'));
});
test('sync: newer side wins, remote deletions are applied, local-only lists are pushed', async () => {
  let remoteData = [];
  const pushed = [],
    remote = {
      pull: async () => remoteData,
      push: async (x) => {
        pushed.push(...x);
      },
    };
  const s = P.create({ storage: memStore(), remote }),
    a = s.create('Local only'),
    b = s.create('Shared');
  remoteData = [{ ...b, name: 'Shared (edited elsewhere)', updatedAt: b.updatedAt + 1000 }];
  await s.sync();
  assert.equal(s.get(b.id).name, 'Shared (edited elsewhere)');
  assert.deepEqual(
    pushed.map((p) => p.id),
    [a.id],
  );
  remoteData = [{ id: b.id, deleted: true, name: '', tracks: [], updatedAt: Date.now() + 5000 }];
  await s.sync();
  assert.equal(s.get(b.id), null);
});
test('UI: list -> open shows every song; inline rename; delete', () => {
  const { window } = new JSDOM('<div id="r"></div>'),
    root = window.document.getElementById('r');
  const s = P.create({ storage: memStore() }),
    p = s.create('Chill', [tr('1', 'One'), tr('2', 'Two'), tr('3', 'Three')]);
  let played = null;
  P.mount(root, s, {
    play: (list, i) => {
      played = [list.length, i];
    },
    confirm: () => true,
    toast() {},
  });
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.match(root.textContent, /Chill/);
  click(root.querySelector('.pl-row'));
  assert.equal(root.querySelectorAll('.pl-tracks .row').length, 3);
  click(root.querySelectorAll('.pl-tracks .row-main')[1]);
  assert.deepEqual(played, [3, 1]);
  click(root.querySelector('.pl-ren'));
  const inp = root.querySelector('.pl-rename');
  inp.value = 'Focus';
  inp.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(s.get(p.id).name, 'Focus');
  assert.equal(root.querySelector('h2').textContent, 'Focus');
  click(root.querySelector('.pl-del'));
  assert.equal(s.list().length, 0);
  assert.match(root.textContent, /No playlists yet/);
});
