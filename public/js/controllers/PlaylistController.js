import { haptics } from '../middleware/hapticMiddleware.js';
import { errorHandler } from '../errors/clientErrorHandler.js';
import { DEFAULT_PLAYLISTS } from '../constants/tracks.js';
import { GRADIENTS } from '../constants/colors.js';

class PlaylistController {
  constructor() {
    this.playlists = DEFAULT_PLAYLISTS;
    this.container = null;
  }

  init() {
    this.container = document.getElementById('playlistCardsGrid');
    const newBtn = document.getElementById('btnCreatePlaylist');

    if (newBtn) {
      newBtn.addEventListener('click', () => this.promptCreate());
    }

    this.render();
  }

  setPlaylists(playlists) {
    if (playlists && playlists.length > 0) {
      this.playlists = playlists;
      this.render();
    }
  }

  async promptCreate() {
    haptics.trigger('medium');
    const count = this.playlists.length + 1;
    const name = `Vibe Session #${count}`;

    try {
      const res = await fetch('/api/playlists', {
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
    this.render();
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = this.playlists.map((pl, idx) => `
      <div class="playlist-card touch-spring" data-id="${pl.id}" style="padding:14px; border-radius:20px; background:var(--bg-surface); border:1px solid var(--line-strong); box-shadow:inset 0 1px 1px rgba(255,255,255,0.18); backdrop-filter:blur(20px);">
        <div style="width:100%; aspect-ratio:1; border-radius:14px; background:${pl.gradient}; margin-bottom:10px; display:grid; place-items:center; box-shadow:inset 0 1px 1px rgba(255,255,255,0.3);">
          <svg viewBox="0 0 24 24" style="width:28px; height:28px; stroke:#fff"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </div>
        <b style="display:block; font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${pl.name}</b>
        <span style="font-size:12px; color:var(--text-muted);">${pl.song_count || 0} tracks</span>
      </div>
    `).join('');
  }
}

export const playlistController = new PlaylistController();
