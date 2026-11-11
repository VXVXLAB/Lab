// First-person controller: pointer-lock look, walk / sprint / crouch / jump, box collision with step-up,
// head bob, landing dip, recoil and camera lean.
import * as THREE from 'three';

const RADIUS = 0.34, HEIGHT = 1.78, EYE = 1.66, EYE_CROUCH = 1.02, STEP = 0.36;
const WALK = 4.3, SPRINT = 6.6, CROUCH = 2.2, ADS = 2.7;
const GRAVITY = 22, JUMP = 6.9;

export class Player {
  constructor(camera, level, audio) {
    this.camera = camera;
    this.level = level;
    this.audio = audio;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.keys = new Set();
    this.yaw = 0; this.pitch = 0;
    this.recoilPitch = 0; this.recoilYaw = 0; this.recoilVel = 0;
    this.crouch = 0; this.onGround = true;
    this.bobPhase = 0; this.bobAmp = 0; this.dip = 0; this.dipVel = 0; this.roll = 0;
    this.smoothY = 0;
    this.maxHp = 100; this.hp = 100; this.sinceHit = 99; this.dead = false;
    this.ads = false; this.sprinting = false; this.moving = 0;
    this.sensitivity = 0.0021;
    this.lookDelta = new THREE.Vector2();
    this.eye = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.reset();
  }

  reset() {
    const s = this.level.spawn;
    this.pos.copy(s.pos); this.vel.set(0, 0, 0);
    this.yaw = s.yaw; this.pitch = 0; this.recoilPitch = this.recoilYaw = 0;
    this.hp = this.maxHp; this.dead = false; this.sinceHit = 99; this.smoothY = s.pos.y;
    this.sync(0);
  }

  look(dx, dy) {
    const k = this.sensitivity * (this.ads ? 0.62 : 1);
    this.yaw -= dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, -1.5, 1.5);
    this.lookDelta.x += dx; this.lookDelta.y += dy;
  }

  kick(pitch, yaw) { this.recoilVel += pitch * 14; this.recoilYaw += yaw; }

  damage(amount) {
    if (this.dead) return;
    this.hp -= amount; this.sinceHit = 0;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
  }

  // solid boxes overlapping the player's vertical span
  blocking(b, y) { return y + STEP < b.max.y && y + HEIGHT * (1 - 0.4 * this.crouch) > b.min.y; }

  groundAt(x, z, y) {
    let g = 0;
    for (const b of this.level.colliders) {
      if (b.max.y > y + STEP + 0.01) continue;
      const r = RADIUS * 0.6;
      if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r && b.max.y > g) g = b.max.y;
    }
    return g;
  }

  resolve() {
    const p = this.pos;
    for (let iter = 0; iter < 3; iter++) {
      for (const b of this.level.colliders) {
        if (!this.blocking(b, p.y)) continue;
        const cx = THREE.MathUtils.clamp(p.x, b.min.x, b.max.x), cz = THREE.MathUtils.clamp(p.z, b.min.z, b.max.z);
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), push = RADIUS - d;
          dx /= d; dz /= d;
          p.x += dx * push; p.z += dz * push;
          const vn = this.vel.x * dx + this.vel.z * dz;
          if (vn < 0) { this.vel.x -= vn * dx; this.vel.z -= vn * dz; }
        } else { // centre is inside the box: push out through the nearest face
          const l = p.x - b.min.x, r = b.max.x - p.x, n = p.z - b.min.z, f = b.max.z - p.z;
          const m = Math.min(l, r, n, f);
          if (m === l) p.x = b.min.x - RADIUS; else if (m === r) p.x = b.max.x + RADIUS;
          else if (m === n) p.z = b.min.z - RADIUS; else p.z = b.max.z + RADIUS;
        }
      }
    }
  }

  update(dt, input) {
    const k = this.keys;
    this.sinceHit += dt;
    if (!this.dead && this.sinceHit > 4 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 22 * dt);

    const wantCrouch = !this.dead && (k.has('KeyC') || k.has('ControlLeft'));
    this.crouch = THREE.MathUtils.damp(this.crouch, wantCrouch || this.dead ? 1 : 0, 12, dt);

    let ix = 0, iz = 0;
    if (!this.dead && input) {
      if (k.has('KeyW') || k.has('ArrowUp')) iz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) iz += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
    }
    const len = Math.hypot(ix, iz) || 1;
    ix /= len; iz /= len;
    this.sprinting = !this.dead && k.has('ShiftLeft') && iz < 0 && !this.ads && this.crouch < 0.3;
    const speed = this.crouch > 0.5 ? CROUCH : this.ads ? ADS : this.sprinting ? SPRINT : WALK;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (ix * cos + iz * sin) * speed, wz = (-ix * sin + iz * cos) * speed;

    const accel = this.onGround ? 14 : 2.5;
    this.vel.x = THREE.MathUtils.damp(this.vel.x, wx, accel, dt);
    this.vel.z = THREE.MathUtils.damp(this.vel.z, wz, accel, dt);

    if (this.onGround && input && !this.dead && k.has('Space') && !this.jumpHeld) {
      this.vel.y = JUMP; this.onGround = false; this.audio.footstep(true);
    }
    this.jumpHeld = k.has('Space');
    this.vel.y -= GRAVITY * dt;

    // integrate in sub-steps so fast movement cannot tunnel through thin colliders
    const steps = Math.max(1, Math.ceil(this.vel.length() * dt / 0.15));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.pos.x += this.vel.x * h; this.pos.z += this.vel.z * h;
      this.resolve();
      this.pos.y += this.vel.y * h;
      const g = this.groundAt(this.pos.x, this.pos.z, this.pos.y);
      if (this.pos.y <= g) {
        if (!this.onGround && this.vel.y < -4) { this.dipVel -= Math.min(9, -this.vel.y) * 0.16; this.audio.land(); }
        this.pos.y = g; this.vel.y = 0; this.onGround = true;
      } else if (this.onGround && this.pos.y - g < STEP && this.vel.y <= 0) {
        this.pos.y = g; this.vel.y = 0; // stick to ground when walking down small steps
      } else {
        this.onGround = false;
      }
    }

    // head bob and footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.moving = hs / SPRINT;
    const bobTarget = this.onGround ? Math.min(1, hs / WALK) : 0;
    this.bobAmp = THREE.MathUtils.damp(this.bobAmp, bobTarget, 8, dt);
    const prev = this.bobPhase;
    this.bobPhase += hs * dt * (this.sprinting ? 1.55 : 1.9);
    if (this.onGround && hs > 1 && Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) this.audio.footstep(this.sprinting);

    // landing spring
    this.dipVel += (-this.dip * 180 - this.dipVel * 16) * dt;
    this.dip += this.dipVel * dt;

    // recoil spring: kicks up fast, settles back
    this.recoilVel += (-this.recoilPitch * 110 - this.recoilVel * 15) * dt;
    this.recoilPitch += this.recoilVel * dt;
    this.recoilYaw = THREE.MathUtils.damp(this.recoilYaw, 0, 9, dt);

    const strafe = (this.vel.x * cos - this.vel.z * sin) / SPRINT;
    this.roll = THREE.MathUtils.damp(this.roll, -strafe * 0.028, 8, dt);
    this.sync(dt);
  }

  sync(dt) {
    this.smoothY = dt > 0 ? THREE.MathUtils.damp(this.smoothY, this.pos.y, this.onGround ? 18 : 60, dt) : this.pos.y;
    const eyeH = THREE.MathUtils.lerp(EYE, EYE_CROUCH, this.crouch) - (this.dead ? 0.55 * this.crouch : 0);
    const bobScale = this.ads ? 0.25 : 1;
    const by = Math.sin(this.bobPhase * 2) * 0.028 * this.bobAmp * bobScale;
    const bx = Math.cos(this.bobPhase) * 0.02 * this.bobAmp * bobScale;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.eye.set(this.pos.x + bx * cos, this.smoothY + eyeH + by + this.dip, this.pos.z - bx * sin);
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw + this.recoilYaw, this.roll + (this.dead ? 0.5 * this.crouch : 0), 'YXZ');
    this.camera.getWorldDirection(this.forward);
  }
}
