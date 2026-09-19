/**
 * Logic tests for the 2048 rules in src/game/Board.ts.
 *
 * Run with `npm run test:logic`, which bundles the TypeScript source to .tmp/board.mjs first.
 * Every move is cross-checked against an independent reference implementation written
 * directly from the 2048 rules, for all four directions.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Board, SIZE } from '../.tmp/board.mjs';

// ---------------------------------------------------------------- reference rules

/** Collapse one line whose index 0 is nearest the destination edge. */
function collapse(line) {
  const values = line.filter((v) => v !== 0);
  const out = [];
  let score = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (i + 1 < values.length && values[i] === values[i + 1]) {
      out.push(values[i] * 2);
      score += values[i] * 2;
      i += 1;
    } else {
      out.push(values[i]);
    }
  }
  while (out.length < SIZE) out.push(0);
  return { out, score };
}

/** Reference 2048 move. Returns the post-move matrix (before any spawn) and the score gained. */
function referenceMove(matrix, dir) {
  const next = matrix.map((row) => row.slice());
  let gained = 0;
  for (let i = 0; i < SIZE; i += 1) {
    let line;
    if (dir === 'left') line = matrix[i].slice();
    else if (dir === 'right') line = matrix[i].slice().reverse();
    else if (dir === 'up') line = matrix.map((row) => row[i]);
    else line = matrix.map((row) => row[i]).reverse();

    const { out, score } = collapse(line);
    gained += score;

    for (let j = 0; j < SIZE; j += 1) {
      if (dir === 'left') next[i][j] = out[j];
      else if (dir === 'right') next[i][SIZE - 1 - j] = out[j];
      else if (dir === 'up') next[j][i] = out[j];
      else next[SIZE - 1 - j][i] = out[j];
    }
  }
  return { next, gained };
}

const DIRECTIONS = ['up', 'down', 'left', 'right'];

function sameMatrix(a, b) {
  return a.every((row, r) => row.every((v, c) => v === b[r][c]));
}

/** Deterministic RNG so spawn placement is reproducible. */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Remove the freshly spawned tile so the board can be compared with the reference. */
function withoutSpawn(matrix, spawn) {
  if (!spawn) return matrix;
  const copy = matrix.map((row) => row.slice());
  copy[spawn.at.r][spawn.at.c] = 0;
  return copy;
}

// ---------------------------------------------------------------- targeted cases

test('slides and merges a row to the left without double merging', () => {
  const board = new Board(makeRng(1));
  board.load([
    [2, 2, 4, 4],
    [2, 0, 2, 0],
    [4, 4, 4, 4],
    [0, 0, 0, 2],
  ]);
  const result = board.move('left');
  const matrix = withoutSpawn(board.toMatrix(), result.spawn);
  assert.deepEqual(matrix[0], [4, 8, 0, 0]);
  assert.deepEqual(matrix[1], [4, 0, 0, 0]);
  assert.deepEqual(matrix[2], [8, 8, 0, 0]);
  assert.deepEqual(matrix[3], [2, 0, 0, 0]);
  assert.equal(result.scoreGained, 32);
  assert.equal(board.score, 32);
});

test('merges the pair nearest the destination edge first', () => {
  const board = new Board(makeRng(2));
  board.load([
    [2, 2, 2, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const result = board.move('right');
  const matrix = withoutSpawn(board.toMatrix(), result.spawn);
  assert.deepEqual(matrix[0], [0, 0, 2, 4]);
  assert.deepEqual(result.merges[0].at, { r: 0, c: 3 });
});

test('a column moving down collapses toward the bottom edge', () => {
  const board = new Board(makeRng(3));
  board.load([
    [2, 0, 4, 8],
    [2, 0, 4, 0],
    [4, 0, 8, 8],
    [4, 0, 8, 0],
  ]);
  const result = board.move('down');
  const matrix = withoutSpawn(board.toMatrix(), result.spawn);
  assert.deepEqual(
    matrix.map((row) => row[0]),
    [0, 0, 4, 8],
  );
  assert.deepEqual(
    matrix.map((row) => row[2]),
    [0, 0, 8, 16],
  );
  assert.deepEqual(
    matrix.map((row) => row[3]),
    [0, 0, 0, 16],
  );
});

test('every full column moves down when nothing blocks it', () => {
  const board = new Board(makeRng(4));
  board.load([
    [2, 4, 8, 16],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const result = board.move('down');
  const matrix = withoutSpawn(board.toMatrix(), result.spawn);
  assert.deepEqual(matrix[3], [2, 4, 8, 16]);
  assert.equal(result.moves.length, 4, 'all four tiles report a move');
  for (const move of result.moves) {
    assert.equal(move.from.r, 0);
    assert.equal(move.to.r, 3);
    assert.equal(move.merged, false);
  }
});

test('a move that changes nothing does not spawn or record history', () => {
  const board = new Board(makeRng(5));
  board.load([
    [2, 4, 8, 16],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const result = board.move('up');
  assert.equal(result.moved, false);
  assert.equal(result.spawn, null);
  assert.equal(board.canUndo(), false);
  assert.equal(board.tiles().length, 4);
});

test('undo restores the exact previous position and score', () => {
  const board = new Board(makeRng(6));
  board.load(
    [
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    10,
  );
  const before = JSON.stringify(board.toMatrix());
  board.move('left');
  assert.notEqual(JSON.stringify(board.toMatrix()), before);
  assert.equal(board.undo(), true);
  assert.equal(JSON.stringify(board.toMatrix()), before);
  assert.equal(board.score, 10);
  assert.equal(board.canUndo(), false);
});

test('detects game over only when no move is available', () => {
  const board = new Board(makeRng(7));
  board.load([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ]);
  assert.equal(board.hasMoves(), false);
  for (const dir of DIRECTIONS) assert.equal(board.move(dir).moved, false);

  board.load([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 4],
  ]);
  assert.equal(board.hasMoves(), true, 'a matching vertical pair still allows a move');

  board.load([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 0],
  ]);
  assert.equal(board.hasMoves(), true, 'an empty cell still allows a move');
});

test('a new game starts with exactly two tiles of value 2 or 4', () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const board = new Board(makeRng(seed));
    const spawns = board.newGame();
    assert.equal(spawns.length, 2);
    assert.equal(board.tiles().length, 2);
    assert.equal(board.score, 0);
    for (const tile of board.tiles()) assert.ok(tile.value === 2 || tile.value === 4);
    const cells = new Set(board.tiles().map((t) => `${t.r},${t.c}`));
    assert.equal(cells.size, 2, 'the two tiles occupy different cells');
  }
});

// ---------------------------------------------------------------- differential tests

test('every direction matches the reference rules over random positions', () => {
  const rng = makeRng(99);
  let checked = 0;
  for (let trial = 0; trial < 4000; trial += 1) {
    const matrix = Array.from({ length: SIZE }, () =>
      Array.from({ length: SIZE }, () => {
        const roll = rng();
        if (roll < 0.35) return 0;
        return 2 ** (1 + Math.floor(rng() * 6));
      }),
    );
    const dir = DIRECTIONS[Math.floor(rng() * 4)];
    const board = new Board(makeRng(trial + 1));
    board.load(matrix);
    const result = board.move(dir);
    const { next, gained } = referenceMove(matrix, dir);
    const expectedMoved = !sameMatrix(matrix, next);

    assert.equal(result.moved, expectedMoved, `moved flag for ${dir} on ${JSON.stringify(matrix)}`);
    if (!expectedMoved) {
      assert.ok(sameMatrix(board.toMatrix(), matrix), 'a blocked move leaves the board untouched');
      continue;
    }
    const actual = withoutSpawn(board.toMatrix(), result.spawn);
    assert.ok(
      sameMatrix(actual, next),
      `${dir}\nbefore ${JSON.stringify(matrix)}\nactual ${JSON.stringify(actual)}\nexpect ${JSON.stringify(next)}`,
    );
    assert.equal(result.scoreGained, gained, `score for ${dir}`);
    checked += 1;
  }
  assert.ok(checked > 3000, `expected most trials to move, got ${checked}`);
});

test('move events fully describe the resulting position', () => {
  const rng = makeRng(1234);
  for (let trial = 0; trial < 2000; trial += 1) {
    const board = new Board(makeRng(trial + 500));
    board.newGame();
    for (let step = 0; step < 40 && board.hasMoves(); step += 1) {
      const before = new Map(board.tiles().map((t) => [t.id, { ...t }]));
      const dir = DIRECTIONS[Math.floor(rng() * 4)];
      const result = board.move(dir);
      if (!result.moved) continue;

      // Replay the reported events against the pre-move tiles and expect the real board back.
      const replay = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
      const moved = new Set();
      for (const m of result.moves) {
        const tile = before.get(m.id);
        assert.ok(tile, 'every move references a tile that existed before the move');
        assert.equal(tile.value, m.value, 'move events carry the pre-merge value');
        moved.add(m.id);
        if (!m.merged) replay[m.to.r][m.to.c] = tile.value;
      }
      for (const [id, tile] of before) {
        if (!moved.has(id)) replay[tile.r][tile.c] = tile.value;
      }
      for (const merge of result.merges) {
        replay[merge.at.r][merge.at.c] = merge.value;
        assert.equal(merge.value % 2, 0);
        assert.equal(merge.id, merge.consumed[0], 'the surviving id is the tile already at the target');
      }
      if (result.spawn) replay[result.spawn.at.r][result.spawn.at.c] = result.spawn.value;

      assert.ok(
        sameMatrix(replay, board.toMatrix()),
        `replayed events diverged\nreplay ${JSON.stringify(replay)}\nboard  ${JSON.stringify(board.toMatrix())}`,
      );

      // Each tile takes part in at most one merge, and ids stay unique.
      const consumed = result.merges.flatMap((m) => m.consumed);
      assert.equal(new Set(consumed).size, consumed.length, 'no tile is consumed twice');
      const ids = board.tiles().map((t) => t.id);
      assert.equal(new Set(ids).size, ids.length, 'live tile ids are unique');
    }
  }
});

test('long random games always end in a detectable game over', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const rng = makeRng(seed * 7919);
    const board = new Board(makeRng(seed));
    board.newGame();
    let moves = 0;
    while (board.hasMoves() && moves < 5000) {
      const result = board.move(DIRECTIONS[Math.floor(rng() * 4)]);
      if (result.moved) moves += 1;
      for (const tile of board.tiles()) {
        assert.ok(Number.isInteger(Math.log2(tile.value)), 'tile values stay powers of two');
        assert.ok(tile.r >= 0 && tile.r < SIZE && tile.c >= 0 && tile.c < SIZE);
      }
    }
    assert.ok(moves > 0, 'the game made progress');
    assert.equal(board.hasMoves(), false, 'the loop ended because the board is stuck');
    assert.equal(board.tiles().length, SIZE * SIZE, 'a stuck board is full');
    for (const dir of DIRECTIONS) {
      assert.equal(board.move(dir).moved, false, `${dir} is correctly rejected at game over`);
    }
  }
});
