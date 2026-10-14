import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TILE } from './constants.js';
import { lighten, darken, isLight, mulberry32, clamp, easeOutBack, rgba, roundRectPath } from './lighting.js';

const FONT = '"Lexend", "Andika", "Trebuchet MS", system-ui, sans-serif';
const FOV = 35;
const ELEV = (28 * Math.PI) / 180; // camera elevation above the table
const BOARD_T = 0.09; // board thickness, top surface at y = 0

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _v = new THREE.Vector3();

// The 3D view: Three.js scene with a perspective camera ~28 degrees above a cutting board that sits on a
// table. Physics bodies are the source of truth; every frame this mirrors them into meshes.
export class Scene3D {
  constructor(canvas, game) {
    this.game = game;
    // ?quality=low trades looks for speed on weak GPUs: no antialiasing, 1x pixels, small shadow map.
    this.low = new URLSearchParams(window.location.search).get('quality') === 'low';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.low, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping; // keeps paint colours true; ACES washed them out
    this.maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();

    this.key = new THREE.DirectionalLight('#ffffff', 2.6);
    this.key.castShadow = true;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.012;
    this.scene.add(this.key, this.key.target);
    this.hemi = new THREE.HemisphereLight('#ffffff', '#999999', 0.5);
    this.scene.add(this.hemi);

    this.table = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ roughness: 0.95 }));
    this.table.rotation.x = -Math.PI / 2;
    this.table.position.y = -BOARD_T;
    this.table.receiveShadow = true;
    this.scene.add(this.table);
    this.board = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    this.board.castShadow = true;
    this.board.receiveShadow = true;
    this.scene.add(this.board);

    this.tileGeo = new RoundedBoxGeometry(TILE.w * 0.992, TILE.h * 0.992, TILE.d * 0.992, 3, 0.014);
    this.decalGeo = new THREE.PlaneGeometry(TILE.w - 0.03, TILE.h - 0.03);
    this.pieces = new Map();
    this.tileMeshes = [];
    this.letterCache = new Map();
    this.raycaster = new THREE.Raycaster();
    this.size = { W: 1, H: 1 };
    this.margins = { left: 20, right: 20, top: 70, bottom: 100 };
    this.bx = 1.5;
    this.bz = 0.95;
    this.theme = null;
    this.blockTex = null;
  }

  // ---------- textures & materials ----------
  woodCanvas(w, h, base, grain, seed, lines = 160) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, lighten(base, 0.06));
    g.addColorStop(0.5, base);
    g.addColorStop(1, darken(base, 0.07));
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    const rnd = mulberry32(seed);
    x.lineCap = 'round';
    for (let i = 0; i < lines; i++) {
      const y = rnd() * h;
      const amp = 1 + rnd() * 6;
      const k = Math.round(1 + rnd() * 2);
      const ph = rnd() * 6.28;
      x.strokeStyle = rgba(grain, 0.04 + rnd() * 0.2);
      x.lineWidth = 0.6 + rnd() * 2.6;
      x.beginPath();
      for (let px = 0; px <= w; px += 8) {
        const py = y + Math.sin((px / w) * Math.PI * 2 * k + ph) * amp;
        if (px === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.stroke();
    }
    return c;
  }

  texture(canvas, repeat = true) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.maxAniso;
    if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
    return t;
  }

  setTheme(theme) {
    this.theme = theme;
    this.cBase = new THREE.Color(theme.block.base);
    this.cVowel = new THREE.Color(theme.vowel);
    this.cCons = new THREE.Color(theme.consonant);
    const r = this.renderer;
    r.toneMappingExposure = theme.exposure;
    r.setClearColor(theme.table);
    this.key.color.set(theme.light);
    this.hemi.groundColor.set(theme.ground);
    this.scene.environmentIntensity = theme.env;

    const tm = this.table.material;
    tm.color.set(theme.table);
    tm.needsUpdate = true;

    const bm = this.board.material;
    if (bm.map) bm.map.dispose();
    if (theme.boardMat === 'wood') {
      const tex = this.texture(this.woodCanvas(1024, 512, theme.board.top, theme.board.grain, 7, 230));
      bm.map = tex;
      bm.color.set('#ffffff');
      bm.roughness = 0.68;
    } else {
      bm.map = null;
      bm.color.set(theme.board.top);
      bm.roughness = 0.38;
    }
    bm.needsUpdate = true;

    if (this.blockTex) this.blockTex.dispose();
    this.blockTex = theme.block.grainA || theme.mat === 'wood'
      ? this.texture(this.woodCanvas(256, 256, theme.block.base, theme.block.grain, 3, 90))
      : null;
    for (const t of this.letterCache.values()) t.dispose();
    this.letterCache.clear();
    for (const e of this.pieces.values()) this.dispose(e);
    this.pieces.clear();
  }

  baseMaterial(gi) {
    const t = this.theme;
    const b = t.block;
    const rnd = mulberry32(gi * 977 + 13);
    let m;
    if (t.mat === 'wood' && this.blockTex) {
      const tex = this.blockTex.clone();
      tex.offset.set(rnd(), rnd());
      tex.needsUpdate = true;
      m = new THREE.MeshStandardMaterial({ map: tex, color: new THREE.Color().setHSL(0.09, 0.12 * rnd(), 0.93 + 0.07 * rnd()), roughness: 0.6 });
    } else if (t.mat === 'candy') {
      m = new THREE.MeshPhysicalMaterial({ color: b.base, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
    } else if (t.mat === 'gloss') {
      const tex = this.blockTex ? this.blockTex.clone() : null;
      if (tex) { tex.offset.set(rnd(), rnd()); tex.needsUpdate = true; }
      m = new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: tex, roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    } else if (t.mat === 'neon') {
      m = new THREE.MeshStandardMaterial({ color: b.base, roughness: 0.4, metalness: 0.2, emissive: t.glow, emissiveIntensity: 0.08 });
    } else {
      m = new THREE.MeshStandardMaterial({ color: b.base, roughness: 0.9 });
    }
    return m;
  }

  paintMaterial(color) {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.18 });
  }

  letterTexture(ch, ink) {
    const key = `${ch}|${ink}`;
    let t = this.letterCache.get(key);
    if (t) return t;
    const W = 340;
    const H = Math.round((W * (TILE.h - 0.03)) / (TILE.w - 0.03));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    const light = isLight(ink);
    // engraved border of the block's face
    const m = 18;
    x.lineWidth = 5;
    x.strokeStyle = light ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,.5)';
    roundRectPath(x, m + 2, m + 2, W - 2 * m, H - 2 * m, 26); x.stroke();
    x.strokeStyle = light ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.2)';
    roundRectPath(x, m, m, W - 2 * m, H - 2 * m, 26); x.stroke();
    if (this.theme && this.theme.block.outline) {
      x.strokeStyle = this.theme.block.outline;
      x.lineWidth = 9;
      roundRectPath(x, m - 6, m - 6, W - 2 * m + 12, H - 2 * m + 12, 30); x.stroke();
    }
    x.font = `700 ${Math.round(H * 0.98)}px ${FONT}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const ty = H * 0.54;
    x.fillStyle = light ? 'rgba(0,0,0,.34)' : 'rgba(255,255,255,.6)';
    x.fillText(ch, W / 2 + 3, ty + 4);
    x.fillStyle = ink;
    x.fillText(ch, W / 2, ty);
    t = this.texture(c, false);
    this.letterCache.set(key, t);
    return t;
  }

  // ---------- sizing & framing ----------
  resize(W, H, margins) {
    this.size = { W, H };
    this.margins = margins;
    this.renderer.setPixelRatio(this.low ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(W, H, false);
    const sm = this.low ? 512 : W < 700 ? 1024 : 2048;
    if (this.key.shadow.mapSize.x !== sm) {
      this.key.shadow.mapSize.set(sm, sm);
      if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
    }
  }

  // Fit the camera so the whole board sits inside the free area (between the top bar and the toolbar).
  fit(nLetters) {
    const { W, H } = this.size;
    const m = this.margins;
    // On a tall (phone) screen there is spare height but little width: a narrower, deeper board keeps the
    // tiles big enough to slice.
    const portrait = W / H < 0.8;
    const bx = Math.max(nLetters * TILE.w * 0.62, portrait ? 0.9 : 1.25);
    const bz = 0.55; // blocks only move left/right, so the board only needs to be a little deeper than a block
    this.bx = bx;
    this.bz = bz;
    const cam = this.camera;
    cam.aspect = W / H;
    cam.fov = FOV;
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    const target = new THREE.Vector3(0, 0.1, 0);
    const corners = [[-bx, 0, -bz], [bx, 0, -bz], [bx, 0, bz], [-bx, 0, bz]].map((c) => new THREE.Vector3(...c));
    const place = (D) => {
      cam.position.set(0, target.y + Math.sin(ELEV) * D, Math.cos(ELEV) * D);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
    };
    const bbox = () => {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const c of corners) {
        const p = c.clone().project(cam);
        const px = (p.x * 0.5 + 0.5) * W;
        const py = (-p.y * 0.5 + 0.5) * H;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      return { x0, x1, y0, y1 };
    };
    const L = m.left, R = W - m.right, T = m.top, B = H - m.bottom;
    let lo = 1.2;
    let hi = 90;
    for (let i = 0; i < 34; i++) {
      const D = (lo + hi) / 2;
      place(D);
      const b = bbox();
      if (b.x0 >= L && b.x1 <= R && b.y0 >= T && b.y1 <= B) hi = D; else lo = D;
    }
    place(hi);
    const b = bbox();
    const sx = (L + R) / 2 - (b.x0 + b.x1) / 2;
    const sy = (T + B) / 2 - (b.y0 + b.y1) / 2;
    cam.setViewOffset(W, H, -sx, -sy, W, H);
    cam.updateMatrixWorld(true);

    // board + lights follow the board size
    this.board.geometry.dispose();
    this.board.geometry = new RoundedBoxGeometry(2 * bx + 0.14, BOARD_T, 2 * bz + 0.14, 3, 0.03);
    this.board.position.set(0, -BOARD_T / 2, 0);
    const dir = new THREE.Vector3(-0.5, 0.82, 0.42).normalize();
    this.key.position.copy(dir.multiplyScalar(9));
    this.key.target.position.set(0, 0, 0);
    const Rr = Math.hypot(bx, bz) + 0.7;
    const sc = this.key.shadow.camera;
    sc.left = -Rr; sc.right = Rr; sc.top = Rr; sc.bottom = -Rr; sc.near = 1; sc.far = 24;
    sc.updateProjectionMatrix();
    return { bx, bz };
  }

  // ---------- projection / picking helpers (screen px <-> world) ----------
  project(v) {
    const p = _v.copy(v).project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.size.W, y: (-p.y * 0.5 + 0.5) * this.size.H, z: p.z };
  }

  pxPerMeter(v) {
    const a = this.project(v);
    const r = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const b = this.project(new THREE.Vector3().copy(v).add(r));
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  ray(sx, sy) {
    const ndc = new THREE.Vector2((sx / this.size.W) * 2 - 1, -(sy / this.size.H) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  // Which tile is under the pointer: {body, index, point}
  pick(sx, sy) {
    this.scene.updateMatrixWorld(true); // input arrives between frames; do not pick against last frame's pose
    this.ray(sx, sy);
    const hits = this.raycaster.intersectObjects(this.tileMeshes, false);
    if (!hits.length) return null;
    const h = hits[0];
    const e = this.pieces.get(h.object.userData.bodyId);
    if (!e) return null;
    return { body: e.body, index: h.object.userData.index, point: h.point.clone() };
  }

  // Where the pointer ray crosses the plane of a piece's front face, in that piece's local metres.
  faceHit(body, sx, sy) {
    const r = this.ray(sx, sy);
    _qi.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w).invert();
    const o = new THREE.Vector3().copy(r.origin).sub(body.position).applyQuaternion(_qi);
    const d = new THREE.Vector3().copy(r.direction).applyQuaternion(_qi);
    if (Math.abs(d.z) < 1e-6) return null;
    const t = (TILE.d / 2 - o.z) / d.z;
    if (t < 0) return null;
    return { lx: o.x + d.x * t, ly: o.y + d.y * t };
  }

  faceToWorld(body, lx, ly, lz = TILE.d / 2) {
    _q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    return new THREE.Vector3(lx, ly, lz).applyQuaternion(_q).add(body.position);
  }

  planeHit(sx, sy, y) {
    const r = this.ray(sx, sy);
    if (Math.abs(r.direction.y) < 1e-6) return null;
    const t = (y - r.origin.y) / r.direction.y;
    if (t < 0) return null;
    return new THREE.Vector3().copy(r.origin).addScaledVector(r.direction, t);
  }

  // ---------- per-frame sync ----------
  build(body) {
    const p = body.piece;
    const group = new THREE.Group();
    const vis = new THREE.Group();
    group.add(vis);
    const tiles = [];
    for (let i = 0; i < p.len; i++) {
      const gi = p.start + i;
      const baseMat = this.baseMaterial(gi);
      const mesh = new THREE.Mesh(this.tileGeo, baseMat);
      mesh.position.x = -(p.len * TILE.w) / 2 + (i + 0.5) * TILE.w;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { bodyId: body.id, index: i };
      const decalMat = new THREE.MeshStandardMaterial({
        map: this.letterTexture(this.game.letters[gi].ch, this.theme.block.ink),
        transparent: true, roughness: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const decal = new THREE.Mesh(this.decalGeo, decalMat);
      decal.position.z = (TILE.d * 0.992) / 2 + 0.0006;
      mesh.add(decal);
      vis.add(mesh);
      tiles.push({ mesh, decalMat, baseMat, paintMat: null, gi, state: 'n' });
    }
    this.scene.add(group);
    const e = { group, vis, tiles, body };
    this.pieces.set(body.id, e);
    return e;
  }

  dispose(e) {
    this.scene.remove(e.group);
    for (const t of e.tiles) {
      if (t.baseMat.map) t.baseMat.map.dispose();
      t.baseMat.dispose();
      if (t.paintMat) t.paintMat.dispose();
      t.decalMat.dispose();
    }
  }

  sync(now) {
    const game = this.game;
    const th = this.theme;
    const bodies = game.physics.pieces();
    const alive = new Set();
    for (const body of bodies) {
      alive.add(body.id);
      const e = this.pieces.get(body.id) || this.build(body);
      const p = body.piece;
      e.group.position.set(body.position.x, body.position.y, body.position.z);
      e.group.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      const sq = p.sq;
      e.vis.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.3);
      e.vis.position.y = -(TILE.h / 2) * sq;
      const calm = body.velocity.lengthSquared() < 0.01 && !game.reduced;
      for (const t of e.tiles) {
        const letter = game.letters[t.gi];
        const want = letter.paint ? `p${letter.paint}` : 'n';
        if (want !== t.state) {
          t.state = want;
          if (letter.paint) {
            const col = letter.paint === 'v' ? th.vowel : th.consonant;
            if (t.paintMat) t.paintMat.dispose();
            t.paintMat = this.paintMaterial(col);
            t.mesh.material = t.paintMat;
            t.decalMat.map = this.letterTexture(letter.ch, isLight(col) ? '#1b1b1b' : '#ffffff');
          } else {
            t.mesh.material = t.baseMat;
            t.decalMat.map = this.letterTexture(letter.ch, th.block.ink);
          }
          t.decalMat.needsUpdate = true;
        }
        let s = 1;
        if (t.paintMat) {
          // Always set the colour (not only mid-animation), so a reveal that finishes between two
          // rendered frames still ends on the full paint colour.
          const done = letter.paintT >= 1;
          const k = done ? 1 : clamp(easeOutBack(clamp(letter.paintT, 0, 1)), 0, 1);
          const target = letter.paint === 'v' ? this.cVowel : this.cCons;
          t.paintMat.color.copy(this.cBase).lerp(target, k);
          t.paintMat.emissive.copy(target);
          t.paintMat.emissiveIntensity = done ? 0 : (1 - letter.paintT) * 0.5;
          if (!done) s = 1 + 0.1 * Math.sin(Math.PI * clamp(letter.paintT, 0, 1));
        }
        if (calm && s === 1) s = 1 + 0.012 * Math.sin(now * 0.0022 + t.gi * 0.8);
        t.mesh.scale.y = s;
        t.mesh.position.y = ((s - 1) * TILE.h) / 2;
      }
    }
    for (const [id, e] of this.pieces) {
      if (!alive.has(id)) { this.dispose(e); this.pieces.delete(id); }
    }
    this.tileMeshes = [];
    for (const e of this.pieces.values()) for (const t of e.tiles) this.tileMeshes.push(t.mesh);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
