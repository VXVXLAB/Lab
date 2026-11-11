// NÓI DỐI NHƯ CUỘI (3D): the mid-autumn night mode. The yard is strung with paper lanterns, the player carries a
// star lantern instead of a pistol, and Cuội, up on the moon, gives directions that are almost all lies.
import * as THREE from 'three';
import { textures } from './fx.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = new THREE.Vector3(), V2 = new THREE.Vector3();
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, x, z) => Math.hypot(a.x - x, a.z - z);

const TAUNTS = [
  ['Ơ, ai giăng pháo ngang đường vậy ta.', 'Đi thẳng mà. Thẳng vào dây pháo.', 'Tôi quên nhắc sợi dây. Tại nó nhỏ quá.'],
  ['Pháo đó. Quà trung thu của tôi. Vui không?', 'Cái sáng nhất chưa chắc là cái tốt nhất, bé ạ.'],
  ['Dây buộc hơi lỏng. Lỗi của gió.', 'Tôi bảo thong thả, bé thong thả thật à?', 'Lần này đứng lại mới là dại. Tôi có nói đâu.'],
  ['Chân nào cũng mỏi như nhau thôi.', 'Bé cứ nghĩ ngược lại là được.', 'Trăng đỏ là tôi đang giúp đó.'],
  ['Tôi nói thật mà.', 'Cả đêm tôi lừa bé, nên bé không tin. Tôi hiểu.', 'Một lần thôi. Đứng yên trong vệt trăng.'],
];
const COLORS = [[1.5, 0.16, 0.07], [1.35, 0.55, 0.07], [1.35, 0.17, 0.34], [1.25, 0.85, 0.14]];

export function createCuoi(ctx) {
  const { game, scene, level, player, weapon, fx, audio, banner, finish, $, sun } = ctx;
  const R = { stage: 0, deaths: 0, lies: 0, said: new Set(), t: 0, respawn: 0 };
  let st = {};
  const known = {};
  game.fireGate = () => false;    // no shooting on a festival night
  game.noAim = true;

  // ---------------------------------------------------------------- subtitles
  const radio = $('radio'), radioText = $('radiotext');
  const queue = []; let line = null, shown = 0, hold = 0;
  function say(text, o = {}) {
    if (o.once) { if (R.said.has(text)) return; R.said.add(text); }
    if (o.lie) R.lies++;
    if (o.now) { queue.length = 0; line = null; }
    queue.push({ text, red: !!o.red });
  }
  function tickSay(dt) {
    if (!line && queue.length) { line = queue.shift(); shown = 0; hold = Math.max(2.6, line.text.length * 0.06) + 0.5; radio.classList.add('on'); radio.classList.toggle('red', line.red); }
    if (!line) return;
    const b = Math.floor(shown); shown = Math.min(line.text.length, shown + dt * 44);
    if (Math.floor(shown) !== b) { radioText.textContent = line.text.slice(0, Math.floor(shown)); if (Math.floor(shown) % 3 === 0) audio.click(700 + (shown % 5) * 60, 0.05); }
    hold -= dt;
    if (hold <= 0 || (queue.length && shown >= line.text.length && hold < 1.4)) { line = null; if (!queue.length) radio.classList.remove('on'); }
  }

  // ---------------------------------------------------------------- lanterns
  const paper = COLORS.map((c) => new THREE.MeshStandardMaterial({ color: 0x2a0d08, emissive: new THREE.Color(c[0], c[1], c[2]), emissiveIntensity: 1, roughness: 0.8 }));
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.9, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9 });
  const bodyGeo = new THREE.SphereGeometry(0.16, 18, 12).scale(1, 1.18, 1);
  const capGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.035, 12);
  const tasselGeo = new THREE.CylinderGeometry(0.006, 0.012, 0.16, 6);
  function lantern(ci, s = 1) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(bodyGeo, paper[ci]); g.add(b);
    const t = new THREE.Mesh(capGeo, gold); t.position.y = 0.19; g.add(t);
    const u = new THREE.Mesh(capGeo, gold); u.position.y = -0.19; g.add(u);
    const k = new THREE.Mesh(tasselGeo, paper[0]); k.position.y = -0.29; g.add(k);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: new THREE.Color(COLORS[ci][0], COLORS[ci][1], COLORS[ci][2]).multiplyScalar(0.12), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(1.1); halo.userData.noAO = true; g.add(halo);
    g.scale.setScalar(s);
    return g;
  }
  const decor = new THREE.Group(); decor.name = 'lanterns'; scene.add(decor);
  const swing = [];
  function string(a, b, sag, n) {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(new THREE.Vector3().lerpVectors(a, b, t).setY(THREE.MathUtils.lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * sag)); }
    decor.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.008, 5), dark));
    for (let i = 1; i < n; i++) {
      const t = i / n, l = lantern((i + Math.round(a.x + a.z)) & 3, rnd(0.85, 1.15));
      l.position.lerpVectors(a, b, t).setY(THREE.MathUtils.lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * sag - 0.26);
      decor.add(l); swing.push({ l, p: rnd(0, 6.28) });
    }
  }
  for (const x of [-10.5, -3.5, 3.5, 10.5]) string(new THREE.Vector3(x, 6.1, -8.9), new THREE.Vector3(x + 1.2, 5.7, 8.9), 1.7, 11);
  string(new THREE.Vector3(-14.9, 6.6, -1.5), new THREE.Vector3(14.9, 6.6, 1.0), 2.1, 15);
  for (const [x, z, c] of [[-10, -4.5, 0xff8a3c], [-10, 4.5, 0xffa24a], [-0.5, -4.5, 0xff9a50], [0, 4.5, 0xff7a3c], [9.5, -4.5, 0xffa24a], [9.5, 4.5, 0xff8a3c]]) {
    const pl = new THREE.PointLight(c, 17, 16, 2); pl.position.set(x, 4.1, z); decor.add(pl);
  }

  // the star lantern in the player's hand, and the light it throws
  weapon.gun.visible = false;
  const star = new THREE.Group();
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.036 : 0.088; i ? shape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const starGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: false }).translate(0, 0, -0.011);
  star.add(new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 0.72, 0.2) })));
  star.add(new THREE.LineSegments(new THREE.EdgesGeometry(starGeo), new THREE.LineBasicMaterial({ color: new THREE.Color(1.2, 0.12, 0.06) })));
  const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.094, 0.0035, 6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.1, 0.05) })); star.add(ringM);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 }));
  stick.position.set(0.02, -0.33, 0.03); stick.rotation.z = -0.08; stick.rotation.x = -0.12; star.add(stick);
  star.traverse((o) => { o.frustumCulled = false; });
  star.scale.setScalar(0.5); star.position.set(0.035, 0.035, 0.05);
  weapon.pose.add(star);
  const handLight = new THREE.PointLight(0xffb45a, 3.6, 10, 2);
  scene.add(handLight);

  // ---------------------------------------------------------------- the festival gate
  const gate = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0x7a1512, roughness: 0.55 });
  for (const x of [-0.9, 0.9]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.9, 0.16), red); p.position.set(x, 1.45, 0); p.castShadow = true; gate.add(p); }
  const beam1 = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.14, 0.24), red); beam1.position.y = 2.75; gate.add(beam1);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.1, 0.5), dark); roof.position.y = 2.95; gate.add(roof);
  const big = lantern(0, 2.1); big.position.y = 2.15; gate.add(big);
  const gateLight = new THREE.PointLight(0xff6a30, 10, 12, 2); gateLight.position.y = 2; gate.add(gateLight);
  scene.add(gate);
  const GATES = [new THREE.Vector3(12.4, 0, 3.4), null, new THREE.Vector3(12.4, 0, 3.4), new THREE.Vector3(-12.3, 0, -3.6), new THREE.Vector3(5, 0, 7.5)];

  // ---------------------------------------------------------------- firecrackers
  const cracker = new THREE.MeshStandardMaterial({ color: 0xb01a14, roughness: 0.6, emissive: 0x300402 });
  const crackGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.09, 8);
  function crackerBunch(n, spread) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) { const m = new THREE.Mesh(crackGeo, cracker); m.position.set(rnd(-spread, spread), rnd(0.02, 0.1), rnd(-spread, spread)); m.rotation.set(rnd(-1, 1), 0, rnd(-1, 1)); g.add(m); }
    return g;
  }
  const wire = new THREE.Group();
  wire.add(new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 6.9, 5).rotateX(Math.PI / 2).translate(1.5, 0.3, 5.45), dark));
  for (let z = 2.2; z < 8.8; z += 0.22) { const m = new THREE.Mesh(crackGeo, cracker); m.position.set(1.5, 0.24, z); wire.add(m); }
  scene.add(wire);
  const MINES = [[-8, 0.5], [-6.2, 3.6], [-3.4, 3.2], [-0.8, 2.4], [-1.6, 6.6], [1.9, 5.6], [2.6, 2.2], [3.4, 6.5], [6.6, 6.7], [4.3, 4.4], [-9.5, 2.6], [-5, -1]];
  const mines = MINES.map(([x, z]) => { const g = crackerBunch(16, 0.2); g.position.set(x, 0, z); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: new THREE.Color(3, 0.6, 0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.setScalar(0.22); s.position.y = 0.14; s.userData.noAO = true; g.add(s); g.userData.fuse = s; scene.add(g); return g; });

  // gifts and the moonlit circle
  const gifts = [[6, -0.5, 1, 1.5], [-6.5, -7.4, 3, 1.1], [-11, 1.6, 0, 0.75]].map(([x, z, ci, s]) => { const l = lantern(ci, s); l.position.set(x, 0.24 * s, z); scene.add(l); return l; });
  gifts[2].traverse((o) => { if (o.isSprite) o.visible = false; });   // the honest one does not glow much
  const moonSpot = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.25, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.0, 1.4), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
  disc.position.y = 0.02;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.6, 16, 32, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.8, 1.3), transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  shaft.position.y = 8;
  moonSpot.add(disc, shaft); moonSpot.traverse((o) => { o.userData.noAO = true; });
  moonSpot.position.set(-5, 0, -2.6); scene.add(moonSpot);
  const moonLight = new THREE.PointLight(0xbfd0ff, 0, 9, 2); moonLight.position.set(-5, 2.5, -2.6); scene.add(moonLight);

  // lanterns that can come down
  const droppers = [];
  for (let i = 0; i < 4; i++) { const l = lantern(i & 3, 2); l.visible = false; scene.add(l); droppers.push({ l, vy: 0, live: false, wait: 0 }); }
  function drop(x, z, delay = 0) {
    const d = droppers.find((q) => !q.live) || droppers[0];
    d.l.position.set(x, 5.4, z); d.l.visible = true; d.vy = 0; d.live = true; d.wait = delay;
    audio.click(500, 0.6); audio.click(380, 0.5, 0.06);
  }

  function boom(pos, scale = 1) { fx.explosion(V2.copy(pos).setY(0.3), scale); fx.decal(V2.copy(pos).setY(0), UP, 'scorch', 3 * scale); audio.explosion(pos, scale); }
  function die(pos) { boom(pos); game.onPlayerHit(999, V.set(1, 0, 0)); }
  const objective = (t) => { $('objtext').textContent = t; };
  const tint = $('tint');

  // ---------------------------------------------------------------- stages
  function enter(stage) {
    R.stage = stage; R.t = 0; st = {};
    player.invert = false; if (tint) tint.classList.remove('on');
    sun.color.set(0x9db6ff); scene.fog.color.set(0x070b1c);
    gate.visible = !!GATES[stage]; if (GATES[stage]) gate.position.copy(GATES[stage]);
    wire.visible = stage === 0;
    for (const m of mines) m.visible = stage === 3;
    gifts.forEach((g) => { g.visible = stage === 1; });
    moonSpot.visible = stage === 4; moonLight.intensity = stage === 4 ? 5 : 0;
    for (const d of droppers) { d.live = false; d.l.visible = false; }
    for (const pk of level.pickups) pk.group.visible = false;
    if (stage === 0) {
      objective('VỀ HỘI TRĂNG RẰM');
      say('Chào Bé Sao! Tôi là Cuội, ngồi trên cung trăng nè. Lạc đường về hội hả?', { once: true });
      say('Cổng hội có chiếc đèn lồng to, ngay trước mặt đó. Cứ đi thẳng là tới.', { once: true, lie: true });
    } else if (stage === 1) {
      objective('TÌM QUÀ TRUNG THU');
      if (!known.gift) { say('Ấy, khoan. Vào hội phải có quà chứ. Tôi cất cổng đi một lát nhé.', { now: true }); say('Chiếc đèn sáng nhất giữa sân là tôi để phần bé đó. Nhặt đi.', { lie: true }); }
      else if (!known.empty) say('Thôi, chiếc đèn hồng ở góc xa kia mới là quà thật.', { lie: true });
      else say('Còn cái đèn tối thui gần chỗ bé đứng lúc đầu. Cái đó thì đừng lấy, xấu lắm.', { lie: true });
    } else if (stage === 2) {
      objective('QUA DƯỚI DÂY ĐÈN, TỚI CỔNG HỘI');
      say('Có quà rồi. Cổng hội ở góc bên kia. Đèn treo buộc chắc lắm, cứ thong thả mà đi.', { now: true, lie: true });
    } else if (stage === 3) {
      objective('ĐUỔI THEO CỔNG HỘI');
      player.invert = true; if (tint) tint.classList.add('on');
      sun.color.set(0xff5a48); scene.fog.color.set(0x1c0708);
      say('Ấy chết, gió thổi bay cổng hội rồi. Mà bé đi nãy giờ mỏi chân chưa? Để tôi đổi chân cho.', { now: true, lie: true });
      say('Tiến là lùi. Trái là phải. Dễ mà. À, đừng giẫm lên pháo.', {});
    } else if (stage === 4) {
      objective('ĐỨNG YÊN TRONG VỆT TRĂNG');
      say('Bé Sao này. Lần này tôi nói thật.', { now: true });
      say('Cái cổng kia là pháo đó. Đừng tới. Đứng yên trong vệt trăng giữa sân và đợi tôi.');
    }
  }

  function update(dt) {
    tickSay(dt); R.t += dt;
    const p = player.pos, t = R.t;
    // ambience: swaying lanterns, the star in hand, fuses
    for (const s of swing) s.l.rotation.z = Math.sin(t * 0.9 + s.p) * 0.06;
    star.rotation.set(Math.sin(t * 1.3) * 0.05, Math.sin(t * 0.7) * 0.25, Math.sin(t * 1.1) * 0.06 + player.roll * 4);
    handLight.position.copy(player.eye).addScaledVector(player.forward, 0.5); handLight.position.y -= 0.25;
    handLight.intensity = 3.6 + Math.sin(t * 11) * 0.12 + Math.sin(t * 23) * 0.08;
    big.rotation.z = Math.sin(t * 1.2) * 0.05;
    for (const m of mines) if (m.visible) m.userData.fuse.material.opacity = 0.5 + 0.5 * Math.sin(t * 9 + m.position.x);

    // falling lanterns
    for (const d of droppers) {
      if (!d.live) continue;
      if (d.wait > 0) { d.wait -= dt; d.l.rotation.z = Math.sin(t * 40) * 0.2; continue; }
      d.vy -= 9.8 * dt; d.l.position.y += d.vy * dt;
      if (d.l.position.y < 2 && d.l.position.y > 0.3 && dist2(d.l.position, p.x, p.z) < 0.75 && !player.dead && R.respawn <= 0) { d.live = false; d.l.visible = false; die(d.l.position); }
      else if (d.l.position.y <= 0.3) { d.live = false; d.l.visible = false; boom(d.l.position, 0.45); }
    }

    if (R.respawn > 0) {
      R.respawn -= dt; ctx.fade(Math.min(1, (1.7 - R.respawn) / 1.2));
      if (R.respawn <= 0) { level.restoreProps(); player.reset(); weapon.reset(); ctx.fade(0); enter(R.stage); }
      $('retries').textContent = `SỐ LẦN NGÃ ${R.deaths}`;
      return;
    }
    const atGate = gate.visible && dist2(gate.position, p.x, p.z) < 1.3;

    if (R.stage === 0) {
      if (!st.blown && Math.abs(p.x - 1.5) < 0.35 && p.z > 2 && p.z < 8.9 && p.y < 0.5) { st.blown = 1; wire.visible = false; for (let z = 2.5; z < 8.8; z += 1.6) fx.explosion(V2.set(1.5, 0.3, z), 0.5); die(V.set(1.5, 0, p.z)); }
      if (p.x > -6 && !st.hint) { st.hint = 1; say('Đấy, cứ thế. Đừng nhìn xuống chân làm gì.', { lie: true, once: true }); }
      if (atGate) { say('Ủa, đi vòng hả? Ai dạy bé cãi lời người lớn vậy?', { now: true }); enter(1); }
    } else if (R.stage === 1) {
      const near = (g, r) => g.visible && dist2(g.position, p.x, p.z) < r;
      if (near(gifts[0], 1.5)) { known.gift = true; gifts[0].visible = false; die(gifts[0].position); }
      else if (near(gifts[1], 1.2)) { known.empty = true; gifts[1].visible = false; audio.dryFire(); banner('', 'ĐÈN RỖNG', 1.4); say('Rỗng. Chắc ai lấy mất nến rồi.', { now: true }); say('Còn cái đèn tối thui gần chỗ bé đứng lúc đầu. Cái đó thì đừng lấy, xấu lắm.', { lie: true }); }
      else if (near(gifts[2], 1.2)) { gifts[2].visible = false; audio.pickup(); banner('', 'CÓ QUÀ RỒI', 1.4); enter(2); }
    } else if (R.stage === 2) {
      const d = dist2(gate.position, p.x, p.z), sp = Math.hypot(player.vel.x, player.vel.z);
      // the first two aim at where a steady walker will be; the third at where a careful one stops
      if (d < 16 && !st.a && sp > 1) { st.a = 1; drop(p.x + player.vel.x * 0.75, p.z + player.vel.z * 0.75); }
      if (d < 10.5 && !st.b) { st.b = 1; drop(p.x + player.vel.x * 0.75, p.z + player.vel.z * 0.75); say('Cái đó… chỉ là gió thôi.', { now: true, lie: true }); }
      if (d < 6 && !st.c) { st.c = 1; drop(p.x, p.z, 0.25); }
      if (atGate) enter(3);
    } else if (R.stage === 3) {
      for (const m of mines) if (m.visible && dist2(m.position, p.x, p.z) < 0.8 && p.y < 0.6) { m.visible = false; die(m.position); break; }
      if (atGate) enter(4);
    } else if (R.stage === 4) {
      if (dist2(gate.position, p.x, p.z) < 2.6) { gate.visible = false; die(gate.position); return; }
      const inside = dist2(moonSpot.position, p.x, p.z) < 1.15, still = Math.hypot(player.vel.x, player.vel.z) < 0.35;
      const prev = st.w || 0;
      st.w = inside && still ? prev + dt : Math.max(0, prev - dt * 3);
      const w = st.w;
      if (prev < 1.2 && w >= 1.2) say('Đúng rồi. Cứ đứng đó.', { now: true });
      if (prev < 3 && w >= 3) { drop(moonSpot.position.x + 1.9, moonSpot.position.z + 0.6, 0.2); say('Đừng nhúc nhích nha.', { now: true }); }
      disc.material.opacity = 0.35 + 0.1 * Math.sin(t * 3) + w * 0.08; shaft.material.opacity = 0.06 + w * 0.03; moonLight.intensity = 5 + w * 5;
      $('prompt').textContent = w > 0.2 ? `ĐỨNG YÊN  ${Math.max(0, 6.5 - w).toFixed(1)}` : ''; $('prompt').classList.toggle('on', w > 0.2);
      if (w >= 6.5 && !st.done) {
        st.done = 1; audio.announce(true);
        say('Cảm ơn bé. Lâu lắm rồi mới có người chịu tin tôi.', { now: true });
        say('Bé biết vì sao người ta nói “nói dối như Cuội” không? Vì ai lên tới đây rồi cũng về. Tôi bày trò để họ nán lại thêm một chút.');
        st.end = 9;
      }
      if (st.end) { st.end -= dt; ctx.fade(-Math.min(1.6, (9 - st.end) / 6)); if (st.end <= 0) { st.end = 0; st.w = -1e9; finish('BÉ SAO NGỒI VỚI CUỘI ĐẾN HẾT ĐÊM RẰM', `số lần ngã ${R.deaths} &nbsp;·&nbsp; số lần Cuội nói dối ${R.lies} &nbsp;·&nbsp; số lần bé chịu tin 1`); } }
    }
    if (R.stage !== 4) $('prompt').classList.remove('on');
    $('retries').textContent = `SỐ LẦN NGÃ ${R.deaths}`;
  }

  return {
    update, state: R,
    get stage() { return R.stage; }, get deaths() { return R.deaths; },
    onDeath() { if (R.respawn <= 0) { R.deaths++; R.respawn = 1.7; say(pick(TAUNTS[R.stage]), { now: true, red: true }); } },
    restart(full) { if (full) { R.deaths = 0; R.lies = 0; R.said.clear(); for (const k in known) delete known[k]; } queue.length = 0; line = null; radio.classList.remove('on'); R.respawn = 0; ctx.fade(0); enter(full ? 0 : R.stage); },
    jump(stage) { level.restoreProps(); enter(stage); },
  };
}
