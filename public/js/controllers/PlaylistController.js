import { haptics } from '../middleware/hapticMiddleware.js';
import { errorHandler } from '../errors/clientErrorHandler.js';
import { DEFAULT_PLAYLISTS, DEFAULT_TRACKS } from '../constants/tracks.js';
import { GRADIENTS } from '../constants/colors.js';
import { apiUrl } from '../constants/api.js';
import { audioController } from './AudioController.js';

class PlaylistController {
  constructor() {
    this.playlists = this.loadLocalPlaylists();
    this.cachedSongs = [];
    this.container = null;
    this.autoCacheEnabled = true;
    this.contextTrackIdx = null;
    this.currentDetailPlaylist = null;
    this.searchAddDebounce = null;
  }

  loadLocalPlaylists() {
    try {
      const stored = localStorage.getItem('musii_playlists');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [...DEFAULT_PLAYLISTS];
  }

  saveLocalPlaylists() {
    try {
      localStorage.setItem('musii_playlists', JSON.stringify(this.playlists));
    } catch (e) {}
  }

  init() {
    this.container = document.getElementById('playlistCardsGrid');
    const newBtn = document.getElementById('btnCreatePlaylist');

    if (newBtn) {
      newBtn.addEventListener('click', () => this.openCreateModal());
    }

    const importBtn = document.getElementById('btnImportPlaylistFile');
    const importFileInput = document.getElementById('inputImportPlaylistFile');
    if (importBtn && importFileInput) {
      importBtn.addEventListener('click', () => {
        haptics.trigger('light');
        importFileInput.click();
      });

      importFileInput.addEventListener('change', async () => {
        const file = importFileInput.files && importFileInput.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          let newPl = null;
          if (window.Musii && window.Musii.playlists) {
            const tempStore = window.Musii.playlists.create({ userId: localStorage.getItem('musii_userId') || 'guest' });
            newPl = tempStore.importText(file.name, text);
          }
          if (newPl) {
            const created = {
              id: newPl.id,
              name: newPl.name,
              song_count: newPl.tracks ? newPl.tracks.length : 0,
              tracks: newPl.tracks || [],
              gradient: 'linear-gradient(135deg, #10b981 0%, #1e1b4b 100%)',
              category: 'Imported'
            };
            this.playlists.unshift(created);
            this.saveLocalPlaylists();
            this.render();
            errorHandler.showToast(`Imported "${newPl.name}" (${created.song_count} songs)`);
            this.openPlaylistDetail(newPl.id);
          }
        } catch (err) {
          errorHandler.showToast(err.message || 'Import failed');
        }
        importFileInput.value = '';
      });
    }

    this.initCreateModal();
    this.initRenameModal();
    this.initDetailModal();
    this.initAddSongsModal();
    this.initContextMenu();
    this.initCacheSettings();
    this.fetchPlaylists();
    this.render();
    this.loadCachedSongs();

    window.addEventListener('musii:track-played', () => {
      if (this.autoCacheEnabled) {
        this.loadCachedSongs();
      }
    });
  }

  async fetchPlaylists() {
    try {
      const res = await fetch(apiUrl('/api/playlists'));
      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data.playlists) && json.data.playlists.length > 0) {
          this.playlists = json.data.playlists;
          this.saveLocalPlaylists();
          this.render();
        }
      }
    } catch (e) {}
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
    const name = rawName || `Session #${count}`;

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

    this.saveLocalPlaylists();
    haptics.trigger('heavy');
    errorHandler.showToast(`Created "${name}"`);
    this.closeCreateModal();
    this.render();
  }

  // --- Playlist Detail View & Modal ---
  initDetailModal() {
    const modal = document.getElementById('playlistDetailModal');
    const btnClose = document.getElementById('btnClosePlaylistDetail');
    const btnPlayAll = document.getElementById('btnPlaylistPlayAll');
    const btnShuffle = document.getElementById('btnPlaylistShuffle');
    const btnAddSongs = document.getElementById('btnPlaylistAddSongs');
    const btnRename = document.getElementById('btnRenamePlaylistTrigger');
    const btnDelete = document.getElementById('btnDeletePlaylistTrigger');

    if (btnClose) {
      btnClose.addEventListener('click', () => this.closePlaylistDetail());
    }

    if (btnPlayAll) {
      btnPlayAll.addEventListener('click', () => {
        if (this.currentDetailPlaylist && this.currentDetailPlaylist.tracks && this.currentDetailPlaylist.tracks.length > 0) {
          haptics.trigger('heavy');
          audioController.setTracks(this.currentDetailPlaylist.tracks);
          audioController.selectTrack(0, true);
          errorHandler.showToast(`Playing "${this.currentDetailPlaylist.name}"`);
        } else {
          errorHandler.showToast('No tracks in this playlist yet');
        }
      });
    }

    if (btnShuffle) {
      btnShuffle.addEventListener('click', () => {
        if (this.currentDetailPlaylist && this.currentDetailPlaylist.tracks && this.currentDetailPlaylist.tracks.length > 0) {
          haptics.trigger('heavy');
          const shuffled = [...this.currentDetailPlaylist.tracks].sort(() => Math.random() - 0.5);
          audioController.setTracks(shuffled);
          audioController.selectTrack(0, true);
          errorHandler.showToast(`Shuffled "${this.currentDetailPlaylist.name}"`);
        } else {
          errorHandler.showToast('No tracks to shuffle');
        }
      });
    }

    if (btnAddSongs) {
      btnAddSongs.addEventListener('click', () => {
        if (this.currentDetailPlaylist) {
          this.openAddSongsModal(this.currentDetailPlaylist);
        }
      });
    }

    if (btnRename) {
      btnRename.addEventListener('click', () => {
        if (this.currentDetailPlaylist) {
          this.openRenameModal(this.currentDetailPlaylist);
        }
      });
    }

    if (btnDelete) {
      btnDelete.addEventListener('click', () => {
        if (this.currentDetailPlaylist) {
          this.deletePlaylist(this.currentDetailPlaylist.id);
        }
      });
    }
  }

  async openPlaylistDetail(playlistId) {
    haptics.trigger('medium');
    const modal = document.getElementById('playlistDetailModal');
    const tracksContainer = document.getElementById('playlistDetailTracksList');
    const titleEl = document.getElementById('playlistDetailTitle');
    const headerTitleEl = document.getElementById('playlistDetailHeaderTitle');
    const countEl = document.getElementById('playlistDetailHeaderCount');
    const coverImg = document.getElementById('playlistDetailCoverImg');

    if (!modal) return;

    modal.classList.add('is-open');

    // Find playlist in local cache first
    let pl = this.playlists.find(p => String(p.id) === String(playlistId));
    if (!pl) pl = { id: playlistId, name: 'Playlist', song_count: 0 };

    this.currentDetailPlaylist = pl;

    if (titleEl) titleEl.textContent = pl.name;
    if (headerTitleEl) headerTitleEl.textContent = pl.name;
    if (countEl) countEl.textContent = `${pl.song_count || 0} tracks`;

    if (tracksContainer) {
      tracksContainer.innerHTML = `
        <div style="text-align:center; padding:40px 10px; color:var(--text-muted); font-size:13px;">
          Loading tracks in playlist...
        </div>
      `;
    }

    try {
      const res = await fetch(apiUrl(`/api/playlists/${playlistId}`));
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.playlist) {
          this.currentDetailPlaylist = json.data.playlist;
          pl = json.data.playlist;
        }
      }
    } catch (e) {}

    const tracks = (this.currentDetailPlaylist && Array.isArray(this.currentDetailPlaylist.tracks))
      ? this.currentDetailPlaylist.tracks
      : [];

    if (countEl) countEl.textContent = `${tracks.length} tracks`;

    const defaultCovers = {
      'pl-liked': 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/f3/5a/67/f35a67ae-de94-1e98-8f3e-ab73358f9092/06UMGIM10554.rgb.jpg/600x600bb.jpg',
      'pl-road': 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg',
      'pl-focus': 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/3e/42/a7/3e42a78d-57a3-fd69-6703-14d51205dd4c/13UMGIM24968.rgb.jpg/600x600bb.jpg'
    };
    const coverUrl = (tracks[0] && (tracks[0].cover_art || tracks[0].thumbnail))
      || defaultCovers[pl.id]
      || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg';

    if (coverImg) coverImg.src = coverUrl;

    if (!tracksContainer) return;

    if (tracks.length === 0) {
      tracksContainer.innerHTML = `
        <div style="text-align:center; padding:45px 15px; color:var(--text-muted); font-size:13.5px;">
          This playlist has no songs yet.<br>
          <button id="btnEmptyAddSongsTrigger" class="btn-play-all-pill touch-spring" style="margin-top:14px; background:rgba(16,185,129,0.2); border:1px solid rgba(16,185,129,0.3); color:#10b981;">
            + Add Songs Now
          </button>
        </div>
      `;
      const emptyAddBtn = document.getElementById('btnEmptyAddSongsTrigger');
      if (emptyAddBtn) {
        emptyAddBtn.addEventListener('click', () => this.openAddSongsModal(this.currentDetailPlaylist));
      }
      return;
    }

    tracksContainer.innerHTML = tracks.map((track, i) => `
      <div class="track-row touch-spring" data-track-id="${track.id}" style="padding:10px 14px; border-radius:14px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); display:flex; align-items:center; gap:12px; cursor:pointer;">
        <span style="font-size:12px; font-weight:700; color:var(--text-dim); width:20px; text-align:center;">${i + 1}</span>
        <div class="track-avatar" style="width:42px; height:42px; border-radius:10px; overflow:hidden; flex-shrink:0;">
          <img class="track-avatar-img" src="${track.cover_art || track.thumbnail || coverUrl}" alt="${track.title}" style="width:100%; height:100%; object-fit:cover;" onerror="this.src='https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'">
        </div>
        <div class="track-meta" style="flex:1; overflow:hidden;">
          <span class="track-name" style="font-size:14px; font-weight:600; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.title}</span>
          <span class="track-artist" style="font-size:12px; color:var(--text-muted); display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.artist}</span>
        </div>
        <button class="sheet-icon-btn btn-remove-track-row" data-track-id="${track.id}" style="width:32px; height:32px; background:none; border:none; color:var(--text-dim);" title="Remove song">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `).join('');

    tracksContainer.querySelectorAll('.track-row').forEach((row, idx) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-track-row')) return;
        haptics.trigger('medium');
        audioController.playSong(tracks[idx]);
      });
    });

    tracksContainer.querySelectorAll('.btn-remove-track-row').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const trkId = btn.getAttribute('data-track-id');
        await this.removeTrackFromPlaylist(playlistId, trkId);
      });
    });
  }

  closePlaylistDetail() {
    haptics.trigger('light');
    const modal = document.getElementById('playlistDetailModal');
    if (modal) {
      modal.classList.remove('is-open');
    }
  }

  // --- Add Songs Modal & Search ---
  initAddSongsModal() {
    const modal = document.getElementById('addSongsToPlaylistModal');
    const btnClose = document.getElementById('btnCloseAddSongsModal');
    const input = document.getElementById('inputSearchAddSongs');

    if (btnClose) {
      btnClose.addEventListener('click', () => {
        if (modal) modal.classList.remove('is-open');
      });
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('is-open');
      });
    }

    if (input) {
      input.addEventListener('input', () => {
        clearTimeout(this.searchAddDebounce);
        this.searchAddDebounce = setTimeout(() => {
          this.searchSongsToAdd(input.value.trim());
        }, 250);
      });
    }
  }

  openAddSongsModal(playlist) {
    haptics.trigger('medium');
    const modal = document.getElementById('addSongsToPlaylistModal');
    const titleEl = document.getElementById('addSongsModalTitle');
    const input = document.getElementById('inputSearchAddSongs');

    if (titleEl) titleEl.textContent = `Add Songs to "${playlist.name}"`;
    if (input) input.value = '';

    if (modal) modal.classList.add('is-open');
    this.renderAddSongsList(DEFAULT_TRACKS);
  }

  async searchSongsToAdd(query) {
    if (!query) {
      this.renderAddSongsList(DEFAULT_TRACKS);
      return;
    }

    try {
      const res = await fetch(apiUrl(`/api/stream/search?q=${encodeURIComponent(query)}`));
      if (res.ok) {
        const json = await res.json();
        const tracks = json.data || [];
        this.renderAddSongsList(tracks);
      }
    } catch (e) {
      const localMatches = DEFAULT_TRACKS.filter(t =>
        t.title.toLowerCase().includes(query.toLowerCase()) ||
        t.artist.toLowerCase().includes(query.toLowerCase())
      );
      this.renderAddSongsList(localMatches);
    }
  }

  renderAddSongsList(tracks) {
    const container = document.getElementById('addSongsResultsContainer');
    if (!container) return;

    if (!tracks || tracks.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px 10px; color:var(--text-muted); font-size:13px;">
          No matching tracks found. Try searching another song.
        </div>
      `;
      return;
    }

    container.innerHTML = tracks.map((track) => `
      <div class="track-row" style="padding:10px 12px; border-radius:12px; background:rgba(255,255,255,0.04); display:flex; align-items:center; gap:12px;">
        <div class="track-avatar" style="width:38px; height:38px; border-radius:8px; overflow:hidden; flex-shrink:0;">
          <img src="${track.cover_art || track.thumbnail || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'}" alt="${track.title}" style="width:100%; height:100%; object-fit:cover;">
        </div>
        <div class="track-meta" style="flex:1; overflow:hidden;">
          <span style="font-size:13.5px; font-weight:600; color:#fff; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.title}</span>
          <span style="font-size:11.5px; color:var(--text-muted); display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.artist}</span>
        </div>
        <button class="btn-add-track-to-pl touch-spring" data-track-data='${encodeURIComponent(JSON.stringify(track))}' style="padding:6px 14px; border-radius:999px; background:rgba(16,185,129,0.2); border:1px solid rgba(16,185,129,0.35); color:#10b981; font-size:12px; font-weight:700; cursor:pointer;">
          + Add
        </button>
      </div>
    `).join('');

    container.querySelectorAll('.btn-add-track-to-pl').forEach(btn => {
      btn.addEventListener('click', async () => {
        haptics.trigger('heavy');
        const raw = btn.getAttribute('data-track-data');
        if (!raw || !this.currentDetailPlaylist) return;
        const track = JSON.parse(decodeURIComponent(raw));

        btn.disabled = true;
        btn.textContent = 'Adding...';

        await this.addTrackDirectly(this.currentDetailPlaylist.id, track);

        btn.textContent = 'Added';
        btn.style.background = 'rgba(255,255,255,0.08)';
        btn.style.borderColor = 'rgba(255,255,255,0.15)';
        btn.style.color = '#fff';
      });
    });
  }

  async addTrackDirectly(playlistId, track) {
    try {
      await fetch(apiUrl(`/api/playlists/${playlistId}/tracks`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track })
      });
    } catch (e) {}

    await this.openPlaylistDetail(playlistId);
    await this.fetchPlaylists();
    errorHandler.showToast(`Added "${track.title}" to playlist`);
  }

  async removeTrackFromPlaylist(playlistId, trackId) {
    haptics.trigger('medium');
    try {
      await fetch(apiUrl(`/api/playlists/${playlistId}/tracks/${trackId}`), {
        method: 'DELETE'
      });
    } catch (e) {}

    await this.openPlaylistDetail(playlistId);
    await this.fetchPlaylists();
    errorHandler.showToast('Removed track from playlist');
  }

  // --- Rename Playlist Modal ---
  initRenameModal() {
    const modal = document.getElementById('renamePlaylistModal');
    const input = document.getElementById('inputRenamePlaylist');
    const btnConfirm = document.getElementById('btnConfirmRenamePlaylist');
    const btnCancel = document.getElementById('btnCancelRenamePlaylist');

    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => this.confirmRename());
    }
    if (btnCancel) {
      btnCancel.addEventListener('click', () => this.closeRenameModal());
    }
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) this.closeRenameModal();
      });
    }
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.confirmRename();
      });
    }
  }

  openRenameModal(playlist) {
    haptics.trigger('medium');
    const modal = document.getElementById('renamePlaylistModal');
    const input = document.getElementById('inputRenamePlaylist');
    if (modal) modal.classList.add('is-open');
    if (input) {
      input.value = playlist.name;
      setTimeout(() => input.focus(), 200);
    }
  }

  closeRenameModal() {
    const modal = document.getElementById('renamePlaylistModal');
    if (modal) modal.classList.remove('is-open');
  }

  async confirmRename() {
    const input = document.getElementById('inputRenamePlaylist');
    const newName = input ? input.value.trim() : '';
    if (!newName || !this.currentDetailPlaylist) return;

    const id = this.currentDetailPlaylist.id;
    try {
      const res = await fetch(apiUrl(`/api/playlists/${id}/rename`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      if (res.ok) {
        const json = await res.json();
        this.currentDetailPlaylist = json.data.playlist;
      }
    } catch (e) {}

    // Update locally
    const pl = this.playlists.find(p => String(p.id) === String(id));
    if (pl) pl.name = newName;
    this.saveLocalPlaylists();

    const titleEl = document.getElementById('playlistDetailTitle');
    const headerTitleEl = document.getElementById('playlistDetailHeaderTitle');
    if (titleEl) titleEl.textContent = newName;
    if (headerTitleEl) headerTitleEl.textContent = newName;

    this.closeRenameModal();
    this.render();
    errorHandler.showToast(`Playlist renamed to "${newName}"`);
  }

  async deletePlaylist(id) {
    if (!confirm('Are you sure you want to delete this playlist?')) return;
    haptics.trigger('heavy');

    try {
      await fetch(apiUrl(`/api/playlists/${id}`), { method: 'DELETE' });
    } catch (e) {}

    this.playlists = this.playlists.filter(p => String(p.id) !== String(id));
    this.saveLocalPlaylists();
    this.closePlaylistDetail();
    this.render();
    errorHandler.showToast('Playlist deleted');
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
      <button data-pl-id="${pl.id}" style="display:flex; align-items:center; gap:10px; width:100%; padding:12px 18px; text-align:left; font-size:14px; color:#fff; border-bottom:1px solid rgba(255,255,255,0.05); background:none; border-top:none; border-left:none; border-right:none; cursor:pointer;">
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
    const track = audioController.tracks[trackIdx] || audioController.getCurrentTrack();

    try {
      await fetch(apiUrl(`/api/playlists/${playlistId}/tracks`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track })
      });
    } catch (e) {}

    if (pl) {
      pl.song_count = (pl.song_count || 0) + 1;
      this.saveLocalPlaylists();
      this.render();
    }
    errorHandler.showToast(`Added "${track.title}" to "${plName}"`);
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

    container.innerHTML = this.cachedSongs.map((song) => `
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
      this.saveLocalPlaylists();
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

    this.container.innerHTML = this.playlists.map((pl) => {
      const cover = (pl.tracks && pl.tracks[0] && (pl.tracks[0].cover_art || pl.tracks[0].thumbnail))
        || pl.cover_art
        || defaultCovers[pl.id]
        || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg';
      return `
      <div class="playlist-card touch-spring" data-id="${pl.id}" style="padding:14px; border-radius:20px; background:var(--bg-surface); border:1px solid var(--line-strong); box-shadow:inset 0 1px 1px rgba(255,255,255,0.18); backdrop-filter:blur(20px); cursor:pointer;">
        <div style="width:100%; aspect-ratio:1; border-radius:14px; overflow:hidden; margin-bottom:10px; box-shadow:0 8px 18px rgba(0,0,0,0.5);">
          <img src="${cover}" alt="${pl.name}" style="width:100%; height:100%; object-fit:cover; display:block;" onerror="this.src='https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'">
        </div>
        <b style="display:block; font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${pl.name}</b>
        <span style="font-size:12px; color:var(--text-muted);">${pl.song_count || 0} tracks</span>
      </div>
    `;
    }).join('');

    // Wire up clicking any playlist card to open detail view!
    this.container.querySelectorAll('.playlist-card').forEach(card => {
      card.addEventListener('click', () => {
        const plId = card.getAttribute('data-id');
        this.openPlaylistDetail(plId);
      });
    });
  }
}

export const playlistController = new PlaylistController();
