/// <reference types="vite/client" />

interface Rock2048Diagnostics {
  frame: number;
  ready: boolean;
  score: number;
  highest: number;
  busy: boolean;
  animating: boolean;
  /** Tile objects currently in the scene. */
  tiles: number;
  /** Tiles the rules layer says should exist. */
  boardTiles: number;
  /** Tiles whose object is missing or off its cell. Reported as 0 while animating. */
  misplaced: number;
  gameOver: boolean;
  overlay: boolean;
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
}

/** Dev-only hooks used by the browser QA pass. Not present in a production build. */
interface Rock2048TestHooks {
  load(matrix: number[][], score?: number): void;
  move(dir: 'up' | 'down' | 'left' | 'right'): void;
  step(seconds: number, stepMs?: number): void;
  state(): {
    matrix: number[][];
    score: number;
    busy: boolean;
    animating: boolean;
    gameOver: boolean;
    overlay: boolean;
    misplaced: number;
  };
}

interface Window {
  __ROCK2048__?: Rock2048Diagnostics;
  __ROCK2048_TEST__?: Rock2048TestHooks;
}
