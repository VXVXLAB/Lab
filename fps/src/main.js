// BRICKYARD: a tiny first-person shooter. Entry point: scene setup, lighting, game state, HUD, main loop.
import * as THREE from 'three';
import { loadAll } from './assets.js';
import { createRenderer, QUALITY } from './renderer.js';
import { buildLevel, rayBoxes } from './level.js';
import { FX, textures } from './fx.js';
import { GameAudio } from './audio.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { Enemies } from './enemies.js';
import { createRage } from './rage.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const WAVES = [2, 3, 4];
const RAGE = globalThis.BRICKYARD_MODE === 'rage' || params.get('mode') === 'rage';
const SUN_AZIMUTH = THREE.MathUtils.degToRad(-28); // where the sun sits, measured from +z towards +x
const UP = new THREE.Vector3(0, 1, 0);
const V = new THREE.Vector3(), V2 = new THREE.Vector3();

const canvas = $('view');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 400);
const audio = new GameAudio();
const game = { scene, camera, audio, state: 'loading' };

boot().catch((e) => {
  console.error(e);
  $('loadtext').textContent = 'FAILED TO LOAD: ' + (e.message || e);
});

async function boot() {
  const weaponScene = new THREE.Scene();
  const weaponCamera = new THREE.PerspectiveCamera(50, 1, 0.01, 10);
  const view = game.view = createRenderer(canvas, scene, camera, weaponScene, weaponCamera);
  const assets = await loadAll(view.renderer, (p) => { $('loadbar').firstElementChild.style.width = `${Math.round(p * 100)}%`; });

  // ---------------------------------------------------------------- sky and sun
  const sky = assets.sky;
  const srcAz = Math.atan2(sky.sunDir.x, sky.sunDir.z);
  const turn = SUN_AZIMUTH - srcAz;
  const sunDir = game.sunDir = sky.sunDir.clone().applyAxisAngle(UP, turn);
  scene.background = sky.background;
  scene.environment = sky.environment;
  scene.backgroundRotation.set(0, turn, 0);
  scene.environmentRotation.set(0, turn, 0);
  scene.environmentIntensity = 1;
  scene.fog = new THREE.FogExp2(0x9fb4c9, 0.0045);

  const sun = new THREE.DirectionalLight(sky.sunColor, sky.sunIrradiance);
  sun.position.copy(sunDir).multiplyScalar(70);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = -27; sc.right = 27; sc.top = 24; sc.bottom = -24; sc.near = 10; sc.far = 130;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035; sun.shadow.radius = 2.2;
  scene.add(sun, sun.target);
  game.sun = sun;
  // Cheap stand-ins for bounced light: warm fill from the sunlit ground and from the lit north facade.
  const groundBounce = new THREE.HemisphereLight(0x000000, 0x8a6f5c, sky.sunIrradiance * 0.11);
  const wallBounce = new THREE.DirectionalLight(0xc98a6a, sky.sunIrradiance * 0.07);
  wallBounce.position.set(-0.2, 0.25, -1);
  scene.add(groundBounce, wallBounce);

  // dust motes drifting through the yard
  const MOTES = 260, moteBox = 14;
  const motePos = new Float32Array(MOTES * 3), moteSeed = [];
  for (let i = 0; i < MOTES; i++) moteSeed.push([Math.random() * moteBox, Math.random() * 7, Math.random() * moteBox, Math.random() * 6.28]);
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ map: textures.glow || null, color: new THREE.Color(1.5, 1.35, 1.1), size: 0.035, sizeAttenuation: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  motes.frustumCulled = false; motes.userData.noAO = true;
  scene.add(motes);
  const updateMotes = (t) => {
    const c = camera.position;
    for (let i = 0; i < MOTES; i++) {
      const sd = moteSeed[i];
      const x = sd[0] + Math.sin(t * 0.21 + sd[3]) * 0.6 + t * 0.12, z = sd[2] + Math.cos(t * 0.17 + sd[3]) * 0.6;
      motePos[i * 3] = c.x + ((((x - c.x) % moteBox) + moteBox) % moteBox) - moteBox / 2;
      motePos[i * 3 + 1] = 0.2 + ((sd[1] + Math.sin(t * 0.3 + sd[3]) * 0.3 + t * 0.03) % 7);
      motePos[i * 3 + 2] = c.z + ((((z - c.z) % moteBox) + moteBox) % moteBox) - moteBox / 2;
    }
    moteGeo.attributes.position.needsUpdate = true;
  };

  // ---------------------------------------------------------------- world
  const level = game.level = buildLevel(assets, scene);
  const fx = game.fx = new FX(scene, camera);
  motes.material.map = textures.glow; motes.material.needsUpdate = true;
  fx.onCasingBounce = (pos, first) => audio.casing(pos, first);
  const player = game.player = new Player(camera, level, audio);
  const weapon = game.weapon = new Weapon(game, assets.models.service_pistol, sky, weaponScene, weaponCamera);
  weapon.sunIntensity = sun.intensity;
  const enemies = game.enemies = new Enemies(game);
  game.enemyMeshes = () => enemies.meshes();

  // ammo crates get a faint beacon so they read at a glance
  for (const p of level.pickups) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: new THREE.Color(1.2, 1.6, 0.9), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(0.55); s.position.y = 0.3; s.userData.noAO = true;
    p.group.add(s); p.beacon = s;
  }

  let qualityName = params.get('q') in QUALITY ? params.get('q') : 'high';
  let autoQuality = !params.has('q'), slowWindows = 0, sinceQualityChange = 0;
  const applyQuality = () => {
    const q = QUALITY[qualityName];
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    view.setQuality(q);
  };
  applyQuality();
  view.renderer.toneMappingExposure = Number(params.get('exp')) || 0.74;

  // ---------------------------------------------------------------- game rules
  const stats = { shots: 0, hits: 0, kills: 0, time: 0 };
  let wave = 0, waveTimer = 0, waveActive = false;
  let hitFlash = 0, hitmarkerT = 0, dmgDirT = 0, dmgAngle = 0, shake = 0, bannerT = 0;
  let inSun = true, sunCheck = 0, sunVis = 0, sunSeen = false;
  let rage = null;

  function banner(title, sub, seconds = 2.6) {
    $('bannertitle').textContent = title; $('bannersub').textContent = sub;
    $('banner').classList.add('on'); bannerT = seconds;
  }

  function resetGame() {
    enemies.clear();
    level.restoreProps();
    player.reset(); weapon.reset();
    Object.assign(stats, { shots: 0, hits: 0, kills: 0, time: 0 });
    wave = 0; waveTimer = 2.2; waveActive = false; hitFlash = 0;
    $('objtext').textContent = 'SECURE THE YARD';
    if (rage) rage.restart(true);
  }

  game.onHit = (kill, crit) => {
    stats.hits++;
    hitmarkerT = kill ? 0.5 : 0.18;
    $('hitmarker').style.color = kill ? '#ff5a3c' : crit ? '#ffd84a' : '#fff';
    audio.hitmarker(kill);
  };
  game.onKill = () => { stats.kills++; };
  game.onPlayerHit = (dmg, dir) => {
    if (player.dead) return;
    player.damage(dmg);
    audio.hurt();
    hitFlash = Math.min(1, hitFlash + 0.55); shake = Math.min(1, shake + 0.5);
    dmgDirT = 1.2;
    camera.getWorldDirection(V);
    dmgAngle = Math.atan2(-dir.x, -dir.z) - Math.atan2(V.x, V.z);
    if (player.dead) { if (rage) rage.onDeath(); else endGame(false); }
  };
  // radial damage: player, drones, and chained propane tanks
  game.blast = (pos, radius, dmg, source) => {
    const d = pos.distanceTo(V.copy(player.pos).setY(player.pos.y + 0.9));
    if (d < radius) game.onPlayerHit(dmg * (game.blastScale || 1) * (1 - d / radius), V2.copy(player.pos).sub(pos).setY(0).normalize());
    if (d < radius * 3) shake = Math.min(1.2, shake + 0.9 * (1 - d / (radius * 3)));
    for (const dr of [...enemies.drones]) {
      if (dr === source || dr.state === 'dead') continue;
      const dd = dr.pos.distanceTo(pos);
      if (dd < radius) dr.hit(dmg * 3 * (1 - dd / radius) + 30, dr.pos.clone(), dr.pos.clone().sub(pos).normalize(), UP);
    }
    for (const e of level.explosives) {
      if (e.alive && e.group.position.distanceTo(pos) < radius * 0.8) { e.alive = false; setTimeout(() => game.explode(e, true), 140 + Math.random() * 160); }
    }
  };
  game.explode = (e, chained) => {
    if (!e.alive && !chained) return;
    e.alive = false;
    const pos = e.group.position.clone().setY(e.group.position.y + 0.3);
    level.removeProp(e.group);
    fx.explosion(pos, 1.25);
    fx.decal(V.copy(pos).setY(0), UP, 'scorch', 4.2);
    audio.explosion(pos, 1);
    game.blast(pos, 5.2, 70, null);
  };

  function endGame(won, custom) {
    game.state = 'over';
    setTimeout(() => {
      const acc = stats.shots ? Math.round(100 * stats.hits / stats.shots) : 0;
      $('result').classList.remove('hide');
      $('result').innerHTML = `<b style="color:var(--hud);font-size:22px;letter-spacing:.3em;font-weight:300">${custom ? custom.title : won ? 'YARD SECURED' : 'KILLED IN ACTION'}</b><br>` +
        `${custom ? custom.line : `drones destroyed ${stats.kills} &nbsp;·&nbsp; accuracy ${acc}%`} &nbsp;·&nbsp; time ${stats.time.toFixed(1)}s<br><br>`;
      $('keys').classList.add('hide');
      $('cta').textContent = 'CLICK TO REDEPLOY';
      $('overlay').classList.remove('hidden');
      $('hud').classList.remove('on');
      if (document.pointerLockElement) document.exitPointerLock();
    }, won ? 2600 : 1900);
    if (custom) banner(custom.title, '', 4);
    else if (won) { banner('YARD SECURED', 'ALL HOSTILES DOWN', 4); audio.announce(true); } else audio.announce(false);
  }

  function updateRules(dt) {
    stats.time += dt;
    if (!waveActive) {
      waveTimer -= dt;
      if (waveTimer <= 0) {
        wave++; waveActive = true;
        enemies.spawn(WAVES[wave - 1]);
        banner(`WAVE ${wave}`, `${WAVES[wave - 1]} SENTRY DRONES INBOUND`);
        audio.announce(true);
      }
    } else if (enemies.active === 0) {
      waveActive = false;
      if (wave >= WAVES.length) endGame(true);
      else { waveTimer = 4.5; banner('WAVE CLEARED', 'REARM · NEXT WAVE INCOMING', 2.4); }
    }
    $('objtext').textContent = waveActive ? `DESTROY DRONES  ${enemies.alive} LEFT` : wave >= WAVES.length ? 'YARD SECURED' : 'STAND BY';

    // ammo pickups
    let prompt = '';
    for (const p of level.pickups) {
      if (!p.active) { p.respawn -= dt; if (p.respawn <= 0) { p.active = true; p.group.visible = true; } continue; }
      p.beacon.material.opacity = 0.22 + 0.12 * Math.sin(stats.time * 3);
      const dx = p.pos.x - player.pos.x, dz = p.pos.z - player.pos.z;
      if (dx * dx + dz * dz < 1.5 && Math.abs(p.pos.y - player.pos.y) < 1.8) {
        if (weapon.reserve < 96) {
          weapon.reserve = Math.min(96, weapon.reserve + 24);
          p.active = false; p.group.visible = false; p.respawn = 30;
          audio.pickup(); banner('', '+24 ROUNDS', 1.2);
        } else prompt = 'AMMO FULL';
      }
    }
    if (weapon.ammo === 0 && weapon.reserve === 0) prompt = 'OUT OF AMMO · FIND AN AMMO BOX';
    else if (weapon.ammo <= 2 && weapon.reloading <= 0 && weapon.reserve > 0) prompt = 'R · RELOAD';
    $('prompt').textContent = prompt; $('prompt').classList.toggle('on', !!prompt);
  }

  // ---------------------------------------------------------------- input
  let firing = false, aiming = false, noLock = false;
  const locked = () => document.pointerLockElement === canvas || noLock;

  function deploy() {
    audio.init();
    if (game.state === 'over' || game.state === 'menu') {
      if (game.state === 'over') resetGame();
      $('result').classList.add('hide'); $('keys').classList.remove('hide');
    }
    game.state = 'playing';
    $('overlay').classList.add('hidden'); $('hud').classList.add('on');
    if (!params.has('nolock')) {
      try {
        const r = canvas.requestPointerLock();
        if (r && r.catch) r.catch(() => { noLock = true; });
      } catch { noLock = true; }
    } else noLock = true;
  }
  $('overlay').addEventListener('click', () => { if (game.state !== 'loading') deploy(); });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && game.state === 'playing' && !noLock) {
      game.state = 'paused'; firing = aiming = false; player.keys.clear();
      $('cta').textContent = 'PAUSED · CLICK TO RESUME';
      $('overlay').classList.remove('hidden');
    }
  });
  document.addEventListener('mousemove', (e) => { if (game.state === 'playing' && locked()) player.look(e.movementX, e.movementY); });
  canvas.addEventListener('mousedown', (e) => {
    if (game.state !== 'playing') return;
    if (!locked()) { canvas.requestPointerLock(); return; }
    if (e.button === 0) { firing = true; } else if (e.button === 2) aiming = true;
  });
  document.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; else if (e.button === 2) aiming = false; });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if (game.state === 'paused' && e.code === 'Escape') return;
    if (e.code === 'KeyM') audio.setMuted(!audio.muted);
    if (e.code === 'KeyG' && !e.repeat) {
      autoQuality = false;
      const names = Object.keys(QUALITY);
      qualityName = names[(names.indexOf(qualityName) + 1) % names.length];
      applyQuality();
      banner('', `GRAPHICS · ${QUALITY[qualityName].label}`, 1.4);
    }
    if (game.state !== 'playing') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    player.keys.add(e.code);
    if (e.code === 'KeyR') weapon.startReload();
  });
  document.addEventListener('keyup', (e) => player.keys.delete(e.code));
  window.addEventListener('blur', () => { player.keys.clear(); firing = aiming = false; });
  window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); view.resize(); });

  // count shots for the accuracy stat
  const baseFire = weapon.fire.bind(weapon);
  weapon.fire = () => { stats.shots++; baseFire(); };

  // ---------------------------------------------------------------- HUD
  const pips = $('pips');
  for (let i = 0; i < 8; i++) pips.appendChild(document.createElement('i'));
  let fpsAcc = 0, fpsFrames = 0, fpsShown = 0;
  function updateHud(dt) {
    $('mag').textContent = weapon.ammo; $('reserve').textContent = weapon.reserve;
    $('ammo').classList.toggle('low', weapon.ammo <= 2);
    [...pips.children].forEach((p, i) => p.classList.toggle('off', i >= weapon.ammo));
    const hp = Math.ceil(player.hp);
    $('hpnum').textContent = hp;
    const bar = $('hpbar').firstElementChild;
    bar.style.transform = `scaleX(${player.hp / player.maxHp})`;
    bar.style.background = hp < 35 ? 'var(--warn)' : '';
    const ch = $('crosshair');
    ch.style.setProperty('--gap', `${4 + Math.tan(weapon.spread) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * innerHeight / 2}px`);
    ch.style.opacity = weapon.adsT > 0.5 || weapon.reloading > 0 || player.sprinting ? 0 : 0.9;
    hitmarkerT -= dt; $('hitmarker').style.opacity = Math.max(0, Math.min(1, hitmarkerT * 6));
    dmgDirT -= dt;
    $('dmgdir').style.opacity = Math.max(0, Math.min(1, dmgDirT));
    $('dmgdir').style.transform = `rotate(${dmgAngle}rad)`;
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('banner').classList.remove('on'); }
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc > 0.5) {
      fpsShown = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0;
      // If the machine cannot hold ~30 fps, step the graphics preset down automatically (until the player picks one).
      sinceQualityChange += 0.5;
      slowWindows = fpsShown < 30 && sinceQualityChange > 3 ? slowWindows + 1 : 0;
      if (autoQuality && !stepMode && slowWindows >= 4 && qualityName !== 'low') {
        qualityName = qualityName === 'high' ? 'medium' : 'low';
        applyQuality(); slowWindows = 0; sinceQualityChange = 0;
        banner('', `GRAPHICS · ${QUALITY[qualityName].label} (AUTO)`, 1.6);
      }
      $('stats').innerHTML = `${fpsShown} FPS · ${QUALITY[qualityName].label}`;
    }
  }

  // ---------------------------------------------------------------- main loop
  let time = 0, last = performance.now();
  const stepMode = params.has('step'); // debug: frames are advanced manually via __game.step()
  const menuCam = { t: 0 };

  function frame(manualDt, skipRender) {
    const now = performance.now();
    const dt = stepMode ? manualDt : Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    const playing = game.state === 'playing';

    if (playing || game.state === 'over') {
      if (playing) { stats.time += rage ? dt : 0; if (rage) rage.update(dt); else updateRules(dt); }
      player.update(dt, playing);
      // is the player's head in direct sunlight? (drives the view-model's key light)
      sunCheck -= dt;
      if (sunCheck <= 0) { sunCheck = 0.08; inSun = !rayBoxes(player.eye, sunDir, 80, level.occluders); }
      weapon.update(dt, playing && firing, playing && aiming, inSun);
      enemies.update(dt, time);
      fx.update(dt);
      camera.fov = THREE.MathUtils.damp(camera.fov, 72 - weapon.adsT * 16 + (player.sprinting ? 4 : 0), 12, dt);
      if (shake > 0.001) {
        shake = THREE.MathUtils.damp(shake, 0, 6, dt);
        camera.rotation.x += (Math.random() - 0.5) * 0.03 * shake;
        camera.rotation.z += (Math.random() - 0.5) * 0.03 * shake;
      }
      camera.updateProjectionMatrix();
      audio.setListener(player.eye, player.forward);
      hitFlash = THREE.MathUtils.damp(hitFlash, 0, 3, dt);
      view.lens.uDamage.value = Math.min(1, hitFlash * 0.8 + Math.pow(1 - player.hp / player.maxHp, 2) * 0.6);
      updateHud(dt);
    } else if (game.state === 'menu') {
      // slow establishing orbit behind the menu
      menuCam.t += dt * 0.05;
      camera.position.set(Math.sin(menuCam.t) * 10.5, 2.3 + Math.sin(menuCam.t * 1.7) * 0.5, 1.5 + Math.cos(menuCam.t) * 5.2);
      camera.lookAt(Math.sin(menuCam.t + 2.2) * 5, 2.6, -6);
      weapon.rig.visible = false;
      fx.update(dt);
    }
    if (game.state !== 'menu') weapon.rig.visible = true;
    // sun glare: only when the sun disc is on screen and not hidden behind a building
    updateMotes(time);
    V.copy(camera.position).addScaledVector(sunDir, 100).project(camera);
    camera.getWorldDirection(V2);
    sunSeen = V2.dot(sunDir) > 0 && Math.abs(V.x) < 1.25 && Math.abs(V.y) < 1.25 && !rayBoxes(camera.position, sunDir, 90, level.occluders);
    sunVis = THREE.MathUtils.damp(sunVis, sunSeen ? 1 : 0, 9, dt);
    view.lens.uSun.value.set(V.x * 0.5 + 0.5, V.y * 0.5 + 0.5, sunVis * (game.state === 'menu' ? 0.6 : 1));
    if (skipRender !== true) {
      level.updateReflection(view.renderer, scene, camera, QUALITY[qualityName].reflection);
      view.render(dt, time);
    }
    if (!stepMode) requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- go
  if (RAGE) {
    rage = createRage({ game, level, player, weapon, enemies, fx, audio, banner, $,
      finish: (title, line) => endGame(true, { title, line }), fade: (v) => { view.lens.uFade.value = v; } });
    game.rage = rage;
  }
  resetGame();
  game.state = 'menu';
  $('loading').classList.add('hide'); $('menu').classList.remove('hide');
  $('overlay').classList.remove('loading');
  window.__game = Object.assign(game, { deploy, stats, weapon, enemies, THREE, setFiring: (f) => { firing = f; }, setAiming: (a) => { aiming = a; } });
  game.step = (n = 1, dt = 1 / 60, renderLast = 2) => { for (let i = 0; i < n; i++) frame(dt, i < n - renderLast); };
  if (params.has('auto')) deploy();
  if (!stepMode) requestAnimationFrame(frame);
}
