// Scenery: the props around the board for each world, built from primitives. Nothing here takes part in the physics;
// it sits on the table plane (y = GROUND_Y) around the board, mostly behind it and in front of it, where the camera looks.
import * as THREE from 'three';
import { TILE } from './constants.js';
import { mulberry32, clamp } from './lighting.js';
import { GROUND_Y, fbm } from './worlds.js';

const TAU = Math.PI * 2;
const G = GROUND_Y;

class Kit {
  constructor(S, theme, bx, bz) {
    this.S = S; this.theme = theme; this.bx = bx; this.bz = bz;
    this.group = new THREE.Group();
    this.rnd = mulberry32(1234);
    this.cache = new Map();
    this.anim = [];
    this.blobTex = null;
  }
  r(a = 0, b = 1) { return a + (b - a) * this.rnd(); }
  pick(arr) { return arr[Math.floor(this.rnd() * arr.length)]; }
  // visible half-width of the table at depth z (the board's own width, widening with distance)
  span(z) { return this.bx * 0.95 + Math.max(0, -z) * 0.6 + 0.3; }
  // a random spot on the table behind the board, in front of the board, or around it
  // only about 2 m of table shows above the board, so depth is capped
  behind(z0, z1) { const z = -this.bz - 0.12 - this.r(Math.min(z0, 1.8), Math.min(z1, 2.0)); return [this.r(-1, 1) * this.span(z), z]; }
  front(z0, z1) { const z = this.bz + 0.12 + this.r(z0, z1); return [this.r(-1, 1) * Math.min(this.span(0), this.bx + 0.4), z]; }
  m(color, o = {}) {
    const key = color + JSON.stringify(o);
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.7, ...o });
      this.cache.set(key, m);
    }
    return m;
  }
  add(geo, mat, x, y, z, o = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2]);
    if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
    m.castShadow = o.cast !== false;
    m.receiveShadow = o.recv !== false;
    (o.parent || this.group).add(m);
    return m;
  }
  grp(x, y, z, ry = 0) { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; this.group.add(g); return g; }
  // soft dark disc under a prop (the real shadow map only covers the area right around the board)
  blob(x, z, rad, a = 0.32, y = G) {
    if (!this.blobTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x2 = c.getContext('2d');
      const g = x2.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.5, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x2.fillStyle = g; x2.fillRect(0, 0, 64, 64);
      this.blobTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(rad * 2, rad * 2), new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, opacity: a, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.002, z);
    m.renderOrder = 1;
    this.group.add(m);
  }
  // many copies of one mesh: items = [{x,y,z,ry,s:[x,y,z], c:'#hex'}]
  inst(geo, mat, items, o = {}) {
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    items.forEach((it, i) => {
      d.position.set(it.x, it.y, it.z);
      d.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
      const s = it.s || [1, 1, 1];
      d.scale.set(s[0], s[1], s[2]);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
      if (it.c) im.setColorAt(i, col.set(it.c));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = o.cast !== false;
    im.receiveShadow = true;
    this.group.add(im);
    return im;
  }
  canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.S.maxAniso;
    return t;
  }
  update(now, dt, still) { for (const f of this.anim) f(now, dt, still); }
  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) { for (const k of ['map', 'normalMap', 'alphaMap']) if (m[k]) m[k].dispose(); m.dispose(); }
    });
    for (const m of this.cache.values()) m.dispose();
    if (this.blobTex) this.blobTex.dispose();
  }
}

const lathe = (pts, seg = 28) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const cyl = (r1, r2, h, seg = 20) => new THREE.CylinderGeometry(r1, r2, h, seg);
const sph = (r, ws = 20, hs = 14) => new THREE.SphereGeometry(r, ws, hs);
const tor = (r, t, ts = 8, rs = 24) => new THREE.TorusGeometry(r, t, ts, rs);

// ---------------------------------------------------------------- wood: a playroom floor
function wood(K) {
  const { bx, bz } = K;
  const crayonCols = ['#e5484d', '#2e7bd6', '#f2b800', '#3aa655', '#8e4fd6', '#ff8a1f'];
  const crayon = (col, x, z, ry) => {
    const g = K.grp(x, G + 0.016, z, ry);
    K.add(cyl(0.014, 0.014, 0.17, 14), K.m(col, { roughness: 0.55 }), 0, 0, 0, { parent: g, r: [0, 0, Math.PI / 2] });
    K.add(new THREE.ConeGeometry(0.014, 0.035, 14), K.m(col, { roughness: 0.55 }), 0.1, 0, 0, { parent: g, r: [0, 0, -Math.PI / 2] });
    K.add(cyl(0.0145, 0.0145, 0.07, 14), K.m('#f4ead2', { roughness: 0.8 }), -0.02, 0, 0, { parent: g, r: [0, 0, Math.PI / 2] });
    K.blob(x, z, 0.1, 0.22);
  };
  for (let i = 0; i < 6; i++) { const [x, z] = K.front(0.12, 0.5); crayon(crayonCols[i], x, z, K.r(-0.5, 0.5)); }
  // a small wooden train
  const train = K.grp(-bx * 0.55, G, -bz - 0.45, 0.25);
  const body = K.m('#c0392b', { roughness: 0.5 });
  K.add(new THREE.BoxGeometry(0.22, 0.09, 0.1), body, 0, 0.07, 0, { parent: train });
  K.add(cyl(0.045, 0.045, 0.13, 18), K.m('#2e7bd6', { roughness: 0.5 }), 0.06, 0.15, 0, { parent: train, r: [Math.PI / 2, 0, Math.PI / 2] });
  K.add(new THREE.BoxGeometry(0.07, 0.06, 0.12), K.m('#f2b800', { roughness: 0.5 }), -0.07, 0.145, 0, { parent: train });
  K.add(cyl(0.012, 0.016, 0.05, 10), K.m('#222'), 0.1, 0.22, 0, { parent: train });
  for (const [wx, wz] of [[-0.07, 0.056], [-0.07, -0.056], [0.07, 0.056], [0.07, -0.056]]) K.add(cyl(0.032, 0.032, 0.014, 18), K.m('#3a2a1a', { roughness: 0.6 }), wx, 0.032, wz, { parent: train, r: [Math.PI / 2, 0, 0] });
  const car = K.grp(-bx * 0.55 + 0.27, G, -bz - 0.45, 0.25);
  K.add(new THREE.BoxGeometry(0.17, 0.08, 0.1), K.m('#3aa655', { roughness: 0.5 }), 0, 0.07, 0, { parent: car });
  for (const [wx, wz] of [[-0.05, 0.056], [-0.05, -0.056], [0.05, 0.056], [0.05, -0.056]]) K.add(cyl(0.028, 0.028, 0.014, 18), K.m('#3a2a1a', { roughness: 0.6 }), wx, 0.028, wz, { parent: car, r: [Math.PI / 2, 0, 0] });
  K.blob(-bx * 0.55 + 0.12, -bz - 0.45, 0.28, 0.3);
  // marbles, a ball, spare alphabet cubes
  const marbleCols = ['#38b6ff', '#ff5d8f', '#ffd23d', '#6be08a'];
  for (let i = 0; i < 9; i++) {
    const [x, z] = i < 5 ? K.behind(0.1, 0.7) : K.front(0.1, 0.5);
    K.add(sph(0.016, 16, 12), K.m(marbleCols[i % 4], { roughness: 0.05, clearcoat: 1, metalness: 0, envMapIntensity: 1.6 }), x, G + 0.016, z);
    K.blob(x, z, 0.03, 0.3);
  }
  K.add(sph(0.09, 28, 20), K.m('#d9534f', { roughness: 0.4 }), bx * 0.62, G + 0.09, -bz - 0.5);
  K.add(new THREE.TorusGeometry(0.09, 0.006, 8, 40), K.m('#fff', { roughness: 0.5 }), bx * 0.62, G + 0.09, -bz - 0.5, { r: [0.3, 0.4, 0] });
  K.blob(bx * 0.62, -bz - 0.5, 0.15, 0.32);
  const cubeCols = ['#e5484d', '#2e7bd6', '#3aa655'];
  cubeCols.forEach((c, i) => {
    const x = bx * 0.25 + i * 0.16; const z = -bz - 0.4 - (i % 2) * 0.12;
    K.add(new THREE.BoxGeometry(0.09, 0.09, 0.09), K.m(c, { roughness: 0.45 }), x, G + 0.045, z, { r: [0, K.r(-0.5, 0.5), 0] });
    K.blob(x, z, 0.09, 0.3);
  });
  // a spinning top
  const top = K.grp(-bx * 0.2, G, -bz - 0.7);
  K.add(new THREE.ConeGeometry(0.05, 0.08, 20), K.m('#f2b800', { roughness: 0.45 }), 0, 0.04, 0, { parent: top, r: [Math.PI, 0, 0] });
  K.add(cyl(0.05, 0.05, 0.03, 20), K.m('#e5484d', { roughness: 0.45 }), 0, 0.095, 0, { parent: top });
  K.add(cyl(0.01, 0.01, 0.06, 10), K.m('#d9a468'), 0, 0.14, 0, { parent: top });
  K.blob(-bx * 0.2, -bz - 0.7, 0.1, 0.3);
}

// ---------------------------------------------------------------- tofu kitchen
function kitchen(K) {
  const { bx, bz } = K;
  const ceramic = K.m('#f5f2ea', { roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1 });
  const blue = K.m('#2a5aa8', { roughness: 0.2, clearcoat: 1 });
  // bamboo steamer (two baskets + lid)
  const bam = K.canvasTex(256, 128, (x, w, h) => {
    x.fillStyle = '#d6b06a'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 28; i++) { x.fillStyle = `rgba(110,70,20,${0.12 + (i % 3) * 0.06})`; x.fillRect(i * (w / 28), 0, 2, h); }
    for (let j = 0; j < 4; j++) { x.fillStyle = 'rgba(90,55,15,.5)'; x.fillRect(0, (j + 0.5) * (h / 4), w, 3); }
  });
  bam.repeat.set(3, 1);
  const bamM = K.m('#ffffff', { map: bam, roughness: 0.75 });
  const st = K.grp(-bx * 0.58, G, -bz - 0.62);
  for (let i = 0; i < 2; i++) {
    K.add(cyl(0.2, 0.2, 0.09, 36), bamM, 0, 0.045 + i * 0.09, 0, { parent: st });
    K.add(tor(0.2, 0.009, 8, 36), K.m('#8f6a34'), 0, 0.01 + i * 0.09, 0, { parent: st, r: [Math.PI / 2, 0, 0] });
    K.add(tor(0.2, 0.009, 8, 36), K.m('#8f6a34'), 0, 0.085 + i * 0.09, 0, { parent: st, r: [Math.PI / 2, 0, 0] });
  }
  K.add(cyl(0.05, 0.215, 0.075, 36), bamM, 0, 0.215, 0, { parent: st });
  K.add(sph(0.026), K.m('#8f6a34'), 0, 0.27, 0, { parent: st });
  K.blob(-bx * 0.58, -bz - 0.62, 0.34, 0.38);
  // soy sauce dipping bowl
  const bowl = K.grp(bx * 0.42, G, -bz - 0.38);
  K.add(lathe([[0.001, 0.0], [0.045, 0.0], [0.07, 0.015], [0.1, 0.06], [0.108, 0.08], [0.1, 0.08], [0.09, 0.062], [0.06, 0.025], [0.001, 0.02]]), ceramic, 0, 0, 0, { parent: bowl });
  K.add(tor(0.104, 0.005, 8, 36), blue, 0, 0.078, 0, { parent: bowl, r: [Math.PI / 2, 0, 0] });
  K.add(new THREE.CircleGeometry(0.083, 28), K.m('#2a150a', { roughness: 0.05, clearcoat: 1, envMapIntensity: 1.8 }), 0, 0.058, 0, { parent: bowl, r: [-Math.PI / 2, 0, 0], cast: false });
  K.blob(bx * 0.42, -bz - 0.38, 0.17, 0.35);
  // soy sauce bottle
  const bot = K.grp(bx * 0.8, G, -bz - 0.7);
  K.add(cyl(0.05, 0.05, 0.2, 24), K.m('#1f120a', { roughness: 0.1, clearcoat: 1, envMapIntensity: 1.6 }), 0, 0.1, 0, { parent: bot });
  K.add(cyl(0.022, 0.05, 0.05, 24), K.m('#1f120a', { roughness: 0.1, clearcoat: 1 }), 0, 0.225, 0, { parent: bot });
  K.add(cyl(0.02, 0.02, 0.05, 20), K.m('#d6362b', { roughness: 0.4 }), 0, 0.275, 0, { parent: bot });
  K.add(cyl(0.0505, 0.0505, 0.09, 24, 1, true), K.m('#f4ecd8', { roughness: 0.8 }), 0, 0.1, 0, { parent: bot });
  K.blob(bx * 0.8, -bz - 0.7, 0.12, 0.35);
  // plate with scallion rings
  const plate = K.grp(-bx * 0.12, G, -bz - 0.5);
  K.add(lathe([[0.001, 0.0], [0.1, 0.0], [0.16, 0.025], [0.175, 0.03], [0.17, 0.034], [0.1, 0.008], [0.001, 0.008]]), ceramic, 0, 0, 0, { parent: plate });
  const rings = [];
  for (let i = 0; i < 34; i++) { const a = K.r(0, TAU); const d = Math.sqrt(K.rnd()) * 0.11; rings.push({ x: Math.cos(a) * d, y: 0.014 + K.r(0, 0.012), z: Math.sin(a) * d, rx: Math.PI / 2 + K.r(-0.4, 0.4), rz: K.r(0, 3), c: K.pick(['#5cb85c', '#7ccd6a', '#3f9a4a', '#e9f5d0']) }); }
  const ringsM = K.inst(tor(0.012, 0.0045, 6, 14), K.m('#ffffff', { roughness: 0.5 }), rings.map((r) => ({ ...r, x: r.x - bx * 0.12, y: G + r.y, z: r.z - bz - 0.5 })));
  ringsM.castShadow = false;
  K.blob(-bx * 0.12, -bz - 0.5, 0.22, 0.33);
  // garlic and ginger
  for (const [gx, gz, rot] of [[-bx * 0.34, -bz - 0.25, 0.4], [-bx * 0.34 + 0.12, -bz - 0.3, 1.2], [-bx * 0.34 + 0.05, -bz - 0.38, 2.2]]) {
    const g = K.grp(gx, G + 0.035, gz, rot);
    K.add(sph(0.04, 20, 14), K.m('#f4eee2', { roughness: 0.55, sheen: 0.4 }), 0, 0, 0, { parent: g, s: [1, 0.85, 1] });
    K.add(new THREE.ConeGeometry(0.014, 0.04, 10), K.m('#eadfc8', { roughness: 0.6 }), 0, 0.045, 0, { parent: g });
    K.blob(gx, gz, 0.06, 0.3);
  }
  const gin = K.grp(bx * 0.18, G + 0.025, -bz - 0.3, 0.8);
  const gm = K.m('#c9a368', { roughness: 0.85 });
  K.add(sph(0.04, 14, 10), gm, 0, 0, 0, { parent: gin, s: [1.8, 0.8, 0.9] });
  K.add(sph(0.03, 14, 10), gm, 0.06, 0.012, 0.03, { parent: gin, s: [1.4, 0.8, 0.8] });
  K.add(sph(0.026, 14, 10), gm, -0.05, 0.01, -0.03, { parent: gin, s: [1.3, 0.8, 0.8] });
  K.blob(bx * 0.18, -bz - 0.3, 0.1, 0.3);
  // wok, far back
  const wok = K.grp(bx * 0.12, G, -bz - 1.35);
  wok.scale.setScalar(0.8);
  K.add(lathe([[0.001, 0.0], [0.07, 0.01], [0.17, 0.07], [0.3, 0.17], [0.34, 0.2], [0.335, 0.205], [0.29, 0.17], [0.16, 0.075], [0.001, 0.02]], 36), K.m('#2b2b2f', { roughness: 0.45, metalness: 0.75 }), 0, 0.0, 0, { parent: wok, s: [1, 1, 1] });
  K.add(cyl(0.016, 0.016, 0.34, 12), K.m('#5a3a22', { roughness: 0.6 }), 0.5, 0.21, 0, { parent: wok, r: [0, 0, Math.PI / 2 - 0.12] });
  K.blob(bx * 0.12, -bz - 1.35, 0.42, 0.35);
  // chopsticks on a rest, in front
  const cs = K.grp(bx * 0.5, 0, bz + 0.3, -0.12);
  K.add(new THREE.BoxGeometry(0.05, 0.016, 0.02), ceramic, 0, 0.008, 0, { parent: cs, cast: true });
  for (const z of [-0.012, 0.014]) K.add(cyl(0.0032, 0.0052, 0.46, 10), K.m('#3a1d12', { roughness: 0.3, clearcoat: 0.6 }), 0, 0.022, z, { parent: cs, r: [0, 0, Math.PI / 2] });
  // bits on the cutting board and counter: scallion rings, sesame seeds
  const rings2 = []; const seeds = [];
  for (let i = 0; i < 40; i++) { const [x, z] = [K.r(-1, 1) * (bx - 0.05), K.r(0.2, bz + 0.03)]; rings2.push({ x, y: 0.004, z, rx: Math.PI / 2, rz: K.r(0, 3), c: K.pick(['#5cb85c', '#7ccd6a', '#e9f5d0']), s: [0.8, 0.8, 1] }); }
  for (let i = 0; i < 70; i++) { const [x, z] = [K.r(-1, 1) * (bx - 0.05), K.r(0.2, bz + 0.04)]; seeds.push({ x, y: 0.002, z, ry: K.r(0, 3), s: [1, 0.5, 0.6], c: K.pick(['#f2e7c9', '#2a2118', '#f2e7c9']) }); }
  K.inst(tor(0.012, 0.0045, 6, 14), K.m('#ffffff', { roughness: 0.5 }), rings2, { cast: false });
  K.inst(sph(0.0042, 8, 6), K.m('#ffffff', { roughness: 0.6 }), seeds, { cast: false });
  // scallion bundle on the board, front left
  const sb = K.grp(-bx * 0.62, 0.01, bz - 0.12, 0.35);
  for (let i = 0; i < 5; i++) {
    K.add(cyl(0.007, 0.0075, 0.14, 8), K.m('#f1f5e3', { roughness: 0.6 }), -0.07, 0.007 + (i % 2) * 0.012, (i - 2) * 0.012, { parent: sb, r: [0, 0, Math.PI / 2], cast: false });
    K.add(cyl(0.0085, 0.006, 0.2, 8), K.m('#4aa14f', { roughness: 0.55 }), 0.1, 0.007 + (i % 2) * 0.012, (i - 2) * 0.012, { parent: sb, r: [0, 0, Math.PI / 2], cast: false });
  }
}

// ---------------------------------------------------------------- rock garden
function blade(K, n, near, h0, h1, area, lean = 0.3) {
  const items = [];
  const cols = ['#3d7a2a', '#4c8f33', '#5da13d', '#76b44a', '#8cc255', '#386d26'];
  for (let i = 0; i < n; i++) {
    const [x, z] = area();
    const h = K.r(h0, h1);
    items.push({ x, y: G, z, rx: K.r(-lean, lean), rz: K.r(-lean, lean), ry: K.r(0, TAU), s: [1, h / 0.1, 1], c: K.pick(cols) });
  }
  return K.inst(new THREE.ConeGeometry(0.008, 0.1, 3).translate(0, 0.05, 0), K.m('#ffffff', { roughness: 0.8, side: THREE.DoubleSide }), items, { cast: false });
}

function garden(K) {
  const { bx, bz } = K;
  // Grass everywhere except the strip the blocks slide along. Short blades near the row (so letters stay readable),
  // longer ones farther out.
  const lane = 0.17;
  const near = (zmax) => () => { const s = K.rnd() < 0.5 ? -1 : 1; return [K.r(-1, 1) * (bx + 0.3), s * K.r(lane, zmax)]; };
  blade(K, 1300, 0, 0.03, 0.06, near(0.4), 0.3);
  blade(K, 1300, 0, 0.05, 0.12, () => { const z = K.rnd() < 0.7 ? -K.r(0.35, 1.6) : K.r(0.35, 1.0); return [K.r(-1, 1) * K.span(z), z]; }, 0.3);
  blade(K, 1400, 0, 0.18, 0.4, () => { const z = -K.r(1.0, 4.5); return [K.r(-1, 1) * K.span(z), z]; }, 0.25);
  // flowers: daisies and buttercups on the lawn margins and in the meadow
  const stems = []; const heads = []; const centres = [];
  for (let i = 0; i < 60; i++) {
    const onSlab = i < 22; // near the row, within the short grass
    let x; let z; let y;
    if (onSlab) { x = K.r(-1, 1) * (bx - 0.05); z = K.rnd() < 0.5 ? K.r(0.2, 0.5) : -K.r(0.2, 0.5); y = 0; } else { [x, z] = K.rnd() < 0.7 ? K.behind(0.05, 3) : K.front(0.1, 0.9); y = G; }
    const h = K.r(0.07, 0.15);
    stems.push({ x, y: y + h / 2, z, s: [1, h / 0.1, 1] });
    const col = K.pick(['#ffffff', '#ffffff', '#ffe34a', '#ff8fb3', '#c9a8ff']);
    heads.push({ x, y: y + h, z, rx: -1.2 + K.r(-0.2, 0.2), s: [1, 0.35, 1], c: col });
    centres.push({ x, y: y + h + 0.004, z: z + 0.001 });
  }
  K.inst(new THREE.CylinderGeometry(0.0022, 0.0022, 0.1, 5), K.m('#4c8f33'), stems, { cast: false });
  K.inst(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 12), K.m('#ffffff', { roughness: 0.6 }), heads, { cast: false });
  K.inst(sph(0.008, 8, 6), K.m('#f2b800', { roughness: 0.6 }), centres, { cast: false });
  // mushrooms
  for (const [mx, mz, sc] of [[-bx * 0.7, -bz - 0.3, 1.1], [-bx * 0.7 + 0.14, -bz - 0.38, 0.7], [bx * 0.55, -bz - 0.5, 1.4], [bx * 0.55 + 0.12, -bz - 0.45, 0.8]]) {
    const g = K.grp(mx, G, mz, K.r(0, 3));
    K.add(cyl(0.012 * sc, 0.018 * sc, 0.07 * sc, 12), K.m('#f4ecd8', { roughness: 0.7 }), 0, 0.035 * sc, 0, { parent: g });
    K.add(new THREE.SphereGeometry(0.05 * sc, 20, 10, 0, TAU, 0, Math.PI / 2), K.m('#d9382c', { roughness: 0.45, clearcoat: 0.4 }), 0, 0.065 * sc, 0, { parent: g, s: [1, 0.75, 1] });
    for (let i = 0; i < 6; i++) { const a = i * 1.05; const rr = 0.028 * sc; K.add(sph(0.007 * sc, 8, 6), K.m('#ffffff'), Math.cos(a) * rr, 0.095 * sc - (i % 2) * 0.012, Math.sin(a) * rr, { parent: g, cast: false }); }
    K.blob(mx, mz, 0.07 * sc, 0.3);
  }
  // boulders (lumpy icospheres) with a little moss
  const rock = new THREE.IcosahedronGeometry(1, 2);
  const pos = rock.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
    const n = 0.8 + 0.35 * fbm((x + 2) / 4, (z + 2) / 4 + y * 0.1, 4, 3, 3);
    pos.setXYZ(i, x * n, y * n * 0.7, z * n);
  }
  rock.computeVertexNormals();
  for (let i = 0; i < 9; i++) {
    const [x, z] = K.behind(0.3, 3.5);
    const sc = K.r(0.12, 0.45);
    K.add(rock, K.m(K.pick(['#8f9094', '#7d7f84', '#a4a5a8']), { roughness: 0.95 }), x, G + sc * 0.45, z, { r: [0, K.r(0, 6), 0], s: [sc, sc * K.r(0.8, 1.2), sc * K.r(0.8, 1.2)] });
    K.add(sph(sc * 0.55, 12, 8), K.m('#6d9144', { roughness: 1 }), x + sc * 0.1, G + sc * 0.78, z, { s: [1, 0.3, 1], cast: false });
    K.blob(x, z, sc * 1.25, 0.4);
  }
  // butterflies
  const wingM = (c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, fog: true });
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Group();
    const col = K.pick(['#ffd23d', '#ff8a1f', '#ffffff', '#6aa8ff']);
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.bezierCurveTo(0.03, 0.05, 0.08, 0.04, 0.07, 0); shape.bezierCurveTo(0.08, -0.04, 0.03, -0.04, 0, 0);
    const wing = new THREE.ShapeGeometry(shape);
    const wl = new THREE.Mesh(wing, wingM(col)); const wr = new THREE.Mesh(wing, wingM(col)); wr.scale.x = -1;
    const pl = new THREE.Group(); pl.add(wl); pl.add(wr); pl.rotation.x = -Math.PI / 2; b.add(pl);
    K.group.add(b);
    const cx = K.r(-1, 1) * bx; const cz = -bz - K.r(0.2, 1.6); const ph = K.r(0, 9); const sp = K.r(0.4, 0.8);
    K.anim.push((now, dt, still) => {
      const t = now * 0.001 * sp + ph;
      b.position.set(cx + Math.sin(t) * 0.35, 0.22 + Math.sin(t * 1.7) * 0.07, cz + Math.cos(t * 0.8) * 0.22);
      b.rotation.y = -t + Math.PI;
      const flap = still ? 0.5 : Math.sin(now * 0.03 + ph) * 0.9;
      wl.rotation.y = flap; wr.rotation.y = -flap;
    });
  }
}

// ---------------------------------------------------------------- ice & snow
function snow(K) {
  const { bx, bz } = K;
  const W = bx + 0.07; const D = bz + 0.07;
  const snowM = K.m('#f6faff', { roughness: 0.9, sheen: 0.5, sheenColor: '#cfe6ff', sheenRoughness: 0.6 });
  // drifts
  for (let i = 0; i < 14; i++) {
    const [x, z] = K.behind(0.4, 3);
    const sc = K.r(0.15, 0.4);
    K.add(sph(1, 20, 12), snowM, x, G, z, { s: [sc * 1.6, sc * 0.45, sc], r: [0, K.r(0, 3), 0], cast: false });
  }
  // pine trees
  const bark = K.m('#4a3322', { roughness: 0.9 });
  const needle = K.m('#1f4a37', { roughness: 0.85 });
  const cap = K.m('#f6faff', { roughness: 0.85, sheen: 0.4, sheenColor: '#cfe6ff' });
  const pine = (x, z, h) => {
    const g = K.grp(x, G, z, K.r(0, 6));
    K.add(cyl(0.025 * h, 0.04 * h, 0.2 * h, 8), bark, 0, 0.1 * h, 0, { parent: g });
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const r = (0.34 - 0.24 * t) * h; const ch = (0.5 - 0.1 * t) * h; const y = (0.14 + 0.3 * i) * h;
      K.add(new THREE.ConeGeometry(r, ch, 14), needle, 0, y + ch / 2, 0, { parent: g });
      K.add(new THREE.ConeGeometry(r * 0.94, ch * 0.66, 14), cap, 0, y + ch * 0.17 + ch * 0.33 + 0.004, 0, { parent: g, cast: false });
    }
    K.blob(x, z, 0.34 * h, 0.35);
  };
  const pines = [];
  for (let i = 0; i < 14; i++) { const [x, z] = K.behind(0.3, 2.0); pines.push([x, z, K.r(0.26, 0.5)]); }
  pines.sort((a, b) => a[1] - b[1]);
  for (const p of pines) pine(...p);
  for (const sx of [-1, 1]) pine(sx * (W + 0.35), -D * 0.3, 0.4);
  // snowman
  const sm = K.grp(bx * 0.55, G, -bz - 0.45, -0.25);
  const white = K.m('#ffffff', { roughness: 0.8, sheen: 0.5, sheenColor: '#cfe6ff' });
  K.add(sph(0.13, 24, 16), white, 0, 0.12, 0, { parent: sm });
  K.add(sph(0.095, 24, 16), white, 0, 0.3, 0, { parent: sm });
  K.add(sph(0.068, 22, 14), white, 0, 0.44, 0, { parent: sm });
  const coal = K.m('#15181c', { roughness: 0.5 });
  for (const e of [-1, 1]) K.add(sph(0.009, 8, 6), coal, e * 0.025, 0.455, 0.06, { parent: sm, cast: false });
  K.add(new THREE.ConeGeometry(0.012, 0.07, 10), K.m('#ff7a1a', { roughness: 0.5 }), 0, 0.438, 0.095, { parent: sm, r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 3; i++) K.add(sph(0.009, 8, 6), coal, 0, 0.34 - i * 0.045, 0.092 - i * 0.004, { parent: sm, cast: false });
  K.add(tor(0.07, 0.016, 8, 24), K.m('#d6362b', { roughness: 0.8 }), 0, 0.378, 0, { parent: sm, r: [Math.PI / 2, 0, 0] });
  K.add(cyl(0.04, 0.04, 0.012, 20), K.m('#1d1f24'), 0, 0.5, 0, { parent: sm });
  K.add(cyl(0.028, 0.028, 0.05, 20), K.m('#1d1f24'), 0, 0.527, 0, { parent: sm });
  for (const e of [-1, 1]) K.add(cyl(0.004, 0.004, 0.2, 5), bark, e * 0.17, 0.32, 0, { parent: sm, r: [0, 0, e * -1.0] });
  K.blob(bx * 0.55, -bz - 0.45, 0.2, 0.35);
  // rocks poking out of the snow
  const rock = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 8; i++) {
    const [x, z] = K.behind(0.3, 4); const sc = K.r(0.1, 0.32);
    K.add(rock, K.m('#5b6068', { roughness: 0.95 }), x, G + sc * 0.4, z, { s: [sc, sc * 0.7, sc * 0.9], r: [0, K.r(0, 6), 0] });
    K.add(sph(1, 14, 8), snowM, x, G + sc * 0.75, z, { s: [sc * 0.8, sc * 0.3, sc * 0.7], cast: false });
    K.blob(x, z, sc * 1.3, 0.35);
  }
  // ice crystals
  const crystalM = K.m('#bfe9ff', { roughness: 0.05, clearcoat: 1, emissive: '#6fc4ee', emissiveIntensity: 0.18, envMapIntensity: 2 });
  for (let i = 0; i < 7; i++) {
    const [x, z] = i < 4 ? K.behind(0.1, 1.2) : K.front(0.1, 0.8);
    const g = K.grp(x, G, z, K.r(0, 6));
    for (let j = 0; j < 4; j++) K.add(new THREE.ConeGeometry(0.014 + j * 0.003, 0.08 + j * 0.03, 6), crystalM, (j - 1.5) * 0.02, 0.03 + j * 0.01, (j % 2) * 0.012, { parent: g, r: [(j - 1.5) * 0.1, 0, (j - 1.5) * 0.14] });
    K.blob(x, z, 0.07, 0.25);
  }
  // snowfall
  const N = 420;
  const pos = new Float32Array(N * 3);
  const vel = [];
  for (let i = 0; i < N; i++) { pos[i * 3] = K.r(-3.2, 3.2); pos[i * 3 + 1] = K.r(0, 3); pos[i * 3 + 2] = K.r(-5, 1.8); vel.push([K.r(0.12, 0.3), K.r(0, 6)]); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const flake = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.04, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false }));
  flake.frustumCulled = false;
  K.group.add(flake);
  K.anim.push((now, dt, still) => {
    if (still) return;
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 1] -= vel[i][0] * dt;
      pos[i * 3] += Math.sin(now * 0.0006 + vel[i][1]) * 0.05 * dt;
      if (pos[i * 3 + 1] < G) pos[i * 3 + 1] = 3;
    }
    geo.attributes.position.needsUpdate = true;
  });
}

// ---------------------------------------------------------------- candy shop
function candy(K) {
  const { bx, bz } = K;
  const swirl = (cols) => K.canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = cols[1]; x.fillRect(0, 0, w, h);
    x.translate(w / 2, h / 2);
    const n = 8;
    for (let i = 0; i < n; i++) {
      x.fillStyle = cols[0];
      x.beginPath(); x.moveTo(0, 0);
      for (let a = 0; a <= 1.001; a += 0.02) { const ang = (i / n) * TAU + a * 2.2; const r = a * w * 0.72; x.lineTo(Math.cos(ang) * r, Math.sin(ang) * r); }
      for (let a = 1; a >= -0.001; a -= 0.02) { const ang = (i / n) * TAU + a * 2.2 + 0.4; const r = a * w * 0.72; x.lineTo(Math.cos(ang) * r, Math.sin(ang) * r); }
      x.fill();
    }
  });
  const lolly = (x, z, cols, tilt, sc = 1) => {
    const g = K.grp(x, G, z, K.r(-0.5, 0.5));
    g.rotation.z = tilt;
    K.add(cyl(0.007, 0.007, 0.3 * sc, 10), K.m('#fff', { roughness: 0.4 }), 0, 0.15 * sc, 0, { parent: g });
    const t = swirl(cols);
    const disc = K.add(cyl(0.085 * sc, 0.085 * sc, 0.025 * sc, 36), [K.m('#ffffff', { roughness: 0.2, clearcoat: 1 }), K.m('#ffffff', { map: t, roughness: 0.2, clearcoat: 1 }), K.m('#ffffff', { roughness: 0.2, clearcoat: 1 })], 0, 0.3 * sc + 0.06 * sc, 0, { parent: g, r: [Math.PI / 2, 0, 0] });
    disc.material[1].map.rotation = 0;
    K.blob(x, z, 0.14 * sc, 0.3);
  };
  const L = [['#ff3d8b', '#ffffff'], ['#14b8a6', '#ffffff'], ['#7a5cff', '#ffe27a'], ['#ff8a1f', '#ffffff'], ['#ff3d8b', '#ffd23d']];
  for (let i = 0; i < 6; i++) { const [x, z] = K.behind(0.2, 2.2); lolly(x, z, L[i % L.length], K.r(-0.2, 0.2), K.r(0.8, 1.3)); }
  // candy canes
  const stripe = K.canvasTex(32, 128, (x, w, h) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#e5242f';
    for (let i = -2; i < 10; i++) { x.beginPath(); x.moveTo(0, i * 24 + 24); x.lineTo(w, i * 24); x.lineTo(w, i * 24 + 12); x.lineTo(0, i * 24 + 36); x.fill(); }
  });
  stripe.repeat.set(1, 4);
  const caneGeo = (() => {
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(0, i * 0.045, 0));
    for (let i = 1; i <= 10; i++) { const a = (i / 10) * Math.PI; pts.push(new THREE.Vector3(-Math.sin(a) * 0.06 + 0, 0.36 + (1 - Math.cos(a)) * 0.06, 0)); }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.017, 10);
  })();
  for (let i = 0; i < 4; i++) {
    const [x, z] = K.behind(0.2, 2); const g = K.grp(x, G, z, K.r(-0.6, 0.6));
    g.rotation.z = K.r(-0.25, 0.25);
    K.add(caneGeo, K.m('#ffffff', { map: stripe, roughness: 0.2, clearcoat: 1 }), 0, 0, 0, { parent: g, s: [1, 1, 1] });
    K.blob(x, z, 0.1, 0.28);
  }
  // peppermint discs lying down
  const mint = swirl(['#e5242f', '#ffffff']);
  for (let i = 0; i < 4; i++) {
    const [x, z] = i < 2 ? K.behind(0.1, 1.2) : K.front(0.1, 0.6);
    K.add(cyl(0.085, 0.085, 0.022, 32), [K.m('#fff', { roughness: 0.2, clearcoat: 1 }), K.m('#fff', { map: mint, roughness: 0.2, clearcoat: 1 }), K.m('#fff', { map: mint, roughness: 0.2, clearcoat: 1 })], x, G + 0.011, z, { r: [0, K.r(0, 3), 0] });
    K.blob(x, z, 0.11, 0.25);
  }
  // gumdrops
  const gd = ['#ff3d8b', '#ffd23d', '#14b8a6', '#7a5cff', '#ff8a1f', '#6be08a'];
  for (let i = 0; i < 18; i++) {
    const [x, z] = i < 11 ? K.behind(0.1, 2.5) : K.front(0.1, 0.8);
    const sc = K.r(0.7, 1.3); const c = gd[i % gd.length];
    const g = K.grp(x, G, z, K.r(0, 3));
    const m = K.m(c, { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.2 });
    K.add(new THREE.SphereGeometry(0.04 * sc, 20, 10, 0, TAU, 0, Math.PI / 2), m, 0, 0.012 * sc, 0, { parent: g, s: [1, 1.1, 1] });
    K.add(cyl(0.04 * sc, 0.04 * sc, 0.014 * sc, 20), m, 0, 0.005 * sc, 0, { parent: g });
    K.blob(x, z, 0.06 * sc, 0.3);
  }
  // jelly beans and marshmallows scattered
  const beans = [];
  for (let i = 0; i < 70; i++) { const [x, z] = K.rnd() < 0.6 ? K.behind(0.05, 2.4) : K.front(0.05, 0.9); beans.push({ x, y: G + 0.011, z, ry: K.r(0, 3), rz: Math.PI / 2, c: gd[i % gd.length] }); }
  K.inst(new THREE.CapsuleGeometry(0.011, 0.02, 4, 10), K.m('#ffffff', { roughness: 0.2, clearcoat: 1 }), beans);
  for (let i = 0; i < 6; i++) {
    const [x, z] = K.behind(0.2, 1.5);
    K.add(cyl(0.04, 0.04, 0.055, 20), K.m('#fff8f4', { roughness: 0.8, sheen: 0.6, sheenColor: '#ffe0ee' }), x, G + 0.028, z, { r: [0, K.r(0, 3), K.r(-0.1, 0.1)] });
    K.blob(x, z, 0.06, 0.25);
  }
}

// ---------------------------------------------------------------- sandcastle beach
function beach(K) {
  const { bx, bz } = K;
  // sea and wet shore, far behind
  const seaTex = K.canvasTex(1024, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, h, 0, 0); // bottom = near shore
    g.addColorStop(0, 'rgba(150,120,70,0)'); g.addColorStop(0.03, 'rgba(120,96,56,.55)');
    g.addColorStop(0.08, '#e9fbff'); g.addColorStop(0.13, '#8be3e2'); g.addColorStop(0.35, '#2fb6d2'); g.addColorStop(1, '#0a6fa8');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,.8)';
    for (let i = 0; i < 90; i++) { const px = (i / 90) * w; const py = h * (0.9 - 0.03 * Math.sin(i * 0.9)); x.beginPath(); x.ellipse(px, py, 22, 3, 0, 0, TAU); x.fill(); }
  }, true);
  seaTex.wrapS = THREE.ClampToEdgeWrapping; seaTex.wrapT = THREE.ClampToEdgeWrapping;
  const sea = K.add(new THREE.PlaneGeometry(160, 70), new THREE.MeshStandardMaterial({ map: seaTex, roughness: 0.25, metalness: 0, transparent: true }), 0, G + 0.004, -5.4 - 35, { r: [-Math.PI / 2, 0, 0], cast: false, recv: false });
  sea.renderOrder = 0;
  // shells
  const shellPal = ['#f4d8d0', '#f7ece0', '#f0b89a', '#e7c9e0', '#fff4e8'];
  const shellGeo = new THREE.SphereGeometry(0.05, 28, 8, 0, TAU, 0, Math.PI / 2);
  const sp = shellGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i); const y = sp.getY(i); const z = sp.getZ(i);
    const a = Math.atan2(z, x); const rr = 1 + 0.12 * Math.sin(a * 14);
    sp.setXYZ(i, x * rr, y * 0.55, z * rr);
  }
  shellGeo.computeVertexNormals();
  for (let i = 0; i < 14; i++) {
    const [x, z] = i < 8 ? K.behind(0.05, 2.6) : K.front(0.08, 0.7);
    const sc = K.r(0.7, 1.4);
    K.add(shellGeo, K.m(K.pick(shellPal), { roughness: 0.35, clearcoat: 0.5, sheen: 0.4, sheenColor: '#ffe0f0' }), x, G, z, { r: [K.r(-0.15, 0.15), K.r(0, 6), K.r(-0.15, 0.15)], s: [sc, sc, sc] });
    K.blob(x, z, 0.06 * sc, 0.28);
  }
  // starfish
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const r = i % 2 === 0 ? 0.075 : 0.032; const a = (i / 10) * TAU - Math.PI / 2; (i === 0 ? star.moveTo : star.lineTo).call(star, Math.cos(a) * r, Math.sin(a) * r); }
  const starGeo = new THREE.ExtrudeGeometry(star, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3 });
  for (const [x, z, c] of [[-bx * 0.5, bz + 0.34, '#ff7a3d'], [bx * 0.45, -bz - 0.3, '#f2a33d'], [bx * 0.05, -bz - 0.85, '#ff6a5a']]) {
    K.add(starGeo, K.m(c, { roughness: 0.7 }), x, G + 0.002, z, { r: [-Math.PI / 2, 0, K.r(0, 6)] });
    K.blob(x, z, 0.09, 0.3);
  }
  // pebbles
  const peb = [];
  for (let i = 0; i < 60; i++) { const [x, z] = K.rnd() < 0.65 ? K.behind(0.05, 2.5) : K.front(0.05, 0.8); const sc = K.r(0.012, 0.04); peb.push({ x, y: G + sc * 0.4, z, s: [sc * 1.2, sc * 0.7, sc], ry: K.r(0, 3), c: K.pick(['#8c8479', '#b9b0a2', '#6f6a63', '#d6cdbd']) }); }
  K.inst(sph(1, 8, 6), K.m('#ffffff', { roughness: 0.85 }), peb);
  // bucket and spade
  const bk = K.grp(-bx * 0.62, G, -bz - 0.5, 0.4);
  const red = K.m('#e5484d', { roughness: 0.35, clearcoat: 0.6 });
  K.add(new THREE.CylinderGeometry(0.1, 0.075, 0.13, 28, 1, true), red, 0, 0.065, 0, { parent: bk });
  K.add(new THREE.CircleGeometry(0.075, 24), red, 0, 0.001, 0, { parent: bk, r: [Math.PI / 2, 0, 0] });
  K.add(tor(0.1, 0.006, 8, 28), red, 0, 0.13, 0, { parent: bk, r: [Math.PI / 2, 0, 0] });
  K.add(new THREE.CircleGeometry(0.098, 28), K.m('#d8b878', { roughness: 1 }), 0, 0.11, 0, { parent: bk, r: [-Math.PI / 2, 0, 0], cast: false });
  const hand = K.add(new THREE.TorusGeometry(0.1, 0.005, 6, 20, Math.PI), K.m('#c9c9c9', { roughness: 0.3, metalness: 0.8 }), 0, 0.13, 0, { parent: bk });
  hand.rotation.set(0, 0, 0);
  K.blob(-bx * 0.62, -bz - 0.5, 0.17, 0.35);
  const spade = K.grp(-bx * 0.62 + 0.22, G + 0.01, -bz - 0.4, 0.9);
  spade.rotation.z = -0.15;
  K.add(new THREE.BoxGeometry(0.1, 0.012, 0.09), K.m('#f2b800', { roughness: 0.4 }), 0, 0, 0, { parent: spade });
  K.add(cyl(0.01, 0.01, 0.22, 10), K.m('#f2b800', { roughness: 0.4 }), 0.14, 0.004, 0, { parent: spade, r: [0, 0, Math.PI / 2] });
  K.blob(-bx * 0.62 + 0.22, -bz - 0.4, 0.14, 0.3);
  // beach ball
  const ballTex = K.canvasTex(256, 128, (x, w, h) => {
    const cols = ['#e5484d', '#ffffff', '#2e7bd6', '#ffffff', '#f2b800', '#ffffff'];
    for (let i = 0; i < 6; i++) { x.fillStyle = cols[i]; x.fillRect((i / 6) * w, 0, w / 6 + 1, h); }
  });
  K.add(sph(0.12, 32, 20), K.m('#ffffff', { map: ballTex, roughness: 0.3, clearcoat: 0.5 }), bx * 0.7, G + 0.12, -bz - 0.55, { r: [0.3, 0.5, 0.2] });
  K.blob(bx * 0.7, -bz - 0.55, 0.18, 0.35);
  // sandcastle turret with a flag
  const cs = K.grp(bx * 0.25, G, -bz - 0.45);
  const sandM = K.m('#e3c58a', { roughness: 1 });
  K.add(cyl(0.11, 0.13, 0.15, 28), sandM, 0, 0.075, 0, { parent: cs });
  K.add(cyl(0.12, 0.11, 0.025, 28), sandM, 0, 0.16, 0, { parent: cs });
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; K.add(new THREE.BoxGeometry(0.035, 0.035, 0.03), sandM, Math.cos(a) * 0.1, 0.19, Math.sin(a) * 0.1, { parent: cs, r: [0, -a, 0] }); }
  K.add(cyl(0.003, 0.003, 0.15, 6), K.m('#fff'), 0, 0.3, 0, { parent: cs });
  const fl = new THREE.Shape(); fl.moveTo(0, 0); fl.lineTo(0.07, 0.02); fl.lineTo(0, 0.04);
  K.add(new THREE.ShapeGeometry(fl), new THREE.MeshStandardMaterial({ color: '#e5484d', side: THREE.DoubleSide }), 0.002, 0.33, 0, { parent: cs, cast: false });
  K.blob(bx * 0.25, -bz - 0.45, 0.17, 0.35);
  // umbrella, far back right
  const um = K.grp(bx * 0.88, G, -bz - 1.0, 0);
  um.rotation.z = -0.12;
  K.add(cyl(0.01, 0.01, 0.75, 10), K.m('#e8e2d4', { roughness: 0.5 }), 0, 0.375, 0, { parent: um });
  const umTex = K.canvasTex(256, 16, (x, w, h) => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#ffffff' : '#e5484d'; x.fillRect((i / 8) * w, 0, w / 8 + 1, h); } });
  K.add(new THREE.SphereGeometry(0.38, 32, 12, 0, TAU, 0, Math.PI / 2.3), new THREE.MeshStandardMaterial({ map: umTex, roughness: 0.7, side: THREE.DoubleSide }), 0, 0.62, 0, { parent: um, s: [1, 0.55, 1] });
  K.blob(bx * 0.88, -bz - 1.0, 0.4, 0.3);
  // a crab
  const cb = K.grp(-bx * 0.18, G, -bz - 0.95, 0.5);
  const crabM = K.m('#e5502e', { roughness: 0.45, clearcoat: 0.4 });
  K.add(sph(0.06, 18, 12), crabM, 0, 0.035, 0, { parent: cb, s: [1.4, 0.55, 1] });
  for (const e of [-1, 1]) {
    K.add(cyl(0.004, 0.004, 0.03, 6), crabM, e * 0.03, 0.075, 0.05, { parent: cb });
    K.add(sph(0.01, 8, 6), K.m('#111'), e * 0.03, 0.095, 0.05, { parent: cb, cast: false });
    K.add(sph(0.025, 12, 8), crabM, e * 0.1, 0.045, 0.06, { parent: cb, s: [1.2, 0.8, 1] });
    for (let l = 0; l < 3; l++) K.add(cyl(0.003, 0.003, 0.06, 5), crabM, e * 0.085, 0.02, -0.02 + l * 0.025, { parent: cb, r: [0, 0, e * 0.9] });
  }
  K.blob(-bx * 0.18, -bz - 0.95, 0.12, 0.3);
}

// ---------------------------------------------------------------- moon base
function moon(K) {
  const { bx, bz } = K;
  const hull = K.m('#e8ecf4', { roughness: 0.4, metalness: 0.5, envMapIntensity: 1.3 });
  const dark = K.m('#2b3140', { roughness: 0.5, metalness: 0.6 });
  const glow = (c) => new THREE.MeshBasicMaterial({ color: c });
  // habitat dome, far left
  const dome = K.grp(-bx * 0.55, G, -bz - 1.15);
  dome.scale.setScalar(0.62);
  K.add(new THREE.SphereGeometry(0.55, 40, 20, 0, TAU, 0, Math.PI / 2), hull, 0, 0, 0, { parent: dome });
  K.add(cyl(0.58, 0.6, 0.05, 40), dark, 0, 0.02, 0, { parent: dome });
  K.add(new THREE.BoxGeometry(0.22, 0.26, 0.14), dark, 0, 0.13, 0.5, { parent: dome, r: [0, 0, 0] });
  K.add(new THREE.PlaneGeometry(0.1, 0.12), glow('#ffd98a'), 0, 0.13, 0.572, { parent: dome, cast: false });
  for (let i = 0; i < 3; i++) K.add(new THREE.TorusGeometry(0.55, 0.012, 6, 40, Math.PI), K.m('#b9c1d2', { metalness: 0.6, roughness: 0.4 }), 0, 0, 0, { parent: dome, r: [0, (i / 3) * Math.PI, 0] });
  K.blob(-bx * 0.55, -bz - 1.15, 0.55, 0.4);
  // rover
  const rv = K.grp(bx * 0.45, G, -bz - 0.65, -0.5);
  K.add(new THREE.BoxGeometry(0.3, 0.07, 0.17), hull, 0, 0.1, 0, { parent: rv });
  K.add(new THREE.BoxGeometry(0.12, 0.06, 0.12), dark, 0.03, 0.165, 0, { parent: rv });
  K.add(new THREE.PlaneGeometry(0.1, 0.03), glow('#7df9ff'), 0.093, 0.17, 0, { parent: rv, r: [0, Math.PI / 2, 0], cast: false });
  for (const [wx, wz] of [[-0.11, 0.105], [-0.11, -0.105], [0, 0.105], [0, -0.105], [0.11, 0.105], [0.11, -0.105]]) {
    K.add(cyl(0.04, 0.04, 0.035, 20), K.m('#1a1c22', { roughness: 0.8 }), wx, 0.04, wz, { parent: rv, r: [Math.PI / 2, 0, 0] });
    K.add(cyl(0.018, 0.018, 0.038, 12), K.m('#9aa3b5', { metalness: 0.8, roughness: 0.4 }), wx, 0.04, wz, { parent: rv, r: [Math.PI / 2, 0, 0] });
  }
  K.add(cyl(0.004, 0.004, 0.2, 6), K.m('#ccc'), -0.1, 0.24, 0.04, { parent: rv });
  K.add(new THREE.SphereGeometry(0.035, 14, 8, 0, TAU, 0, Math.PI / 2), hull, -0.1, 0.34, 0.04, { parent: rv, r: [Math.PI / 2, 0.3, 0] });
  K.add(new THREE.BoxGeometry(0.16, 0.005, 0.11), K.m('#1d3a7a', { roughness: 0.25, metalness: 0.6 }), -0.02, 0.175, -0.01, { parent: rv, r: [0.0, 0, 0.3] });
  K.blob(bx * 0.45, -bz - 0.65, 0.3, 0.4);
  // flag
  const fp = K.grp(bx * 0.78, G, -bz - 0.35);
  K.add(cyl(0.006, 0.006, 0.7, 8), K.m('#d7dbe6', { metalness: 0.7, roughness: 0.3 }), 0, 0.35, 0, { parent: fp });
  const flagTex = K.canvasTex(96, 64, (x, w, h) => {
    x.fillStyle = '#1f6f8b'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffffff'; x.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 11 : 26; const a = (i / 10) * TAU - Math.PI / 2; x.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); }
    x.fill();
  });
  K.add(new THREE.PlaneGeometry(0.26, 0.17, 8, 1), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 }), 0.13, 0.6, 0, { parent: fp });
  K.add(sph(0.012), K.m('#f2b800', { metalness: 0.8, roughness: 0.3 }), 0, 0.71, 0, { parent: fp });
  K.blob(bx * 0.78, -bz - 0.35, 0.12, 0.35);
  // radio dish
  const ds = K.grp(-bx * 0.15, G, -bz - 0.95, 0.5);
  K.add(cyl(0.03, 0.045, 0.3, 12), hull, 0, 0.15, 0, { parent: ds });
  K.add(new THREE.SphereGeometry(0.2, 28, 10, 0, TAU, 0, Math.PI / 3.3), K.m('#f3f5fa', { roughness: 0.35, metalness: 0.5, side: THREE.DoubleSide }), 0, 0.42, 0, { parent: ds, r: [-0.9, 0, 0], s: [1, 0.55, 1] });
  K.add(cyl(0.004, 0.004, 0.16, 6), K.m('#ccc'), 0, 0.5, 0.1, { parent: ds, r: [0.6, 0, 0] });
  K.blob(-bx * 0.15, -bz - 0.95, 0.25, 0.4);
  // supply canisters with status lights
  for (let i = 0; i < 4; i++) {
    const x = bx * 0.1 + i * 0.14; const z = -bz - 0.4 - (i % 2) * 0.1;
    K.add(cyl(0.05, 0.05, 0.16, 20), K.m(i % 2 ? '#e8ecf4' : '#f2b800', { roughness: 0.4, metalness: 0.4 }), x, G + 0.08, z);
    K.add(cyl(0.052, 0.052, 0.02, 20), dark, x, G + 0.14, z);
    K.add(sph(0.008, 8, 6), glow(['#7dff9a', '#ff5a4a'][i % 2]), x, G + 0.16, z + 0.04, { cast: false });
    K.blob(x, z, 0.08, 0.35);
  }
  // rocks
  const rock = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 12; i++) {
    const [x, z] = K.behind(0.2, 3.5); const sc = K.r(0.06, 0.26);
    if (Math.hypot(x - bx * 0.45, z + bz + 0.65) < 0.45 || Math.hypot(x - bx * 0.78, z + bz + 0.35) < 0.3) continue;
    K.add(rock, K.m(K.pick(['#5d5f66', '#707279', '#4b4d54']), { roughness: 1 }), x, G + sc * 0.35, z, { s: [sc, sc * 0.65, sc * 0.9], r: [0, K.r(0, 6), K.r(-0.2, 0.2)] });
    K.blob(x, z, sc * 1.4, 0.45);
  }
  for (let i = 0; i < 40; i++) {
    const [x, z] = K.rnd() < 0.6 ? K.behind(0.05, 2.5) : K.front(0.05, 0.9); const sc = K.r(0.01, 0.03);
    K.add(rock, K.m('#6a6c73', { roughness: 1 }), x, G + sc * 0.3, z, { s: [sc, sc * 0.6, sc], cast: false });
  }
}

const BUILDERS = { wood, kitchen, garden, snow, candy, beach, moon };

export function buildScenery(S, theme, bx, bz) {
  const f = BUILDERS[theme.world];
  if (!f) return null;
  const K = new Kit(S, theme, bx, bz);
  f(K);
  K.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.material && o.material.isMeshBasicMaterial) { o.castShadow = false; o.receiveShadow = false; } });
  return K;
}
