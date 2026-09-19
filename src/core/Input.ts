import type { Direction } from '../game/Board';

const KEYMAP: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

/** Keyboard + primary-pointer swipe input. Secondary buttons are left free for camera orbit. */
export class Input {
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private swiped = false;

  constructor(
    private readonly target: HTMLElement,
    private readonly onMove: (dir: Direction) => void,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('pointerdown', this.onPointerDown);
    target.addEventListener('pointermove', this.onPointerMove);
    target.addEventListener('pointerup', this.onPointerUp);
    target.addEventListener('pointercancel', this.onPointerUp);
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const dir = KEYMAP[event.code];
    if (!dir) return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    event.preventDefault();
    this.onMove(dir);
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startTime = performance.now();
    this.swiped = false;
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId || this.swiped) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    if (Math.hypot(dx, dy) < 28) return;
    this.swiped = true;
    this.onMove(this.direction(dx, dy));
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    if (!this.swiped) {
      const dx = event.clientX - this.startX;
      const dy = event.clientY - this.startY;
      const fast = performance.now() - this.startTime < 350;
      if (fast && Math.hypot(dx, dy) >= 14) this.onMove(this.direction(dx, dy));
    }
    this.pointerId = null;
  };

  private direction(dx: number, dy: number): Direction {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    this.target.removeEventListener('pointermove', this.onPointerMove);
    this.target.removeEventListener('pointerup', this.onPointerUp);
    this.target.removeEventListener('pointercancel', this.onPointerUp);
  }
}
