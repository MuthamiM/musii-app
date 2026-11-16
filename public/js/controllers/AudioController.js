import { audioSynth } from '../services/AudioSynthService.js';
import { haptics } from '../middleware/hapticMiddleware.js';
import { DEFAULT_TRACKS } from '../constants/tracks.js';
import { apiUrl } from '../constants/api.js';

class AudioController {
  constructor() {
    this.tracks = DEFAULT_TRACKS;
    this.currentIdx = 0;
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 214;
    this.listeners = [];
    this.syncedLyrics = [];
    this.currentLyricIdx = -1;
    this.useDirectStream = true;
    this.queue = [];
    this.isBuffering = false;
    this.isShuffled = false;
    this.repeatMode = 'off'; // off | one | all

    // --- Feature 1: Predictive Next-Track Prefetch ---
    this._prefetchedUrls = new Map(); // query -> resolved proxy URL (warm connection)
    this._prefetchInFlight = new Set();

    // --- Feature 4: Crossfade Engine ---
    this.crossfadeEnabled = false;
    this.crossfadeDuration = 6; // seconds (1-12 configurable)
    this._crossfading = false;
    this._fadeInterval = null;

    // --- Feature 5: Sleep Timer ---
    this.sleepTimerEnd = null;
    this._sleepTimerId = null;
    this._sleepFadeId = null;

    // --- Feature 7: Listening History ---
    this._listenStart = null;
    this._listenTrack = null;

    // --- Feature 9: Equalizer ---
    this._eqEnabled = false;
    this._eqPreset = 'flat';
    this._eqContext = null;
    this._eqSource = null;
    this._eqFilters = [];
    this._eqGainNode = null;

    // Native HTML5 Realtime Audio Element (primary)
    this.audio = new Audio();
    this.audio.preload = 'auto';

    // Secondary audio element for crossfade transitions
    this._audioB = new Audio();
    this._audioB.preload = 'auto';
    this._activeAudio = 'A'; // which element is currently playing

    // Global reference for native Android notification media actions
    if (typeof window !== 'undefined') {
      window.audioController = this;
    }

    this._loadPersistedSettings();
    this.initAudioListeners();

    // Register navigator.mediaSession action handlers eagerly at startup.
    // Samsung One UI and Chrome mobile require these to be set BEFORE playback
    // begins, otherwise the media notification is never created and background
    // audio is killed when the app is closed or screen is locked.
    this._registerMediaSessionHandlers();
  }

  _registerMediaSessionHandlers() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const setAction = (action, handler) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (e) {}
    };
    setAction('play', () => this.togglePlay());
    setAction('pause', () => this.pause());
    setAction('previoustrack', () => this.prev());
    setAction('nexttrack', () => this.next());
    setAction('seekto', (details) => {
      if (details && details.seekTime != null) this.seekTo(details.seekTime);
    });
    setAction('seekbackward', (details) => {
      const offset = (details && details.seekOffset) || 10;
      this.seekTo(Math.max(0, this.currentTime - offset));
    });
    setAction('seekforward', (details) => {
      const offset = (details && details.seekOffset) || 10;
      this.seekTo(Math.min(this.duration, this.currentTime + offset));
    });
  }

  // ============================
  // AUDIO EVENT LISTENERS
  // ============================
  initAudioListeners() {
    const bindTo = (el) => {
      el.addEventListener('loadstart', () => {
        if (this._getActiveAudioEl() === el) {
          this.isBuffering = true;
          this.notify();
        }
      });

      el.addEventListener('waiting', () => {
        if (this._getActiveAudioEl() === el) {
          this.isBuffering = true;
          this.notify();
        }
      });

      el.addEventListener('canplay', () => {
        if (this._getActiveAudioEl() === el) {
          this.isBuffering = false;
          this.notify();
        }
      });

      el.addEventListener('playing', () => {
        if (this._getActiveAudioEl() === el) {
          this.isBuffering = false;
          this.isPlaying = true;
          this.updateMediaSession(this.getCurrentTrack());
          this.notify();
        }
      });

      el.addEventListener('timeupdate', () => {
        if (this._getActiveAudioEl() !== el) return;
        this.currentTime = Math.floor(el.currentTime);
        if (el.duration && !isNaN(el.duration)) {
          this.duration = Math.floor(el.duration);
        }
        this.notifyProgress();
        this.checkLyricsSync();

        if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
          try {
            navigator.mediaSession.setPositionState({
              duration: Math.max(1, this.duration),
              playbackRate: 1,
              position: Math.min(this.currentTime, Math.max(1, this.duration))
            });
          } catch (e) {}
        }

        // Feature 1: Trigger prefetch at 70% through the track
        const pct = this.duration > 0 ? this.currentTime / this.duration : 0;
        if (pct > 0.70 && pct < 0.95) {
          this._triggerPrefetch();
        }

        // Feature 4: Start crossfade near end of track
        if (this.crossfadeEnabled && !this._crossfading && this.duration > 0) {
          const remaining = this.duration - this.currentTime;
          if (remaining <= this.crossfadeDuration && remaining > 0) {
            this._startCrossfade();
          }
        }

        // Feature 5: Check sleep timer
        if (this.sleepTimerEnd && Date.now() >= this.sleepTimerEnd) {
          this._executeSleepFade();
        }

        // Feature 7: Track listening time
        this._updateListenTime();
      });

      el.addEventListener('ended', () => {
        if (this._getActiveAudioEl() !== el) return;
        if (!this._crossfading) {
          this._recordListenEvent();
          if (this.repeatMode === 'one') {
            el.currentTime = 0;
            el.play().catch(() => {});
          } else {
            this.next();
          }
        }
      });

      el.addEventListener('error', (e) => {
        console.warn('[AudioController] Stream error loading audio:', e);
      });

      el.addEventListener('play', () => {
        if (this._getActiveAudioEl() === el) {
          this.isPlaying = true;
          this.updateMediaSession(this.getCurrentTrack());
          this.notify();
        }
      });

      el.addEventListener('pause', () => {
        if (this._getActiveAudioEl() === el) {
          this.isPlaying = false;
          this.updateMediaSession(this.getCurrentTrack());
          this.notify();
        }
      });
    };

    bindTo(this.audio);
    bindTo(this._audioB);
  }

  _getActiveAudioEl() {
    return this._activeAudio === 'A' ? this.audio : this._audioB;
  }

  _getInactiveAudioEl() {
    return this._activeAudio === 'A' ? this._audioB : this.audio;
  }

  // ============================
  // CORE PLAYBACK
  // ============================
  setTracks(tracks) {
    if (tracks && tracks.length > 0) {
      this.tracks = tracks;
      this.notify();
    }
  }

  getCurrentTrack() {
    return this.tracks[this.currentIdx] || this.tracks[0];
  }

  formatTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  }

  _buildStreamUrl(track) {
    const streamQuery = encodeURIComponent(`${track.artist || ''} ${track.title || ''}`.trim());
    return apiUrl(`/api/stream/play?q=${streamQuery}`);
  }

  async play() {
    const track = this.getCurrentTrack();
    this.isPlaying = true;
    this._startListenTracking(track);

    // Record play on backend to increment play count and auto-cache
    if (track && track.id) {
      fetch(apiUrl(`/api/music/track/${track.id}/play`), { method: 'POST' })
        .then(res => res.json())
        .then(() => {
          window.dispatchEvent(new CustomEvent('musii:track-played', { detail: { track } }));
        })
        .catch(() => {});
    }

    const streamUrl = this._buildStreamUrl(track);

    // If running in native Android app, play directly via Foreground Service MediaPlayer
    if (typeof window !== 'undefined' && window.MusiiNative && typeof window.MusiiNative.playStream === 'function') {
      const coverUrl = track.cover_art || track.thumbnail || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg';
      window.MusiiNative.playStream(
        streamUrl,
        track.title || 'MUSII',
        track.artist || 'Unknown Artist',
        coverUrl,
        Number(this.duration || 210)
      );
      // CRITICAL: Call updateMediaSession immediately for native playback.
      // HTML5 audio element events (playing/play/pause) do NOT fire when
      // MusiiNative handles playback, so mediaSession metadata and action
      // handlers would never be registered, causing Samsung One UI to
      // drop the notification and kill background audio.
      this.updateMediaSession(track);
    } else {
      const el = this._getActiveAudioEl();
      if (el.src !== streamUrl) {
        el.src = streamUrl;
      }
      try {
        await el.play();
      } catch (err) {
        console.warn('[AudioController] play failed:', err);
      }
    }

    this.loadLyrics(track);
    this.notify();

    // Feature 1: Prefetch the next track immediately on play
    this._triggerPrefetch();
  }

  pause() {
    this.isPlaying = false;
    if (typeof window !== 'undefined' && window.MusiiNative && typeof window.MusiiNative.pauseAudio === 'function') {
      window.MusiiNative.pauseAudio();
      this.updateMediaSession(this.getCurrentTrack());
    } else {
      this._getActiveAudioEl().pause();
    }
    this.notify();
  }

  onNativeProgress(currentTime, duration) {
    this.currentTime = Math.floor(currentTime);
    if (duration && !isNaN(duration) && duration > 0) {
      this.duration = Math.floor(duration);
    }
    this.notifyProgress();
    this.checkLyricsSync();
    this._updateListenTime();

    // Prefetch at 70%
    const pct = this.duration > 0 ? this.currentTime / this.duration : 0;
    if (pct > 0.70 && pct < 0.95) {
      this._triggerPrefetch();
    }
  }

  onNativePlaying() {
    this.isBuffering = false;
    this.isPlaying = true;
    this.updateMediaSession(this.getCurrentTrack());
    this.notify();
  }

  togglePlay() {
    haptics.trigger('medium');
    if (this.isPlaying) {
      this.pause();
    } else {
      if (typeof window !== 'undefined' && window.MusiiNative && typeof window.MusiiNative.resumeAudio === 'function') {
        window.MusiiNative.resumeAudio();
        this.isPlaying = true;
        this.updateMediaSession(this.getCurrentTrack());
        this.notify();
      } else {
        this.play();
      }
    }
  }

  selectTrack(index, autoPlay = true) {
    haptics.trigger('medium');
    this._recordListenEvent();
    this.currentIdx = (index + this.tracks.length) % this.tracks.length;
    this.currentTime = 0;
    this.currentLyricIdx = -1;
    this.syncedLyrics = [];

    const track = this.getCurrentTrack();
    this.duration = track.duration || 210;
    this.isBuffering = true;
    this.notify();

    if (this.useDirectStream) {
      this._getActiveAudioEl().src = this._buildStreamUrl(track);
    }

    this.notifyProgress();
    if (typeof window !== 'undefined' && window.setMusiiLyricsMode) {
      window.setMusiiLyricsMode('art');
    }
    const miniEl = document.getElementById('floatingMiniPlayer');
    if (miniEl) miniEl.classList.remove('mini-hidden');
    const navEl = document.getElementById('navIslandWrapper');
    if (navEl) navEl.classList.remove('nav-hidden');

    if (autoPlay) {
      this.play();
    } else {
      this.notify();
    }
  }

  playSong(song) {
    let idx = this.tracks.findIndex(t => t.id === song.id || (t.title.toLowerCase() === song.title.toLowerCase() && t.artist.toLowerCase() === song.artist.toLowerCase()));
    if (idx === -1) {
      const newTrack = {
        id: song.id || Date.now(),
        title: song.title,
        artist: song.artist || 'Unknown Artist',
        album: song.album || 'Single',
        duration: song.duration || 210,
        rootFreq: 220,
        gradient: song.gradient || 'linear-gradient(135deg, #e63946 0%, #1e1b4b 100%)',
        category: 'Search Stream',
        cover_art: song.cover_art || song.thumbnail || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg',
        lyricsSnippet: song.lyricsSnippet || `Now streaming ${song.title} by ${song.artist}`
      };
      this.tracks.unshift(newTrack);
      idx = 0;
    }
    this.selectTrack(idx, true);
  }

  next() {
    haptics.trigger('medium');
    this._recordListenEvent();
    if (this.queue && this.queue.length > 0) {
      const nextTrack = this.queue.shift();
      this._saveQueueToStorage();
      this.notifyQueue();
      this.playSong(nextTrack);
    } else if (this.repeatMode === 'all') {
      this.selectTrack(this.currentIdx + 1, true);
    } else {
      if (this.currentIdx < this.tracks.length - 1) {
        this.selectTrack(this.currentIdx + 1, true);
      } else {
        // End of list and no repeat
        this.selectTrack(0, false);
        this.pause();
      }
    }
  }

  prev() {
    haptics.trigger('medium');
    // If more than 3 seconds in, restart current track
    if (this.currentTime > 3) {
      this.seekTo(0);
      return;
    }
    this._recordListenEvent();
    this.selectTrack(this.currentIdx - 1, true);
  }

  // ============================
  // QUEUE MANAGEMENT (Feature 6)
  // ============================
  addToQueue(track) {
    haptics.trigger('medium');
    this.queue.push(track);
    this._saveQueueToStorage();
    this.notifyQueue();
    window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: `Added "${track.title}" to queue` } }));
  }

  playNextInQueue(track) {
    haptics.trigger('medium');
    this.queue.unshift(track);
    this._saveQueueToStorage();
    this.notifyQueue();
    window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: `"${track.title}" will play next` } }));
  }

  removeFromQueue(index) {
    haptics.trigger('light');
    if (index >= 0 && index < this.queue.length) {
      this.queue.splice(index, 1);
      this._saveQueueToStorage();
      this.notifyQueue();
    }
  }

  reorderQueue(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.queue.length) return;
    if (toIndex < 0 || toIndex >= this.queue.length) return;
    const [item] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, item);
    this._saveQueueToStorage();
    this.notifyQueue();
  }

  clearQueue() {
    haptics.trigger('light');
    this.queue = [];
    this._saveQueueToStorage();
    this.notifyQueue();
    window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: 'Queue cleared' } }));
  }

  _saveQueueToStorage() {
    try {
      localStorage.setItem('musii_queue', JSON.stringify(this.queue.slice(0, 100)));
    } catch (e) {}
  }

  _loadQueueFromStorage() {
    try {
      const stored = localStorage.getItem('musii_queue');
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch (e) {}
  }

  notifyQueue() {
    window.dispatchEvent(new CustomEvent('musii:queue-updated', {
      detail: { queue: this.queue }
    }));
  }

  // ============================
  // SHUFFLE & REPEAT
  // ============================
  toggleShuffle() {
    haptics.trigger('medium');
    this.isShuffled = !this.isShuffled;
    if (this.isShuffled) {
      // Fisher-Yates shuffle on upcoming tracks, keep current track in place
      const current = this.tracks[this.currentIdx];
      const rest = this.tracks.filter((_, i) => i !== this.currentIdx);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      this.tracks = [current, ...rest];
      this.currentIdx = 0;
      window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: 'Shuffle on' } }));
    } else {
      window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: 'Shuffle off' } }));
    }
    this._persistSettings();
    this.notify();
    window.dispatchEvent(new CustomEvent('musii:shuffle-changed', { detail: { isShuffled: this.isShuffled } }));
  }

  cycleRepeat() {
    haptics.trigger('medium');
    const modes = ['off', 'all', 'one'];
    const currentIdx = modes.indexOf(this.repeatMode);
    this.repeatMode = modes[(currentIdx + 1) % modes.length];
    const labels = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };
    window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: labels[this.repeatMode] } }));
    this._persistSettings();
    window.dispatchEvent(new CustomEvent('musii:repeat-changed', { detail: { repeatMode: this.repeatMode } }));
  }

  // ============================
  // SEEK
  // ============================
  seek(ratio) {
    haptics.trigger('light');
    const clamped = Math.max(0, Math.min(1, ratio));
    const targetTime = clamped * this.duration;

    const el = this._getActiveAudioEl();
    if (el && el.duration) {
      el.currentTime = targetTime;
    }
    this.currentTime = Math.floor(targetTime);
    this.notifyProgress();
    this.checkLyricsSync();
  }

  seekTo(seconds) {
    haptics.trigger('light');
    const clamped = Math.max(0, Math.min(this.duration, seconds));
    if (typeof window !== 'undefined' && window.MusiiNative && typeof window.MusiiNative.seekAudio === 'function') {
      window.MusiiNative.seekAudio(clamped);
    } else {
      const el = this._getActiveAudioEl();
      if (el && !isNaN(clamped)) {
        el.currentTime = clamped;
      }
    }
    this.currentTime = Math.floor(clamped);
    this.notifyProgress();
    this.checkLyricsSync();
  }

  // ============================
  // DOWNLOAD
  // ============================
  downloadCurrentTrack() {
    haptics.trigger('medium');
    const track = this.getCurrentTrack();
    if (!track) return;
    const query = encodeURIComponent(`${track.artist} ${track.title}`.trim());
    const filename = encodeURIComponent(`${track.artist} - ${track.title}.m4a`);
    const downloadUrl = apiUrl(`/api/stream/download?q=${query}&filename=${filename}`);

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${track.artist} - ${track.title}.m4a`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: `Downloading ${track.title}...` } }));
  }

  // ============================
  // Feature 1: PREDICTIVE PREFETCH
  // ============================
  _triggerPrefetch() {
    // Prefetch next 2 tracks in queue or playlist
    const upcoming = [];

    if (this.queue.length > 0) {
      upcoming.push(this.queue[0]);
      if (this.queue.length > 1) upcoming.push(this.queue[1]);
    } else {
      const next1 = (this.currentIdx + 1) % this.tracks.length;
      const next2 = (this.currentIdx + 2) % this.tracks.length;
      if (this.tracks[next1]) upcoming.push(this.tracks[next1]);
      if (this.tracks[next2] && next2 !== next1) upcoming.push(this.tracks[next2]);
    }

    const queries = upcoming.map(t => `${t.artist || ''} ${t.title || ''}`.trim()).filter(Boolean);

    for (const q of queries) {
      if (this._prefetchedUrls.has(q) || this._prefetchInFlight.has(q)) continue;
      this._prefetchInFlight.add(q);

      // Fire a HEAD request to the proxy endpoint to warm the yt-dlp cache on the server
      // This means when the user actually clicks next, the URL is already resolved server-side
      const warmUrl = apiUrl(`/api/stream/url?q=${encodeURIComponent(q)}`);
      fetch(warmUrl, { priority: 'low' })
        .then(res => res.json())
        .then(json => {
          if (json.url) {
            this._prefetchedUrls.set(q, json.url);
            console.log('[Prefetch] Warmed:', q);
          }
        })
        .catch(() => {})
        .finally(() => this._prefetchInFlight.delete(q));
    }
  }

  // ============================
  // Feature 4: CROSSFADE ENGINE
  // ============================
  setCrossfade(enabled, durationSec = 6) {
    this.crossfadeEnabled = enabled;
    this.crossfadeDuration = Math.max(1, Math.min(12, durationSec));
    this._persistSettings();
    window.dispatchEvent(new CustomEvent('musii:toast', {
      detail: { message: enabled ? `Crossfade ${this.crossfadeDuration}s` : 'Crossfade off' }
    }));
  }

  _startCrossfade() {
    if (this._crossfading) return;
    this._crossfading = true;

    // Determine next track
    let nextTrack;
    if (this.queue.length > 0) {
      nextTrack = this.queue[0];
    } else {
      const nextIdx = (this.currentIdx + 1) % this.tracks.length;
      nextTrack = this.tracks[nextIdx];
    }
    if (!nextTrack) {
      this._crossfading = false;
      return;
    }

    const inactive = this._getInactiveAudioEl();
    inactive.src = this._buildStreamUrl(nextTrack);
    inactive.volume = 0;
    inactive.play().catch(() => {});

    const active = this._getActiveAudioEl();
    const steps = 20; // fade steps
    const intervalMs = (this.crossfadeDuration * 1000) / steps;
    let step = 0;

    this._fadeInterval = setInterval(() => {
      step++;
      const ratio = step / steps;
      active.volume = Math.max(0, 1 - ratio);
      inactive.volume = Math.min(1, ratio);

      if (step >= steps) {
        clearInterval(this._fadeInterval);
        this._fadeInterval = null;

        active.pause();
        active.src = '';
        active.volume = 1;

        // Swap active audio element
        this._activeAudio = this._activeAudio === 'A' ? 'B' : 'A';
        this._crossfading = false;

        // Update track state
        this._recordListenEvent();
        if (this.queue.length > 0) {
          const queued = this.queue.shift();
          this._saveQueueToStorage();
          this.notifyQueue();
          let idx = this.tracks.findIndex(t => t.id === queued.id);
          if (idx === -1) {
            this.tracks.unshift(queued);
            idx = 0;
          }
          this.currentIdx = idx;
        } else {
          this.currentIdx = (this.currentIdx + 1) % this.tracks.length;
        }
        this.currentTime = 0;
        this.currentLyricIdx = -1;
        this.syncedLyrics = [];
        const track = this.getCurrentTrack();
        this.duration = track.duration || 210;
        this._startListenTracking(track);
        this.loadLyrics(track);
        this.notify();
        this._triggerPrefetch();
      }
    }, intervalMs);
  }

  // ============================
  // Feature 5: SLEEP TIMER
  // ============================
  setSleepTimer(minutes) {
    haptics.trigger('medium');
    this.cancelSleepTimer();

    if (minutes === 'end') {
      // Sleep at end of current track
      this.sleepTimerEnd = -1; // special sentinel
      window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: 'Sleep: end of track' } }));
      window.dispatchEvent(new CustomEvent('musii:sleep-timer-set', { detail: { mode: 'end', remaining: null } }));
      return;
    }

    if (!minutes || minutes <= 0) {
      this.cancelSleepTimer();
      return;
    }

    this.sleepTimerEnd = Date.now() + (minutes * 60 * 1000);
    window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: `Sleep timer: ${minutes} min` } }));
    window.dispatchEvent(new CustomEvent('musii:sleep-timer-set', { detail: { mode: 'timed', remaining: minutes * 60 } }));

    // Update countdown every second
    this._sleepTimerId = setInterval(() => {
      if (!this.sleepTimerEnd || this.sleepTimerEnd <= 0) {
        clearInterval(this._sleepTimerId);
        return;
      }
      const remaining = Math.max(0, Math.ceil((this.sleepTimerEnd - Date.now()) / 1000));
      window.dispatchEvent(new CustomEvent('musii:sleep-timer-tick', { detail: { remaining } }));
      if (remaining <= 0) {
        this._executeSleepFade();
      }
    }, 1000);
  }

  cancelSleepTimer() {
    this.sleepTimerEnd = null;
    if (this._sleepTimerId) clearInterval(this._sleepTimerId);
    if (this._sleepFadeId) clearInterval(this._sleepFadeId);
    this._sleepTimerId = null;
    this._sleepFadeId = null;
    window.dispatchEvent(new CustomEvent('musii:sleep-timer-cancelled'));
  }

  _executeSleepFade() {
    if (this._sleepFadeId) return;
    this.cancelSleepTimer();

    // Fade volume to 0 over 3 seconds then pause
    const el = this._getActiveAudioEl();
    const startVol = el.volume;
    const steps = 15;
    let step = 0;
    this._sleepFadeId = setInterval(() => {
      step++;
      el.volume = Math.max(0, startVol * (1 - step / steps));
      if (step >= steps) {
        clearInterval(this._sleepFadeId);
        this._sleepFadeId = null;
        this.pause();
        el.volume = startVol; // Restore volume for next play
        window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: 'Sleep timer - paused' } }));
        window.dispatchEvent(new CustomEvent('musii:sleep-timer-fired'));
      }
    }, 200);
  }

  getSleepTimerRemaining() {
    if (!this.sleepTimerEnd) return null;
    if (this.sleepTimerEnd === -1) return 'end';
    return Math.max(0, Math.ceil((this.sleepTimerEnd - Date.now()) / 1000));
  }

  // ============================
  // Feature 7: LISTENING HISTORY
  // ============================
  _startListenTracking(track) {
    this._listenStart = Date.now();
    this._listenTrack = track;
  }

  _updateListenTime() {
    // No-op here; actual recording happens on track end
  }

  _recordListenEvent() {
    if (!this._listenTrack || !this._listenStart) return;
    const durationListened = Math.floor((Date.now() - this._listenStart) / 1000);

    // Only record if listened for at least 30 seconds
    if (durationListened < 30) {
      this._listenStart = null;
      this._listenTrack = null;
      return;
    }

    const track = this._listenTrack;
    this._listenStart = null;
    this._listenTrack = null;

    // Store locally
    try {
      const history = JSON.parse(localStorage.getItem('musii_listen_history') || '[]');
      history.unshift({
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        cover_art: track.cover_art || track.thumbnail,
        durationListened,
        playedAt: new Date().toISOString()
      });
      // Keep max 500 entries locally
      if (history.length > 500) history.length = 500;
      localStorage.setItem('musii_listen_history', JSON.stringify(history));
    } catch (e) {}

    // Also report to backend
    fetch(apiUrl('/api/music/history/record'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        durationListened
      })
    }).catch(() => {});
  }

  getLocalHistory(limit = 50) {
    try {
      const history = JSON.parse(localStorage.getItem('musii_listen_history') || '[]');
      return history.slice(0, limit);
    } catch (e) {
      return [];
    }
  }

  getLocalStats() {
    try {
      const history = JSON.parse(localStorage.getItem('musii_listen_history') || '[]');
      const now = Date.now();
      const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
      const monthAgo = now - (30 * 24 * 60 * 60 * 1000);

      let totalSecondsWeek = 0;
      let totalSecondsMonth = 0;
      const artistCounts = {};
      const trackCounts = {};

      for (const entry of history) {
        const ts = new Date(entry.playedAt).getTime();
        if (ts >= weekAgo) totalSecondsWeek += entry.durationListened || 0;
        if (ts >= monthAgo) totalSecondsMonth += entry.durationListened || 0;

        const ak = entry.artist || 'Unknown';
        artistCounts[ak] = (artistCounts[ak] || 0) + 1;
        const tk = `${entry.title}|||${entry.artist}`;
        trackCounts[tk] = (trackCounts[tk] || 0) + 1;
      }

      const topArtists = Object.entries(artistCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }));

      const topTracks = Object.entries(trackCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([key, count]) => {
          const [title, artist] = key.split('|||');
          return { title, artist, count };
        });

      return {
        totalMinutesWeek: Math.round(totalSecondsWeek / 60),
        totalMinutesMonth: Math.round(totalSecondsMonth / 60),
        topArtists,
        topTracks,
        totalPlays: history.length
      };
    } catch (e) {
      return { totalMinutesWeek: 0, totalMinutesMonth: 0, topArtists: [], topTracks: [], totalPlays: 0 };
    }
  }

  // ============================
  // Feature 9: EQUALIZER
  // ============================
  static EQ_PRESETS = {
    flat:       [0, 0, 0, 0, 0],
    bass:       [6, 4, 0, 0, 0],
    vocal:      [-2, 0, 3, 2, 0],
    rock:       [4, 2, -1, 2, 4],
    electronic: [5, 3, 0, -1, 3],
    small:      [2, 0, 0, 2, 4]  // Small speakers compensation
  };

  static EQ_FREQUENCIES = [60, 230, 910, 3600, 14000]; // 5-band

  initEqualizer() {
    if (this._eqContext) return; // Already initialized
    try {
      this._eqContext = new (window.AudioContext || window.webkitAudioContext)();
      this._eqSource = this._eqContext.createMediaElementSource(this._getActiveAudioEl());
      this._eqGainNode = this._eqContext.createGain();

      // Create 5-band EQ filter chain
      this._eqFilters = AudioController.EQ_FREQUENCIES.map((freq, i) => {
        const filter = this._eqContext.createBiquadFilter();
        if (i === 0) {
          filter.type = 'lowshelf';
        } else if (i === AudioController.EQ_FREQUENCIES.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.4;
        }
        filter.frequency.value = freq;
        filter.gain.value = 0;
        return filter;
      });

      // Chain: source -> filter[0] -> filter[1] -> ... -> gain -> destination
      this._eqSource.connect(this._eqFilters[0]);
      for (let i = 0; i < this._eqFilters.length - 1; i++) {
        this._eqFilters[i].connect(this._eqFilters[i + 1]);
      }
      this._eqFilters[this._eqFilters.length - 1].connect(this._eqGainNode);
      this._eqGainNode.connect(this._eqContext.destination);

      this._eqEnabled = true;
      this.setEqPreset(this._eqPreset);
      console.log('[EQ] Initialized 5-band equalizer');
    } catch (e) {
      console.warn('[EQ] Web Audio API not available:', e);
    }
  }

  setEqPreset(presetName) {
    const gains = AudioController.EQ_PRESETS[presetName] || AudioController.EQ_PRESETS.flat;
    this._eqPreset = presetName;

    if (this._eqFilters.length === gains.length) {
      for (let i = 0; i < this._eqFilters.length; i++) {
        this._eqFilters[i].gain.value = gains[i];
      }
    }

    this._persistSettings();
    window.dispatchEvent(new CustomEvent('musii:eq-changed', { detail: { preset: presetName, gains } }));
  }

  setEqBand(bandIndex, gainDb) {
    if (this._eqFilters[bandIndex]) {
      this._eqFilters[bandIndex].gain.value = Math.max(-12, Math.min(12, gainDb));
      this._eqPreset = 'custom';
      window.dispatchEvent(new CustomEvent('musii:eq-changed', {
        detail: { preset: 'custom', gains: this._eqFilters.map(f => f.gain.value) }
      }));
    }
  }

  getEqState() {
    return {
      enabled: this._eqEnabled,
      preset: this._eqPreset,
      gains: this._eqFilters.map(f => f.gain.value),
      frequencies: AudioController.EQ_FREQUENCIES
    };
  }

  // ============================
  // Feature 10: SHARE & DEEP LINK
  // ============================
  async shareCurrentTrack() {
    haptics.trigger('medium');
    const track = this.getCurrentTrack();
    if (!track) return;

    const shareUrl = `${window.location.origin}/play?q=${encodeURIComponent(`${track.artist} ${track.title}`)}`;
    const shareData = {
      title: `${track.title} - ${track.artist}`,
      text: `Listen to "${track.title}" by ${track.artist} on MUSII`,
      url: shareUrl
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (e) {
        // User cancelled or not supported
        this._copyToClipboard(shareUrl);
      }
    } else {
      this._copyToClipboard(shareUrl);
    }
  }

  _copyToClipboard(text) {
    try {
      navigator.clipboard.writeText(text);
      window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: 'Link copied to clipboard' } }));
    } catch (e) {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: 'Link copied to clipboard' } }));
    }
  }

  generateShareImage(track) {
    // Creates a canvas image with album art and track info for social sharing
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');

      // Dark background
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, 1080, 1080);

      // Gradient overlay
      const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
      grad.addColorStop(0, 'rgba(230, 57, 70, 0.3)');
      grad.addColorStop(1, 'rgba(30, 27, 75, 0.6)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1080, 1080);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        // Draw album art centered
        const size = 500;
        const x = (1080 - size) / 2;
        const y = 180;
        // Rounded rect clip
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, size, size, 24);
        ctx.clip();
        ctx.drawImage(img, x, y, size, size);
        ctx.restore();

        // Track title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 42px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(track.title || '', 540, 760);

        // Artist
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '28px Inter, system-ui, sans-serif';
        ctx.fillText(track.artist || '', 540, 810);

        // MUSII branding
        ctx.fillStyle = 'rgba(230, 57, 70, 0.9)';
        ctx.font = 'bold 24px Inter, system-ui, sans-serif';
        ctx.fillText('MUSII', 540, 980);

        canvas.toBlob(blob => resolve(blob), 'image/png');
      };
      img.onerror = () => {
        // No cover art, just text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 42px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(track.title || '', 540, 500);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '28px Inter, system-ui, sans-serif';
        ctx.fillText(track.artist || '', 540, 560);
        canvas.toBlob(blob => resolve(blob), 'image/png');
      };
      img.src = track.cover_art || track.thumbnail || '';
    });
  }

  // ============================
  // SYNCED LYRICS
  // ============================
  async loadLyrics(track) {
    try {
      const res = await fetch(apiUrl(`/api/lyrics?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}&duration=${track.duration}`));
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.synced && Array.isArray(json.data.lines)) {
          this.syncedLyrics = json.data.lines;
          window.dispatchEvent(new CustomEvent('musii:lyrics-loaded', { detail: { lines: this.syncedLyrics } }));
          return;
        }
      }
    } catch (e) {}

    // Fallback: simple snippet
    this.syncedLyrics = [
      { time: 0, text: track.lyricsSnippet || track.lyrics_snippet || `Playing ${track.title} by ${track.artist}` }
    ];
    window.dispatchEvent(new CustomEvent('musii:lyrics-loaded', { detail: { lines: this.syncedLyrics } }));
  }

  checkLyricsSync() {
    if (!this.syncedLyrics || this.syncedLyrics.length === 0) return;

    let activeIdx = -1;
    for (let i = 0; i < this.syncedLyrics.length; i++) {
      if (this.currentTime >= this.syncedLyrics[i].time) {
        activeIdx = i;
      } else {
        break;
      }
    }

    if (activeIdx !== this.currentLyricIdx && activeIdx >= 0) {
      this.currentLyricIdx = activeIdx;
      window.dispatchEvent(new CustomEvent('musii:lyric-change', {
        detail: {
          index: activeIdx,
          line: this.syncedLyrics[activeIdx]
        }
      }));
    }
  }

  // ============================
  // NOTIFICATION / STATE
  // ============================
  subscribe(listener) {
    this.listeners.push(listener);
  }

  notify() {
    const track = this.getCurrentTrack();
    this.listeners.forEach(fn => fn({
      track,
      isPlaying: this.isPlaying,
      isBuffering: Boolean(this.isBuffering),
      currentTime: this.currentTime,
      duration: this.duration
    }));
  }

  notifyProgress() {
    const track = this.getCurrentTrack();
    const duration = this.duration || track.duration || 1;
    const progressEvent = new CustomEvent('musii:progress', {
      detail: {
        currentTime: this.currentTime,
        duration,
        ratio: Math.min(1, this.currentTime / duration),
        timeFormatted: this.formatTime(this.currentTime)
      }
    });
    window.dispatchEvent(progressEvent);
  }

  updateMediaSession(track) {
    if (!track) return;

    // Bridge with native Android Foreground Service & Notification Banner (Samsung One UI / Android)
    if (typeof window !== 'undefined' && window.MusiiNative && typeof window.MusiiNative.updateNotification === 'function') {
      try {
        const coverUrl = track.cover_art || track.thumbnail || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg';
        window.MusiiNative.updateNotification(
          track.title || 'MUSII',
          track.artist || 'Playing Stream',
          Boolean(this.isPlaying),
          coverUrl,
          Number(this.duration || 210),
          Number(this.currentTime || 0)
        );
      } catch (e) {
        console.warn('[AudioController] Native notification bridge error:', e);
      }
    }

    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'MUSII',
        artwork: [
          { src: track.cover_art || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg', sizes: '512x512', type: 'image/jpeg' }
        ]
      });

      navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';

      const setAction = (action, handler) => {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch (e) {}
      };

      setAction('play', () => this.play());
      setAction('pause', () => this.pause());
      setAction('previoustrack', () => this.prev());
      setAction('nexttrack', () => this.next());
      setAction('seekto', (details) => {
        if (details.seekTime !== undefined) this.seekTo(details.seekTime);
      });
      setAction('seekbackward', () => this.seekTo(Math.max(0, this.currentTime - 10)));
      setAction('seekforward', () => this.seekTo(Math.min(this.duration, this.currentTime + 10)));
    } catch (e) {}
  }

  // ============================
  // SETTINGS PERSISTENCE
  // ============================
  _persistSettings() {
    try {
      localStorage.setItem('musii_audio_settings', JSON.stringify({
        crossfadeEnabled: this.crossfadeEnabled,
        crossfadeDuration: this.crossfadeDuration,
        eqPreset: this._eqPreset,
        isShuffled: this.isShuffled,
        repeatMode: this.repeatMode
      }));
    } catch (e) {}
  }

  _loadPersistedSettings() {
    try {
      const stored = localStorage.getItem('musii_audio_settings');
      if (stored) {
        const s = JSON.parse(stored);
        if (s.crossfadeEnabled !== undefined) this.crossfadeEnabled = s.crossfadeEnabled;
        if (s.crossfadeDuration) this.crossfadeDuration = s.crossfadeDuration;
        if (s.eqPreset) this._eqPreset = s.eqPreset;
        if (s.isShuffled !== undefined) this.isShuffled = s.isShuffled;
        if (s.repeatMode) this.repeatMode = s.repeatMode;
      }
    } catch (e) {}
    this._loadQueueFromStorage();
  }
}

export const audioController = new AudioController();
