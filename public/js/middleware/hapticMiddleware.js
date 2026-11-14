/**
 * Cross-Platform Haptic Middleware (iPhone + Android + Desktop)
 */
class HapticMiddleware {
  constructor() {
    this.enabled = true;
    this.audioCtx = null;
  }

  setAudioContext(ctx) {
    this.audioCtx = ctx;
  }

  trigger(intensity = 'light') {
    if (!this.enabled) return;

    // 1. Android & Web Vibration API
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        if (intensity === 'heavy') navigator.vibrate([24, 30, 24]);
        else if (intensity === 'medium') navigator.vibrate(18);
        else navigator.vibrate(10);
      } catch (e) {}
    }

    // 2. Synthesized acoustic transient for iPhone & Desktop headphones
    if (this.audioCtx && this.audioCtx.state === 'running') {
      try {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'triangle';
        const freq = intensity === 'heavy' ? 440 : intensity === 'medium' ? 880 : 1320;
        osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
        gain.gain.setValueAtTime(0.025, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.02);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.022);
      } catch (e) {}
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
}

export const haptics = new HapticMiddleware();

