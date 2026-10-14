// Pointer handling for mouse, touch and pen. The knife (and the blade trail) lives here; what a
// stroke *does* is decided by the game, depending on the active tool.
export class Input {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.x = -999;
    this.y = -999;
    this.inside = false;
    this.down = false;
    this.pointerType = 'mouse';
    this.trail = [];
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.angle = Math.atan2(1, 0.35); // direction the knife tip points
    this.downAt = 0;
    this.moved = 0;

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('pointerenter', () => { this.inside = true; });
    canvas.addEventListener('pointerleave', () => { if (!this.down) this.inside = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onDown(e) {
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* not fatal */ }
    this.game.unlockAudio();
    const p = this.pos(e);
    this.pointerType = e.pointerType;
    this.inside = true;
    this.down = true;
    this.x = p.x;
    this.y = p.y;
    this.downAt = performance.now();
    this.moved = 0;
    this.trail.length = 0;
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.trail.push({ x: p.x, y: p.y, t: e.timeStamp });
    if (this.game.tool === 'hand') this.game.grabAt(p.x, p.y);
    else if (this.game.tool !== 'knife') this.game.paintAt(p.x, p.y);
  }

  onMove(e) {
    this.pointerType = e.pointerType;
    this.inside = true;
    const co = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const list = co.length ? co : [e];
    for (const ev of list) this.step(ev);
  }

  step(ev) {
    const p = this.pos(ev);
    const px = this.x;
    const py = this.y;
    this.x = p.x;
    this.y = p.y;
    if (!this.down) return;
    const dist = Math.hypot(p.x - px, p.y - py);
    if (dist < 0.01) return;
    this.moved += dist;
    this.trail.push({ x: p.x, y: p.y, t: ev.timeStamp });
    this.velocity(ev.timeStamp);
    if (this.game.tool === 'knife') {
      this.game.onBlade(px, py, p.x, p.y, this.vx, this.vy, this.speed);
    } else if (this.game.tool === 'hand') {
      this.game.dragTo(p.x, p.y);
    } else {
      const n = Math.max(1, Math.ceil(dist / 8));
      for (let i = 1; i <= n; i++) this.game.paintAt(px + ((p.x - px) * i) / n, py + ((p.y - py) * i) / n);
    }
  }

  // Velocity over roughly the last 90 ms of the stroke, which smooths out jittery mouse samples.
  velocity(t) {
    const cur = this.trail[this.trail.length - 1];
    let old = this.trail[0];
    for (let i = this.trail.length - 2; i >= 0; i--) {
      old = this.trail[i];
      if (t - this.trail[i].t >= 90) break;
    }
    const dt = Math.max(8, t - old.t) / 1000;
    this.vx = (cur.x - old.x) / dt;
    this.vy = (cur.y - old.y) / dt;
    this.speed = Math.hypot(this.vx, this.vy);
    if (this.speed > 90) {
      const target = Math.atan2(this.vy, this.vx);
      let d = target - this.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.angle += d * 0.45;
    }
  }

  onUp(e) {
    if (!this.down) return;
    this.down = false;
    if (this.game.tool === 'hand') this.game.release();
    if (e.pointerType === 'touch') this.inside = false;
    const quick = performance.now() - this.downAt < 350;
    if (quick && this.moved < 10 && this.game.tool === 'knife') this.game.tapAt(this.x, this.y);
    this.speed = 0;
  }

  prune(nowMs) {
    while (this.trail.length && nowMs - this.trail[0].t > 260) this.trail.shift();
  }
}
