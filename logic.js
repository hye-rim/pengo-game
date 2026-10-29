'use strict';
// 펭고(1982) 스타일 규칙. 화면 없이 Node 에서 시험한다 (DOM 을 쓰지 않는다).
// 판은 13칸 x 15칸. 칸마다 비어 있거나 얼음 블록(1) · 다이아몬드 블록(2). 위치는 칸 단위의 실수이고 칸 중심이 정수 좌표다.
// 방향: 0 위 · 1 오른쪽 · 2 아래 · 3 왼쪽
const LOGIC_PENGO = (() => {
const COLS = 13, ROWS = 15;
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const START_LIVES = 3;
const PENGO_SPEED = 4.6, SLIDE_SPEED = 13;
const BEE_SPEED = 3.0;
const STUN_TIME = 4.5, SHAKE_TIME = 0.5, GNAW_TIME = 0.9, HATCH_COOL = 2.2;
const SUDDEN_AT = 60, BLOB_AT = 120, LAST_BLOB_DELAY = 12;
const POINTS = { crumble: 30, egg: 500, stomp: 100, crush: [400, 1600, 3200, 6400], diamondsMiddle: 10000, diamondsWall: 5000 };
// 한 판에 나오는 Sno-Bee 의 알 개수(수출판 기준)와 한꺼번에 나올 수 있는 수 (arcade-history 의 팁 자료)
const EGGS = [6, 8, 8, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 12, 12, 12];
const MAX_ACTIVE = (round) => (round <= 4 ? 3 : 4);
const ROUNDS = 16;
const START = { x: 6, y: 7 };
const timeBonus = (sec) => (sec < 20 ? 5000 : sec < 30 ? 2000 : sec < 40 ? 1000 : sec < 50 ? 500 : sec < 60 ? 10 : 0);

const rng = (seed) => {                                      // mulberry32 (시험용 고정 난수)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const emit = (st, e) => { st.events.push(e); };
const inside = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
const key = (x, y) => y * COLS + x;
const isInt = (v) => Math.abs(v - Math.round(v)) < 1e-6;

// ---------- 판 만들기 ----------
// 얼음으로 꽉 채운 판에 길을 파낸다. 좌우 대칭이고 시작 칸에서 이어진다
function genGrid(round, r) {
  const g = Array.from({ length: ROWS }, () => new Array(COLS).fill(1));
  const open = (x, y) => { if (inside(x, y)) { g[y][x] = 0; if (inside(COLS - 1 - x, y)) g[y][COLS - 1 - x] = 0; } };
  open(START.x, START.y);
  const target = 0.34 + 0.004 * (Math.min(round, ROUNDS) - 1) + r() * 0.05;
  const openCells = () => { const out = []; for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!g[y][x]) out.push([x, y]); return out; };
  let guard = 0;
  while (openCells().length / (COLS * ROWS) < target && guard++ < 400) {
    const cells = openCells();
    const [x0, y0] = cells[Math.floor(r() * cells.length)];
    const d = Math.floor(r() * 4), len = 2 + Math.floor(r() * 5);
    let x = x0, y = y0;
    for (let i = 0; i < len; i++) { x += DX[d]; y += DY[d]; if (!inside(x, y)) break; open(x, y); }
  }
  return g;
}
function distFrom(g, sx, sy, blockedByIce) {
  const dist = new Int16Array(COLS * ROWS).fill(-1);
  const q = [[sx, sy]]; dist[key(sx, sy)] = 0;
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!inside(nx, ny) || dist[key(nx, ny)] >= 0) continue;
      if (g[ny][nx] === 2) continue;
      if (g[ny][nx] === 1 && blockedByIce) continue;
      dist[key(nx, ny)] = dist[key(x, y)] + 1; q.push([nx, ny]);
    }
  }
  return dist;
}

function startRound(st, round) {
  const r = st.rand;
  st.round = round;
  const ri = Math.min(round, ROUNDS) - 1;
  st.grid = genGrid(round, r);
  st.eggs = new Set();
  // 다이아몬드 블록 세 개: 시작 칸에서 떨어진 얼음 칸 중에서, 서로도 떨어뜨려 둔다
  const icecells = [];
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (st.grid[y][x] === 1 && Math.abs(x - START.x) + Math.abs(y - START.y) >= 4) icecells.push([x, y]);
  const diamonds = [];
  for (let tries = 0; diamonds.length < 3 && tries < 400; tries++) {
    const [x, y] = icecells[Math.floor(r() * icecells.length)];
    if (diamonds.every(([a, b]) => Math.abs(a - x) + Math.abs(b - y) >= 3)) diamonds.push([x, y]);
  }
  for (const [x, y] of diamonds) st.grid[y][x] = 2;
  // 알이 든 블록
  const total = EGGS[ri];
  const candidates = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (st.grid[y][x] === 1 && Math.abs(x - START.x) + Math.abs(y - START.y) >= 5) candidates.push([x, y]);
  for (let tries = 0; st.eggs.size < total && tries < 800 && candidates.length; tries++) {
    const [x, y] = candidates[Math.floor(r() * candidates.length)];
    st.eggs.add(key(x, y));
  }
  st.eggTotal = st.eggs.size;
  st.maxActive = MAX_ACTIVE(round);
  st.bees = []; st.slides = []; st.fx = [];
  st.pengo = { x: START.x, y: START.y, tx: START.x, ty: START.y, dir: 2, moving: false, alive: true, invuln: 1.5, anim: 0 };
  st.t = 0; st.sinceDeath = 0; st.hatchT = 0.6; st.hatchedCount = 0;
  st.diamondsDone = false; st.shake = null;
  st.phase = 'play'; st.phaseT = 0;
  st.lastBlobAt = null;
  emit(st, { t: 'round', round });
}

function newGame(rand = Math.random, round = 1) {
  const st = { rand, score: 0, lives: START_LIVES, round, time: 0, events: [], stats: { crushed: 0, crumbled: 0, eggs: 0, stomped: 0 }, seq: 0 };
  startRound(st, round);
  st.events = [];
  return st;
}

// ---------- 움직임 ----------
const cellFree = (st, x, y) => inside(x, y) && st.grid[y][x] === 0 && !st.slides.some((s) => Math.round(s.x) === x && Math.round(s.y) === y);
const nearCenter = (e) => isInt(e.x) && isInt(e.y);

// 한 칸 이동 (칸 중심에서 칸 중심으로). 도착하면 true
function glide(e, speed, h) {
  const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
  if (d < 1e-9) return true;
  const s = Math.min(d, speed * h);
  e.x += dx / d * s; e.y += dy / d * s;
  if (Math.abs(e.tx - e.x) < 1e-6 && Math.abs(e.ty - e.y) < 1e-6) { e.x = e.tx; e.y = e.ty; return true; }
  return false;
}

// ---------- 블록 ----------
// 펭고가 보고 있는 칸의 블록을 민다: 뒤가 비어 있으면 미끄러지고, 막혀 있으면 부서진다. 맨 바깥 벽이면 벽을 흔든다
function push(st) {
  const p = st.pengo;
  if (!p.alive || p.moving || st.phase !== 'play') return false;
  const cx = Math.round(p.x), cy = Math.round(p.y);
  const bx = cx + DX[p.dir], by = cy + DY[p.dir];
  if (!inside(bx, by)) { shakeWall(st, p.dir); return true; }
  const v = st.grid[by][bx];
  if (!v) return false;
  const nx = bx + DX[p.dir], ny = by + DY[p.dir];
  if (inside(nx, ny) && cellFree(st, nx, ny)) {                      // 미끄러진다 (다이아몬드도 밀 수 있다)
    st.grid[by][bx] = 0;
    const egg = st.eggs.delete(key(bx, by));
    st.slides.push({ x: bx, y: by, dir: p.dir, kind: v, egg, hit: 0 });
    emit(st, { t: 'slide', x: bx, y: by });
    return true;
  }
  if (v === 2) return false;                                         // 다이아몬드는 부술 수 없다
  // 부서진다
  st.grid[by][bx] = 0;
  if (st.eggs.delete(key(bx, by))) { st.score += POINTS.egg; st.stats.eggs++; emit(st, { t: 'egg', x: bx, y: by, pts: POINTS.egg }); }
  else { st.score += POINTS.crumble; st.stats.crumbled++; emit(st, { t: 'crumble', x: bx, y: by, pts: POINTS.crumble }); }
  return true;
}

function shakeWall(st, dir) {
  st.shake = { dir, t: SHAKE_TIME };
  let n = 0;
  for (const b of st.bees) {
    if (b.state !== 'walk' && b.state !== 'stun') continue;
    const x = Math.round(b.x), y = Math.round(b.y);
    const on = dir === 0 ? y === 0 : dir === 2 ? y === ROWS - 1 : dir === 3 ? x === 0 : x === COLS - 1;
    if (on) { b.state = 'stun'; b.stunT = STUN_TIME; n++; }
  }
  emit(st, { t: 'shake', dir, stunned: n });
}

function stunAll(st) { for (const b of st.bees) if (b.state === 'walk' || b.state === 'stun') { b.state = 'stun'; b.stunT = STUN_TIME; } }

// 다이아몬드 세 개가 일직선으로 붙었는지: 한가운데면 10000점, 바깥 벽에 둘 이상 붙었으면 5000점
function checkDiamonds(st) {
  if (st.diamondsDone) return;
  const ds = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (st.grid[y][x] === 2) ds.push([x, y]);
  if (ds.length < 3) return;
  const sameRow = ds.every(([, y]) => y === ds[0][1]), sameCol = ds.every(([x]) => x === ds[0][0]);
  let ok = false;
  if (sameRow) { const xs = ds.map(([x]) => x).sort((a, b) => a - b); ok = xs[1] === xs[0] + 1 && xs[2] === xs[1] + 1; }
  else if (sameCol) { const ys = ds.map(([, y]) => y).sort((a, b) => a - b); ok = ys[1] === ys[0] + 1 && ys[2] === ys[1] + 1; }
  if (!ok) return;
  const atWall = ds.filter(([x, y]) => x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1).length;
  const pts = atWall >= 2 ? POINTS.diamondsWall : POINTS.diamondsMiddle;
  st.diamondsDone = true;
  st.score += pts;
  stunAll(st);
  emit(st, { t: 'diamonds', pts });
}

function updateSlides(st, h) {
  for (const s of st.slides) {
    let rem = SLIDE_SPEED * h, guard = 0;
    while (rem > 1e-9 && !s.done && guard++ < 8) {
      if (isInt(s.x) && isInt(s.y)) {                                          // 칸 한가운데에서: 앞이 막혔으면 멈춘다
        const nx = Math.round(s.x) + DX[s.dir], ny = Math.round(s.y) + DY[s.dir];
        if (!inside(nx, ny) || st.grid[ny][nx] !== 0 || st.slides.some((o) => o !== s && !o.done && Math.round(o.x) === nx && Math.round(o.y) === ny)) { stopSlide(st, s); break; }
      }
      const pos = s.dir % 2 === 1 ? s.x : s.y, sign = DX[s.dir] + DY[s.dir];
      const toNext = sign > 0 ? Math.floor(pos + 1e-9) + 1 - pos : pos - (Math.ceil(pos - 1e-9) - 1);
      const stepLen = Math.min(rem, toNext);
      s.x += DX[s.dir] * stepLen; s.y += DY[s.dir] * stepLen; rem -= stepLen;
      if (isInt(s.x)) s.x = Math.round(s.x);
      if (isInt(s.y)) s.y = Math.round(s.y);
      // 지나가는 Sno-Bee 를 으깬다
      for (const b of st.bees) {
        if (b.state === 'dead' || b.state === 'hatch') continue;
        if (Math.abs(b.x - s.x) < 0.75 && Math.abs(b.y - s.y) < 0.75) { b.state = 'dead'; s.hit++; }
      }
    }
  }
  st.slides = st.slides.filter((s) => !s.done);
}
function stopSlide(st, s) {
  s.done = true;
  const x = Math.round(s.x), y = Math.round(s.y);
  st.grid[y][x] = s.kind;
  if (s.egg) st.eggs.add(key(x, y));
  if (s.hit) {
    const pts = POINTS.crush[Math.min(s.hit, 4) - 1];
    st.score += pts; st.stats.crushed += s.hit;
    emit(st, { t: 'crush', n: s.hit, pts, x, y });
  }
  st.bees = st.bees.filter((b) => b.state !== 'dead');
  emit(st, { t: 'land', x, y });
  checkDiamonds(st);
}

// ---------- Sno-Bee ----------
function hatch(st) {
  const left = [...st.eggs].filter((k) => !st.slides.some((s) => key(Math.round(s.x), Math.round(s.y)) === k));
  if (!left.length) return false;
  const k = left[Math.floor(st.rand() * left.length)];
  const x = k % COLS, y = Math.floor(k / COLS);
  st.eggs.delete(k); st.grid[y][x] = 0;
  st.bees.push({ id: ++st.seq, x, y, tx: x, ty: y, dir: 2, state: 'hatch', hatchT: 0.6, stunT: 0, gnawT: 0, gnaw: null, stuckT: 0, anim: 0 });
  st.hatchedCount++;
  emit(st, { t: 'hatch', x, y });
  return true;
}

function beeSpeed(st) {
  let s = BEE_SPEED + 0.07 * (Math.min(st.round, ROUNDS) - 1);
  if (st.sinceDeath >= SUDDEN_AT) s *= 1.45;
  return s;
}

function updateBees(st, h) {
  const p = st.pengo;
  const dist = p.alive ? distFrom(st.grid, Math.round(p.x), Math.round(p.y), true) : null;
  for (const b of st.bees) {
    b.anim += h;
    if (b.state === 'hatch') { b.hatchT -= h; if (b.hatchT <= 0) b.state = 'walk'; continue; }
    if (b.state === 'stun') { b.stunT -= h; if (b.stunT <= 0) b.state = 'walk'; continue; }
    if (b.state === 'blob') { updateBlob(st, b, h); continue; }
    if (b.state !== 'walk') continue;
    // 이동 중이면 계속 간다
    if (!glide(b, beeSpeed(st), h)) continue;
    const cx = Math.round(b.x), cy = Math.round(b.y);
    // 얼음에 막혀 닿을 길이 없으면 블록을 갉아 부순다
    if (b.gnaw) {
      b.gnawT -= h;
      if (b.gnawT <= 0) { const [gx, gy] = b.gnaw; if (st.grid[gy][gx] === 1) { st.grid[gy][gx] = 0; st.eggs.delete(key(gx, gy)); emit(st, { t: 'gnaw', x: gx, y: gy }); } b.gnaw = null; b.stuckT = 0; }
      continue;
    }
    const opts = [0, 1, 2, 3].filter((d) => cellFree(st, cx + DX[d], cy + DY[d]));
    const reach = dist && dist[key(cx, cy)] >= 0;
    if (!reach) {
      b.stuckT += h;
      if (b.stuckT > 1.2 && p.alive) {                                         // 가장 가까운 얼음을 하나 갉는다 (다이아몬드는 못 부순다)
        const toward = (d) => { const nx = cx + DX[d], ny = cy + DY[d]; return inside(nx, ny) && st.grid[ny][nx] === 1; };
        const ds = [0, 1, 2, 3].filter(toward).sort((a, c) => (Math.abs(cx + DX[a] - p.x) + Math.abs(cy + DY[a] - p.y)) - (Math.abs(cx + DX[c] - p.x) + Math.abs(cy + DY[c] - p.y)));
        if (ds.length) { b.gnaw = [cx + DX[ds[0]], cy + DY[ds[0]]]; b.gnawT = GNAW_TIME; b.dir = ds[0]; continue; }
      }
    }
    if (!opts.length) continue;
    const back = (b.dir + 2) % 4;
    let ways = opts.filter((d) => d !== back); if (!ways.length) ways = opts;
    let pick = ways[Math.floor(st.rand() * ways.length)];
    if (reach && st.rand() > 0.12) {
      let best = null, bd = 1e9;
      for (const d of ways) { const v = dist[key(cx + DX[d], cy + DY[d])]; if (v >= 0 && v < bd) { bd = v; best = d; } }
      if (best !== null) pick = best;
    }
    b.dir = pick; b.tx = cx + DX[pick]; b.ty = cy + DY[pick];
  }
  // 닿으면 펭고가 죽는다
  if (p.alive && p.invuln <= 0) {
    for (const b of st.bees) {
      if ((b.state === 'walk' || b.state === 'blob') && Math.abs(b.x - p.x) < 0.62 && Math.abs(b.y - p.y) < 0.62) { killPengo(st, 'bee'); break; }
    }
  }
  // 기절한 Sno-Bee 위로 걸어가면 밟는다
  if (p.alive) {
    for (const b of st.bees) {
      if (b.state === 'stun' && Math.abs(b.x - p.x) < 0.7 && Math.abs(b.y - p.y) < 0.7) { b.state = 'dead'; st.score += POINTS.stomp; st.stats.stomped++; emit(st, { t: 'stomp', x: b.x, y: b.y, pts: POINTS.stomp }); }
    }
    st.bees = st.bees.filter((b) => b.state !== 'dead');
  }
}

// 블롭: 얼음을 부수며 펭고 쪽으로 곧장 온다
function updateBlob(st, b, h) {
  const p = st.pengo;
  const sp = BEE_SPEED * 1.9;
  if (!p.alive) return;
  if (b.tx === b.x && b.ty === b.y) {
    const dx = p.x - b.x, dy = p.y - b.y;
    const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    const nx = Math.round(b.x) + DX[d], ny = Math.round(b.y) + DY[d];
    if (inside(nx, ny)) {
      if (st.grid[ny][nx] === 1) { st.grid[ny][nx] = 0; st.eggs.delete(key(nx, ny)); emit(st, { t: 'gnaw', x: nx, y: ny }); }
      if (st.grid[ny][nx] === 0) { b.tx = nx; b.ty = ny; b.dir = d; }
    }
  }
  glide(b, sp, h);
}

function killPengo(st, why) {
  const p = st.pengo;
  if (!p.alive) return;
  p.alive = false;
  st.lives--;
  emit(st, { t: 'dead', why, x: p.x, y: p.y });
  st.phase = 'dying'; st.phaseT = 1.6;
}

// ---------- 한 걸음 ----------
// input: { dir: 0~3 또는 null (누르고 있는 방향), push: 이번에 밀기를 눌렀는가 }
function step(st, dt, input) {
  st.events = [];
  let left = dt;
  while (left > 1e-9 && st.phase !== 'over') { const h = Math.min(left, 1 / 60); sub(st, h, input || {}); left -= h; if (input) input.push = false; }
}

function sub(st, h, input) {
  st.time += h;
  const p = st.pengo;
  if (st.shake) { st.shake.t -= h; if (st.shake.t <= 0) st.shake = null; }
  if (st.phase === 'dying') {
    st.phaseT -= h;
    updateSlides(st, h);
    if (st.phaseT <= 0) {
      if (st.lives <= 0) { st.phase = 'over'; emit(st, { t: 'over' }); return; }
      Object.assign(p, { x: START.x, y: START.y, tx: START.x, ty: START.y, dir: 2, moving: false, alive: true, invuln: 2 });
      if (st.grid[START.y][START.x] !== 0) st.grid[START.y][START.x] = 0;
      st.sinceDeath = 0;
      st.phase = 'play';
    }
    return;
  }
  if (st.phase === 'clear') {
    st.phaseT -= h;
    if (st.phaseT <= 0) startRound(st, st.round + 1);
    return;
  }
  st.t += h; st.sinceDeath += h;
  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - h);

  // 펭고
  p.anim += h;
  if (p.moving) {
    if (glide(p, PENGO_SPEED, h)) p.moving = false;
  }
  if (!p.moving && p.alive) {
    const d = input.dir;
    if (d !== null && d !== undefined) {
      p.dir = d;
      const nx = Math.round(p.x) + DX[d], ny = Math.round(p.y) + DY[d];
      if (cellFree(st, nx, ny)) {
        const bee = st.bees.find((b) => b.state === 'stun' && Math.round(b.x) === nx && Math.round(b.y) === ny);
        void bee;
        p.tx = nx; p.ty = ny; p.moving = true;
      }
    }
    if (input.push) push(st);
  }

  // 알이 깨어난다: 처음에는 한꺼번에 나올 수 있는 만큼, 그 뒤로는 Sno-Bee 가 줄면 하나씩
  st.hatchT -= h;
  const active = st.bees.filter((b) => b.state !== 'dead').length;
  if (st.hatchT <= 0 && st.eggs.size > 0 && active < st.maxActive) {
    if (hatch(st)) st.hatchT = st.hatchedCount < st.maxActive ? 0.45 : HATCH_COOL;
    else st.hatchT = 0.5;
  }

  updateSlides(st, h);
  if (st.phase === 'dying') return;
  updateBees(st, h);

  // 오래 끌면 Sno-Bee 가 블롭이 된다. 마지막 한 마리가 남으면 12초 뒤에 블롭이 된다
  const alive = st.bees.filter((b) => b.state === 'walk' || b.state === 'stun');
  if (st.sinceDeath >= BLOB_AT) for (const b of alive) { b.state = 'blob'; emit(st, { t: 'blob' }); }
  if (alive.length === 1 && st.eggs.size === 0 && st.hatchedCount > 1) {
    if (st.lastBlobAt === null) st.lastBlobAt = st.t + LAST_BLOB_DELAY;
    if (st.t >= st.lastBlobAt && alive[0].state === 'walk') { alive[0].state = 'blob'; emit(st, { t: 'blob' }); }
  } else st.lastBlobAt = null;

  // 판 깨기
  if (st.phase === 'play' && st.hatchedCount > 0 && st.eggs.size === 0 && st.bees.length === 0 && !st.slides.length) {
    const sec = Math.floor(st.t);
    const bonus = timeBonus(sec);
    st.score += bonus;
    st.phase = 'clear'; st.phaseT = 3;
    emit(st, { t: 'clear', round: st.round, seconds: sec, bonus });
  }
}

return {
  COLS, ROWS, DX, DY, START, START_LIVES, EGGS, ROUNDS, POINTS, STUN_TIME, SUDDEN_AT, BLOB_AT, MAX_ACTIVE, PENGO_SPEED,
  rng, newGame, startRound, step, push, timeBonus, genGrid, distFrom, hatch, checkDiamonds, shakeWall, killPengo, cellFree,
};
})();
if (typeof module !== 'undefined') module.exports = LOGIC_PENGO;
