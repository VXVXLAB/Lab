// First-person pistol: view-model rig rendered in its own scene, hit-scan firing, recoil, reload, ADS.
import * as THREE from 'three';
import { textures } from './fx.js';

const MAG = 8, FIRE_INTERVAL = 0.115, RELOAD_TIME = 1.55, DAMAGE = 40;
const HIP = new THREE.Vector3(0.125, -0.112, -0.43);
const AIM = new THREE.Vector3(0, -0.0748, -0.40);
const MUZZLE = new THREE.Vector3(0.176, 0.0655, 0); // in model space (+x is the barrel axis)
const PORT = new THREE.Vector3(0.035, 0.078, 0.004);

const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), Q = new THREE.Quaternion();
const rnd = (a, b) => a + Math.random() * (b - a);

export class Weapon {
  constructor(game, pistolScene, sky, scene, camera) {
    this.game = game;
    this.scene = scene;
    this.scene.environment = game.scene.environment;
    this.scene.environmentRotation.copy(game.scene.environmentRotation);
    this.scene.environmentIntensity = game.scene.environmentIntensity;
    this.camera = camera;
    this.baseFov = 50;

    this.sun = new THREE.DirectionalLight(sky.sunColor, 0);
    this.sunIntensity = 0;
    this.scene.add(this.sun, this.sun.target);

    this.rig = new THREE.Group();     // follows the main camera
    this.pose = new THREE.Group();    // animated offsets
    this.rig.add(this.pose);
    this.scene.add(this.rig);

    // --- pistol: keep the assembled "a" variant, hide spare parts laid out next to it in the scan
    this.gun = new THREE.Group();
    this.gun.rotation.y = Math.PI / 2;
    const model = pistolScene.clone(true);
    const keep = ['service_pistol_pistol_a', 'service_pistol_slide_a', 'service_pistol_hammer_a', 'service_pistol_trigger_a'];
    for (const c of [...model.children]) if (!keep.includes(c.name)) model.remove(c);
    this.slide = model.getObjectByName('service_pistol_slide_a');
    this.slideX = this.slide.position.x;
    this.hammer = model.getObjectByName('service_pistol_hammer_a');
    model.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.material.envMapIntensity = 1.15; } });
    this.gun.add(model);
    this.gun.add(buildHand());
    this.pose.add(this.gun);

    // --- muzzle flash
    this.flash = new THREE.Group();
    this.flash.position.copy(MUZZLE);
    const fm = () => new THREE.MeshBasicMaterial({ map: textures.flash, color: new THREE.Color(5, 3.4, 1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), fm());
    front.rotation.y = Math.PI / 2; front.position.x = 0.03;
    const sideGeo = new THREE.PlaneGeometry(0.26, 0.11).translate(0.11, 0, 0);
    const s1 = new THREE.Mesh(sideGeo, fm()), s2 = new THREE.Mesh(sideGeo, fm());
    s2.rotation.x = Math.PI / 2;
    this.flash.add(front, s1, s2);
    this.flash.visible = false;
    this.flashFront = front;
    this.gun.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 2.5, 2);
    this.flashLight.position.copy(MUZZLE).add(V.set(0.08, 0.03, 0));
    this.gun.add(this.flashLight);
    this.flashTime = 0;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 200;

    this.reset();
  }

  reset() {
    this.ammo = MAG; this.reserve = 48;
    this.cooldown = 0; this.reloading = 0; this.raise = 1;
    this.adsT = 0; this.sprintT = 0; this.bloom = 0;
    this.kick = 0; this.kickVel = 0; this.rot = 0; this.rotVel = 0; this.rollKick = 0;
    this.slideT = 0; this.swayX = 0; this.swayY = 0;
    this.triggerHeld = false;
  }

  get spread() {
    const p = this.game.player;
    const hip = 0.75 + p.moving * 1.6 + (p.onGround ? 0 : 2.5) - p.crouch * 0.3;
    return THREE.MathUtils.degToRad(THREE.MathUtils.lerp(hip, 0.08, this.adsT) + this.bloom);
  }

  startReload() {
    if (this.reloading > 0 || this.ammo === MAG || this.reserve <= 0) return;
    this.reloading = RELOAD_TIME;
    this.game.audio.reload();
  }

  muzzleWorld(out) {
    // muzzle as seen through the view-model camera, re-projected into the world camera
    this.gun.localToWorld(out.copy(MUZZLE)).project(this.camera);
    out.z = 0.5;
    out.unproject(this.game.camera);
    const cam = this.game.camera.position;
    return out.sub(cam).normalize().multiplyScalar(0.7).add(cam);
  }

  tryFire() {
    const { player, audio } = this.game;
    if (this.cooldown > 0 || this.reloading > 0 || this.raise > 0.2 || player.dead) return;
    if (this.sprintT > 0.5) return;
    if (this.game.fireGate && !this.game.fireGate()) { this.cooldown = 0.3; return; }
    if (this.ammo <= 0) { audio.dryFire(); this.cooldown = 0.2; if (this.reserve > 0) this.startReload(); return; }
    this.ammo--;
    this.cooldown = FIRE_INTERVAL;
    this.fire();
  }

  fire() {
    const { camera, player, audio, fx, level } = this.game;
    // --- hit-scan with cone spread
    const s = this.spread, a = rnd(0, Math.PI * 2), r = Math.sqrt(Math.random()) * Math.tan(s);
    camera.getWorldDirection(V);
    V2.set(1, 0, 0).applyQuaternion(camera.quaternion);
    V3.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const dir = V.addScaledVector(V2, Math.cos(a) * r).addScaledVector(V3, Math.sin(a) * r).normalize().clone();
    this.raycaster.set(camera.position, dir);
    const targets = level.shootables.concat(this.game.enemyMeshes());
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    const muzzle = this.muzzleWorld(new THREE.Vector3());
    const end = hit ? hit.point : camera.position.clone().addScaledVector(dir, 150);
    fx.tracer(muzzle, end);
    if (hit) {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
      if (n.dot(dir) > 0) n.negate();
      const ud = hit.object.userData;
      if (ud.enemy) {
        ud.enemy.hit(ud.weak ? DAMAGE * 2.5 : DAMAGE, hit.point, dir, n);
      } else if (ud.prop && ud.prop.userData.explosive && ud.prop.userData.explosive.alive) {
        this.game.explode(ud.prop.userData.explosive);
      } else {
        fx.impact(hit.point, n, ud.surface || 'concrete');
        audio.impact(hit.point, ud.surface || 'concrete');
      }
    }

    // --- feedback
    audio.gunshot();
    this.flashTime = 0.05;
    this.flash.visible = true;
    this.flash.rotation.x = rnd(0, 6.28);
    this.flash.scale.setScalar(rnd(0.75, 1.25));
    fx.flash(muzzle, 0xffb870, 42, 0.07, 16);
    fx.sprite(muzzle, { vel: dir.clone().multiplyScalar(1.6).add(V3.set(0, 0.3, 0)), size: 0.06, grow: 0.5, life: 0.7, alpha: 0.2, drag: 4, rise: 0.25, color: SMOKE });

    this.kickVel += 2.6; this.rotVel += 7.5 * (1 - 0.45 * this.adsT);
    this.rollKick = rnd(-1, 1);
    this.slideT = 1;
    this.bloom = Math.min(3.2, this.bloom + 0.75);
    player.kick(0.0125 * (1 - 0.3 * this.adsT), rnd(-0.006, 0.006));

    // spent casing, thrown right and up from the ejection port
    const port = this.muzzleWorld(new THREE.Vector3()).addScaledVector(dir, -0.2);
    V2.set(1, 0, 0).applyQuaternion(camera.quaternion);
    V3.set(0, 1, 0).applyQuaternion(camera.quaternion);
    fx.body(port, V2.clone().multiplyScalar(rnd(1.6, 2.6)).addScaledVector(V3, rnd(1.6, 2.6)).addScaledVector(dir, rnd(-0.6, 0.2)).add(player.vel), true);
  }

  update(dt, firing, aiming, inSun) {
    const { player, camera } = this.game;
    this.cooldown -= dt;
    this.raise = Math.max(0, this.raise - dt * 2.2);
    if (firing && !this.triggerHeld) this.tryFire();
    this.triggerHeld = firing;

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const n = Math.min(MAG - this.ammo, this.reserve);
        this.ammo += n; this.reserve -= n;
      }
    }

    const canAim = aiming && this.reloading <= 0 && !player.sprinting && !player.dead;
    player.ads = canAim;
    this.adsT = THREE.MathUtils.damp(this.adsT, canAim ? 1 : 0, 16, dt);
    this.sprintT = THREE.MathUtils.damp(this.sprintT, player.sprinting ? 1 : 0, 9, dt);
    this.bloom = THREE.MathUtils.damp(this.bloom, 0, 5, dt);

    // recoil springs
    this.kickVel += (-this.kick * 260 - this.kickVel * 22) * dt; this.kick += this.kickVel * dt;
    this.rotVel += (-this.rot * 190 - this.rotVel * 17) * dt; this.rot += this.rotVel * dt;
    this.slideT = Math.max(0, this.slideT - dt * 14);
    const slideBack = this.ammo === 0 && this.reloading <= 0 ? 1 : Math.sin(Math.min(1, this.slideT) * Math.PI);
    this.slide.position.x = this.slideX - slideBack * 0.031;

    // look sway: the gun lags slightly behind the camera
    const ld = player.lookDelta;
    this.swayX = THREE.MathUtils.damp(this.swayX, THREE.MathUtils.clamp(ld.x * 0.0009, -0.05, 0.05), 10, dt);
    this.swayY = THREE.MathUtils.damp(this.swayY, THREE.MathUtils.clamp(ld.y * 0.0009, -0.05, 0.05), 10, dt);
    ld.set(0, 0);

    // reload / draw: the pistol drops out of frame, mag swap happens off-screen
    let low = this.raise;
    if (this.reloading > 0) {
      const t = 1 - this.reloading / RELOAD_TIME;
      low = Math.max(low, THREE.MathUtils.smoothstep(t, 0, 0.16) * (1 - THREE.MathUtils.smoothstep(t, 0.76, 1)));
    }
    if (player.dead) low = 1;

    const ads = this.adsT, k = 1 - ads * 0.82;
    const bob = player.bobAmp * k;
    const p = this.pose.position;
    p.lerpVectors(HIP, AIM, ads);
    p.x += Math.cos(player.bobPhase) * 0.0075 * bob - this.swayX * 0.5 * k;
    p.y += -Math.abs(Math.sin(player.bobPhase)) * 0.008 * bob + this.swayY * 0.4 * k + player.dip * 0.35 - player.vel.y * 0.0022 * k;
    p.z += this.kick * 0.05;
    p.y -= low * 0.23 + this.sprintT * 0.035;
    p.x += low * 0.03 + this.sprintT * 0.02;
    const breathe = Math.sin(performance.now() * 0.0014) * 0.0016 * k;
    p.y += breathe;
    this.pose.rotation.set(
      this.rot * 0.11 + low * 0.95 - this.sprintT * 0.42 + this.swayY * 0.6 * k + breathe * 2,
      -this.swayX * 1.1 * k + this.sprintT * 0.5 + low * 0.25,
      this.rollKick * this.rot * 0.02 - this.swayX * 0.8 * k - low * 0.5 + player.roll * 1.5,
    );

    // follow the world camera
    this.rig.position.copy(camera.position);
    this.rig.quaternion.copy(camera.quaternion);
    this.camera.position.copy(camera.position);
    this.camera.quaternion.copy(camera.quaternion);
    this.camera.fov = this.baseFov - ads * 12;
    this.camera.aspect = camera.aspect;
    this.camera.updateProjectionMatrix();

    // muzzle flash
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flashLight.intensity = 3.5 * Math.max(0, this.flashTime / 0.05);
      if (this.flashTime <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; }
    }

    // sun on the view-model fades out when the player stands in shadow
    this.sun.intensity = THREE.MathUtils.damp(this.sun.intensity, inSun ? this.sunIntensity : 0, 10, dt);
    this.scene.environmentIntensity = 0.5 + 0.5 * this.sun.intensity / this.sunIntensity; // less sky reaches the gun in the shade
    this.sun.position.copy(camera.position).addScaledVector(this.game.sunDir, 10);
    this.sun.target.position.copy(camera.position);
  }
}

const SMOKE = new THREE.Color(0.75, 0.75, 0.75);

// A gloved right hand and sleeve wrapped around the grip, modelled from capsules in the pistol's
// own space (+x muzzle, +y up, +z the shooter's right).
function buildHand() {
  const noise = (size, draw) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  };
  const leather = noise(128, (g, n) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 2600; i++) { const v = 90 + Math.random() * 80; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.beginPath(); g.arc(Math.random() * n, Math.random() * n, 0.6 + Math.random() * 1.6, 0, 7); g.fill(); }
  });
  leather.repeat.set(3, 3);
  const weave = noise(64, (g, n) => {
    g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < n; i += 4) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(i, 0, 2, n); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, i, n, 2); }
  });
  weave.repeat.set(10, 22);
  const glove = new THREE.MeshPhysicalMaterial({ color: 0x0d0d0e, roughness: 0.62, metalness: 0, bumpMap: leather, bumpScale: 2.5, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x30302c) });
  const pad = new THREE.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.85, bumpMap: leather, bumpScale: 1 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x2b3122, roughness: 0.95, bumpMap: weave, bumpScale: 1.2 });

  const hand = new THREE.Group();
  const Y = new THREE.Vector3(0, 1, 0), A = new THREE.Vector3(), B = new THREE.Vector3();
  const capsule = (a, b, r, mat = glove, r2 = r) => {
    A.set(...a); B.set(...b);
    const len = A.distanceTo(B);
    const geo = r2 === r ? new THREE.CapsuleGeometry(r, len, 6, 14) : new THREE.CylinderGeometry(r2, r, len, 20, 1);
    const m = new THREE.Mesh(geo, mat);
    m.position.lerpVectors(A, B, 0.5);
    m.quaternion.setFromUnitVectors(Y, B.clone().sub(A).normalize());
    m.frustumCulled = false;
    hand.add(m);
    return m;
  };
  const blob = (p, s, mat = glove) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat);
    m.position.set(...p); m.scale.set(...s); m.frustumCulled = false; hand.add(m); return m;
  };
  // palm heel and the web of the thumb, hugging the backstrap
  blob([-0.060, -0.012, 0.006], [0.021, 0.046, 0.030]);
  blob([-0.054, 0.024, 0.002], [0.017, 0.016, 0.026]);
  // back of the hand on the right side of the grip
  blob([-0.030, -0.012, 0.027], [0.034, 0.040, 0.014]);
  blob([-0.014, 0.010, 0.0335], [0.020, 0.011, 0.007], pad); // knuckle guard
  // three fingers wrapped around the front strap, fingertips resting on the left grip panel
  for (let i = 0; i < 3; i++) {
    const y = 0.004 - i * 0.0185, x = 0.012 - i * 0.004;
    capsule([x - 0.012, y - 0.002, 0.030], [x - 0.002, y, 0.014], 0.0088);
    capsule([x - 0.002, y, 0.014], [x - 0.003, y, -0.0135], 0.0084);
  }
  // index finger laid along the frame, outside the trigger guard
  capsule([-0.012, 0.022, 0.027], [0.022, 0.030, 0.0215], 0.0088);
  capsule([0.022, 0.030, 0.0215], [0.050, 0.033, 0.0190], 0.0078);
  // thumb along the left side
  capsule([-0.050, 0.020, -0.010], [-0.020, 0.031, -0.0195], 0.0105);
  capsule([-0.020, 0.031, -0.0195], [0.010, 0.036, -0.0205], 0.0088);
  // wrist, cuff and forearm heading down and back out of frame
  const wrist = [-0.066, -0.026, 0.012], elbow = [-0.36, -0.215, 0.105];
  A.set(...wrist); B.set(...elbow);
  const mid = A.clone().lerp(B, 0.2);
  capsule(wrist, mid.toArray(), 0.031, glove, 0.028);
  capsule(A.clone().lerp(B, 0.12).toArray(), A.clone().lerp(B, 0.22).toArray(), 0.0345, pad, 0.0335); // cuff strap
  capsule(mid.toArray(), elbow, 0.036, sleeve, 0.050);
  blob(mid.toArray(), [0.037, 0.037, 0.037], sleeve);
  return hand;
}
