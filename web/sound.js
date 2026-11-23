// Turns language change into sound.
//
// Each language is one note of a C major pentatonic scale (C D E G A C), and
// each has its own timbre so you can follow one voice through the texture.
// The octave comes from geography: northern attendance areas sound higher.

const SCALE = [0, 2, 4, 7, 9, 12]; // semitones above C
const C4 = 261.63;

export class Sonifier {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  // Browsers only allow audio to start from a user gesture, so call this from
  // the play button's click handler.
  async start() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // voice: index of the language (0-5); octave: 3-6; velocity: 0-1;
  // when: AudioContext time in seconds.
  note(voice, octave, velocity, when) {
    if (!this.ctx || !this.enabled) return;
    const freq = C4 * 2 ** ((SCALE[voice] + 12 * (octave - 4)) / 12);
    // High notes carry more than low ones; even them out a little.
    const level = velocity * (octave >= 6 ? 0.55 : octave === 5 ? 0.8 : 1);
    VOICES[voice](this.ctx, this.master, freq, level, when);
  }
}

// Small helpers for building one-shot notes.
function envelope(ctx, when, peak, attack, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  return g;
}
function osc(ctx, type, freq, when, length) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, when);
  o.start(when);
  o.stop(when + length + 0.05);
  return o;
}
function lowpass(ctx, cutoff) {
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = cutoff;
  return f;
}

const VOICES = [
  // Spanish: plucked, guitar-like triangle
  (ctx, out, f, v, t) => {
    const g = envelope(ctx, t, v * 0.5, 0.005, 0.6);
    osc(ctx, "triangle", f, t, 0.62).connect(g).connect(out);
  },
  // Korean: soft bell (simple FM)
  (ctx, out, f, v, t) => {
    const g = envelope(ctx, t, v * 0.4, 0.004, 1.1);
    const carrier = osc(ctx, "sine", f, t, 1.12);
    const mod = osc(ctx, "sine", f * 3.5, t, 1.12);
    const depth = envelope(ctx, t, f * 1.2, 0.004, 0.5);
    mod.connect(depth).connect(carrier.frequency);
    carrier.connect(g).connect(out);
  },
  // Chinese: bright, short, filtered square
  (ctx, out, f, v, t) => {
    const g = envelope(ctx, t, v * 0.22, 0.004, 0.35);
    osc(ctx, "square", f, t, 0.36).connect(lowpass(ctx, 1600)).connect(g).connect(out);
  },
  // Vietnamese: long sine with a gentle vibrato
  (ctx, out, f, v, t) => {
    const g = envelope(ctx, t, v * 0.45, 0.04, 1.0);
    const o = osc(ctx, "sine", f, t, 1.05);
    const lfo = osc(ctx, "sine", 5.5, t, 1.05);
    const depth = ctx.createGain();
    depth.gain.value = f * 0.012;
    lfo.connect(depth).connect(o.frequency);
    o.connect(g).connect(out);
  },
  // Arabic: warm, reedy, filtered sawtooth
  (ctx, out, f, v, t) => {
    const g = envelope(ctx, t, v * 0.2, 0.02, 0.7);
    osc(ctx, "sawtooth", f, t, 0.72).connect(lowpass(ctx, 1000)).connect(g).connect(out);
  },
  // Tagalog: marimba-like, sine plus its octave, quick decay
  (ctx, out, f, v, t) => {
    const g = envelope(ctx, t, v * 0.45, 0.003, 0.3);
    osc(ctx, "sine", f, t, 0.32).connect(g);
    const g2 = envelope(ctx, t, v * 0.15, 0.003, 0.12);
    osc(ctx, "sine", f * 4, t, 0.14).connect(g2).connect(out);
    g.connect(out);
  },
];
