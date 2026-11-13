// Renderer and post-processing chain:
// world -> GTAO -> first-person weapon overlay -> bloom -> tone mapping -> lens/film pass.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const QUALITY = {
  low: { label: 'LOW', maxDpr: 1, pixelRatio: 0.75, msaa: 0, ao: false, shadow: 2048, reflection: 0 },
  medium: { label: 'MEDIUM', maxDpr: 1, pixelRatio: 1, msaa: 4, ao: true, aoSamples: 8, shadow: 2048, reflection: 0.5 },
  high: { label: 'HIGH', maxDpr: 2, pixelRatio: 1, msaa: 4, ao: true, aoSamples: 16, shadow: 4096, reflection: 1 },
};

// Draws a second scene (the weapon) on top of the already shaded world with a fresh depth buffer,
// so the gun never clips into walls and keeps its own field of view.
class OverlayPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}

const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uDamage: { value: 0 },
    uGrain: { value: 0.018 },
    uVignette: { value: 0.32 },
    uAberration: { value: 0.00012 },
    uSharpen: { value: 0.55 },
    uGrade: { value: new THREE.Vector3(1, 1, 0) }, // contrast, saturation, split-toning amount
    uFade: { value: 0 },
    uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }, // screen uv + visibility
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uDamage, uGrain, uVignette, uAberration, uSharpen, uFade;
    uniform vec3 uGrade;
    uniform vec2 uTexel;
    uniform vec3 uSun;
    uniform float uAspect;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // lateral chromatic aberration, growing towards the frame edge
      vec2 off = c * r2 * uAberration * 18.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // unsharp mask
      vec3 blur = (texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.)).rgb + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.)).rgb
                 + texture2D(tDiffuse, vUv + vec2(0., uTexel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0., uTexel.y)).rgb) * 0.25;
      // unsharp mask on luminance only, clamped so bright lanterns do not ring
      float sharp = clamp(dot(col - blur, vec3(0.3, 0.6, 0.1)), -0.12, 0.12);
      col += sharp * uSharpen * 1.6;
      // grade: contrast, saturation, cool shadows / warm highlights
      float gl = dot(col, vec3(0.3, 0.6, 0.1));
      col = mix(vec3(gl), col, uGrade.y);
      col = (col - 0.5) * uGrade.x + 0.5;
      col += uGrade.z * (vec3(-0.016, 0.0, 0.03) * (1.0 - gl) + vec3(0.028, 0.01, -0.02) * gl);
      col = max(col, 0.0);
      // vignette
      float vig = smoothstep(0.95, 0.25, length(c * vec2(1.0, 0.82)) );
      col *= mix(1.0 - uVignette, 1.0, vig);
      // sun glare: veil, anamorphic streak and a few lens ghosts
      if (uSun.z > 0.001) {
        vec2 sp = uSun.xy - 0.5, d = (c - sp) * vec2(uAspect, 1.0);
        float r = length(d);
        vec3 warm = vec3(1.0, 0.86, 0.66);
        vec3 flare = warm * (0.22 * exp(-r * 3.2) + 0.5 * exp(-r * 18.0));
        flare += warm * 0.16 * exp(-abs(d.y) * 55.0) * exp(-abs(d.x) * 1.7);
        for (int i = 0; i < 4; i++) {
          float fi = float(i);
          vec2 gp = -sp * (0.35 + fi * 0.42);
          float gr = length((c - gp) * vec2(uAspect, 1.0)), gs = 0.035 + fi * 0.022;
          flare += vec3(0.5 + 0.2 * fi, 0.75, 1.0 - 0.2 * fi) * 0.035 * smoothstep(gs, gs * 0.72, gr) * (0.4 + 0.6 * smoothstep(gs * 0.3, gs, gr));
        }
        col += flare * uSun.z;
      }
      // damage: red frame creeping in from the edges
      float edge = smoothstep(0.30, 0.82, length(c * vec2(1.05, 1.3)));
      col = mix(col, vec3(0.32, 0.0, 0.0) + col * vec3(0.8, 0.2, 0.15), edge * uDamage * 0.85);
      col = mix(col, vec3(dot(col, vec3(0.3, 0.6, 0.1))), uDamage * 0.3);
      // film grain, stronger in the shadows
      float n = hash(gl_FragCoord.xy + fract(uTime) * 311.7) - 0.5;
      float l = dot(col, vec3(0.3, 0.6, 0.1));
      col += n * uGrain * (1.0 - 0.6 * l);
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createRenderer(canvas, scene, camera, weaponScene, weaponCamera) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;

  let composer, gtao, bloom, lens, quality;
  const hidden = [];

  function build(q) {
    quality = q;
    const pr = Math.min(window.devicePixelRatio || 1, q.maxDpr) * q.pixelRatio;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); }
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));

    gtao = null;
    if (q.ao) {
      gtao = new GTAOPass(scene, camera, size.x, size.y);
      gtao.blendIntensity = 1;
      gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.6, thickness: 1.2, scale: 1.15, samples: q.aoSamples, distanceFallOff: 1, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 16 });
      // Alpha-tested / transparent geometry would write solid quads into the AO depth buffer.
      const baseRender = gtao.render.bind(gtao);
      gtao.render = (...args) => {
        hidden.length = 0;
        scene.traverse((o) => { if (o.visible && o.userData.noAO) { o.visible = false; hidden.push(o); } });
        baseRender(...args);
        for (const o of hidden) o.visible = true;
      };
      composer.addPass(gtao);
    }

    composer.addPass(new OverlayPass(weaponScene, weaponCamera));
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.5, 1.15);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const oldLens = lens;
    lens = new ShaderPass(LensShader);
    if (oldLens) for (const k of ['uDamage', 'uFade', 'uGrade']) lens.uniforms[k].value = oldLens.uniforms[k].value;
    lens.uniforms.uAspect.value = size.x / size.y;
    lens.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
    composer.addPass(lens);
    api.lens = lens.uniforms;
  }

  const api = {
    renderer,
    lens: null,
    get quality() { return quality; },
    setQuality(q) { build(q); },
    resize() { build(quality); },
    render(dt, time) {
      lens.uniforms.uTime.value = time;
      renderer.info.reset();
      composer.render(dt);
    },
  };
  return api;
}
