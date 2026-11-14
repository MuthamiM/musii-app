/**
 * Client Error Handling & Graceful Recovery
 */
class ClientErrorHandler {
  constructor() {
    this.toastEl = null;
    this.init();
  }

  init() {
    window.addEventListener('error', event => {
      console.warn('[BitChord Client Error Captured]:', event.message);
    });

    window.addEventListener('unhandledrejection', event => {
      console.warn('[BitChord Unhandled Promise Rejection]:', event.reason);
    });
  }

  showToast(message, duration = 3000) {
    let toast = document.getElementById('bitchordToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'bitchordToast';
      toast.style.cssText = `
        position: fixed;
        left: 50%;
        top: 24px;
        transform: translateX(-50%) translateY(-20px);
        background: rgba(30, 30, 38, 0.95);
        color: #fff;
        padding: 10px 18px;
        border-radius: 999px;
        border: 1px solid rgba(255, 71, 103, 0.4);
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 10px 30px rgba(0,0,0,0.8);
        z-index: 9999;
        opacity: 0;
        transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        pointer-events: none;
      `;
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-20px)';
    }, duration);
  }
}

export const errorHandler = new ClientErrorHandler();

