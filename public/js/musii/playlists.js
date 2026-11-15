/* musii/js/playlists.js - per-user persistent playlists: create, rename, delete, import (JSON/CSV/M3U/TXT), sync, UI.
 * Storage key musii.playlists.v1:<userId>. Logging out only switches bucket; nothing is ever deleted. */
(function (g) {
  'use strict';
  const M = (g.Musii = g.Musii || {});
  const { uid, now, norm, hue, safeUrl, emitter } = M.core;
  const KEY = 'musii.playlists.v1:';
  const LIM = { name: 80, str: 200, tracks: 5000, bytes: 5e6 };
  const clip = (s, n = LIM.str) =>
    String(s == null ? '' : s)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, n);

  // untrusted input -> plain strings, bounded sizes, safe URLs
  function cleanTrack(t) {
    if (!t || typeof t !== 'object') return null;
    const title = clip(t.title);
    if (!title) return null;
    const d = Number(t.durationSec);
    return {
      id: clip(t.id, 120) || 'imp-' + uid(),
      title,
      artist: clip(t.artist),
      album: clip(t.album),
      durationSec: d > 0 && d < 36000 ? Math.round(d) : 0,
      cover: safeUrl(t.cover),
      source: clip(t.source, 40) || 'import',
    };
  }
  function uniq(name, taken) {
    // "Mix", "Mix (2)", "Mix (3)" ... case-insensitive
    const base = clip(name, LIM.name) || 'New playlist',
      set = new Set(taken.map((x) => x.toLowerCase()));
    let out = base,
      i = 2;
    while (set.has(out.toLowerCase())) out = base.slice(0, LIM.name - 6) + ' (' + i++ + ')';
    return out;
  }

  // ---- import parsers -----------------------------------------------------------------------------------
  const splitLine = (s) => {
    s = clip(s);
    const i = s.indexOf(' - ');
    return i > 0 ? { artist: s.slice(0, i), title: s.slice(i + 3) } : { title: s };
  };
  const fromTxt = (s) =>
    s
      .split(/\r?\n/)
      .filter((l) => l.trim() && l.trim()[0] !== '#')
      .map(splitLine);
  const dec = (s) => {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  };
  function secs(v, ms) {
    // "3:45" | seconds | milliseconds -> seconds
    v = String(v == null ? '' : v).trim();
    const m = /^(\d+):(\d{2})$/.exec(v);
    if (m) return +m[1] * 60 + +m[2];
    const n = parseFloat(v);
    if (!(n > 0)) return 0;
    return ms || n > 10000 ? n / 1000 : n;
  }
  function fromM3u(s) {
    const out = [];
    let meta = null;
    for (const raw of s.split(/\r?\n/)) {
      const l = raw.trim();
      if (!l || /^#EXTM3U/i.test(l)) continue;
      const m = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)[^,]*,(.*)$/i.exec(l);
      if (m) {
        meta = { ...splitLine(m[2]), durationSec: +m[1] > 0 ? +m[1] : 0 };
        continue;
      }
      if (l[0] === '#') continue;
      const name = dec(l.split(/[\\/]/).pop())
        .replace(/\?.*$/, '')
        .replace(/\.[a-z0-9]{2,4}$/i, '');
      out.push(meta || splitLine(name));
      meta = null;
    }
    return out;
  }
  function csvRows(text, d) {
    // RFC 4180: quotes, doubled quotes, CRLF
    const rows = [];
    let row = [],
      f = '',
      q = false;
    const end = () => {
      row.push(f);
      f = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            f += '"';
            i++;
          } else q = false;
        } else f += c;
      } else if (c === '"') q = true;
      else if (c === d) {
        row.push(f);
        f = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        end();
      } else f += c;
    }
    end();
    return rows;
  }
  function fromCsv(text) {
    const first = text.split(/\r?\n/, 1)[0];
    const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = csvRows(text, delim),
      head = (rows[0] || []).map(norm);
    const col = (...res) => {
      for (const re of res) {
        const i = head.findIndex((h) => re.test(h));
        if (i >= 0) return i;
      }
      return -1;
    };
    const ti = col(/^(track name|title|song name|song|name)$/, /title|track|song/);
    if (ti < 0) return fromTxt(text); // no header row: treat as "Artist - Title" lines
    const ai = col(/^artist name s?$/, /^artists?$/, /artist/),
      bi = col(/^album( name)?$/, /album/),
      di = col(/duration/, /length|time/);
    const ms = di >= 0 && /\bms\b|milli/.test(head[di]);
    return rows.slice(1).map((r) => ({
      title: r[ti],
      artist: ai >= 0 ? String(r[ai] || '').replace(/\s*;\s*/g, ', ') : '',
      album: bi >= 0 ? r[bi] : '',
      durationSec: di >= 0 ? secs(r[di], ms) : 0,
    }));
  }
  function mapJ(x) {
    const t = x && x.track ? x.track : x; // Spotify-style { track: {...} } wrapper
    if (!t || typeof t !== 'object') return typeof t === 'string' ? splitLine(t) : null;
    const artists = t.artists
      ? []
          .concat(t.artists)
          .map((a) => (a && a.name) || a)
          .join(', ')
      : '';
    const dur =
      t.durationSec != null
        ? +t.durationSec
        : t.duration_ms != null
          ? t.duration_ms / 1000
          : t.duration != null
            ? secs(t.duration)
            : 0;
    return {
      id: t.source ? t.id : undefined,
      source: t.source,
      title: t.title || t.name,
      artist: t.artist || artists,
      album: t.album && typeof t.album === 'object' ? t.album.name : t.album,
      durationSec: dur,
      cover: t.cover || (t.album && t.album.images && t.album.images[0] && t.album.images[0].url),
    };
  }
  function fromJson(s) {
    const j = JSON.parse(s);
    let arr = Array.isArray(j) ? j : j.tracks || j.items || (j.playlist && j.playlist.tracks) || [];
    if (!Array.isArray(arr)) arr = arr.items || [];
    return { name: Array.isArray(j) ? '' : j.name || (j.playlist && j.playlist.name), tracks: arr.map(mapJ) };
  }
  // -> { name, tracks: [clean tracks] }. Throws on invalid JSON / oversized input.
  function parseImport(filename, text) {
    text = String(text == null ? '' : text);
    if (text.length > LIM.bytes) throw new Error('File is too large (max 5 MB)');
    const s = text.replace(/^\uFEFF/, '').trim(),
      head = s.split(/\r?\n/, 1)[0];
    const ext = (/\.([a-z0-9]+)$/i.exec(filename || '') || [])[1] || '';
    const base = clip(
      String(filename || '')
        .replace(/^.*[\\/]/, '')
        .replace(/\.[^.]+$/, '')
        .replace(/_+/g, ' '),
      LIM.name,
    );
    let name = '',
      raw;
    if (/^[[{]/.test(s)) {
      const r = fromJson(s);
      name = r.name;
      raw = r.tracks;
    } else if (/^#EXTM3U/i.test(s) || /^m3u8?$/i.test(ext)) raw = fromM3u(s);
    else if (/^(csv|tsv)$/i.test(ext) || (/[,;\t]/.test(head) && /title|track|song/i.test(head)))
      raw = fromCsv(s);
    else raw = fromTxt(s);
    return {
      name: clip(name || base, LIM.name) || 'Imported playlist',
      tracks: raw.map(cleanTrack).filter(Boolean).slice(0, LIM.tracks),
    };
  }

  // ---- store --------------------------------------------------------------------------------------------
  // o = { storage?, userId?, remote?: { pull(): Promise<Playlist[]>, push(items): Promise<void> } }
  function create(o = {}) {
    const store = o.storage || M.core.storage(),
      remote = o.remote || null,
      ev = emitter();
    let user = o.userId || 'guest',
      data = [];
    const key = () => KEY + user;
    const load = () => {
      try {
        const a = JSON.parse(store.getItem(key()));
        data = Array.isArray(a) ? a : [];
      } catch (e) {
        data = [];
      }
    };
    const save = () => {
      try {
        store.setItem(key(), JSON.stringify(data));
      } catch (e) {
        ev.emit('error', e);
      }
      ev.emit('change');
    };
    const live = () => data.filter((p) => !p.deleted);
    const get = (id) => live().find((p) => p.id === id) || null;
    const names = (except) =>
      live()
        .filter((p) => p.id !== except)
        .map((p) => p.name);
    const touch = (p) => {
      p.updatedAt = Math.max(now(), (p.updatedAt || 0) + 1);
      save();
      return p;
    };
    load();
    if (typeof g.addEventListener === 'function') {
      // another tab changed this user's playlists
      g.addEventListener('storage', (e) => {
        if (e.key === key()) {
          load();
          ev.emit('change');
        }
      });
    }
    const api = {
      on: ev.on,
      userId: () => user,
      setUser(id) {
        user = id || 'guest';
        load();
        ev.emit('change');
      }, // login / logout: switch bucket, delete nothing
      list: () =>
        live()
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt),
      get,
      create(name, tracks = []) {
        const t = now();
        const p = {
          id: uid(),
          name: uniq(name, names()),
          tracks: tracks.map(cleanTrack).filter(Boolean).slice(0, LIM.tracks),
          createdAt: t,
          updatedAt: t,
        };
        data.push(p);
        save();
        return p;
      },
      rename(id, name) {
        const p = get(id),
          n = clip(name, LIM.name);
        if (!p || !n) return p;
        p.name = uniq(n, names(id));
        return touch(p);
      },
      remove(id) {
        // tombstone, so sync can propagate the delete
        const i = data.findIndex((p) => p.id === id && !p.deleted);
        if (i < 0) return false;
        data[i] = {
          id,
          deleted: true,
          name: '',
          tracks: [],
          updatedAt: Math.max(now(), (data[i].updatedAt || 0) + 1),
        };
        save();
        return true;
      },
      addTrack(id, t) {
        const p = get(id),
          c = cleanTrack(t);
        if (!p || !c || p.tracks.some((x) => x.source === c.source && x.id === c.id)) return false;
        p.tracks.push(c);
        touch(p);
        return true;
      },
      removeTrack(id, t) {
        const p = get(id);
        if (!p) return false;
        const n = p.tracks.length;
        p.tracks = p.tracks.filter((x) => !(x.source === t.source && x.id === t.id));
        if (p.tracks.length === n) return false;
        touch(p);
        return true;
      },
      importText(filename, text) {
        // ALWAYS a new playlist, never merged
        const r = parseImport(filename, text);
        if (!r.tracks.length) throw new Error('No songs found in ' + (filename || 'the file'));
        return api.create(r.name, r.tracks);
      },
      exportJSON(id) {
        const p = get(id);
        return p ? JSON.stringify({ musii: 1, name: p.name, tracks: p.tracks }, null, 1) : '';
      },
      async sync() {
        // last-write-wins per playlist, tombstones included
        if (!remote) return { pulled: 0, pushed: 0 };
        const theirs = await remote.pull(),
          mine = new Map(data.map((p) => [p.id, p])),
          seen = new Set(),
          push = [];
        let pulled = 0;
        for (const r of theirs) {
          seen.add(r.id);
          const l = mine.get(r.id);
          if (!l || r.updatedAt > l.updatedAt) {
            mine.set(r.id, r);
            pulled++;
          } else if (l.updatedAt > r.updatedAt) push.push(l);
        }
        for (const l of mine.values()) if (!seen.has(l.id)) push.push(l);
        data = [...mine.values()];
        save();
        if (push.length) await remote.push(push);
        return { pulled, pushed: push.length };
      },
    };
    return api;
  }

  // REST adapter. The server must keep tombstones (deleted: true) for >= 30 days so deletions reach other devices.
  const httpRemote = (base, token, f) => {
    const fx = f || (g.fetch && g.fetch.bind(g));
    const hdr = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() });
    return {
      async pull() {
        const r = await fx(base + '/playlists', { headers: hdr() });
        if (!r.ok) throw new Error('pull ' + r.status);
        return r.json();
      },
      async push(items) {
        const r = await fx(base + '/playlists', {
          method: 'PUT',
          headers: hdr(),
          body: JSON.stringify(items),
        });
        if (!r.ok) throw new Error('push ' + r.status);
      },
    };
  };

  // ---- UI: list -> detail (all songs, inline rename, play, shuffle, export, delete) + import ------------
  // o = { play(tracks, index), toast(msg), confirm(msg) }
  function mount(root, store, o = {}) {
    const doc = root.ownerDocument,
      win = doc.defaultView || g,
      play = o.play || (() => {}),
      toast = o.toast || (() => {});
    const ask = o.confirm || ((m) => (g.confirm ? g.confirm(m) : true));
    const h = (tag, cls, txt) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (txt != null) e.textContent = txt;
      return e;
    };
    const btn = (label, cls, fn) => {
      const b = h('button', cls, label);
      b.type = 'button';
      b.addEventListener('click', fn);
      return b;
    };
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
    const total = (l) => l.reduce((s, t) => s + (t.durationSec || 0), 0);
    const readText = (f) =>
      f.text
        ? f.text()
        : new Promise((res, rej) => {
            const r = new win.FileReader();
            r.onload = () => res(String(r.result));
            r.onerror = () => rej(r.error);
            r.readAsText(f);
          });
    const cover = (t) => {
      const c = h('span', 'cover'),
        u = t && safeUrl(t.cover);
      c.style.setProperty('--c', String(hue((t && t.id) || 'x')));
      if (u) c.style.backgroundImage = 'url("' + u + '")';
      return c;
    };
    const shuffled = (a) => {
      const b = a.slice();
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
      }
      return b;
    };
    let openId = null,
      renaming = false;

    function list() {
      const box = h('div', 'pl'),
        head = h('div', 'pl-head'),
        ps = store.list();
      const form = h('form', 'pl-form'),
        name = h('input'),
        go = h('button', '', 'Create'),
        file = h('input');
      form.hidden = true;
      go.type = 'submit';
      name.placeholder = 'Playlist name';
      name.maxLength = LIM.name;
      name.setAttribute('aria-label', 'Playlist name');
      form.append(name, go);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        openId = store.create(name.value || 'New playlist').id;
        render();
      });
      file.type = 'file';
      file.hidden = true;
      file.accept = '.json,.csv,.tsv,.m3u,.m3u8,.txt';
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        if (!f) return;
        try {
          const p = store.importText(f.name, await readText(f));
          openId = p.id;
          toast('Imported \u201c' + p.name + '\u201d (' + plural(p.tracks.length, 'song') + ')');
        } catch (err) {
          toast(err.message || 'Import failed');
        }
        file.value = '';
        render();
      });
      head.append(
        h('h2', '', 'Your playlists'),
        btn('New', 'pl-new', () => {
          form.hidden = !form.hidden;
          if (!form.hidden) name.focus();
        }),
        btn('Import', 'pl-imp', () => file.click()),
      );
      box.append(head, form, file);
      if (!ps.length)
        box.append(h('p', 'empty', 'No playlists yet. Create one, or import a CSV, JSON, M3U or text file.'));
      ps.forEach((p) => {
        const r = btn('', 'pl-row', () => {
            openId = p.id;
            render();
          }),
          t = h('span', 'row-txt');
        t.append(h('b', '', p.name), h('small', '', plural(p.tracks.length, 'song')));
        r.append(cover(p.tracks[0] || { id: p.id }), t);
        box.append(r);
      });
      return box;
    }

    function detail(p) {
      const box = h('div', 'pl'),
        head = h('div', 'pl-head'),
        title = h('div', 'pl-title');
      head.append(
        btn('\u2039 Back', 'pl-back', () => {
          openId = null;
          renaming = false;
          render();
        }),
        title,
      );
      if (renaming) {
        const inp = h('input', 'pl-rename');
        let done = false;
        inp.value = p.name;
        inp.maxLength = LIM.name;
        inp.setAttribute('aria-label', 'Playlist name');
        const commit = (save) => {
          if (done) return;
          done = true;
          renaming = false;
          if (save) store.rename(p.id, inp.value);
          render();
        };
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commit(true);
          else if (e.key === 'Escape') commit(false);
        });
        inp.addEventListener('blur', () => commit(true));
        title.append(inp);
        setTimeout(() => {
          inp.focus();
          inp.select();
        }, 0);
      } else {
        title.append(
          h('h2', '', p.name),
          btn('Rename', 'pl-ren', () => {
            renaming = true;
            render();
          }),
        );
      }
      box.append(
        head,
        h(
          'p',
          'empty',
          plural(p.tracks.length, 'song') +
            (p.tracks.length ? ' \u00b7 ' + Math.round(total(p.tracks) / 60) + ' min' : ''),
        ),
      );
      const acts = h('div', 'pl-acts');
      acts.append(
        btn('Play', 'pl-play', () => {
          if (p.tracks.length) play(p.tracks, 0);
        }),
        btn('Shuffle', 'pl-shuf', () => {
          if (p.tracks.length) play(shuffled(p.tracks), 0);
        }),
        btn('Export', 'pl-exp', () => {
          const a = h('a');
          a.href = win.URL.createObjectURL(
            new win.Blob([store.exportJSON(p.id)], { type: 'application/json' }),
          );
          a.download = p.name + '.json';
          a.click();
          setTimeout(() => win.URL.revokeObjectURL(a.href), 1000);
        }),
        btn('Delete', 'pl-del', () => {
          if (ask('Delete \u201c' + p.name + '\u201d?')) {
            store.remove(p.id);
            openId = null;
            render();
          }
        }),
      );
      box.append(acts);
      if (!p.tracks.length)
        box.append(h('p', 'empty', 'No songs yet. Search for a song and tap + to add it here.'));
      const ol = h('ol', 'pl-tracks');
      p.tracks.forEach((t, i) => {
        const li = h('li', 'row'),
          main = btn('', 'row-main', () => play(p.tracks, i)),
          txt = h('span', 'row-txt');
        txt.append(h('b', '', t.title), h('small', '', t.artist));
        main.append(cover(t), txt);
        li.append(
          main,
          btn('\u2715', 'icon', () => store.removeTrack(p.id, t)),
        );
        li.lastChild.setAttribute('aria-label', 'Remove from playlist');
        ol.append(li);
      });
      box.append(ol);
      return box;
    }

    function render() {
      root.textContent = '';
      const p = openId && store.get(openId);
      if (openId && !p) {
        openId = null;
        renaming = false;
      }
      root.append(p ? detail(p) : list());
    }
    const offChange = store.on('change', render),
      offError = store.on('error', () => toast('Storage is full: changes are not saved'));
    render();
    return {
      render,
      destroy() {
        offChange();
        offError();
        root.textContent = '';
      },
    };
  }

  M.playlists = { create, parseImport, mount, httpRemote };
  if (typeof module === 'object' && module.exports) module.exports = M.playlists;
})(globalThis);
