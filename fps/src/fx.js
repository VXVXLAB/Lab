// Pooled visual effects: smoke/dust sprites, sparks, bullet-hole decals, tracers, light flashes, shell casings.
import * as THREE from 'three';

function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);

export const textures = {};
function initTextures() {
  textures.smoke = canvasTex(128, (g, s) => {
    for (let i = 0; i < 26; i++) {
      const x = s / 2 + rnd(-0.2, 0.2) * s, y = s / 2 + rnd(-0.2, 0.2) * s, r = rnd(0.14, 0.3) * s;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.16)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(0, 0, s, s);
    }
  });
  textures.glow = canvasTex(64, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
  });
  textures.flash = canvasTex(128, (g, s) => {
    g.translate(s / 2, s / 2);
    const core = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.3);
    core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.4, 'rgba(255,220,150,0.7)'); core.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = core; g.fillRect(-s / 2, -s / 2, s, s);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      g.save(); g.rotate(rnd(0, Math.PI * 2));
      const len = rnd(0.25, 0.5) * s, wd = rnd(0.02, 0.06) * s;
      const sg = g.createLinearGradient(0, 0, len, 0);
      sg.addColorStop(0, 'rgba(255,240,200,0.9)'); sg.addColorStop(1, 'rgba(255,120,30,0)');
      g.fillStyle = sg; g.beginPath(); g.moveTo(0, -wd); g.lineTo(len, 0); g.lineTo(0, wd); g.fill(); g.restore();
    }
  });
  const hole = (ring, chip) => canvasTex(128, (g, s) => {
    g.translate(s / 2, s / 2);
    for (let i = 0; i < 70; i++) { // chipped / scuffed surround
      const a = rnd(0, 6.283), r = rnd(0.08, 0.42) * s * Math.pow(Math.random(), 0.8);
      g.fillStyle = `rgba(${chip},${rnd(0.15, 0.6)})`;
      g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, rnd(1, 5), 0, 6.283); g.fill();
    }
    const rg = g.createRadialGradient(0, 0, s * 0.08, 0, 0, s * 0.26);
    rg.addColorStop(0, `rgba(${ring},0.95)`); rg.addColorStop(1, `rgba(${ring},0)`);
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, s * 0.26, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(6,5,4,1)';
    g.beginPath();
    for (let i = 0; i <= 14; i++) { const a = i / 14 * 6.283, r = s * rnd(0.075, 0.115); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.fill();
  });
  textures.holeConcrete = hole('60,56,50', '190,182,170');
  textures.holeMetal = hole('20,20,22', '215,215,220');
  textures.holeWood = hole('40,26,14', '200,165,110');
  textures.scorch = canvasTex(256, (g, s) => {
    g.translate(s / 2, s / 2);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, s / 2);
    rg.addColorStop(0, 'rgba(0,0,0,0.92)'); rg.addColorStop(0.45, 'rgba(8,6,5,0.7)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(-s / 2, -s / 2, s, s);
    for (let i = 0; i < 60; i++) {
      g.save(); g.rotate(rnd(0, 6.283));
      g.fillStyle = `rgba(0,0,0,${rnd(0.05, 0.3)})`;
      g.fillRect(rnd(0.05, 0.2) * s, -1.5, rnd(0.1, 0.3) * s, rnd(1, 4)); g.restore();
    }
  });
}

export class FX {
  constructor(scene, camera) {
    if (!textures.smoke) initTextures();
    this.scene = scene;
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'fx';
    scene.add(this.root);

    // --- soft sprites (smoke, dust, fireballs)
    this.sprites = [];
    for (let i = 0; i < 90; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.smoke, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; s.userData.noAO = true; s.renderOrder = 5;
      this.root.add(s);
      this.sprites.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), grow: 0, drag: 0, rise: 0, alpha: 1 });
    }
    this.spriteCursor = 0;

    // --- sparks: velocity-stretched line segments in HDR so they bloom
    this.maxSparks = 400;
    this.sparkPos = new Float32Array(this.maxSparks * 6);
    this.sparkCol = new Float32Array(this.maxSparks * 6);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparkMesh = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparkMesh.frustumCulled = false; this.sparkMesh.userData.noAO = true;
    this.root.add(this.sparkMesh);
    this.sparks = [];
    for (let i = 0; i < this.maxSparks; i++) this.sparks.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, c: new THREE.Color(), g: 9.8 });
    this.sparkCursor = 0;

    // --- decals
    this.decals = [];
    const dg = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 96; i++) {
      const m = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ map: textures.holeConcrete, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9 }));
      m.visible = false; m.userData.noAO = true; m.renderOrder = 1; m.receiveShadow = true;
      this.root.add(m); this.decals.push(m);
    }
    this.decalCursor = 0;

    // --- tracers
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).rotateX(Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      m.visible = false; m.userData.noAO = true;
      this.root.add(m); this.tracers.push({ m, life: 0 });
    }
    this.tracerCursor = 0;

    // --- dynamic light flashes
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffc477, 0, 14, 2);
      this.root.add(l); this.lights.push({ l, life: 0, max: 1, peak: 0 });
    }
    this.lightCursor = 0;

    // --- rigid debris: shell casings and chunks
    this.bodies = [];
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.28 });
    const casingGeo = new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 8);
    const chunkMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.7, roughness: 0.5 });
    const chunkGeo = new THREE.TetrahedronGeometry(0.07);
    for (let i = 0; i < 40; i++) {
      const casing = i < 16;
      const m = new THREE.Mesh(casing ? casingGeo : chunkGeo, casing ? brass : chunkMat);
      m.visible = false; m.castShadow = true;
      this.root.add(m);
      this.bodies.push({ m, casing, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, bounced: false });
    }
    this.onCasingBounce = null;
  }

  sprite(pos, o = {}) {
    const p = this.sprites[this.spriteCursor = (this.spriteCursor + 1) % this.sprites.length];
    const m = p.s.material;
    p.s.visible = true; p.s.position.copy(pos);
    m.map = o.map || textures.smoke;
    m.blending = o.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.color.copy(o.color || WHITE);
    m.rotation = rnd(0, 6.283);
    p.rot = o.rot ?? rnd(-0.6, 0.6);
    p.size = o.size ?? 0.3; p.grow = o.grow ?? 0.5; p.alpha = o.alpha ?? 0.5;
    p.max = p.life = o.life ?? 1; p.drag = o.drag ?? 1.5; p.rise = o.rise ?? 0.2;
    p.fadeIn = o.fadeIn ?? 0.08;
    if (o.vel) p.vel.copy(o.vel); else p.vel.set(0, 0, 0);
    p.s.scale.setScalar(p.size);
    m.opacity = 0;
  }

  sparks_(pos, normal, n, o = {}) {
    const speed = o.speed ?? 6, spread = o.spread ?? 0.9;
    for (let i = 0; i < n; i++) {
      const s = this.sparks[this.sparkCursor = (this.sparkCursor + 1) % this.maxSparks];
      s.p.copy(pos);
      s.v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(spread).add(normal).normalize().multiplyScalar(speed * rnd(0.25, 1));
      s.max = s.life = rnd(0.15, o.life ?? 0.55);
      s.c.copy(o.color || SPARK).multiplyScalar(rnd(0.5, 1.4));
      s.g = o.gravity ?? 9.8;
    }
  }

  decal(pos, normal, kind = 'holeConcrete', size = 0.09) {
    const d = this.decals[this.decalCursor = (this.decalCursor + 1) % this.decals.length];
    d.material.map = textures[kind];
    d.material.opacity = kind === 'scorch' ? 0.85 : 1;
    d.visible = true;
    d.position.copy(pos).addScaledVector(normal, 0.004);
    d.quaternion.setFromUnitVectors(Z, normal);
    d.rotateZ(rnd(0, 6.283));
    d.scale.setScalar(size * rnd(0.85, 1.2));
  }

  tracer(a, b) {
    const t = this.tracers[this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length];
    const len = a.distanceTo(b);
    if (len < 2) return;
    t.m.visible = true; t.life = 0.07;
    t.m.position.lerpVectors(a, b, 0.5);
    t.m.lookAt(b);
    t.m.scale.set(0.006, 0.006, len);
    t.m.material.opacity = 0.5;
  }

  flash(pos, color, intensity, duration, distance = 14) {
    const f = this.lights[this.lightCursor = (this.lightCursor + 1) % this.lights.length];
    f.l.position.copy(pos); f.l.color.set(color); f.l.distance = distance;
    f.peak = intensity; f.max = f.life = duration; f.l.intensity = intensity;
  }

  body(pos, vel, casing) {
    const b = this.bodies.find((x) => x.casing === casing && x.life <= 0) || this.bodies.find((x) => x.casing === casing);
    b.m.visible = true; b.m.position.copy(pos); b.v.copy(vel);
    b.w.set(rnd(-25, 25), rnd(-25, 25), rnd(-25, 25));
    b.life = casing ? 5 : 3.5; b.bounced = false;
    b.m.scale.setScalar(casing ? 1 : rnd(0.4, 1.3));
  }

  // --- composite effects
  impact(pos, normal, surface) {
    if (surface === 'glass') { this.sparks_(pos, normal, 10, { speed: 4, color: GLASS, life: 0.4 }); return; }
    const metal = surface === 'metal';
    if (surface !== 'soft') this.decal(pos, normal, metal ? 'holeMetal' : surface === 'wood' ? 'holeWood' : 'holeConcrete', metal ? 0.11 : 0.19);
    if (metal) {
      this.sparks_(pos, normal, 16, { speed: 9 });
      this.flash(pos.clone().addScaledVector(normal, 0.1), 0xffb45a, 2.5, 0.06, 4);
    } else {
      this.sparks_(pos, normal, surface === 'concrete' ? 5 : 0, { speed: 5, life: 0.25 });
    }
    const dust = surface === 'wood' ? WOOD_DUST : surface === 'soft' ? SOFT_DUST : DUST;
    for (let i = 0; i < (metal ? 1 : 3); i++) {
      V.copy(normal).multiplyScalar(rnd(0.6, 2.2)).add(V2.set(rnd(-0.4, 0.4), rnd(-0.2, 0.6), rnd(-0.4, 0.4)));
      this.sprite(pos, { vel: V, size: rnd(0.08, 0.16), grow: rnd(0.5, 1.1), life: rnd(0.5, 1.1), alpha: metal ? 0.18 : 0.42, color: dust, drag: 3, rise: 0.12 });
    }
  }

  explosion(pos, scale = 1) {
    this.flash(V.copy(pos).setY(pos.y + 0.6), 0xff9a3c, 260 * scale, 0.45, 30 * scale);
    for (let i = 0; i < 10; i++) { // fireball
      V.set(rnd(-1, 1), rnd(0.1, 1.4), rnd(-1, 1)).multiplyScalar(2.6 * scale);
      this.sprite(V2.copy(pos).add(V3.set(rnd(-0.3, 0.3), rnd(0, 0.4), rnd(-0.3, 0.3))), { vel: V, size: 0.7 * scale, grow: 4.5 * scale, life: rnd(0.28, 0.5), alpha: 0.95, additive: true, color: FIRE, drag: 3.5, rise: 1.2, fadeIn: 0.01 });
    }
    for (let i = 0; i < 14; i++) { // smoke column
      V.set(rnd(-1, 1), rnd(0.2, 1.6), rnd(-1, 1)).multiplyScalar(2.2 * scale);
      this.sprite(V2.copy(pos).add(V3.set(rnd(-0.4, 0.4), rnd(0.1, 0.8), rnd(-0.4, 0.4))), { vel: V, size: 0.9 * scale, grow: 1.6 * scale, life: rnd(1.6, 3.4), alpha: 0.6, color: SMOKE_DARK, drag: 1.6, rise: 1.0, fadeIn: 0.15 });
    }
    this.sparks_(pos, UP, 90, { speed: 16 * scale, spread: 1.6, life: 1.0, gravity: 12 });
    for (let i = 0; i < 9; i++) {
      V.set(rnd(-1, 1), rnd(0.5, 1.6), rnd(-1, 1)).multiplyScalar(5.5 * scale);
      this.body(V2.copy(pos).setY(pos.y + 0.3), V, false);
    }
  }

  update(dt) {
    for (const p of this.sprites) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const t = 1 - p.life / p.max;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.s.position.addScaledVector(p.vel, dt);
      p.s.position.y += p.rise * dt;
      p.s.scale.setScalar(p.size + p.grow * Math.sqrt(t) * p.max);
      p.s.material.rotation += p.rot * dt;
      p.s.material.opacity = p.alpha * Math.min(1, t / p.fadeIn) * (1 - t) * (1 - t);
    }
    let n = 0;
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.v.y -= s.g * dt;
      s.p.addScaledVector(s.v, dt);
      if (s.p.y < 0.01 && s.v.y < 0) { s.p.y = 0.01; s.v.y *= -0.35; s.v.x *= 0.6; s.v.z *= 0.6; }
      const k = Math.max(0, s.life / s.max), o = n * 6;
      this.sparkPos[o] = s.p.x; this.sparkPos[o + 1] = s.p.y; this.sparkPos[o + 2] = s.p.z;
      this.sparkPos[o + 3] = s.p.x - s.v.x * 0.022; this.sparkPos[o + 4] = s.p.y - s.v.y * 0.022; this.sparkPos[o + 5] = s.p.z - s.v.z * 0.022;
      this.sparkCol[o] = s.c.r * k; this.sparkCol[o + 1] = s.c.g * k; this.sparkCol[o + 2] = s.c.b * k;
      this.sparkCol[o + 3] = 0; this.sparkCol[o + 4] = 0; this.sparkCol[o + 5] = 0;
      n++;
    }
    this.sparkMesh.geometry.setDrawRange(0, n * 2);
    this.sparkMesh.geometry.attributes.position.needsUpdate = true;
    this.sparkMesh.geometry.attributes.color.needsUpdate = true;

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / 0.07) * 0.5;
      if (t.life <= 0) t.m.visible = false;
    }
    for (const f of this.lights) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.l.intensity = f.life > 0 ? f.peak * Math.pow(f.life / f.max, 2) : 0;
    }
    for (const b of this.bodies) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.m.visible = false; continue; }
      b.v.y -= 9.8 * dt;
      b.m.position.addScaledVector(b.v, dt);
      b.m.rotation.x += b.w.x * dt; b.m.rotation.y += b.w.y * dt; b.m.rotation.z += b.w.z * dt;
      const floor = b.casing ? 0.006 : 0.03;
      if (b.m.position.y < floor) {
        b.m.position.y = floor;
        if (Math.abs(b.v.y) > 0.6) {
          if (b.casing && this.onCasingBounce) this.onCasingBounce(b.m.position, !b.bounced);
          b.bounced = true;
          b.v.y *= -0.42; b.v.x *= 0.6; b.v.z *= 0.6; b.w.multiplyScalar(0.6);
        } else { b.v.set(0, 0, 0); b.w.set(0, 0, 0); if (b.casing) b.m.rotation.set(0, b.m.rotation.y, Math.PI / 2); }
      }
    }
  }
}

const WHITE = new THREE.Color(1, 1, 1);
const SPARK = new THREE.Color(9, 4.2, 1.1);
const GLASS = new THREE.Color(1.6, 1.9, 2.0);
const DUST = new THREE.Color(0.62, 0.59, 0.55);
const WOOD_DUST = new THREE.Color(0.6, 0.48, 0.33);
const SOFT_DUST = new THREE.Color(0.5, 0.5, 0.5);
const SMOKE_DARK = new THREE.Color(0.09, 0.085, 0.08);
const FIRE = new THREE.Color(5, 2.0, 0.5);
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
