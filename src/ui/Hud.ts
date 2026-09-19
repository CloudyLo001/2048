import { type FinishName, isFinish } from '../systems/Finish';

export type Settings = {
  finish: FinishName;
  rubble: boolean;
  shake: boolean;
  sound: boolean;
};

export type HudHandlers = {
  onNew: () => void;
  onUndo: () => void;
  onSettings: (settings: Settings) => void;
  onResetBest: () => void;
  onKeepGoing: () => void;
};

const SETTINGS_KEY = 'rock2048.settings';
const BEST_KEY = 'rock2048.best';

function q<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing UI element: ${selector}`);
  return el;
}

export class Hud {
  private readonly score = q<HTMLElement>('#score-value');
  private readonly best = q<HTMLElement>('#best-value');
  private readonly status = q<HTMLElement>('#status-line');
  private readonly undoButton = q<HTMLButtonElement>('#undo-button');
  private readonly newButton = q<HTMLButtonElement>('#new-button');
  private readonly settingsButton = q<HTMLButtonElement>('#settings-button');
  private readonly panel = q<HTMLElement>('#settings-panel');
  private readonly overlay = q<HTMLElement>('#overlay');
  private readonly overlayTitle = q<HTMLElement>('#overlay-title');
  private readonly overlayText = q<HTMLElement>('#overlay-text');
  private readonly overlayPrimary = q<HTMLButtonElement>('#overlay-primary');
  private readonly overlaySecondary = q<HTMLButtonElement>('#overlay-secondary');
  private readonly rubbleToggle = q<HTMLInputElement>('#rubble-toggle');
  private readonly shakeToggle = q<HTMLInputElement>('#shake-toggle');
  private readonly soundToggle = q<HTMLInputElement>('#sound-toggle');
  private readonly resetBest = q<HTMLButtonElement>('#reset-best');
  private statusTimer = 0;
  private bestValue = 0;
  settings: Settings;

  constructor(private readonly handlers: HudHandlers) {
    this.settings = this.loadSettings();
    this.bestValue = this.loadBest();
    this.best.textContent = String(this.bestValue);
    this.applySettingsToControls();

    this.newButton.addEventListener('click', () => handlers.onNew());
    this.undoButton.addEventListener('click', () => handlers.onUndo());
    this.settingsButton.addEventListener('click', () => this.togglePanel());
    this.overlayPrimary.addEventListener('click', () => {
      this.hideOverlay();
      handlers.onNew();
    });
    this.overlaySecondary.addEventListener('click', () => {
      this.hideOverlay();
      handlers.onKeepGoing();
    });
    this.resetBest.addEventListener('click', () => {
      this.bestValue = 0;
      this.best.textContent = '0';
      try {
        localStorage.removeItem(BEST_KEY);
      } catch {
        /* storage unavailable */
      }
      handlers.onResetBest();
    });

    const finishInputs = this.panel.querySelectorAll<HTMLInputElement>('input[name="finish"]');
    finishInputs.forEach((input) =>
      input.addEventListener('change', () => {
        if (input.checked && isFinish(input.value)) this.commit({ finish: input.value });
      }),
    );
    this.rubbleToggle.addEventListener('change', () => this.commit({ rubble: this.rubbleToggle.checked }));
    this.shakeToggle.addEventListener('change', () => this.commit({ shake: this.shakeToggle.checked }));
    this.soundToggle.addEventListener('change', () => this.commit({ sound: this.soundToggle.checked }));

    document.addEventListener('pointerdown', (event) => {
      if (this.panel.hidden) return;
      const target = event.target as Node;
      if (!this.panel.contains(target) && !this.settingsButton.contains(target)) this.togglePanel(false);
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape' && !this.panel.hidden) this.togglePanel(false);
    });
  }

  private commit(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* storage unavailable */
    }
    this.handlers.onSettings(this.settings);
  }

  private loadSettings(): Settings {
    const fallback: Settings = { finish: 'natural', rubble: true, shake: true, sound: true };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return {
        finish: typeof parsed.finish === 'string' && isFinish(parsed.finish) ? parsed.finish : fallback.finish,
        rubble: parsed.rubble ?? fallback.rubble,
        shake: parsed.shake ?? fallback.shake,
        sound: parsed.sound ?? fallback.sound,
      };
    } catch {
      return fallback;
    }
  }

  private loadBest(): number {
    try {
      return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;
    } catch {
      return 0;
    }
  }

  private applySettingsToControls(): void {
    const input = this.panel.querySelector<HTMLInputElement>(`input[name="finish"][value="${this.settings.finish}"]`);
    if (input) input.checked = true;
    this.rubbleToggle.checked = this.settings.rubble;
    this.shakeToggle.checked = this.settings.shake;
    this.soundToggle.checked = this.settings.sound;
  }

  togglePanel(force?: boolean): void {
    const open = force ?? this.panel.hidden;
    this.panel.hidden = !open;
    this.settingsButton.setAttribute('aria-expanded', String(open));
  }

  setScore(score: number): void {
    this.score.textContent = String(score);
    if (score > this.bestValue) {
      this.bestValue = score;
      this.best.textContent = String(score);
      try {
        localStorage.setItem(BEST_KEY, String(score));
      } catch {
        /* storage unavailable */
      }
    }
  }

  bumpScore(): void {
    this.score.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
      { duration: 220, easing: 'ease-out' },
    );
  }

  setUndoEnabled(enabled: boolean): void {
    this.undoButton.disabled = !enabled;
  }

  setStatus(text: string, options: { error?: boolean; sticky?: boolean } = {}): void {
    window.clearTimeout(this.statusTimer);
    this.status.textContent = text;
    this.status.classList.toggle('error', Boolean(options.error));
    this.status.classList.remove('hidden');
    if (!options.sticky && !options.error) {
      this.statusTimer = window.setTimeout(() => this.status.classList.add('hidden'), 1800);
    }
  }

  hideStatus(): void {
    window.clearTimeout(this.statusTimer);
    this.status.classList.add('hidden');
  }

  showGameOver(score: number): void {
    this.overlayTitle.textContent = 'Game over';
    this.overlayText.textContent = `No more moves. Final score ${score}.`;
    this.overlayPrimary.textContent = 'Try again';
    this.overlaySecondary.hidden = true;
    this.overlay.hidden = false;
  }

  showWin(): void {
    this.overlayTitle.textContent = 'You made the crystal!';
    this.overlayText.textContent = 'The 2048 block is yours. Keep crushing for a higher score?';
    this.overlayPrimary.textContent = 'New game';
    this.overlaySecondary.hidden = false;
    this.overlay.hidden = false;
  }

  hideOverlay(): void {
    this.overlay.hidden = true;
  }

  isOverlayOpen(): boolean {
    return !this.overlay.hidden;
  }
}
