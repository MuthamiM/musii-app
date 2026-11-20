import { haptics } from '../middleware/hapticMiddleware.js';

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

    const sheetGrabber = document.getElementById('sheetGrabber');
    if (sheetGrabber) {
      sheetGrabber.addEventListener('click', () => this.closePlayerSheet());
    }

    const sheetGrabberLyrics = document.querySelector('.lv-grabber');
    if (sheetGrabberLyrics) {
      sheetGrabberLyrics.addEventListener('click', () => this.closePlayerSheet());
    }

    const sheetGrabberQueue = document.getElementById('sheetGrabberQueue');
    if (sheetGrabberQueue) {
      sheetGrabberQueue.addEventListener('click', () => this.closePlayerSheet());
    }

    const miniPlayer = document.getElementById('floatingMiniPlayer');
    if (miniPlayer) {
      miniPlayer.addEventListener('click', e => {
        if (e.target.closest('#btnMiniPlayPause') || e.target.closest('#btnMiniNext')) return;
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
      if (mode === 'queue' && window.updateMusiiQueueUI) {
        window.updateMusiiQueueUI();
      }
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

  openQueueModal() {
    this.openPlayerSheet('queue');
  }

  closeQueueModal() {
    if (this.playerSheet && this.playerSheet.dataset.mode === 'queue') {
      this.playerSheet.dataset.mode = 'art';
    }
  }
}

export const modalController = new ModalController();
