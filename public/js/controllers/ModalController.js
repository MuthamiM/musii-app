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
    this.systemToast = document.getElementById('systemToastPill');

    if (this.systemToast) {
      this.systemToast.addEventListener('click', () => {
        haptics.trigger('light');
        this.systemToast.classList.add('dismissed');
      });
    }

    const btnCloseSheet = document.getElementById('btnClosePlayerSheet');
    if (btnCloseSheet) {
      btnCloseSheet.addEventListener('click', () => this.closePlayerSheet());
    }

    const miniPlayer = document.getElementById('floatingMiniPlayer');
    if (miniPlayer) {
      miniPlayer.addEventListener('click', e => {
        if (e.target.closest('#btnMiniPlayPause')) return;
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

  openPlayerSheet() {
    haptics.trigger('medium');
    if (this.playerSheet) this.playerSheet.classList.add('is-open');
  }

  closePlayerSheet() {
    haptics.trigger('light');
    if (this.playerSheet) this.playerSheet.classList.remove('is-open');
  }
}

export const modalController = new ModalController();
