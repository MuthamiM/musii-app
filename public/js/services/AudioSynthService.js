/**
 * Real Web Audio API Generative Music Synthesizer
 * Produces real melodic lo-fi / chill ambient chords with zero external MP3 dependencies
 */
import { haptics } from '../middleware/hapticMiddleware.js';

class AudioSynthService {
  constructor() {
    this.ctx = null;
    this.nodes = null;
    this.cycleTimer = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
      haptics.setAudioContext(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  playTrack(track) {
    const ctx = this.ensureContext();
    this.stop();

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.01, now);
    masterGain.gain.exponentialRampToValueAtTime(0.2, now + 1.2);
    masterGain.connect(ctx.destination);

    // Warm vinyl lowpass filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(780, now);
    filter.Q.setValueAtTime(2.2, now);
    filter.connect(masterGain);

    const baseF = track.rootFreq || 220;
    const chordSequences = [
      [baseF, baseF * 1.25, baseF * 1.5],          // Root Major
      [baseF * 0.89, baseF * 1.12, baseF * 1.33],  // 4th Subdominant
      [baseF * 0.75, baseF * 0.94, baseF * 1.12],  // Minor Relative
      [baseF * 1.33, baseF * 1.66, baseF * 2.0]   // High harmonic
    ];

    const oscs = [ctx.createOscillator(), ctx.createOscillator(), ctx.createOscillator()];
    oscs.forEach((osc, i) => {
      osc.type = i === 1 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(chordSequences[0][i], now);
      osc.connect(filter);
      osc.start();
    });

    // Ambient LFO swell
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.setValueAtTime(0.35, now);
    lfoGain.gain.setValueAtTime(120, now);
    lfo.connect(filter.frequency);
    lfo.start();

    let step = 0;
    this.cycleTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      step = (step + 1) % chordSequences.length;
      const c = chordSequences[step];
      const ct = this.ctx.currentTime;
      oscs[0].frequency.setTargetAtTime(c[0], ct, 0.4);
      oscs[1].frequency.setTargetAtTime(c[1], ct, 0.4);
      oscs[2].frequency.setTargetAtTime(c[2], ct, 0.4);
    }, 4200);

    this.nodes = { oscs, lfo, masterGain };
  }

  stop() {
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
    if (this.nodes && this.ctx) {
      try {
        const ct = this.ctx.currentTime;
        this.nodes.masterGain.gain.setValueAtTime(this.nodes.masterGain.gain.value, ct);
        this.nodes.masterGain.gain.exponentialRampToValueAtTime(0.0001, ct + 0.25);
        setTimeout(() => {
          if (this.nodes) {
            this.nodes.oscs.forEach(o => { try { o.stop(); o.disconnect(); } catch(e){} });
            try { this.nodes.lfo.stop(); this.nodes.lfo.disconnect(); } catch(e){}
            this.nodes = null;
          }
        }, 300);
      } catch (e) {
        this.nodes = null;
      }
    }
  }
}

export const audioSynth = new AudioSynthService();

