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
    this.ticker = null;
    this.listeners = [];
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
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  play() {
    const track = this.getCurrentTrack();
    this.isPlaying = true;
    audioSynth.playTrack(track);

    // Record play on backend to increment play count and auto-cache
    if (track && track.id) {
      fetch(apiUrl(`/api/music/track/${track.id}/play`), { method: 'POST' })
        .then(res => res.json())
        .then(() => {
          window.dispatchEvent(new CustomEvent('musii:track-played', { detail: { track } }));
        })
        .catch(() => {});
    }

    if (this.ticker) clearInterval(this.ticker);
    this.ticker = setInterval(() => {
      this.currentTime++;
      if (this.currentTime >= track.duration) {
        this.next();
      } else {
        this.notifyProgress();
      }
    }, 1000);

    this.notify();
  }

  pause() {
    this.isPlaying = false;
    audioSynth.stop();
    if (this.ticker) clearInterval(this.ticker);
    this.notify();
  }

  togglePlay() {
    haptics.trigger('medium');
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  selectTrack(index, autoPlay = true) {
    haptics.trigger('medium');
    this.currentIdx = (index + this.tracks.length) % this.tracks.length;
    this.currentTime = 0;
    this.notifyProgress();
    if (autoPlay) {
      this.play();
    } else {
      this.notify();
    }
  }

  next() {
    haptics.trigger('medium');
    this.selectTrack(this.currentIdx + 1, true);
  }

  prev() {
    haptics.trigger('medium');
    this.selectTrack(this.currentIdx - 1, true);
  }

  seek(ratio) {
    haptics.trigger('light');
    const track = this.getCurrentTrack();
    this.currentTime = Math.floor(Math.max(0, Math.min(1, ratio)) * track.duration);
    this.notifyProgress();
  }

  subscribe(listener) {
    this.listeners.push(listener);
  }

  notify() {
    const track = this.getCurrentTrack();
    this.listeners.forEach(fn => fn({ track, isPlaying: this.isPlaying, currentTime: this.currentTime }));
  }

  notifyProgress() {
    const track = this.getCurrentTrack();
    const progressEvent = new CustomEvent('musii:progress', {
      detail: {
        currentTime: this.currentTime,
        duration: track.duration,
        ratio: this.currentTime / track.duration,
        timeFormatted: this.formatTime(this.currentTime)
      }
    });
    window.dispatchEvent(progressEvent);
  }
}

export const audioController = new AudioController();

