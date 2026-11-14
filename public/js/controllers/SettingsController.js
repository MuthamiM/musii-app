import { haptics } from '../middleware/hapticMiddleware.js';
import { errorHandler } from '../errors/clientErrorHandler.js';
import { audioController } from './AudioController.js';
import { navigationController } from './NavigationController.js';
import { apiUrl } from '../constants/api.js';

class SettingsController {
  constructor() {
    this.view = null;
    this.previousTab = 'home';
    this.directStream = true;
    this.dolbyAtmos = true;
  }

  init() {
    this.view = document.getElementById('view-settings');
    const btnBack = document.getElementById('btnSettingsBack');
    const searchInput = document.getElementById('inputSearchSettings');

    if (btnBack) {
      btnBack.addEventListener('click', () => this.close());
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.filterSettings(e.target.value));
    }

    // Direct Source Stream toggle
    const toggleDirect = document.getElementById('toggleDirectStream');
    if (toggleDirect) {
      toggleDirect.addEventListener('change', (e) => {
        this.directStream = e.target.checked;
        audioController.useDirectStream = this.directStream;
        haptics.trigger('medium');
        errorHandler.showToast(this.directStream ? 'Direct Source Stream enabled' : 'Web Audio Synth fallback');
      });
    }

    // Dolby Atmos toggle
    const toggleDolby = document.getElementById('toggleDolbyAtmos');
    if (toggleDolby) {
      toggleDolby.addEventListener('change', (e) => {
        this.dolbyAtmos = e.target.checked;
        haptics.trigger('heavy');
        errorHandler.showToast(this.dolbyAtmos ? 'Dolby Atmos Spatializer active' : 'Dolby Atmos disabled');
      });
    }

    // Spotify Import trigger (from Account & integrations or dedicated button)
    const btnAccountIntegrations = document.getElementById('btnAccountIntegrations');
    if (btnAccountIntegrations) {
      btnAccountIntegrations.addEventListener('click', () => this.openSpotifyModal());
    }

    const btnSpotifyImport = document.getElementById('btnOpenSpotifyImport');
    if (btnSpotifyImport) {
      btnSpotifyImport.addEventListener('click', () => this.openSpotifyModal());
    }

    this.initSpotifyModal();
  }

  open(fromTab = 'home') {
    this.previousTab = fromTab;
    haptics.trigger('medium');

    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    if (this.view) {
      this.view.classList.add('active');
    }
  }

  close() {
    haptics.trigger('light');
    if (this.view) {
      this.view.classList.remove('active');
    }
    navigationController.switchTab(this.previousTab || 'home');
  }

  filterSettings(query) {
    const term = (query || '').toLowerCase().trim();
    const rows = document.querySelectorAll('.settings-item-row');

    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = (!term || text.includes(term)) ? 'flex' : 'none';
    });
  }

  // --- Spotify Import Modal ---
  initSpotifyModal() {
    const modal = document.getElementById('spotifyImportModal');
    const input = document.getElementById('inputSpotifyUrl');
    const btnConfirm = document.getElementById('btnConfirmSpotifyImport');
    const btnCancel = document.getElementById('btnCancelSpotifyImport');

    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => this.handleSpotifyImport());
    }
    if (btnCancel) {
      btnCancel.addEventListener('click', () => this.closeSpotifyModal());
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeSpotifyModal();
      });
    }
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.handleSpotifyImport();
      });
    }
  }

  openSpotifyModal() {
    haptics.trigger('medium');
    const modal = document.getElementById('spotifyImportModal');
    const input = document.getElementById('inputSpotifyUrl');
    if (modal) modal.classList.add('is-open');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 200);
    }
  }

  closeSpotifyModal() {
    const modal = document.getElementById('spotifyImportModal');
    if (modal) modal.classList.remove('is-open');
  }

  async handleSpotifyImport() {
    const input = document.getElementById('inputSpotifyUrl');
    const url = input ? input.value.trim() : '';

    if (!url || !url.includes('spotify.com')) {
      haptics.trigger('heavy');
      errorHandler.showToast('Please paste a valid open.spotify.com link');
      return;
    }

    const btn = document.getElementById('btnConfirmSpotifyImport');
    if (btn) btn.disabled = true;

    haptics.trigger('medium');
    errorHandler.showToast('Importing from Spotify & matching audio...');

    try {
      const res = await fetch(apiUrl('/api/spotify/import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.closeSpotifyModal();
        haptics.trigger('heavy');

        if (data.data.type === 'track' && data.data.track) {
          const newTrack = data.data.track;
          audioController.tracks.unshift(newTrack);
          audioController.selectTrack(0, true);
          errorHandler.showToast(`Imported "${newTrack.title}" by ${newTrack.artist}`);
        } else if (data.data.type === 'playlist') {
          errorHandler.showToast(data.data.message || 'Playlist imported');
        }
      } else {
        throw new Error(data.error || 'Import failed');
      }
    } catch (err) {
      haptics.trigger('heavy');
      errorHandler.showToast(err.message || 'Error importing Spotify link');
    } finally {
      if (btn) btn.disabled = false;
    }
  }
}

export const settingsController = new SettingsController();

