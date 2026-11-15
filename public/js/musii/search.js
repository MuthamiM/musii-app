/* musii/js/search.js - instant search: local inverted index + typo tolerance + hybrid (local + remote) ranking. */
(function (g) {
  'use strict';
  const M = (g.Musii = g.Musii || {});
  const { norm, tokens, dl, LRU } = M.core;
  const FIELD = { title: 1, artist: 0.7, album: 0.35 }; // field weights
  const sig = (t) => norm(t.title) + '|' + norm(t.artist);
  const deletes = (s) => {
    const o = [];
    for (let i = 0; i < s.length; i++) o.push(s.slice(0, i) + s.slice(i + 1));
    return o;
  };

  class Index {
    constructor() {
      this.docs = [];
      this.bySig = new Map();
      this.post = new Map(); // post: token -> Map(docIdx -> field weight)
      this.vocab = [];
      this.del = new Map();
      this.dirty = false;
    }

    add(list) {
      for (const t of list) {
        const s = sig(t);
        if (!t.title || this.bySig.has(s)) continue; // one doc per (title, artist)
        const i = this.docs.push({ t, tn: norm(t.title), an: norm(t.artist), plays: t.plays || 0 }) - 1;
        this.bySig.set(s, i);
        for (const f in FIELD) {
          for (const tok of tokens(t[f])) {
            let p = this.post.get(tok);
            if (!p) this.post.set(tok, (p = new Map()));
            if ((p.get(i) || 0) < FIELD[f]) p.set(i, FIELD[f]);
          }
        }
      }
      this.dirty = true;
      return this;
    }

    bump(t) {
      const i = this.bySig.get(sig(t));
      if (i != null) this.docs[i].plays++;
    } // call on every play

    _build() {
      if (!this.dirty) return;
      this.dirty = false;
      this.vocab = [...this.post.keys()].sort(); // sorted: prefix lookup = binary search
      this.del = new Map(); // symmetric-delete index, edit distance 1
      for (const tok of this.vocab) {
        if (tok.length < 4) continue;
        for (const k of [tok, ...deletes(tok)]) {
          const a = this.del.get(k);
          if (a) a.push(tok);
          else this.del.set(k, [tok]);
        }
      }
    }

    _prefix(p) {
      const a = this.vocab;
      let lo = 0,
        hi = a.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (a[m] < p) lo = m + 1;
        else hi = m;
      }
      const out = [];
      for (let i = lo; i < a.length && a[i].startsWith(p); i++) out.push(a[i]);
      if (out.length > 200) {
        out.sort((x, y) => this.post.get(y).size - this.post.get(x).size);
        out.length = 200;
      }
      return out; // bounded work per keystroke
    }

    // vocabulary tokens that can stand for one query token -> match quality in (0, 1]
    _expand(t, last) {
      const out = new Map();
      if (this.post.has(t)) out.set(t, 1);
      if (last)
        for (const tok of this._prefix(t))
          if (!out.has(tok)) out.set(tok, 0.7 + 0.3 * (t.length / tok.length));
      if (t.length >= 4) {
        for (const k of [t, ...deletes(t)]) {
          for (const tok of this.del.get(k) || []) if (!out.has(tok) && dl(t, tok, 1) <= 1) out.set(tok, 0.6);
        }
      }
      return out;
    }

    // score(d) = sum_i idf_i * s_i(d) / sum_i idf_i, then phrase bonuses and a capped popularity boost
    search(q, { limit = 20, minScore = 0.34 } = {}) {
      const qt = tokens(q);
      if (!qt.length || !this.docs.length) return [];
      this._build();
      const N = this.docs.length,
        acc = new Map();
      let idfSum = 0;
      qt.forEach((t, qi) => {
        const best = new Map();
        for (const [tok, quality] of this._expand(t, qi === qt.length - 1)) {
          for (const [d, w] of this.post.get(tok)) {
            const s = quality * w;
            if (s > (best.get(d) || 0)) best.set(d, s);
          }
        }
        const df = best.size,
          idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        idfSum += idf;
        for (const [d, s] of best) acc.set(d, (acc.get(d) || 0) + idf * s);
      });
      const nq = qt.join(' '),
        out = [];
      for (const [i, sum] of acc) {
        const d = this.docs[i];
        let s = sum / idfSum;
        if (d.tn === nq) s += 0.35;
        else if (d.tn.startsWith(nq)) s += 0.25;
        else if ((d.tn + ' ' + d.an).includes(nq)) s += 0.15;
        s *= 1 + Math.min(0.15, 0.05 * Math.log10(1 + d.plays));
        if (s >= minScore) out.push({ track: d.t, score: s });
      }
      return out
        .sort((a, b) => b.score - a.score || a.track.title.localeCompare(b.track.title))
        .slice(0, limit);
    }
  }

  // Reciprocal Rank Fusion: score(d) = sum over lists of 1 / (k + rank). Dedupes by (title, artist).
  function rrf(lists, k = 60) {
    const m = new Map();
    lists.forEach((list) =>
      list.forEach((t, r) => {
        const key = sig(t),
          e = m.get(key) || { t, s: 0 };
        e.s += 1 / (k + r + 1);
        m.set(key, e);
      }),
    );
    return [...m.values()].sort((a, b) => b.s - a.s).map((e) => e.t);
  }

  // local-first search controller: sync local paint, debounced remote fetch, cancel + stale-drop, learn results
  function create(o = {}) {
    const index = o.index,
      // sources: [{ search(q, { signal, limit }) -> Promise<Track[]> }] or a function returning that array
      sources = typeof o.sources === 'function' ? o.sources : () => o.sources || [];
    const wait = o.debounceMs == null ? 120 : o.debounceMs,
      limit = o.limit || 20;
    const cache = new LRU(100, o.ttl || 300000);
    let seq = 0,
      ctl = null,
      timer = 0;

    function cancel() {
      seq++;
      clearTimeout(timer);
      if (ctl) ctl.abort();
      ctl = null;
    }

    function run(q, h = {}) {
      cancel();
      const my = seq,
        nq = norm(q),
        stop = () => {
          if (my === seq) cancel();
        };
      const local = nq ? index.search(q, { limit }).map((r) => r.track) : [];
      if (h.onLocal) h.onLocal(local); // synchronous first paint, no network wait
      if (nq.length < 2) return { cancel: stop };
      const hit = cache.get(nq);
      if (hit) {
        if (h.onRemote) h.onRemote(rrf([local, hit]).slice(0, limit));
        return { cancel: stop };
      }
      timer = setTimeout(async () => {
        const c = (ctl = new AbortController()),
          ps = sources(),
          errs = [];
        const call = (p) =>
          Promise.resolve()
            .then(() => p.search(q, { signal: c.signal, limit }))
            .catch((e) => {
              if (!(e && e.name === 'AbortError')) errs.push(e);
              return null;
            });
        try {
          const got = (await Promise.all(ps.map(call))).filter(Array.isArray);
          if (my !== seq || c.signal.aborted) return; // stale: a newer keystroke owns the UI
          if (!got.length && errs.length) {
            if (h.onError) h.onError(errs[0]);
            return;
          }
          const remote = got.flat();
          cache.set(nq, remote);
          index.add(remote); // learn: next time this is a local hit
          if (h.onRemote) h.onRemote(rrf([local, ...got]).slice(0, limit));
        } catch (e) {
          if (my === seq && h.onError) h.onError(e);
        }
      }, wait);
      return { cancel: stop };
    }

    // best single match for "title artist" (used to bind imported tracks to a playable source)
    async function top(q, { signal } = {}) {
      const l = index.search(q, { limit: 1 })[0];
      if (l && l.score >= 0.75) return l.track;
      for (const p of sources()) {
        try {
          const r = await p.search(q, { signal, limit: 5 });
          if (r && r[0]) {
            index.add(r);
            return r[0];
          }
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
        }
      }
      return l ? l.track : null;
    }

    return { run, top, dispose: cancel };
  }

  M.search = { Index, rrf, create };
  if (typeof module === 'object' && module.exports) module.exports = M.search;
})(globalThis);
