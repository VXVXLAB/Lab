// QUALIFICATION DAY: the rage-game mode. Same yard, same pistol, but the objectives come from "Control"
// over the radio, and Control lies. Five short stages with instant retry; the last order is the true one.
import * as THREE from 'three';
import { textures } from './fx.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = new THREE.Vector3(), V2 = new THREE.Vector3();
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const TAUNTS = [
  ['That was the demolition training aid. My mistake. Probably.', 'Boxes that glow are usually fine. Usually.', 'You walked right up to it. I respect the trust.'],
  ['The target drone does not shoot. So that one is on you.', 'Impressive. Nothing here was even trying.'],
  ['Propane. Flammable. It says so on the label.', 'Best cover in the yard. I never said best for whom.', 'You took cover exactly where I said. Lovely.'],
  ['The door was right there. Was.', 'Mind the tank next time. I did not mention the tank.'],
  ['I told you. I actually told you.', 'One true order all day, and that is the one you ignored.', 'It had a green light. Green. Hold your fire.'],
];

export function createRage(ctx) {
  const { game, level, player, weapon, enemies, fx, audio, banner, finish, $ } = ctx;
  const R = { stage: 0, deaths: 0, lies: 0, said: new Set(), t: 0, respawn: 0 };
  let st = {};                 // per-attempt stage state
  const known = {};            // things the player has already been burned by (kept across deaths)
  game.blastScale = 3;

  // ---------------------------------------------------------------- radio subtitles
  const radio = $('radio'), radioText = $('radiotext');
  const queue = []; let line = null, shown = 0, hold = 0;
  function say(text, opts = {}) {
    if (opts.once) { if (R.said.has(text)) return; R.said.add(text); }
    if (opts.lie) R.lies++;
    if (opts.now) { queue.length = 0; line = null; }
    queue.push({ text, red: !!opts.red });
  }
  function tickRadio(dt) {
    if (!line && queue.length) { line = queue.shift(); shown = 0; hold = Math.max(2.6, line.text.length * 0.058) + 0.5; radio.classList.add('on'); radio.classList.toggle('red', line.red); audio.click(1500, 0.25); }
    if (!line) return;
    const before = Math.floor(shown);
    shown = Math.min(line.text.length, shown + dt * 48);
    if (Math.floor(shown) !== before) { radioText.textContent = line.text.slice(0, Math.floor(shown)); if (Math.floor(shown) % 4 === 0) audio.click(2400 + (shown % 5) * 120, 0.05); }
    hold -= dt;
    if (hold <= 0 || (queue.length && shown >= line.text.length && hold < 1.4)) { line = null; if (!queue.length) radio.classList.remove('on'); }
  }

  // ---------------------------------------------------------------- extraction marker
  const marker = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 14, 20, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 2.4, 0.7), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 7;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 4, 1.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.position.y = 0.03;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: new THREE.Color(0.4, 3, 1), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(3); halo.position.y = 1.2;
  marker.add(beam, ring, halo);
  marker.traverse((o) => { o.userData.noAO = true; });
  marker.visible = false;
  game.scene.add(marker);
  const DOORS = [new THREE.Vector3(13.2, 0, 5.2), new THREE.Vector3(-13.0, 0, -7.4), new THREE.Vector3(0.5, 0, 7.6)];

  // ---------------------------------------------------------------- weapon hooks
  game.fireGate = () => {
    if (R.stage === 1 && st.jam) {
      audio.dryFire();
      say('Click. Stovepipe. Press R to clear it. I loaded that magazine myself.', { once: true });
      return false;
    }
    return true;
  };
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && st.jam && game.state === 'playing') { st.jam = false; weapon.raise = 0.7; audio.click(900, 0.5); audio.click(2100, 0.6, 0.35); }
  });
  const baseFire = weapon.fire.bind(weapon);
  weapon.fire = () => {
    const d = st.target;
    if (R.stage === 1 && d && d.state === 'combat' && weapon.adsT > 0.5) {
      // the target drone slips sideways the instant you fire down the sights
      V.set(1, 0, 0).applyQuaternion(game.camera.quaternion).setY(0).normalize();
      const side = Math.random() > 0.5 ? 1 : -1;
      d.pos.addScaledVector(V, 2.6 * side); d.pos.x = THREE.MathUtils.clamp(d.pos.x, -12, 12); d.pos.z = THREE.MathUtils.clamp(d.pos.z, -7, 7);
      d.target.copy(d.pos); d.vel.set(0, 0, 0); d.root.updateMatrixWorld(true);
      fx.sparks_(d.pos, UP, 6, { speed: 3 });
      st.dodges = (st.dodges || 0) + 1;
      if (st.dodges === 2) say('Squeeze, do not jerk. Keep using the sights.', { lie: true });
      if (st.dodges === 5) say('Between us: it can tell when you are staring at it.', { now: true });
    }
    baseFire();
  };

  // ---------------------------------------------------------------- stages
  function nearestTank(maxDist) {
    let best = null, bd = maxDist;
    for (const e of level.explosives) { if (!e.alive) continue; const d = e.group.position.distanceTo(player.pos); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  function objective(text) { $('objtext').textContent = text; }

  function enter(stage) {
    R.stage = stage; R.t = 0; st = {};
    marker.visible = false;
    for (const p of level.pickups) { p.active = true; p.group.visible = true; }
    if (stage === 0) {
      weapon.ammo = 0; weapon.reserve = 0;
      objective('GET AMMUNITION');
      if (!known.box) {
        say('Welcome to qualification day, recruit. I am Control. Do exactly what I say and you will be fine.', { once: true, lie: true });
        say('Your weapon is dry. Glowing ammo box, ten metres to your left. Go and grab it.', { once: true, lie: true });
      } else if (!known.pen) say('Try the box in the fenced pen, far corner. That one is real.', { lie: true });
      else say('There is a third box, up on the crates. I would not trust it.', { lie: true });
    } else {
      weapon.ammo = 8; weapon.reserve = Math.max(weapon.reserve, 24);
    }
    if (stage === 1) {
      objective('DESTROY THE TARGET DRONE');
      st.jam = !known.jam; known.jam = true;
      st.target = enemies.spawn(1)[0];
      st.target.passive = true;
      st.target.pickTarget = function () { this.target.set(Math.sin(R.t * 0.5) * 4, 3.1, -1 + Math.cos(R.t * 0.4) * 2); this.retarget = 2.5; };
      say('One target drone, coming down now. It will not shoot back. Use your sights and aim carefully.', { lie: true });
    }
    if (stage === 2) {
      objective('SURVIVE THE HOSTILE');
      const d = st.hostile = enemies.spawn(1)[0];
      d.fireTimer = 4.2;
      d.aimFn = () => { const tank = nearestTank(5.5); return tank ? V2.copy(tank.group.position).setY(0.4) : null; };
      say('Live hostile inbound! Get behind a propane tank. Best cover in the yard.', { now: true, lie: true });
    }
    if (stage === 3) {
      objective('REACH THE GREEN EXTRACTION MARKER');
      st.door = 0; marker.position.copy(DOORS[0]); marker.visible = true;
      say('Hostile down. Extraction is marked in green. Move.', { now: true });
    }
    if (stage === 4) {
      objective('HOLD YOUR FIRE');
      const d = st.courier = enemies.spawn(1)[0];
      d.passive = true; d.friendly = true;
      d.pickTarget = function () { V.copy(player.forward).setY(0).normalize(); this.target.copy(player.pos).addScaledVector(V, 4.2); this.target.y = 2.3; this.retarget = 0.6; };
      say('Last thing. A courier drone is bringing your exit pass. Green light. Do not shoot it.', { now: true });
      say('I mean it this time.');
    }
  }

  function fail(redLine) {           // counted like a death, without the dying
    if (R.respawn > 0) return;
    R.deaths++; R.respawn = 1.7;
    say(redLine || pick(TAUNTS[R.stage]), { now: true, red: true });
  }

  function update(dt) {
    tickRadio(dt);
    R.t += dt;
    if (R.respawn > 0) {
      R.respawn -= dt;
      ctx.fade(Math.min(1, (1.7 - R.respawn) / 1.2));
      if (R.respawn <= 0) { enemies.clear(); level.restoreProps(); player.reset(); weapon.reset(); ctx.fade(0); enter(R.stage); }
      return;
    }
    const p = player.pos;
    let prompt = '';

    if (R.stage === 0) {
      const [pen, near, crate] = level.pickups; // far pen, near the spawn, on top of the crates
      const close = (b, r = 1.35) => b.active && Math.hypot(b.pos.x - p.x, b.pos.z - p.z) < r && Math.abs(b.pos.y - p.y) < 1.9;
      if (close(near, 1.6)) {
        known.box = true; near.active = false; near.group.visible = false;
        fx.explosion(near.pos.clone().setY(0.3), 1); fx.decal(V.copy(near.pos).setY(0), UP, 'scorch', 3.4); audio.explosion(near.pos, 1);
        game.onPlayerHit(999, V.set(1, 0, 0));
      } else if (close(pen)) {
        known.pen = true; pen.active = false; pen.group.visible = false; audio.dryFire();
        banner('', 'EMPTY', 1.4);
        say('Empty. Huh. Somebody should file a report.', { now: true });
        say('There is a third box, up on the crates. I would not trust it.', { lie: true });
      } else if (close(crate)) {
        crate.active = false; crate.group.visible = false; audio.pickup();
        weapon.ammo = 8; weapon.reserve = 24; banner('', '+32 ROUNDS', 1.4);
        say('Oh. That one was real. Good for you.', { now: true });
        enter(1);
      }
      prompt = 'NO AMMUNITION';
    } else if (R.stage === 1) {
      const d = st.target;
      if (!d || d.state === 'dead' || d.state === 'dying') { if (!st.done) { st.done = 1; say('Fine. It is dead. Beginner luck, shooting from the hip like that.', { now: true }); } if (enemies.active === 0) enter(2); }
      if (weapon.ammo === 0 && weapon.reserve === 0) fail('Out of ammunition against a target that never moved. Mostly never.');
      if (st.jam) prompt = '';
    } else if (R.stage === 2) {
      if (enemies.active === 0) enter(3);
      else if (weapon.ammo === 0 && weapon.reserve === 0) fail('Dry again. Qualification usually involves hitting things.');
    } else if (R.stage === 3) {
      const d = Math.hypot(marker.position.x - p.x, marker.position.z - p.z);
      beam.material.opacity = 0.13 + 0.05 * Math.sin(R.t * 5); ring.rotation.y += dt;
      if (d < 3.2 && st.door < 2) {
        st.door++; marker.position.copy(DOORS[st.door]); audio.droneCharge(marker.position);
        say(st.door === 1 ? 'Wrong door. The other green door. Far corner.' : 'Did I say far corner? The other other one.', { now: true, lie: true });
        if (st.door === 2) { // a parting gift on the way back
          const tank = level.explosives.filter((e) => e.alive).sort((a, b) => a.group.position.distanceTo(p) - b.group.position.distanceTo(p))[0];
          if (tank) setTimeout(() => game.explode(tank), 350);
        }
      } else if (d < 1.4 && st.door === 2) enter(4);
    } else if (R.stage === 4) {
      const d = st.courier;
      if (!d || d.hp < 100 || d.state !== 'combat' && d.state !== 'enter') { fail(); return; }
      if (d.state === 'combat') st.wait = (st.wait || 0) + dt;
      const w = st.wait || 0;
      if (w > 2.2 && !st.beep) { st.beep = 1; d.charge = 0.5; audio.droneCharge(d.pos); say('That noise is normal. Hold.', { now: true }); }
      if (w > 4.6 && !st.beep2) { st.beep2 = 1; d.charge = 0.5; audio.droneCharge(d.pos); }
      prompt = w > 0 ? `HOLD FIRE  ${Math.max(0, 7 - w).toFixed(1)}` : '';
      if (w >= 7) {
        st.wait = -999; audio.announce(true);
        say('Qualified. And… sorry about the ammo box.', { now: true });
        finish('QUALIFIED', `retries ${R.deaths} &nbsp;·&nbsp; lies told ${R.lies} &nbsp;·&nbsp; true orders 1`);
      }
    }
    if (weapon.ammo <= 2 && weapon.reserve > 0 && weapon.reloading <= 0 && !st.jam) prompt = prompt || 'R · RELOAD';
    $('prompt').textContent = prompt; $('prompt').classList.toggle('on', !!prompt);
    $('retries').textContent = `RETRIES ${R.deaths}`;
  }

  return {
    update,
    get deaths() { return R.deaths; }, get stage() { return R.stage; }, state: R,
    onDeath() { if (R.respawn <= 0) { R.deaths++; R.respawn = 1.7; say(pick(TAUNTS[R.stage]), { now: true, red: true }); } },
    tickRespawn: update,
    restart(full) { if (full) { R.deaths = 0; R.lies = 0; R.said.clear(); for (const k in known) delete known[k]; } queue.length = 0; line = null; radio.classList.remove('on'); R.respawn = 0; enter(full ? 0 : R.stage); },
    jump(stage) { enemies.clear(); level.restoreProps(); enter(stage); },
  };
}
