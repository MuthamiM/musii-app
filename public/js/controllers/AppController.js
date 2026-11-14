import { audioController } from './AudioController.js';
import { navigationController } from './NavigationController.js';
import { playlistController } from './PlaylistController.js';
import { modalController } from './ModalController.js';
import { haptics } from '../middleware/hapticMiddleware.js';
import { errorHandler } from '../errors/clientErrorHandler.js';
import { DEFAULT_TRACKS, DEFAULT_PICKS } from '../constants/tracks.js';

class AppController {
  constructor() {
    this.picks = DEFAULT_PICKS;
    this.tracks = DEFAULT_TRACKS;
  }

  async init() {
    navigationController.init();
    playlistController.init();
    modalController.init();

    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (err) {}
    }

    await this.loadInitialData();
    this.renderTopPicks();
    this.renderRecentTracks();
    this.bindAudioEvents();
    this.bindUIInteractions();
    this.fetchEdgeNodes();
  }

  async loadInitialData() {
    try {
      const res = await fetch('/api/music/feed');
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.allTracks) {
          this.tracks = json.data.allTracks;
          audioController.setTracks(this.tracks);
        }
        if (json.data && json.data.picks) {
          this.picks = json.data.picks;
        }
      }
    } catch (e) {}
  }

  async fetchEdgeNodes() {
    try {
      const res = await fetch('/api/edge/nodes');
      if (res.ok) {
        const json = await res.json();
        const optimal = json.data && json.data.optimalNode;
        const badge = document.getElementById('badgeEdgeNode');
        if (badge && optimal) {
          badge.textContent = `${optimal.region}: ${optimal.pingMs}ms`;
        }
      }
    } catch (e) {}
  }

  renderTopPicks() {
    const scroller = document.getElementById('topPicksScroller');
    if (!scroller) return;

    scroller.innerHTML = this.picks.map((pick, i) => `
      <div class="music-card touch-spring" style="--card-grad: ${pick.gradient};" data-track-id="${pick.trackId || pick.track_id || 1}">
        <svg class="card-decor-heart" viewBox="0 0 100 90" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-dasharray="4 4">
          <path d="M50 80 C20 55, 5 35, 15 18 C25 2, 45 8, 50 25 C55 8, 75 2, 85 18 C95 35, 80 55, 50 80 Z"/>
        </svg>

        <div class="card-top-action">
          <div class="card-top-icon">
            <svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:#fff"><path d="M2 12h2M6 8v8M10 5v14M14 9v6M18 11v2M22 12h-2"/></svg>
          </div>
        </div>

        <div class="card-bottom-info">
          <span class="card-tag">${pick.category || 'Mood Mix'}</span>
          <b class="card-title">${pick.title}</b>
          <span class="card-subtitle">${pick.subtitle}</span>
        </div>
      </div>
    `).join('');
  }

  renderRecentTracks() {
    const container = document.getElementById('recentTracksList');
    if (!container) return;

    container.innerHTML = this.tracks.map((track, i) => `
      <div class="track-row touch-spring ${i === 0 ? 'now-playing' : ''}" data-idx="${i}">
        <div class="track-avatar" style="--card-grad: ${track.gradient};">
          <svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:#fff"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </div>
        <div class="track-meta">
          <span class="track-name">${track.title}</span>
          <span class="track-artist">${track.artist} • ${track.album}</span>
        </div>
        <div class="track-eq">
          <div class="track-eq-bar"></div>
          <div class="track-eq-bar"></div>
          <div class="track-eq-bar"></div>
        </div>
        <div class="track-btn-play">
          <svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:var(--text-muted)"><polygon points="8 5 19 12 8 19 8 5" fill="currentColor" stroke="none"></polygon></svg>
        </div>
      </div>
    `).join('');
  }

  bindAudioEvents() {
    const PLAY_SVG = '<polygon points="8 5 19 12 8 19 8 5"></polygon>';
    const PAUSE_SVG = '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>';

    audioController.subscribe(({ track, isPlaying }) => {
      document.getElementById('miniTrackName').textContent = track.title;
      document.getElementById('miniTrackArtist').textContent = `${track.artist} • ${track.album}`;
      document.getElementById('miniDiscThumb').style.setProperty('--card-grad', track.gradient);
      document.getElementById('floatingMiniPlayer').classList.toggle('is-playing', isPlaying);

      document.getElementById('iconMiniPlayPause').innerHTML = isPlaying ? PAUSE_SVG : PLAY_SVG;
      document.getElementById('iconSheetPlayPause').innerHTML = isPlaying ? PAUSE_SVG : PLAY_SVG;

      const orb = document.getElementById('ambientBackdropOrb');
      if (orb) orb.style.background = track.gradient;

      document.getElementById('sheetTrackTitle').textContent = track.title;
      document.getElementById('sheetTrackArtist').textContent = track.artist;
      document.getElementById('sheetCoverArt').style.setProperty('--card-grad', track.gradient);
      document.getElementById('sheetTotalTime').textContent = audioController.formatTime(track.duration);

      const lyricsEl = document.getElementById('sheetLyricsText');
      if (lyricsEl) {
        lyricsEl.textContent = track.lyricsSnippet || track.lyrics_snippet || 'Harmonic chill ambient chords';
      }

      document.querySelectorAll('.track-row').forEach((row, idx) => {
        const isCurrent = idx === audioController.currentIdx;
        row.classList.toggle('now-playing', isCurrent);
        row.classList.toggle('is-playing', isCurrent && isPlaying);
      });
    });

    window.addEventListener('bitchord:progress', e => {
      const { timeFormatted, ratio } = e.detail;
      const pct = Math.min(100, ratio * 100);

      const scrubberFill = document.getElementById('sheetScrubberFill');
      const curTimeLabel = document.getElementById('sheetCurrentTime');

      if (scrubberFill) scrubberFill.style.width = pct + '%';
      if (curTimeLabel) curTimeLabel.textContent = timeFormatted;
    });
  }

  bindUIInteractions() {
    const btnMiniPlay = document.getElementById('btnMiniPlayPause');
    if (btnMiniPlay) {
      btnMiniPlay.addEventListener('click', e => {
        e.stopPropagation();
        audioController.togglePlay();
      });
    }

    const btnSheetPlay = document.getElementById('btnSheetPlayPause');
    if (btnSheetPlay) {
      btnSheetPlay.addEventListener('click', () => audioController.togglePlay());
    }

    const btnNext = document.getElementById('btnSheetNext');
    if (btnNext) btnNext.addEventListener('click', () => audioController.next());

    const btnPrev = document.getElementById('btnSheetPrev');
    if (btnPrev) btnPrev.addEventListener('click', () => audioController.prev());

    const scrubber = document.getElementById('sheetScrubberTrack');
    if (scrubber) {
      scrubber.addEventListener('click', e => {
        const rect = scrubber.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        audioController.seek(ratio);
      });
    }

    const picksScroller = document.getElementById('topPicksScroller');
    if (picksScroller) {
      picksScroller.addEventListener('click', e => {
        const card = e.target.closest('.music-card');
        if (card) {
          const trackId = parseInt(card.dataset.trackId, 10);
          const idx = this.tracks.findIndex(t => t.id === trackId);
          audioController.selectTrack(idx >= 0 ? idx : 0, true);
        }
      });
    }

    const recentList = document.getElementById('recentTracksList');
    if (recentList) {
      recentList.addEventListener('click', e => {
        const row = e.target.closest('.track-row');
        if (row) {
          const idx = parseInt(row.dataset.idx, 10);
          if (idx === audioController.currentIdx && audioController.isPlaying) {
            audioController.pause();
          } else {
            audioController.selectTrack(idx, true);
          }
        }
      });
    }

    const btnFav = document.getElementById('btnSheetFavorite');
    if (btnFav) {
      btnFav.addEventListener('click', () => {
        haptics.trigger('heavy');
        const isFav = btnFav.style.color === 'rgb(255, 71, 103)';
        btnFav.style.color = isFav ? '#ffffff' : 'var(--accent)';
        btnFav.style.fill = isFav ? 'none' : 'currentColor';
        errorHandler.showToast(isFav ? 'Removed from Liked Songs' : 'Added to Liked Songs');
      });
    }

    const toggleHapticsBtn = document.getElementById('btnToggleHaptics');
    const hapticTag = document.getElementById('tagHapticStatus');
    if (toggleHapticsBtn && hapticTag) {
      toggleHapticsBtn.addEventListener('click', () => {
        const active = haptics.toggle();
        hapticTag.textContent = active ? 'Active' : 'Disabled';
        hapticTag.style.color = active ? 'var(--accent)' : 'var(--text-muted)';
        if (active) haptics.trigger('heavy');
        errorHandler.showToast(active ? 'Haptics Enabled' : 'Haptics Disabled');
      });
    }
  }
}

export const appController = new AppController();
