/** Procedural Web Audio feedback: stone slides, rock crunches, and a crystal chime. */
export class AudioSystem {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  enabled = true;

  constructor() {
    const unlock = () => {
      void this.unlock();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
  }

  async unlock(): Promise<void> {
    if (this.context) {
      if (this.context.state !== 'running') await this.context.resume();
      return;
    }
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.context.destination);
    const seconds = 1.5;
    const buffer = this.context.createBuffer(
      1,
      Math.floor(this.context.sampleRate * seconds),
      this.context.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    await this.context.resume();
  }

  private live(): { ctx: AudioContext; noise: AudioBuffer; master: GainNode } | null {
    if (!this.enabled || !this.context || this.context.state !== 'running' || !this.noise || !this.master) {
      return null;
    }
    return { ctx: this.context, noise: this.noise, master: this.master };
  }

  /** Short gritty scrape for a tile sliding. */
  slide(): void {
    const a = this.live();
    if (!a) return;
    const { ctx, noise, master } = a;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.3;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900 + Math.random() * 300, now);
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    src.connect(filter).connect(gain).connect(master);
    src.start(now, Math.random() * 0.8);
    src.stop(now + 0.15);
  }

  /** Rock impact: low thud plus crackly high-band debris. `tier` 1..11 scales weight. */
  crunch(tier: number): void {
    const a = this.live();
    if (!a) return;
    const { ctx, noise, master } = a;
    const now = ctx.currentTime;
    const weight = Math.min(1, 0.55 + tier * 0.05);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160 - tier * 6, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.35 * weight, now + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(og).connect(master);
    osc.start(now);
    osc.stop(now + 0.26);

    const crack = ctx.createBufferSource();
    crack.buffer = noise;
    crack.playbackRate.value = 1.2 + Math.random() * 0.4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1800, now);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, now);
    cg.gain.exponentialRampToValueAtTime(0.18 * weight, now + 0.006);
    cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    crack.connect(hp).connect(cg).connect(master);
    crack.start(now, Math.random() * 0.8);
    crack.stop(now + 0.14);

    const tail = ctx.createBufferSource();
    tail.buffer = noise;
    tail.playbackRate.value = 0.6;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(600, now);
    bp.Q.value = 0.6;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, now + 0.03);
    tg.gain.exponentialRampToValueAtTime(0.07 * weight, now + 0.06);
    tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    tail.connect(bp).connect(tg).connect(master);
    tail.start(now + 0.03, Math.random() * 0.6);
    tail.stop(now + 0.5);

    if (tier >= 9) this.chime(tier);
  }

  private chime(tier: number): void {
    const a = this.live();
    if (!a) return;
    const { ctx, master } = a;
    const now = ctx.currentTime;
    const base = tier >= 11 ? 880 : 660;
    [1, 1.5, 2].forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + i * 0.04);
      g.gain.exponentialRampToValueAtTime(0.08, now + i * 0.04 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7 + i * 0.1);
      osc.connect(g).connect(master);
      osc.start(now + i * 0.04);
      osc.stop(now + 0.9);
    });
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }
}
