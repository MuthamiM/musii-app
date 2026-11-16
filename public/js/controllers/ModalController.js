import { haptics } from '../middleware/hapticMiddleware.js';
import { errorHandler } from '../errors/clientErrorHandler.js';

class ModalController {
  constructor() {
    this.updateModal = null;
    this.playerSheet = null;
    this.systemToast = null;
  }

  init() {
    this.updateModal = document.getElementById('softwareUpdateModal');
    this.playerSheet = document.getElementById('fullscreenPlayerSheet');

    const btnCloseSheet = document.getElementById('btnClosePlayerSheet');
    if (btnCloseSheet) {
      btnCloseSheet.addEventListener('click', () => this.closePlayerSheet());
    }

    const miniPlayer = document.getElementById('floatingMiniPlayer');
    if (miniPlayer) {
      miniPlayer.addEventListener('click', e => {
        if (e.target.closest('#btnMiniPlayPause') || e.target.closest('#btnMiniLyrics')) return;
        this.openPlayerSheet();
      });
    }
  }

  openUpdateModal() {
    haptics.trigger('medium');
    if (this.updateModal) this.updateModal.classList.add('is-open');
  }

  closeUpdateModal() {
    if (this.updateModal) this.updateModal.classList.remove('is-open');
  }

  openPlayerSheet(mode = 'art') {
    haptics.trigger('medium');
    if (this.playerSheet) {
      this.playerSheet.classList.add('is-open');
      this.playerSheet.dataset.mode = mode;
      const lbtn = document.getElementById('btnToggleLyricsMode');
      if (lbtn) lbtn.setAttribute('aria-pressed', String(mode === 'lyrics'));
    }
  }

  closePlayerSheet() {
    haptics.trigger('light');
    if (this.playerSheet) {
      this.playerSheet.classList.remove('is-open');
      this.playerSheet.dataset.mode = 'art';
      const lbtn = document.getElementById('btnToggleLyricsMode');
      if (lbtn) lbtn.setAttribute('aria-pressed', 'false');
    }
  }
}

export const modalController = new ModalController();
