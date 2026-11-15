import { haptics } from '../middleware/hapticMiddleware.js';
import { errorHandler } from '../errors/clientErrorHandler.js';
import { apiUrl } from '../constants/api.js';

export const APP_VERSION = '1.9.9';

class UpdateController {
  constructor() {
    this.currentVersion = APP_VERSION;
    this.latestRelease = null;
    this.modal = null;
    this.isChecking = false;
  }

  init() {
    this.modal = document.getElementById('softwareUpdateModal');
    this.bindEvents();

    // Check for updates shortly after app launch without blocking UI or audio
    setTimeout(() => {
      this.checkForUpdates(false).catch(err => {
        console.warn('[UpdateController] Background check error:', err.message);
      });
    }, 2400);
  }

  bindEvents() {
    const profileUpdateBtn = document.getElementById('btnProfileUpdateOption');
    if (profileUpdateBtn) {
      profileUpdateBtn.addEventListener('click', () => {
        haptics.trigger('medium');
        this.checkForUpdates(true);
      });
    }

    const btnDownload = document.getElementById('btnModalDownload');
    const btnRemind = document.getElementById('btnModalRemind');
    const btnChangelog = document.getElementById('btnViewChangelog');

    if (btnDownload) {
      btnDownload.addEventListener('click', () => this.handleDownload());
    }

    if (btnRemind) {
      btnRemind.addEventListener('click', () => {
        haptics.trigger('light');
        this.snoozeUpdate();
        this.closeModal();
      });
    }

    if (btnChangelog) {
      btnChangelog.addEventListener('click', () => {
        if (this.latestRelease && this.latestRelease.releaseUrl) {
          window.open(this.latestRelease.releaseUrl, '_system');
        }
      });
    }

    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.closeModal();
      });
    }
  }

  async checkForUpdates(isManual = false) {
    if (this.isChecking) return;
    this.isChecking = true;

    if (isManual) {
      errorHandler.showToast('Checking for software updates...');
    }

    try {
      const res = await fetch(apiUrl(`/api/app/version?currentVersion=${encodeURIComponent(this.currentVersion)}`));
      if (!res.ok) throw new Error('Update check failed');

      const json = await res.json();
      if (!json.success || !json.data) throw new Error('Invalid version response');

      const data = json.data;
      this.latestRelease = data;

      this.updateProfileBadge(data);

      if (data.updateAvailable) {
        if (isManual) {
          this.openModal(data);
        } else {
          // Check if previously snoozed
          const snoozedUntil = parseInt(localStorage.getItem('musii_update_snooze') || '0', 10);
          if (Date.now() > snoozedUntil) {
            this.openModal(data);
          }
        }
      } else {
        if (isManual) {
          errorHandler.showToast(`MUSII is up to date (v${this.currentVersion})`);
        }
      }
    } catch (err) {
      if (isManual) {
        errorHandler.showToast(`Unable to check for updates: ${err.message}`);
      }
    } finally {
      this.isChecking = false;
    }
  }

  updateProfileBadge(data) {
    const badge = document.getElementById('tagProfileUpdateStatus');
    if (!badge) return;

    if (data.updateAvailable) {
      badge.textContent = `v${data.latestVersion} Available`;
      badge.style.background = 'rgba(245, 158, 11, 0.25)';
      badge.style.color = 'var(--accent-gold)';
      badge.style.boxShadow = '0 0 14px rgba(245, 158, 11, 0.35)';
    } else {
      badge.textContent = `v${this.currentVersion} Up to date`;
      badge.style.background = 'rgba(16, 185, 129, 0.18)';
      badge.style.color = '#10b981';
      badge.style.boxShadow = 'none';
    }
  }

  openModal(data) {
    if (!this.modal) return;

    const subtitleEl = document.querySelector('#softwareUpdateModal .update-dialog-header p');
    if (subtitleEl) {
      subtitleEl.textContent = `MUSII v${data.latestVersion} is available to download.`;
    }

    const versionBadgeEl = document.querySelector('#softwareUpdateModal .update-meta-block h4');
    if (versionBadgeEl) {
      versionBadgeEl.textContent = `Release v${data.latestVersion}`;
    }

    const notesEl = document.querySelector('#softwareUpdateModal .update-meta-block p');
    if (notesEl && data.releaseNotes) {
      // First 2 lines of notes
      const shortNotes = data.releaseNotes.split('\n').filter(Boolean).slice(0, 3).join(' ');
      notesEl.textContent = shortNotes || 'Performance improvements, account recovery, and background audio enhancements.';
    }

    haptics.trigger('medium');
    this.modal.classList.add('is-open');
  }

  closeModal() {
    if (this.modal) this.modal.classList.remove('is-open');
  }

  snoozeUpdate() {
    // Snooze update popup for 12 hours
    const snoozeTime = Date.now() + 12 * 60 * 60 * 1000;
    localStorage.setItem('musii_update_snooze', snoozeTime.toString());
  }

  handleDownload() {
    haptics.trigger('heavy');
    const downloadUrl = (this.latestRelease && this.latestRelease.downloadUrl)
      ? this.latestRelease.downloadUrl
      : `https://github.com/MuthamiM/musii-app/releases/latest`;

    errorHandler.showToast(`Downloading MUSII v${this.latestRelease?.latestVersion || 'latest'} APK...`);
    this.closeModal();

    // Trigger download
    try {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `musii-v${this.latestRelease?.latestVersion || 'app'}.apk`;
      link.target = '_system';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => document.body.removeChild(link), 100);
    } catch (e) {
      window.open(downloadUrl, '_system');
    }
  }
}

export const updateController = new UpdateController();

