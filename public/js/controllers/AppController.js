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
    const PLAY_SVG = '<path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l11-6.86a1 1 0 0 0 0-1.68l-11-6.86A1 1 0 0 0 8 5.14z"></path>';
    const PAUSE_SVG = '<rect x="5" y="4" width="4.5" height="16" rx="2.25"></rect><rect x="14.5" y="4" width="4.5" height="16" rx="2.25"></rect>';

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
      if (sheetPlayer) {
        sheetPlayer.classList.toggle('is-playing', isPlaying);
        if (track.cover_art) {
          sheetPlayer.style.setProperty('--cover', `url("${track.cover_art}")`);
        }
      }

      const orb = document.getElementById('ambientBackdropOrb');
      if (orb) {
        if (track.gradient) orb.style.background = track.gradient;
        orb.classList.toggle('is-playing', isPlaying);
      }

      const sheetTitle = document.getElementById('sheetTrackTitle');
      const sheetArtist = document.getElementById('sheetTrackArtist');
      if (sheetTitle) sheetTitle.textContent = track.title;
      if (sheetArtist) sheetArtist.textContent = track.artist;

      const sheetContextName = document.getElementById('sheetContextName');
      if (sheetContextName) sheetContextName.textContent = track.album || track.title;

      const sheetImg = document.getElementById('sheetCoverImg');
      if (sheetImg && track.cover_art) sheetImg.src = track.cover_art;

      const sheetTotal = document.getElementById('sheetTotalTime');
      if (sheetTotal && track.duration) {
        sheetTotal.textContent = '-' + audioController.formatTime(track.duration);
      }

      const favBtn = document.getElementById('btnSheetFavorite');
      const lvHeartBtn = document.getElementById('btnLvHeart');
      const isFav = playlistController.isFavorite(track);
      if (favBtn) favBtn.classList.toggle('is-favorite', isFav);
      if (lvHeartBtn) lvHeartBtn.classList.toggle('is-favorite', isFav);

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
      const totTimeLabel = document.getElementById('sheetTotalTime');

      if (scrubberFill) scrubberFill.style.width = pct + '%';
      if (curTimeLabel) curTimeLabel.textContent = timeFormatted;
      if (totTimeLabel && duration) {
        const remaining = Math.max(0, duration - (currentTime || 0));
        totTimeLabel.textContent = '-' + audioController.formatTime(remaining);
      }

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
          setTimeout(() => overlayView.poke(), 200);
        });
      }
    }

    window.setMusiiLyricsMode = setLyricsMode;

    const btnLvBack = document.getElementById('btnLvBack');
    if (btnLvBack) {
      btnLvBack.addEventListener('click', () => {
        haptics.trigger('light');
        setLyricsMode('art');
      });
    }

    const lvThumb = document.getElementById('lvThumb');
    if (lvThumb) {
      lvThumb.addEventListener('click', () => {
        haptics.trigger('light');
        setLyricsMode('art');
      });
    }

    if (lbtn) {
      lbtn.addEventListener('click', () => {
        haptics.trigger('medium');
        setLyricsMode(np && np.dataset.mode === 'lyrics' ? 'art' : 'lyrics');
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
    const npTitle = document.getElementById('queueNowPlayingTitle');
    const npArtist = document.getElementById('queueNowPlayingArtist');
    const npCover = document.getElementById('queueNowPlayingCover');
    const countLabel = document.getElementById('queueCountLabel');

    const updateQueueUI = (queue = audioController.queue) => {
      const curTrack = audioController.getCurrentTrack();
      if (curTrack) {
        if (npTitle) npTitle.textContent = curTrack.title || 'MUSII';
        if (npArtist) npArtist.textContent = curTrack.artist || 'Unknown Artist';
        if (npCover) {
          npCover.src = curTrack.cover_art || curTrack.thumbnail || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg';
        }
      }

      if (badgeCount) {
        if (queue && queue.length > 0) {
          badgeCount.textContent = queue.length;
          badgeCount.style.display = 'block';
        } else {
          badgeCount.style.display = 'none';
        }
      }

      if (!queueList) return;

      const manualQueue = queue || [];
      const allTracks = audioController.tracks || [];
      const curIdx = audioController.currentIdx || 0;

      // Build upcoming suggested list (at least 5 songs)
      const suggestions = [];
      const seenIds = new Set(manualQueue.map(t => t.id));
      if (curTrack) seenIds.add(curTrack.id);

      for (let i = 1; i < allTracks.length && suggestions.length < 6; i++) {
        const nextIdx = (curIdx + i) % allTracks.length;
        const candidate = allTracks[nextIdx];
        if (candidate && !seenIds.has(candidate.id)) {
          suggestions.push({ ...candidate, trackIndex: nextIdx });
          seenIds.add(candidate.id);
        }
      }

      // If still fewer than 5, pull from any tracks
      for (let i = 0; i < allTracks.length && suggestions.length < 5; i++) {
        const t = allTracks[i];
        if (t && (!curTrack || t.id !== curTrack.id) && !seenIds.has(t.id)) {
          suggestions.push({ ...t, trackIndex: i });
          seenIds.add(t.id);
        }
      }

      const totalCount = manualQueue.length + suggestions.length;
      if (countLabel) {
        countLabel.textContent = `${totalCount} upcoming`;
      }

      let html = '';

      // 1. Manually Queued Items
      if (manualQueue.length > 0) {
        html += manualQueue.map((track, i) => `
          <div class="queue-item-row touch-spring" data-play-queue="${i}" style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); border-radius:14px; cursor:pointer;">
            <div style="display:flex; align-items:center; gap:10px; overflow:hidden; flex:1;">
              <span style="font-size:12px; font-weight:800; color:var(--accent); width:18px; text-align:center;">${i + 1}</span>
              <img src="${track.cover_art || track.thumbnail || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'}" style="width:38px; height:38px; border-radius:10px; object-fit:cover; flex-shrink:0;">
              <div style="overflow:hidden; flex:1;">
                <div style="font-size:13px; font-weight:700; color:#fff; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${track.title}</div>
                <div style="font-size:11.5px; color:var(--text-muted); white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${track.artist}</div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(255,66,87,0.2); color:var(--accent); font-weight:700;">QUEUED</span>
              <button class="btn-remove-queue-item" data-idx="${i}" style="background:none; border:none; color:rgba(255,255,255,0.5); font-size:18px; padding:4px 8px; cursor:pointer;" aria-label="Remove">&times;</button>
            </div>
          </div>
        `).join('');
      }

      // 2. Suggested / Upcoming Tracks from Library (At least 5)
      if (suggestions.length > 0) {
        html += suggestions.map((track, i) => `
          <div class="queue-item-row touch-spring" data-play-suggested="${track.trackIndex != null ? track.trackIndex : i}" style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:14px; cursor:pointer;">
            <div style="display:flex; align-items:center; gap:10px; overflow:hidden; flex:1;">
              <span style="font-size:12px; font-weight:600; color:var(--text-muted); width:18px; text-align:center;">${manualQueue.length + i + 1}</span>
              <img src="${track.cover_art || track.thumbnail || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'}" style="width:38px; height:38px; border-radius:10px; object-fit:cover; flex-shrink:0;">
              <div style="overflow:hidden; flex:1;">
                <div style="font-size:13px; font-weight:600; color:#fff; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${track.title}</div>
                <div style="font-size:11.5px; color:var(--text-muted); white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${track.artist}</div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <button class="btn-add-to-queue-item" data-sugg-idx="${i}" title="Add to Queue" style="background:rgba(255,255,255,0.08); border:none; color:rgba(255,255,255,0.85); width:28px; height:28px; border-radius:50%; font-size:14px; display:grid; place-items:center; cursor:pointer;">+</button>
            </div>
          </div>
        `).join('');
      }

      queueList.innerHTML = html;

      // Event Listeners for Queue rows
      queueList.querySelectorAll('.btn-remove-queue-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx, 10);
          audioController.removeFromQueue(idx);
          haptics.trigger('light');
        });
      });

      queueList.querySelectorAll('.btn-add-to-queue-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.suggIdx, 10);
          const t = suggestions[idx];
          if (t) {
            audioController.addToQueue(t);
            haptics.trigger('medium');
          }
        });
      });

      queueList.querySelectorAll('[data-play-suggested]').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.btn-add-to-queue-item')) return;
          const trackIdx = parseInt(row.dataset.playSuggested, 10);
          if (!isNaN(trackIdx)) {
            haptics.trigger('medium');
            audioController.selectTrack(trackIdx, true);
            if (queueModal) queueModal.classList.remove('is-open');
          }
        });
      });

      queueList.querySelectorAll('[data-play-queue]').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.btn-remove-queue-item')) return;
          const qIdx = parseInt(row.dataset.playQueue, 10);
          const track = manualQueue[qIdx];
          if (track) {
            haptics.trigger('medium');
            audioController.playSong(track);
            audioController.removeFromQueue(qIdx);
            if (queueModal) queueModal.classList.remove('is-open');
          }
        });
      });
    };

    window.updateMusiiQueueUI = updateQueueUI;

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
        haptics.trigger('light');
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

    const handleFav = () => {
      const cur = audioController.getCurrentTrack();
      if (!cur) return;
      haptics.trigger('medium');
      const isFav = playlistController.isFavorite(cur);
      playlistController.toggleFavorite(cur);
      const nowFav = !isFav;
      const favBtn = document.getElementById('btnSheetFavorite');
      const lvHeart = document.getElementById('btnLvHeart');
      if (favBtn) favBtn.classList.toggle('is-favorite', nowFav);
      if (lvHeart) lvHeart.classList.toggle('is-favorite', nowFav);
      errorHandler.showToast(nowFav ? 'Added to Favorites' : 'Removed from Favorites');
    };

    const btnFav = document.getElementById('btnSheetFavorite');
    if (btnFav) btnFav.addEventListener('click', handleFav);
    const btnLvHeart = document.getElementById('btnLvHeart');
    if (btnLvHeart) btnLvHeart.addEventListener('click', handleFav);

    const btnDevice = document.getElementById('btnSheetDevice');
    if (btnDevice) {
      btnDevice.addEventListener('click', () => {
        haptics.trigger('light');
        errorHandler.showToast('Audio Output: Phone Speaker (WS-305 ready)');
      });
    }

    const openTrackMenu = (e) => {
      e.stopPropagation();
      haptics.trigger('medium');
      const cur = audioController.getCurrentTrack();
      if (cur) playlistController.openTrackContextMenu(cur, e.clientX || window.innerWidth / 2, e.clientY || window.innerHeight / 2);
    };
    const btnMore = document.getElementById('btnSheetMore');
    if (btnMore) btnMore.addEventListener('click', openTrackMenu);
    const btnLvMore = document.getElementById('btnLvMore');
    if (btnLvMore) btnLvMore.addEventListener('click', openTrackMenu);

    const vocalPill = document.getElementById('sheetVocalPill');
    if (vocalPill) {
      vocalPill.addEventListener('click', () => {
        haptics.trigger('light');
        errorHandler.showToast('Now playing: Lossless Studio Master');
      });
    }

    const sheetGrabber = document.getElementById('sheetGrabber');
    if (sheetGrabber) {
      sheetGrabber.addEventListener('click', () => {
        haptics.trigger('light');
        modalController.closePlayerSheet();
      });
    }
    const sheetGrabberLyrics = document.getElementById('sheetGrabberLyrics');
    if (sheetGrabberLyrics) {
      sheetGrabberLyrics.addEventListener('click', () => {
        haptics.trigger('light');
        modalController.closePlayerSheet();
      });
    }

    const btnQueue = document.getElementById('btnSheetQueue');
    if (btnQueue) {
      btnQueue.addEventListener('click', () => {
        haptics.trigger('medium');
        modalController.openQueueModal();
      });
    }

    const volTrack = document.getElementById('sheetVolumeTrack');
    const volFill = document.getElementById('sheetVolumeFill');
    if (volTrack) {
      const updateVol = (e) => {
        const rect = volTrack.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        if (volFill) volFill.style.width = (ratio * 100) + '%';
        if (audioController.audio) audioController.audio.volume = ratio;
        if (audioController._audioB) audioController._audioB.volume = ratio;
      };
      volTrack.addEventListener('click', updateVol);
      volTrack.addEventListener('touchmove', updateVol, { passive: true });
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
