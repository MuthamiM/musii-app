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

    // Native HTML5 Realtime Audio Element
    this.audio = new Audio();
    this.audio.preload = 'auto';

    // Global reference for native Android notification media actions
    if (typeof window !== 'undefined') {
      window.audioController = this;
    }

    this.initAudioListeners();
  }

  initAudioListeners() {
    this.audio.addEventListener('loadstart', () => {
      this.isBuffering = true;
      this.notify();
    });

    this.audio.addEventListener('waiting', () => {
      this.isBuffering = true;
      this.notify();
    });

    this.audio.addEventListener('canplay', () => {
      this.isBuffering = false;
      this.notify();
    });

    this.audio.addEventListener('playing', () => {
      this.isBuffering = false;
      this.isPlaying = true;
      this.updateMediaSession(this.getCurrentTrack());
      this.notify();
    });

    this.audio.addEventListener('timeupdate', () => {
      this.currentTime = Math.floor(this.audio.currentTime);
      if (this.audio.duration && !isNaN(this.audio.duration)) {
        this.duration = Math.floor(this.audio.duration);
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
    });

    this.audio.addEventListener('ended', () => {
      this.next();
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('[AudioController] Stream error loading audio:', e);
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.updateMediaSession(this.getCurrentTrack());
      this.notify();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updateMediaSession(this.getCurrentTrack());
      this.notify();
    });
  }

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

  async play() {
    const track = this.getCurrentTrack();
    this.isPlaying = true;

    // Record play on backend to increment play count and auto-cache
    if (track && track.id) {
      fetch(apiUrl(`/api/music/track/${track.id}/play`), { method: 'POST' })
        .then(res => res.json())
        .then(() => {
          window.dispatchEvent(new CustomEvent('musii:track-played', { detail: { track } }));
        })
        .catch(() => {});
    }

    const streamQuery = encodeURIComponent(`${track.artist || ''} ${track.title || ''}`.trim());
    const streamUrl = apiUrl(`/api/stream/play?q=${streamQuery}`);

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
    } else {
      if (this.audio.src !== streamUrl) {
        this.audio.src = streamUrl;
      }
      try {
        await this.audio.play();
      } catch (err) {
        console.warn('[AudioController] play failed:', err);
      }
    }

    this.loadLyrics(track);
    this.notify();
  }

  pause() {
    this.isPlaying = false;
    if (typeof window !== 'undefined' && window.MusiiNative && typeof window.MusiiNative.pauseAudio === 'function') {
      window.MusiiNative.pauseAudio();
    } else {
      this.audio.pause();
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
  }

  onNativePlaying() {
    this.isBuffering = false;
    this.isPlaying = true;
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
        this.notify();
      } else {
        this.play();
      }
    }
  }

  selectTrack(index, autoPlay = true) {
    haptics.trigger('medium');
    this.currentIdx = (index + this.tracks.length) % this.tracks.length;
    this.currentTime = 0;
    this.currentLyricIdx = -1;
    this.syncedLyrics = [];

    const track = this.getCurrentTrack();
    this.duration = track.duration || 210;
    this.isBuffering = true;
    this.notify();

    if (this.useDirectStream) {
      this.audio.src = apiUrl(`/api/stream/play?q=${encodeURIComponent(track.artist + ' ' + track.title)}`);
    }

    this.notifyProgress();
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
    if (this.queue && this.queue.length > 0) {
      const nextTrack = this.queue.shift();
      this.notifyQueue();
      this.playSong(nextTrack);
    } else {
      this.selectTrack(this.currentIdx + 1, true);
    }
  }

  prev() {
    haptics.trigger('medium');
    this.selectTrack(this.currentIdx - 1, true);
  }

  addToQueue(track) {
    haptics.trigger('medium');
    this.queue.push(track);
    this.notifyQueue();
    window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: `Added "${track.title}" to queue` } }));
  }

  playNextInQueue(track) {
    haptics.trigger('medium');
    this.queue.unshift(track);
    this.notifyQueue();
    window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: `"${track.title}" will play next` } }));
  }

  removeFromQueue(index) {
    haptics.trigger('light');
    if (index >= 0 && index < this.queue.length) {
      this.queue.splice(index, 1);
      this.notifyQueue();
    }
  }

  clearQueue() {
    haptics.trigger('light');
    this.queue = [];
    this.notifyQueue();
    window.dispatchEvent(new CustomEvent('musii:toast', { detail: { message: 'Queue cleared' } }));
  }

  notifyQueue() {
    window.dispatchEvent(new CustomEvent('musii:queue-updated', {
      detail: { queue: this.queue }
    }));
  }

  seek(ratio) {
    haptics.trigger('light');
    const clamped = Math.max(0, Math.min(1, ratio));
    const targetTime = clamped * this.duration;

    if (this.audio && this.audio.duration) {
      this.audio.currentTime = targetTime;
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
    } else if (this.audio && !isNaN(clamped)) {
      this.audio.currentTime = clamped;
    }
    this.currentTime = Math.floor(clamped);
    this.notifyProgress();
    this.checkLyricsSync();
  }

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

  // --- Synced Lyrics Support ---
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
}

export const audioController = new AudioController();
