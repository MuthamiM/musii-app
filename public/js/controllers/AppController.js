import { audioController } from './AudioController.js';
import { navigationController } from './NavigationController.js';
import { playlistController } from './PlaylistController.js';
import { modalController } from './ModalController.js';
import { authController } from './AuthController.js';
import { settingsController } from './SettingsController.js';
import { searchController } from './SearchController.js';
import { updateController } from './UpdateController.js';
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
    updateController.init();
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
      this.handleDeepLink();
    }).catch(err => console.warn('[AppController] Feed background load:', err));
  }

  // Feature 10: Deep Link Handling
  handleDeepLink() {
    try {
      const params = new URLSearchParams(window.location.search);
      const query = params.get('q') || params.get('play') || params.get('song');
      if (query) {
        errorHandler.showToast(`Playing shared song: ${query}`);
        audioController.playSong({
          id: Date.now(),
          title: query,
          artist: 'Shared Stream',
          album: 'Deep Link',
          duration: 210,
          cover_art: 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'
        });
      }
    } catch (e) {}
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

    scroller.innerHTML = this.picks.map((pick, i) => {
      const coverUrl = pick.image || (this.tracks.find(t => t.id === (pick.trackId || pick.track_id)) || {}).cover_art || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg';
      return `
      <div class="music-card touch-spring" data-pick-idx="${i}">
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

  // Render Recently Played as a horizontal shelf matching user requirement
  renderRecentTracks() {
    const container = document.getElementById('recentTracksList');
    if (!container) return;

    container.innerHTML = this.tracks.map((track, i) => `
      <div class="recent-card-item touch-spring ${i === audioController.currentIdx ? 'now-playing' : ''}" data-idx="${i}">
        <div class="recent-card-cover-wrapper">
          <img class="recent-card-cover" src="${track.cover_art}" alt="${track.title}" loading="lazy" onerror="this.src='https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'" />
          <div class="recent-card-overlay"></div>
          <div class="recent-card-play-pill">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="8 5 19 12 8 19 8 5"></polygon></svg>
          </div>
        </div>
        <div class="recent-card-title">${track.title}</div>
        <div class="recent-card-artist">${track.artist}</div>
      </div>
    `).join('');

    container.querySelectorAll('.recent-card-item').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.idx, 10);
        if (idx === audioController.currentIdx && audioController.isPlaying) {
          audioController.pause();
        } else {
          audioController.selectTrack(idx, true);
        }
      });
    });
  }

  openCardDetails(pick) {
    haptics.trigger('medium');
    const modal = document.getElementById('cardDetailsModal');
    if (!modal) return;

    const coverEl = document.getElementById('cardModalCover');
    const tagEl = document.getElementById('cardModalTag');
    const titleEl = document.getElementById('cardModalTitle');
    const subtitleEl = document.getElementById('cardModalSubtitle');
    const listEl = document.getElementById('cardModalTracksList');

    const coverUrl = pick.image || (this.tracks.find(t => t.id === (pick.trackId || pick.track_id)) || {}).cover_art || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg';

    if (coverEl) coverEl.src = coverUrl;
    if (tagEl) tagEl.textContent = pick.category || 'Featured Collection';
    if (titleEl) titleEl.textContent = pick.title;
    if (subtitleEl) subtitleEl.textContent = pick.subtitle;

    // Filter tracks belonging to this card/category or find matching tracks
    let cardTracks = this.tracks.filter(t => 
      (t.category && pick.category && t.category.toLowerCase().includes(pick.category.toLowerCase())) ||
      (pick.badge && t.artist && t.artist.toLowerCase().includes(pick.badge.toLowerCase())) ||
      (t.album && pick.title && t.album.toLowerCase().includes(pick.title.toLowerCase()))
    );

    if (cardTracks.length === 0) {
      const matchTrack = this.tracks.find(t => t.id === (pick.trackId || pick.track_id));
      cardTracks = matchTrack ? [matchTrack, ...this.tracks.filter(t => t.id !== matchTrack.id).slice(0, 4)] : this.tracks.slice(0, 5);
    }

    if (listEl) {
      listEl.innerHTML = cardTracks.map((track) => `
        <div class="track-row touch-spring" data-track-id="${track.id}" style="padding:8px 12px; background:rgba(255,255,255,0.04); border-radius:14px; display:flex; align-items:center; justify-content:space-between; cursor:pointer;">
          <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
            <img src="${track.cover_art}" style="width:42px; height:42px; border-radius:10px; object-fit:cover;">
            <div style="overflow:hidden;">
              <div style="font-size:13px; font-weight:700; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.title}</div>
              <div style="font-size:11px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.artist}</div>
            </div>
          </div>
          <button class="btn-play-card-track" data-track-id="${track.id}" style="background:rgba(230,57,70,0.15); border:1px solid rgba(230,57,70,0.3); border-radius:999px; color:var(--accent); font-size:12px; font-weight:700; padding:6px 12px; cursor:pointer;">
            Play
          </button>
        </div>
      `).join('');

      listEl.querySelectorAll('.track-row').forEach(row => {
        row.addEventListener('click', () => {
          const trackId = parseInt(row.dataset.trackId, 10);
          const idx = this.tracks.findIndex(t => t.id === trackId);
          modal.classList.remove('is-open');
          audioController.selectTrack(idx >= 0 ? idx : 0, true);
        });
      });
    }

    const btnPlayAll = document.getElementById('btnCardModalPlayAll');
    if (btnPlayAll) {
      btnPlayAll.onclick = () => {
        modal.classList.remove('is-open');
        if (cardTracks.length > 0) {
          const firstIdx = this.tracks.findIndex(t => t.id === cardTracks[0].id);
          audioController.selectTrack(firstIdx >= 0 ? firstIdx : 0, true);
          for (let i = 1; i < cardTracks.length; i++) {
            audioController.addToQueue(cardTracks[i]);
          }
        }
      };
    }

    const btnQueueAll = document.getElementById('btnCardModalQueueAll');
    if (btnQueueAll) {
      btnQueueAll.onclick = () => {
        modal.classList.remove('is-open');
        cardTracks.forEach(t => audioController.addToQueue(t));
      };
    }

    const btnClose = document.getElementById('btnCloseCardModal');
    if (btnClose) {
      btnClose.onclick = () => modal.classList.remove('is-open');
    }
    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.remove('is-open');
    };

    modal.classList.add('is-open');
  }

  bindAudioEvents() {
    const PLAY_SVG = '<polygon points="8 5 19 12 8 19 8 5"></polygon>';
    const PAUSE_SVG = '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>';

    audioController.subscribe(({ track, isPlaying, isBuffering }) => {
      const miniName = document.getElementById('miniTrackName');
      const miniArtist = document.getElementById('miniTrackArtist');
      if (miniName) miniName.textContent = track.title;
      if (miniArtist) {
        miniArtist.textContent = isBuffering
          ? 'Connecting lossless stream...'
          : `${track.artist} • ${track.album}`;
      }

      const miniImg = document.getElementById('miniCoverImg');
      if (miniImg && track.cover_art) miniImg.src = track.cover_art;

      const miniPlayer = document.getElementById('floatingMiniPlayer');
      if (miniPlayer) {
        miniPlayer.classList.toggle('is-playing', isPlaying);
        miniPlayer.classList.toggle('is-buffering', Boolean(isBuffering));
      }

      const miniIcon = document.getElementById('iconMiniPlayPause');
      if (miniIcon) miniIcon.innerHTML = isPlaying ? PAUSE_SVG : PLAY_SVG;

      const sheetIcon = document.getElementById('iconSheetPlayPause');
      if (sheetIcon) sheetIcon.innerHTML = isPlaying ? PAUSE_SVG : PLAY_SVG;

      const sheetPlayer = document.getElementById('fullscreenPlayerSheet');
      if (sheetPlayer) sheetPlayer.classList.toggle('is-playing', isPlaying);

      const orb = document.getElementById('ambientBackdropOrb');
      if (orb) {
        if (track.gradient) orb.style.background = track.gradient;
        orb.classList.toggle('is-playing', isPlaying);
      }

      const sheetTitle = document.getElementById('sheetTrackTitle');
      const sheetArtist = document.getElementById('sheetTrackArtist');
      if (sheetTitle) sheetTitle.textContent = track.title;
      if (sheetArtist) sheetArtist.textContent = track.artist;

      const sheetImg = document.getElementById('sheetCoverImg');
      if (sheetImg && track.cover_art) sheetImg.src = track.cover_art;

      const sheetTotal = document.getElementById('sheetTotalTime');
      if (sheetTotal) sheetTotal.textContent = audioController.formatTime(track.duration);

      // Update active state in horizontal recently played cards
      document.querySelectorAll('.recent-card-item').forEach((card, idx) => {
        const isCurrent = idx === audioController.currentIdx;
        card.classList.toggle('now-playing', isCurrent);
        card.classList.toggle('is-playing', isCurrent && isPlaying);
      });

      // Update active state in any track rows
      document.querySelectorAll('.track-row').forEach((row, idx) => {
        const isCurrent = idx === audioController.currentIdx;
        row.classList.toggle('now-playing', isCurrent);
        row.classList.toggle('is-playing', isCurrent && isPlaying);
      });
    });

    window.addEventListener('musii:progress', e => {
      const { timeFormatted, ratio, duration, currentTime } = e.detail;
      const pct = Math.min(100, ratio * 100);

      const scrubberFill = document.getElementById('sheetScrubberFill');
      const curTimeLabel = document.getElementById('sheetCurrentTime');

      if (scrubberFill) scrubberFill.style.width = pct + '%';
      if (curTimeLabel) curTimeLabel.textContent = timeFormatted;

      // Update lyrics overlay footer scrubber
      const lyricsFooterFill = document.getElementById('lyricsFooterProgressFill');
      const lyricsFooterCur = document.getElementById('lyricsFooterCurrentTime');
      const lyricsFooterTot = document.getElementById('lyricsFooterTotalTime');
      if (lyricsFooterFill) lyricsFooterFill.style.width = pct + '%';
      if (lyricsFooterCur) lyricsFooterCur.textContent = timeFormatted;
      if (lyricsFooterTot && duration) lyricsFooterTot.textContent = audioController.formatTime(duration);
    });
  }

  bindLyricsEvents() {
    const np = document.getElementById('fullscreenPlayerSheet');
    const lyEl = document.getElementById('ly');
    const lpEl = document.getElementById('lp');
    const capX = document.getElementById('cap-x');
    const lbtn = document.getElementById('btnToggleLyricsMode');
    const btnLvHeart = document.getElementById('btnLvHeart');
    const btnLvQueue = document.getElementById('btnLvQueue');

    let lyricsEngine = null;
    let overlayView = null;
    let previewCard = null;
    let lyricsAbortCtl = null;

    if (window.Musii && window.Musii.lyrics && lyEl && lpEl) {
      lyricsEngine = window.Musii.lyrics.create();
      overlayView = window.Musii.lyrics.overlay(lyEl, {
        getTime: () => audioController.currentTime,
        isPlaying: () => audioController.isPlaying,
        seek: (s) => audioController.seekTo(s)
      });
      previewCard = window.Musii.lyrics.preview(lpEl, {
        onOpen: () => setLyricsMode('lyrics')
      });
    }

    function setLyricsMode(mode) {
      if (!np) return;
      np.dataset.mode = mode;
      if (lbtn) {
        lbtn.setAttribute('aria-pressed', String(mode === 'lyrics'));
      }
      if (overlayView) {
        requestAnimationFrame(() => {
          overlayView.poke();
          setTimeout(() => overlayView.poke(), 60);
        });
      }
    }

    if (lbtn) {
      lbtn.addEventListener('click', () => {
        haptics.trigger('medium');
        setLyricsMode(np && np.dataset.mode === 'lyrics' ? 'art' : 'lyrics');
      });
    }

    const btnMiniLyrics = document.getElementById('btnMiniLyrics');
    if (btnMiniLyrics) {
      btnMiniLyrics.addEventListener('click', (e) => {
        e.stopPropagation();
        modalController.openPlayerSheet();
        setLyricsMode('lyrics');
      });
    }

    if (btnLvHeart) {
      btnLvHeart.addEventListener('click', () => {
        haptics.trigger('medium');
        const cur = audioController.getCurrentTrack();
        if (cur) playlistController.toggleFavorite(cur);
      });
    }

    if (btnLvQueue) {
      btnLvQueue.addEventListener('click', () => {
        haptics.trigger('medium');
        modalController.openQueueModal();
      });
    }

    const loadTrackLyrics = (track, nextTrack) => {
      if (!track) return;
      const coverUrl = track.cover_art || track.thumbnail || track.cover || '';
      if (np) {
        const safe = (window.Musii && window.Musii.core) ? window.Musii.core.safeUrl(coverUrl) : coverUrl;
        np.style.setProperty('--cover', `url("${safe}")`);
      }

      const lvThumb = document.getElementById('lvThumb');
      if (lvThumb && coverUrl) lvThumb.style.backgroundImage = `url("${coverUrl}")`;
      const lvTitle = document.getElementById('lvTitle');
      if (lvTitle) lvTitle.textContent = track.title || 'MUSII';
      const lvArtist = document.getElementById('lvArtist');
      if (lvArtist) lvArtist.textContent = track.artist || 'Unknown Artist';

      if (!lyricsEngine || !overlayView || !previewCard) return;

      if (lyricsAbortCtl) lyricsAbortCtl.abort();
      lyricsAbortCtl = new AbortController();

      overlayView.render({ status: 'loading' });
      previewCard.render({ status: 'loading' });

      lyricsEngine.get({
        title: track.title,
        artist: track.artist,
        album: track.album,
        durationSec: Number(track.duration || audioController.duration || 210),
        cover: coverUrl
      }, { signal: lyricsAbortCtl.signal }).then((r) => {
        overlayView.render(r);
        previewCard.render(r);
        if (capX) capX.textContent = r.cached ? ' \u00b7 saved on this device' : '';
      }).catch(() => {});

      if (nextTrack) {
        lyricsEngine.prefetch({
          title: nextTrack.title,
          artist: nextTrack.artist,
          album: nextTrack.album,
          durationSec: Number(nextTrack.duration || 210),
          cover: nextTrack.cover_art || nextTrack.thumbnail || nextTrack.cover
        });
      }
    };

    window.addEventListener('musii:progress', (e) => {
      const curTime = e.detail && e.detail.currentTime ? e.detail.currentTime : audioController.currentTime;
      const dur = e.detail && e.detail.duration ? e.detail.duration : audioController.duration;
      if (previewCard) {
        previewCard.update(curTime);
      }
      const rightLabel = document.getElementById('sheetTotalTime');
      if (rightLabel && np && np.dataset.mode === 'lyrics') {
        const remaining = Math.max(0, dur - curTime);
        const fmtStr = (window.Musii && window.Musii.core)
          ? window.Musii.core.fmt(remaining)
          : audioController.formatTime(remaining);
        rightLabel.textContent = `-${fmtStr}`;
      }
    });

    audioController.subscribe(({ isPlaying, track }) => {
      if (track) {
        const nextTrack = audioController.queue[0] || audioController.tracks[audioController.currentIdx + 1];
        loadTrackLyrics(track, nextTrack);
      }
      if (overlayView && isPlaying) {
        overlayView.poke();
      }
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

    // Feature 10: Share Track button
    const btnShare = document.getElementById('btnSheetShare');
    if (btnShare) {
      btnShare.addEventListener('click', () => {
        haptics.trigger('medium');
        audioController.shareCurrentTrack();
      });
    }

    // Feature 5: Sleep Timer Modal & Button
    const btnSleepTimer = document.getElementById('btnSheetSleepTimer');
    const sleepModal = document.getElementById('sleepTimerModal');
    const btnCloseSleep = document.getElementById('btnCloseSleepTimerModal');

    if (btnSleepTimer && sleepModal) {
      btnSleepTimer.addEventListener('click', () => {
        haptics.trigger('medium');
        sleepModal.classList.add('is-open');
      });
    }

    if (btnCloseSleep && sleepModal) {
      btnCloseSleep.addEventListener('click', () => {
        haptics.trigger('light');
        sleepModal.classList.remove('is-open');
      });
      sleepModal.addEventListener('click', (e) => {
        if (e.target === sleepModal) sleepModal.classList.remove('is-open');
      });
    }

    document.querySelectorAll('.btn-sleep-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = btn.dataset.mins;
        if (mins === '0') {
          audioController.cancelSleepTimer();
        } else if (mins === 'end') {
          audioController.setSleepTimer('end');
        } else {
          audioController.setSleepTimer(parseInt(mins, 10));
        }
        if (sleepModal) sleepModal.classList.remove('is-open');
      });
    });

    window.addEventListener('musii:sleep-timer-update', (e) => {
      const { active, remainingSeconds, mode } = e.detail;
      if (btnSleepTimer) {
        btnSleepTimer.style.color = active ? 'var(--accent)' : '';
      }
      const statusText = document.getElementById('sleepTimerStatusText');
      if (statusText) {
        if (!active) {
          statusText.textContent = 'Audio stops smoothly with fade out';
        } else if (mode === 'end') {
          statusText.textContent = 'Stopping after current track';
        } else {
          const m = Math.floor(remainingSeconds / 60);
          const s = remainingSeconds % 60;
          statusText.textContent = `Stopping in ${m}:${s < 10 ? '0' : ''}${s}`;
        }
      }
    });

    // Shuffle & Repeat buttons
    const btnShuffle = document.getElementById('btnSheetShuffle');
    if (btnShuffle) {
      btnShuffle.style.color = audioController.isShuffled ? 'var(--accent)' : 'var(--text-muted)';
      btnShuffle.addEventListener('click', () => {
        const shuffled = audioController.toggleShuffle();
        btnShuffle.style.color = shuffled ? 'var(--accent)' : 'var(--text-muted)';
      });
    }

    const btnRepeat = document.getElementById('btnSheetRepeat');
    if (btnRepeat) {
      btnRepeat.style.color = audioController.repeatMode !== 'off' ? 'var(--accent)' : 'var(--text-muted)';
      btnRepeat.addEventListener('click', () => {
        const mode = audioController.cycleRepeat();
        btnRepeat.style.color = mode !== 'off' ? 'var(--accent)' : 'var(--text-muted)';
      });
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

    // Top picks card click: opens all songs inside that card
    const picksScroller = document.getElementById('topPicksScroller');
    if (picksScroller) {
      picksScroller.addEventListener('click', e => {
        const card = e.target.closest('.music-card');
        if (card) {
          const pickIdx = parseInt(card.dataset.pickIdx, 10);
          const pick = this.picks[pickIdx] || this.picks[0];
          this.openCardDetails(pick);
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
