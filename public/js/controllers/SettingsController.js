import { haptics } from '../middleware/hapticMiddleware.js';
import { errorHandler } from '../errors/clientErrorHandler.js';
import { audioController } from './AudioController.js';
import { navigationController } from './NavigationController.js';
import { playlistController } from './PlaylistController.js';
import { apiUrl } from '../constants/api.js';

class SettingsController {
  constructor() {
    this.view = null;
    this.previousTab = 'home';
    this.directStream = true;
    this.dolbyAtmos = true;
    this.statsCurrentTab = 'top';
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

    // Feature 4: Crossfade Settings
    const toggleCrossfade = document.getElementById('toggleCrossfade');
    const crossfadeContainer = document.getElementById('crossfadeSliderContainer');
    const rangeCrossfade = document.getElementById('rangeCrossfade');
    const labelCrossfade = document.getElementById('labelCrossfadeDuration');
    const labelCrossfadeSec = document.getElementById('labelCrossfadeSeconds');

    if (toggleCrossfade) {
      toggleCrossfade.checked = audioController.crossfadeEnabled;
      if (crossfadeContainer) {
        crossfadeContainer.style.display = audioController.crossfadeEnabled ? 'block' : 'none';
      }
      if (labelCrossfade) {
        labelCrossfade.textContent = audioController.crossfadeEnabled
          ? `${audioController.crossfadeDuration} seconds overlap`
          : 'Disabled (Direct Cut)';
      }

      toggleCrossfade.addEventListener('change', (e) => {
        haptics.trigger('medium');
        const enabled = e.target.checked;
        const dur = rangeCrossfade ? parseInt(rangeCrossfade.value, 10) : 6;
        audioController.setCrossfade(enabled, dur);

        if (crossfadeContainer) {
          crossfadeContainer.style.display = enabled ? 'block' : 'none';
        }
        if (labelCrossfade) {
          labelCrossfade.textContent = enabled ? `${dur} seconds overlap` : 'Disabled (Direct Cut)';
        }
        errorHandler.showToast(enabled ? `Crossfade enabled (${dur}s)` : 'Crossfade disabled');
      });
    }

    if (rangeCrossfade) {
      rangeCrossfade.value = audioController.crossfadeDuration || 6;
      if (labelCrossfadeSec) labelCrossfadeSec.textContent = `${rangeCrossfade.value}s`;

      rangeCrossfade.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (labelCrossfadeSec) labelCrossfadeSec.textContent = `${val}s`;
        if (labelCrossfade) labelCrossfade.textContent = `${val} seconds overlap`;
        audioController.setCrossfade(true, val);
      });
    }

    // Feature 9: Equalizer Modal Wiring
    this.initEqualizerModal();

    // Feature 7: Listening Stats & History Modal Wiring
    this.initStatsHistoryModal();

    // Spotify Import trigger
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

  // --- Feature 9: Equalizer Modal ---
  initEqualizerModal() {
    const btnOpen = document.getElementById('btnOpenEqualizer');
    const modal = document.getElementById('equalizerModal');
    const btnClose = document.getElementById('btnCloseEqualizerModal');
    const labelPreset = document.getElementById('labelEqualizerPreset');

    if (btnOpen && modal) {
      btnOpen.addEventListener('click', () => {
        haptics.trigger('medium');
        modal.classList.add('is-open');
        audioController.initEqualizer();
      });
    }

    if (btnClose && modal) {
      btnClose.addEventListener('click', () => {
        haptics.trigger('light');
        modal.classList.remove('is-open');
      });
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('is-open');
      });
    }

    // EQ Preset buttons
    const presetBtns = document.querySelectorAll('.btn-eq-preset');
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        haptics.trigger('medium');
        presetBtns.forEach(b => {
          b.style.background = 'rgba(255,255,255,0.08)';
          b.style.borderColor = 'rgba(255,255,255,0.15)';
        });
        btn.style.background = 'var(--accent)';
        btn.style.borderColor = 'var(--accent)';

        const preset = btn.dataset.preset;
        audioController.setEqPreset(preset);
        if (labelPreset) {
          labelPreset.textContent = `${btn.textContent} Active`;
        }

        // Update slider values to reflect preset
        const eqState = audioController.getEqState();
        if (eqState && Array.isArray(eqState.gains)) {
          document.querySelectorAll('.eq-slider').forEach((slider, idx) => {
            if (eqState.gains[idx] !== undefined) {
              slider.value = eqState.gains[idx];
            }
          });
        }
      });
    });

    // Custom slider adjustments
    const sliders = document.querySelectorAll('.eq-slider');
    sliders.forEach(slider => {
      slider.addEventListener('input', (e) => {
        const band = parseInt(slider.dataset.band, 10);
        const gain = parseFloat(slider.value);
        audioController.setEqBand(band, gain);
        if (labelPreset) labelPreset.textContent = 'Custom Tuning';
      });
    });
  }

  // --- Feature 7: Listening Stats & History Modal ---
  initStatsHistoryModal() {
    const btnOpen = document.getElementById('btnOpenStatsHistory');
    const modal = document.getElementById('statsHistoryModal');
    const btnClose = document.getElementById('btnCloseStatsHistoryModal');
    const tabTop = document.getElementById('tabBtnTopItems');
    const tabHistory = document.getElementById('tabBtnRecentHistory');

    if (btnOpen && modal) {
      btnOpen.addEventListener('click', () => {
        haptics.trigger('medium');
        modal.classList.add('is-open');
        this.loadAndRenderStats();
      });
    }

    if (btnClose && modal) {
      btnClose.addEventListener('click', () => {
        haptics.trigger('light');
        modal.classList.remove('is-open');
      });
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('is-open');
      });
    }

    if (tabTop) {
      tabTop.addEventListener('click', () => {
        this.statsCurrentTab = 'top';
        tabTop.style.color = 'var(--accent)';
        if (tabHistory) tabHistory.style.color = 'var(--text-muted)';
        this.renderStatsTab();
      });
    }

    if (tabHistory) {
      tabHistory.addEventListener('click', () => {
        this.statsCurrentTab = 'history';
        tabHistory.style.color = 'var(--accent)';
        if (tabTop) tabTop.style.color = 'var(--text-muted)';
        this.renderHistoryTab();
      });
    }
  }

  async loadAndRenderStats() {
    let stats = null;
    let history = null;

    try {
      const [resStats, resHistory] = await Promise.allSettled([
        fetch(apiUrl('/api/music/stats')).then(r => r.json()),
        fetch(apiUrl('/api/music/history')).then(r => r.json())
      ]);

      if (resStats.status === 'fulfilled' && resStats.value.success) {
        stats = resStats.value.data;
      }
      if (resHistory.status === 'fulfilled' && resHistory.value.success) {
        history = resHistory.value.data;
      }
    } catch (e) {}

    // Fallback to local tracking in AudioController
    if (!stats) {
      stats = audioController.getLocalStats();
    }
    if (!history) {
      history = audioController.getLocalHistory();
    }

    this.cachedStats = stats;
    this.cachedHistory = history;

    // Update headline metrics
    const metricHours = document.getElementById('metricTotalHours');
    const metricWeek = document.getElementById('metricWeekMins');
    if (metricHours) metricHours.textContent = `${stats.totalHours || 0}h`;
    if (metricWeek) metricWeek.textContent = `${stats.minutesThisWeek || 0}m`;

    if (this.statsCurrentTab === 'top') {
      this.renderStatsTab();
    } else {
      this.renderHistoryTab();
    }
  }

  renderStatsTab() {
    const container = document.getElementById('statsModalContent');
    if (!container) return;

    const stats = this.cachedStats || audioController.getLocalStats();
    const topArtists = stats.topArtists || [];
    const topTracks = stats.topTracks || [];

    let html = `
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); font-weight:700;">Top Artists</div>
    `;

    if (topArtists.length === 0) {
      html += `<div style="padding:12px; font-size:13px; color:var(--text-dim); text-align:center;">Listen to songs to discover your top artists</div>`;
    } else {
      html += topArtists.slice(0, 5).map((a, i) => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.04); border-radius:12px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:12px; font-weight:800; color:var(--accent); width:16px;">${i + 1}</span>
            <span style="font-size:13px; font-weight:600; color:#fff;">${a.artist}</span>
          </div>
          <span style="font-size:12px; color:var(--text-muted);">${a.play_count || a.plays} plays</span>
        </div>
      `).join('');
    }

    html += `
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); font-weight:700; margin-top:10px;">Top Tracks</div>
    `;

    if (topTracks.length === 0) {
      html += `<div style="padding:12px; font-size:13px; color:var(--text-dim); text-align:center;">No track plays recorded yet</div>`;
    } else {
      html += topTracks.slice(0, 5).map((t, i) => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.04); border-radius:12px;">
          <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
            <span style="font-size:12px; font-weight:800; color:var(--accent-cyan); width:16px;">${i + 1}</span>
            <div style="overflow:hidden;">
              <div style="font-size:13px; font-weight:600; color:#fff; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${t.title}</div>
              <div style="font-size:11px; color:var(--text-dim);">${t.artist}</div>
            </div>
          </div>
          <span style="font-size:12px; color:var(--text-muted);">${t.play_count || t.plays} plays</span>
        </div>
      `).join('');
    }

    container.innerHTML = html;
  }

  renderHistoryTab() {
    const container = document.getElementById('statsModalContent');
    if (!container) return;

    const history = this.cachedHistory || audioController.getLocalHistory();

    if (history.length === 0) {
      container.innerHTML = `
        <div style="padding:40px 20px; font-size:13px; color:var(--text-muted); text-align:center;">
          No listening history recorded yet. Tracks played past 30 seconds appear here.
        </div>
      `;
      return;
    }

    container.innerHTML = history.slice(0, 25).map(item => `
      <div class="touch-spring" style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.04); border-radius:12px; cursor:pointer;" data-play-item='${JSON.stringify(item).replace(/'/g, "&apos;")}'>
        <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
          <img src="${item.cover_art}" style="width:36px; height:36px; border-radius:8px; object-fit:cover;" onerror="this.src='https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'">
          <div style="overflow:hidden;">
            <div style="font-size:13px; font-weight:600; color:#fff; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${item.title}</div>
            <div style="font-size:11px; color:var(--text-muted);">${item.artist}</div>
          </div>
        </div>
        <div style="font-size:11px; color:var(--accent); font-weight:600;">Play</div>
      </div>
    `).join('');

    container.querySelectorAll('[data-play-item]').forEach(el => {
      el.addEventListener('click', () => {
        const item = JSON.parse(el.getAttribute('data-play-item'));
        audioController.playSong(item);
        const modal = document.getElementById('statsHistoryModal');
        if (modal) modal.classList.remove('is-open');
      });
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
          if (data.data.playlist) {
            playlistController.playlists.unshift(data.data.playlist);
            playlistController.saveLocalPlaylists();
            playlistController.render();
          } else {
            playlistController.fetchPlaylists();
          }
          errorHandler.showToast(data.data.message || 'Playlist imported as new playlist');
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
