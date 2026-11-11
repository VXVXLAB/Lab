// Asset loading: GLB models (meshopt + WebP), ground textures and the HDRI sky.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const MODEL_IDS = [
  'service_pistol', 'modular_factory_facade', 'concrete_road_barrier', 'Barrel_01', 'barrel_03',
  'covered_car', 'modular_chainlink_fence', 'street_lamp_01', 'wooden_military_crate',
  'propane_tank', 'old_tyre', 'portable_generator', 'ammo_box', 'metal_trash_can',
  'utility_box_01', 'cardboard_box_01', 'trashbag',
];
const SKY_URL = 'assets/sky/kloofendal_48d_partly_cloudy_puresky_2k.hdr';
// Some hosts only serve web file types. Setting window.BRICKYARD_ASSETS = 'web' before the game loads makes it
// read the same assets repacked as JSON glTF + WebP and a base64-wrapped HDRI from assets/web/.
const WEB_PACK = globalThis.BRICKYARD_ASSETS === 'web';

// Radiance above this is treated as "the sun" and moved out of the environment map into a
// real directional light, so that it can cast shadows instead of lighting shadowed areas.
const SUN_CLAMP = 24;
const BACKGROUND_CLAMP = 900;

export async function loadAll(renderer, onProgress) {
  const total = MODEL_IDS.length + 4;
  let done = 0;
  const tick = (v) => { done++; onProgress(done / total); return v; };

  const gltf = new GLTFLoader();
  // The meshopt decoder is WebAssembly; the web pack is stored uncompressed so that it is never needed there.
  if (!WEB_PACK) gltf.setMeshoptDecoder((await import('three/addons/libs/meshopt_decoder.module.js')).MeshoptDecoder);
  const loadModel = WEB_PACK
    ? (id) => fetch(`assets/web/${id}/model.json`).then((r) => { if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`); return r.json(); })
      .then((j) => gltf.parseAsync(packGlb(j.gltf, j.bin), `assets/web/${id}/`))
    : (id) => gltf.loadAsync(`assets/models/${id}.glb`);
  const texLoader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const models = {};
  const modelJobs = MODEL_IDS.map((id) =>
    loadModel(id).then((g) => {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
            if (m[k]) m[k].anisotropy = aniso;
          }
        }
      });
      g.scene.updateMatrixWorld(true);
      models[id] = g.scene;
      tick();
    }));

  const groundTex = {};
  const texJobs = ['diff', 'nor', 'arm'].map((k) =>
    texLoader.loadAsync(`assets/textures/asphalt_02_${k}.webp`).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      if (k === 'diff') t.colorSpace = THREE.SRGBColorSpace;
      groundTex[k] = t;
      tick();
    }));

  const hdrLoader = new HDRLoader().setDataType(THREE.FloatType);
  const skyJob = (WEB_PACK
    ? fetch('assets/web/sky.json').then((r) => r.json()).then((j) => {
      const bytes = Uint8Array.from(atob(j.hdr), (c) => c.charCodeAt(0));
      const d = hdrLoader.parse(bytes.buffer);
      return { image: { width: d.width, height: d.height, data: d.data }, dispose() {} };
    })
    : hdrLoader.loadAsync(SKY_URL)).then((t) => tick(t));

  const [hdr] = await Promise.all([skyJob, ...modelJobs, ...texJobs]);
  const sky = processSky(renderer, hdr);
  return { models, groundTex, sky };
}

// Assembles a binary glTF in memory from its JSON and base64 buffer, so nothing has to be fetched from a data: URI.
function packGlb(json, base64) {
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(text.length / 4) * 4, binLen = Math.ceil(bin.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + binLen).fill(0x20, 20, 20 + jsonLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4E4F534A, true); out.set(text, 20);
  dv.setUint32(20 + jsonLen, binLen, true); dv.setUint32(24 + jsonLen, 0x004E4942, true); out.set(bin, 28 + jsonLen);
  return out.buffer;
}

// Splits the HDRI into: a background texture, a sun-less environment for image based lighting,
// and the measured direction / colour / irradiance of the sun.
function processSky(renderer, hdr) {
  const { width: w, height: h, data } = hdr.image;
  const stride = data.length / (w * h);
  const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];

  const dir = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const sunE = new THREE.Vector3();
  const pixelDir = (x, y, out) => {
    const u = (x + 0.5) / w, v = 1 - (y + 0.5) / h; // texture is uploaded with flipY
    const lat = (v - 0.5) * Math.PI, phi = (u - 0.5) * 2 * Math.PI;
    return out.set(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat));
  };

  const env = new Uint16Array(w * h * 4);
  const bg = new Uint16Array(w * h * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  const one = toHalf(1);
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const solid = (2 * Math.PI / w) * (Math.PI / h) * Math.cos(lat);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * stride, o = (y * w + x) * 4;
      const L = lum(i);
      const k = L > SUN_CLAMP ? SUN_CLAMP / L : 1;
      if (k < 1) {
        const excess = (1 - k) * solid;
        sunE.x += data[i] * excess; sunE.y += data[i + 1] * excess; sunE.z += data[i + 2] * excess;
        sunDir.addScaledVector(pixelDir(x, y, dir), (L - SUN_CLAMP) * solid);
      }
      const kb = L > BACKGROUND_CLAMP ? BACKGROUND_CLAMP / L : 1;
      for (let c = 0; c < 3; c++) {
        env[o + c] = toHalf(data[i + c] * k);
        bg[o + c] = toHalf(data[i + c] * kb);
      }
      env[o + 3] = bg[o + 3] = one;
    }
  }
  sunDir.normalize();

  const mk = (arr) => {
    const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.LinearSRGBColorSpace;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.RepeatWrapping;
    t.flipY = true;
    t.needsUpdate = true;
    return t;
  };
  const background = mk(bg);
  const envEquirect = mk(env);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(envEquirect).texture;
  pmrem.dispose();
  envEquirect.dispose();
  hdr.dispose();

  const irradiance = Math.max(sunE.x, sunE.y, sunE.z);
  const sunColor = new THREE.Color(sunE.x / irradiance, sunE.y / irradiance, sunE.z / irradiance);
  return { background, environment, sunDir, sunColor, sunIrradiance: irradiance };
}
