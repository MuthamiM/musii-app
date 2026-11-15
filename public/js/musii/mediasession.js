/* musii/js/mediasession.js - lock-screen / notification-banner controls via the Media Session API.
 * Works with ANY player: call setTrack() on track change, setState() on play/pause, setPosition() on timeupdate.
 * Handlers are registered once; only the actions you pass are registered (no prev/next callback = no such button). */
(function (g) {
  'use strict';
  const M = (g.Musii = g.Musii || {});

  // h = { play, pause, next, prev, stop, seek(seconds), time(): seconds }   o = { session } (inject a fake in tests)
  function create(h, o = {}) {
    const ms = 'session' in o ? o.session : (g.navigator && g.navigator.mediaSession) || null;
    const wanted = {
      play: h.play,
      pause: h.pause,
      stop: h.stop,
      previoustrack: h.prev,
      nexttrack: h.next,
      seekto: h.seek && ((d) => h.seek(d.seekTime)),
      seekbackward: h.seek && h.time && ((d) => h.seek(h.time() - (d.seekOffset || 10))),
      seekforward: h.seek && h.time && ((d) => h.seek(h.time() + (d.seekOffset || 10))),
    };
    const set = (a, fn) => {
      try {
        ms.setActionHandler(a, fn);
      } catch (e) {
        /* action unsupported on this browser */
      }
    };
    if (ms) for (const a in wanted) if (wanted[a]) set(a, wanted[a]);
    let lastPS = 0;

    return {
      supported: !!ms,
      setTrack(t) {
        // t.artwork = [{ src, sizes, type }] or t.cover = url
        if (!ms || typeof g.MediaMetadata !== 'function') return;
        const art = t.artwork || (t.cover ? [{ src: t.cover, sizes: '512x512' }] : []);
        try {
          ms.metadata = new g.MediaMetadata({
            title: t.title,
            artist: t.artist || '',
            album: t.album || '',
            artwork: art,
          });
        } catch (e) {
          /* bad artwork URL */
        }
      },
      setState(s) {
        // 'playing' | 'paused' | anything else = none
        if (!ms) return;
        try {
          ms.playbackState = s === 'playing' ? 'playing' : s === 'paused' ? 'paused' : 'none';
        } catch (e) {
          /* old UA */
        }
      },
      setPosition(pos, dur, rate = 1, force = false) {
        // throttled to 1/s unless force (seek, new track)
        if (!ms || typeof ms.setPositionState !== 'function') return;
        const t = Date.now();
        if (!force && t - lastPS < 1000) return;
        lastPS = t;
        if (!isFinite(dur) || dur <= 0) return;
        try {
          ms.setPositionState({
            duration: dur,
            playbackRate: rate || 1,
            position: Math.min(Math.max(pos || 0, 0), dur),
          });
        } catch (e) {
          /* invalid state: ignore */
        }
      },
      destroy() {
        if (ms) for (const a in wanted) set(a, null);
      },
    };
  }

  M.mediaSession = { create };
  if (typeof module === 'object' && module.exports) module.exports = M.mediaSession;
})(globalThis);
