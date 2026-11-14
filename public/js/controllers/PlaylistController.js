import { haptics } from '../middleware/hapticMiddleware.js';
import { errorHandler } from '../errors/clientErrorHandler.js';
import { DEFAULT_PLAYLISTS } from '../constants/tracks.js';
import { GRADIENTS } from '../constants/colors.js';
import { apiUrl } from '../constants/api.js';

class PlaylistController {
  constructor() {
    this.playlists = DEFAULT_PLAYLISTS;
    this.cachedSongs = [];
    this.container = null;
    this.autoCacheEnabled = true;
    this.contextTrackIdx = null;
  }

  init() {
    this.container = document.getElementById('playlistCardsGrid');
    const newBtn = document.getElementById('btnCreatePlaylist');

    if (newBtn) {
      newBtn.addEventListener('click', () => this.openCreateModal());
    }

    this.initCreateModal();
    this.initContextMenu();
    this.initCacheSettings();
    this.render();
    this.loadCachedSongs();

    window.addEventListener('musii:track-played', () => {
      if (this.autoCacheEnabled) {
        this.loadCachedSongs();
      }
    });
  }

  // --- Create Playlist Modal ---
  initCreateModal() {
    const modal = document.getElementById('createPlaylistModal');
    const input = document.getElementById('inputPlaylistName');
    const btnConfirm = document.getElementById('btnConfirmCreatePlaylist');
    const btnCancel = document.getElementById('btnCancelCreatePlaylist');

    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => this.confirmCreate());
    }
    if (btnCancel) {
      btnCancel.addEventListener('click', () => this.closeCreateModal());
    }
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) this.closeCreateModal();
      });
    }
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.confirmCreate();
      });
    }
  }

  openCreateModal() {
    haptics.trigger('medium');
    const modal = document.getElementById('createPlaylistModal');
    const input = document.getElementById('inputPlaylistName');
    if (modal) modal.classList.add('is-open');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 200);
    }
  }

  closeCreateModal() {
    const modal = document.getElementById('createPlaylistModal');
    if (modal) modal.classList.remove('is-open');
  }

  async confirmCreate() {
    const input = document.getElementById('inputPlaylistName');
    const rawName = input ? input.value.trim() : '';
    const count = this.playlists.length + 1;
    const name = rawName || `Vibe Session #${count}`;

    try {
      const res = await fetch(apiUrl('/api/playlists'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });

      if (res.ok) {
        const json = await res.json();
        this.playlists.unshift(json.data.playlist);
      } else {
        throw new Error('Fallback to local');
      }
    } catch (e) {
      this.playlists.unshift({
        id: `pl-${Date.now()}`,
        name,
        song_count: 0,
        gradient: GRADIENTS[this.playlists.length % GRADIENTS.length]
      });
    }

    haptics.trigger('heavy');
    errorHandler.showToast(`Created "${name}"`);
    this.closeCreateModal();
    this.render();
  }

  // --- Track Context Menu (Add to Playlist) ---
  initContextMenu() {
    const menu = document.getElementById('trackContextMenu');

    document.addEventListener('click', () => {
      if (menu) menu.style.display = 'none';
    });

    document.addEventListener('contextmenu', e => {
      const row = e.target.closest('.track-row');
      if (!row) return;
      e.preventDefault();

      this.contextTrackIdx = parseInt(row.dataset.idx, 10);
      this.showContextMenu(e.clientX, e.clientY);
    });

    // Long-press for mobile
    let pressTimer = null;
    document.addEventListener('touchstart', e => {
      const row = e.target.closest('.track-row');
      if (!row) return;
      pressTimer = setTimeout(() => {
        this.contextTrackIdx = parseInt(row.dataset.idx, 10);
        const touch = e.touches[0];
        this.showContextMenu(touch.clientX, touch.clientY);
      }, 500);
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (pressTimer) clearTimeout(pressTimer);
    }, { passive: true });

    document.addEventListener('touchmove', () => {
      if (pressTimer) clearTimeout(pressTimer);
    }, { passive: true });
  }

  showContextMenu(x, y) {
    const menu = document.getElementById('trackContextMenu');
    const list = document.getElementById('contextMenuPlaylistList');
    if (!menu || !list) return;

    list.innerHTML = this.playlists.map(pl => `
      <button data-pl-id="${pl.id}" style="display:flex; align-items:center; gap:10px; width:100%; padding:12px 18px; text-align:left; font-size:14px; color:#fff; border-bottom:1px solid rgba(255,255,255,0.05);">
        <svg viewBox="0 0 24 24" style="width:16px; height:16px; stroke:#fff; flex-shrink:0;"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        ${pl.name}
      </button>
    `).join('');

    list.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async () => {
        const plId = btn.dataset.plId;
        await this.addTrackToPlaylist(plId, this.contextTrackIdx);
        menu.style.display = 'none';
      });
    });

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let posX = Math.min(x, vw - 220);
    let posY = Math.min(y, vh - 200);
    posX = Math.max(8, posX);
    posY = Math.max(8, posY);

    menu.style.left = posX + 'px';
    menu.style.top = posY + 'px';
    menu.style.display = 'block';
    haptics.trigger('medium');
  }

  async addTrackToPlaylist(playlistId, trackIdx) {
    haptics.trigger('heavy');
    const pl = this.playlists.find(p => String(p.id) === String(playlistId));
    const plName = pl ? pl.name : 'Playlist';

    try {
      await fetch(apiUrl(`/api/playlists/${playlistId}/tracks`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIndex: trackIdx })
      });
    } catch (e) {}

    if (pl) {
      pl.song_count = (pl.song_count || 0) + 1;
      this.render();
    }
    errorHandler.showToast(`Added to "${plName}"`);
  }

  // --- Cache Settings ---
  initCacheSettings() {
    const btnAutoCache = document.getElementById('btnToggleAutoCache');
    const btnClear = document.getElementById('btnClearCache');

    if (btnAutoCache) {
      btnAutoCache.addEventListener('click', () => {
        this.autoCacheEnabled = !this.autoCacheEnabled;
        const tag = document.getElementById('tagAutoCacheStatus');
        if (tag) {
          tag.textContent = this.autoCacheEnabled ? 'Enabled' : 'Disabled';
          tag.style.color = this.autoCacheEnabled ? 'var(--accent-cyan)' : 'var(--text-muted)';
        }
        haptics.trigger('medium');
        errorHandler.showToast(this.autoCacheEnabled ? 'Auto-cache enabled' : 'Auto-cache disabled');
      });
    }

    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        haptics.trigger('heavy');
        try {
          await fetch(apiUrl('/api/music/cached'), { method: 'DELETE' });
        } catch (e) {}
        this.cachedSongs = [];
        this.renderCachedSongs();
        errorHandler.showToast('Audio cache cleared');
      });
    }
  }

  // --- Cached Songs ---
  async loadCachedSongs() {
    try {
      const res = await fetch(apiUrl('/api/music/cached'));
      if (res.ok) {
        const json = await res.json();
        this.cachedSongs = json.data || [];
      }
    } catch (e) {
      this.cachedSongs = [];
    }
    this.renderCachedSongs();
  }

  renderCachedSongs() {
    const container = document.getElementById('cachedSongsList');
    const label = document.getElementById('labelCacheCount');
    const sizeTag = document.getElementById('tagCacheSize');

    if (label) {
      label.textContent = `${this.cachedSongs.length} tracks`;
    }

    const totalMb = this.cachedSongs.reduce((sum, s) => sum + (s.file_size_mb || 0), 0);
    if (sizeTag) {
      sizeTag.textContent = `${totalMb.toFixed(1)} MB`;
    }

    if (!container) return;

    if (this.cachedSongs.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:28px 0; color:var(--text-muted); font-size:13px;">
          No cached songs yet. Play a track to auto-cache it.
        </div>
      `;
      return;
    }

    container.innerHTML = this.cachedSongs.map((song, i) => `
      <div class="track-row touch-spring" style="opacity:0.85;">
        <div class="track-avatar">
          <img class="track-avatar-img" src="${song.cover_art || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'}" alt="${song.title}" loading="lazy" onerror="this.src='https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'">
        </div>
        <div class="track-meta">
          <span class="track-name">${song.title}</span>
          <span class="track-artist">${song.artist} • ${song.file_size_mb || '?'} MB</span>
        </div>
        <div style="font-size:11px; padding:4px 8px; border-radius:999px; background:rgba(6,182,212,0.12); color:var(--accent-cyan); font-weight:600;">
          Cached
        </div>
      </div>
    `).join('');
  }

  setPlaylists(playlists) {
    if (playlists && playlists.length > 0) {
      this.playlists = playlists;
      this.render();
    }
  }

  render() {
    if (!this.container) return;

    const defaultCovers = {
      'pl-liked': 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/f3/5a/67/f35a67ae-de94-1e98-8f3e-ab73358f9092/06UMGIM10554.rgb.jpg/600x600bb.jpg',
      'pl-road': 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg',
      'pl-focus': 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/3e/42/a7/3e42a78d-57a3-fd69-6703-14d51205dd4c/13UMGIM24968.rgb.jpg/600x600bb.jpg'
    };

    this.container.innerHTML = this.playlists.map((pl, idx) => {
      const cover = defaultCovers[pl.id] || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg';
      return `
      <div class="playlist-card touch-spring" data-id="${pl.id}" style="padding:14px; border-radius:20px; background:var(--bg-surface); border:1px solid var(--line-strong); box-shadow:inset 0 1px 1px rgba(255,255,255,0.18); backdrop-filter:blur(20px);">
        <div style="width:100%; aspect-ratio:1; border-radius:14px; overflow:hidden; margin-bottom:10px; box-shadow:0 8px 18px rgba(0,0,0,0.5);">
          <img src="${cover}" alt="${pl.name}" style="width:100%; height:100%; object-fit:cover; display:block;" onerror="this.src='https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'">
        </div>
        <b style="display:block; font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${pl.name}</b>
        <span style="font-size:12px; color:var(--text-muted);">${pl.song_count || 0} tracks</span>
      </div>
    `;
    }).join('');
  }
}

export const playlistController = new PlaylistController();
