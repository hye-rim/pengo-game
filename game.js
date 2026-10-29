'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 펭고: 화면·입력·소리. 규칙(얼음 블록·밀기·Sno-Bee·알·다이아몬드)은 logic.js (LOGIC_PENGO) 에 있고,
// 여기서는 규칙이 남긴 st.events 를 보고 소리·효과·안내를 만든다.
const L = LOGIC_PENGO;
const { COLS, ROWS, DX, DY } = L;
const CELL = 16, HUD = 16, FOOT = 16;
const W = COLS * CELL, FH = ROWS * CELL, CH = HUD + FH + FOOT;       // 208 x 272

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const controls = $('controls');
  const ctrlH = getComputedStyle(controls).display === 'none' ? 0 : controls.offsetHeight + 10;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - ctrlH) / CH);
  const cssW = Math.max(150, Math.floor(W * scale)), cssH = Math.floor(cssW * CH / W);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / CH, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', fit);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('pengoMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.045, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
function noise(dur, vol = 0.08, lowpass = 1500) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const n = Math.floor(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = audio.createBufferSource(), g = audio.createGain(), f = audio.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass; g.gain.value = vol;
    s.buffer = buf; s.connect(f).connect(g).connect(audio.destination); s.start();
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.05) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
let stepTick = 0;
const sfx = {
  step: () => { if ((stepTick++ & 1) === 0) tone(330, 0.03, 'triangle', 0.025); },
  slide: () => tone(700, 0.18, 'sawtooth', 0.03, -400),
  land: () => tone(140, 0.08, 'sine', 0.06, -40),
  crumble: () => noise(0.12, 0.08, 1600),
  egg: () => { noise(0.12, 0.08, 1800); melody([880, 1175], 60, 'sine', 0.06); },
  crush: (n) => { noise(0.25, 0.1, 1200); melody([262, 330, 392, 523, 659].slice(0, 2 + n), 55, 'square', 0.05); },
  shake: () => tone(120, 0.35, 'sawtooth', 0.05, 60),
  stomp: () => tone(900, 0.07, 'sine', 0.05, -400),
  hatch: () => tone(500, 0.1, 'triangle', 0.04, 300),
  diamonds: () => melody([523, 659, 784, 1047, 1319, 1568], 80, 'sine', 0.07),
  dead: () => melody([523, 392, 330, 262, 196], 130, 'sawtooth', 0.06),
  clear: () => melody([523, 659, 784, 1047, 1319], 100),
  start: () => melody([392, 523, 659, 784], 100),
  over: () => melody([392, 330, 262, 196], 220, 'sawtooth', 0.06),
  blob: () => tone(110, 0.3, 'sawtooth', 0.05, -30),
};

// ---------- 상태 ----------
let G = L.newGame();
let state = 'title';                           // title · play · paused · over
let pausedFrom = null;
let best = Number(store.get('pengoBest')) || 0;
let fxs = [];
let banner = { text: '', sub: '', t: 0, color: '#ffe14a' };
let clock = 0, lastCell = null, moved = 0;

/* @test-hooks:start */
window.__pg = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, step: (dt) => update(dt) };
/* @test-hooks:end */

// ---------- 입력 ----------
const held = [];
const KEY_DIR = { ArrowUp: 0, w: 0, W: 0, ArrowRight: 1, d: 1, D: 1, ArrowDown: 2, s: 2, S: 2, ArrowLeft: 3, a: 3, A: 3 };
const PUSH_KEYS = [' ', 'z', 'Z', 'x', 'X', 'j', 'J'];
let pushQueued = false, padDir = null;
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key in KEY_DIR) { e.preventDefault(); const d = KEY_DIR[e.key]; const i = held.indexOf(d); if (i >= 0) held.splice(i, 1); held.push(d); return; }
  if (PUSH_KEYS.includes(e.key)) {
    e.preventDefault();
    if (state === 'title' || state === 'over') { if (!e.repeat && e.key === ' ') onOverlayButton(); return; }
    if (state === 'paused') { if (!e.repeat) resume(); return; }
    if (!e.repeat) pushQueued = true;
    return;
  }
  if (e.key === 'Enter') { if (state === 'title' || state === 'over') onOverlayButton(); else if (state === 'paused') resume(); return; }
  if (e.key === 'p' || e.key === 'P') { if (state === 'paused') resume(); else pause(); }
  else if (e.key === 'm' || e.key === 'M') toggleMute();
});
addEventListener('keyup', (e) => { if (e.key in KEY_DIR) { const i = held.indexOf(KEY_DIR[e.key]); if (i >= 0) held.splice(i, 1); } });

const pad = $('pad');
const PAD_DIRS = [0, 2, 3, 1];                  // 화면의 ▲ ▼ ◀ ▶ 가 가리키는 방향
function padFrom(e) {
  const r = pad.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const knob = pad.querySelector('b'), lim = r.width * 0.2;
  knob.style.transform = `translate(${Math.max(-lim, Math.min(lim, dx))}px, ${Math.max(-lim, Math.min(lim, dy))}px)`;
  padDir = Math.max(Math.abs(dx), Math.abs(dy)) < r.width * 0.12 ? null : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
  pad.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', padDir !== null && PAD_DIRS[i] === padDir));
}
const padEnd = () => { padDir = null; pad.querySelector('b').style.transform = ''; pad.querySelectorAll('i').forEach((el) => el.classList.remove('on')); };
pad.addEventListener('pointerdown', (e) => { e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (_) {} padFrom(e); });
pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') padFrom(e); });
pad.addEventListener('pointerup', padEnd);
pad.addEventListener('pointercancel', padEnd);
const pushBtn = $('pushBtn');
pushBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); if (state === 'play') pushQueued = true; pushBtn.classList.add('on'); });
const pushOff = () => pushBtn.classList.remove('on');
pushBtn.addEventListener('pointerup', pushOff);
pushBtn.addEventListener('pointercancel', pushOff);

function readInput() {
  const d = padDir !== null ? padDir : held.length ? held[held.length - 1] : null;
  const input = { dir: d, push: pushQueued };
  pushQueued = false;
  return input;
}

// ---------- 흐름 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.querySelector('button').onclick = onOverlayButton; }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function setBanner(text, sub = '', color = '#ffe14a', t = 2.2) { banner = { text, sub, t, color }; }
function startGame() {
  G = L.newGame();
  if (/[?&]tutorial=1/.test(location.search)) G.lives = 9;               // 튜토리얼에서는 잡혀도 계속 해 볼 수 있게
  fxs = []; held.length = 0; lastCell = null; moved = 0; pushQueued = false;
  state = 'play';
  setBanner('ROUND 1', '얼음을 밀어 Sno-Bee 를 으깨요');
  hideOverlay();
  sfx.start();
}
function onOverlayButton() { if (state === 'paused') resume(); else startGame(); }
function pause() {
  if (state !== 'play') return;
  pausedFrom = state; state = 'paused';
  showOverlay('<h2>일시정지</h2><p>P 키나 아래 버튼으로 계속해요</p><button id="startBtn">계속하기</button>');
}
function resume() { if (state !== 'paused') return; state = pausedFrom; hideOverlay(); }
function gameOver() {
  state = 'over';
  const rec = G.score > best;
  if (rec) { best = G.score; store.set('pengoBest', String(best)); }
  sfx.over();
  showOverlay(`<h2>GAME OVER</h2><p class="big">${G.score.toLocaleString()}점</p><p>${G.round}라운드 · 으깬 Sno-Bee ${G.stats.crushed}마리${rec ? '<br>🏆 최고 기록!' : ''}</p><button id="startBtn">다시 하기</button>`);
}

function handleEvents() {
  for (const e of G.events) {
    if (e.t === 'slide') { sfx.slide(); tutorialSignal('push'); }
    else if (e.t === 'land') sfx.land();
    else if (e.t === 'crumble') { sfx.crumble(); tutorialSignal('crumble'); fxs.push({ kind: 'chips', x: e.x, y: e.y, t: 0, life: 0.4 }, { kind: 'text', x: e.x, y: e.y, t: 0, life: 0.8, text: String(e.pts) }); }
    else if (e.t === 'egg') { sfx.egg(); tutorialSignal('egg'); fxs.push({ kind: 'chips', x: e.x, y: e.y, t: 0, life: 0.4 }, { kind: 'text', x: e.x, y: e.y, t: 0, life: 1, text: String(e.pts), color: '#ffe14a' }); }
    else if (e.t === 'crush') { sfx.crush(e.n); tutorialSignal('crush'); fxs.push({ kind: 'text', x: e.x, y: e.y, t: 0, life: 1.2, text: String(e.pts), color: '#ffb04a' }); }
    else if (e.t === 'shake') { sfx.shake(); tutorialSignal('shake'); }
    else if (e.t === 'stomp') { sfx.stomp(); fxs.push({ kind: 'text', x: e.x, y: e.y, t: 0, life: 0.8, text: String(e.pts) }); }
    else if (e.t === 'hatch') { sfx.hatch(); fxs.push({ kind: 'chips', x: e.x, y: e.y, t: 0, life: 0.4 }); }
    else if (e.t === 'gnaw') fxs.push({ kind: 'chips', x: e.x, y: e.y, t: 0, life: 0.3 });
    else if (e.t === 'diamonds') { sfx.diamonds(); tutorialSignal('diamonds'); setBanner('DIAMOND!', `+${e.pts}`, '#ffe14a', 2); }
    else if (e.t === 'blob') { sfx.blob(); }
    else if (e.t === 'dead') { sfx.dead(); fxs.push({ kind: 'text', x: e.x, y: e.y, t: 0, life: 1, text: '😵' }); }
    else if (e.t === 'clear') { sfx.clear(); setBanner('ROUND CLEAR', `${e.seconds}초 · 보너스 ${e.bonus}`, '#7fe08a', 3); }
    else if (e.t === 'round') { if (e.round > 1) { setBanner(`ROUND ${e.round}`, '', '#ffe14a', 2); sfx.start(); } }
    else if (e.t === 'over') gameOver();
  }
}

function update(dt) {
  clock += dt;
  if (state !== 'play') return;
  L.step(G, dt, readInput());
  handleEvents();
  const p = G.pengo;
  const cell = `${Math.round(p.x)},${Math.round(p.y)}`;
  if (lastCell !== null && cell !== lastCell) { moved++; sfx.step(); if (moved >= 2) tutorialSignal('move'); }
  lastCell = cell;
  banner.t = Math.max(0, banner.t - dt);
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter((f) => f.t < f.life);
}

// ---------- 그리기 ----------
const px = (x) => x * CELL, py = (y) => HUD + y * CELL;
function drawIce(x, y, kind, egg, flashing) {
  const X = Math.round(px(x)), Y = Math.round(py(y));
  if (kind === 2) {                                                               // 다이아몬드 블록
    ctx.fillStyle = '#b8860b'; ctx.fillRect(X, Y, CELL, CELL);
    ctx.fillStyle = '#ffd23a'; ctx.fillRect(X + 1, Y + 1, CELL - 2, CELL - 2);
    ctx.fillStyle = Math.floor(clock * 6) % 2 ? '#fff6a8' : '#ffe566'; ctx.beginPath(); ctx.moveTo(X + 8, Y + 2); ctx.lineTo(X + 14, Y + 8); ctx.lineTo(X + 8, Y + 14); ctx.lineTo(X + 2, Y + 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(X + 6, Y + 5, 2, 2);
    return;
  }
  ctx.fillStyle = flashing && egg ? '#ffe9a0' : '#7fc4f0'; ctx.fillRect(X, Y, CELL, CELL);
  ctx.fillStyle = flashing && egg ? '#fff4c8' : '#b8e4ff'; ctx.fillRect(X + 1, Y + 1, CELL - 3, CELL - 3);
  ctx.fillStyle = '#eaf8ff'; ctx.fillRect(X + 2, Y + 2, CELL - 6, 2); ctx.fillRect(X + 2, Y + 2, 2, CELL - 6);
  ctx.fillStyle = '#5aa0d8'; ctx.fillRect(X, Y + CELL - 2, CELL, 2); ctx.fillRect(X + CELL - 2, Y, 2, CELL);
}
function drawField() {
  ctx.fillStyle = '#10203a'; ctx.fillRect(0, 0, W, CH);
  // 눈 덮인 바닥
  ctx.fillStyle = '#e8f4ff'; ctx.fillRect(0, HUD, W, FH);
  ctx.fillStyle = '#d4e8fa';
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if ((x + y) % 2 === 0) ctx.fillRect(px(x), py(y), CELL, CELL);
  const flashing = G.t < 3.2 && Math.floor(clock * 5) % 2 === 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const v = G.grid[y][x];
    if (v) drawIce(x, y, v, G.eggs.has(y * COLS + x), flashing);
  }
  for (const s of G.slides) drawIce(s.x, s.y, s.kind, s.egg, false);
  // 바깥 벽 (흔들리면 그쪽이 떨린다)
  const sh = G.shake;
  const jit = sh ? Math.sin(clock * 90) * 2 : 0;
  ctx.fillStyle = '#2a6ae8';
  const bw = 3;
  const wall = (dir, x, y, w, h) => { ctx.fillRect(x + (sh && sh.dir === dir && (dir % 2) ? jit : 0), y + (sh && sh.dir === dir && !(dir % 2) ? jit : 0), w, h); };
  wall(0, 0, HUD, W, bw); wall(2, 0, HUD + FH - bw, W, bw); wall(3, 0, HUD, bw, FH); wall(1, W - bw, HUD, bw, FH);
  ctx.fillStyle = '#8ab8ff';
  ctx.fillRect(0, HUD, W, 1); ctx.fillRect(0, HUD, 1, FH);
}
function drawPengo() {
  const p = G.pengo;
  if (!p.alive) return;
  if (p.invuln > 0 && Math.floor(clock * 14) % 2 === 0) return;
  const x = px(p.x) + CELL / 2, y = py(p.y) + CELL / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(p.dir * Math.PI / 2);
  const step = p.moving ? Math.floor(clock * 14) % 2 : 0;
  ctx.fillStyle = '#e8453a'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 7, 0, 0, 7); ctx.fill();                 // 몸
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, 1, 3.6, 4.6, 0, 0, 7); ctx.fill();                // 배
  ctx.fillStyle = '#ffd23a'; ctx.fillRect(-1.5, -9, 3, 3);                                                   // 부리
  ctx.fillStyle = '#111'; ctx.fillRect(-3.5, -5, 1.5, 1.5); ctx.fillRect(2, -5, 1.5, 1.5);                  // 눈
  ctx.fillStyle = '#ffd23a'; ctx.fillRect(-6 + step, 5, 4, 2); ctx.fillRect(2 - step, 5, 4, 2);              // 발
  ctx.restore();
}
function drawBee(b) {
  const x = px(b.x) + CELL / 2, y = py(b.y) + CELL / 2;
  ctx.save();
  ctx.translate(x, y);
  if (b.state === 'hatch') {                                                                                   // 알껍데기
    ctx.fillStyle = '#fff3c8'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#e8c860'; ctx.fillRect(-4, 0, 8, 1);
  } else if (b.state === 'stun') {
    ctx.rotate(Math.sin(clock * 20) * 0.3);
    ctx.fillStyle = '#c8d8e8'; ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#7a8aa0'; ctx.fillRect(-4, -2, 3, 3); ctx.fillRect(1, -2, 3, 3);
    ctx.fillStyle = '#ffe14a'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('★', Math.cos(clock * 8) * 5, -9);
  } else if (b.state === 'blob') {
    ctx.fillStyle = '#9a4ae8'; ctx.beginPath(); ctx.ellipse(0, 1, 8, 7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(-4, -2, 3, 3); ctx.fillRect(1, -2, 3, 3);
    ctx.fillStyle = '#111'; ctx.fillRect(-3, -1, 1.5, 2); ctx.fillRect(2, -1, 1.5, 2);
  } else {
    const wob = Math.sin(b.anim * 14) * 0.6;
    ctx.fillStyle = '#3ad8c0'; ctx.beginPath(); ctx.ellipse(0, 1 + wob, 6.5, 6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#1a9a88'; ctx.fillRect(-6, 4 + wob, 12, 2);
    ctx.fillStyle = '#fff'; ctx.fillRect(-4, -3, 3.5, 3.5); ctx.fillRect(1, -3, 3.5, 3.5);
    ctx.fillStyle = '#111'; ctx.fillRect(-3 + DX[b.dir] * 0.8, -2 + DY[b.dir] * 0.8, 1.6, 1.8); ctx.fillRect(2 + DX[b.dir] * 0.8, -2 + DY[b.dir] * 0.8, 1.6, 1.8);
    if (b.gnaw) { ctx.fillStyle = '#fff'; ctx.fillRect(-2, 3, 4, 2); }
  }
  ctx.restore();
}
function drawFx() {
  for (const f of fxs) {
    const k = f.t / f.life, x = px(f.x) + CELL / 2, y = py(f.y) + CELL / 2;
    if (f.kind === 'chips') { ctx.fillStyle = `rgba(190,230,255,${1 - k})`; for (let i = 0; i < 6; i++) { const a = i * 1.05; ctx.fillRect(x + Math.cos(a) * k * 14 - 1.5, y + Math.sin(a) * k * 14 - 1.5, 3, 3); } }
    else if (f.kind === 'text') { ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.fillStyle = f.color || '#fff'; ctx.strokeText(f.text, x, y - k * 12); ctx.fillText(f.text, x, y - k * 12); }
  }
}
function drawHud() {
  ctx.fillStyle = '#0a1426'; ctx.fillRect(0, 0, W, HUD); ctx.fillRect(0, HUD + FH, W, FOOT);
  ctx.textBaseline = 'middle'; ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'left'; ctx.fillStyle = '#ff6a6a'; ctx.fillText('1UP', 4, 8); ctx.fillStyle = '#fff'; ctx.fillText(String(G.score), 24, 8);
  ctx.textAlign = 'center'; ctx.fillStyle = '#7fd0ff'; ctx.fillText('HI', 100, 8); ctx.fillStyle = '#fff'; ctx.fillText(String(Math.max(best, G.score)), 122, 8);
  ctx.textAlign = 'right'; ctx.fillStyle = '#ffe14a'; ctx.fillText(`R${G.round}`, W - 50, 8);
  // 아래 줄: 남은 펭고(빨간 네모) · 아직 안 깬 알(노란 네모) · 시간
  for (let i = 0; i < Math.max(0, G.lives - (G.pengo.alive ? 1 : 0)); i++) { ctx.fillStyle = '#e8453a'; ctx.fillRect(4 + i * 11, HUD + FH + 4, 8, 8); }
  for (let i = 0; i < G.eggs.size; i++) { ctx.fillStyle = '#ffd23a'; ctx.fillRect(W - 12 - i * 10, HUD + FH + 4, 8, 8); }
  ctx.textAlign = 'center'; ctx.fillStyle = G.sinceDeath >= L.SUDDEN_AT ? '#ff7a5a' : '#bcd8ff'; ctx.fillText(`${Math.floor(G.t)}s${G.sinceDeath >= L.SUDDEN_AT ? ' ⚡' : ''}`, W / 2, HUD + FH + 8);
}
function draw() {
  drawField();
  for (const b of G.bees) drawBee(b);
  drawPengo();
  drawFx();
  drawHud();
  if (banner.t > 0) {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, HUD + FH / 2 - 26, W, banner.sub ? 38 : 24);
    ctx.fillStyle = banner.color; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, W / 2, HUD + FH / 2 - 15);
    if (banner.sub) { ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, W / 2, HUD + FH / 2 + 1); }
  }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('pengoMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('startBtn').onclick = onOverlayButton;
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
requestAnimationFrame(frame);
