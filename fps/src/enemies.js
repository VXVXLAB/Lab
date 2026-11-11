// Enemy sentry drones: procedural hard-surface quadcopters that orbit the player, telegraph and fire bolt bursts.
import * as THREE from 'three';
import { rayBoxes, YARD } from './level.js';
import { textures } from './fx.js';

const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const UP = new THREE.Vector3(0, 1, 0);

let shared = null;
function sharedAssets() {
  if (shared) return shared;
  // subtle brushed / panelled roughness so the hull catches the sky unevenly
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},0.05)`; g.fillRect(rnd(0, 256), rnd(0, 256), rnd(8, 70), 1); }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.arc(rnd(0, 256), rnd(0, 256), rnd(3, 16), 0, 7); g.fill(); }
  const rough = new THREE.CanvasTexture(c); rough.wrapS = rough.wrapT = THREE.RepeatWrapping;

  const rc = document.createElement('canvas'); rc.width = rc.height = 128;
  const rg = rc.getContext('2d'); rg.translate(64, 64);
  for (let i = 0; i < 3; i++) {
    rg.rotate(Math.PI * 2 / 3);
    const grad = rg.createConicGradient ? rg.createConicGradient(0, 0, 0) : null;
    if (grad) { grad.addColorStop(0, 'rgba(20,20,22,0.8)'); grad.addColorStop(0.28, 'rgba(20,20,22,0.12)'); grad.addColorStop(1, 'rgba(20,20,22,0)'); rg.fillStyle = grad; }
    else rg.fillStyle = 'rgba(20,20,22,0.2)';
    rg.beginPath(); rg.arc(0, 0, 62, 0, Math.PI * 2); rg.fill();
  }
  const rotorTex = new THREE.CanvasTexture(rc); rotorTex.colorSpace = THREE.SRGBColorSpace;

  shared = {
    hull: new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.85, roughness: 0.5, roughnessMap: rough }),
    panel: new THREE.MeshStandardMaterial({ color: 0x8c2f14, metalness: 0.3, roughness: 0.55, roughnessMap: rough }),
    dark: new THREE.MeshStandardMaterial({ color: 0x08090a, metalness: 0.4, roughness: 0.7 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 1, roughness: 0.3 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x050506, metalness: 0, roughness: 0.03, clearcoat: 1 }),
    rotor: new THREE.MeshBasicMaterial({ map: rotorTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    geo: {
      body: new THREE.SphereGeometry(1, 28, 18),
      arm: new THREE.CylinderGeometry(0.016, 0.022, 0.46, 10).rotateZ(Math.PI / 2).translate(0.23, 0, 0),
      motor: new THREE.CylinderGeometry(0.036, 0.042, 0.07, 16),
      cap: new THREE.CylinderGeometry(0.012, 0.03, 0.03, 12),
      disc: new THREE.CircleGeometry(0.205, 32).rotateX(-Math.PI / 2),
      guard: new THREE.TorusGeometry(0.215, 0.007, 6, 40).rotateX(Math.PI / 2),
      eye: new THREE.SphereGeometry(0.03, 16, 12),
      barrel: new THREE.CylinderGeometry(0.011, 0.011, 0.26, 10).rotateX(Math.PI / 2),
      skid: new THREE.CapsuleGeometry(0.009, 0.36, 4, 8).rotateX(Math.PI / 2),
      strut: new THREE.CylinderGeometry(0.007, 0.007, 0.13, 6),
      box: new THREE.BoxGeometry(1, 1, 1),
      bolt: new THREE.CylinderGeometry(0.02, 0.02, 1, 6, 1).rotateX(Math.PI / 2),
    },
  };
  return shared;
}

function buildDroneMesh(enemy) {
  const s = sharedAssets(), G = s.geo;
  const root = new THREE.Group();
  const meshes = [];
  const add = (geo, mat, parent = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.userData.enemy = enemy;
    parent.add(m); meshes.push(m);
    return m;
  };
  const hull = add(G.body, s.hull); hull.scale.set(0.2, 0.075, 0.27);
  const top = add(G.body, s.panel); top.scale.set(0.15, 0.055, 0.2); top.position.y = 0.035;
  const pack = add(G.box, s.dark); pack.scale.set(0.16, 0.05, 0.13); pack.position.set(0, 0.07, 0.1);
  const ant = add(G.strut, s.steel); ant.position.set(0.05, 0.14, 0.14); ant.scale.y = 1.2;

  const rotors = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const arm = new THREE.Group(); arm.rotation.y = a; root.add(arm);
    add(G.arm, s.hull, arm).position.x = 0.13;
    const motor = add(G.motor, s.dark, arm); motor.position.set(0.58, 0.02, 0);
    add(G.cap, s.steel, arm).position.set(0.58, 0.07, 0);
    const guard = add(G.guard, s.hull, arm); guard.position.set(0.58, 0.05, 0);
    const disc = new THREE.Mesh(G.disc, s.rotor);
    disc.position.set(0.58, 0.062, 0); disc.userData.noAO = true; disc.renderOrder = 3;
    arm.add(disc); rotors.push(disc);
  }
  // gimbal with the sensor "eye" and twin barrels
  const gimbal = new THREE.Group(); gimbal.position.set(0, -0.085, -0.1); root.add(gimbal);
  const ball = add(G.body, s.dark, gimbal); ball.scale.setScalar(0.085);
  const ring = add(G.motor, s.steel, gimbal); ring.rotation.x = Math.PI / 2; ring.position.z = -0.07; ring.scale.set(1.15, 0.5, 1.15);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.5, 0.25) });
  const eye = add(G.eye, eyeMat, gimbal); eye.position.z = -0.082; eye.userData.weak = true; eye.castShadow = false;
  add(G.eye, s.lens, gimbal).position.set(0, 0, -0.07);
  for (const x of [-0.05, 0.05]) { const b = add(G.barrel, s.steel, gimbal); b.position.set(x, -0.045, -0.12); }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: new THREE.Color(3, 0.3, 0.15), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(0.16); glow.position.z = -0.1; glow.userData.noAO = true;
  gimbal.add(glow);
  for (const x of [-0.13, 0.13]) {
    add(G.skid, s.steel).position.set(x, -0.17, 0);
    for (const z of [-0.1, 0.1]) add(G.strut, s.steel).position.set(x, -0.11, z);
  }
  root.scale.setScalar(1.25);
  return { root, meshes, rotors, gimbal, eyeMat, glow };
}

class Drone {
  constructor(mgr, index) {
    this.mgr = mgr;
    Object.assign(this, buildDroneMesh(this));
    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.hp = 100; this.state = 'enter';
    this.retarget = 0; this.fireTimer = rnd(1.6, 3.2) + index * 0.7; this.burst = 0; this.burstTimer = 0; this.charge = 0;
    this.orbit = rnd(0, Math.PI * 2); this.orbitDir = Math.random() > 0.5 ? 1 : -1;
    this.tilt = new THREE.Vector3(); this.spin = new THREE.Vector3(); this.flicker = 0; this.smoke = 0;
    this.phase = rnd(0, 10);
    this.voice = mgr.game.audio.droneVoice();
    // drop in from above the rooftops
    this.pos.set(rnd(-10, 10), rnd(15, 19), rnd(-5, 5));
    this.pickTarget();
  }

  pickTarget() {
    const p = this.mgr.game.player.pos;
    this.orbit += this.orbitDir * rnd(0.5, 1.5);
    if (Math.random() < 0.25) this.orbitDir *= -1;
    const r = rnd(6, 11);
    this.target.set(
      THREE.MathUtils.clamp(p.x + Math.cos(this.orbit) * r, -YARD.x + 1.5, YARD.x - 1.5),
      rnd(2.6, 5.4),
      THREE.MathUtils.clamp(p.z + Math.sin(this.orbit) * r, -YARD.z + 1.5, YARD.z - 1.5));
    this.retarget = rnd(1.6, 3.4);
  }

  hit(dmg, point, dir, normal) {
    if (this.state === 'dead') return;
    const { fx, audio } = this.mgr.game;
    fx.sparks_(point, normal, 22, { speed: 9 });
    fx.flash(point, 0xffb45a, 4, 0.07, 5);
    audio.impact(point, 'metal');
    this.vel.addScaledVector(dir, 2.2);
    this.spin.set(rnd(-4, 4), rnd(-6, 6), rnd(-4, 4));
    this.flicker = 0.25;
    if (this.state === 'dying') { this.explode(); return; }
    this.hp -= dmg;
    const kill = this.hp <= 0;
    this.mgr.game.onHit(kill, dmg > 50);
    if (kill) {
      this.state = 'dying';
      this.spin.set(rnd(-7, 7), rnd(8, 14) * (Math.random() > 0.5 ? 1 : -1), rnd(-7, 7));
      this.vel.y += 1.5;
      this.mgr.game.onKill(this);
    }
  }

  explode() {
    if (this.state === 'dead') return;
    this.state = 'dead';
    const { fx, audio, scene } = this.mgr.game;
    fx.explosion(this.pos, 0.75);
    audio.explosion(this.pos, 0.8);
    if (this.pos.y < 0.6) fx.decal(V.set(this.pos.x, 0, this.pos.z), UP, 'scorch', 2.4);
    this.mgr.game.blast(this.pos, 3.2, 35, this);
    scene.remove(this.root);
    if (this.voice) this.voice.stop();
  }

  update(dt, time) {
    const game = this.mgr.game, player = game.player;
    for (const r of this.rotors) r.rotation.y += dt * (this.state === 'dying' ? 30 : 70);
    this.flicker -= dt;

    if (this.state === 'dying') {
      this.vel.y -= 9.8 * dt;
      this.vel.x *= 1 - 0.3 * dt; this.vel.z *= 1 - 0.3 * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.root.rotation.x += this.spin.x * dt; this.root.rotation.y += this.spin.y * dt; this.root.rotation.z += this.spin.z * dt;
      this.smoke -= dt;
      if (this.smoke <= 0) {
        this.smoke = 0.035;
        game.fx.sprite(this.pos, { size: 0.3, grow: 1.1, life: 1.3, alpha: 0.5, color: DARK, rise: 0.6, drag: 1 });
        if (Math.random() < 0.5) game.fx.sparks_(this.pos, UP, 3, { speed: 4 });
      }
      this.eyeMat.color.setRGB(Math.random() > 0.5 ? 5 : 0.3, 0.2, 0.1);
      const hitWall = Math.abs(this.pos.x) > YARD.x - 0.5 || Math.abs(this.pos.z) > YARD.z - 0.5;
      if (this.pos.y < 0.25 || hitWall || rayBoxes(this.pos, V.copy(this.vel).normalize(), 0.4, game.level.colliders, 'seeThrough')) this.explode();
      if (this.voice) this.voice.set(this.pos, 1.6, false);
      return;
    }

    // --- flight
    this.retarget -= dt;
    if (this.retarget <= 0 || this.pos.distanceToSquared(this.target) < 0.5) this.pickTarget();
    if (this.state === 'enter' && this.pos.y < 6.5) this.state = 'combat';
    V.copy(this.target).sub(this.pos);
    const dist = V.length();
    const want = V.multiplyScalar(Math.min(1, dist / 2.5) * (this.state === 'enter' ? 7 : 4.6) / Math.max(dist, 1e-3));
    // separation from the other drones
    for (const o of this.mgr.drones) {
      if (o === this || o.state !== 'combat') continue;
      V2.copy(this.pos).sub(o.pos);
      const d = V2.length();
      if (d < 2.2 && d > 1e-3) want.addScaledVector(V2, (2.2 - d) * 2 / d);
    }
    const prev = V3.copy(this.vel);
    this.vel.x = THREE.MathUtils.damp(this.vel.x, want.x, 2.4, dt);
    this.vel.y = THREE.MathUtils.damp(this.vel.y, want.y, 2.4, dt);
    this.vel.z = THREE.MathUtils.damp(this.vel.z, want.z, 2.4, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.pos.y += Math.sin(time * 2.1 + this.phase) * 0.12 * dt;
    const acc = prev.sub(this.vel).multiplyScalar(-1 / Math.max(dt, 1e-3));

    // --- attitude: face the player, bank into acceleration
    V.copy(player.eye).sub(this.pos);
    const yaw = Math.atan2(-V.x, -V.z);
    let dy = yaw - this.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y += dy * Math.min(1, dt * 5);
    const cy = Math.cos(this.root.rotation.y), sy = Math.sin(this.root.rotation.y);
    const fwdAcc = -(acc.x * sy + acc.z * cy), sideAcc = acc.x * cy - acc.z * sy;
    this.spin.multiplyScalar(Math.exp(-6 * dt));
    this.root.rotation.x = THREE.MathUtils.damp(this.root.rotation.x, THREE.MathUtils.clamp(-fwdAcc * 0.05, -0.5, 0.5) + this.spin.x * 0.05, 6, dt);
    this.root.rotation.z = THREE.MathUtils.damp(this.root.rotation.z, THREE.MathUtils.clamp(-sideAcc * 0.05, -0.5, 0.5) + this.spin.z * 0.05, 6, dt);
    // gimbal pitches towards the player
    const flat = Math.hypot(V.x, V.z);
    this.gimbal.rotation.x = THREE.MathUtils.damp(this.gimbal.rotation.x, Math.atan2(V.y, flat) - this.root.rotation.x, 8, dt);

    // --- weapons
    const eyeGlow = this.flicker > 0 ? (Math.random() > 0.5 ? 0.1 : 1) : 1;
    if (this.state === 'combat' && !player.dead) {
      this.fireTimer -= dt;
      if (this.burst > 0) {
        this.burstTimer -= dt;
        if (this.burstTimer <= 0) { this.shoot(); this.burst--; this.burstTimer = 0.15; }
      } else if (this.charge > 0) {
        this.charge -= dt;
        if (this.charge <= 0) { this.burst = 3; this.burstTimer = 0; }
      } else if (this.fireTimer <= 0) {
        const d = V.length();
        if (!rayBoxes(this.pos, V2.copy(V).divideScalar(d), d, game.level.colliders, 'seeThrough')) {
          this.charge = 0.5; this.fireTimer = rnd(2.6, 4.4);
          game.audio.droneCharge(this.pos);
        } else { this.fireTimer = 0.35; this.retarget = Math.min(this.retarget, 0.4); }
      }
    }
    const hot = this.charge > 0 ? 1 + (1 - this.charge / 0.5) * 5 : this.burst > 0 ? 6 : 1;
    this.eyeMat.color.setRGB(6 * hot * eyeGlow, (0.5 + (hot - 1) * 0.5) * eyeGlow, 0.25 * eyeGlow);
    this.glow.scale.setScalar(0.16 + (hot - 1) * 0.11);
    this.glow.material.opacity = eyeGlow;
    if (this.voice) this.voice.set(this.pos, 0.3 + this.vel.length() / 6, true);
  }

  shoot() {
    const game = this.mgr.game, player = game.player;
    this.gimbal.getWorldPosition(V);
    // lead the target a little, with aim error that tightens at short range
    const d = V.distanceTo(player.eye);
    V2.copy(player.eye); V2.y -= 0.3;
    V2.addScaledVector(player.vel, d / BOLT_SPEED * 0.55);
    V2.x += rnd(-1, 1) * 0.06 * d; V2.y += rnd(-1, 1) * 0.06 * d; V2.z += rnd(-1, 1) * 0.06 * d;
    this.mgr.spawnBolt(V, V2.sub(V).normalize());
    game.audio.droneShot(V);
    game.fx.flash(V, 0xff5522, 14, 0.08, 8);
    this.vel.addScaledVector(V2, -0.6);
  }
}

const BOLT_SPEED = 30;
const DARK = new THREE.Color(0.07, 0.07, 0.07);

export class Enemies {
  constructor(game) {
    this.game = game;
    this.drones = [];
    this.bolts = [];
    const s = sharedAssets();
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(s.geo.bolt, new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 1.6, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.scale.set(1, 1, 1.5); m.visible = false; m.userData.noAO = true;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: new THREE.Color(4, 0.7, 0.25), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(0.5); m.add(glow);
      game.scene.add(m);
      this.bolts.push({ m, dir: new THREE.Vector3(), life: 0 });
    }
  }

  get alive() { return this.drones.filter((d) => d.state === 'enter' || d.state === 'combat').length; }
  get active() { return this.drones.length; }

  meshes() {
    const out = [];
    for (const d of this.drones) if (d.state !== 'dead') out.push(...d.meshes);
    return out;
  }

  spawn(n) {
    for (let i = 0; i < n; i++) {
      const d = new Drone(this, i);
      this.game.scene.add(d.root);
      this.drones.push(d);
    }
  }

  clear() {
    for (const d of this.drones) { this.game.scene.remove(d.root); if (d.voice) d.voice.stop(); }
    this.drones.length = 0;
    for (const b of this.bolts) { b.life = 0; b.m.visible = false; }
  }

  spawnBolt(pos, dir) {
    const b = this.bolts.find((x) => x.life <= 0);
    if (!b) return;
    b.m.position.copy(pos); b.dir.copy(dir); b.life = 4; b.m.visible = true;
    b.m.lookAt(V3.copy(pos).add(dir));
  }

  update(dt, time) {
    const game = this.game, player = game.player;
    for (const d of this.drones) d.update(dt, time);
    this.drones = this.drones.filter((d) => d.state !== 'dead');

    for (const b of this.bolts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const step = BOLT_SPEED * dt, p = b.m.position;
      let end = false;
      // player capsule: closest approach of this frame's segment to the body axis
      V.copy(player.pos); V.y += 0.95 - 0.3 * player.crouch;
      const t = THREE.MathUtils.clamp(V.sub(p).dot(b.dir), 0, step);
      V2.copy(p).addScaledVector(b.dir, t);
      const dx = V2.x - player.pos.x, dz = V2.z - player.pos.z, dyy = V2.y - player.pos.y;
      if (!player.dead && dx * dx + dz * dz < 0.42 * 0.42 && dyy > 0 && dyy < 1.85 - 0.6 * player.crouch) {
        game.onPlayerHit(9, b.dir);
        end = true;
      } else {
        const hit = rayBoxes(p, b.dir, step, game.level.colliders, 'seeThrough');
        if (hit || p.y + b.dir.y * step < 0) {
          const tt = hit ? hit.t : (p.y / -b.dir.y);
          V2.copy(p).addScaledVector(b.dir, Math.max(0, tt - 0.02));
          V3.copy(b.dir).negate();
          if (!hit) V3.set(0, 1, 0);
          game.fx.sparks_(V2, V3, 14, { speed: 6, color: BOLT_SPARK });
          game.fx.flash(V2, 0xff5522, 5, 0.1, 5);
          game.fx.sprite(V2, { size: 0.15, grow: 0.7, life: 0.6, alpha: 0.3, color: DARK });
          if (!hit) game.fx.decal(V2.setY(0), UP, 'scorch', 0.32);
          game.audio.impact(V2, 'concrete');
          end = true;
        }
      }
      if (end || b.life <= 0) { b.life = 0; b.m.visible = false; continue; }
      p.addScaledVector(b.dir, step);
    }
  }
}

const BOLT_SPARK = new THREE.Color(9, 1.6, 0.5);
