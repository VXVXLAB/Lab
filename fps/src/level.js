// The level: a small walled factory yard assembled from a modular photoscanned facade kit,
// wet asphalt, and scanned props. Also produces the collision boxes used by everything else.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

export const YARD = { x: 15, z: 9 }; // half extents of the playable yard

// ---------------------------------------------------------------- collision helpers
export function rayBoxes(origin, dir, maxDist, boxes, skipFlag) {
  let best = maxDist, hit = null;
  for (const b of boxes) {
    if (skipFlag && b[skipFlag]) continue;
    let t0 = 0, t1 = best;
    let ok = true;
    for (const a of ['x', 'y', 'z']) {
      const o = origin[a], d = dir[a];
      if (Math.abs(d) < 1e-8) { if (o < b.min[a] || o > b.max[a]) { ok = false; break; } continue; }
      let n = (b.min[a] - o) / d, f = (b.max[a] - o) / d;
      if (n > f) { const s = n; n = f; f = s; }
      if (n > t0) t0 = n;
      if (f < t1) t1 = f;
      if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 < best) { best = t0; hit = b; }
  }
  return hit ? { t: best, box: hit } : null;
}

// ---------------------------------------------------------------- facade kit
function floatGeometry(src, matrix) {
  const g = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    const a = src.getAttribute(name);
    const out = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) {
      out[i * size] = a.getX(i); out[i * size + 1] = a.getY(i);
      if (size === 3) out[i * size + 2] = a.getZ(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  if (src.index) g.setIndex(Array.from(src.index.array));
  g.applyMatrix4(matrix);
  return g;
}

// Breaks up the kit's tiling: large-scale tonal blotches, rain streaks and a dirt band near the ground.
const NOISE_GLSL = /* glsl */`
  float pHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float pNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(pHash(i), pHash(i + vec2(1, 0)), f.x), mix(pHash(i + vec2(0, 1)), pHash(i + vec2(1, 1)), f.x), f.y); }
  float pFbm(vec2 p) { float a = 0.5, v = 0.0; for (int i = 0; i < 5; i++) { v += a * pNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }`;
function weather(mat) {
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        float wU = vWPos.x + vWPos.z;
        float wMacro = pFbm(vec2(wU, vWPos.y) * 0.33);
        float wStreak = pFbm(vec2(wU * 2.4, vWPos.y * 0.22 + 4.0));
        float wLow = smoothstep(1.3, 0.0, vWPos.y);
        diffuseColor.rgb *= mix(0.66, 1.14, wMacro);
        diffuseColor.rgb *= mix(1.0, 0.6, smoothstep(0.45, 0.75, wStreak));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.46, 0.43, 0.38), wLow * (0.35 + 0.5 * wMacro));`);
  };
}

class FacadeKit {
  constructor(kitScene) {
    this.nodes = {};
    this.boxes = {};
    for (const n of kitScene.children) {
      this.nodes[n.name] = n;
      this.boxes[n.name] = new THREE.Box3().setFromObject(n);
    }
    this.buckets = new Map(); // material -> geometries
  }
  origin(name) {
    const b = this.boxes[name];
    return new THREE.Vector3(Math.round(b.min.x), Math.round(b.min.y), Math.round(b.max.z));
  }
  // Adds kit piece `name` so that its module origin lands at local (x, y, 0) of `frame`.
  add(name, frame, x, y, originName = name) {
    const node = this.nodes[name];
    if (!node) return false;
    const o = this.origin(originName);
    const place = new THREE.Matrix4().makeTranslation(x - o.x, y - o.y, -o.z).premultiply(frame);
    node.traverse((m) => {
      if (!m.isMesh) return;
      const g = floatGeometry(m.geometry, new THREE.Matrix4().multiplyMatrices(place, m.matrixWorld));
      if (!this.buckets.has(m.material)) this.buckets.set(m.material, []);
      this.buckets.get(m.material).push(g);
    });
    return true;
  }
  flush(group, shootables) {
    for (const [mat, geos] of this.buckets) {
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
      geos.forEach((g) => g.dispose());
      mesh.receiveShadow = true;
      if (mat.transparent) {
        mat.roughness = 0.06; mat.metalness = 0; mat.opacity = 0.55; mat.depthWrite = false;
        mat.envMapIntensity = 1.6; mat.color.setScalar(0.25);
        mesh.userData.noAO = true;
        mesh.renderOrder = 2;
        mesh.userData.surface = 'glass';
      } else {
        mesh.userData.surface = /brick|trim/.test(mat.name) ? 'concrete' : 'metal';
        weather(mat);
      }
      group.add(mesh);
      shootables.push(mesh);
    }
    this.buckets.clear();
  }
}

const WIN = (kind, floor) => [`wall_window_${kind}_0${floor}`, 3];
const STD = ['wall_standard_standard_01', 3];
const FACADES = [
  { // north, the tall main factory front, catches the sun
    pos: [-YARD.x, 0, -YARD.z], ry: 0,
    floors: [
      [STD, ['wall_door_garage_double_01', 9], ['wall_door_recessed_small_01', 3], ['wall_door_garage_door_01', 6], ['wall_door_centered_large_01', 3], ['wall_door_garage_centered_01', 6]],
      ['tall_large', 'tall_small', 'tall_small', 'tall_large', 'centered_large', 'centered_double', 'centered_large', 'tall_large', 'tall_small', 'tall_large'].map((k) => WIN(k, 1)),
      ['tall_large', 'tall_small', 'tall_small', 'tall_large', 'centered_large', 'centered_double', 'centered_large', 'tall_large', 'tall_small', 'tall_large'].map((k) => WIN(k, 2)),
      ['tall_large', 'tall_small', 'tall_small', 'tall_large', 'centered_medium', 'centered_double', 'centered_medium', 'tall_large', 'tall_small', 'tall_large'].map((k) => WIN(k, 3)),
    ],
  },
  { // south, low workshop row
    pos: [YARD.x, 0, YARD.z], ry: Math.PI,
    floors: [
      [['wall_door_garage_centered_01', 6], STD, ['wall_door_centered_small_01', 3], STD, ['wall_door_garage_door_01', 6], ['wall_door_recessed_large_01', 3], STD, STD],
      ['centered_medium', 'centered_large', 'centered_small', 'centered_double', 'centered_large', 'centered_medium', 'centered_small', 'centered_double', 'centered_large', 'centered_medium'].map((k) => WIN(k, 2)),
    ],
  },
  { // west
    pos: [-YARD.x, 0, YARD.z], ry: Math.PI / 2,
    floors: [
      [STD, ['wall_door_recessed_small_01', 3], STD, ['wall_door_garage_centered_01', 6], STD],
      ['centered_large', 'tall_small', 'centered_double', 'centered_double', 'tall_small', 'centered_large'].map((k) => WIN(k, 1)),
      ['centered_large', 'tall_small', 'centered_double', 'centered_double', 'tall_small', 'centered_large'].map((k) => WIN(k, 3)),
    ],
  },
  { // east
    pos: [YARD.x, 0, -YARD.z], ry: -Math.PI / 2,
    floors: [
      [['wall_door_garage_double_01', 9], STD, ['wall_door_centered_large_01', 3], STD],
      ['tall_large', 'centered_medium', 'tall_large', 'tall_large', 'centered_medium', 'tall_large'].map((k) => WIN(k, 2)),
      ['tall_large', 'centered_medium', 'tall_large', 'tall_large', 'centered_medium', 'tall_large'].map((k) => WIN(k, 3)),
    ],
  },
];

function buildFacades(kitScene, scene, shootables, colliders, occluders, facades = FACADES) {
  const kit = new FacadeKit(kitScene);
  const group = new THREE.Group();
  group.name = 'facades';
  const interior = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.95, metalness: 0 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x57493f, roughness: 0.92 });
  weather(roofMat);

  for (const f of facades) {
    const frame = new THREE.Matrix4().makeRotationY(f.ry).setPosition(...f.pos);
    let width = 0;
    f.floors.forEach((mods, floor) => {
      let x = 0;
      for (const [name, w] of mods) {
        kit.add(name, frame, x, floor * 3);
        kit.add(name.replace(/^wall_/, ''), frame, x, floor * 3, name);
        if (floor === 0 && name === STD[0]) kit.add('base_standard_standard_01', frame, x, 0);
        for (let i = 0; i < w; i += 3) {
          if (floor > 0) kit.add('cornice03_standard_standard_01', frame, x + i, floor * 3);
        }
        x += w;
      }
      width = Math.max(width, x);
    });
    const height = f.floors.length * 3;
    for (let x = 0; x < width; x += 3) kit.add('crown_standard_standard_01', frame, x, height);

    // Building volume behind the facade: blocks the sun, and reads as a dark interior through the glass.
    const depth = 9;
    const body = new THREE.Mesh(new THREE.BoxGeometry(width + 2 * depth, height + 0.3, depth), [roofMat, roofMat, roofMat, roofMat, interior, roofMat]);
    body.position.set(width / 2, (height + 0.3) / 2 - 0.02, -depth / 2 - 0.56).applyMatrix4(frame);
    body.rotation.y = f.ry;
    body.castShadow = true;
    body.userData.surface = 'concrete';
    group.add(body);
    // collision: one slab per facade
    const a = new THREE.Vector3(-depth, -1, -depth).applyMatrix4(frame);
    const b = new THREE.Vector3(width + depth, 40, 0).applyMatrix4(frame);
    colliders.push({ min: a.clone().min(b), max: a.clone().max(b), wall: true });
    const top = new THREE.Vector3(width + depth, height + 0.3, 0).applyMatrix4(frame);
    occluders.push({ min: a.clone().min(top), max: a.clone().max(top) });
  }
  kit.flush(group, shootables);
  scene.add(group);
  return group;
}

// ---------------------------------------------------------------- ground
function buildGround(tex, scene, shootables) {
  const size = 80, tile = 3.2;
  for (const t of Object.values(tex)) t.repeat.set(size / tile, size / tile);
  const mat = new THREE.MeshStandardMaterial({
    map: tex.diff, normalMap: tex.nor, roughnessMap: tex.arm, aoMap: tex.arm, metalness: 0,
    normalScale: new THREE.Vector2(1.2, 1.2),
  });
  // Planar reflection of the whole scene, rendered from a mirrored camera and sampled by the wet ground.
  const geo = new THREE.PlaneGeometry(size, size);
  const mirror = new Reflector(geo, { textureWidth: 512, textureHeight: 512, clipBias: 0.002 });
  mirror.rotation.x = -Math.PI / 2;
  mirror.visible = false;
  mirror.updateMatrixWorld();
  scene.add(mirror);
  const mirrorTex = mirror.getRenderTarget().texture;
  mirrorTex.generateMipmaps = true;
  mirrorTex.minFilter = THREE.LinearMipmapLinearFilter;
  const uniforms = { uMirror: { value: mirrorTex }, uMirrorMatrix: mirror.material.uniforms.textureMatrix, uMirrorOn: { value: 1 } };
  const sizeV = new THREE.Vector2();
  let mirrorScale = -1;
  const updateReflection = (renderer, scn, cam, scale) => {
    uniforms.uMirrorOn.value = scale > 0 ? 1 : 0;
    if (!(scale > 0)) return;
    renderer.getDrawingBufferSize(sizeV);
    const w = Math.round(sizeV.x * scale), h = Math.round(sizeV.y * scale);
    const rt = mirror.getRenderTarget();
    if (rt.width !== w || rt.height !== h || mirrorScale !== scale) { rt.setSize(w, h); mirrorScale = scale; }
    cam.updateMatrixWorld();
    mirror.onBeforeRender(renderer, scn, cam);
    mirror.visible = false;
  };

  // Rain puddles: a world-space noise mask drives wet darkening, mirror-smooth roughness and flat normals.
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec4 vMirrorUv;\nuniform mat4 uMirrorMatrix;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvMirrorUv = uMirrorMatrix * vec4(position, 1.0);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        varying vec3 vWPos;
        varying vec4 vMirrorUv;
        uniform sampler2D uMirror;
        uniform float uMirrorOn;
        vec2 gRipple;
        ${NOISE_GLSL}
        float gWet, gPuddle, gPaint;`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        float pn = pFbm(vWPos.xz * 0.16 + 3.7);
        float pd = pFbm(vWPos.xz * 1.9);
        float pm = pn + (pd - 0.5) * 0.10;
        gPuddle = smoothstep(0.560, 0.585, pm);
        gWet = smoothstep(0.47, 0.58, pm);
        float macro = pFbm(vWPos.xz * 0.045 + 9.0);
        diffuseColor.rgb *= mix(0.78, 1.12, macro);
        // worn road paint: parking bays along the north wall, a hatched keep-clear box by the west garage
        vec2 q = vWPos.xz;
        float bay = step(abs(fract((q.x + 13.5) / 3.0) - 0.5) * 3.0, 0.055) * step(abs(q.x), 13.6) * step(-8.7, q.y) * step(q.y, -4.1);
        bay = max(bay, step(abs(q.y + 4.1), 0.055) * step(abs(q.x), 13.6));
        vec2 hb = abs(q - vec2(-13.0, -3.0)) - vec2(1.6, 2.7);
        float inBox = step(max(hb.x, hb.y), 0.0);
        float hatch = inBox * max(step(fract((q.x + q.y) * 0.9), 0.16), step(-0.11, max(hb.x, hb.y)));
        float wear = smoothstep(0.38, 0.62, pFbm(q * 2.6 + 31.0)) * (0.55 + 0.45 * pNoise(q * 23.0));
        gPaint = max(bay, hatch) * wear;
        vec3 paintCol = mix(vec3(0.62, 0.61, 0.58), vec3(0.62, 0.43, 0.05), hatch);
        diffuseColor.rgb = mix(diffuseColor.rgb, paintCol * mix(0.7, 1.0, macro), gPaint * 0.85);
        diffuseColor.rgb *= mix(1.0, 0.42, gWet);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, gPuddle);`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, gWet);
        roughnessFactor = mix(roughnessFactor, 0.035, gPuddle);`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        gRipple = normal.xy - nonPerturbedNormal.xy;
        normal = normalize(mix(normal, nonPerturbedNormal, gPuddle * 0.985));`)
      .replace('#include <lights_fragment_maps>', /* glsl */`#include <lights_fragment_maps>
        if (uMirrorOn > 0.5) {
          vec2 muv = vMirrorUv.xy / vMirrorUv.w + gRipple * 0.05 * (1.0 - gPuddle);
          vec3 planar = min(textureLod(uMirror, muv, material.roughness * 8.0).rgb, vec3(24.0));
          radiance = mix(radiance, planar, smoothstep(0.55, 0.12, material.roughness));
        }`);
  };
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.surface = 'concrete';
  scene.add(ground);
  return { updateReflection, ground };
}

// ---------------------------------------------------------------- props
const PROPS = {
  barrier: { model: 'concrete_road_barrier', surface: 'concrete' },
  barrel: { model: 'Barrel_01', surface: 'metal' },
  drum: { model: 'barrel_03', surface: 'metal' },
  car: { model: 'covered_car', surface: 'soft' },
  lamp: { model: 'street_lamp_01', surface: 'metal', pad: [-0.26, 0, -0.1] },
  crate: { model: 'wooden_military_crate', surface: 'wood', scale: 1.55 },
  propane: { model: 'propane_tank', surface: 'metal', scale: 1.5, explosive: true },
  tyre: { model: 'old_tyre', surface: 'soft', rx: Math.PI / 2 },
  generator: { model: 'portable_generator', surface: 'metal', scale: 1.25 },
  bin: { model: 'metal_trash_can', surface: 'metal', filter: (n) => !/rust|lid/.test(n) },
  binRust: { model: 'metal_trash_can', surface: 'metal', filter: (n) => /rust/.test(n) && !/lid/.test(n) },
  utility: { model: 'utility_box_01', surface: 'metal', noCollide: true },
  box: { model: 'cardboard_box_01', surface: 'soft', scale: 1.3 },
  bag: { model: 'trashbag', surface: 'soft', noCollide: true },
  ammo: { model: 'ammo_box', surface: 'metal', scale: 1.6, noCollide: true },
};

function makePropFactory(models) {
  const cache = {};
  return function make(kind) {
    const def = PROPS[kind];
    if (!cache[kind]) {
      const inner = new THREE.Group();
      for (const n of models[def.model].children) {
        if (def.filter && !def.filter(n.name)) continue;
        inner.add(n.clone(true));
      }
      if (def.rx) inner.rotation.x = def.rx;
      inner.scale.setScalar(def.scale || 1);
      inner.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(inner);
      const c = box.getCenter(new THREE.Vector3());
      inner.position.set(-c.x, -box.min.y, -c.z);
      inner.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        o.userData.surface = def.surface;
        if (o.material.transparent) {
          if (/wire/.test(o.material.name)) { o.material.transparent = false; o.material.alphaTest = 0.4; o.material.side = THREE.DoubleSide; }
          else { o.material.depthWrite = false; o.material.roughness = 0.08; o.castShadow = false; }
          o.userData.noAO = true;
        }
      });
      cache[kind] = inner;
    }
    const g = new THREE.Group();
    g.add(cache[kind].clone(true));
    g.userData.kind = kind;
    return g;
  };
}

// [kind, x, z, yawDegrees, y]
const LAYOUT = [
  // jersey barriers: mid-yard cover lines
  ['barrier', -5.6, 1.2, 4], ['barrier', -4.0, 1.25, -3], ['barrier', -2.4, 1.15, 2],
  ['barrier', 6.4, 2.6, 92], ['barrier', 6.45, 4.2, 87],
  ['barrier', -9.5, -1.2, 60],
  // the covered car and its junk
  ['car', 3.05, -6.0, 91],
  ['tyre', 5.3, -7.9, 0, 0], ['tyre', 5.32, -7.88, 40, 0.16], ['tyre', 5.27, -7.92, 95, 0.32], ['tyre', 6.2, -8.1, 20, 0],
  // crate stacks
  ['crate', -9.4, -4.6, 3], ['crate', -9.45, -4.55, -4, 0.71], ['crate', -7.3, -4.9, 78],
  ['crate', 10.2, 5.6, 88], ['crate', 10.25, 5.55, 95, 0.71], ['crate', 11.5, 6.9, 12],
  // drums and barrels
  ['barrel', -0.6, -7.6, 0], ['drum', 0.15, -7.9, 50], ['barrel', -0.2, -6.9, 120], ['drum', -12.6, 3.6, 10], ['barrel', -13.3, 3.1, 80],
  ['drum', 13.6, 1.2, 0], ['barrel', 13.1, 0.4, 200], ['drum', 13.8, 0.3, 33],
  // explosive propane tanks
  ['propane', 0.9, 4.9, 0], ['propane', -10.6, -7.2, 40], ['propane', 12.2, -6.9, 100], ['propane', 7.6, 3.4, 10], ['propane', -3.2, -0.2, 70],
  // misc dressing
  ['generator', -13.6, -1.6, 90],
  ['bin', -1.2, 8.35, 10], ['binRust', -0.3, 8.3, 160], ['bag', 0.5, 8.3, 0], ['bag', 0.9, 7.85, 130], ['bag', -2.0, 8.2, 60],
  ['box', 9.1, -8.2, 15], ['box', 9.7, -8.35, -30], ['box', 9.3, -8.25, 70, 0.44], ['bag', 10.5, -8.2, 20],
  ['binRust', -14.3, -6.2, 0], ['box', -14.2, -5.3, 20],
  ['lamp', -6.0, 8.45, 180], ['lamp', 9.0, -8.45, 0], ['lamp', -14.5, 0.6, 90], ['lamp', 14.5, -3.0, -90],
];

function buildProps(models, scene, shootables, colliders, explosives, pickups, layout = LAYOUT, extras = true) {
  const make = makePropFactory(models);
  const root = new THREE.Group();
  root.name = 'props';
  const box = new THREE.Box3();
  for (const [kind, x, z, yaw = 0, y = 0] of layout) {
    const def = PROPS[kind];
    const g = make(kind);
    g.position.set(x, y, z);
    g.rotation.y = THREE.MathUtils.degToRad(yaw);
    root.add(g);
    g.updateMatrixWorld(true);
    let collider = null;
    if (!def.noCollide) {
      box.setFromObject(g);
      if (kind === 'lamp') { box.min.set(x - 0.12, 0, z - 0.12); box.max.set(x + 0.12, 3.8, z + 0.12); }
      collider = { min: box.min.clone().addScalar(0.02), max: box.max.clone().subScalar(0.02), prop: g };
      collider.min.y = box.min.y;
      colliders.push(collider);
    }
    g.traverse((o) => { if (o.isMesh) { shootables.push(o); o.userData.prop = g; } });
    if (def.explosive) { explosives.push({ group: g, collider, alive: true }); g.userData.explosive = explosives[explosives.length - 1]; }
  }

  if (extras) {
  // utility boxes hung on the walls
  for (const [x, z, yaw] of [[-11.2, -8.86, 0], [5.6, 8.86, 180], [14.86, 4.4, -90]]) {
    const g = make('utility');
    g.position.set(x, 0.85, z); g.rotation.y = THREE.MathUtils.degToRad(yaw);
    root.add(g);
    g.traverse((o) => { if (o.isMesh) shootables.push(o); });
  }

  // chain-link fence pen in the north-east corner
  const fenceKit = models.modular_chainlink_fence;
  const panelSrc = fenceKit.getObjectByName('modular_chainlink_fence_double');
  const postSrc = fenceKit.getObjectByName('modular_chainlink_fence_post');
  const prep = (src) => {
    const g = new THREE.Group();
    const c = src.clone(true);
    g.add(c);
    g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g);
    c.position.x -= b.min.x; c.position.z -= (b.min.z + b.max.z) / 2; c.position.y -= 0;
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.userData.surface = 'metal';
      if (o.material.transparent || /wire/.test(o.material.name)) {
        o.material.transparent = false; o.material.alphaTest = 0.35; o.material.side = THREE.DoubleSide;
        o.userData.noAO = true; o.userData.wire = true;
      }
    });
    return { g, w: b.max.x - b.min.x };
  };
  const panel = prep(panelSrc), post = prep(postSrc);
  const runs = [{ from: [8.6, -2.2], dir: [1, 0], n: 3 }, { from: [8.6, -2.2], dir: [0, -1], n: 1 }];
  for (const r of runs) {
    const yaw = Math.atan2(-r.dir[1], r.dir[0]);
    for (let i = 0; i <= r.n; i++) {
      const px = r.from[0] + r.dir[0] * i * panel.w, pz = r.from[1] + r.dir[1] * i * panel.w;
      const p = post.g.clone(true);
      p.position.set(px - post.w / 2 * Math.abs(r.dir[0]), 0, pz); p.rotation.y = yaw;
      root.add(p);
      p.traverse((o) => { if (o.isMesh) shootables.push(o); });
      if (i < r.n) {
        const f = panel.g.clone(true);
        f.position.set(px, 0, pz); f.rotation.y = yaw;
        root.add(f);
        f.traverse((o) => { if (o.isMesh && !o.userData.wire) shootables.push(o); });
      }
    }
    const ex = r.from[0] + r.dir[0] * r.n * panel.w, ez = r.from[1] + r.dir[1] * r.n * panel.w;
    colliders.push({
      min: new THREE.Vector3(Math.min(r.from[0], ex) - 0.06, 0, Math.min(r.from[1], ez) - 0.06),
      max: new THREE.Vector3(Math.max(r.from[0], ex) + 0.06, 2.45, Math.max(r.from[1], ez) + 0.06),
      seeThrough: true,
    });
  }

  // ammo pickups
  for (const [x, z, y] of [[12.6, -5.6, 0], [-8.2, 7.9, 0], [-9.4, -4.6, 1.42]]) {
    const g = make('ammo');
    g.position.set(x, y, z); g.rotation.y = Math.random() * 6;
    root.add(g);
    pickups.push({ group: g, pos: new THREE.Vector3(x, y, z), active: true, respawn: 0 });
  }
  }
  scene.add(root);
  return root;
}

// ---------------------------------------------------------------- maps
const cycle = (kinds, n, floor) => Array.from({ length: n }, (_, i) => WIN(kinds[i % kinds.length], floor));
const MAPS = {
  // the walled factory yard
  yard: { facades: FACADES, layout: LAYOUT, extras: true, spawn: [-12.2, 0, 6.4, -1.05] },
  // a long, narrow lantern alley between two tall brick rows
  alley: {
    spawn: [-21, 0, 0, -Math.PI / 2], extras: false,
    facades: [
      { pos: [-24, 0, -3], ry: 0, floors: [
        [STD, ['wall_door_garage_double_01', 9], ['wall_door_recessed_small_01', 3], STD, ['wall_door_garage_door_01', 6], ['wall_door_centered_large_01', 3], STD, ['wall_door_garage_centered_01', 6], ['wall_door_centered_small_01', 3], STD, ['wall_door_recessed_large_01', 3], STD],
        cycle(['tall_small', 'centered_large', 'centered_double', 'tall_large'], 16, 1),
        cycle(['centered_medium', 'tall_small', 'centered_large', 'centered_double'], 16, 2),
      ] },
      { pos: [24, 0, 3], ry: Math.PI, floors: [
        [['wall_door_garage_centered_01', 6], STD, ['wall_door_centered_small_01', 3], STD, STD, ['wall_door_garage_door_01', 6], ['wall_door_recessed_large_01', 3], STD, ['wall_door_garage_double_01', 9], STD, ['wall_door_recessed_small_01', 3], STD],
        cycle(['centered_double', 'centered_medium', 'tall_small', 'centered_large'], 16, 2),
        cycle(['tall_large', 'centered_small', 'centered_double', 'centered_medium'], 16, 3),
      ] },
      { pos: [-24, 0, 3], ry: Math.PI / 2, floors: [[STD, ['wall_door_centered_large_01', 3]], cycle(['centered_large', 'tall_small'], 2, 1), cycle(['centered_double', 'centered_large'], 2, 2)] },
      { pos: [24, 0, -3], ry: -Math.PI / 2, floors: [[['wall_door_recessed_small_01', 3], STD], cycle(['tall_small', 'centered_large'], 2, 2), cycle(['centered_large', 'centered_double'], 2, 3)] },
    ],
    layout: [
      ['bin', -18, 2.4, 10], ['bag', -17.2, 2.3, 0], ['crate', -13, -2.3, 2], ['crate', -13.05, -2.3, -3, 0.71], ['barrel', -8, 2.4, 0], ['drum', -7.2, 2.45, 40],
      ['box', -4, -2.4, 15], ['box', -3.4, -2.45, -30], ['barrier', 0, 2.25, 2], ['binRust', 5, -2.4, 0], ['bag', 5.8, -2.35, 60], ['tyre', 9, 2.4, 0, 0], ['tyre', 9.02, 2.42, 40, 0.16],
      ['crate', 13, 2.3, 90], ['generator', 17, -2.3, 180], ['lamp', -21, 2.62, 180], ['lamp', -9, -2.62, 0], ['lamp', 3, 2.62, 180], ['lamp', 15, -2.62, 0],
    ],
  },
  // open sky: no ground, no walls. Whoever loads this map supplies the platforms.
  moon: { facades: [], layout: [], extras: false, noGround: true, spawn: [0, 0, 0, -Math.PI / 2] },
};

export function buildLevel(assets, scene) {
  const colliders = [], shootables = [], explosives = [], pickups = [], occluders = [], removed = [];
  const { updateReflection, ground } = buildGround(assets.groundTex, scene, shootables);
  let groups = [];
  const level = {
    colliders, shootables, explosives, pickups, occluders, map: '', floorY: 0,
    spawn: { pos: new THREE.Vector3(), yaw: 0 },
    updateReflection(renderer, scn, cam, scale) { updateReflection(renderer, scn, cam, level.floorY === 0 ? scale : 0); },
    // Tears down the current map and builds another one in place; the arrays other systems hold stay the same objects.
    load(id) {
      if (level.map === id) return;
      const def = MAPS[id];
      for (const g of groups) { g.removeFromParent(); g.traverse((o) => { if (o.isMesh && o.userData.ownGeometry) o.geometry.dispose(); }); }
      colliders.length = shootables.length = explosives.length = pickups.length = occluders.length = removed.length = 0;
      groups = [];
      ground.visible = !def.noGround; level.floorY = def.noGround ? -1000 : 0;
      if (!def.noGround) shootables.push(ground);
      if (def.facades.length) {
        const g = buildFacades(assets.models.modular_factory_facade, scene, shootables, colliders, occluders, def.facades);
        g.traverse((o) => { if (o.isMesh) o.userData.ownGeometry = true; });
        groups.push(g);
      }
      groups.push(buildProps(assets.models, scene, shootables, colliders, explosives, pickups, def.layout, def.extras));
      for (const c of colliders) if (!c.wall && !c.seeThrough) occluders.push(c);
      level.spawn.pos.set(def.spawn[0], def.spawn[1], def.spawn[2]); level.spawn.yaw = def.spawn[3];
      level.map = id;
    },
    removeProp(group) {
      const entry = { group, parent: group.parent, colliders: [], shootables: [] };
      group.removeFromParent();
      for (let i = colliders.length - 1; i >= 0; i--) if (colliders[i].prop === group) entry.colliders.push(...colliders.splice(i, 1));
      for (let i = shootables.length - 1; i >= 0; i--) if (shootables[i].userData.prop === group) entry.shootables.push(...shootables.splice(i, 1));
      removed.push(entry);
    },
    restoreProps() {
      for (const e of removed) { e.parent.add(e.group); colliders.push(...e.colliders); shootables.push(...e.shootables); }
      removed.length = 0;
      for (const x of explosives) x.alive = true;
      for (const p of pickups) { p.active = true; p.group.visible = true; }
    },
  };
  level.load('yard');
  return level;
}
