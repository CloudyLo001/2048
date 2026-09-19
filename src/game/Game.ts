import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TileLibrary } from '../assets/TileLibrary';
import { Input } from '../core/Input';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { AudioSystem } from '../systems/AudioSystem';
import { BOARD_HALF, cellToWorld, createBoardMesh, POCKET_DEPTH, TILE, TRAY_RIM } from '../systems/BoardMesh';
import { FinishController } from '../systems/Finish';
import { LabelFactory } from '../systems/Labels';
import { RubbleSystem } from '../systems/Rubble';
import { ShakeRig } from '../systems/ShakeRig';
import { easeInQuad, easeOutBack, easeOutCubic, easeOutQuart, TweenManager, type TweenHandle } from '../systems/Tweens';
import { Hud, type Settings } from '../ui/Hud';
import { Board, type Cell, type Direction, type MoveResult } from './Board';

const SLIDE_TIME = 0.14;
const POP_TIME = 0.26;
const SPAWN_TIME = 0.22;
const RUBBLE_SIZE = 0.16;
const WIN_VALUE = 2048;
const MIN_DISTANCE = 4.5;
const MAX_DISTANCE = 30;

/**
 * Straight-down default view: the camera sits directly above the tray with -Z as screen up,
 * so the 4x4 grid reads as a square and "up" moves blocks toward the top of the screen.
 * Orbiting tilts away from that pose; it never passes it.
 */
const TOP_DOWN_UP = new THREE.Vector3(0, 0, -1);
const MAX_TILT = 0.85;
const MAX_SWING = 0.45;

type TileView = {
  id: number;
  value: number;
  group: THREE.Group;
  /** Height of the block model, used to place the glow above its top face. */
  height: number;
  /** Position/scale tweens owned by this view, cancelled when a new move takes over. */
  motions: TweenHandle[];
};

function tier(value: number): number {
  return Math.max(1, Math.round(Math.log2(value)));
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
  private readonly controls: OrbitControls;
  private readonly loop: Loop;
  private readonly tweens = new TweenManager();
  private readonly shake = new ShakeRig();
  private readonly audio = new AudioSystem();
  private readonly finish = new FinishController();
  private readonly labels = new LabelFactory();
  private readonly library = new TileLibrary(TILE, RUBBLE_SIZE, this.finish);
  private readonly rubble = new RubbleSystem(this.library);
  private readonly board = new Board();
  private readonly tileRoot = new THREE.Group();
  private readonly views = new Map<number, TileView>();
  private readonly hud: Hud;
  private readonly input: Input;
  private readonly pmrem: THREE.PMREMGenerator;
  /** Camera position written by OrbitControls, before shake is added for rendering. */
  private readonly steadyCamera = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private ready = false;
  private busy = false;
  private queued: Direction | null = null;
  private wonShown = false;
  private keepPlaying = false;
  private gameOver = false;
  private boardReady: Promise<void>;
  /** Bumped by New game and Undo so animations from an abandoned move cannot write state. */
  private generation = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.setClearColor(0x000000, 0);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.9;

    this.hud = new Hud({
      onNew: () => this.newGame(),
      onUndo: () => this.undo(),
      onSettings: (s) => this.applySettings(s),
      onResetBest: () => this.hud.setStatus('Best score cleared'),
      onKeepGoing: () => this.keepGoing(),
    });

    this.buildLighting();
    const boardMesh = createBoardMesh();
    this.scene.add(boardMesh.mesh);
    this.boardReady = boardMesh.ready;
    this.scene.add(this.tileRoot);
    this.scene.add(this.rubble.group);

    this.camera.up.copy(TOP_DOWN_UP);
    this.camera.position.set(0, 10, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableZoom = true;
    this.controls.minDistance = MIN_DISTANCE;
    this.controls.maxDistance = MAX_DISTANCE;
    // With camera.up = -Z, straight down is a polar angle of PI/2; larger tilts toward the player.
    this.controls.minPolarAngle = Math.PI / 2;
    this.controls.maxPolarAngle = Math.PI / 2 + MAX_TILT;
    this.controls.minAzimuthAngle = -MAX_SWING;
    this.controls.maxAzimuthAngle = MAX_SWING;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // Left button and one-finger touch belong to swipes; orbit uses the right button / two fingers.
    this.controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.input = new Input(canvas, (dir) => this.requestMove(dir));
    this.loop = new Loop(this.update, this.render);
    this.applySettings(this.hud.settings);
    this.frameCamera();
    this.steadyCamera.copy(this.camera.position);
    this.installTestHooks();
  }

  start(): void {
    this.loop.start();
    void this.loadAssets();
  }

  private async loadAssets(): Promise<void> {
    this.hud.setStatus('Loading stone blocks… 0%', { sticky: true });
    try {
      await this.library.load((loaded, total) => {
        this.hud.setStatus(`Loading stone blocks… ${Math.round((loaded / total) * 100)}%`, { sticky: true });
      });
      await this.boardReady;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.hud.setStatus(`Could not load block models: ${message}`, { error: true });
      console.error(error);
      return;
    }
    this.rubble.init(-POCKET_DEPTH, BOARD_HALF + TRAY_RIM);
    this.ready = true;
    this.hud.setStatus('Swipe or use arrow keys');
    this.newGame();
  }

  private buildLighting(): void {
    const hemi = new THREE.HemisphereLight(0xfff6e6, 0xb9a88d, 0.55);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
    key.position.set(4.5, 8, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 24;
    const extent = BOARD_HALF + 1.2;
    key.shadow.camera.left = -extent;
    key.shadow.camera.right = extent;
    key.shadow.camera.top = extent;
    key.shadow.camera.bottom = -extent;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xd8e6ff, 0.6);
    fill.position.set(-5, 4, -3);
    this.scene.add(fill);
  }

  /**
   * Fit the tray into the band between the header and the status line, and keep whatever
   * angle the player orbited to. Distances are derived for the straight-down pose, where
   * screen up is -Z, so a board sitting below the viewport centre needs a -Z target shift.
   */
  private frameCamera(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const aspect = width / height;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const half = BOARD_HALF + TRAY_RIM;

    // Screen space the HUD and status line occupy, capped so small viewports stay usable.
    const topInset = Math.min(height * 0.3, width < 600 ? 150 : 176);
    const bottomInset = Math.min(height * 0.16, 72);
    const bandFraction = Math.max(0.35, (height - topInset - bottomInset) / height);

    const byHeight = half / (Math.tan(vFov / 2) * bandFraction * 0.94);
    const byWidth = half / (Math.tan(hFov / 2) * 0.92);
    const distance = THREE.MathUtils.clamp(Math.max(byHeight, byWidth), MIN_DISTANCE, MAX_DISTANCE);

    // Centre the board in the visible band rather than in the whole viewport.
    const worldPerPixel = (2 * distance * Math.tan(vFov / 2)) / height;
    const bandCentre = topInset + (height - topInset - bottomInset) / 2;
    this.controls.target.set(0, 0, -(bandCentre - height / 2) * worldPerPixel);

    const offset = this.tmpA.copy(this.camera.position).sub(this.controls.target);
    if (offset.lengthSq() < 1e-8) offset.set(0, 1, 0);
    offset.setLength(distance);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.steadyCamera.copy(this.camera.position);
  }

  private applySettings(s: Settings): void {
    this.finish.apply(s.finish);
    this.rubble.enabled = s.rubble;
    this.shake.enabled = s.shake;
    this.audio.enabled = s.sound;
  }

  // ---------------------------------------------------------------- game flow

  private newGame(): void {
    if (!this.ready) return;
    this.resetPresentation();
    const spawns = this.board.newGame();
    spawns.forEach((s, i) => this.spawnView(s.id, s.value, s.at, 0.05 * i));
    this.hud.setScore(this.board.score);
    this.hud.setUndoEnabled(false);
  }

  /** Drop every in-flight animation and overlay so a fresh position can be shown. */
  private resetPresentation(): void {
    this.generation += 1;
    this.tweens.clear();
    this.rubble.clear();
    this.clearViews();
    this.busy = false;
    this.queued = null;
    this.gameOver = false;
    this.hud.hideOverlay();
  }

  private undo(): void {
    if (!this.ready || this.busy || !this.board.canUndo()) return;
    this.board.undo();
    this.resetPresentation();
    this.rebuildViews();
    this.hud.setScore(this.board.score);
    this.hud.setUndoEnabled(this.board.canUndo());
    this.hud.setStatus('Undid last move');
  }

  private keepGoing(): void {
    this.keepPlaying = true;
    // A win can coincide with a full board, so re-check before handing control back.
    if (!this.board.hasMoves()) {
      this.gameOver = true;
      this.hud.showGameOver(this.board.score);
    }
  }

  private requestMove(dir: Direction): void {
    if (!this.ready || this.gameOver || this.hud.isOverlayOpen()) return;
    if (this.busy) {
      this.queued = dir;
      return;
    }
    void this.performMove(dir);
  }

  private async performMove(dir: Direction): Promise<void> {
    // Snap any tile still animating from the previous move to its real cell first, so a
    // stale spawn or nudge tween can never drag it back after this move starts.
    this.settleViews();

    const result = this.board.move(dir);
    if (!result.moved) {
      this.nudge(dir);
      // A blocked move on a stuck board is also the end of the game.
      if (!this.board.hasMoves()) {
        this.gameOver = true;
        this.hud.showGameOver(this.board.score);
      }
      return;
    }
    const gen = this.generation;
    this.busy = true;
    this.hud.setUndoEnabled(false);
    await this.animateMove(result, dir, gen);
    if (gen !== this.generation) return;

    this.hud.setScore(this.board.score);
    if (result.scoreGained > 0) this.hud.bumpScore();
    this.hud.setUndoEnabled(this.board.canUndo());
    this.busy = false;

    if (!this.wonShown && !this.keepPlaying && this.board.highest() >= WIN_VALUE) {
      this.wonShown = true;
      this.queued = null;
      this.hud.showWin();
      return;
    }
    if (!this.board.hasMoves()) {
      this.gameOver = true;
      this.queued = null;
      this.hud.showGameOver(this.board.score);
      return;
    }
    const next = this.queued;
    this.queued = null;
    if (next) void this.performMove(next);
  }

  /** Slide every moved tile, then resolve merges with a rock-smash burst and spawn the new tile. */
  private animateMove(result: MoveResult, dir: Direction, gen: number): Promise<void> {
    return new Promise((resolve) => {
      const dirVec = this.directionVector(dir);
      let slides = 0;
      for (const m of result.moves) {
        const view = this.views.get(m.id);
        if (!view) continue;
        const from = cellToWorld(m.from.r, m.from.c, new THREE.Vector3());
        const to = cellToWorld(m.to.r, m.to.c, new THREE.Vector3());
        const distance = Math.abs(m.to.r - m.from.r) + Math.abs(m.to.c - m.from.c);
        const duration = SLIDE_TIME * (0.6 + (0.4 * Math.min(distance, 3)) / 3);
        slides += 1;
        this.addMotion(
          view,
          this.tweens.tween(
            duration,
            (k) => {
              view.group.position.lerpVectors(from, to, k);
              // Slight forward lean while moving, like a heavy block being shoved.
              const lean = Math.sin(k * Math.PI) * 0.12;
              view.group.rotation.set(dirVec.z * lean, 0, -dirVec.x * lean);
            },
            easeOutCubic,
            () => {
              view.group.position.copy(to);
              view.group.rotation.set(0, 0, 0);
            },
          ),
        );
      }
      if (result.moves.length > 0) this.audio.slide();

      const afterSlide = () => {
        if (gen !== this.generation) {
          resolve();
          return;
        }
        for (const merge of result.merges) this.resolveMerge(merge.id, merge.consumed, merge.value, merge.at, dirVec);
        if (result.spawn) this.spawnView(result.spawn.id, result.spawn.value, result.spawn.at, 0.04);
        // Release input right after the slide so play stays snappy; pops and rubble keep running.
        resolve();
      };
      if (slides === 0) afterSlide();
      else this.tweens.tween(SLIDE_TIME, () => {}, easeOutCubic, afterSlide);
    });
  }

  private resolveMerge(
    survivorId: number,
    consumed: [number, number],
    value: number,
    at: Cell,
    dirVec: THREE.Vector3,
  ): void {
    for (const id of consumed) this.removeView(id);
    const view = this.createView(survivorId, value);
    const center = cellToWorld(at.r, at.c, view.group.position);
    const t = tier(value);

    // Impact: squash in the travel axis, then overshoot back to 1.
    view.group.scale.set(1.18, 0.78, 1.18);
    this.addMotion(
      view,
      this.tweens.tween(
        POP_TIME,
        (k) => {
          const s = 1 + (easeOutBack(k) - 1) * 0.35;
          view.group.scale.set(1.18 + (s - 1.18) * k, 0.78 + (s - 0.78) * k, 1.18 + (s - 1.18) * k);
        },
        (k) => k,
        () => view.group.scale.setScalar(1),
      ),
    );

    this.rubble.burst(this.tmpA.copy(center).setY(-POCKET_DEPTH + 0.15), dirVec, t);
    this.shake.addTrauma(0.18 + t * 0.035);
    this.audio.crunch(t);
    if (value >= 512) this.flash(view, value);
  }

  /** Brief glow above a high-tier merge; the generated block materials are never touched. */
  private flash(view: TileView, value: number): void {
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE * 2.1, TILE * 2.1),
      new THREE.MeshBasicMaterial({
        color: value >= 2048 ? 0x9df3ff : 0xffd27a,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = view.height + 0.04;
    glow.renderOrder = 3;
    view.group.add(glow);
    this.tweens.tween(
      0.5,
      (k) => {
        (glow.material as THREE.MeshBasicMaterial).opacity = 0.65 * (1 - k);
        glow.scale.setScalar(1 + k * 0.8);
      },
      easeOutQuart,
      () => {
        view.group.remove(glow);
        glow.geometry.dispose();
        (glow.material as THREE.MeshBasicMaterial).dispose();
      },
    );
  }

  private spawnView(id: number, value: number, at: Cell, delay: number): void {
    const view = this.createView(id, value);
    const target = cellToWorld(at.r, at.c, new THREE.Vector3());
    view.group.position.copy(target).add(this.tmpB.set(0, 0.9, 0));
    view.group.scale.setScalar(0.001);
    this.addMotion(
      view,
      this.tweens.tween(
        SPAWN_TIME,
        (k) => {
          view.group.scale.setScalar(Math.max(0.001, easeOutBack(k)));
          view.group.position.y = target.y + 0.9 * (1 - easeInQuad(k));
        },
        (k) => k,
        () => {
          view.group.scale.setScalar(1);
          view.group.position.copy(target);
          // Landing thump: a tiny volume-preserving squash.
          this.addMotion(
            view,
            this.tweens.tween(
              0.16,
              (k) => {
                const s = 1 - Math.sin(k * Math.PI) * 0.08;
                view.group.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
              },
              (k) => k,
              () => view.group.scale.setScalar(1),
            ),
          );
        },
        delay,
      ),
    );
  }

  /** Small shove against the wall when a move does nothing. */
  private nudge(dir: Direction): void {
    const d = this.directionVector(dir).multiplyScalar(0.07);
    for (const view of this.views.values()) {
      const base = view.group.position.clone();
      this.addMotion(
        view,
        this.tweens.tween(
          0.16,
          (k) => {
            const w = Math.sin(k * Math.PI);
            view.group.position.set(base.x + d.x * w, base.y, base.z + d.z * w);
          },
          (k) => k,
          () => view.group.position.copy(base),
        ),
      );
    }
  }

  private directionVector(dir: Direction): THREE.Vector3 {
    switch (dir) {
      case 'up':
        return new THREE.Vector3(0, 0, -1);
      case 'down':
        return new THREE.Vector3(0, 0, 1);
      case 'left':
        return new THREE.Vector3(-1, 0, 0);
      case 'right':
        return new THREE.Vector3(1, 0, 0);
    }
  }

  // ---------------------------------------------------------------- views

  private addMotion(view: TileView, handle: TweenHandle): void {
    view.motions.push(handle);
  }

  private cancelMotions(view: TileView): void {
    for (const handle of view.motions) handle.cancel();
    view.motions.length = 0;
  }

  /**
   * Put every live tile exactly on its board cell and drop its pending motion tweens.
   * Without this, an animation still running from the previous move keeps writing the
   * group transform and snaps the tile back when it completes.
   */
  private settleViews(): void {
    for (const tile of this.board.tiles()) {
      const view = this.views.get(tile.id);
      if (!view) continue;
      this.cancelMotions(view);
      cellToWorld(tile.r, tile.c, view.group.position);
      view.group.scale.setScalar(1);
      view.group.rotation.set(0, 0, 0);
    }
  }

  /** Rebuild all tile objects from the current board, with no animation. */
  private rebuildViews(): void {
    this.clearViews();
    for (const tile of this.board.tiles()) {
      const view = this.createView(tile.id, tile.value);
      cellToWorld(tile.r, tile.c, view.group.position);
      view.group.scale.setScalar(1);
    }
  }

  private createView(id: number, value: number): TileView {
    this.removeView(id);
    const template = this.library.template(value);
    const model = this.library.cloneTile(value);
    const label = this.labels.create(value, TILE * 0.72, template.height + 0.012);
    const group = new THREE.Group();
    group.add(model);
    group.add(label);
    this.tileRoot.add(group);
    const view: TileView = { id, value, group, height: template.height, motions: [] };
    this.views.set(id, view);
    return view;
  }

  private removeView(id: number): void {
    const view = this.views.get(id);
    if (!view) return;
    this.cancelMotions(view);
    this.tileRoot.remove(view.group);
    this.views.delete(id);
  }

  private clearViews(): void {
    for (const id of [...this.views.keys()]) this.removeView(id);
  }

  // ---------------------------------------------------------------- diagnostics

  /** Tiles whose object is missing or not sitting on its board cell. Only meaningful when idle. */
  private misplacedCount(): number {
    const tiles = this.board.tiles();
    let misplaced = Math.abs(this.views.size - tiles.length);
    for (const tile of tiles) {
      const view = this.views.get(tile.id);
      if (!view) {
        misplaced += 1;
        continue;
      }
      cellToWorld(tile.r, tile.c, this.tmpB);
      if (view.group.position.distanceTo(this.tmpB) > 0.02) misplaced += 1;
    }
    return misplaced;
  }

  private installTestHooks(): void {
    if (!import.meta.env.DEV) return;
    window.__ROCK2048_TEST__ = {
      load: (matrix: number[][], score = 0) => {
        this.resetPresentation();
        this.wonShown = false;
        this.keepPlaying = false;
        this.board.load(matrix, score);
        this.rebuildViews();
        this.hud.setScore(this.board.score);
        this.hud.setUndoEnabled(false);
      },
      move: (dir: Direction) => this.requestMove(dir),
      // Advance animation time without waiting on requestAnimationFrame, so automated QA
      // can drive the exact timing of a follow-up move.
      step: (seconds: number, stepMs = 16) => {
        const delta = stepMs / 1000;
        const steps = Math.max(1, Math.round(seconds / delta));
        for (let i = 0; i < steps; i += 1) {
          this.tweens.update(delta);
          this.rubble.update(delta);
        }
      },
      state: () => ({
        matrix: this.board.toMatrix(),
        score: this.board.score,
        busy: this.busy,
        animating: this.tweens.active > 0,
        gameOver: this.gameOver,
        overlay: this.hud.isOverlayOpen(),
        misplaced: this.misplacedCount(),
      }),
    };
  }

  // ---------------------------------------------------------------- loop

  private frame = 0;

  private readonly update = (delta: number): void => {
    if (resizeRenderer(this.renderer, this.camera)) this.frameCamera();
    this.tweens.update(delta);
    this.rubble.update(delta);
    // Undo last frame's shake before OrbitControls reads the camera, or the offset would be
    // folded into the orbit state and the view would drift after every merge.
    this.camera.position.copy(this.steadyCamera);
    this.controls.update();
    this.steadyCamera.copy(this.camera.position);
    this.shake.update(delta, this.camera);
  };

  private readonly render = (): void => {
    this.renderer.render(this.scene, this.camera);
    this.frame += 1;
    const info = this.renderer.info;
    const idle = !this.busy && this.tweens.active === 0;
    window.__ROCK2048__ = {
      frame: this.frame,
      ready: this.ready,
      score: this.board.score,
      highest: this.board.highest(),
      busy: this.busy,
      animating: this.tweens.active > 0,
      tiles: this.views.size,
      boardTiles: this.board.tiles().length,
      misplaced: idle ? this.misplacedCount() : 0,
      gameOver: this.gameOver,
      overlay: this.hud.isOverlayOpen(),
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
    };
  };

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.controls.dispose();
    this.audio.dispose();
    this.rubble.dispose();
    this.labels.dispose();
    this.library.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}
