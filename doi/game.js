// CỔNG CHỈ VỪA MỘT ĐỨA: a two-player rage game on one keyboard. Help each other through, then only one gets the gate.
// The game also remembers where each player likes to land and leaves a trap there, for that player only.
(() => {
'use strict';
const T = 40, VW = 960, VH = 540, ROWS = 14;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function rng(seed) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ============================================================ levels
// One screen per level (24 x 14 tiles). Tiles: '#' ground, '=' plank, '^' spikes, 'F' falls shortly after being stepped on.
// Plates hold doors and bridges open while someone stands on them. Both players must light the twin lantern (checkpoint);
// after that the gate is live and only the first one through scores.
const NAMES = ['Bé Sao', 'Bé Trăng'];
function level(name, build) {
  const w = 24, g = Array.from({ length: ROWS }, () => Array(w).fill(' '));
  const L = { name, w, g, plates: [], doors: [], bridges: [], spawn: [[1.5, 9], [3, 9]], lines: {} };
  const m = {
    ground(a, b, top = 10) { for (let x = a; x <= b; x++) for (let y = top; y < ROWS; y++) g[y][x] = '#'; },
    row(a, b, y, c) { for (let x = a; x <= b; x++) g[y][x] = c; },
    plate(id, x, y = 9) { L.plates.push({ id, x, y }); },
    door(id, x, y0, h, o = {}) { L.doors.push({ id, x, y0, h, ...o }); },
    bridge(id, a, b, y) { L.bridges.push({ id, a, b, y }); },
  };
  build(m, L);
  return L;
}
const LEVELS = [
  level('Kiệu nhau', (m, L) => {
    m.ground(0, 17); m.ground(20, 23); m.row(6, 8, 7, '=');
    m.door('d', 10, 6, 4); m.plate('d', 13);
    L.check = [15.5, 9]; L.gate = [22, 9];
    L.lines = { start: 'Hai đứa cùng lạc hả? Vui đây. Tường cao lắm, một đứa phải làm ghế cho đứa kia trèo.', lit: 'Đèn đôi sáng rồi. À, quên nói: cổng hội chỉ vừa một đứa thôi.' };
  }),
  level('Giữ cửa giùm', (m, L) => {
    m.ground(0, 23); m.door('d', 8, 6, 4); m.plate('d', 3); m.plate('d', 11);
    m.row(19, 22, 7, '=');
    L.check = [14.5, 9]; L.gate = [21, 6];
    L.standoff = { after: 16, tiles: [[17, 9, '#'], [18, 9, '#'], [18, 8, '#']], say: 'Đứng nhìn nhau hoài vậy? Thôi, tôi kê bậc cho.' };
    L.lines = { start: 'Một đứa giữ cửa, một đứa đi qua. Rồi đổi lại. Tin nhau chút đi.', lit: 'Cổng ở trên cao kìa. Ai làm ghế cho ai đây?' };
  }),
  level('Cầu chờ nhau', (m, L) => {
    m.ground(0, 6); m.ground(7, 15, 12); m.row(7, 15, 11, '^'); m.ground(16, 23);
    m.bridge('b', 7, 15, 10); m.plate('b', 4); m.plate('b', 18);
    L.check = [21, 9]; L.gate = [1, 9]; L.spawn = [[1.5, 9], [5.4, 9]];
    L.standoff = { after: 14, force: 'b', say: 'Thôi, tôi giữ cầu giùm. Chạy đi.' };
    L.lines = { start: 'Cầu chỉ có khi bạn mình đứng trên phiến đá. Đứa đứng đá đừng bước xuống nha.', lit: 'Ấy, cổng hội ở bờ bên kia cơ. Ai giữ cầu cho ai về?' };
  }),
  level('Hai đứa cùng đạp', (m, L) => {
    m.ground(0, 14); m.row(15, 17, 10, 'F'); m.ground(18, 23);
    m.door('d', 9, 6, 4, { both: 2.6 }); m.plate('d', 3); m.plate('d', 6);
    L.check = [12, 9]; L.gate = [21, 9];
    L.lines = { start: 'Cửa này hai đứa cùng đạp mới mở, mà mở có chút xíu thôi. Đứa đứng gần cửa lợi hơn đó.', lit: 'Sàn phía trước mục lắm. Đứa đi sau ráng chịu.' };
  }),
  level('Cổng cuối', (m, L) => {
    m.ground(0, 23); m.plate('g', 7); m.plate('g', 16);
    L.gate = [11.5, 9]; L.finale = true; L.spawn = [[2, 9], [21, 9]];
    L.lines = { start: 'Cổng cuối. Vẫn chỉ vừa một đứa thôi. Hai đứa đạp hai phiến đá thì nó mở.' };
  }),
];
const DEATH_LINES = {
  pit: ['%s rơi rồi. Cả hai về lại đầu màn nhé.', 'Hố đó có sẵn mà, %s.'],
  spike: ['Chông chờ %s nãy giờ.', '%s ơi, chông không phải chỗ đáp.'],
  trap: ['Cái đó tôi để riêng cho %s. Chỗ quen của bé mà.', '%s lại đáp đúng chỗ cũ. Tôi biết ngay.'],
};

// ============================================================ audio (all synthesised)
const AU = { ctx: null, on: true, master: null };
function audioInit() {
  if (AU.ctx) { AU.ctx.resume(); return; }
  try { AU.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  AU.master = AU.ctx.createGain(); AU.master.gain.value = AU.on ? 0.5 : 0; AU.master.connect(AU.ctx.destination);
  const d = AU.ctx.createDelay(); d.delayTime.value = 0.27; const fb = AU.ctx.createGain(); fb.gain.value = 0.28;
  AU.echo = AU.ctx.createGain(); AU.echo.gain.value = 0.35; AU.echo.connect(d); d.connect(fb); fb.connect(d); d.connect(AU.master);
  musicTick();
}
function tone(f, dur, type = 'triangle', vol = 0.3, slide = 0, when = 0, echo = false) {
  if (!AU.ctx) return;
  const t = AU.ctx.currentTime + when, o = AU.ctx.createOscillator(), g = AU.ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(AU.master); if (echo) g.connect(AU.echo);
  o.start(t); o.stop(t + dur + 0.03);
}
function noise(dur, vol = 0.3, freq = 1200) {
  if (!AU.ctx) return;
  const n = Math.floor(AU.ctx.sampleRate * dur), b = AU.ctx.createBuffer(1, n, AU.ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const s = AU.ctx.createBufferSource(); s.buffer = b;
  const f = AU.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = AU.ctx.createGain(); g.gain.value = vol; s.connect(f); f.connect(g); g.connect(AU.master); s.start();
}
const SFX = {
  jump() { tone(420, 0.16, 'triangle', 0.22, 1.9); },
  land() { noise(0.07, 0.16, 500); },
  die() { tone(520, 0.4, 'sawtooth', 0.2, 0.18); noise(0.3, 0.3, 900); },
  boom() { noise(0.5, 0.6, 700); tone(110, 0.4, 'sine', 0.5, 0.4); },
  crack() { noise(0.12, 0.3, 2400); tone(180, 0.1, 'square', 0.08, 0.6); },
  pop() { tone(900, 0.07, 'square', 0.1, 0.5); noise(0.05, 0.2, 3000); },
  blip(i) { tone(300 + (i % 5) * 34, 0.035, 'sine', 0.05); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, 'triangle', 0.22, 0, i * 0.09, true)); },
  bridge(i) { tone(392 * Math.pow(2, [0, 2, 4, 7, 9][i % 5] / 12), 0.5, 'sine', 0.12, 0, 0, true); },
  whoosh() { noise(0.35, 0.2, 1600); },
};
// A slow pentatonic line, plucked like a zither, with a soft drone underneath.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
const TUNE = [4, 3, 1, 0, 1, 3, 4, -1, 5, 4, 3, 1, 3, -1, 1, 0, 4, 5, 7, 5, 4, 3, 4, -1, 1, 3, 1, 0, -1, 0, 1, -1];
let musicStep = 0;
function musicTick() {
  if (!AU.ctx) return;
  const n = TUNE[musicStep % TUNE.length];
  if (n >= 0 && G.state !== 'menu') tone(293.66 * Math.pow(2, SCALE[n] / 12), 0.9, 'triangle', 0.075, 0, 0, true);
  if (musicStep % 8 === 0) tone(73.42 * (musicStep % 16 === 0 ? 1 : 1.5), 2.6, 'sine', 0.09);
  musicStep++;
  setTimeout(musicTick, G.invertNow ? 260 : 400);
}

// ============================================================ state
const cv = $('c'), cx = cv.getContext('2d');
const G = { state: 'menu', li: 0, time: 0, shake: 0, flash: 0, invertNow: false, betray: [0, 0], falls: [0, 0], score: [0, 0], lies: 0 };
const mem = LEVELS.map(() => ({ habit: [new Map(), new Map()], traps: [], attempts: 0, said: new Set() }));
const KEYS = [{ l: 'KeyA', r: 'KeyD', j: 'KeyW' }, { l: 'ArrowLeft', r: 'ArrowRight', j: 'ArrowUp' }];
const COL = ['#ffd76a', '#9fd0ff'];
const PL = [0, 1].map((i) => ({ i, x: 0, y: 0, vx: 0, vy: 0, w: 22, h: 28, ground: false, coyote: 0, buffer: 0, jumpWas: false, face: 1, walk: 0, sq: 0, dead: false, respawn: 0, dx: 0, inGate: false }));
let S = null;
const parts = [];
const keys = new Set();

function loadLevel(i) {
  G.li = i;
  const L = LEVELS[i];
  S = { L, g: L.g.map((r) => r.slice()), doors: L.doors.map((d) => ({ ...d, open: 0, latch: 0 })), bridges: L.bridges.map((b) => ({ ...b, on: false, a0: 0, forced: false })),
    plates: L.plates.map((p) => ({ ...p, down: [false, false], lastOff: [-9, -9] })), lit: [false, false], phase: 'A', tB: 0, fallers: [], timers: {}, over: 0, failT: 0, standoffDone: false, gateOpen: 0, both: 0 };
  // whoever is ahead on points starts further back
  const lead = G.score[0] === G.score[1] ? -1 : G.score[0] > G.score[1] ? 0 : 1;
  PL.forEach((p, k) => {
    const sp = L.spawn[lead === -1 ? k : (k === lead ? 0 : 1)];
    Object.assign(p, { x: sp[0] * T - p.w / 2, y: sp[1] * T + T - p.h, vx: 0, vy: 0, ground: false, dead: false, respawn: 0, inGate: false, face: 1, sq: 0 });
  });
  for (const t of mem[i].traps) t.pop = 0;
  $('lvln').textContent = `MÀN ${i + 1} / ${LEVELS.length}`; $('lvlt').textContent = L.name;
  hud(); makeBackdrop(i);
}
function hud() { $('s0').textContent = G.score[0]; $('s1').textContent = G.score[1]; }
function line(key, text, o = {}) { const m = mem[G.li]; if (m.said.has(key)) return; m.said.add(key); say(text, o); }

// ============================================================ physics
const SOLID = { '#': 1, '=': 1, 'F': 1 };
const tile = (tx, ty) => (ty < 0 || ty >= ROWS || tx < 0 || tx >= 24 ? ' ' : S.g[ty][tx]);
function solids(x, y, w, h) {
  const out = [];
  for (let ty = Math.floor(y / T); ty <= Math.floor((y + h - 0.01) / T); ty++) for (let tx = Math.floor(x / T); tx <= Math.floor((x + w - 0.01) / T); tx++) {
    const c = tile(tx, ty);
    if (SOLID[c]) out.push({ x: tx * T, y: ty * T, w: T, h: c === '=' || c === 'F' ? 16 : T, tx, ty, c });
  }
  for (const d of S.doors) { const top = (d.y0 + d.h * d.open) * T, bot = (d.y0 + d.h) * T; if (bot - top > 2) out.push({ x: d.x * T + 6, y: top, w: T - 12, h: bot - top }); }
  for (const b of S.bridges) if (b.on) out.push({ x: b.a * T, y: b.y * T, w: (b.b - b.a + 1) * T, h: 14 });
  return out.filter((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);
}
function burst(x, y, n, col, sp = 220) { for (let i = 0; i < n; i++) { const a = rnd(0, 6.283), v = rnd(0.2, 1) * sp; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * 0.35, life: rnd(0.3, 0.9), max: 0.9, col, r: rnd(1.5, 4), grav: 500 }); } }

function die(p, cause) {
  if (p.dead || S.over || S.failT) return;
  p.dead = true; G.falls[p.i]++; G.shake = 9; G.flash = 0.3; SFX.die();
  burst(p.x + p.w / 2, p.y + p.h / 2, 24, COL[p.i], 300);
  if (S.phase === 'B') { p.respawn = 1.2; say(pick(['%s rớt lại rồi.', '%s ngã, cổng thì vẫn mở.']).replace('%s', NAMES[p.i]), { now: true, red: true }); return; }
  // before the twin lantern is lit, one fall sends both back
  S.failT = 1.0;
  const o = PL[1 - p.i], m = mem[G.li];
  const dropped = S.plates.some((pl) => G.time - pl.lastOff[o.i] < 0.7);
  if (dropped && cause !== 'trap') { G.betray[o.i]++; say(`Chưa tới lúc đâu, ${NAMES[o.i]}. Phản sớm quá, cả hai làm lại.`, { now: true, red: true }); }
  else say(pick(DEATH_LINES[cause] || DEATH_LINES.pit).replace('%s', NAMES[p.i]), { now: true, red: true });
  m.attempts++;
  // remember: each player's favourite landing tile becomes a trap that only reacts to that player
  PL.forEach((q) => {
    if (m.traps.filter((t) => t.owner === q.i).length >= 2) return;
    let best = null, n = 1;
    for (const [key, c] of m.habit[q.i]) if (c > n && !m.traps.some((t) => t.key === key)) { best = key; n = c; }
    if (!best) return;
    const [tx, ty] = best.split(',').map(Number);
    m.traps.push({ key: best, tx, ty, owner: q.i, pop: 0 });
    m.habit[q.i].delete(best);
    say(`${NAMES[q.i]} hay đáp đúng một chỗ ghê. Tôi nhớ rồi, có để quà ở đó.`, {});
  });
}

function stepPlayer(p, dt) {
  const L = S.L;
  if (p.dead) { if (p.respawn > 0) { p.respawn -= dt; if (p.respawn <= 0) { p.dead = false; p.x = L.check[0] * T - p.w / 2; p.y = L.check[1] * T + T - p.h - 2; p.vx = p.vy = 0; } } return; }
  if (p.inGate) return;
  const K = KEYS[p.i], bot = G.bot && G.bot[p.i];
  const l = bot ? bot.l : keys.has(K.l), r = bot ? bot.r : keys.has(K.r), j = bot ? bot.j : keys.has(K.j);
  const dir = (r ? 1 : 0) - (l ? 1 : 0);
  const acc = p.ground ? 2600 : 1700;
  p.vx += clamp(dir * 250 - p.vx, -acc * dt, acc * dt);
  if (dir) p.face = dir;
  p.coyote = p.ground ? 0.09 : p.coyote - dt;
  p.buffer = j && !p.jumpWas ? 0.11 : p.buffer - dt;
  if (p.buffer > 0 && p.coyote > 0) { p.vy = -660; p.coyote = 0; p.buffer = 0; p.ground = false; p.sq = -0.35; SFX.jump(); }
  if (!j && p.vy < -220) p.vy = -220;
  p.jumpWas = j;
  p.vy = Math.min(p.vy + 2100 * dt, 900);
  const x0 = p.x;
  p.x += p.vx * dt;
  // planks are one-way: you can jump up through them and land on top
  for (const q of solids(p.x, p.y, p.w, p.h)) { if (q.c === '=' || q.c === 'F') continue; if (p.vx > 0) p.x = q.x - p.w; else if (p.vx < 0) p.x = q.x + q.w; p.vx = 0; }
  p.x = clamp(p.x, 0, 24 * T - p.w);
  const was = p.ground, vy0 = p.vy, feet0 = p.y + p.h;
  p.y += p.vy * dt; p.ground = false;
  for (const q of solids(p.x, p.y, p.w, p.h)) {
    if ((q.c === '=' || q.c === 'F') && (p.vy <= 0 || feet0 > q.y + 1)) continue;
    if (p.vy > 0) { p.y = q.y - p.h; p.ground = true; if (q.c === 'F' && !S.timers[q.tx + ',' + q.ty]) { S.timers[q.tx + ',' + q.ty] = 0.26; SFX.crack(); } }
    else if (p.vy < 0) p.y = q.y + q.h;
    p.vy = 0;
  }
  // riding on the other player's head
  const o = PL[1 - p.i];
  if (!o.dead && !o.inGate && vy0 >= 0 && p.x + p.w > o.x + 3 && p.x < o.x + o.w - 3 && feet0 <= o.y + 6 && p.y + p.h >= o.y) { p.y = o.y - p.h; p.vy = 0; p.ground = true; p.x += o.dx; }
  if (p.ground && !was && vy0 > 250) {
    p.sq = 0.4; SFX.land();
    if (S.phase === 'A') { const tx = Math.floor((p.x + p.w / 2) / T), ty = Math.floor((p.y + p.h + 2) / T); if (tile(tx, ty) === '#' && !L.plates.some((q) => q.x === tx) && Math.abs(tx - L.spawn[0][0]) > 1.5 && Math.abs(tx - L.spawn[1][0]) > 1.5) { const k = tx + ',' + ty, h = mem[G.li].habit[p.i]; h.set(k, (h.get(k) || 0) + 1); } }
  }
  if (p.ground) p.walk += Math.abs(p.vx) * dt * 0.06;
  p.dx = p.x - x0;
  p.sq = lerp(p.sq, 0, Math.min(1, dt * 12));
  // hazards
  if (p.y > VH + 50) return die(p, 'pit');
  const fy = p.y + p.h;
  for (let tx = Math.floor((p.x + 4) / T); tx <= Math.floor((p.x + p.w - 4) / T); tx++) for (let ty = Math.floor(p.y / T); ty <= Math.floor((fy - 1) / T); ty++) if (tile(tx, ty) === '^' && fy > ty * T + 18) return die(p, 'spike');
  for (const t of mem[G.li].traps) {
    if (t.owner !== p.i) continue;
    const near = Math.abs((p.x + p.w / 2) / T - (t.tx + 0.5)) < 1.5 && fy <= t.ty * T + 2 && fy > t.ty * T - 110;
    t.pop = clamp(t.pop + (near ? dt * 9 : -dt * 2), 0, 1);
    if (near && t.pop < 0.2 && t.pop > 0) SFX.pop();
    if (t.pop > 0.7 && p.x + p.w - 4 > t.tx * T && p.x + 4 < (t.tx + 1) * T && fy > t.ty * T - 20) return die(p, 'trap');
  }
}

function update(dt) {
  G.time += dt;
  const L = S.L;
  if (S.failT > 0) { S.failT -= dt; if (S.failT <= 0) loadLevel(G.li); tickFx(dt); return; }
  if (S.over > 0) { S.over -= dt; if (S.over <= 0) nextLevel(); tickFx(dt); return; }
  line('start', L.lines.start);
  for (const p of PL) stepPlayer(p, dt);
  // plates
  for (const pl of S.plates) PL.forEach((p) => {
    const on = !p.dead && p.ground && p.x + p.w > pl.x * T + 4 && p.x < (pl.x + 1) * T - 4 && Math.abs(p.y + p.h - (pl.y + 1) * T) < 4;
    if (pl.down[p.i] && !on) pl.lastOff[p.i] = G.time;
    if (on && !pl.down[p.i]) SFX.pop();
    pl.down[p.i] = on;
  });
  const held = (id) => S.plates.filter((pl) => pl.id === id && (pl.down[0] || pl.down[1])).length;
  for (const d of S.doors) {
    let want = held(d.id) > 0;
    if (d.both) { if (held(d.id) >= 2) d.latch = d.both; d.latch -= dt; want = d.latch > 0; }
    d.open = clamp(d.open + (want ? dt * 4 : -dt * 3), 0, 1);
    // a closing door pushes players out sideways instead of crushing them
    for (const p of PL) for (const q of solids(p.x, p.y, p.w, p.h)) if (q.w === T - 12) p.x = p.x + p.w / 2 < q.x + q.w / 2 ? q.x - p.w : q.x + q.w;
  }
  for (const br of S.bridges) { br.on = br.forced || held(br.id) > 0; br.a0 = clamp(br.a0 + (br.on ? dt * 6 : -dt * 6), 0, 1); }
  // crumbling tiles
  for (const k in S.timers) { if (S.timers[k] === true) continue; S.timers[k] -= dt; if (S.timers[k] <= 0) { const [tx, ty] = k.split(',').map(Number); S.fallers.push({ x: tx * T, y: ty * T, vy: 40 }); S.g[ty][tx] = ' '; S.timers[k] = true; } }
  for (const f of S.fallers) { f.vy += 2100 * dt; f.y += f.vy * dt; }

  const touch = (p, x, y, r = 30) => !p.dead && Math.hypot(p.x + p.w / 2 - (x * T + 20), p.y + p.h / 2 - (y * T + 20)) < r;
  if (L.finale) {
    // the last gate: both plates, held together, and then it turns out to fit two
    const two = held('g') >= 2;
    if (S.gateOpen < 1) {
      S.both = two ? S.both + dt : Math.max(0, S.both - dt * 2);
      if (two) line('hold', 'Đấy, mở rồi. Giờ thì… đứa nào bước xuống trước đây?');
      if (S.both > 4.2) { S.gateOpen = 1; SFX.win(); say('…Thôi. Cổng này vừa cả hai. Tôi nói dối từ màn một tới giờ đó.', { now: true }); }
    } else for (const p of PL) if (!p.inGate && touch(p, L.gate[0], L.gate[1], 40)) { p.inGate = true; SFX.bridge(p.i * 2); burst(p.x + 11, p.y + 14, 30, COL[p.i], 240); }
    if (PL[0].inGate && PL[1].inGate && !S.over) { S.over = 2.2; say('Đêm rằm mà đi một mình thì buồn lắm.', { now: true }); }
  } else {
    if (S.phase === 'A') {
      PL.forEach((p) => { if (!S.lit[p.i] && touch(p, L.check[0] - 0.5, L.check[1], 34)) { S.lit[p.i] = true; SFX.bridge(p.i * 2); burst(L.check[0] * T, L.check[1] * T, 16, COL[p.i], 160); } });
      if (S.lit[0] && S.lit[1]) { S.phase = 'B'; S.tB = 0; SFX.win(); say(L.lines.lit, { now: true }); G.lies++; }
    } else {
      S.tB += dt;
      const so = L.standoff;
      if (so && !S.standoffDone && S.tB > so.after) {
        S.standoffDone = true; say(so.say, { now: true }); SFX.whoosh();
        if (so.tiles) for (const [x, y, c] of so.tiles) { S.g[y][x] = c; burst(x * T + 20, y * T + 20, 8, '#cdbfa0', 120); }
        if (so.force) S.bridges.find((q) => q.id === so.force).forced = true;
      }
      for (const p of PL) if (!S.over && touch(p, L.gate[0], L.gate[1], 30)) {
        S.over = 2.0; p.inGate = true; G.score[p.i]++; hud(); SFX.win(); burst(p.x + 11, p.y + 14, 40, COL[p.i], 260);
        say(`${NAMES[p.i]} vào hội. ${NAMES[1 - p.i]} đứng ngoài nhìn. Màn sau nhớ mặt nhau nha.`, { now: true });
      }
    }
  }
  tickFx(dt);
}
function tickFx(dt) {
  for (const p of parts) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
  G.shake = Math.max(0, G.shake - dt * 30); G.flash = Math.max(0, G.flash - dt * 2.5);
}
function nextLevel() {
  if (G.li + 1 >= LEVELS.length) { ending(); return; }
  G.state = 'card';
  const n = G.li + 1;
  $('cardn').textContent = `MÀN ${n + 1}`; $('cardt').textContent = LEVELS[n].name; $('card').classList.add('on');
  loadLevel(n);
  setTimeout(() => { $('card').classList.remove('on'); G.state = 'play'; }, 1400);
}
function ending() {
  G.state = 'end';
  const w = G.score[0] === G.score[1] ? 'Hoà nhau' : `${NAMES[G.score[0] > G.score[1] ? 0 : 1]} vào hội nhiều hơn`;
  $('endw').textContent = w + '. Nhưng cổng cuối thì vừa cả hai.';
  $('e0').textContent = `${G.score[0]} : ${G.score[1]}`; $('e1').textContent = `${G.betray[0]} : ${G.betray[1]}`; $('e2').textContent = `${G.falls[0]} : ${G.falls[1]}`;
  $('end').classList.remove('off'); $('hud').classList.remove('on'); $('sub').classList.remove('on');
}
function start() {
  audioInit();
  G.score = [0, 0]; G.betray = [0, 0]; G.falls = [0, 0];
  mem.forEach((m) => { m.habit = [new Map(), new Map()]; m.traps = []; m.attempts = 0; m.said.clear(); });
  sub.q.length = 0; sub.text = '';
  loadLevel(0);
  $('menu').classList.add('off'); $('end').classList.add('off'); $('hud').classList.add('on');
  G.state = 'play';
}

// ============================================================ narration
const sub = { q: [], text: '', shown: 0, hold: 0, red: false };
function say(text, opts = {}) {
  if (opts.now) sub.q.length = 0;
  sub.q.push({ text, red: !!opts.red });
  if (opts.now) { sub.hold = 0; sub.text = ''; }
}
function tickSub(dt) {
  if (!sub.text && sub.q.length) { const n = sub.q.shift(); sub.text = n.text; sub.red = n.red; sub.shown = 0; sub.hold = Math.max(2.4, n.text.length * 0.062) + 0.6; $('sub').classList.add('on'); $('sub').classList.toggle('red', n.red); }
  if (!sub.text) return;
  const before = Math.floor(sub.shown);
  sub.shown = Math.min(sub.text.length, sub.shown + dt * 46);
  const now = Math.floor(sub.shown);
  if (now !== before) { $('subt').textContent = sub.text.slice(0, now); if (now % 3 === 0) SFX.blip(now); }
  sub.hold -= dt;
  if (sub.hold <= 0 || (sub.q.length && sub.shown >= sub.text.length && sub.hold < 1.2)) { sub.text = ''; if (!sub.q.length) $('sub').classList.remove('on'); }
}

// ============================================================ drawing
let backFar = null, backMid = null;
function glow(c, x, y, r, col, a = 1) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.globalAlpha = a; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.globalAlpha = 1;
}
function makeBackdrop(i) {
  const L = LEVELS[i], R = rng(1234 + i * 77), wFar = Math.ceil(VW + L.w * T * 0.12), wMid = Math.ceil(VW + L.w * T * 0.38);
  backFar = document.createElement('canvas'); backFar.width = wFar; backFar.height = VH;
  let c = backFar.getContext('2d');
  // distant hills and pagoda towers
  for (let layer = 0; layer < 2; layer++) {
    c.fillStyle = layer ? '#141b45' : '#1a2356';
    c.beginPath(); c.moveTo(0, VH);
    const base = 330 + layer * 50, ph = R() * 9;
    for (let x = 0; x <= wFar; x += 8) c.lineTo(x, base - Math.sin(x * 0.006 + ph) * 34 - Math.sin(x * 0.017 + ph * 2) * 16);
    c.lineTo(wFar, VH); c.fill();
  }
  for (let x = 120 + R() * 200; x < wFar; x += 330 + R() * 260) {
    const h = 110 + R() * 70, y0 = 400; c.fillStyle = '#10163a';
    for (let k = 0; k < 4; k++) { const w = 46 - k * 8, y = y0 - k * h / 4; c.fillRect(x - w / 2, y - h / 4, w, h / 4); c.beginPath(); c.moveTo(x - w / 2 - 14, y - h / 4 + 5); c.quadraticCurveTo(x, y - h / 4 - 12, x + w / 2 + 14, y - h / 4 + 5); c.lineTo(x + w / 2, y - h / 4 + 9); c.lineTo(x - w / 2, y - h / 4 + 9); c.fill(); }
    c.fillRect(x - 1.5, y0 - h - 22, 3, 24);
  }
  backMid = document.createElement('canvas'); backMid.width = wMid; backMid.height = VH;
  c = backMid.getContext('2d');
  const cols = ['#ff5a3c', '#ffb23e', '#ff7a9a', '#ffd76a'];
  let x = -30, prevTop = null;
  const lights = [];
  while (x < wMid + 60) {
    const w = 96 + R() * 96, h = 120 + R() * 150, top = VH - 60 - h;
    c.fillStyle = '#0e1330'; c.fillRect(x, top, w, VH - top);
    // curved tiled roof with upturned eaves
    c.fillStyle = '#0a0e26'; c.beginPath(); c.moveTo(x - 20, top + 8); c.quadraticCurveTo(x - 8, top + 2, x + 6, top - 16); c.lineTo(x + w - 6, top - 16);
    c.quadraticCurveTo(x + w + 8, top + 2, x + w + 20, top + 8); c.lineTo(x + w + 16, top + 14); c.lineTo(x - 16, top + 14); c.fill();
    for (let wy = top + 34; wy < VH - 110; wy += 46) for (let wx = x + 16; wx < x + w - 24; wx += 34) {
      if (R() < 0.45) { c.fillStyle = `rgba(255,${180 + R() * 40 | 0},${90 + R() * 40 | 0},${0.55 + R() * 0.4})`; c.fillRect(wx, wy, 14, 20); lights.push([wx + 7, wy + 10, 26, 'rgba(255,170,80,0.35)']); c.fillStyle = '#0e1330'; c.fillRect(wx + 6, wy, 2, 20); }
    }
    if (prevTop !== null) { // a string of lanterns sagging between two roofs
      const x0 = x - 40, y0 = prevTop + 10, x1 = x + 20, y1 = top + 10, n = 5;
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1; c.beginPath();
      for (let k = 0; k <= 12; k++) { const t = k / 12, px = lerp(x0, x1, t), py = lerp(y0, y1, t) + Math.sin(t * Math.PI) * 26; k ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.stroke();
      for (let k = 1; k < n; k++) { const t = k / n, px = lerp(x0, x1, t), py = lerp(y0, y1, t) + Math.sin(t * Math.PI) * 26 + 7, col = cols[(k + (x | 0)) % 4]; c.fillStyle = col; c.beginPath(); c.ellipse(px, py, 4.5, 6, 0, 0, 7); c.fill(); lights.push([px, py, 22, col]); }
    }
    prevTop = top; x += w + 26 + R() * 40;
  }
  c.globalCompositeOperation = 'lighter';
  for (const [lx, ly, r, col] of lights) glow(c, lx, ly, r, col, 0.5);
  c.globalCompositeOperation = 'source-over';
}

const stars = Array.from({ length: 130 }, () => ({ x: Math.random() * VW, y: Math.random() * 330, r: Math.random() * 1.3 + 0.3, p: Math.random() * 6.28 }));
function drawSky() {
  const g = cx.createLinearGradient(0, 0, 0, VH);
  if (G.invertNow) { g.addColorStop(0, '#1a0714'); g.addColorStop(0.55, '#4a1230'); g.addColorStop(1, '#7a2a36'); }
  else { g.addColorStop(0, '#060920'); g.addColorStop(0.5, '#141c50'); g.addColorStop(0.82, '#3b2a63'); g.addColorStop(1, '#7a4267'); }
  cx.fillStyle = g; cx.fillRect(0, 0, VW, VH);
  for (const s of stars) { cx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(G.time * 0.9 + s.p)); cx.fillStyle = '#fff'; cx.fillRect(s.x, s.y, s.r, s.r); }
  cx.globalAlpha = 1;
  // the moon grows as Bé Sao gets closer; Cuội sits under the banyan tree
  const r = 44 + G.li * 8 + (S && S.L.finale ? 34 : 0), mx = VW * 0.79, my = 118 + (S && S.L.finale ? 40 : 0);
  const talk = sub.text ? 0.5 + 0.5 * Math.sin(G.time * 9) : 0;
  cx.globalCompositeOperation = 'lighter';
  glow(cx, mx, my, r * 4.2, G.invertNow ? 'rgba(255,70,70,0.45)' : 'rgba(255,225,150,0.38)', 0.8 + talk * 0.2);
  cx.globalCompositeOperation = 'source-over';
  const mg = cx.createRadialGradient(mx - r * 0.3, my - r * 0.3, r * 0.1, mx, my, r);
  mg.addColorStop(0, G.invertNow ? '#ffd0c0' : '#fffbe8'); mg.addColorStop(1, G.invertNow ? '#ff6a5a' : '#ffe08a');
  cx.fillStyle = mg; cx.beginPath(); cx.arc(mx, my, r, 0, 7); cx.fill();
  cx.fillStyle = 'rgba(190,150,70,0.22)';
  for (const [dx, dy, s] of [[-0.45, -0.2, 0.2], [-0.15, 0.4, 0.13], [-0.6, 0.35, 0.09], [0.1, -0.55, 0.11]]) { cx.beginPath(); cx.arc(mx + dx * r, my + dy * r, s * r, 0, 7); cx.fill(); }
  if (S && S.L.finale) return; // up close, the tree and Cuội are drawn in the world instead
  cx.save(); cx.beginPath(); cx.arc(mx, my, r, 0, 7); cx.clip();
  cx.fillStyle = '#2a2140';
  cx.beginPath(); cx.moveTo(mx + r * 0.28, my + r); cx.quadraticCurveTo(mx + r * 0.36, my + r * 0.3, mx + r * 0.2, my - r * 0.05); cx.lineTo(mx + r * 0.42, my - r * 0.05); cx.quadraticCurveTo(mx + r * 0.5, my + r * 0.4, mx + r * 0.6, my + r); cx.fill();
  for (const [dx, dy, s] of [[0.3, -0.25, 0.3], [0.05, -0.1, 0.22], [0.58, -0.12, 0.24], [0.36, -0.5, 0.2], [0.72, 0.08, 0.16]]) { cx.beginPath(); cx.arc(mx + dx * r, my + dy * r, s * r, 0, 7); cx.fill(); }
  // Cuội: conical hat, leaning on the trunk
  const kx = mx - r * 0.02, ky = my + r * 0.52, k = r / 60;
  cx.beginPath(); cx.ellipse(kx, ky + 9 * k, 9 * k, 11 * k, 0, 0, 7); cx.fill();
  cx.beginPath(); cx.arc(kx, ky - 6 * k, 5.5 * k, 0, 7); cx.fill();
  cx.beginPath(); cx.moveTo(kx - 12 * k, ky - 8 * k); cx.lineTo(kx, ky - 18 * k); cx.lineTo(kx + 12 * k, ky - 8 * k); cx.fill();
  cx.fillRect(mx - r, my + r * 0.78, r * 2, r);
  cx.restore();
}

function roofCap(x, y) {
  cx.fillStyle = '#9c4230'; cx.fillRect(x, y, T, 11);
  cx.fillStyle = '#c7634a'; for (let k = 0; k < 4; k++) { cx.beginPath(); cx.arc(x + 5 + k * 10, y + 11, 5, Math.PI, 0); cx.fill(); }
  cx.fillStyle = '#6e2c22'; cx.fillRect(x, y + 11, T, 2);
  cx.fillStyle = 'rgba(200,220,255,0.5)'; cx.fillRect(x, y, T, 1.5);
}
function plank(x, y, a = 1) {
  cx.globalAlpha = a;
  cx.fillStyle = '#7b4c2c'; cx.fillRect(x, y, T, 12); cx.fillStyle = '#4a2c1a'; cx.fillRect(x, y + 12, T, 4);
  cx.fillStyle = '#a06a40'; cx.fillRect(x, y, T, 2.5); cx.fillStyle = 'rgba(0,0,0,0.25)'; cx.fillRect(x + 19, y + 3, 1.5, 9);
  cx.fillStyle = 'rgba(200,220,255,0.35)'; cx.fillRect(x, y, T, 1);
  cx.globalAlpha = 1;
}
function spikes(x, y, k) {
  for (let i = 0; i < 4; i++) {
    const bx = x + 2 + i * 9.5, h = 24 * k;
    cx.fillStyle = '#c9b56a'; cx.beginPath(); cx.moveTo(bx, y + T); cx.lineTo(bx + 4, y + T - h); cx.lineTo(bx + 8, y + T); cx.fill();
    cx.fillStyle = '#f3e7b0'; cx.beginPath(); cx.moveTo(bx, y + T); cx.lineTo(bx + 4, y + T - h); cx.lineTo(bx + 3, y + T); cx.fill();
  }
}
function lantern(x, y, s = 1, hot = 1) {
  cx.globalCompositeOperation = 'lighter'; glow(cx, x, y, 60 * s, 'rgba(255,110,50,0.55)', 0.7 * hot); cx.globalCompositeOperation = 'source-over';
  cx.fillStyle = '#d2302a'; cx.beginPath(); cx.ellipse(x, y, 13 * s, 16 * s, 0, 0, 7); cx.fill();
  cx.fillStyle = '#ff7a4a'; cx.beginPath(); cx.ellipse(x - 3 * s, y - 2 * s, 6 * s, 11 * s, 0, 0, 7); cx.fill();
  cx.fillStyle = '#f2c14e'; cx.fillRect(x - 7 * s, y - 18 * s, 14 * s, 4 * s); cx.fillRect(x - 7 * s, y + 14 * s, 14 * s, 4 * s);
  cx.fillRect(x - 1 * s, y + 18 * s, 2 * s, 9 * s);
}
function gate(x, y, fake) { // festival gate; x,y is the top-left of its tile
  const bx = x + 20, by = y + T;
  cx.globalCompositeOperation = 'lighter'; glow(cx, bx, by - 50, 120, fake ? 'rgba(255,120,60,0.5)' : 'rgba(255,170,70,0.5)', 0.8); cx.globalCompositeOperation = 'source-over';
  cx.fillStyle = '#8f2424'; cx.fillRect(bx - 34, by - 84, 8, 84); cx.fillRect(bx + 26, by - 84, 8, 84);
  cx.fillStyle = '#5a1616'; cx.beginPath(); cx.moveTo(bx - 56, by - 80); cx.quadraticCurveTo(bx - 40, by - 86, bx - 30, by - 100); cx.lineTo(bx + 30, by - 100); cx.quadraticCurveTo(bx + 40, by - 86, bx + 56, by - 80); cx.lineTo(bx + 50, by - 74); cx.lineTo(bx - 50, by - 74); cx.fill();
  cx.fillStyle = '#f2c14e'; cx.fillRect(bx - 30, by - 76, 60, 3);
  lantern(bx, by - 46 + Math.sin(G.time * 2) * 1.5, 1.05);
}
function banyan(x, y) {
  const bx = x + 40, by = y + T;
  cx.globalCompositeOperation = 'lighter'; glow(cx, bx, by - 70, 190, 'rgba(255,235,170,0.4)', 0.8); cx.globalCompositeOperation = 'source-over';
  cx.fillStyle = '#2b2344'; cx.beginPath(); cx.moveTo(bx + 4, by); cx.quadraticCurveTo(bx + 16, by - 60, bx - 2, by - 104); cx.lineTo(bx + 34, by - 104); cx.quadraticCurveTo(bx + 30, by - 50, bx + 52, by); cx.fill();
  cx.fillStyle = '#243a4a';
  for (const [dx, dy, r] of [[14, -130, 52], [-34, -112, 40], [62, -116, 42], [16, -168, 38], [-8, -84, 26], [84, -84, 26]]) { cx.beginPath(); cx.arc(bx + dx, by + dy, r, 0, 7); cx.fill(); }
  cx.fillStyle = 'rgba(190,220,200,0.14)'; for (const [dx, dy, r] of [[2, -146, 30], [-44, -124, 20], [52, -134, 22]]) { cx.beginPath(); cx.arc(bx + dx, by + dy, r, 0, 7); cx.fill(); }
  // Cuội, waiting
  const kx = bx - 26, ky = by - 16;
  cx.fillStyle = '#3d5a80'; cx.beginPath(); cx.ellipse(kx, ky, 11, 15, 0, 0, 7); cx.fill();
  cx.fillStyle = '#f0c9a0'; cx.beginPath(); cx.arc(kx, ky - 20, 8, 0, 7); cx.fill();
  cx.fillStyle = '#e8d8a8'; cx.beginPath(); cx.moveTo(kx - 17, ky - 23); cx.lineTo(kx, ky - 38); cx.lineTo(kx + 17, ky - 23); cx.fill();
  cx.fillStyle = '#2a2140'; cx.fillRect(kx + 2, ky - 21, 2, 2); cx.fillRect(kx - 3, ky - 21, 2, 2);
}
function drawActor(p) {
  if (p.dead || p.inGate) return;
  const x = p.x + p.w / 2, y = p.y + p.h / 2 - 1, gold = p.i === 0;
  cx.globalCompositeOperation = 'lighter'; glow(cx, x, y, 110, gold ? 'rgba(255,205,110,0.4)' : 'rgba(150,200,255,0.4)'); cx.globalCompositeOperation = 'source-over';
  cx.strokeStyle = gold ? '#7a3b20' : '#2a4a70'; cx.lineWidth = 3; cx.lineCap = 'round';
  const sw = p.ground ? Math.sin(p.walk * 6.283) * 5 : 3;
  cx.beginPath(); cx.moveTo(x - 5, y + 9); cx.lineTo(x - 5 + sw, y + 15); cx.moveTo(x + 5, y + 9); cx.lineTo(x + 5 - sw, y + 15); cx.stroke();
  cx.save(); cx.translate(x, y); cx.scale(1 + p.sq, 1 - p.sq); cx.rotate(p.vx * 0.0007);
  if (gold) {
    cx.strokeStyle = '#e8452e'; cx.lineWidth = 2; cx.beginPath(); cx.arc(0, 0, 16.5, 0, 7); cx.stroke();
    cx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? 7.2 : 16; cx.lineTo(Math.cos(a) * q, Math.sin(a) * q); } cx.closePath();
    const sg = cx.createRadialGradient(0, -3, 1, 0, 0, 16); sg.addColorStop(0, '#fffbe0'); sg.addColorStop(1, '#ffb53e'); cx.fillStyle = sg; cx.fill(); cx.strokeStyle = '#d9412b'; cx.lineWidth = 1.6; cx.stroke();
  } else { // Bé Trăng: a crescent lantern
    cx.strokeStyle = '#3d7fd0'; cx.lineWidth = 2; cx.beginPath(); cx.arc(0, 0, 16.5, 0, 7); cx.stroke();
    const mg = cx.createRadialGradient(-3, -4, 1, 0, 0, 15); mg.addColorStop(0, '#ffffff'); mg.addColorStop(1, '#8fc4ff'); cx.fillStyle = mg;
    cx.beginPath(); cx.arc(0, 0, 14, 0.9, Math.PI * 2 - 0.9); cx.arc(8, 0, 11.5, Math.PI * 2 - 1.25, 1.25, true); cx.closePath(); cx.fill(); cx.strokeStyle = '#2f6fc0'; cx.lineWidth = 1.4; cx.stroke();
  }
  cx.fillStyle = '#1c1c2c'; const ex = gold ? 0 : -4;
  cx.beginPath(); cx.ellipse(ex - 3.2 + p.face * 1.2, -0.5, 1.5, 2.2, 0, 0, 7); cx.ellipse(ex + 3.2 + p.face * 1.2, -0.5, 1.5, 2.2, 0, 0, 7); cx.fill();
  cx.restore();
}
function render() {
  const L = S.L, m = mem[G.li];
  cx.setTransform(scale, 0, 0, scale, 0, 0);
  drawSky();
  cx.drawImage(backFar, 0, 0); cx.drawImage(backMid, 0, 20);
  const hz = cx.createLinearGradient(0, 330, 0, VH); hz.addColorStop(0, 'rgba(120,70,110,0)'); hz.addColorStop(1, 'rgba(110,70,120,0.42)'); cx.fillStyle = hz; cx.fillRect(0, 330, VW, 210);
  cx.save(); cx.translate(Math.round((Math.random() - 0.5) * G.shake), Math.round((Math.random() - 0.5) * G.shake));
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < 24; tx++) {
    const c = S.g[ty][tx], x = tx * T, y = ty * T;
    if (c === '#') {
      cx.fillStyle = '#1c1833'; cx.fillRect(x, y, T, T);
      cx.fillStyle = '#272145'; cx.fillRect(x + ((ty % 2) * 20), y + 13, 19, 12); cx.fillRect(x + (((ty + 1) % 2) * 20), y + 27, 19, 12);
      if ((ty > 0 ? S.g[ty - 1][tx] : ' ') !== '#') roofCap(x, y);
    } else if (c === '=' || c === 'F') plank(x + (S.timers[tx + ',' + ty] ? rnd(-1.5, 1.5) : 0), y);
    else if (c === '^') spikes(x, y, 1);
  }
  for (const f of S.fallers) plank(f.x, f.y);
  // personal traps: faint cracks in the owner's colour, spikes that rise only for them
  for (const t of m.traps) {
    const x = t.tx * T, y = t.ty * T;
    cx.strokeStyle = COL[t.owner]; cx.globalAlpha = 0.55 + 0.25 * Math.sin(G.time * 4); cx.lineWidth = 1.5;
    cx.beginPath(); cx.moveTo(x + 6, y + 3); cx.lineTo(x + 15, y + 9); cx.lineTo(x + 22, y + 4); cx.lineTo(x + 34, y + 10); cx.stroke(); cx.globalAlpha = 1;
    if (t.pop > 0) spikes(x, y - T, t.pop);
  }
  for (const br of S.bridges) if (br.a0 > 0) for (let tx = br.a; tx <= br.b; tx++) {
    const x = tx * T, y = br.y * T; cx.globalAlpha = br.a0;
    cx.globalCompositeOperation = 'lighter'; glow(cx, x + 20, y + 6, 40, 'rgba(255,240,180,0.3)'); cx.globalCompositeOperation = 'source-over';
    const bg = cx.createLinearGradient(0, y, 0, y + 20); bg.addColorStop(0, 'rgba(255,250,225,0.96)'); bg.addColorStop(1, 'rgba(255,220,140,0)'); cx.fillStyle = bg; cx.fillRect(x, y, T, 20); cx.globalAlpha = 1;
  }
  for (const d of S.doors) {
    const top = (d.y0 + d.h * d.open) * T, bot = (d.y0 + d.h) * T, x = d.x * T + 6;
    if (bot - top > 2) { cx.fillStyle = '#5a1616'; cx.fillRect(x, top, T - 12, bot - top); cx.fillStyle = '#8f2424'; cx.fillRect(x + 3, top, 4, bot - top); cx.fillStyle = '#f2c14e'; for (let yy = top + 10; yy < bot - 6; yy += 26) cx.fillRect(x + 10, yy, 8, 8); cx.fillStyle = 'rgba(200,220,255,0.4)'; cx.fillRect(x, top, T - 12, 1.5); }
    if (d.both && d.latch > 0) { cx.fillStyle = '#ffe9a8'; cx.fillRect(d.x * T, d.y0 * T - 10, T * clamp(d.latch / d.both, 0, 1), 4); }
  }
  for (const pl of S.plates) {
    const dn = pl.down[0] || pl.down[1], x = pl.x * T, y = (pl.y + 1) * T - (dn ? 3 : 7);
    cx.globalCompositeOperation = 'lighter'; glow(cx, x + 20, y, 34, dn ? 'rgba(255,230,150,0.55)' : 'rgba(255,200,120,0.2)'); cx.globalCompositeOperation = 'source-over';
    cx.fillStyle = dn ? '#ffe9a8' : '#c9a14a'; cx.fillRect(x + 5, y, T - 10, dn ? 3 : 7); cx.fillStyle = '#6e5320'; cx.fillRect(x + 5, y + (dn ? 3 : 7) - 1.5, T - 10, 1.5);
  }
  if (L.check) { // the twin lantern: one half per player
    const x = L.check[0] * T, y = (L.check[1] + 1) * T;
    cx.fillStyle = '#3a2c2c'; cx.fillRect(x - 2, y - 74, 4, 74); cx.fillRect(x - 22, y - 74, 44, 3);
    [0, 1].forEach((k) => { const lx = x + (k ? 17 : -17), on = S.lit[k]; if (on) lantern(lx, y - 54, 0.8); else { cx.fillStyle = '#3b2330'; cx.beginPath(); cx.ellipse(lx, y - 54, 10, 13, 0, 0, 7); cx.fill(); } cx.fillStyle = COL[k]; cx.fillRect(lx - 4, y - 72, 8, 3); });
  }
  if (L.finale) {
    const x = L.gate[0] * T, y = (L.gate[1] + 1) * T, o = S.gateOpen;
    gate(x, L.gate[1] * T, false);
    if (!o) { cx.fillStyle = '#5a1616'; cx.fillRect(x - 6, y - 74, 52, 74); cx.fillStyle = '#f2c14e'; cx.fillRect(x + 18, y - 44, 4, 12); const k = clamp(S.both / 4.2, 0, 1); cx.fillStyle = '#ffe9a8'; cx.fillRect(x - 6, y - 80, 52 * k, 4); }
  } else {
    cx.globalAlpha = S.phase === 'B' ? 1 : 0.35; gate(L.gate[0] * T, L.gate[1] * T, false); cx.globalAlpha = 1;
  }
  for (const p of PL) drawActor(p);
  for (const p of parts) { const a = clamp(p.life / p.max, 0, 1); cx.globalCompositeOperation = 'lighter'; glow(cx, p.x, p.y, p.r * 4, p.col, a * 0.7); cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = a; cx.fillStyle = p.col; cx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r); cx.globalAlpha = 1; }
  cx.restore();
  const fog = cx.createLinearGradient(0, 430, 0, VH); fog.addColorStop(0, 'rgba(20,18,50,0)'); fog.addColorStop(1, 'rgba(14,12,40,0.75)'); cx.fillStyle = fog; cx.fillRect(0, 430, VW, 110);
  const vg = cx.createRadialGradient(VW / 2, VH / 2, VH * 0.45, VW / 2, VH / 2, VH * 0.95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,10,0.6)'); cx.fillStyle = vg; cx.fillRect(0, 0, VW, VH);
  if (G.flash > 0) { cx.fillStyle = `rgba(255,230,190,${G.flash * 0.5})`; cx.fillRect(0, 0, VW, VH); }
}

// ============================================================ boot, input, loop
let scale = 1;
function resize() {
  const s = Math.min(innerWidth / VW, innerHeight / VH), dpr = Math.min(devicePixelRatio || 1, 2), st = $('stage');
  st.style.width = VW * s + 'px'; st.style.height = VH * s + 'px';
  cv.width = Math.round(VW * s * dpr); cv.height = Math.round(VH * s * dpr); scale = cv.width / VW;
}
addEventListener('resize', resize); resize();
function toggleMute() { AU.on = !AU.on; if (AU.master) AU.master.gain.value = AU.on ? 0.5 : 0; $('mute').textContent = 'âm thanh: ' + (AU.on ? 'bật' : 'tắt'); }
addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyM') toggleMute();
  else if ((G.state === 'menu' || G.state === 'end') && (e.code === 'Enter' || e.code === 'Space')) start();
  else if (e.code === 'KeyR' && G.state === 'play' && !S.over && !S.failT) loadLevel(G.li);
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
$('menu').addEventListener('pointerup', start); $('end').addEventListener('pointerup', start);
$('mute').addEventListener('click', (e) => { toggleMute(); e.currentTarget.blur(); });
loadLevel(0);
const STEP = 1 / 120;
let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  while (acc >= STEP) { if (G.state === 'play') { update(STEP); tickSub(STEP); } else G.time += STEP; acc -= STEP; }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__doi = { G, PL, mem, LEVELS, get S() { return S; }, start, loadLevel, step(n, bot) { G.bot = bot; for (let i = 0; i < n; i++) { update(STEP); tickSub(STEP); } G.bot = null; } };
})();
