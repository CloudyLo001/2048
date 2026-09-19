# Rock 2048

A 3D take on 2048: every tile is a rough-hewn stone block sitting in a slate tray. Merging two
blocks smashes them together with flying rubble, dust, a camera kick and a crunch.

**Play it: https://cloudylo001.github.io/2048/**

Pushing to `main` rebuilds and redeploys the site through `.github/workflows/deploy.yml`.

## Run

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5188. `npm run build` produces a static bundle in `dist/`.

Vite 8 expects Node 20.19+ or 22.12+. On Windows, npm sometimes skips Rolldown's native
binding; `package.json` pins `@rolldown/binding-win32-x64-msvc` under `optionalDependencies`
so a normal install restores it.

## Controls

- Arrow keys or WASD, or swipe on the board, to move.
- The board faces you straight on by default. Right-drag (two-finger drag on touch) tilts it
  toward a three-quarter view; scroll or pinch zooms. The tilt stops at the straight-on pose,
  so the grid never flips past it.
- **New** restarts, **Undo** steps back (up to 64 moves), the gear opens settings.
- Settings: block finish (Natural, Polished, Matte, Plastic, Metallic, Wet gloss), rubble on
  merge, camera shake, sound. Settings and the best score persist in `localStorage`.

## Structure

- `src/game/Board.ts` - pure 2048 rules with move/merge/spawn events and an undo stack.
- `src/game/Game.ts` - Three.js scene, camera, lighting, move choreography and merge effects.
- `src/assets/TileLibrary.ts` - loads the generated GLBs through the shared Draco-capable
  loader (`src/assets/gltf-runtime.ts`), normalizes bounds and hands out clones.
- `src/systems/BoardMesh.ts` - procedural slate tray with 4x4 pockets, textured by the
  generated PBR maps.
- `src/systems/Rubble.ts` - pooled rubble chunks and dust puffs for the collision burst.
- `src/systems/Finish.ts` - material finish presets; "Natural" restores the generated look.
- `src/systems/Labels.ts`, `Tweens.ts`, `ShakeRig.ts`, `AudioSystem.ts` - number decals,
  easing, camera trauma shake, procedural Web Audio.
- `src/ui/Hud.ts` - score, best, buttons, settings panel and overlays.

## Assets

All block and rubble models plus the slate material were generated with Mint and are recorded
in `mint-assets.json` (Mint Project "Rock Crush 2048"). Files live under `public/assets/mint/`
keyed as `tile-2` ... `tile-2048`, `rubble-a/b/c` and `board-slate`.

Re-sync an asset with the Mint skill's registry script:

```bash
node <mint-threejs-skills>/scripts/sync-mint-assets.mjs --project . --manifest <manifest.json> --key tile-2
```

## Tests

```bash
npm run test:logic
```

Bundles the rules to `.tmp/board.mjs` and runs `tests/board.test.mjs` under the node test
runner. Every move is cross-checked against an independent reference implementation of 2048
across thousands of random positions in all four directions, and 200 random games are played
to completion to confirm game over is always detected.

`npm test` runs those plus the Playwright browser smoke in `tests/visual.spec.ts`
(needs `npx playwright install` first).

### The diagnostics hook

In a dev build the page publishes `window.__ROCK2048__` each frame (score, tile counts,
`animating`, `busy`, and `misplaced`) and `window.__ROCK2048_TEST__` with `load`, `move`,
`step` and `state`. `misplaced` counts blocks whose 3D object is not sitting on its board
cell and must be 0 whenever the game is idle; `step(seconds)` advances animation time without
waiting on the render loop, so automated checks can land a second move in the middle of the
first one's animation.
