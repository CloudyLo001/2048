export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const easeInQuad: Easing = (t) => t * t;
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutQuart: Easing = (t) => 1 - Math.pow(1 - t, 4);
export const easeOutBack: Easing = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInBack: Easing = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return c3 * t * t * t - c1 * t * t;
};

interface ActiveTween {
  elapsed: number;
  delay: number;
  duration: number;
  easing: Easing;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
  cancelled: boolean;
}

export type TweenHandle = { cancel: () => void };

export class TweenManager {
  private tweens: ActiveTween[] = [];

  tween(
    durationSec: number,
    onUpdate: (value: number) => void,
    easing: Easing = easeOutCubic,
    onComplete?: () => void,
    delaySec = 0,
  ): TweenHandle {
    const t: ActiveTween = {
      elapsed: 0,
      delay: delaySec,
      duration: Math.max(durationSec, 1e-4),
      easing,
      onUpdate,
      onComplete,
      cancelled: false,
    };
    this.tweens.push(t);
    return {
      cancel: () => {
        t.cancelled = true;
      },
    };
  }

  /** Resolve after `sec` seconds of tween time. */
  wait(sec: number): Promise<void> {
    return new Promise((resolve) => this.tween(sec, () => {}, linear, resolve));
  }

  get active(): number {
    return this.tweens.length;
  }

  clear(): void {
    this.tweens = [];
  }

  update(delta: number): void {
    for (let i = this.tweens.length - 1; i >= 0; i -= 1) {
      const t = this.tweens[i];
      if (t.cancelled) {
        this.tweens.splice(i, 1);
        continue;
      }
      if (t.delay > 0) {
        t.delay -= delta;
        if (t.delay > 0) continue;
        t.elapsed += -t.delay;
        t.delay = 0;
      } else {
        t.elapsed += delta;
      }
      const k = Math.min(t.elapsed / t.duration, 1);
      t.onUpdate(t.easing(k));
      if (t.elapsed >= t.duration) {
        this.tweens.splice(i, 1);
        t.onComplete?.();
      }
    }
  }
}
