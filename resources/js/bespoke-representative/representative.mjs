/*
 * Bespoke AI representative — a person's face for the live voice.
 *
 * A rigged glTF avatar (Ready Player Me conventions: Mixamo bone names,
 * the fifteen Oculus visemes and the ARKit blendshapes) is rendered head
 * and shoulders in a small transparent canvas. Nothing here makes sound:
 * the caller reads the reply with the browser's own voice and tells the
 * face what is being said — the words at the start, each word boundary
 * as it comes — and the mouth shapes are timed to that. Idle breathing,
 * blinks and small head movements run on their own; a mode (listening,
 * thinking, speaking, idle) sets the expression around them.
 *
 * Built into public/js/vendor/bespoke-representative.mjs by
 * scripts/build-representative.mjs; bespoke-ai.js imports it on demand.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const VISEMES = ['viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD', 'viseme_kk', 'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR', 'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U'];

/* Letters to mouth shapes, English. Longest match first; a vowel holds
 * longer than a consonant. Rough by design: at conversational speed the
 * eye reads open / closed / rounded / wide, not phonemes. */
const RULES = [
  ['tch', 'CH', 0.7], ['sch', 'CH', 0.7], ['ch', 'CH', 0.7], ['sh', 'CH', 0.7], ['th', 'TH', 0.6],
  ['ph', 'FF', 0.6], ['wh', 'U', 0.7], ['qu', 'kk', 0.6], ['ck', 'kk', 0.5], ['ng', 'nn', 0.6],
  ['ee', 'I', 1.0], ['ea', 'I', 1.0], ['ie', 'I', 1.0], ['ei', 'E', 1.0], ['ey', 'E', 1.0], ['ai', 'E', 1.0], ['ay', 'E', 1.0],
  ['oo', 'U', 1.0], ['ou', 'O', 1.0], ['ow', 'O', 1.0], ['oa', 'O', 1.0], ['oi', 'O', 1.0], ['oy', 'O', 1.0],
  ['au', 'O', 1.0], ['aw', 'O', 1.0], ['ue', 'U', 1.0], ['ui', 'U', 1.0],
  ['a', 'aa', 1.0], ['e', 'E', 0.9], ['i', 'I', 0.9], ['o', 'O', 1.0], ['u', 'U', 0.9], ['y', 'I', 0.7],
  ['p', 'PP', 0.5], ['b', 'PP', 0.5], ['m', 'PP', 0.6], ['f', 'FF', 0.6], ['v', 'FF', 0.6], ['w', 'U', 0.6],
  ['t', 'DD', 0.4], ['d', 'DD', 0.4], ['n', 'nn', 0.5], ['l', 'nn', 0.5], ['r', 'RR', 0.5],
  ['s', 'SS', 0.5], ['z', 'SS', 0.5], ['c', 'kk', 0.4], ['k', 'kk', 0.4], ['g', 'kk', 0.4], ['q', 'kk', 0.4], ['x', 'SS', 0.5], ['j', 'CH', 0.6],
  ['h', 'sil', 0.3],
];

const SOFT_C = /^[eiy]/;

function visemesForWord(word) {
  const w = word.toLowerCase().replace(/[^a-z0-9']/g, '');
  const out = [];
  let i = 0;
  while (i < w.length) {
    const ch = w[i];
    if (ch >= '0' && ch <= '9') { out.push(['E', 0.8]); out.push(['nn', 0.4]); i++; continue; }
    if (ch === "'") { i++; continue; }
    // A final silent e after a consonant ("make", "portal-e" never), skip.
    if (ch === 'e' && i === w.length - 1 && w.length > 2 && !/[aeiou]/.test(w[i - 1])) { i++; continue; }
    let hit = null;
    for (const rule of RULES) {
      if (w.startsWith(rule[0], i)) { hit = rule; break; }
    }
    if (!hit) { i++; continue; }
    let [seq, shape, weight] = hit;
    if ((seq === 'c') && SOFT_C.test(w.slice(i + 1))) shape = 'SS';
    if ((seq === 'g') && SOFT_C.test(w.slice(i + 1))) shape = 'CH';
    const last = out[out.length - 1];
    if (last && last[0] === shape) last[1] += weight * 0.5;
    else out.push([shape, weight]);
    i += seq.length;
  }
  if (!out.length) out.push(['aa', 0.6]);
  return out;
}

/* Words with their character offsets, as speechSynthesis reports them. */
function wordsOf(text) {
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const letters = raw.replace(/[^A-Za-z0-9']/g, '');
    if (!letters) continue;
    words.push({ at: m.index, len: raw.length, text: raw, visemes: visemesForWord(letters), pause: /[.!?,;:]$/.test(raw) });
  }
  return words;
}

/* How long a word is likely to take at rate 1, in seconds. */
function wordSeconds(word) {
  const letters = word.text.replace(/[^A-Za-z0-9]/g, '').length;
  return Math.min(0.9, Math.max(0.14, 0.055 * letters + 0.06)) + (word.pause ? 0.18 : 0);
}

export function supported() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

export class Representative {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.mode = 'idle';
    this.level = 0;
    this.ready = false;
    this.disposed = false;
    this.running = false;
    this.clock = new THREE.Clock(false);
    this.time = 0;

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'tma-bespoke__rep-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(22, 1, 0.05, 20);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd9e2ec, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.6, 1.4, 1.2);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdde8ff, 0.5);
    fill.position.set(-1.0, 0.6, 0.8);
    this.scene.add(fill);

    this.morphs = [];          // meshes with morph targets
    this.current = {};         // smoothed blendshape values
    this.target = {};          // where they are heading
    this.bones = {};
    this.focus = new THREE.Vector3(0, 1.6, 0);
    this.speech = null;
    this.blink = { next: 1.5 + Math.random() * 3, until: 0 };
    this.nod = 0;
    this.gazeX = 0;
    this.gazeY = 0;
    this.gazeNext = 1;

    this.resize = this.resize.bind(this);
    if (window.ResizeObserver) {
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(container);
    } else {
      window.addEventListener('resize', this.resize);
    }
    this.resize();
  }

  async load(url) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    if (this.disposed) return this;
    const root = gltf.scene;
    root.traverse((node) => {
      if (node.isBone) this.bones[node.name] = node;
      if (node.isMesh || node.isSkinnedMesh) {
        node.frustumCulled = false;
        if (node.morphTargetDictionary && node.morphTargetInfluences) this.morphs.push(node);
      }
    });
    this.scene.add(root);
    this.poseArms();
    root.updateMatrixWorld(true);
    this.frame();
    this.ready = true;
    return this;
  }

  bone(...names) {
    for (const n of names) {
      if (this.bones[n]) return this.bones[n];
      if (this.bones['mixamorig' + n]) return this.bones['mixamorig' + n];
    }
    return null;
  }

  /* The avatar arrives with its arms held out (A- or T-pose). Bring them
   * down to the sides; the frame shows shoulders, and arms held out read
   * as a mannequin. */
  poseArms() {
    const l = this.bone('LeftArm');
    const r = this.bone('RightArm');
    const lf = this.bone('LeftForeArm');
    const rf = this.bone('RightForeArm');
    if (l) l.rotation.z -= (this.options.armDrop ?? 1.15);
    if (r) r.rotation.z += (this.options.armDrop ?? 1.15);
    if (lf) lf.rotation.y += 0.15;
    if (rf) rf.rotation.y -= 0.15;
    this.restHead = this.bone('Head') ? this.bone('Head').rotation.clone() : null;
    this.restNeck = this.bone('Neck') ? this.bone('Neck').rotation.clone() : null;
  }

  /* Head and shoulders: the camera looks at a point between the eyes from
   * straight ahead, far enough back to show the hair and the top of the
   * shoulders in a square frame. */
  frame() {
    const head = this.bone('Head');
    const eyeL = this.bone('LeftEye');
    const eyeR = this.bone('RightEye');
    const p = new THREE.Vector3();
    if (eyeL && eyeR) {
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      eyeL.getWorldPosition(a);
      eyeR.getWorldPosition(b);
      p.addVectors(a, b).multiplyScalar(0.5);
    } else if (head) {
      head.getWorldPosition(p);
      p.y += 0.07;
    } else {
      const box = new THREE.Box3().setFromObject(this.scene);
      p.set((box.min.x + box.max.x) / 2, box.max.y - 0.12, (box.min.z + box.max.z) / 2);
    }
    this.focus.copy(p);
    this.baseDistance = this.options.distance ?? 0.92;
    this.placeCamera();
  }

  placeCamera() {
    const aspect = this.camera.aspect || 1;
    // A narrow frame needs the camera further back to keep the shoulders.
    const distance = this.baseDistance * (aspect < 1 ? 1 / Math.max(0.7, aspect) : 1);
    this.camera.position.set(this.focus.x, this.focus.y - 0.04, this.focus.z + distance);
    this.camera.lookAt(this.focus.x, this.focus.y - 0.05, this.focus.z);
  }

  resize() {
    if (this.disposed) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.focus) this.placeCamera();
    if (this.ready && !this.running) this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.clock.stop();
    this.renderer.setAnimationLoop(null);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'thinking') {
      this.gazeX = -0.35;
      this.gazeY = 0.45;
      this.gazeNext = this.time + 1.4;
    } else if (mode === 'listening') {
      this.gazeX = 0;
      this.gazeY = 0;
      this.gazeNext = this.time + 0.8;
    }
  }

  setLevel(level) {
    const l = Math.max(0, Math.min(1, level || 0));
    // The reader's voice: an attentive dip of the head now and then.
    if (this.mode === 'listening' && l > 0.45 && this.nod < 0.2 && Math.random() < 0.06) this.nod = 1;
    this.level = l;
  }

  /* ── Lip sync ─────────────────────────────────────────────────── */

  speakStart(text) {
    const words = wordsOf(text);
    let t = this.time + 0.05;
    for (const w of words) {
      w.start = t;
      w.duration = wordSeconds(w);
      t += w.duration;
    }
    this.speech = { text, words, index: -1 };
  }

  /* A word boundary from the voice: that word starts now, whatever the
   * estimate said, and the ones after it are re-timed from here. */
  speakBoundary(charIndex) {
    const s = this.speech;
    if (!s || !s.words.length) return;
    let i = s.words.findIndex((w) => charIndex >= w.at && charIndex < w.at + w.len);
    if (i < 0) i = s.words.findIndex((w) => w.at >= charIndex);
    if (i < 0) return;
    let t = this.time;
    for (let k = i; k < s.words.length; k++) {
      s.words[k].start = t;
      t += s.words[k].duration;
    }
    if (i % 3 === 0 && this.nod < 0.3) this.nod = 0.6;
  }

  speakEnd() {
    this.speech = null;
  }

  currentViseme() {
    const s = this.speech;
    if (!s) return null;
    const now = this.time;
    for (const w of s.words) {
      if (now < w.start || now >= w.start + w.duration) continue;
      const pauseShare = w.pause ? 0.18 / w.duration : 0;
      const local = (now - w.start) / (w.duration * (1 - pauseShare));
      if (local >= 1) return null;
      const total = w.visemes.reduce((n, v) => n + v[1], 0);
      let acc = 0;
      for (const [shape, weight] of w.visemes) {
        acc += weight / total;
        if (local < acc) return shape;
      }
      return null;
    }
    return null;
  }

  /* ── Per frame ─────────────────────────────────────────────────── */

  tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    const t = this.time;
    const target = this.target;
    for (const k of Object.keys(target)) target[k] = 0;

    // Mouth.
    const shape = this.currentViseme();
    if (shape && shape !== 'sil') {
      const strength = shape === 'aa' || shape === 'O' ? 0.85 : shape === 'E' || shape === 'I' || shape === 'U' ? 0.75 : 0.6;
      target['viseme_' + shape] = strength;
    }
    const speaking = this.mode === 'speaking';

    // Expression by mode.
    const smile = this.mode === 'listening' ? 0.28 : speaking ? 0.16 : this.mode === 'thinking' ? 0.08 : 0.2;
    target.mouthSmileLeft = smile;
    target.mouthSmileRight = smile;
    target.browInnerUp = this.mode === 'listening' ? 0.22 : this.mode === 'thinking' ? 0.3 : 0.06;
    if (this.mode === 'thinking') {
      target.mouthPressLeft = 0.25;
      target.mouthPressRight = 0.25;
    }

    // Blink.
    if (t >= this.blink.next) {
      this.blink.until = t + 0.14;
      this.blink.next = t + 2.2 + Math.random() * 3.4;
    }
    if (t < this.blink.until) {
      const phase = 1 - Math.abs((this.blink.until - t) / 0.14 - 0.5) * 2;
      target.eyeBlinkLeft = phase;
      target.eyeBlinkRight = phase;
    }

    // Gaze: mostly the reader, wandering a little; up and away while thinking.
    if (t >= this.gazeNext) {
      if (this.mode === 'thinking') {
        this.gazeX = -0.3 + Math.random() * 0.2;
        this.gazeY = 0.35 + Math.random() * 0.2;
      } else {
        this.gazeX = (Math.random() - 0.5) * 0.18;
        this.gazeY = (Math.random() - 0.5) * 0.1;
      }
      this.gazeNext = t + 1.2 + Math.random() * 2.4;
    }
    const gx = this.gazeX;
    const gy = this.gazeY;
    if (gy > 0) { target.eyeLookUpLeft = gy; target.eyeLookUpRight = gy; }
    else { target.eyeLookDownLeft = -gy; target.eyeLookDownRight = -gy; }
    if (gx > 0) { target.eyeLookOutLeft = gx; target.eyeLookInRight = gx; }
    else { target.eyeLookInLeft = -gx; target.eyeLookOutRight = -gx; }

    // Smooth every blendshape toward its target; the mouth moves faster
    // than the brows.
    for (const k of Object.keys(target)) {
      const tau = k.indexOf('viseme_') === 0 ? 0.045 : k.indexOf('eyeBlink') === 0 ? 0.03 : 0.16;
      const a = 1 - Math.exp(-dt / tau);
      const cur = this.current[k] || 0;
      const next = cur + (target[k] - cur) * a;
      this.current[k] = Math.abs(next) < 0.001 ? 0 : next;
    }
    for (const mesh of this.morphs) {
      const dict = mesh.morphTargetDictionary;
      const inf = mesh.morphTargetInfluences;
      for (const k of Object.keys(this.current)) {
        const idx = dict[k];
        if (idx !== undefined) inf[idx] = this.current[k];
      }
    }

    // Head: breathing, a slow drift, an occasional nod; a listener leans
    // in a touch, a thinker tilts.
    const head = this.bone('Head');
    const neck = this.bone('Neck');
    this.nod = Math.max(0, this.nod - dt * 2.2);
    if (head && this.restHead) {
      const drift = 0.02 * Math.sin(t * 0.37) + 0.012 * Math.sin(t * 0.91 + 1.3);
      const sway = 0.03 * Math.sin(t * 0.23 + 0.7) + 0.01 * Math.sin(t * 1.07);
      const tilt = this.mode === 'thinking' ? 0.07 : this.mode === 'listening' ? -0.03 : 0;
      const lean = this.mode === 'listening' ? 0.04 : 0;
      const talk = speaking ? 0.012 * Math.sin(t * 5.3) : 0;
      const nod = Math.sin(this.nod * Math.PI) * 0.05;
      head.rotation.x = this.restHead.x + drift + lean + talk + nod;
      head.rotation.y = this.restHead.y + sway;
      head.rotation.z = this.restHead.z + tilt + 0.008 * Math.sin(t * 0.53);
    }
    if (neck && this.restNeck) {
      neck.rotation.x = this.restNeck.x + 0.006 * Math.sin(t * 1.6);
    }

    this.renderer.render(this.scene, this.camera);
  }

  /* Current mouth and eye values, for tests. */
  debug() {
    const out = {};
    for (const k of Object.keys(this.current)) if (this.current[k] > 0.02) out[k] = Math.round(this.current[k] * 100) / 100;
    return { mode: this.mode, ready: this.ready, running: this.running, speaking: !!this.speech, shapes: out };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    if (this.observer) this.observer.disconnect();
    else window.removeEventListener('resize', this.resize);
    this.scene.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      for (const m of mats) {
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    });
    if (this.scene.environment) this.scene.environment.dispose();
    this.renderer.dispose();
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}

/* Make one, load the model, start it. */
export async function mount(container, options = {}) {
  const rep = new Representative(container, options);
  try {
    await rep.load(options.url);
  } catch (e) {
    rep.dispose();
    throw e;
  }
  rep.start();
  return rep;
}

export { visemesForWord, wordsOf };
