/**
 * HologramOS — synthesized UI sound engine.
 *
 * Every sound is generated with WebAudio oscillators/noise (no assets):
 * soft console blips, sweeps and chimes that make the OS feel physical.
 * The AudioContext is created/resumed on the gate's ENTER click (a real
 * user gesture) and every later call is a no-op if audio is unavailable.
 *
 * sound.enabled mirrors the Settings toggle — the OS never throws when
 * audio is missing (headless E2E, unsupported browsers).
 */

class HoloSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  /** Create + resume the context from a user gesture (gate ENTER). */
  init(): void {
    this.ensure();
    if (this.ctx?.state === "suspended") {
      this.ctx.resume().catch(() => undefined);
    }
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => undefined);
      return this.ctx;
    }
    try {
      const AC =
        (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** One oscillator sweep f0 → f1 over dur seconds. */
  private tone(
    f0: number,
    f1: number,
    dur: number,
    type: OscillatorType = "sine",
    gain = 0.5,
    delay = 0
  ): void {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(1, f0), t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch {
      /* audio is always best-effort */
    }
  }

  /** Gated noise burst (sparkle / whoosh texture). */
  private noise(dur: number, gain = 0.12, delay = 0): void {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime + delay;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2400;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(hp).connect(g).connect(this.master);
      src.start(t);
    } catch {
      /* best-effort */
    }
  }

  /* ---- named UI sounds ------------------------------------------- */

  /** boot spin-up: rising sweep + sparkle */
  boot(): void {
    this.tone(130, 780, 1.1, "sine", 0.4);
    this.tone(260, 1560, 1.1, "triangle", 0.12);
    this.noise(0.5, 0.06, 0.55);
  }

  /** app window opening */
  open(): void {
    this.tone(380, 1240, 0.22, "sine", 0.4);
    this.tone(760, 2480, 0.22, "triangle", 0.1, 0.02);
  }

  /** app window closing */
  close(): void {
    this.tone(1100, 420, 0.18, "sine", 0.35);
  }

  /** a target was activated (pinch release on a control) */
  click(): void {
    this.tone(1650, 990, 0.07, "sine", 0.4);
  }

  /** reticle moved onto a new target — barely audible tick */
  hover(): void {
    this.tone(2300, 2300, 0.025, "sine", 0.08);
  }

  /** holographic keyboard key */
  key(): void {
    this.tone(1350 + Math.random() * 250, 1150, 0.035, "sine", 0.3);
  }

  /** settings toggle */
  toggle(): void {
    this.tone(880, 1320, 0.06, "sine", 0.3);
    this.tone(1320, 1760, 0.06, "sine", 0.25, 0.07);
  }

  /** timer complete — small arpeggio chime */
  chime(): void {
    this.tone(1046.5, 1046.5, 0.34, "sine", 0.4);
    this.tone(1318.5, 1318.5, 0.34, "sine", 0.34, 0.11);
    this.tone(1568.0, 1568.0, 0.5, "sine", 0.34, 0.22);
  }

  /** invalid action / error */
  error(): void {
    this.tone(220, 180, 0.12, "square", 0.16);
  }

  /** sonics key — pitched by the app itself */
  note(freq: number, dur: number, type: OscillatorType, gain = 0.5): void {
    this.tone(freq, freq * 0.995, dur, type, gain);
    this.tone(freq * 2, freq * 1.99, dur * 0.6, "sine", gain * 0.18);
  }

  /* ---- suit fabricator -------------------------------------------- */

  /** armor piece flying in — rising doppler whir */
  whir(): void {
    this.tone(180, 640, 0.34, "sawtooth", 0.1);
    this.tone(360, 1280, 0.34, "sine", 0.14);
    this.noise(0.18, 0.05);
  }

  /** armor piece clamping on — the CLUNK: sub thud + metallic ping + ring */
  clamp(): void {
    this.tone(120, 58, 0.16, "sine", 0.55);
    this.tone(1900, 1350, 0.09, "triangle", 0.22);
    this.tone(2840, 2820, 0.3, "sine", 0.1, 0.02);
    this.noise(0.09, 0.16);
  }

  /** fabricator sequence start */
  deploy(): void {
    this.tone(240, 960, 0.5, "sine", 0.32);
    this.tone(480, 1920, 0.5, "triangle", 0.1, 0.03);
    this.noise(0.3, 0.05, 0.1);
  }

  /** suit disassembling — descending power-down */
  disarm(): void {
    this.tone(880, 140, 0.55, "sine", 0.3);
    this.tone(1760, 280, 0.5, "triangle", 0.08, 0.05);
  }

  /** repulsor charged burst — fire pulse from the palm */
  repulsor(): void {
    this.tone(420, 90, 0.28, "sawtooth", 0.28);
    this.tone(2400, 300, 0.22, "sine", 0.2);
    this.noise(0.22, 0.12);
  }
}

export const sound = new HoloSound();
