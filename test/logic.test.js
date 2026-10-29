'use strict';
// 펭고 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const DT = 1 / 60;
const run = (st, sec, inp) => { for (let t = 0; t < sec - 1e-9; t += DT) L.step(st, DT, inp || { dir: null, push: false }); };
// 아무것도 없는 판: 얼음·알·Sno-Bee 없이 펭고만 가운데에 (필요한 것만 직접 놓는다)
function blank(round = 1) {
  const st = L.newGame(L.rng(1), round);
  st.grid = Array.from({ length: L.ROWS }, () => new Array(L.COLS).fill(0));
  st.eggs = new Set(); st.bees = []; st.slides = [];
  st.eggTotal = 0; st.hatchedCount = 0; st.hatchT = 1e9;           // 저절로 알이 깨거나 판이 끝나지 않게
  st.pengo.invuln = 0;
  return st;
}
const bee = (st, x, y, extra = {}) => { const b = { id: ++st.seq, x, y, tx: x, ty: y, dir: 2, state: 'walk', hatchT: 0, stunT: 0, gnawT: 0, gnaw: null, stuckT: 0, anim: 0, ...extra }; st.bees.push(b); return b; };
const face = (st, dir) => { st.pengo.dir = dir; };
const pushOnce = (st) => L.step(st, DT, { dir: null, push: true });
const key = (x, y) => y * L.COLS + x;

test('every round has symmetric corridors, one connected open area around the start, three diamond blocks and the right number of eggs', () => {
  for (let round = 1; round <= 16; round++) {
    const st = L.newGame(L.rng(round), round);
    const g = st.grid;
    assert.strictEqual(g.length, 15); assert.strictEqual(g[0].length, 13);
    assert.strictEqual(g[7][6], 0, 'Pengo starts in the middle');
    for (let y = 0; y < 15; y++) for (let x = 0; x < 13; x++) if (g[y][x] !== 2 && g[y][12 - x] !== 2) assert.strictEqual(g[y][x] === 0, g[y][12 - x] === 0, `symmetric at ${x},${y}`);
    const open = g.flat().filter((v) => v === 0).length;
    assert.ok(open > 55 && open < 110, `round ${round} open cells ${open}`);
    const d = L.distFrom(g, 6, 7, true);
    for (let y = 0; y < 15; y++) for (let x = 0; x < 13; x++) if (g[y][x] === 0) assert.ok(d[y * 13 + x] >= 0, `round ${round}: open cell ${x},${y} is connected`);
    assert.strictEqual(g.flat().filter((v) => v === 2).length, 3, 'three diamond blocks');
    assert.strictEqual(st.eggs.size, L.EGGS[round - 1], 'eggs per round');
    assert.strictEqual(st.maxActive, round <= 4 ? 3 : 4);
    for (const k of st.eggs) assert.strictEqual(g[Math.floor(k / 13)][k % 13], 1, 'eggs are inside ice blocks');
  }
  assert.deepStrictEqual(L.EGGS, [6, 8, 8, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 12, 12, 12]);
  const a = L.newGame(L.rng(1), 1).grid.flat().join(''), b = L.newGame(L.rng(2), 1).grid.flat().join('');
  assert.notStrictEqual(a, b, 'rounds are not all the same');
});

test('the time bonus: under 20 seconds 5000, 20-29 2000, 30-39 1000, 40-49 500, 50-59 10, a minute or more nothing', () => {
  assert.deepStrictEqual([0, 19, 20, 29, 30, 39, 40, 49, 50, 59, 60, 200].map(L.timeBonus), [5000, 5000, 2000, 2000, 1000, 1000, 500, 500, 10, 10, 0, 0]);
});

test('Pengo moves one cell at a time, turns to face a block without moving, and cannot leave the field', () => {
  const st = blank();
  st.grid[7][7] = 1;
  L.step(st, DT, { dir: 1, push: false });
  assert.strictEqual(st.pengo.dir, 1);
  run(st, 0.5, { dir: 1, push: false });
  assert.strictEqual(Math.round(st.pengo.x), 6, 'a block in the way: he only faces it');
  run(st, 0.5, { dir: 3, push: false });
  assert.ok(st.pengo.x < 6 && Number.isFinite(st.pengo.x));
  run(st, 5, { dir: 3, push: false });
  assert.strictEqual(st.pengo.x, 0, 'stops at the wall');
  run(st, 5, { dir: 0, push: false });
  assert.strictEqual(st.pengo.y, 0);
  const s2 = blank();
  run(s2, 0.15, { dir: 2, push: false });
  assert.ok(Number.isInteger(s2.pengo.y) || s2.pengo.moving, 'one cell is a glide, then he rests on a cell');
  run(s2, 0.3);
  assert.ok(Number.isInteger(s2.pengo.y) && Number.isInteger(s2.pengo.x));
});

test('pushing: a free block slides all the way until it hits a wall or another block', () => {
  const st = blank();
  st.grid[7][7] = 1; st.grid[7][11] = 1;
  face(st, 1);
  pushOnce(st);
  assert.strictEqual(st.grid[7][7], 0);
  assert.strictEqual(st.slides.length, 1);
  run(st, 1);
  assert.strictEqual(st.slides.length, 0);
  assert.strictEqual(st.grid[7][10], 1, 'stopped against the other block');
  const s2 = blank();
  s2.grid[7][7] = 1; face(s2, 1); pushOnce(s2); run(s2, 1);
  assert.strictEqual(s2.grid[7][12], 1, 'stopped at the wall');
});

test('pushing a block that is stuck against a wall or another block crumbles it (30 points, 500 with an egg)', () => {
  const st = blank();
  st.grid[7][7] = 1; st.grid[7][8] = 1;
  face(st, 1); pushOnce(st);
  assert.strictEqual(st.grid[7][7], 0);
  assert.strictEqual(st.score, 30);
  const s2 = blank();
  s2.grid[7][7] = 1; s2.grid[7][8] = 1; s2.eggs.add(key(7, 7));
  face(s2, 1); pushOnce(s2);
  assert.strictEqual(s2.score, 500);
  assert.strictEqual(s2.eggs.size, 0, 'the egg is gone');
  const s3 = blank();
  s3.grid[7][7] = 2; s3.grid[7][8] = 1;
  face(s3, 1); pushOnce(s3);
  assert.strictEqual(s3.grid[7][7], 2, 'a diamond block cannot be crushed');
  assert.strictEqual(s3.score, 0);
});

test('a sliding block crushes Sno-Bees on its way: 400, 1600, 3200, 6400 for one to four at once', () => {
  for (const [n, pts] of [[1, 400], [2, 1600], [3, 3200], [4, 6400]]) {
    const st = blank();
    st.grid[7][7] = 1; face(st, 1);
    for (let i = 0; i < n; i++) bee(st, 8 + i * 1, 7, { state: 'stun', stunT: 9 });
    pushOnce(st);
    run(st, 1.2);
    assert.strictEqual(st.score, pts, `${n} crushed`);
    assert.strictEqual(st.bees.length, 0);
    assert.strictEqual(st.stats.crushed, n);
  }
  const st = blank();
  st.grid[7][7] = 1; face(st, 1); bee(st, 9, 7);
  pushOnce(st); run(st, 1.2);
  assert.strictEqual(st.score, 400, 'a walking bee is crushed too');
});

test('pushing the outer wall shakes it and stuns the Sno-Bees on that edge for a few seconds; stepping on a stunned one is worth 100', () => {
  const st = blank();
  st.pengo.x = 0; st.pengo.y = 7; st.pengo.tx = 0; st.pengo.ty = 7; st.pengo.invuln = 9999;
  const a = bee(st, 0, 3), c = bee(st, 5, 5);
  face(st, 3); pushOnce(st);
  assert.strictEqual(a.state, 'stun');
  assert.strictEqual(c.state, 'walk', 'only the ones touching that edge');
  assert.ok(st.shake && st.shake.dir === 3);
  assert.ok(st.events.some((e) => e.t === 'shake'));
  run(st, L.STUN_TIME + 0.3);
  assert.strictEqual(a.state, 'walk', 'they wake up again');
  // 기절한 것을 밟는다
  const s2 = blank();
  const sb = bee(s2, 6, 8, { state: 'stun', stunT: 9 });
  run(s2, 0.6, { dir: 2, push: false });
  assert.strictEqual(s2.score, 100);
  assert.strictEqual(s2.bees.length, 0);
  assert.ok(sb);
});

test('three diamond blocks in a row: 10000 in the middle, 5000 along a wall, once per round, and every Sno-Bee freezes', () => {
  const mid = blank();
  mid.grid[5][5] = 2; mid.grid[5][6] = 2; mid.grid[5][7] = 2;
  const b1 = bee(mid, 2, 2);
  L.checkDiamonds(mid);
  assert.strictEqual(mid.score, 10000);
  assert.strictEqual(b1.state, 'stun');
  L.checkDiamonds(mid);
  assert.strictEqual(mid.score, 10000, 'only once');
  const wall = blank();
  wall.grid[0][3] = 2; wall.grid[0][4] = 2; wall.grid[0][5] = 2;
  L.checkDiamonds(wall);
  assert.strictEqual(wall.score, 5000, 'three along the top wall');
  const vert = blank();
  vert.grid[3][0] = 2; vert.grid[4][0] = 2; vert.grid[5][0] = 2;
  L.checkDiamonds(vert); assert.strictEqual(vert.score, 5000);
  const one = blank();
  one.grid[5][0] = 2; one.grid[5][1] = 2; one.grid[5][2] = 2;
  L.checkDiamonds(one); assert.strictEqual(one.score, 10000, 'only one touches the wall');
  const none = blank();
  none.grid[5][5] = 2; none.grid[5][7] = 2; none.grid[5][9] = 2;
  L.checkDiamonds(none); assert.strictEqual(none.score, 0, 'not touching');
  // 밀어서 맞춘다
  const push = blank();
  push.grid[7][7] = 2; push.grid[5][8] = 2; push.grid[6][8] = 2;
  push.pengo.x = 8; push.pengo.y = 9; push.pengo.tx = 8; push.pengo.ty = 9;
  face(push, 1); L.step(push, DT, { dir: null, push: false });
  push.grid[7][7] = 0; push.grid[7][8] = 2;                         // (직접 놓아 두고 확인: 한 줄로 이어짐)
  L.checkDiamonds(push);
  assert.strictEqual(push.score, 10000);
});

test('the first Sno-Bees hatch at the start (3 in rounds 1-4, 4 later), then new ones hatch as you destroy them, and the egg counter goes down', () => {
  for (const [round, active] of [[1, 3], [4, 3], [5, 4], [16, 4]]) {
    const st = L.newGame(L.rng(round), round);
    st.pengo.invuln = 99999;
    run(st, 6);
    assert.ok(st.bees.length <= active, `round ${round}: at most ${active} at once`);
    assert.strictEqual(st.bees.length, active, `round ${round}: ${active} out by now`);
    assert.strictEqual(st.eggs.size, L.EGGS[round - 1] - active);
  }
  const st = L.newGame(L.rng(9), 1);
  st.pengo.invuln = 99999;
  run(st, 5);
  const before = st.eggs.size;
  st.bees.pop();                                                   // 하나 없앤다
  run(st, 4);
  assert.ok(st.eggs.size < before, 'another one hatched to replace it');
  assert.ok(st.bees.length <= 3);
});

test('Sno-Bees chase Pengo along the corridors, and touching one costs a life (with a short shield when he comes back)', () => {
  const st = blank();
  for (let x = 0; x < 13; x++) st.grid[7][x] = 0;
  st.grid[6].fill(1); st.grid[8].fill(1);
  st.pengo.x = 2; st.pengo.y = 7; st.pengo.tx = 2; st.pengo.ty = 7;
  const b = bee(st, 10, 7);
  run(st, 1.5);
  assert.ok(b.x < 8, 'it came closer');
  run(st, 1.0);
  assert.strictEqual(st.lives, L.START_LIVES - 1);
  assert.strictEqual(st.phase, 'dying');
  st.bees = [];
  run(st, 2);
  assert.strictEqual(st.phase, 'play');
  assert.ok(st.pengo.invuln > 0);
  assert.strictEqual(st.pengo.x, L.START.x);
});

test('a Sno-Bee that cannot reach Pengo gnaws a way through the ice, but never through a diamond block', () => {
  const st = blank();
  st.grid.forEach((row) => row.fill(1));
  st.grid[7][6] = 0; st.grid[7][2] = 0; st.grid[7][3] = 0;
  const b = bee(st, 2, 7);
  run(st, 6);
  assert.ok(st.grid[7][4] === 0 || st.grid[7][1] === 0 || st.grid[6][2] === 0 || st.grid[8][2] === 0 || b.x !== 2, 'it chewed something');
  const d = blank();
  d.grid.forEach((row) => row.fill(2));
  d.grid[7][6] = 0; d.grid[7][2] = 0;
  bee(d, 2, 7);
  run(d, 8);
  assert.strictEqual(d.grid.flat().filter((v) => v === 2).length, 13 * 15 - 2, 'diamond blocks stay');
});

test('sudden death after 60 seconds makes the Sno-Bees faster, and after two minutes they turn into Blobs that crush ice', () => {
  const mk = () => { const s = blank(); s.grid.forEach((row) => row.fill(1)); for (let x = 0; x < 13; x++) s.grid[1][x] = 0; s.pengo.invuln = 9999; s.pengo.x = 0; s.pengo.y = 1; s.pengo.tx = 0; s.pengo.ty = 1; return s; };
  const slow = mk(), fast = mk();
  fast.sinceDeath = L.SUDDEN_AT + 1;
  const a = bee(slow, 12, 1), b = bee(fast, 12, 1);
  run(slow, 1); run(fast, 1);
  assert.ok(12 - b.x > (12 - a.x) * 1.25, `faster in sudden death: ${12 - a.x} vs ${12 - b.x}`);
  const st = blank();
  st.grid.forEach((row) => row.fill(1));
  for (let x = 0; x < 13; x++) if (x !== 4 && x !== 5) st.grid[7][x] = 0;        // 가운데 두 칸만 얼음으로 막힌 길
  st.pengo.x = 0; st.pengo.y = 7; st.pengo.tx = 0; st.pengo.ty = 7; st.pengo.invuln = 9999;
  const z = bee(st, 9, 7);
  st.sinceDeath = L.BLOB_AT + 1;
  run(st, 0.1);
  assert.strictEqual(z.state, 'blob', 'two minutes turn it into a Blob');
  run(st, 5);
  assert.strictEqual(st.grid[7][5], 0, 'the blob ate the ice in its way');
  assert.strictEqual(st.grid[7][4], 0);
});

test('the last Sno-Bee turns into a Blob after 12 seconds', () => {
  const st = blank();
  st.hatchedCount = 3;
  st.pengo.invuln = 9999; st.pengo.x = 0; st.pengo.y = 14; st.pengo.tx = 0; st.pengo.ty = 14;
  for (let x = 0; x < 13; x++) st.grid[1][x] = 0;
  const z = bee(st, 12, 1);
  run(st, 11);
  assert.notStrictEqual(z.state, 'blob');
  run(st, 2);
  assert.strictEqual(z.state, 'blob');
});

test('clearing the round: all eggs hatched and all Sno-Bees gone, the time bonus is added, and the next round starts', () => {
  const st = blank();
  st.hatchedCount = 3;
  st.t = 25;
  run(st, 0.1);
  assert.strictEqual(st.phase, 'clear');
  assert.strictEqual(st.score, 2000, '25 seconds gets 2000');
  run(st, 3.2);
  assert.strictEqual(st.round, 2);
  assert.strictEqual(st.phase, 'play');
  assert.strictEqual(st.eggs.size, L.EGGS[1]);
  const slow = blank(); slow.hatchedCount = 3; slow.t = 75; run(slow, 0.1);
  assert.strictEqual(slow.score, 0, 'a minute or more: no bonus');
});

test('lives run out, and the game ends', () => {
  const st = blank();
  st.lives = 1;
  L.killPengo(st, 'bee');
  run(st, 2);
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(L.START_LIVES, 3);
});

test('random play for several minutes keeps everything on the field', () => {
  const rand = L.rng(31);
  for (let g = 0; g < 6; g++) {
    const st = L.newGame(L.rng(100 + g), 1 + g * 3);
    const inp = { dir: null, push: false };
    for (let i = 0; i < 60 * 120 && st.phase !== 'over'; i++) {
      if (i % 9 === 0) { const d = Math.floor(rand() * 5); inp.dir = d === 4 ? null : d; inp.push = rand() < 0.5; }
      L.step(st, DT, inp);
      const p = st.pengo;
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -1e-6 && p.x <= 12 + 1e-6 && p.y >= -1e-6 && p.y <= 14 + 1e-6, 'pengo inside');
      for (const b of st.bees) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && b.x >= -1e-6 && b.x <= 12 + 1e-6 && b.y >= -1e-6 && b.y <= 14 + 1e-6, 'bee inside');
      for (const s of st.slides) assert.ok(s.x >= -1e-6 && s.x <= 12 + 1e-6 && s.y >= -1e-6 && s.y <= 14 + 1e-6);
      assert.ok(st.eggs.size <= 12 && st.lives >= 0);
      for (const k of st.eggs) assert.strictEqual(st.grid[Math.floor(k / 13)][k % 13], 1, 'every egg sits in an ice block');
    }
  }
});
