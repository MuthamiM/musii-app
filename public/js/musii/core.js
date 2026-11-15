/* musii/js/core.js - shared helpers. Classic script (window.Musii.core) and require()-able in Node. */
(function (g) {
  'use strict';
  const M = (g.Musii = g.Musii || {});
  const now = () => Date.now();
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  // id that also works on http:// origins, where crypto.randomUUID is undefined
  function uid() {
    const c = g.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return 'id-' + now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ---- text ------------------------------------------------------------------------------
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const tokens = (s) => {
    const n = norm(s);
    return n ? n.split(' ') : [];
  };

  // Damerau-Levenshtein (optimal string alignment) with early exit; returns max+1 when distance > max
  function dl(a, b, max = 2) {
    if (a === b) return 0;
    const la = a.length,
      lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let p2 = null,
      p1 = Array.from({ length: lb + 1 }, (_, j) => j);
    for (let i = 1; i <= la; i++) {
      const cur = [i];
      let min = i;
      for (let j = 1; j <= lb; j++) {
        let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
        cur[j] = v;
        if (v < min) min = v;
      }
      if (min > max) return max + 1;
      p2 = p1;
      p1 = cur;
    }
    return Math.min(p1[lb], max + 1);
  }
  const grams = (s, n = 3) => {
    const t = '  ' + s + ' ',
      out = new Set();
    for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n));
    return out;
  };
  const jaccard = (A, B) => {
    let i = 0;
    for (const x of A) if (B.has(x)) i++;
    return i / (A.size + B.size - i || 1);
  };

  // ---- caches / stats ---------------------------------------------------------------------
  class LRU {
    constructor(max = 100, ttl = 0) {
      this.max = max;
      this.ttl = ttl;
      this.m = new Map();
    }
    get(k) {
      const e = this.m.get(k);
      if (!e) return undefined;
      if (e.x && e.x < now()) {
        this.m.delete(k);
        return undefined;
      }
      this.m.delete(k);
      this.m.set(k, e); // refresh recency
      return e.v;
    }
    set(k, v, ttl = this.ttl) {
      this.m.delete(k);
      this.m.set(k, { v, x: ttl ? now() + ttl : 0 });
      while (this.m.size > this.max) this.m.delete(this.m.keys().next().value);
      return v;
    }
    has(k) {
      return this.get(k) !== undefined;
    }
    delete(k) {
      return this.m.delete(k);
    }
    clear() {
      this.m.clear();
    }
    get size() {
      return this.m.size;
    }
  }
  class Ewma {
    // exponentially weighted moving average
    constructor(a = 0.3) {
      this.a = a;
      this.v = null;
    }
    push(x) {
      this.v = this.v == null ? x : this.a * x + (1 - this.a) * this.v;
      return this.v;
    }
  }

  // ---- async -------------------------------------------------------------------------------
  const abortErr = () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    return e;
  };
  const sleep = (ms, signal) =>
    new Promise((res, rej) => {
      if (signal && signal.aborted) return rej(abortErr());
      const t = setTimeout(res, ms);
      if (signal)
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            rej(abortErr());
          },
          { once: true },
        );
    });
  // exponential backoff with jitter: delay(n) = min(cap, base * 2^n) * U(0.5, 1)
  const backoff = (n, base = 500, cap = 8000, rnd = Math.random) =>
    Math.min(cap, base * 2 ** n) * (0.5 + rnd() / 2);
  async function retry(fn, { tries = 3, base = 400, cap = 4000, signal } = {}) {
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn(i);
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        last = e;
        if (i < tries - 1) await sleep(backoff(i, base, cap), signal);
      }
    }
    throw last;
  }
  // share one in-flight promise per key
  const coalescer = () => {
    const m = new Map();
    return (key, fn) => {
      if (m.has(key)) return m.get(key);
      const p = Promise.resolve()
        .then(fn)
        .finally(() => m.delete(key));
      m.set(key, p);
      return p;
    };
  };
  const emitter = () => {
    const h = {};
    return {
      on(e, f) {
        (h[e] = h[e] || new Set()).add(f);
        return () => h[e].delete(f);
      },
      emit(e, ...a) {
        for (const f of [...(h[e] || [])]) {
          try {
            f(...a);
          } catch (x) {
            console.error(x);
          }
        }
      },
    };
  };

  // ---- format / safety ---------------------------------------------------------------------
  const fmt = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const hue = (s) => {
    let h = 7;
    for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 360;
  };
  const safeUrl = (u) => {
    // only http(s), blob:, data:image; quotes/space encoded
    u = String(u || '').trim();
    if (!/^(https?:|blob:|data:image\/(png|jpe?g|webp|gif);)/i.test(u)) return '';
    return u
      .slice(0, 2000)
      .replace(/["'()\\<>\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
  };

  // ---- playback math -----------------------------------------------------------------------
  // highest bitrate that fits inside safety * throughput (all in kbps); lowest rung when nothing fits
  const pickBitrate = (list, kbps, safety = 0.7) => {
    const ok = list.filter((b) => b <= kbps * safety);
    return ok.length ? Math.max(...ok) : Math.min(...list);
  };
  // equal-power crossfade, p in [0,1]: out^2 + in^2 = 1 (constant loudness)
  const gains = (p) => ({ out: Math.cos((p * Math.PI) / 2), in: Math.sin((p * Math.PI) / 2) });
  // 1-sample silent WAV as a data: URI (used to unlock <audio> elements on iOS)
  function silentWav() {
    const b = new Uint8Array(46),
      v = new DataView(b.buffer);
    const w = (o, s) => {
      for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i);
    };
    w(0, 'RIFF');
    v.setUint32(4, 38, true);
    w(8, 'WAVEfmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true);
    v.setUint32(28, 16000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, 2, true);
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return 'data:audio/wav;base64,' + g.btoa(s);
  }

  // ---- storage -----------------------------------------------------------------------------
  const memStorage = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => {
        m.set(k, String(v));
      },
      removeItem: (k) => {
        m.delete(k);
      },
    };
  };
  function storage() {
    // localStorage, or memory when blocked/unavailable
    try {
      const s = g.localStorage;
      if (s) {
        s.setItem('musii.probe', '1');
        s.removeItem('musii.probe');
        return s;
      }
    } catch (e) {
      /* private mode / sandboxed iframe */
    }
    return memStorage();
  }

  M.core = {
    now,
    clamp,
    uid,
    norm,
    tokens,
    dl,
    grams,
    jaccard,
    LRU,
    Ewma,
    sleep,
    backoff,
    retry,
    coalescer,
    emitter,
    fmt,
    hue,
    safeUrl,
    pickBitrate,
    gains,
    silentWav,
    memStorage,
    storage,
  };
  if (typeof module === 'object' && module.exports) module.exports = M.core;
})(globalThis);
