export const SIZE = 4;

export type Cell = { r: number; c: number };
export type Direction = 'up' | 'down' | 'left' | 'right';

export type TileMove = {
  id: number;
  from: Cell;
  to: Cell;
  value: number;
  /** True when this tile disappears into a merge at `to`. */
  merged: boolean;
};

export type MergeEvent = {
  at: Cell;
  value: number;
  /** id of the surviving tile */
  id: number;
  consumed: [number, number];
};

export type SpawnEvent = { id: number; at: Cell; value: number };

export type MoveResult = {
  moved: boolean;
  moves: TileMove[];
  merges: MergeEvent[];
  spawn: SpawnEvent | null;
  scoreGained: number;
};

export type Tile = { id: number; value: number; r: number; c: number };

export type Snapshot = { tiles: Tile[]; score: number; nextId: number };

export type Rng = () => number;

const DIRS: Record<Direction, Cell> = {
  up: { r: -1, c: 0 },
  down: { r: 1, c: 0 },
  left: { r: 0, c: -1 },
  right: { r: 0, c: 1 },
};

export class Board {
  private grid: (Tile | null)[][] = [];
  private nextId = 1;
  score = 0;
  private history: Snapshot[] = [];
  readonly maxHistory = 64;

  constructor(private readonly rng: Rng = Math.random) {
    this.reset();
  }

  reset(): void {
    this.grid = Array.from({ length: SIZE }, () => Array<Tile | null>(SIZE).fill(null));
    this.nextId = 1;
    this.score = 0;
    this.history = [];
  }

  /** Start a fresh game with two random tiles. */
  newGame(): SpawnEvent[] {
    this.reset();
    const spawns: SpawnEvent[] = [];
    const a = this.spawnRandom();
    const b = this.spawnRandom();
    if (a) spawns.push(a);
    if (b) spawns.push(b);
    return spawns;
  }

  tiles(): Tile[] {
    const out: Tile[] = [];
    for (const row of this.grid) for (const t of row) if (t) out.push(t);
    return out;
  }

  get(r: number, c: number): Tile | null {
    return this.grid[r]?.[c] ?? null;
  }

  highest(): number {
    let m = 0;
    for (const t of this.tiles()) m = Math.max(m, t.value);
    return m;
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  snapshot(): Snapshot {
    return {
      tiles: this.tiles().map((t) => ({ ...t })),
      score: this.score,
      nextId: this.nextId,
    };
  }

  restore(s: Snapshot): void {
    this.grid = Array.from({ length: SIZE }, () => Array<Tile | null>(SIZE).fill(null));
    for (const t of s.tiles) this.grid[t.r][t.c] = { ...t };
    this.score = s.score;
    this.nextId = s.nextId;
  }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.restore(prev);
    return true;
  }

  hasMoves(): boolean {
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        const t = this.grid[r][c];
        if (!t) return true;
        const right = this.grid[r][c + 1];
        const down = this.grid[r + 1]?.[c];
        if (right && right.value === t.value) return true;
        if (down && down.value === t.value) return true;
      }
    }
    return false;
  }

  move(dir: Direction): MoveResult {
    const before = this.snapshot();
    const d = DIRS[dir];
    const moves: TileMove[] = [];
    const merges: MergeEvent[] = [];
    let scoreGained = 0;
    let moved = false;

    const next: (Tile | null)[][] = Array.from({ length: SIZE }, () => Array<Tile | null>(SIZE).fill(null));
    // Cells in `next` produced by a merge cannot merge again this turn.
    const mergedAt = new Set<string>();

    // Traverse tiles so that the ones closest to the destination edge go first.
    const rows = [...Array(SIZE).keys()];
    const cols = [...Array(SIZE).keys()];
    if (d.r === 1) rows.reverse();
    if (d.c === 1) cols.reverse();

    for (const r of rows) {
      for (const c of cols) {
        const tile = this.grid[r][c];
        if (!tile) continue;
        let nr = r;
        let nc = c;
        // Slide as far as possible through empty cells in `next`.
        for (;;) {
          const tr = nr + d.r;
          const tc = nc + d.c;
          if (tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE) break;
          if (next[tr][tc]) break;
          nr = tr;
          nc = tc;
        }
        const tr = nr + d.r;
        const tc = nc + d.c;
        const neighbor = tr >= 0 && tr < SIZE && tc >= 0 && tc < SIZE ? next[tr][tc] : null;
        if (neighbor && neighbor.value === tile.value && !mergedAt.has(`${tr},${tc}`)) {
          const value = tile.value * 2;
          const survivor: Tile = { id: neighbor.id, value, r: tr, c: tc };
          next[tr][tc] = survivor;
          mergedAt.add(`${tr},${tc}`);
          moves.push({ id: tile.id, from: { r, c }, to: { r: tr, c: tc }, value: tile.value, merged: true });
          merges.push({ at: { r: tr, c: tc }, value, id: neighbor.id, consumed: [neighbor.id, tile.id] });
          scoreGained += value;
          moved = true;
        } else {
          next[nr][nc] = { ...tile, r: nr, c: nc };
          if (nr !== r || nc !== c) {
            moves.push({ id: tile.id, from: { r, c }, to: { r: nr, c: nc }, value: tile.value, merged: false });
            moved = true;
          }
        }
      }
    }

    if (!moved) {
      return { moved: false, moves: [], merges: [], spawn: null, scoreGained: 0 };
    }

    this.history.push(before);
    if (this.history.length > this.maxHistory) this.history.shift();
    this.grid = next;
    this.score += scoreGained;
    const spawn = this.spawnRandom();
    return { moved: true, moves, merges, spawn, scoreGained };
  }

  private spawnRandom(): SpawnEvent | null {
    const empty: Cell[] = [];
    for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) if (!this.grid[r][c]) empty.push({ r, c });
    if (empty.length === 0) return null;
    const at = empty[Math.floor(this.rng() * empty.length)];
    const value = this.rng() < 0.9 ? 2 : 4;
    const tile: Tile = { id: this.nextId++, value, r: at.r, c: at.c };
    this.grid[at.r][at.c] = tile;
    return { id: tile.id, at, value };
  }

  /** Test helper: place tiles from a value matrix (0 = empty). */
  load(values: number[][], score = 0): void {
    this.reset();
    this.score = score;
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        const v = values[r][c];
        if (v > 0) this.grid[r][c] = { id: this.nextId++, value: v, r, c };
      }
    }
  }

  toMatrix(): number[][] {
    return this.grid.map((row) => row.map((t) => (t ? t.value : 0)));
  }
}
