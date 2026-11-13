// NÓI DỐI NHƯ CUỘI: a small rage platformer. Everything (art, sound, levels) is generated in this file.
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
// Tiles: '#' ground, '=' plank, 'F' falls when stepped on, 'f' fake (no collision), 'i' invisible solid,
// '^' spikes, 'h' hidden spikes, 'B' moonlight bridge, 'W' wobbly (harmless) bridge tile.
function level(name, w, build) {
  const g = Array.from({ length: ROWS }, () => Array(w).fill(' '));
  const L = { name, w, g, says: [], objs: [], invert: [], taunts: [], generic: [], hidden: 'near' };
  const api = {
    ground(a, b, top = 10) { for (let x = a; x <= b; x++) for (let y = top; y < ROWS; y++) g[y][x] = '#'; },
    row(a, b, y, c) { for (let x = a; x <= b; x++) g[y][x] = c; },
    say(x, text, lie) { L.says.push({ x, text, lie: !!lie }); },
    taunt(a, b, ...lines) { L.taunts.push({ a, b, lines }); },
  };
  build(api, L);
  return L;
}

const LEVELS = [
  level('Cứ đi thẳng', 40, (m, L) => {
    m.ground(0, 11); m.ground(14, 27); m.row(28, 30, 10, 'F'); m.ground(31, 39);
    L.spawn = [2, 9]; L.goal = [36, 9];
    m.say(1.5, 'Chào Bé Sao! Tôi là Cuội, ngồi trên cung trăng nè. Lạc đường hả? Cứ đi thẳng là tới hội.');
    m.say(8, 'Thấy cái hố kia không? Nhảy qua nhé. Tôi không lừa bé đâu.');
    m.say(18, 'Đấy, nghe tôi là đúng. Từ giờ cứ thong thả mà đi.', true);
    m.taunt(27, 31, 'Ơ, chỗ đó mục rồi à? Tôi quên mất.', 'Thong thả quá cũng không tốt đâu.');
    m.taunt(11, 14, 'Cái hố đó tôi có nhắc rồi mà.');
  }),
  level('Lấy đà mà nhảy', 40, (m, L) => {
    m.ground(0, 14); m.row(15, 18, 10, 'i'); m.ground(19, 24); m.row(19, 20, 9, 'h');
    m.ground(25, 31, 12); m.row(25, 31, 11, '^'); m.row(26, 27, 8, '='); m.row(29, 30, 8, 'f'); m.ground(32, 39);
    L.spawn = [2, 9]; L.goal = [36, 9]; L.hidden = 'air'; L.airZone = [15, 21.5];
    m.say(8, 'Hố này sâu lắm. Lấy đà rồi nhảy thật xa vào!', true);
    m.say(21.6, 'Ủa, đi bộ qua luôn hả? Ai dạy bé cãi lời người lớn vậy?');
    m.say(22.6, 'Thôi, bước lên mấy tấm ván kia đi. Tôi đóng chắc lắm.', true);
    m.taunt(14, 22, 'Tôi bảo nhảy, chứ có bảo đáp xuống đó đâu.', 'Hố thì không có. Chông thì có. Công bằng mà.');
    m.taunt(24, 32, 'Tấm thứ hai tôi chưa kịp đóng đinh.', 'Ván giả đó. Nhìn giống thật ghê ha.');
  }),
  level('Quà trung thu', 44, (m, L) => {
    m.ground(0, 43);
    L.spawn = [2, 9]; L.goal = [40, 9];
    L.objs.push({ t: 'gift', x: 9, y: 9 }, { t: 'drop', x: 17, trig: 14.0, mode: 'fall' }, { t: 'drop', x: 22, trig: 19.2, mode: 'fake' },
      { t: 'drop', x: 27, trig: 24.0, mode: 'fall' }, { t: 'gift', x: 33, y: 9 });
    m.say(3, 'Trung thu mà không có quà thì buồn lắm. Nhặt chiếc đèn kia đi, tôi tặng đó.', true);
    m.say(11.5, 'Mấy cái đèn treo phía trước buộc chắc lắm. Cứ chạy thẳng.', true);
    m.say(19.6, 'Cái này thì… chỉ là gió thôi.');
    m.say(29.5, 'Còn một món quà nữa kìa. Món này thật.', true);
    L.generic = ['Pháo đó. Vui không?', 'Dây buộc hơi lỏng. Lỗi của gió.', 'Quà mà. Sao lại né?'];
  }),
  level('Lưu điểm', 48, (m, L) => {
    m.ground(0, 12); m.row(13, 15, 10, 'F'); m.ground(16, 37); m.ground(40, 47); m.row(34, 35, 9, 'h');
    L.spawn = [2, 9]; L.goal = [28, 9]; L.goalRun = 44; L.objs.push({ t: 'flag', x: 14, y: 9 });
    m.say(6, 'Cờ lưu điểm kìa! Chạm vào đi, lỡ ngã khỏi phải đi lại từ đầu.', true);
    m.say(18.5, 'Thôi được rồi. Cổng hội ngay trước mặt đó. Chạy vào đi!', true);
    m.taunt(12, 16, 'Lưu rồi đó. Lưu vào sổ ngã.', 'Cờ đẹp mà. Ai bảo ham.');
    m.taunt(32, 37, 'Chông năm nay mọc nhanh thật. Mưa thuận gió hoà.');
    m.taunt(37, 40, 'Cái hố đó có sẵn. Không phải tôi.');
  }),
  level('Đổi tay', 46, (m, L) => {
    m.ground(0, 9); m.ground(10, 37, 12); m.row(10, 37, 11, '^'); m.ground(38, 45);
    for (const x of [11, 15, 19, 23, 27, 31, 35]) m.row(x, x + 1, 9, '=');
    L.spawn = [2, 9]; L.goal = [43, 9]; L.invert = [[17.6, 30.6], [33.3, 36.9]];
    L.invertSay = ['Trái là phải. Phải là trái. Dễ mà.', 'À, tôi nói trả lại hồi nào nhỉ?'];
    L.invertOut = 'Thôi, trả lại cho bé đó.';
    m.say(4, 'Đi nãy giờ mỏi tay chưa? Để tôi giúp bé đổi tay cho đỡ mỏi.', true);
    L.generic = ['Tay nào cũng mỏi như nhau thôi.', 'Bé cứ nghĩ ngược lại là được.', 'Trăng đỏ là tôi đang giúp đó.'];
  }),
  level('Lần này là thật', 50, (m, L) => {
    m.ground(0, 7); m.row(13, 14, 9, 'F'); m.row(16, 17, 9, '='); m.ground(19, 49);
    L.spawn = [2, 9]; L.goal = [46, 9];
    L.objs.push({ t: 'shy', x: 10, y: 9, w: 2, shift: 3.3 }, { t: 'fakegoal', x: 36, y: 9 });
    m.say(3, 'Tấm ván kia hơi nhát người lạ. Nhưng lần này nó đứng yên, tôi hứa.', true);
    m.say(11.2, 'Ván ở giữa là chắc nhất. Đáp vào giữa nhé.', true);
    m.say(30, 'Tới rồi! Cổng hội đó! Chạy vào đi!', true);
    m.say(38.5, 'Cái này thì thật. Tôi thề trên cây đa.');
    m.taunt(7, 12.4, 'Nó nhát thật mà. Lần sau nó đứng yên, hết chỗ lùi rồi.');
    m.taunt(12.4, 19, 'Chắc nhất… so với hai tấm còn lại thì không.', 'Giữa là giữa của tôi, không phải giữa của bé.');
    m.taunt(33, 39, 'Cổng đó tôi dựng tạm. Cổng thật ở phía sau. Chắc vậy.');
  }),
  level('Sự thật', 40, (m, L) => {
    m.ground(0, 12); m.ground(34, 39);
    for (const x of [15, 19, 23, 27, 31]) m.row(x, x + 1, 9, 'f');
    L.spawn = [2, 9]; L.goal = [37, 9]; L.trust = { a: 9, b: 12, from: 13, to: 33, row: 10 };
    m.say(1.5, 'Bé Sao này. Lần này tôi nói thật.');
    m.say(5.5, 'Đừng nhảy. Mấy tấm ván đó giả hết. Đứng yên trên vệt trăng kia và đợi tôi.');
    L.generic = ['Tôi nói thật mà.', 'Cả đêm tôi lừa bé, nên bé không tin. Tôi hiểu.', 'Một lần thôi. Đứng yên trên vệt trăng.', 'Tôi không trách đâu. Thử lại đi.'];
  }),
  level('Cung trăng', 44, (m, L) => {
    m.row(0, 5, 11, 'B'); m.row(6, 9, 10, 'B'); m.row(10, 13, 9, 'B'); m.row(14, 17, 8, 'B'); m.row(18, 21, 7, 'B');
    m.row(22, 25, 6, 'B'); m.row(26, 29, 5, 'B'); m.row(30, 43, 4, 'B'); L.g[8][15] = 'W';
    L.spawn = [2, 10]; L.goal = [40, 3]; L.finale = true;
    m.say(1.5, 'Từ đây không còn cái bẫy nào nữa. Thật đó.');
    m.say(13.2, '…Viên đó tự nó lung lay. Không phải tôi.');
    m.say(19, 'Bé có biết vì sao người ta nói “nói dối như Cuội” không?');
    m.say(25, 'Vì ai lên tới đây rồi cũng quay về. Tôi bày trò để họ nán lại thêm một chút.');
    m.say(32, 'Xin lỗi vì mấy cái hố nhé.');
    m.say(36.5, 'Ngồi xuống đây. Trăng năm nay tròn lắm.');
    L.generic = ['Lần này là bé tự ngã đó nha.'];
  }),
];
const GENERIC = ['Ôi. Đau không?', 'Tôi có cảnh báo mà. Hay là chưa nhỉ.', 'Lại nào. Trăng còn sáng lắm.', 'Bé ngã đẹp đó.', 'Tin người quá cũng khổ ha.'];

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
const G = { state: 'menu', li: 0, falls: 0, lies: 0, time: 0, cam: 0, shake: 0, invertNow: false, flash: 0 };
const mem = LEVELS.map(() => ({ said: new Set(), shy: false, goalRan: false, trusted: false, inv: 0 }));
let S = null;      // per-attempt level state
const P = { x: 0, y: 0, vx: 0, vy: 0, w: 22, h: 28, ground: false, coyote: 0, buffer: 0, face: 1, walk: 0, sq: 0, dead: false };
const parts = [], flies = [];
const keys = new Set(); const pad = { left: false, right: false, jump: false };
let jumpWas = false;

function save() { try { localStorage.setItem('cuoi.save', JSON.stringify({ li: G.li, falls: G.falls, lies: G.lies })); } catch { /* storage unavailable */ } }
function loadSave() { try { const s = JSON.parse(localStorage.getItem('cuoi.save')); if (s && s.li > 0 && s.li < LEVELS.length) { G.li = s.li; G.falls = s.falls || 0; G.lies = s.lies || 0; return true; } } catch { /* ignore */ } return false; }

function loadLevel(i) {
  G.li = i;
  const L = LEVELS[i], m = mem[i];
  S = { L, g: L.g.map((r) => r.slice()), fallers: [], pops: {}, shown: {}, timers: {}, objs: L.objs.map((o) => ({ ...o, st: 0, vy: 0, py: 0, ox: o.x })),
    goal: { x: L.goal[0], y: L.goal[1], tx: L.goal[0] }, stand: 0, bridgeN: 0, bridgeT: 0, won: 0, deadT: 0, invIdx: -1 };
  if (L.goalRun && m.goalRan) S.goal.x = S.goal.tx = L.goalRun;
  if (L.trust && m.trusted) for (let x = L.trust.from; x <= L.trust.to; x++) S.g[L.trust.row][x] = 'B';
  Object.assign(P, { x: L.spawn[0] * T + 9, y: L.spawn[1] * T + T - P.h, vx: 0, vy: 0, ground: false, dead: false, face: 1, sq: 0 });
  G.cam = clamp(P.x - VW * 0.4, 0, L.w * T - VW);
  G.invertNow = false;
  $('lvln').textContent = `MÀN ${i + 1} / ${LEVELS.length}`; $('lvlt').textContent = L.name;
  $('fallsn').textContent = G.falls;
  flies.length = 0;
  for (let k = 0; k < 16; k++) flies.push({ x: rnd(0, L.w * T), y: rnd(120, 420), p: rnd(0, 6.28), s: rnd(0.4, 1) });
  makeBackdrop(i);
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

// ============================================================ physics
const SOLID = { '#': 1, '=': 1, 'F': 1, 'i': 1, 'B': 1, 'W': 1 };
const tile = (tx, ty) => (ty < 0 || ty >= ROWS || tx < 0 || tx >= S.L.w ? ' ' : S.g[ty][tx]);
function solidRects(x, y, w, h) {
  const out = [];
  for (let ty = Math.floor(y / T); ty <= Math.floor((y + h - 0.01) / T); ty++)
    for (let tx = Math.floor(x / T); tx <= Math.floor((x + w - 0.01) / T); tx++) {
      const c = tile(tx, ty);
      if (SOLID[c]) out.push({ x: tx * T, y: ty * T, w: T, h: c === '=' || c === 'B' || c === 'W' || (c === 'F' && ty < 10) ? 16 : T, tx, ty, c });
    }
  for (const o of S.objs) if (o.t === 'shy') out.push({ x: o.x * T, y: o.y * T, w: o.w * T, h: 16, obj: o });
  return out.filter((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);
}
function spawnParts(x, y, n, col, sp = 220, glow = true, grav = 500) {
  for (let i = 0; i < n; i++) { const a = rnd(0, 6.283), v = rnd(0.2, 1) * sp; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * 0.35, life: rnd(0.3, 0.9), max: 0.9, col, r: rnd(1.5, 4), glow, grav }); }
}
function tauntFor() {
  const L = S.L, tx = (P.x + P.w / 2) / T;
  for (const z of L.taunts) if (tx >= z.a && tx <= z.b) return pick(z.lines);
  return pick(L.generic.length ? L.generic : GENERIC);
}
function kill(cause) {
  if (P.dead || S.won) return;
  P.dead = true; S.deadT = 0.62; G.falls++; G.shake = 10; G.flash = cause === 'boom' ? 1 : 0.35;
  $('fallsn').textContent = G.falls;
  spawnParts(P.x + P.w / 2, P.y + P.h / 2, 26, '#ffd76a', 300);
  spawnParts(P.x + P.w / 2, P.y + P.h / 2, 10, '#ff6a3d', 200);
  cause === 'boom' ? SFX.boom() : SFX.die();
  say(tauntFor(), { now: true, red: true });
  save();
}
function input() {
  let l = keys.has('ArrowLeft') || keys.has('KeyA') || pad.left, r = keys.has('ArrowRight') || keys.has('KeyD') || pad.right;
  const j = keys.has('Space') || keys.has('ArrowUp') || keys.has('KeyW') || pad.jump;
  if (G.bot) { l = G.bot.left; r = G.bot.right; return { l, r, j: G.bot.jump }; }
  return { l, r, j };
}

function update(dt) {
  G.time += dt;
  const L = S.L, m = mem[G.li];
  // ---- win / death timers
  if (S.won) { S.won -= dt; if (S.won <= 0) nextLevel(); }
  if (P.dead) { S.deadT -= dt; if (S.deadT <= 0) loadLevel(G.li); }

  const pcx = (P.x + P.w / 2) / T;
  // ---- Cuội's lines
  if (!P.dead) for (const s of L.says) {
    const id = s.x + s.text;
    if (pcx >= s.x && !m.said.has(id)) { m.said.add(id); say(s.text); if (s.lie) G.lies++; }
  }
  // ---- inverted controls
  let inv = -1;
  L.invert.forEach((z, i) => { if (pcx > z[0] && pcx < z[1]) inv = i; });
  if (inv !== S.invIdx) {
    if (inv >= 0) { SFX.whoosh(); if (m.inv <= inv) { m.inv = inv + 1; say(L.invertSay[inv], { now: true }); G.lies++; } }
    else if (S.invIdx === 0 && !m.invOut && !P.dead) { m.invOut = true; say(L.invertOut, { now: true }); }
    S.invIdx = inv;
  }
  G.invertNow = inv >= 0;

  // ---- player movement
  if (!P.dead && !S.won) {
    const k = input();
    let dir = (k.r ? 1 : 0) - (k.l ? 1 : 0);
    if (G.invertNow) dir = -dir;
    const target = dir * 250, acc = P.ground ? 2600 : 1700;
    P.vx += clamp(target - P.vx, -acc * dt, acc * dt);
    if (dir) P.face = dir;
    P.coyote = P.ground ? 0.09 : P.coyote - dt;
    P.buffer = k.j && !jumpWas ? 0.11 : P.buffer - dt;
    if (P.buffer > 0 && P.coyote > 0) { P.vy = -660; P.coyote = 0; P.buffer = 0; P.ground = false; P.sq = -0.35; SFX.jump(); spawnParts(P.x + P.w / 2, P.y + P.h, 5, '#ffe9a8', 80); }
    if (!k.j && P.vy < -220) P.vy = -220;
    jumpWas = k.j;
    P.vy = Math.min(P.vy + 2100 * dt, 900);

    // shy platform carries nothing; it just leaves
    P.x += P.vx * dt;
    for (const r of solidRects(P.x, P.y, P.w, P.h)) {
      if (r.c === 'i') S.shown[r.tx + ',' + r.ty] = 1;
      if (P.vx > 0) P.x = r.x - P.w; else if (P.vx < 0) P.x = r.x + r.w;
      P.vx = 0;
    }
    P.x = clamp(P.x, 0, L.w * T - P.w);
    const wasGround = P.ground, vy0 = P.vy;
    P.y += P.vy * dt; P.ground = false;
    for (const r of solidRects(P.x, P.y, P.w, P.h)) {
      if (r.c === 'i') S.shown[r.tx + ',' + r.ty] = 1;
      if (P.vy > 0) {
        P.y = r.y - P.h; P.ground = true;
        if (r.c === 'F' && !S.timers[r.tx + ',' + r.ty]) { S.timers[r.tx + ',' + r.ty] = 0.07; SFX.crack(); }
        if (r.c === 'W' && !S.wob) { S.wob = 1; SFX.crack(); }
      } else if (P.vy < 0) P.y = r.y + r.h;
      P.vy = 0;
    }
    if (P.ground && !wasGround && vy0 > 250) { P.sq = 0.4; SFX.land(); spawnParts(P.x + P.w / 2, P.y + P.h, 6, '#cdbfa0', 90, false); }
    if (P.ground) P.walk += Math.abs(P.vx) * dt * 0.06;
    if (P.y > VH + 60) kill('fall');
  }
  P.sq = lerp(P.sq, 0, Math.min(1, dt * 12));

  // ---- falling tiles
  for (const key in S.timers) {
    if (S.timers[key] === true) continue;
    S.timers[key] -= dt;
    if (S.timers[key] <= 0) {
      const [tx, ty] = key.split(',').map(Number);
      S.fallers.push({ x: tx * T, y: ty * T, vy: 40, plank: ty < 10 }); S.g[ty][tx] = ' '; S.timers[key] = true;
      spawnParts(tx * T + 20, ty * T + 8, 5, '#8a6a4a', 100, false);
    }
  }
  for (const f of S.fallers) { f.vy += 2100 * dt; f.y += f.vy * dt; }
  S.fallers = S.fallers.filter((f) => f.y < VH + 80);

  // ---- hazards on the grid
  const px0 = P.x + 4, px1 = P.x + P.w - 4, py1 = P.y + P.h;
  for (let ty = Math.floor(P.y / T); ty <= Math.floor((py1 - 1) / T); ty++) for (let tx = Math.floor(px0 / T); tx <= Math.floor(px1 / T); tx++) {
    const c = tile(tx, ty);
    if (c === '^' && py1 > ty * T + 18) kill('spike');
    if (c === 'h' && (S.pops[tx + ',' + ty] || 0) > 0.7 && py1 > ty * T + 16) kill('spike');
  }
  // hidden spikes pop up
  for (let ty = 0; ty < ROWS; ty++) for (let tx = Math.max(0, Math.floor(G.cam / T) - 1); tx < Math.min(L.w, Math.floor(G.cam / T) + 26); tx++) {
    if (S.g[ty][tx] !== 'h') continue;
    const key = tx + ',' + ty;
    if (S.pops[key] === undefined) {
      const near = L.hidden === 'air' ? (!P.ground && pcx > L.airZone[0] && pcx < L.airZone[1]) : Math.abs(pcx - (tx + 0.5)) < 1.7 && Math.abs(P.y + P.h - (ty + 1) * T) < 90;
      if (near && !P.dead) { S.pops[key] = 0.001; SFX.pop(); }
    } else if (S.pops[key] < 1) S.pops[key] = Math.min(1, S.pops[key] + dt * 9);
  }

  // ---- objects
  const pmx = P.x + P.w / 2, pmy = P.y + P.h / 2;
  for (const o of S.objs) {
    if (o.t === 'gift' || o.t === 'fakegoal') {
      const ox = o.x * T + 20, oy = o.y * T + (o.t === 'gift' ? 22 : 10), rad = o.t === 'gift' ? 27 : 30;
      if (!o.st && Math.hypot(pmx - ox, pmy - oy) < rad) { o.st = 1; spawnParts(ox, oy, 40, '#ff5a3c', 420); spawnParts(ox, oy, 24, '#ffd76a', 320); kill('boom'); }
    } else if (o.t === 'drop') {
      if (!o.st && pcx >= o.trig && !P.dead) { o.st = 1; SFX.crack(); }
      if (o.st === 1 && o.mode === 'fall') {
        o.vy += 2100 * dt; o.py += o.vy * dt;
        const ox = o.x * T + 20, oy = 150 + o.py;
        if (Math.abs(pmx - ox) < 25 && Math.abs(pmy - oy) < 30) { o.st = 2; spawnParts(ox, oy, 30, '#ff5a3c', 380); kill('boom'); }
        else if (oy > 388) { o.st = 2; spawnParts(ox, 392, 22, '#ff7a3d', 260); SFX.pop(); G.shake = 4; }
      }
      if (o.st === 1 && o.mode === 'fake') o.py += dt;
    } else if (o.t === 'shy') {
      if (!m.shy && !o.st && !P.ground && P.vx > 60 && pmx > (o.ox - 2.4) * T && pmx < o.ox * T) { o.st = 1; m.shy = true; SFX.whoosh(); }
      if (o.st === 1) o.x = Math.min(o.ox + o.shift, o.x + dt * 13);
    }
  }
  // goal that runs away once
  if (L.goalRun && !m.goalRan && S.goal.x * T + 20 - pmx < 3.1 * T && !P.dead) { m.goalRan = true; S.goal.tx = L.goalRun; SFX.whoosh(); say('Ấy chết. Gió thổi bay cổng hội rồi.', { now: true }); G.lies++; }
  if (S.goal.x < S.goal.tx) S.goal.x = Math.min(S.goal.tx, S.goal.x + dt * 22);

  // ---- the one true instruction
  if (L.trust && !m.trusted && !P.dead) {
    const t = L.trust, on = P.ground && pcx >= t.a && pcx <= t.b && Math.abs(P.vx) < 20;
    const prev = S.stand;
    S.stand = on ? S.stand + dt : Math.max(0, S.stand - dt * 3);
    if (prev < 1.3 && S.stand >= 1.3) say('Đúng rồi. Cứ đứng đó.', { now: true });
    if (prev < 2.7 && S.stand >= 2.7) say('Đừng nhúc nhích nha.', { now: true });
    if (S.stand >= 4.2) { m.trusted = true; S.bridgeN = 0; say('Cảm ơn bé. Lâu lắm rồi mới có người chịu tin tôi.', { now: true }); }
  }
  if (L.trust && m.trusted) {
    const t = L.trust; S.bridgeT -= dt;
    while (S.bridgeT <= 0 && t.from + S.bridgeN <= t.to) {
      const x = t.from + S.bridgeN;
      if (S.g[t.row][x] !== 'B') { S.g[t.row][x] = 'B'; SFX.bridge(S.bridgeN); spawnParts(x * T + 20, t.row * T + 4, 6, '#fff3c4', 90); S.bridgeT += 0.06; }
      S.bridgeN++;
    }
  }

  // ---- goal
  if (!P.dead && !S.won && Math.abs(pmx - (S.goal.x * T + 20)) < 26 && Math.abs(pmy - (S.goal.y * T + 20)) < 34 && S.goal.x === S.goal.tx) {
    S.won = L.finale ? 2.6 : 1.0; SFX.win(); spawnParts(pmx, pmy, 40, '#ffe9a8', 260, true, 120);
  }

  // ---- particles, camera
  for (const p of parts) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
  if (!P.dead && Math.random() < dt * 14) parts.push({ x: pmx + rnd(-8, 8), y: pmy + rnd(-8, 8), vx: rnd(-10, 10) - P.vx * 0.1, vy: rnd(-30, -5), life: 0.7, max: 0.7, col: '#ffe08a', r: rnd(1, 2.2), glow: true, grav: -20 });
  const want = clamp(P.x + P.w / 2 - VW * 0.42 + P.face * 40, 0, L.w * T - VW);
  G.cam = lerp(G.cam, want, Math.min(1, dt * 5));
  G.shake = Math.max(0, G.shake - dt * 30); G.flash = Math.max(0, G.flash - dt * 2.5);
}

function nextLevel() {
  if (G.li + 1 >= LEVELS.length) { ending(); return; }
  G.state = 'card';
  const n = G.li + 1;
  $('cardn').textContent = `MÀN ${n + 1}`; $('cardt').textContent = LEVELS[n].name; $('card').classList.add('on');
  loadLevel(n); save();
  setTimeout(() => { $('card').classList.remove('on'); G.state = 'play'; }, 1300);
}
function ending() {
  G.state = 'end';
  $('e1').textContent = G.falls; $('e2').textContent = G.lies; $('end').classList.remove('off'); $('hud').classList.remove('on'); $('sub').classList.remove('on');
  try { localStorage.removeItem('cuoi.save'); } catch { /* ignore */ }
}
function start(fresh) {
  audioInit();
  if (fresh) { G.li = 0; G.falls = 0; G.lies = 0; mem.forEach((m) => { m.said.clear(); m.shy = m.goalRan = m.trusted = m.invOut = false; m.inv = 0; }); }
  sub.q.length = 0; sub.text = '';
  loadLevel(G.li);
  $('menu').classList.add('off'); $('end').classList.add('off'); $('hud').classList.add('on');
  G.state = 'play';
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
function drawPlayer() {
  if (P.dead) return;
  const x = P.x + P.w / 2, y = P.y + P.h / 2 - 1;
  cx.globalCompositeOperation = 'lighter'; glow(cx, x, y, 130, 'rgba(255,205,110,0.42)'); glow(cx, x, y, 44, 'rgba(255,240,190,0.6)'); cx.globalCompositeOperation = 'source-over';
  // legs
  cx.strokeStyle = '#7a3b20'; cx.lineWidth = 3; cx.lineCap = 'round';
  const sw = P.ground ? Math.sin(P.walk * 6.283) * 5 : 3;
  cx.beginPath(); cx.moveTo(x - 5, y + 9); cx.lineTo(x - 5 + sw, y + 15); cx.moveTo(x + 5, y + 9); cx.lineTo(x + 5 - sw, y + 15); cx.stroke();
  cx.save(); cx.translate(x, y); cx.scale(1 + P.sq, 1 - P.sq); cx.rotate(P.vx * 0.0007 + (P.ground ? 0 : P.vy * 0.0002 * P.face));
  const star = (R, r) => { cx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r : R; cx.lineTo(Math.cos(a) * q, Math.sin(a) * q); } cx.closePath(); };
  cx.strokeStyle = '#e8452e'; cx.lineWidth = 2; cx.beginPath(); cx.arc(0, 0, 16.5, 0, 7); cx.stroke();
  const sg = cx.createRadialGradient(0, -3, 1, 0, 0, 16); sg.addColorStop(0, '#fffbe0'); sg.addColorStop(1, '#ffb53e');
  star(16, 7.2); cx.fillStyle = sg; cx.fill(); cx.strokeStyle = '#d9412b'; cx.lineWidth = 1.6; cx.lineJoin = 'round'; cx.stroke();
  cx.fillStyle = '#3a1c12'; const blink = Math.sin(G.time * 0.9) > 0.985 ? 0.3 : 1;
  cx.beginPath(); cx.ellipse(-3.2 + P.face * 1.2, -0.5, 1.5, 2.2 * blink, 0, 0, 7); cx.ellipse(3.2 + P.face * 1.2, -0.5, 1.5, 2.2 * blink, 0, 0, 7); cx.fill();
  cx.restore();
  // tassel
  cx.strokeStyle = '#e8452e'; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(x - P.face * 10, y + 10); cx.quadraticCurveTo(x - P.face * 16 - P.vx * 0.03, y + 16, x - P.face * 13 - P.vx * 0.05, y + 22 + Math.sin(G.time * 8) * 1.5); cx.stroke();
}

function render() {
  const L = S.L, m = mem[G.li];
  const shx = (Math.random() - 0.5) * G.shake, shy = (Math.random() - 0.5) * G.shake;
  cx.setTransform(scale, 0, 0, scale, 0, 0);
  drawSky();
  const cam = G.cam;
  cx.drawImage(backFar, -cam * 0.12, 0);
  cx.drawImage(backMid, -cam * 0.38, 20);
  const hz = cx.createLinearGradient(0, 330, 0, VH); hz.addColorStop(0, 'rgba(120,70,110,0)'); hz.addColorStop(1, G.invertNow ? 'rgba(150,40,50,0.5)' : 'rgba(110,70,120,0.42)');
  cx.fillStyle = hz; cx.fillRect(0, 330, VW, 210);

  cx.save(); cx.translate(Math.round(-cam + shx), Math.round(shy));
  const x0 = Math.max(0, Math.floor(cam / T) - 1), x1 = Math.min(L.w - 1, Math.floor((cam + VW) / T) + 1);
  // trust mark
  if (L.trust) {
    const t = L.trust, mxp = (t.a + t.b) / 2 * T, pr = m.trusted ? 1 : S.stand / 4.2;
    cx.globalCompositeOperation = 'lighter'; glow(cx, mxp, 400, 90 + pr * 60, 'rgba(255,240,180,0.55)', 0.55 + 0.25 * Math.sin(G.time * 3) + pr * 0.4); cx.globalCompositeOperation = 'source-over';
    cx.strokeStyle = 'rgba(255,245,200,0.9)'; cx.lineWidth = 2; cx.beginPath(); cx.ellipse(mxp, 401, 52, 7, 0, 0, 7); cx.stroke();
    if (pr > 0 && pr < 1) { cx.strokeStyle = '#fff'; cx.lineWidth = 4; cx.beginPath(); cx.arc(mxp, 330, 16, -Math.PI / 2, -Math.PI / 2 + pr * 6.283); cx.stroke(); }
  }
  for (let ty = 0; ty < ROWS; ty++) for (let tx = x0; tx <= x1; tx++) {
    const c = S.g[ty][tx], x = tx * T, y = ty * T;
    if (c === ' ') continue;
    if (c === '#' || (c === 'F' && ty >= 10)) {
      const shake = c === 'F' && S.timers[tx + ',' + ty] ? rnd(-1.5, 1.5) : 0;
      cx.fillStyle = '#1c1833'; cx.fillRect(x + shake, y, T, T);
      cx.fillStyle = '#272145'; cx.fillRect(x + shake + ((ty % 2) * 20), y + 13, 19, 12); cx.fillRect(x + shake + (((ty + 1) % 2) * 20), y + 27, 19, 12);
      const up = ty > 0 ? S.g[ty - 1][tx] : ' ';
      if (up !== '#' && up !== 'F') roofCap(x + shake, y);
      if (c === '#' && tile(tx - 1, ty) !== '#' && tile(tx - 1, ty) !== 'F') { cx.fillStyle = 'rgba(160,190,255,0.16)'; cx.fillRect(x, y, 2, T); }
    } else if (c === '=' || c === 'f' || c === 'F') plank(x + (S.timers[tx + ',' + ty] ? rnd(-1.5, 1.5) : 0), y);
    else if (c === '^') spikes(x, y, 1);
    else if (c === 'h') { const k = S.pops[tx + ',' + ty] || 0; if (k > 0) spikes(x, y, k); }
    else if (c === 'i') { if (S.shown[tx + ',' + ty]) { cx.fillStyle = 'rgba(170,215,255,0.16)'; cx.fillRect(x, y, T, T); cx.strokeStyle = 'rgba(200,230,255,0.6)'; cx.lineWidth = 1; cx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1); cx.beginPath(); cx.moveTo(x + 6, y + 14); cx.lineTo(x + 16, y + 4); cx.stroke(); } }
    else if (c === 'B' || c === 'W') {
      const wob = c === 'W' && S.wob ? Math.sin(G.time * 22) * 2 : 0;
      cx.globalCompositeOperation = 'lighter'; glow(cx, x + 20, y + 6, 46, 'rgba(255,240,180,0.34)'); cx.globalCompositeOperation = 'source-over';
      const bg = cx.createLinearGradient(0, y, 0, y + 22); bg.addColorStop(0, 'rgba(255,250,225,0.96)'); bg.addColorStop(0.5, 'rgba(255,225,150,0.5)'); bg.addColorStop(1, 'rgba(255,220,140,0)');
      cx.fillStyle = bg; cx.fillRect(x, y + wob, T, 22);
      cx.fillStyle = 'rgba(255,255,255,0.9)'; cx.fillRect(x, y + wob, T, 2);
    }
  }
  for (const f of S.fallers) { if (f.plank) plank(f.x, f.y); else { cx.fillStyle = '#1c1833'; cx.fillRect(f.x, f.y, T, T); roofCap(f.x, f.y); } }
  for (const o of S.objs) {
    if (o.t === 'gift' && !o.st) lantern(o.x * T + 20, o.y * T + 20 + Math.sin(G.time * 3 + o.x) * 2, 0.95);
    else if (o.t === 'fakegoal' && !o.st) gate(o.x * T, o.y * T, true);
    else if (o.t === 'flag') { const fx = o.x * T + 20, fy = o.y * T + T; cx.fillStyle = '#d8c9a0'; cx.fillRect(fx - 1.5, fy - 62, 3, 62); const wv = Math.sin(G.time * 5) * 3; cx.fillStyle = '#e8452e'; cx.beginPath(); cx.moveTo(fx + 1, fy - 62); cx.lineTo(fx + 30, fy - 55 + wv); cx.lineTo(fx + 1, fy - 44); cx.fill(); cx.fillStyle = '#f2c14e'; cx.beginPath(); cx.moveTo(fx + 1, fy - 58); cx.lineTo(fx + 17, fy - 54 + wv * 0.6); cx.lineTo(fx + 1, fy - 49); cx.fill(); }
    else if (o.t === 'drop' && o.st < 2) {
      const sway = o.st === 1 && o.mode === 'fake' ? Math.sin(o.py * 16) * 9 * Math.exp(-o.py * 1.2) : Math.sin(G.time * 1.5 + o.x) * 1.5;
      const lx = o.x * T + 20 + sway, ly = 150 + (o.mode === 'fall' ? o.py : 0);
      if (!(o.st === 1 && o.mode === 'fall')) { cx.strokeStyle = 'rgba(0,0,0,0.65)'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(o.x * T + 20, 0); cx.lineTo(lx, ly - 18); cx.stroke(); }
      lantern(lx, ly, 1);
    } else if (o.t === 'shy') for (let k = 0; k < o.w; k++) plank(o.x * T + k * T, o.y * T);
  }
  if (L.finale) banyan(S.goal.x * T, S.goal.y * T); else gate(S.goal.x * T, S.goal.y * T, false);
  for (const f of flies) { const fx = f.x + Math.sin(G.time * f.s + f.p) * 40, fy = f.y + Math.cos(G.time * f.s * 1.3 + f.p) * 24; if (fx < cam - 20 || fx > cam + VW + 20) continue; cx.globalCompositeOperation = 'lighter'; glow(cx, fx, fy, 9, 'rgba(210,255,150,0.9)', 0.5 + 0.5 * Math.sin(G.time * 3 + f.p)); cx.globalCompositeOperation = 'source-over'; }
  drawPlayer();
  for (const p of parts) {
    const a = clamp(p.life / p.max, 0, 1);
    if (p.glow) { cx.globalCompositeOperation = 'lighter'; glow(cx, p.x, p.y, p.r * 4, p.col, a * 0.7); cx.globalCompositeOperation = 'source-over'; }
    cx.globalAlpha = a; cx.fillStyle = p.col; cx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r); cx.globalAlpha = 1;
  }
  cx.restore();
  // mist, vignette, flashes
  const fog = cx.createLinearGradient(0, 430, 0, VH); fog.addColorStop(0, 'rgba(20,18,50,0)'); fog.addColorStop(1, 'rgba(14,12,40,0.75)'); cx.fillStyle = fog; cx.fillRect(0, 430, VW, 110);
  const vg = cx.createRadialGradient(VW / 2, VH / 2, VH * 0.45, VW / 2, VH / 2, VH * 0.95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,10,0.6)'); cx.fillStyle = vg; cx.fillRect(0, 0, VW, VH);
  if (G.invertNow) { cx.fillStyle = `rgba(255,40,60,${0.07 + 0.04 * Math.sin(G.time * 8)})`; cx.fillRect(0, 0, VW, VH); }
  if (G.flash > 0) { cx.fillStyle = `rgba(255,230,190,${G.flash * 0.5})`; cx.fillRect(0, 0, VW, VH); }
  if (S.won && L.finale) { cx.fillStyle = `rgba(255,245,215,${clamp(1 - S.won / 2.2, 0, 1)})`; cx.fillRect(0, 0, VW, VH); }
}

// ============================================================ boot, input, loop
let scale = 1;
function resize() {
  const w = innerWidth, h = innerHeight, s = Math.min(w / VW, h / VH), dpr = Math.min(devicePixelRatio || 1, 2);
  const st = $('stage'); st.style.width = VW * s + 'px'; st.style.height = VH * s + 'px';
  cv.width = Math.round(VW * s * dpr); cv.height = Math.round(VH * s * dpr); scale = cv.width / VW;
}
addEventListener('resize', resize); resize();
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('touch');

function anyStart() {
  if (G.state === 'menu') start(!hasSave);
  else if (G.state === 'end') { start(true); }
}
addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyM') toggleMute();
  else if (G.state === 'menu' || G.state === 'end') anyStart();
  else if (e.code === 'KeyR' && G.state === 'play' && !P.dead) kill('fall');
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
$('menu').addEventListener('pointerup', anyStart); $('end').addEventListener('pointerup', anyStart);
function toggleMute() { AU.on = !AU.on; if (AU.master) AU.master.gain.value = AU.on ? 0.5 : 0; $('mute').textContent = 'âm thanh: ' + (AU.on ? 'bật' : 'tắt'); }
$('mute').addEventListener('click', (e) => { toggleMute(); e.currentTarget.blur(); });
for (const [id, k] of [['pl', 'left'], ['pr', 'right'], ['pj', 'jump']]) {
  const el = $(id), set = (v) => (e) => { e.preventDefault(); pad[k] = v; el.classList.toggle('down', v); };
  el.addEventListener('pointerdown', set(true)); el.addEventListener('pointerup', set(false)); el.addEventListener('pointercancel', set(false)); el.addEventListener('pointerleave', set(false));
}
addEventListener('contextmenu', (e) => e.preventDefault());

const hasSave = loadSave();
if (hasSave) $('gotxt').textContent = `CHẠM HOẶC NHẤN PHÍM ĐỂ CHƠI TIẾP · MÀN ${G.li + 1}`;
loadLevel(G.li);
const STEP = 1 / 120;
let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  while (acc >= STEP) {
    if (G.state === 'play') { update(STEP); tickSub(STEP); }
    else { G.time += STEP; if (G.state === 'menu') G.cam = (Math.sin(G.time * 0.12) * 0.5 + 0.5) * (S.L.w * T - VW); }
    acc -= STEP;
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// test hook: advance the simulation deterministically with scripted input
window.__cuoi = { G, P, mem, LEVELS, get S() { return S; }, start, loadLevel, step(n, bot) { G.bot = bot; for (let i = 0; i < n; i++) { update(STEP); tickSub(STEP); } G.bot = null; }, render };
})();
