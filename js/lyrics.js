/* musii/js/lyrics.js - synced lyrics: LRC parser, LRCLIB lookup + ranking + cache, full-screen view, live card.
 * Look and feel target: the BitChord lyrics screen (active line white, neighbours dimmed + blurred by distance). */
(function (g) {
  'use strict';
  const M = (g.Musii = g.Musii || {});
  const { norm, tokens, grams, jaccard, LRU, now, clamp } = M.core;
  const API = 'https://lrclib.net/api';
  const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const LEAD = /^\s*((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+)(.*)$/; // only stamps at the START of a line count
  const WORD = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g; // enhanced-LRC per-word stamps: dropped

  // "[mm:ss.xx]text" -> [{ t: seconds, text }] sorted by time; one empty line is kept per instrumental gap
  function parseLRC(src) {
    const out = [];
    for (const raw of String(src || '').split(/\r?\n/)) {
      const m = LEAD.exec(raw);
      if (!m) continue; // [ar:..] [ti:..] tags and plain text
      const text = m[2].replace(WORD, '').trim();
      for (const s of m[1].matchAll(STAMP)) {
        out.push({ t: +s[1] * 60 + +s[2] + (s[3] ? parseInt(s[3], 10) / 10 ** s[3].length : 0), text });
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out.filter((l, i) => l.text || (i > 0 && out[i - 1].text));
  }

  // index of the last line with line.t <= t (binary search, O(log n)); -1 before the first line
  function activeIndex(lines, t) {
    let lo = 0,
      hi = lines.length - 1,
      ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].t <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  // ---- matching: pick the right LRCLIB record for a track -----------------------------------------------
  const cleanTitle = (s) =>
    norm(
      String(s || '')
        .replace(
          /[(\[][^)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|remaster(ed)?|hd|4k|mv)\b[^)\]]*[)\]]/gi,
          ' ',
        )
        .replace(/\s[-\u2013\u2014]\s*(\d{4}\s*)?(remaster(ed)?|official|lyrics?|audio|video).*$/i, ' ')
        .replace(/\b(feat|ft|featuring)\b\.?.*$/i, ' '),
    );
  const cleanArtist = (s) =>
    norm(
      String(s || '')
        .replace(/\s*-\s*topic$/i, '')
        .replace(/vevo$/i, ''),
    );
  const sim = (a, b) => {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const inside = Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a)) ? 0.85 : 0;
    return Math.max(jaccard(grams(a), grams(b)), inside);
  };
  const artistSim = (a, b) => {
    const A = new Set(tokens(a)),
      B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    let i = 0;
    for (const x of A) if (B.has(x)) i++;
    return Math.max(i / A.size, i / B.size);
  };
  // score = 0.5 title + 0.3 artist + 0.2 duration (+0.1 when synced lyrics exist)
  function score(t, c) {
    const ts = sim(cleanTitle(t.title), cleanTitle(c.trackName || c.name));
    const as = t.artist ? artistSim(cleanArtist(t.artist), cleanArtist(c.artistName)) : 0.5;
    let ds = 0.5; // unknown duration: neutral
    if (t.durationSec && c.duration) {
      const d = Math.abs(t.durationSec - c.duration);
      ds = d <= 2 ? 1 : d <= 5 ? 0.7 : d <= 10 ? 0.3 : 0;
    }
    return { ts, as, s: 0.5 * ts + 0.3 * as + 0.2 * ds + (c.syncedLyrics ? 0.1 : 0) };
  }
  function pick(t, list) {
    let best = null;
    for (const c of list || []) {
      const r = score(t, c);
      if (r.ts >= 0.6 && r.as >= 0.34 && r.s >= 0.62 && (!best || r.s > best.s)) best = { c, s: r.s };
    }
    return best && best.c;
  }
  function shape(c) {
    if (c.instrumental) return { status: 'instrumental' };
    const lines = c.syncedLyrics ? parseLRC(c.syncedLyrics) : [];
    if (lines.length) return { status: 'synced', lines, plain: c.plainLyrics || '', id: c.id };
    if (c.plainLyrics) return { status: 'plain', lines: [], plain: c.plainLyrics, id: c.id };
    return { status: 'none' };
  }

  // ---- fetch + cache ------------------------------------------------------------------------------------
  // lookup order: /get (needs artist + album + duration) -> /search by track + artist -> /search by cleaned title
  // get() resolves to { status: 'synced'|'plain'|'instrumental'|'none'|'error', lines, plain, cached }
  function create(o = {}) {
    const f = o.fetch || (g.fetch && g.fetch.bind(g)),
      base = o.base || API,
      headers = o.headers || {};
    const store = o.storage || M.core.storage(),
      key = o.key || 'musii.lyrics.v1';
    const ttl = o.ttl || 7 * 864e5,
      negTtl = o.negTtl || 6 * 36e5,
      max = o.max || 80;
    const mem = new LRU(40);
    const ck = (t) => norm(t.artist) + '|' + norm(t.title) + '|' + Math.round((t.durationSec || 0) / 5);
    const read = () => {
      try {
        return JSON.parse(store.getItem(key)) || {};
      } catch (e) {
        return {};
      }
    };
    function write(all) {
      // newest `max` entries; on quota error halve
      let n = Math.min(max, Object.keys(all).length);
      for (;;) {
        const out = {};
        Object.keys(all)
          .sort((a, b) => all[b].t - all[a].t)
          .slice(0, n)
          .forEach((k) => {
            out[k] = all[k];
          });
        try {
          store.setItem(key, JSON.stringify(out));
          return;
        } catch (e) {
          n = Math.floor(n / 2);
          if (!n) return;
        }
      }
    }
    const pack = (v) => (v.lines ? { ...v, lines: v.lines.map((l) => [l.t, l.text]) } : v);
    const unpack = (v) => (v.lines ? { ...v, lines: v.lines.map((l) => ({ t: l[0], text: l[1] })) } : v);
    const url = (p, q) => {
      const u = new URL(base + p);
      for (const k in q) if (q[k] != null && q[k] !== '') u.searchParams.set(k, q[k]);
      return u.toString();
    };
    async function json(u, signal) {
      const r = await f(u, { signal, headers });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('lrclib ' + r.status);
      return r.json();
    }
    async function lookup(t, signal) {
      let hit = null;
      if (t.artist && t.album && t.durationSec) {
        hit = await json(
          url('/get', {
            track_name: t.title,
            artist_name: t.artist,
            album_name: t.album,
            duration: Math.round(t.durationSec),
          }),
          signal,
        );
      }
      if (!hit)
        hit = pick(t, await json(url('/search', { track_name: t.title, artist_name: t.artist }), signal));
      if (!hit)
        hit = pick(
          t,
          await json(
            url('/search', { q: [cleanTitle(t.title), cleanArtist(t.artist)].filter(Boolean).join(' ') }),
            signal,
          ),
        );
      return hit ? shape(hit) : { status: 'none' };
    }
    async function get(t, { signal } = {}) {
      const k = ck(t),
        m = mem.get(k);
      if (m) return { ...m, cached: true }; // cached: drives "saved on this device"
      const d = read()[k];
      if (d && now() - d.t < (d.v.status === 'none' ? negTtl : ttl))
        return { ...mem.set(k, unpack(d.v)), cached: true };
      let res;
      try {
        res = await lookup(t, signal);
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        return { status: 'error', error: String((e && e.message) || e) }; // never cached: retry next time
      }
      mem.set(k, res);
      const all = read();
      all[k] = { t: now(), v: pack(res) };
      write(all);
      return { ...res, cached: false };
    }
    return { get, prefetch: (t) => get(t).catch(() => {}) };
  }

  // ---- full-screen lyrics view (BitChord-style) ---------------------------------------------------------
  const MSG = {
    loading: 'Finding lyrics\u2026',
    none: 'No lyrics found',
    instrumental: 'Instrumental \u266a',
    error: 'Could not load lyrics',
  };

  // o = { getTime(): seconds, seek(seconds), isPlaying(): bool, anchor?: 0..1 }.   offset > 0 shows lines earlier.
  // Line i gets data-d = min(6, |i - active|); css/lyrics.css maps data-d to the opacity + blur ladder.
  function overlay(root, o) {
    const doc = root.ownerDocument,
      win = doc.defaultView || g,
      getTime = o.getTime,
      seek = o.seek,
      isPlaying = o.isPlaying || (() => true);
    const anchor = o.anchor == null ? 0.22 : o.anchor; // active line sits 22% from the top (screenshot)
    const el = (tag, cls, txt) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (txt != null) e.textContent = txt;
      return e;
    };
    const raf = (fn) =>
      win.requestAnimationFrame ? win.requestAnimationFrame(fn) : setTimeout(() => fn(Date.now()), 16);
    const caf = (i) => (win.cancelAnimationFrame ? win.cancelAnimationFrame(i) : clearTimeout(i));
    root.classList.add('ly');
    root.textContent = '';
    const scroll = el('div', 'ly-scroll'),
      msg = el('div', 'ly-msg'),
      bar = el('div', 'ly-bar');
    const less = el('button', 'ly-b', '\u22120.5s'),
      more = el('button', 'ly-b', '+0.5s'),
      shown = el('span', 'ly-off', '0.0s');
    less.type = more.type = 'button';
    less.setAttribute('aria-label', 'Show lyrics later');
    more.setAttribute('aria-label', 'Show lyrics earlier');
    bar.append(less, shown, more);
    bar.hidden = true;
    root.append(scroll, msg, bar);

    let lines = [],
      nodes = [],
      cur = -1,
      off = 0,
      y = 0,
      target = 0,
      userUntil = 0,
      id = 0,
      last = 0,
      dead = false;
    const time = () => (getTime() || 0) + off;
    const anim = () => Math.abs(target - y) > 0.4;
    const run = () =>
      !dead && lines.length > 0 && !doc.hidden && (isPlaying() || anim() || Date.now() < userUntil);

    function paint(i, snap) {
      cur = i;
      nodes.forEach((n, k) => {
        n.dataset.d = String(i < 0 ? 3 : Math.min(6, Math.abs(k - i)));
        n.classList.toggle('on', k === i);
      });
      if (i < 0) target = 0;
      else {
        const n = nodes[i];
        target = clamp(
          n.offsetTop + n.offsetHeight / 2 - scroll.clientHeight * anchor,
          0,
          Math.max(0, scroll.scrollHeight - scroll.clientHeight),
        );
      }
      if (snap) y = target;
    }
    // frame-rate independent exponential smoothing: y += (target - y) * (1 - exp(-dt / tau)), tau = 0.14 s
    function tick(ts) {
      id = 0;
      if (dead) return;
      const dt = last ? Math.min(0.1, (ts - last) / 1000) : 1 / 60;
      last = ts;
      const i = activeIndex(lines, time() + 0.12); // 120 ms lead hides paint latency
      if (i !== cur) paint(i);
      if (Date.now() < userUntil)
        y = scroll.scrollTop; // the user is scrolling: do not fight them
      else {
        y += (target - y) * (1 - Math.exp(-dt / 0.14));
        if (!anim()) y = target;
        scroll.scrollTop = y;
      }
      if (run()) id = raf(tick);
    }
    function start() {
      if (!id && !dead && lines.length) {
        last = 0;
        id = raf(tick);
      }
    }
    const bump = () => {
      userUntil = Date.now() + 3500;
      start();
    };
    ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'].forEach((e) =>
      scroll.addEventListener(e, bump, { passive: true }),
    );
    scroll.addEventListener('click', (e) => {
      // tap a line: seek to it
      const p = e.target.closest && e.target.closest('.ly-line');
      const l = p && lines[+p.dataset.i];
      if (!l) return;
      userUntil = 0;
      seek(Math.max(0, l.t - off));
      paint(+p.dataset.i);
      start();
    });
    const setOffset = (v) => {
      off = Math.round(clamp(v, -10, 10) * 10) / 10;
      shown.textContent = (off < 0 ? '\u2212' : '+') + Math.abs(off).toFixed(1) + 's';
      start();
    };
    less.addEventListener('click', () => setOffset(off - 0.5));
    more.addEventListener('click', () => setOffset(off + 0.5));
    const onVis = () => {
      if (!doc.hidden) start();
    };
    doc.addEventListener('visibilitychange', onVis); // UI loop only: audio is never touched here

    function render(s) {
      if (id) {
        caf(id);
        id = 0;
      }
      scroll.textContent = '';
      nodes = [];
      lines = [];
      cur = -1;
      y = target = 0;
      msg.textContent = '';
      root.dataset.state = s.status;
      if (s.status === 'synced' && s.lines && s.lines.length) {
        lines = s.lines;
        scroll.append(el('div', 'ly-pad'));
        nodes = lines.map((l, i) => {
          const p = el('p', 'ly-line', l.text || '\u266a');
          p.dataset.i = String(i);
          scroll.append(p);
          return p;
        });
        scroll.append(el('div', 'ly-pad'));
        paint(activeIndex(lines, time() + 0.12), true);
        start();
      } else if (s.status === 'plain' && s.plain) {
        String(s.plain)
          .split(/\r?\n/)
          .forEach((t) => scroll.append(el('p', 'ly-plain', t || '\u00a0')));
      } else msg.textContent = MSG[s.status] || '';
      bar.hidden = !lines.length;
    }
    return {
      render,
      setOffset,
      poke() {
        cur = -2;
        start();
      }, // re-measure + re-anchor (after show / seek / play)
      destroy() {
        dead = true;
        if (id) caf(id);
        doc.removeEventListener('visibilitychange', onVis);
        root.textContent = '';
      },
    };
  }

  // ---- live card for the artwork view: replaces the static "snippet" ------------------------------------
  // Shows the current line + the next one; call update(seconds) from your timeupdate handler. o = { onOpen() }
  function preview(root, o = {}) {
    const doc = root.ownerDocument;
    const el = (tag, cls, txt) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (txt != null) e.textContent = txt;
      return e;
    };
    root.classList.add('lp');
    root.textContent = '';
    root.tabIndex = 0;
    root.setAttribute('role', 'button');
    root.setAttribute('aria-label', 'Open lyrics');
    const head = el('div', 'lp-head'),
      label = el('span', 'lp-label'),
      tag = el('span', 'lp-tag', 'OPEN');
    const curEl = el('p', 'lp-cur'),
      nextEl = el('p', 'lp-next');
    head.append(label, tag);
    root.append(head, curEl, nextEl);
    let lines = [],
      idx = -2;
    const open = () => {
      if (o.onOpen) o.onOpen();
    };
    root.addEventListener('click', open);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });

    function update(t) {
      if (!lines.length) return;
      const i = activeIndex(lines, t + 0.12);
      if (i === idx) return;
      idx = i;
      curEl.textContent = (i >= 0 && lines[i].text) || '\u266a';
      nextEl.textContent = (lines[i + 1] && lines[i + 1].text) || '';
      if (curEl.animate)
        curEl.animate(
          [
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 240, easing: 'ease-out' },
        );
    }
    function render(s) {
      lines = s.status === 'synced' && s.lines ? s.lines : [];
      idx = -2;
      root.dataset.state = s.status;
      label.textContent = (s.status === 'synced' ? 'SYNCED LYRICS' : 'LYRICS') + ' \u2022 LRCLIB';
      tag.hidden = !(lines.length || s.status === 'plain');
      nextEl.textContent = '';
      if (lines.length) update(0);
      else
        curEl.textContent =
          s.status === 'plain'
            ? 'Lyrics available (not synced)'
            : s.status === 'none'
              ? 'No synced lyrics for this track'
              : MSG[s.status] || '';
    }
    return {
      render,
      update,
      destroy() {
        root.textContent = '';
      },
    };
  }

  M.lyrics = { parseLRC, activeIndex, cleanTitle, pick, create, overlay, preview };
  if (typeof module === 'object' && module.exports) module.exports = M.lyrics;
})(globalThis);
