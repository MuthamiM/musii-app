/* musii/js/player.js - playback engine: queue, two <audio> elements (gapless / crossfade), prefetch, stall recovery.
 * Background playback rules: keep a real <audio> element playing, register Media Session handlers once, and never
 * pause because the page was hidden. Both elements are "unlocked" by one user gesture via unlock().
 *
 *   create({ audios: [audioA, audioB],
 *            resolve(track, { quality }) -> Promise<{ url, expiresAt?, bitrate? }>   // app-specific; verify URL
 *            match?(track) -> Promise<Track|null>     // binds tracks with source 'import' to a playable track
 *            crossfadeMs?, retries?, retryBase?, bitrates?, mediaSession? })  */
(function (g) {
  'use strict';
  const M = (g.Musii = g.Musii || {});
  const { LRU, Ewma, coalescer, emitter, backoff, clamp, now, gains, pickBitrate, silentWav } = M.core;
  const SILENT = silentWav();

  function create(o) {
    const {
      audios,
      resolve: fetchUrl,
      match = null,
      crossfadeMs = 0,
      retries = 3,
      retryBase = 500,
      bitrates = [64, 128, 256],
    } = o;
    if (!audios || audios.length !== 2 || typeof fetchUrl !== 'function')
      throw new Error('player needs audios[2] and resolve()');
    const ev = emitter(),
      urls = new LRU(64),
      once = coalescer(),
      kbps = new Ewma(0.3);
    let queue = [],
      orig = null,
      pos = -1,
      cur = 0,
      token = 0,
      repeat = 'off',
      pre = null,
      state = 'idle';
    let fade = null,
      stall = 0,
      retryT = 0,
      tries = 0,
      lastPos = 0,
      rate = 0,
      mT = 0,
      mB = 0;
    let warming = false,
      unlocked = false;
    const key = (t) => (t.source || '') + ':' + t.id;
    const A = () => audios[cur];
    const active = (a) => a === audios[cur] && a.getAttribute('src') !== SILENT;
    const time = () => A().currentTime || 0;
    const ms = M.mediaSession.create(
      // lock screen / notification banner
      {
        play: () => play(),
        pause: () => pause(),
        next: () => next(),
        prev: () => prev(),
        stop: () => stop(false),
        seek: (s) => seek(s),
        time,
      },
      'mediaSession' in o ? { session: o.mediaSession } : {},
    );

    function setState(s) {
      if (s === state) return;
      state = s;
      ev.emit('state', s);
      ms.setState(s);
    }

    // ---- stream URL resolution: coalesced, TTL-cached, quality follows measured throughput --------------
    const quality = () => (kbps.v ? pickBitrate(bitrates, kbps.v) : bitrates[1] || bitrates[0]);
    function resolve(t) {
      const k = key(t),
        hit = urls.get(k);
      if (hit) return Promise.resolve(hit);
      return once(k, async () => {
        let tr = t;
        if (tr.source === 'import' && match) tr = (await match(tr)) || tr; // imported track -> playable track
        const r = await fetchUrl(tr, { quality: quality() });
        const exp = r.expiresAt ? r.expiresAt - 30000 : now() + 20 * 60000; // refresh 30 s before expiry
        return urls.set(
          k,
          { url: r.url, track: tr, bitrate: r.bitrate || quality(), exp },
          Math.max(1, exp - now()),
        );
      });
    }

    // ---- queue navigation -------------------------------------------------------------------------------
    function idxNext(auto) {
      if (auto && repeat === 'one') return pos;
      if (pos + 1 < queue.length) return pos + 1;
      return repeat === 'all' && queue.length ? 0 : -1;
    }
    const canPrefetch = () => {
      const c = g.navigator && g.navigator.connection;
      return !(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')));
    };
    // pre-resolve the next two URLs; load the next track's first bytes into the idle element (unless data saver / 2g)
    async function warm() {
      if (warming || fade) return;
      warming = true;
      try {
        const n = idxNext(true),
          t = queue[n];
        if (n < 0 || !t) return;
        const ahead = queue[n + 1];
        if (ahead && n + 1 !== pos) resolve(ahead).catch(() => {});
        if (pre && pre.id === key(t)) return;
        const r = await resolve(t);
        if (queue[idxNext(true)] !== t || !canPrefetch()) return; // queue changed meanwhile / save-data
        const slot = 1 - cur,
          el = audios[slot];
        el.preload = 'auto';
        el.src = r.url;
        try {
          el.load();
        } catch (e) {
          /* jsdom / old UA */
        }
        pre = { id: key(t), slot };
      } catch (e) {
        /* best effort: go() resolves on demand */
      } finally {
        warming = false;
      }
    }

    // ---- element housekeeping ---------------------------------------------------------------------------
    function reset(a) {
      a.pause();
      a.removeAttribute('src');
      try {
        a.load();
      } catch (e) {
        /* ignore */
      }
      a.volume = 1;
    }
    function endFade() {
      clearInterval(fade);
      fade = null;
      audios.forEach((a) => {
        if (a !== A()) reset(a);
      });
      A().volume = 1;
    }
    function ramp(out, inn, dur, done) {
      // equal-power crossfade, 40 ms steps
      const t0 = now();
      fade = setInterval(() => {
        const p = clamp((now() - t0) / dur, 0, 1),
          k = gains(p);
        out.volume = clamp(k.out, 0, 1);
        inn.volume = clamp(k.in, 0, 1);
        if (p >= 1) {
          clearInterval(fade);
          fade = null;
          reset(out);
          inn.volume = 1;
          if (done) done();
        }
      }, 40);
    }

    // ---- throughput estimate from buffered growth (replace with Resource Timing if the CDN allows) ------
    function measure(a) {
      if (!rate || !a.buffered || !a.buffered.length) return;
      const end = a.buffered.end(a.buffered.length - 1),
        t = now();
      if (!mT) {
        mT = t;
        mB = end;
        return;
      }
      if (t - mT >= 800 && end > mB) {
        kbps.push(((end - mB) * rate) / ((t - mT) / 1000));
        mT = t;
        mB = end;
      }
    }

    // ---- start a track: reuse the preloaded element when possible ---------------------------------------
    async function go(i, opt = {}) {
      const { auto = false, startAt = 0, attempt = 0 } = opt;
      if (i < 0 || i >= queue.length) return stop(false);
      const my = ++token;
      clearTimeout(stall);
      clearTimeout(retryT);
      if (fade) endFade();
      pos = i;
      let t = queue[i];
      const usePre = !!pre && pre.id === key(t),
        slot = usePre ? pre.slot : 1 - cur,
        el = audios[slot],
        old = A();
      const xf = crossfadeMs > 0 && auto && old !== el && !old.paused;
      setState('loading');
      ev.emit('track', t, pos);
      if (!xf && old !== el) old.pause();
      try {
        let r = urls.get(key(t));
        if (!usePre) {
          r = await resolve(t);
          if (my !== token) return;
          el.src = r.url;
        }
        if (r && r.track !== t) {
          t = queue[pos] = r.track;
          ev.emit('track', t, pos);
        }
        rate = (r && r.bitrate) || 0;
        mT = mB = 0;
        pre = null;
        ms.setTrack(t);
        el.muted = false;
        el.volume = xf ? 0 : 1;
        if (startAt > 0) {
          try {
            el.currentTime = startAt;
          } catch (e) {
            /* applied on metadata load */
          }
        }
        cur = slot;
        lastPos = startAt;
        tries = attempt;
        await el.play();
        if (my !== token) return;
        if (xf) ramp(old, el, crossfadeMs, warm);
        else {
          reset(old);
          warm();
        }
      } catch (e) {
        if (my === token) fail(e, attempt);
      }
    }

    function fail(e, attempt) {
      if (e && e.name === 'NotAllowedError') {
        setState('paused');
        ev.emit('blocked');
        return;
      } // autoplay policy: wait for a tap
      if (e && e.name === 'AbortError') return; // superseded by a newer load
      const t = queue[pos];
      if (!t) return;
      if (attempt < retries) {
        urls.delete(key(t)); // URL may have expired / been revoked: re-resolve
        const n = attempt + 1,
          my = token;
        ev.emit('retry', n);
        retryT = setTimeout(
          () => {
            if (my === token) go(pos, { startAt: lastPos, attempt: n });
          },
          backoff(attempt, retryBase, 8000),
        );
        return;
      }
      ev.emit('error', e);
      const n = idxNext(true);
      if (n >= 0 && n !== pos) go(n, { auto: true });
      else stop(false);
    }
    const onError = (a) => fail(a.error || new Error('media error'), tries);

    function stop(ended) {
      token++;
      clearTimeout(stall);
      clearTimeout(retryT);
      if (fade) endFade();
      audios.forEach((a) => a.pause());
      setState(ended ? 'paused' : 'idle');
      if (ended) {
        try {
          A().currentTime = 0;
        } catch (e) {
          /* ignore */
        }
        ev.emit('queue-end');
      }
    }

    // ---- transport --------------------------------------------------------------------------------------
    function play() {
      const a = A();
      if (a.getAttribute('src')) {
        const p = a.play();
        return p && p.catch ? p.catch((e) => fail(e, tries)) : p;
      }
      if (queue.length) return go(Math.max(pos, 0));
    }
    function pause() {
      A().pause();
    }
    function seek(s) {
      const a = A(),
        d = a.duration;
      s = clamp(+s || 0, 0, isFinite(d) ? d : +s || 0);
      try {
        a.currentTime = s;
      } catch (e) {
        /* not seekable yet */
      }
      lastPos = s;
      ms.setPosition(s, d, a.playbackRate, true);
      ev.emit('time', s, d);
    }
    function next() {
      const n = idxNext(false);
      return n >= 0 ? go(n) : stop(true);
    }
    function prev() {
      return A().currentTime > 3 || pos <= 0 ? seek(0) : go(pos - 1);
    }

    // ---- queue editing ----------------------------------------------------------------------------------
    const changed = () => {
      pre = null;
      ev.emit('queue', queue.slice(), pos);
      warm();
    };
    function setShuffle(on) {
      if (on === !!orig) return;
      if (on) {
        // current track first, Fisher-Yates on the rest
        orig = queue.slice();
        const c = queue[pos],
          rest = queue.filter((_, i) => i !== pos);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        queue = c ? [c, ...rest] : rest;
        pos = c ? 0 : -1;
      } else {
        const c = queue[pos];
        queue = orig;
        orig = null;
        pos = Math.max(0, queue.indexOf(c));
      }
      changed();
    }

    // ---- gesture unlock (iOS/Safari): one tap must "activate" both elements -----------------------------
    function unlock() {
      if (unlocked) return;
      unlocked = true;
      audios.forEach((a) => {
        if (a.getAttribute('src')) return; // already in use
        a.muted = true;
        a.src = SILENT;
        const done = () => {
          if (a.getAttribute('src') === SILENT) {
            a.pause();
            a.removeAttribute('src');
            try {
              a.load();
            } catch (e) {
              /* ignore */
            }
          }
          a.muted = false;
        };
        const p = a.play();
        if (p && p.then) p.then(done, done);
        else done();
      });
    }

    // ---- element events ---------------------------------------------------------------------------------
    audios.forEach((a) => {
      a.addEventListener('timeupdate', () => {
        if (!active(a) || state === 'loading') return;
        lastPos = a.currentTime;
        ev.emit('time', a.currentTime, a.duration);
        ms.setPosition(a.currentTime, a.duration, a.playbackRate);
        const left = a.duration - a.currentTime;
        if (crossfadeMs > 0 && !fade && left * 1000 <= crossfadeMs) {
          const n = idxNext(true);
          if (n >= 0 && n !== pos) go(n, { auto: true });
        } else if (!pre && !warming && !fade && left < 20) warm();
      });
      a.addEventListener('ended', () => {
        if (!active(a)) return;
        const n = idxNext(true);
        if (n < 0) stop(true);
        else go(n, { auto: true });
      });
      a.addEventListener('playing', () => {
        if (!active(a)) return;
        clearTimeout(stall);
        setState('playing');
        ev.emit('buffering', false);
      });
      a.addEventListener('pause', () => {
        if (active(a) && !a.ended && state !== 'loading' && state !== 'idle') setState('paused');
      });
      a.addEventListener('waiting', () => {
        if (!active(a)) return;
        ev.emit('buffering', true);
        clearTimeout(stall);
        stall = setTimeout(() => onError(a), 10000); // stuck buffering for 10 s -> retry path
      });
      a.addEventListener('error', () => {
        if (active(a) && a.getAttribute('src')) onError(a);
      });
      a.addEventListener('durationchange', () => {
        if (active(a)) ms.setPosition(a.currentTime, a.duration, a.playbackRate, true);
      });
      a.addEventListener('progress', () => {
        if (active(a)) measure(a);
      });
    });

    return {
      on: ev.on,
      setQueue(list, start = 0, opt = {}) {
        queue = list.slice();
        orig = null;
        pre = null;
        pos = clamp(start, 0, Math.max(0, queue.length - 1));
        ev.emit('queue', queue.slice(), pos);
        return opt.autoplay === false || !queue.length ? undefined : go(pos);
      },
      play,
      pause,
      seek,
      next,
      prev,
      unlock,
      setShuffle,
      toggle: () => (state === 'playing' ? pause() : play()),
      stop: () => stop(false),
      addNext(t) {
        queue.splice(pos + 1, 0, t);
        if (orig) orig.push(t);
        changed();
      },
      enqueue(t) {
        queue.push(t);
        if (orig) orig.push(t);
        changed();
      },
      removeAt(i) {
        if (i === pos || i < 0 || i >= queue.length) return;
        queue.splice(i, 1);
        if (i < pos) pos--;
        changed();
      },
      setRepeat(m) {
        repeat = m === 'all' || m === 'one' ? m : 'off';
        pre = null;
        ev.emit('repeat', repeat);
        warm();
      },
      repeatMode: () => repeat,
      isShuffled: () => !!orig,
      state: () => state,
      current: () => queue[pos] || null,
      queue: () => queue.slice(),
      index: () => pos,
      time,
      duration: () => A().duration,
      throughput: () => kbps.v,
      destroy() {
        stop(false);
        ms.destroy();
        audios.forEach(reset);
      },
    };
  }

  M.player = { create };
  if (typeof module === 'object' && module.exports) module.exports = M.player;
})(globalThis);
