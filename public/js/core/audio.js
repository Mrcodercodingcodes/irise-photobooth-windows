/**
 * High-Fidelity Studio Acoustic & Haptics Synthesizer
 * Produces organic, physical camera acoustics (leaf shutter, wood/glass haptic taps,
 * rich Rhodes/marimba harmonics) using Web Audio API — 100% free of 8-bit chiptune beeps.
 */

class AudioSynthesizer {
  constructor() {
    this.ctx = null;
    this.isMuted = localStorage.getItem('irise_audio_muted') === 'true';
  }

  ensureContext() {
    if (this.isMuted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    localStorage.setItem('irise_audio_muted', String(this.isMuted));
    return this.isMuted;
  }

  /**
   * Tactile Studio UI Tap (Soft glass/wood haptic impulse)
   */
  playClick() {
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Soft filtered transient click
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, now);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.035);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.04);
    } catch (e) {}
  }

  /**
   * Countdown Metronome Tick (Organic studio woodblock / rim tap)
   */
  playCountdownTick() {
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Resonant studio woodblock / metronome impulse
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(680, now);
      filter.Q.setValueAtTime(3.5, now);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(720, now);
      osc.frequency.exponentialRampToValueAtTime(340, now + 0.045);

      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {}
  }

  /**
   * Final Shutter Charge Tone (Warm acoustic focus chime)
   */
  playCountdownFinal() {
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      [880, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(i === 0 ? 0.18 : 0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.2);
      });
    } catch (e) {}
  }

  /**
   * Realistic Mechanical Camera Leaf Shutter & Mirror Return
   * Two-phase physical sound: aperture blade click + resonant mirror slap
   */
  playShutter() {
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Phase 1: High-frequency blade click
      const bufferSize = ctx.sampleRate * 0.04;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.008));
      }

      const noise1 = ctx.createBufferSource();
      noise1.buffer = buffer;
      const filter1 = ctx.createBiquadFilter();
      filter1.type = 'bandpass';
      filter1.frequency.setValueAtTime(2400, now);
      filter1.Q.setValueAtTime(2.0, now);

      const gain1 = ctx.createGain();
      gain1.gain.setValueAtTime(0.45, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      noise1.connect(filter1);
      filter1.connect(gain1);
      gain1.connect(ctx.destination);
      noise1.start(now);

      // Phase 2: Mechanical mirror slap / shutter curtain thump (35ms delay)
      const slapTime = now + 0.035;
      const noise2 = ctx.createBufferSource();
      noise2.buffer = buffer;
      const filter2 = ctx.createBiquadFilter();
      filter2.type = 'lowpass';
      filter2.frequency.setValueAtTime(450, slapTime);

      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(0.35, slapTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, slapTime + 0.05);

      noise2.connect(filter2);
      filter2.connect(gain2);
      gain2.connect(ctx.destination);
      noise2.start(slapTime);

      // Sub acoustic body thud
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(140, slapTime);
      subOsc.frequency.exponentialRampToValueAtTime(45, slapTime + 0.06);
      subGain.gain.setValueAtTime(0.3, slapTime);
      subGain.gain.exponentialRampToValueAtTime(0.001, slapTime + 0.06);

      subOsc.connect(subGain);
      subGain.connect(ctx.destination);
      subOsc.start(slapTime);
      subOsc.stop(slapTime + 0.07);
    } catch (e) {}
  }

  /**
   * Organic Marimba / Rhodes Selection Chimes
   * Gentle, warm acoustic bell strikes (E4, G#4, B4, E5)
   */
  playSelect(step = 0) {
    const notes = [329.63, 415.30, 493.88, 659.25]; // E Major warm marimba notes
    const baseFreq = notes[Math.min(step, notes.length - 1)] || 329.63;

    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Fundamental warm sine
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);

      // Soft attack & organic acoustic decay
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.24, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

      // Warm harmonic overtone (3x fundamental, quiet)
      const overtone = ctx.createOscillator();
      const otGain = ctx.createGain();
      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(baseFreq * 2.75, now);
      otGain.gain.setValueAtTime(0.04, now);
      otGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      overtone.connect(otGain);
      otGain.connect(ctx.destination);

      osc.start(now);
      overtone.start(now);
      osc.stop(now + 0.4);
      overtone.stop(now + 0.15);
    } catch (e) {}
  }

  /**
   * Gentle Acoustic Deselect Tap
   */
  playDeselect() {
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.04);

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.045);
    } catch (e) {}
  }

  /**
   * Rich Ambient Chime Fanfare (Lush Rhodes chord with 1.2s resonant decay)
   */
  playSuccess() {
    try {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // E Major 9 chord: E4, G#4, B4, D#5, F#5
      const chord = [329.63, 415.30, 493.88, 622.25, 739.99];

      chord.forEach((freq, idx) => {
        const noteTime = now + idx * 0.05;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteTime);

        gain.gain.setValueAtTime(0.001, noteTime);
        gain.gain.linearRampToValueAtTime(0.15, noteTime + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.9);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(noteTime);
        osc.stop(noteTime + 0.95);
      });
    } catch (e) {}
  }
}

export const soundFx = new AudioSynthesizer();
