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
    this.renderLibraryView();
    this.renderExploreView();
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
      this.renderLibraryView();
      this.renderExploreView();
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

  renderLibraryView() {
    const statsMinutes = document.getElementById('statsCardMinutesVal');
    if (statsMinutes) {
      const storedMins = localStorage.getItem('musii_listening_mins');
      statsMinutes.textContent = storedMins || '718';
    }

    const onDeviceGrid = document.getElementById('onDeviceGrid');
    if (onDeviceGrid) {
      const playlists = playlistController.playlists || [];
      const defaultAlbums = [
        {
          id: 'dev-1',
          name: 'AI YoungBoy 2',
          subtitle: 'YoungBoy Never Broke Again',
          cover: 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg',
          count: '18 tracks'
        },
        {
          id: 'dev-2',
          name: 'Victims of Madness',
          subtitle: 'Wakadinali',
          cover: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/3e/42/a7/3e42a78d-57a3-fd69-6703-14d51205dd4c/13UMGIM24968.rgb.jpg/600x600bb.jpg',
          count: '15 tracks'
        }
      ];

      const gridItems = playlists.length > 0
        ? playlists.map(p => ({
            id: p.id,
            name: p.name,
            subtitle: p.category || 'Session',
            cover: (p.tracks && p.tracks[0] && (p.tracks[0].cover_art || p.tracks[0].thumbnail)) || defaultAlbums[0].cover,
            count: `${p.song_count || (p.tracks ? p.tracks.length : 0)} tracks`
          }))
        : defaultAlbums;

      onDeviceGrid.innerHTML = gridItems.map(item => `
        <div class="on-device-card touch-spring" data-playlist-id="${item.id}">
          <div class="on-device-cover-wrap">
            <img class="on-device-cover" src="${item.cover}" alt="${item.name}" loading="lazy" onerror="this.src='${defaultAlbums[0].cover}'">
          </div>
          <div class="on-device-title">${item.name}</div>
          <div class="on-device-sub">${item.subtitle}</div>
        </div>
      `).join('');

      onDeviceGrid.querySelectorAll('.on-device-card').forEach(card => {
        card.addEventListener('click', () => {
          const pid = card.dataset.playlistId;
          haptics.trigger('medium');
          playlistController.openPlaylistDetail(pid);
        });
      });
    }

    const btnDownloads = document.getElementById('btnLibraryDownloads');
    if (btnDownloads && !btnDownloads._bound) {
      btnDownloads._bound = true;
      btnDownloads.addEventListener('click', () => {
        haptics.trigger('light');
        playlistController.openPlaylistDetail('pl-liked');
      });
    }

    const btnLocalMusic = document.getElementById('btnLibraryLocalMusic');
    if (btnLocalMusic && !btnLocalMusic._bound) {
      btnLocalMusic._bound = true;
      btnLocalMusic.addEventListener('click', () => {
        haptics.trigger('light');
        errorHandler.showToast('14 Local lossless tracks found on device');
        playlistController.openPlaylistDetail('pl-road');
      });
    }

    const btnCached = document.getElementById('btnLibraryCachedSongs');
    if (btnCached && !btnCached._bound) {
      btnCached._bound = true;
      btnCached.addEventListener('click', () => {
        haptics.trigger('light');
        playlistController.openPlaylistDetail('pl-focus');
      });
    }

    const btnNewPl = document.getElementById('btnCreatePlaylistInline');
    if (btnNewPl && !btnNewPl._bound) {
      btnNewPl._bound = true;
      btnNewPl.addEventListener('click', () => {
        haptics.trigger('medium');
        playlistController.openCreateModal();
      });
    }

    const btnHist = document.getElementById('btnLibraryHistory');
    if (btnHist && !btnHist._bound) {
      btnHist._bound = true;
      btnHist.addEventListener('click', () => {
        haptics.trigger('light');
        errorHandler.showToast('Listening History: 214 plays this month');
      });
    }
  }

  renderExploreView() {
    const scroller = document.getElementById('explorePicksScroller');
    if (scroller) {
      const explorePicks = [
        {
          title: 'Top Hits Daily',
          subtitle: 'Global viral sensation chart',
          category: 'Chart',
          image: 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'
        },
        {
          title: 'Afrobeats Wave',
          subtitle: 'Lagos to Nairobi energy',
          category: 'Vibe',
          image: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/3e/42/a7/3e42a78d-57a3-fd69-6703-14d51205dd4c/13UMGIM24968.rgb.jpg/600x600bb.jpg'
        },
        {
          title: 'Late Night Chill',
          subtitle: 'Lo-fi & instrumental flows',
          category: 'Relax',
          image: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/f3/5a/67/f35a67ae-de94-1e98-8f3e-ab73358f9092/06UMGIM10554.rgb.jpg/600x600bb.jpg'
        }
      ];

      scroller.innerHTML = explorePicks.map((pick, i) => `
        <div class="music-card touch-spring" data-explore-pick="${i}">
          <img class="music-card-bg-img" src="${pick.image}" alt="${pick.title}" loading="lazy">
          <div class="music-card-overlay"></div>
          <div class="card-bottom-info">
            <span class="card-tag">${pick.category}</span>
            <b class="card-title">${pick.title}</b>
            <span class="card-subtitle">${pick.subtitle}</span>
          </div>
        </div>
      `).join('');

      scroller.querySelectorAll('.music-card').forEach(card => {
        card.addEventListener('click', () => {
          const idx = parseInt(card.dataset.explorePick, 10);
          const p = explorePicks[idx] || explorePicks[0];
          this.openCardDetails(p);
        });
      });
    }

    const chartsList = document.getElementById('exploreChartsList');
    if (chartsList) {
      chartsList.innerHTML = this.tracks.slice(0, 10).map((track, i) => `
        <div class="track-row touch-spring" data-chart-idx="${i}" style="padding:10px 14px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:14px; display:flex; align-items:center; gap:12px; cursor:pointer;">
          <span style="font-size:14px; font-weight:800; color:${i < 3 ? 'var(--accent)' : 'var(--text-muted)'}; width:20px; text-align:center;">${i + 1}</span>
          <img src="${track.cover_art}" style="width:42px; height:42px; border-radius:10px; object-fit:cover;">
          <div style="flex:1; overflow:hidden;">
            <div style="font-size:14px; font-weight:700; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.title}</div>
            <div style="font-size:12px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.artist}</div>
          </div>
          <span style="font-size:11px; color:var(--text-dim);">${track.duration_str || '3:30'}</span>
        </div>
      `).join('');

      chartsList.querySelectorAll('[data-chart-idx]').forEach(row => {
        row.addEventListener('click', () => {
          const idx = parseInt(row.dataset.chartIdx, 10);
          haptics.trigger('medium');
          audioController.selectTrack(idx, true);
        });
      });
    }
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

      const queueThumb = document.getElementById('queueThumb');
      if (queueThumb && track.cover_art) queueThumb.style.backgroundImage = `url("${track.cover_art}")`;
      const queueTitle = document.getElementById('queueTitle');
      if (queueTitle) queueTitle.textContent = track.title || 'MUSII';
      const queueArtist = document.getElementById('queueArtist');
      if (queueArtist) queueArtist.textContent = track.artist || 'Unknown Artist';
      const btnQueueHeart = document.getElementById('btnQueueHeart');
      if (btnQueueHeart) btnQueueHeart.classList.toggle('is-favorite', isFav);

      const qNpCover = document.getElementById('queueItemNowPlayingCover');
      const qNpTitle = document.getElementById('queueItemNowPlayingTitle');
      const qNpArtist = document.getElementById('queueItemNowPlayingArtist');
      if (qNpCover && track.cover_art) qNpCover.src = track.cover_art;
      if (qNpTitle) qNpTitle.textContent = track.title || 'MUSII';
      if (qNpArtist) qNpArtist.textContent = track.artist || 'Unknown Artist';

      const qNextHead = document.getElementById('queueNextHeading');
      if (qNextHead) qNextHead.textContent = `Next from: ${track.artist || 'Artist'}`;

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

    function setPlayerMode(mode) {
      if (!np) return;
      np.dataset.mode = mode;
      if (lbtn) {
        lbtn.setAttribute('aria-pressed', String(mode === 'lyrics'));
      }
      const qBtn = document.getElementById('btnSheetQueue');
      if (qBtn) {
        qBtn.classList.toggle('active', mode === 'queue');
      }
      if (mode === 'lyrics' && overlayView) {
        requestAnimationFrame(() => {
          overlayView.poke();
          setTimeout(() => overlayView.poke(), 60);
          setTimeout(() => overlayView.poke(), 200);
        });
      }
      if (mode === 'queue' && window.updateMusiiQueueUI) {
        window.updateMusiiQueueUI();
      }
    }

    window.setMusiiPlayerMode = setPlayerMode;
    window.setMusiiLyricsMode = setPlayerMode;

    const sheetVocalPill = document.getElementById('sheetVocalPill');
    if (sheetVocalPill) {
      sheetVocalPill.addEventListener('click', () => {
        haptics.trigger('light');
        setPlayerMode('lyrics');
      });
    }

    const btnLvBack = document.getElementById('btnLvBack');
    if (btnLvBack) {
      btnLvBack.addEventListener('click', () => {
        haptics.trigger('light');
        setPlayerMode('art');
      });
    }

    const lvThumb = document.getElementById('lvThumb');
    if (lvThumb) {
      lvThumb.addEventListener('click', () => {
        haptics.trigger('light');
        setPlayerMode('art');
      });
    }

    const queueThumb = document.getElementById('queueThumb');
    if (queueThumb) {
      queueThumb.addEventListener('click', () => {
        haptics.trigger('light');
        setPlayerMode('art');
      });
    }

    const sheetGrabberQueue = document.getElementById('sheetGrabberQueue');
    if (sheetGrabberQueue) {
      sheetGrabberQueue.addEventListener('click', () => {
        haptics.trigger('light');
        modalController.closePlayerSheet();
      });
    }

    if (lbtn) {
      lbtn.addEventListener('click', () => {
        haptics.trigger('medium');
        setPlayerMode(np && np.dataset.mode === 'lyrics' ? 'art' : 'lyrics');
      });
    }

    if (btnLvHeart) {
      btnLvHeart.addEventListener('click', () => {
        haptics.trigger('medium');
        const cur = audioController.getCurrentTrack();
        if (cur) playlistController.toggleFavorite(cur);
      });
    }

    const btnQueueHeart = document.getElementById('btnQueueHeart');
    if (btnQueueHeart) {
      btnQueueHeart.addEventListener('click', () => {
        haptics.trigger('medium');
        const cur = audioController.getCurrentTrack();
        if (cur) playlistController.toggleFavorite(cur);
      });
    }

    const btnRemoveNowPlaying = document.getElementById('btnRemoveNowPlaying');
    if (btnRemoveNowPlaying) {
      btnRemoveNowPlaying.addEventListener('click', () => {
        haptics.trigger('light');
        audioController.pause();
        setPlayerMode('art');
      });
    }

    const btnQueueShuffle = document.getElementById('btnQueueShuffle');
    if (btnQueueShuffle) {
      btnQueueShuffle.addEventListener('click', () => {
        haptics.trigger('medium');
        const on = audioController.toggleShuffle();
        btnQueueShuffle.classList.toggle('is-active', on);
        errorHandler.showToast(on ? 'Shuffle enabled' : 'Shuffle disabled');
      });
    }

    const btnQueueRepeat = document.getElementById('btnQueueRepeat');
    if (btnQueueRepeat) {
      btnQueueRepeat.addEventListener('click', () => {
        haptics.trigger('medium');
        const rep = audioController.toggleRepeat();
        btnQueueRepeat.classList.toggle('is-active', rep !== 'off');
        errorHandler.showToast(`Repeat mode: ${rep}`);
      });
    }

    const btnQueueAutoplay = document.getElementById('btnQueueAutoplay');
    if (btnQueueAutoplay) {
      btnQueueAutoplay.addEventListener('click', () => {
        haptics.trigger('medium');
        btnQueueAutoplay.classList.toggle('is-active');
        errorHandler.showToast(btnQueueAutoplay.classList.contains('is-active') ? 'Autoplay infinite queue ON' : 'Autoplay infinite queue OFF');
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
    const playerSheet = document.getElementById('fullscreenPlayerSheet');
    const queueList = document.getElementById('queueDynamicList');
    const npCover = document.getElementById('queueItemNowPlayingCover');
    const npTitle = document.getElementById('queueItemNowPlayingTitle');
    const npArtist = document.getElementById('queueItemNowPlayingArtist');
    const btnRemoveNp = document.getElementById('btnRemoveNowPlaying');
    const headerCover = document.getElementById('queueThumb');
    const headerTitle = document.getElementById('queueTitle');
    const headerArtist = document.getElementById('queueArtist');
    const nextHeading = document.getElementById('queueNextHeading');
    const btnQueueHeart = document.getElementById('btnQueueHeart');
    const btnQueueMore = document.getElementById('btnQueueMore');

    // Queue cluster buttons
    const btnShuffle = document.getElementById('btnQueueShuffle');
    const btnRepeat = document.getElementById('btnQueueRepeat');
    const btnAutoplay = document.getElementById('btnQueueAutoplay');

    const updateClusterStates = () => {
      if (btnShuffle) {
        btnShuffle.classList.toggle('is-active', Boolean(audioController.isShuffled));
      }
      if (btnRepeat) {
        btnRepeat.classList.toggle('is-active', audioController.repeatMode !== 'off');
      }
      if (btnAutoplay) {
        btnAutoplay.classList.toggle('is-active', Boolean(audioController.autoplayEnabled !== false));
      }
    };

    const updateQueueUI = (queue = audioController.queue) => {
      const curTrack = audioController.getCurrentTrack();
      const defaultCover = 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg';
      const curCoverUrl = curTrack ? (curTrack.cover_art || curTrack.thumbnail || defaultCover) : defaultCover;

      if (curTrack) {
        if (npTitle) npTitle.textContent = curTrack.title || 'MUSII';
        if (npArtist) npArtist.textContent = curTrack.artist || 'Unknown Artist';
        if (npCover) npCover.src = curCoverUrl;

        if (headerTitle) headerTitle.textContent = curTrack.title || 'MUSII';
        if (headerArtist) headerArtist.textContent = curTrack.artist || 'Unknown Artist';
        if (headerCover) headerCover.style.backgroundImage = `url("${curCoverUrl}")`;
        if (nextHeading) nextHeading.textContent = `Next from: ${curTrack.artist || 'wakadinali'}`;

        if (btnQueueHeart) {
          const isFav = playlistController.isFavorite(curTrack);
          btnQueueHeart.classList.toggle('is-favorite', isFav);
          btnQueueHeart.style.color = isFav ? 'var(--accent)' : '';
        }
      }

      updateClusterStates();

      if (!queueList) return;

      const manualQueue = queue || [];
      const allTracks = audioController.tracks || [];
      const curIdx = audioController.currentIdx || 0;

      // Build upcoming tracklist
      const upcoming = [];
      manualQueue.forEach((t, i) => {
        upcoming.push({ ...t, isManual: true, manualIdx: i });
      });

      const seenIds = new Set(upcoming.map(t => t.id));
      if (curTrack) seenIds.add(curTrack.id);

      // Remaining tracks from current album/session
      for (let i = 1; i < allTracks.length && upcoming.length < 14; i++) {
        const nextIdx = (curIdx + i) % allTracks.length;
        const candidate = allTracks[nextIdx];
        if (candidate && !seenIds.has(candidate.id)) {
          upcoming.push({ ...candidate, trackIndex: nextIdx, isManual: false });
          seenIds.add(candidate.id);
        }
      }

      queueList.innerHTML = upcoming.map((track, i) => {
        const cover = track.cover_art || track.thumbnail || defaultCover;
        return `
          <div class="queue-item-row touch-spring" data-queue-idx="${i}">
            <div class="queue-drag-handle" title="Drag to reorder">=</div>
            <img class="queue-thumb" src="${cover}" alt="${track.title}" onerror="this.src='${defaultCover}'">
            <div class="queue-item-meta">
              <div class="queue-item-title">${track.title}</div>
              <div class="queue-item-artist">${track.artist}</div>
            </div>
            <button class="queue-remove-btn touch-spring" data-remove-idx="${i}" aria-label="Remove">✕</button>
          </div>
        `;
      }).join('');

      // Click to play row
      queueList.querySelectorAll('.queue-item-row').forEach((row, i) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.queue-remove-btn') || e.target.closest('.queue-drag-handle')) return;
          const item = upcoming[i];
          if (!item) return;
          haptics.trigger('medium');
          if (item.isManual) {
            audioController.playSong(item);
            audioController.removeFromQueue(item.manualIdx);
          } else if (item.trackIndex != null) {
            audioController.selectTrack(item.trackIndex, true);
          } else {
            audioController.playSong(item);
          }
        });
      });

      // Remove button handler
      queueList.querySelectorAll('.queue-remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          haptics.trigger('light');
          const idx = parseInt(btn.dataset.removeIdx, 10);
          const item = upcoming[idx];
          if (item && item.isManual) {
            audioController.removeFromQueue(item.manualIdx);
          } else {
            const row = btn.closest('.queue-item-row');
            if (row) row.style.display = 'none';
          }
        });
      });
    };

    window.updateMusiiQueueUI = updateQueueUI;

    window.addEventListener('musii:queue-updated', (e) => {
      updateQueueUI(e.detail.queue);
    });

    if (btnRemoveNp) {
      btnRemoveNp.addEventListener('click', (e) => {
        e.stopPropagation();
        haptics.trigger('medium');
        audioController.next();
      });
    }

    if (btnShuffle) {
      btnShuffle.addEventListener('click', (e) => {
        e.stopPropagation();
        haptics.trigger('light');
        const isShuffled = audioController.toggleShuffle();
        btnShuffle.classList.toggle('is-active', isShuffled);
        errorHandler.showToast(isShuffled ? 'Shuffle turned ON' : 'Shuffle turned OFF');
      });
    }

    if (btnRepeat) {
      btnRepeat.addEventListener('click', (e) => {
        e.stopPropagation();
        haptics.trigger('light');
        const mode = audioController.cycleRepeat();
        btnRepeat.classList.toggle('is-active', mode !== 'off');
        errorHandler.showToast(`Repeat mode: ${mode.toUpperCase()}`);
      });
    }

    if (btnAutoplay) {
      btnAutoplay.addEventListener('click', (e) => {
        e.stopPropagation();
        haptics.trigger('light');
        audioController.autoplayEnabled = !audioController.autoplayEnabled;
        btnAutoplay.classList.toggle('is-active', Boolean(audioController.autoplayEnabled));
        errorHandler.showToast(audioController.autoplayEnabled ? 'Infinity Autoplay ON' : 'Infinity Autoplay OFF');
      });
    }

    if (btnQueueHeart) {
      btnQueueHeart.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = audioController.getCurrentTrack();
        if (cur) {
          haptics.trigger('medium');
          playlistController.toggleFavorite(cur);
          const isFav = playlistController.isFavorite(cur);
          btnQueueHeart.classList.toggle('is-favorite', isFav);
          btnQueueHeart.style.color = isFav ? 'var(--accent)' : '';
          const favBtn = document.getElementById('btnSheetFavorite');
          const lvHeart = document.getElementById('btnLvHeart');
          if (favBtn) favBtn.classList.toggle('is-favorite', isFav);
          if (lvHeart) lvHeart.classList.toggle('is-favorite', isFav);
          errorHandler.showToast(isFav ? 'Added to Favorites' : 'Removed from Favorites');
        }
      });
    }

    if (btnQueueMore) {
      btnQueueMore.addEventListener('click', (e) => {
        e.stopPropagation();
        haptics.trigger('medium');
        const cur = audioController.getCurrentTrack();
        if (cur) playlistController.openTrackContextMenu(cur, e.clientX || window.innerWidth / 2, e.clientY || window.innerHeight / 2);
      });
    }

    const btnQueueToggle = document.getElementById('btnSheetQueue');
    if (btnQueueToggle) {
      btnQueueToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        haptics.trigger('light');
        if (playerSheet) {
          const currentMode = playerSheet.dataset.mode;
          if (currentMode === 'queue') {
            playerSheet.dataset.mode = 'art';
          } else {
            modalController.openPlayerSheet('queue');
          }
        }
      });
    }

    const btnLyricsToggle = document.getElementById('btnToggleLyricsMode');
    if (btnLyricsToggle) {
      btnLyricsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        haptics.trigger('light');
        if (playerSheet) {
          const currentMode = playerSheet.dataset.mode;
          if (currentMode === 'lyrics') {
            playerSheet.dataset.mode = 'art';
          } else {
            modalController.openPlayerSheet('lyrics');
          }
        }
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
        navigationController.goTo('settings');
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
