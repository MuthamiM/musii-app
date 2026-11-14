import { audioController } from './AudioController.js';
import { navigationController } from './NavigationController.js';
import { playlistController } from './PlaylistController.js';
import { modalController } from './ModalController.js';
import { authController } from './AuthController.js';
import { settingsController } from './SettingsController.js';
import { searchController } from './SearchController.js';
import { haptics } from '../middleware/hapticMiddleware.js';
import { errorHandler } from '../errors/clientErrorHandler.js';
import { DEFAULT_TRACKS, DEFAULT_PICKS } from '../constants/tracks.js';
import { apiUrl } from '../constants/api.js';

class AppController {
  constructor() {
    this.picks = DEFAULT_PICKS;
    this.tracks = DEFAULT_TRACKS;
  }

  async init() {
    navigationController.init();
    playlistController.init();
    modalController.init();
    settingsController.init();
    searchController.init();
    this.updateGreeting();

    // Render immediately using default tracks so the user never sees an empty screen
    this.renderTopPicks();
    this.renderRecentTracks();
    this.bindAudioEvents();
    this.bindLyricsEvents();
    this.bindQueueEvents();
    this.bindUIInteractions();

    window.addEventListener('musii:user-updated', () => this.updateGreeting());
    window.addEventListener('musii:toast', (e) => {
      if (e.detail && e.detail.message) {
        errorHandler.showToast(e.detail.message);
      }
    });

    // Background auth initialization (never blocks UI)
    authController.init().catch(err => console.warn('[AppController] Auth init:', err));

    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (err) {}
    }

    // Refresh feed in background
    this.loadInitialData().then(() => {
      this.renderTopPicks();
      this.renderRecentTracks();
    }).catch(err => console.warn('[AppController] Feed background load:', err));
  }

  updateGreeting() {
    const now = new Date();
    const hours = now.getHours();

    let greeting = 'Good morning';
    if (hours >= 12 && hours < 17) {
      greeting = 'Good afternoon';
    } else if (hours >= 17 && hours < 22) {
      greeting = 'Good evening';
    } else if (hours >= 22 || hours < 5) {
      greeting = 'Good night';
    }

    let username = '';
    try {
      const stored = localStorage.getItem('musii_user');
      if (stored) {
        const u = JSON.parse(stored);
        username = u.handle ? u.handle.replace(/^@/, '') : (u.name || '');
      }
    } catch (e) {}

    const header = document.getElementById('homeGreetingHeader');
    if (header) {
      header.textContent = username ? `${greeting}, ${username}` : greeting;
    }
  }

  async loadInitialData() {
    try {
      const res = await fetch(apiUrl('/api/music/feed'));
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.allTracks && json.data.allTracks.length > 0) {
          this.tracks = json.data.allTracks;
          audioController.setTracks(this.tracks);
        }
        if (json.data && json.data.picks && json.data.picks.length > 0) {
          this.picks = json.data.picks;
        }
      }
    } catch (e) {
      console.warn('[AppController] Feed load fallback to defaults:', e);
    }
  }

  renderTopPicks() {
    const scroller = document.getElementById('topPicksScroller');
    if (!scroller) return;

    scroller.innerHTML = this.picks.map((pick) => {
      const coverUrl = pick.image || (this.tracks.find(t => t.id === (pick.trackId || pick.track_id)) || {}).cover_art || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg';
      return `
      <div class="music-card touch-spring" data-track-id="${pick.trackId || pick.track_id || 1}">
        <img class="music-card-bg-img" src="${coverUrl}" alt="${pick.title}" loading="lazy" onerror="this.src='https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'" />
        <div class="music-card-overlay"></div>

        <div class="card-top-action">
          <div class="card-top-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round">
              <path d="M4 7c4-2.5 12-2.5 16 0"/>
              <path d="M5 12c3.5-2.2 10.5-2.2 14 0"/>
              <path d="M7 17c2.5-1.8 7.5-1.8 10 0"/>
            </svg>
          </div>
        </div>

        <div class="card-bottom-info">
          <span class="card-tag">${pick.category || 'Featured'}</span>
          <b class="card-title">${pick.title}</b>
          <span class="card-subtitle">${pick.subtitle}</span>
        </div>
      </div>
    `;
    }).join('');
  }

  renderRecentTracks() {
    const container = document.getElementById('recentTracksList');
    if (!container) return;

    container.innerHTML = this.tracks.map((track, i) => `
      <div class="track-row touch-spring ${i === 0 ? 'now-playing' : ''}" data-idx="${i}">
        <div class="track-avatar">
          <img class="track-avatar-img" src="${track.cover_art}" alt="${track.title}" loading="lazy" onerror="this.src='https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'" />
        </div>
        <div class="track-meta">
          <span class="track-name">${track.title}</span>
          <span class="track-artist">${track.artist} • ${track.album}</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button class="track-row-btn-queue touch-spring" data-track-idx="${i}" title="Add to Queue" style="background:none; border:none; color:rgba(255,255,255,0.45); padding:8px; display:flex; align-items:center; justify-content:center; cursor:pointer;" aria-label="Add to Queue">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
          <div class="track-btn-play">
            <svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:var(--text-muted)"><polygon points="8 5 19 12 8 19 8 5" fill="currentColor" stroke="none"></polygon></svg>
          </div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.track-row-btn-queue').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.trackIdx, 10);
        if (this.tracks[idx]) {
          audioController.addToQueue(this.tracks[idx]);
        }
      });
    });
  }

  bindAudioEvents() {
    const PLAY_SVG = '<polygon points="8 5 19 12 8 19 8 5"></polygon>';
    const PAUSE_SVG = '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>';

    audioController.subscribe(({ track, isPlaying }) => {
      const miniName = document.getElementById('miniTrackName');
      const miniArtist = document.getElementById('miniTrackArtist');
      if (miniName) miniName.textContent = track.title;
      if (miniArtist) miniArtist.textContent = `${track.artist} • ${track.album}`;

      const miniImg = document.getElementById('miniCoverImg');
      if (miniImg && track.cover_art) miniImg.src = track.cover_art;

      const miniPlayer = document.getElementById('floatingMiniPlayer');
      if (miniPlayer) miniPlayer.classList.toggle('is-playing', isPlaying);

      const miniIcon = document.getElementById('iconMiniPlayPause');
      if (miniIcon) miniIcon.innerHTML = isPlaying ? PAUSE_SVG : PLAY_SVG;

      const sheetIcon = document.getElementById('iconSheetPlayPause');
      if (sheetIcon) sheetIcon.innerHTML = isPlaying ? PAUSE_SVG : PLAY_SVG;

      const orb = document.getElementById('ambientBackdropOrb');
      if (orb && track.gradient) orb.style.background = track.gradient;

      const sheetTitle = document.getElementById('sheetTrackTitle');
      const sheetArtist = document.getElementById('sheetTrackArtist');
      if (sheetTitle) sheetTitle.textContent = track.title;
      if (sheetArtist) sheetArtist.textContent = track.artist;

      const sheetImg = document.getElementById('sheetCoverImg');
      if (sheetImg && track.cover_art) sheetImg.src = track.cover_art;

      const sheetTotal = document.getElementById('sheetTotalTime');
      if (sheetTotal) sheetTotal.textContent = audioController.formatTime(track.duration);

      document.querySelectorAll('.track-row').forEach((row, idx) => {
        const isCurrent = idx === audioController.currentIdx;
        row.classList.toggle('now-playing', isCurrent);
        row.classList.toggle('is-playing', isCurrent && isPlaying);
      });
    });

    window.addEventListener('musii:progress', e => {
      const { timeFormatted, ratio } = e.detail;
      const pct = Math.min(100, ratio * 100);

      const scrubberFill = document.getElementById('sheetScrubberFill');
      const curTimeLabel = document.getElementById('sheetCurrentTime');

      if (scrubberFill) scrubberFill.style.width = pct + '%';
      if (curTimeLabel) curTimeLabel.textContent = timeFormatted;
    });
  }

  bindLyricsEvents() {
    const container = document.getElementById('sheetLyricsContainer');
    const statusBadge = document.getElementById('lyricsStatusBadge');

    window.addEventListener('musii:lyrics-loaded', (e) => {
      if (!container) return;
      const lines = e.detail && e.detail.lines ? e.detail.lines : [];
      if (lines.length === 0) {
        container.innerHTML = '<div class="synced-lyric-item is-active">Instrumental or lyrics unavailable</div>';
        if (statusBadge) statusBadge.textContent = 'OFFLINE';
        return;
      }

      if (statusBadge) statusBadge.textContent = lines.length > 1 ? 'SYNCED' : 'SNIPPET';

      container.innerHTML = lines.map((line, idx) => `
        <div class="synced-lyric-item ${idx === 0 ? 'is-active' : ''}" data-idx="${idx}" data-time="${line.time}" style="cursor:pointer; padding:3px 0;">
          ${line.text}
        </div>
      `).join('');

      container.querySelectorAll('.synced-lyric-item').forEach(el => {
        el.addEventListener('click', () => {
          const t = parseFloat(el.getAttribute('data-time'));
          if (!isNaN(t)) {
            audioController.seekTo(t);
          }
        });
      });
    });

    window.addEventListener('musii:lyric-change', (e) => {
      if (!container) return;
      const { index } = e.detail;
      const items = container.querySelectorAll('.synced-lyric-item');
      items.forEach((item, idx) => {
        const isActive = idx === index;
        item.classList.toggle('is-active', isActive);
        if (isActive) {
          const containerHeight = container.clientHeight;
          const itemTop = item.offsetTop - container.offsetTop;
          const itemHeight = item.clientHeight;
          container.scrollTo({
            top: itemTop - (containerHeight / 2) + (itemHeight / 2),
            behavior: 'smooth'
          });
        }
      });
    });
  }

  bindQueueEvents() {
    const queueModal = document.getElementById('queueModal');
    const queueList = document.getElementById('queueListContainer');
    const badgeCount = document.getElementById('badgeQueueCount');
    const btnQueue = document.getElementById('btnSheetQueue');
    const btnCloseQueue = document.getElementById('btnCloseQueueModal');
    const btnClearQueue = document.getElementById('btnClearQueue');

    const updateQueueUI = (queue) => {
      if (badgeCount) {
        if (queue && queue.length > 0) {
          badgeCount.textContent = queue.length;
          badgeCount.style.display = 'block';
        } else {
          badgeCount.style.display = 'none';
        }
      }

      if (!queueList) return;
      if (!queue || queue.length === 0) {
        queueList.innerHTML = '<div style="text-align:center; padding:30px 10px; color:var(--text-muted); font-size:13px;">Queue is empty. Use song menus to add tracks.</div>';
        return;
      }

      queueList.innerHTML = queue.map((track, i) => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:rgba(255,255,255,0.05); border-radius:12px;">
          <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
            <span style="font-size:12px; font-weight:700; color:var(--text-muted); width:18px;">${i + 1}</span>
            <img src="${track.cover_art || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'}" style="width:36px; height:36px; border-radius:8px; object-fit:cover;">
            <div style="overflow:hidden;">
              <div style="font-size:13px; font-weight:600; color:#fff; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${track.title}</div>
              <div style="font-size:11px; color:var(--text-muted); white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${track.artist}</div>
            </div>
          </div>
          <button class="btn-remove-queue-item" data-idx="${i}" style="background:none; border:none; color:rgba(255,255,255,0.5); font-size:18px; padding:4px 8px; cursor:pointer;" aria-label="Remove">&times;</button>
        </div>
      `).join('');

      queueList.querySelectorAll('.btn-remove-queue-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx, 10);
          audioController.removeFromQueue(idx);
        });
      });
    };

    window.addEventListener('musii:queue-updated', (e) => {
      updateQueueUI(e.detail.queue);
    });

    if (btnQueue) {
      btnQueue.addEventListener('click', () => {
        haptics.trigger('light');
        if (queueModal) {
          queueModal.classList.add('is-open');
          updateQueueUI(audioController.queue);
        }
      });
    }

    if (btnCloseQueue && queueModal) {
      btnCloseQueue.addEventListener('click', () => {
        haptics.trigger('light');
        queueModal.classList.remove('is-open');
      });
      queueModal.addEventListener('click', (e) => {
        if (e.target === queueModal) queueModal.classList.remove('is-open');
      });
    }

    if (btnClearQueue) {
      btnClearQueue.addEventListener('click', () => {
        audioController.clearQueue();
      });
    }
  }

  bindUIInteractions() {
    const btnMiniPlay = document.getElementById('btnMiniPlayPause');
    if (btnMiniPlay) {
      btnMiniPlay.addEventListener('click', e => {
        e.stopPropagation();
        audioController.togglePlay();
      });
    }

    const btnMiniNext = document.getElementById('btnMiniNext');
    if (btnMiniNext) {
      btnMiniNext.addEventListener('click', e => {
        e.stopPropagation();
        audioController.next();
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

    const btnDownload = document.getElementById('btnSheetDownload');
    if (btnDownload) {
      btnDownload.addEventListener('click', () => audioController.downloadCurrentTrack());
    }

    const btnHeaderUpload = document.getElementById('btnHeaderUpload');
    if (btnHeaderUpload) {
      btnHeaderUpload.addEventListener('click', () => {
        settingsController.openSpotifyModal();
      });
    }

    const btnHeaderProfile = document.getElementById('btnHeaderProfile');
    if (btnHeaderProfile) {
      btnHeaderProfile.addEventListener('click', () => {
        navigationController.goTo('profile');
      });
    }

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
        if (e.target.closest('.track-row-btn-queue')) return;
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
