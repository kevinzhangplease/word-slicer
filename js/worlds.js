// Worlds: what a theme is made of. Each world has a block material and shape (tofu, granite, ice ...), a ground
// and scenery. Everything is generated at runtime (canvas textures + primitives), nothing to download.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TILE } from './constants.js';
import { hexToRgb, mulberry32, clamp } from './lighting.js';

export const GROUND_Y = 0; // the ground is the surface the blocks sit on

// ---------- tileable value noise ----------
const hash = (x, y, s) => { const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
const sm = (t) => t * t * (3 - 2 * t);
export function vnoise(u, v, px, py, s) {
  const x = u * px; const y = v * py;
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const fx = sm(x - x0); const fy = sm(y - y0);
  const a = hash(x0 % px, y0 % py, s); const b = hash((x0 + 1) % px, y0 % py, s);
  const c = hash(x0 % px, (y0 + 1) % py, s); const d = hash((x0 + 1) % px, (y0 + 1) % py, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm(u, v, p, oct, s) {
  let sum = 0; let amp = 0.5; let tot = 0; let f = p;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise(u, v, f, f, s + i * 17); tot += amp; amp *= 0.5; f *= 2; }
  return sum / tot;
}
const step = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const rgb = (hex) => hexToRgb(hex);
const mix3 = (a, b, t, o) => { o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t); return o; };

function field(w, h, fn) {
  const f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = fn(x / w, y / h);
  return f;
}

// colour canvas from fn(u, v, out) that writes [r, g, b] (0..255) into out
function paintPx(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const img = x.createImageData(w, h);
  const o = [0, 0, 0];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    fn(i / w, j / h, o);
    const k = (j * w + i) * 4;
    img.data[k] = o[0]; img.data[k + 1] = o[1]; img.data[k + 2] = o[2]; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

// tangent-space normal map from a height field (higher = raised), wrapping at the edges so it tiles
function normalCanvas(f, w, h, k) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const img = x.createImageData(w, h);
  const at = (i, j) => f[((j + h) % h) * w + ((i + w) % w)];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let nx = -(at(i + 1, j) - at(i - 1, j)) * 0.5 * k;
    let ny = (at(i, j + 1) - at(i, j - 1)) * 0.5 * k;
    const l = Math.hypot(nx, ny, 1);
    nx /= l; ny /= l;
    const p = (j * w + i) * 4;
    img.data[p] = (nx * 0.5 + 0.5) * 255; img.data[p + 1] = (ny * 0.5 + 0.5) * 255; img.data[p + 2] = (0.5 / l + 0.5) * 255; img.data[p + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

const canvas2d = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };

// ---------- block looks ----------
// height(u,v) -> number (raised = high); colour(u,v,out) fills out; amp = how strong the relief is.
// radius/seg/jitter shape the block itself; mat/paint are material settings for plain and painted blocks.
const BASE = (b) => rgb(b);
export const LOOKS = {
  tofu: {
    radius: 0.02, seg: 4, jitter: 0.0012,
    mat: { roughness: 0.78, sheen: 0.6, sheenRoughness: 0.5, sheenColor: '#fff4dc' },
    paint: { roughness: 0.7, sheen: 0.5, sheenRoughness: 0.5, sheenColor: '#ffffff' },
    amp: 1.4,
    height: (u, v) => 0.5 * fbm(u, v, 6, 3, 2) - 0.9 * step(0.74, 0.99, vnoise(u, v, 48, 48, 5)) + 0.12 * vnoise(u, v, 120, 120, 8),
    colour: (u, v, o, b) => {
      const pit = step(0.74, 0.95, vnoise(u, v, 48, 48, 5));
      mix3(b, [b[0] * 0.93, b[1] * 0.91, b[2] * 0.86], fbm(u, v, 5, 3, 4), o);
      mix3(o, [214, 196, 156], pit * 0.85, o);
    },
  },
  rock: {
    radius: 0.012, seg: 7, jitter: 0.0024,
    mat: { roughness: 0.96 },
    paint: { roughness: 0.92 },
    amp: 3.2,
    height: (u, v) => 0.7 * fbm(u, v, 5, 5, 3) + 0.3 * fbm(u, v, 22, 3, 9) + 0.12 * hash(Math.floor(u * 160), Math.floor(v * 160), 2),
    colour: (u, v, o, b) => {
      const n = fbm(u, v, 7, 4, 6);
      mix3([b[0] * 0.72, b[1] * 0.72, b[2] * 0.74], [Math.min(255, b[0] * 1.2), Math.min(255, b[1] * 1.2), Math.min(255, b[2] * 1.18)], n, o);
      const warm = step(0.62, 0.8, fbm(u, v, 3, 3, 11));
      mix3(o, [150, 134, 116], warm * 0.45, o);
      const moss = step(0.7, 0.86, fbm(u, v, 4, 4, 14));
      mix3(o, [92, 118, 62], moss * 0.5, o);
      const sp = hash(Math.floor(u * 160), Math.floor(v * 160), 4);
      if (sp > 0.93) mix3(o, [245, 245, 240], 0.5, o); else if (sp < 0.05) mix3(o, [40, 42, 46], 0.5, o);
    },
  },
  ice: {
    radius: 0.007, seg: 2, jitter: 0,
    mat: { roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.2, ior: 1.31, emissive: '#6fc4ee', emissiveIntensity: 0.1 },
    paint: { roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.0 },
    amp: 0.9,
    height: (u, v) => { const r = Math.abs(fbm(u, v, 3, 3, 7) - 0.5) * 2; return step(0, 0.07, r) * 0.6 + 0.2 * fbm(u, v, 16, 2, 3); },
    colour: (u, v, o, b) => {
      const frost = Math.pow(fbm(u, v, 3, 4, 5), 2.2);
      mix3(b, [236, 248, 255], frost * 0.8, o);
      const r = Math.abs(fbm(u, v, 3, 3, 7) - 0.5) * 2;
      mix3(o, [255, 255, 255], (1 - step(0, 0.05, r)) * 0.8, o);
      const e = Math.min(u, 1 - u, v, 1 - v);
      mix3(o, [250, 253, 255], (1 - step(0, 0.1, e)) * 0.7, o);
    },
  },
  sand: {
    radius: 0.016, seg: 4, jitter: 0.0018,
    mat: { roughness: 1 },
    paint: { roughness: 0.95 },
    amp: 3.4,
    height: (u, v) => 0.5 * hash(Math.floor(u * 200), Math.floor(v * 200), 3) + 0.5 * fbm(u, v, 10, 3, 4),
    colour: (u, v, o, b) => {
      mix3([b[0] * 0.88, b[1] * 0.86, b[2] * 0.8], [Math.min(255, b[0] * 1.06), Math.min(255, b[1] * 1.05), Math.min(255, b[2] * 1.04)], fbm(u, v, 8, 3, 6), o);
      const sp = hash(Math.floor(u * 200), Math.floor(v * 200), 9);
      if (sp > 0.9) mix3(o, [250, 238, 205], 0.55, o); else if (sp < 0.1) mix3(o, [150, 118, 70], 0.5, o);
    },
  },
  gummy: {
    radius: 0.022, seg: 5, jitter: 0,
    mat: { roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.3 },
    paint: { roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.3 },
    amp: 1.1,
    height: (u, v) => step(0.8, 1, hash(Math.floor(u * 90), Math.floor(v * 90), 1)) * 0.9 + 0.3 * fbm(u, v, 5, 2, 8),
    colour: (u, v, o, b) => {
      mix3(b, [Math.min(255, b[0] * 1.04), Math.min(255, b[1] * 1.04), Math.min(255, b[2] * 0.96)], fbm(u, v, 4, 3, 3), o);
      const sp = hash(Math.floor(u * 90), Math.floor(v * 90), 1);
      if (sp > 0.8) mix3(o, [255, 255, 255], 0.65, o);
    },
  },
  metal: {
    radius: 0.007, seg: 2, jitter: 0,
    mat: { roughness: 0.38, metalness: 0.9, envMapIntensity: 1.5 },
    paint: { roughness: 0.38, metalness: 0.45, envMapIntensity: 1.2 },
    amp: 1.0,
    height: (u, v) => vnoise(u, v, 3, 220, 4) * 0.7 + vnoise(u, v, 2, 90, 9) * 0.3,
    colour: (u, v, o, b) => {
      const s = vnoise(u, v, 3, 220, 4);
      const k = 0.88 + 0.22 * s;
      o[0] = Math.min(255, b[0] * k); o[1] = Math.min(255, b[1] * k); o[2] = Math.min(255, b[2] * k);
    },
  },
};

// Everything a block theme needs: colour + normal map, the block geometries, and the face-grain field.
export function blockKit(scene, theme) {
  const look = LOOKS[theme.block.look];
  if (!look) return null;
  const b = BASE(theme.block.base);
  const N = 256;
  const hf = field(N, N, look.height);
  const mapC = paintPx(N, N, (u, v, o) => look.colour(u, v, o, b));
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = scene.maxAniso;
    return t;
  };
  // paint keeps the surface texture: the colour map as greyscale, centred so it only shades the paint
  const [pc, px] = canvas2d(N, N);
  px.drawImage(mapC, 0, 0);
  const id = px.getImageData(0, 0, N, N);
  let avg = 0;
  for (let i = 0; i < N * N; i++) avg += (id.data[i * 4] * 0.3 + id.data[i * 4 + 1] * 0.59 + id.data[i * 4 + 2] * 0.11) / (N * N);
  for (let i = 0; i < N * N; i++) {
    const l = id.data[i * 4] * 0.3 + id.data[i * 4 + 1] * 0.59 + id.data[i * 4 + 2] * 0.11;
    const g = clamp(246 + (l - avg) * 1.1, 0, 255);
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = g;
  }
  px.putImageData(id, 0, 0);
  const kit = {
    look,
    paintMap: tex(pc, true),
    map: tex(mapC, true),
    normal: tex(normalCanvas(hf, N, N, look.amp * 2.2), false),
    geos: [],
    // relief for the carved front face (it needs its own normal map, so the grain is baked into it)
    grain: (FW, FH) => {
      const f = field(FW, FH, (u, v) => look.height(u * 0.7, v * 0.7));
      return { f, amp: look.amp * 0.12 };
    },
  };
  const nVar = look.jitter ? 4 : 1;
  for (let i = 0; i < nVar; i++) kit.geos.push(blockGeo(look, i));
  return kit;
}

function blockGeo(look, variant) {
  const w = TILE.w * 0.992; const h = TILE.h * 0.992; const d = TILE.d * 0.992;
  const g = new RoundedBoxGeometry(w, h, d, look.seg, look.radius);
  if (!look.jitter) return g;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const A = look.jitter;
  const f1 = variant * 1.7 + 0.3; const f2 = variant * 2.9 + 1.1; const f3 = variant * 0.9 + 2.3;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
    const taper = clamp((d / 2 - z) / 0.03, 0, 1); // the carved front face stays flat
    const n = 0.55 * Math.sin(x * 53 + y * 37 + f1) * Math.sin(z * 47 + y * 29 + f2) + 0.45 * Math.sin(x * 91 + z * 73 + f3);
    const o = A * n * taper;
    pos.setXYZ(i, x + nor.getX(i) * o, y + nor.getY(i) * o, z + nor.getZ(i) * o);
  }
  pos.needsUpdate = true;
  return g;
}

// ---------- ground surfaces ----------
// A surface spec: { color, map (canvas), normal (canvas), scale (metres per texture repeat; omit to stretch once),
// normalScale, roughness, metalness, clearcoat, clearcoatRoughness }.
const TAU = Math.PI * 2;
const R = (a, s = 1) => { const f = mulberry32(a); return () => f() * s; };

// generic ground-like texture: colour from two ramps + fine speckle; relief from the same noise
function earth({ size = 512, a, b, p = 6, oct = 4, speckle = 0, speck = '#ffffff', fine = 0, seed = 3, relief = 1.5, reliefFn }) {
  const A = rgb(a); const B = rgb(b); const SP = rgb(speck);
  const hf = field(size, size, reliefFn || ((u, v) => fbm(u, v, p, oct, seed) + fine * vnoise(u, v, size / 2, size / 2, seed + 4)));
  const map = paintPx(size, size, (u, v, o) => {
    const i = Math.min(size - 1, Math.floor(v * size)) * size + Math.min(size - 1, Math.floor(u * size));
    mix3(A, B, clamp(hf[i], 0, 1), o);
    if (speckle) { const s = hash(Math.floor(u * size), Math.floor(v * size), seed + 9); if (s > 1 - speckle) mix3(o, SP, 0.6, o); }
  });
  return { map, normal: normalCanvas(hf, size, size, relief * 3) };
}

export function surfaces(S, theme) {
  const w = WORLDS[theme.world] || WORLDS.contrast;
  return w.surfaces(S, theme);
}

const WORLDS = {
  contrast: {
    surfaces: (S, t) => ({
      ground: { color: '#c4c4c4', roughness: 0.6 },
    }),
  },

  wood: {
    surfaces: (S, t) => {
      // a plank floor
      const [fc, x] = canvas2d(1024, 1024);
      const rnd = mulberry32(21);
      for (let i = 0; i < 6; i++) {
        const h = 1024 / 6;
        const pl = S.woodCanvas(1024, 256, ['#bd8f58', '#b5854e', '#c3965f', '#ad7c45'][i % 4], '#6b3f17', 30 + i, 40);
        x.drawImage(pl, 0, i * h, 1024, h);
        x.fillStyle = 'rgba(70,40,10,.35)'; x.fillRect(0, i * h, 1024, 3);
        const cut = rnd() * 900 + 60;
        x.fillRect(cut, i * h, 3, h);
      }
      return {
        ground: { map: fc, scale: 2.2, roughness: 0.7, color: '#ffffff' },
      };
    },
  },

  kitchen: {
    surfaces: (S, t) => {
      // a maple butcher-block counter with knife marks
      const top = S.woodCanvas(1024, 512, '#dcb77f', '#9a6b30', 17, 200);
      const x = top.getContext('2d');
      const rnd = mulberry32(41);
      x.lineCap = 'round';
      for (let i = 0; i < 160; i++) {
        const px = rnd() * 1024; const py = rnd() * 512; const len = 20 + rnd() * 120; const a = (rnd() - 0.5) * 1.2 + (rnd() < 0.5 ? 0 : Math.PI / 2);
        x.strokeStyle = rnd() < 0.5 ? 'rgba(255,240,210,.22)' : 'rgba(80,45,15,.2)';
        x.lineWidth = 0.7 + rnd() * 1.2;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); x.stroke();
      }
      return {
        ground: { map: top, scale: 1.5, roughness: 0.6, color: '#ffffff' },
      };
    },
  },

  garden: {
    surfaces: (S, t) => {
      const meadow = earth({ a: '#3f6a26', b: '#8db84e', p: 7, oct: 5, speckle: 0.05, speck: '#c8e08a', fine: 0.4, seed: 5, relief: 1.2 });
      return {
        ground: { ...meadow, scale: 2.6, roughness: 1, color: '#ffffff' },
      };
    },
  },

  snow: {
    surfaces: (S, t) => {
      const drift = earth({ a: '#d5e3f2', b: '#ffffff', p: 4, oct: 5, speckle: 0.012, speck: '#ffffff', fine: 0.15, seed: 6, relief: 1.1 });
      return {
        ground: { ...drift, scale: 3.2, roughness: 0.85, color: '#ffffff' },
      };
    },
  },

  candy: {
    surfaces: (S, t) => {
      // pink frosting with sprinkles
      const hf = field(512, 512, (u, v) => fbm(u, v, 3, 4, 3));
      const map = paintPx(512, 512, (u, v, o) => {
        const i = Math.floor(v * 512) * 512 + Math.floor(u * 512);
        mix3([255, 190, 218], [255, 222, 238], hf[i], o);
      });
      const mx = map.getContext('2d');
      const rnd = mulberry32(9);
      const cols = ['#ff3d8b', '#14b8a6', '#ffd23d', '#7a5cff', '#ffffff', '#ff8a1f'];
      mx.lineCap = 'round';
      for (let i = 0; i < 220; i++) {
        const px = rnd() * 512; const py = rnd() * 512; const a = rnd() * TAU;
        mx.strokeStyle = cols[i % cols.length]; mx.lineWidth = 4.5;
        mx.beginPath(); mx.moveTo(px, py); mx.lineTo(px + Math.cos(a) * 11, py + Math.sin(a) * 11); mx.stroke();
      }
      return {
        ground: { map, normal: normalCanvas(hf, 512, 512, 3), scale: 1.6, roughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.3, color: '#ffffff' },
      };
    },
  },

  beach: {
    surfaces: (S, t) => {
      const ripple = (wet = false) => {
        const hf = field(512, 512, (u, v) => {
          const w = v * 7 + 1.4 * fbm(u, v, 3, 3, 8);
          return (Math.sin(w * TAU) * 0.5 + 0.5) * (wet ? 0.35 : 1) * 0.6 + 0.4 * hash(Math.floor(u * 256), Math.floor(v * 256), 3) * 0.3 + 0.2 * fbm(u, v, 9, 3, 4);
        });
        const a = wet ? [186, 156, 104] : [232, 208, 156]; const b = wet ? [206, 176, 122] : [246, 226, 178];
        const map = paintPx(512, 512, (u, v, o) => {
          const i = Math.floor(v * 512) * 512 + Math.floor(u * 512);
          mix3(a, b, clamp(hf[i], 0, 1), o);
          const sp = hash(Math.floor(u * 512), Math.floor(v * 512), 5);
          if (sp > 0.93) mix3(o, [255, 244, 214], 0.5, o); else if (sp < 0.06) mix3(o, [140, 108, 64], 0.5, o);
        });
        return { map, normal: normalCanvas(hf, 512, 512, wet ? 2.4 : 4) };
      };
      return {
        ground: { ...ripple(false), scale: 1.8, roughness: 1, color: '#ffffff' },
      };
    },
  },

  moon: {
    surfaces: (S, t) => {
      // regolith: craters drawn as bowls with raised rims, plus fine dust
      const N = 512;
      const [hc, hx] = canvas2d(N, N);
      hx.fillStyle = '#808080'; hx.fillRect(0, 0, N, N);
      const rnd = mulberry32(77);
      for (let i = 0; i < 26; i++) {
        const r = 14 + rnd() * rnd() * 70; const cx = rnd() * N; const cy = rnd() * N;
        for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
          const g = hx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r * 1.35);
          g.addColorStop(0, 'rgba(0,0,0,.65)'); g.addColorStop(0.55, 'rgba(0,0,0,.4)'); g.addColorStop(0.75, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          hx.fillStyle = g; hx.beginPath(); hx.arc(cx + ox, cy + oy, r * 1.35, 0, TAU); hx.fill();
        }
      }
      const img = hx.getImageData(0, 0, N, N).data;
      const hf = field(N, N, (u, v) => img[(Math.floor(v * N) * N + Math.floor(u * N)) * 4] / 255 + 0.12 * fbm(u, v, 24, 3, 5) + 0.05 * vnoise(u, v, 256, 256, 3));
      const map = paintPx(N, N, (u, v, o) => {
        const k = hf[Math.floor(v * N) * N + Math.floor(u * N)];
        mix3([96, 96, 104], [176, 176, 184], clamp(k * 1.1 - 0.05, 0, 1), o);
      });
      return {
        ground: { map, normal: normalCanvas(hf, N, N, 3.2), scale: 5, roughness: 1, color: '#ffffff' },
      };
    },
  },
};
