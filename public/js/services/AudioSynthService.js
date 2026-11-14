/**
 * AudioSynthService - Neutralized so no ringing synth chords play
 */
export class AudioSynthService {
  constructor() {
    this.ctx = null;
  }

  ensureContext() {
    return null;
  }

  playTrack(track) {
    // Disabled - only real audio streams are played
  }

  stop() {
    // No-op
  }
}

export const audioSynth = new AudioSynthService();
