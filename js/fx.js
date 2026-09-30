'use strict';
// Particles (smoke, muzzle fire, splashes, splinters) + lightning. All particles are simulated on the CPU with real forces.
class FX {
  constructor() {
    this.ps = []; this.flash = 0; this.flashDir = [0, 0.4, 1]; this.bolt = null; this.nextBolt = 3; this.pulses = []; this.t = 0;
    this.rnd = Math.random; this.boltEvery = 8; this.onThunder = null; this.shake = 0; this.max = 7000;
    this.buf = [new Float32Array(12 * 8000), new Float32Array(12 * 8000)];
    this.lights = []; this.lightArr = new Float32Array(24); this.trailT = new WeakMap(); this.fireT = 0;
  }
  addLight(p, I, dur) { this.lights.push({ p: p.slice(), I, t: dur, d: dur }); if (this.lights.length > 24) this.lights.shift(); }
  packLights(cam) {
    const a = this.lightArr; a.fill(0);
    const sc = this.lights.map(l => ({ l, k: l.I * (l.t / l.d) / (1 + ((l.p[0] - cam[0]) ** 2 + (l.p[2] - cam[2]) ** 2) / 4e4) })).sort((x, y) => y.k - x.k).slice(0, 6);
    sc.forEach((o, i) => a.set([o.l.p[0], o.l.p[1], o.l.p[2], o.l.I * (o.l.t / o.l.d)], i * 4));
    return { n: sc.length, arr: a };
  }
  // cannonballs: a dark dot (size grows with distance so it stays visible) + a thin smoke trail
  updateBalls(balls, dt, cam) {
    const r = this.rnd;
    for (const b of balls) {
      const d = Math.hypot(b.p[0] - cam[0], b.p[1] - cam[1], b.p[2] - cam[2]);
      this.P(3, b.p, [0, 0, 0], Math.max(0.16, d * 0.0028), 0, Math.max(dt * 1.6, 0.03), [0.03, 0.03, 0.035], 1, { fade: 0 });
      let tt = (this.trailT.get(b) || 0) - dt;
      if (tt <= 0) { tt = 0.035; this.P(0, b.p, [(r() - 0.5) * 0.6, 0.2, (r() - 0.5) * 0.6], 0.16, 0.9, 1.6, [0.34, 0.34, 0.35], 0.16, { drag: 0.8, wind: 0.3 }); }
      this.trailT.set(b, tt);
    }
  }
  // musket volley from the rail facing the target
  musket(ship, tgt) {
    const r = this.rnd, l = ship.toLocal(tgt.com), side = l[0] >= 0 ? 1 : -1, sv = ship.vel;
    for (let i = 0; i < 3; i++) {
      const z = (-12 + r() * 27) * ship.s, p = ship.toWorld([side * (5.2 * ship.s), (11.5 + r() * 1.2) * ship.s, z]);
      this.P(1, p, sv, 0.5, 2, 0.08, [4, 3, 1.2], 1, { add: 1 });
      this.P(0, p, [sv[0] * 0.6 + (r() - 0.5) * 2, 1.5, sv[2] * 0.6 + (r() - 0.5) * 2], 0.35, 0.8, 2 + r() * 1.5, [0.32, 0.32, 0.33], 0.3, { drag: 1, wind: 0.6 });
    }
  }
  // a musket shot: flash + smoke at the muzzle, a streak along the path, sparks / splash where it lands
  tracer(p0, p1, hit) {
    const r = this.rnd, d = V3.sub(p1, p0), L = V3.len(d) || 1, n = Math.min(14, (L / 6) | 0);
    this.P(1, p0, [0, 0, 0], 0.45, 2, 0.09, [5, 3.4, 1.4], 1, { add: 1 }); this.addLight(p0, 25, 0.08);
    for (let i = 0; i < 3; i++) this.P(0, p0, [d[0] / L * 3 + (r() - 0.5), 0.5, d[2] / L * 3 + (r() - 0.5)], 0.25, 0.9, 1.8 + r(), [0.36, 0.36, 0.37], 0.3, { drag: 1, wind: 0.6 });
    for (let i = 1; i <= n; i++) { const f = i / (n + 1); this.P(1, [p0[0] + d[0] * f, p0[1] + d[1] * f, p0[2] + d[2] * f], [0, 0, 0], 0.07, 0, 0.1, [2.2, 1.8, 1], 0.7, { add: 1 }); }
    if (hit === 'water') { for (let i = 0; i < 6; i++) this.P(2, p1, [(r() - 0.5) * 3, 2 + r() * 3, (r() - 0.5) * 3], 0.12 + r() * 0.12, 0.3, 0.6, [0.7, 0.75, 0.78], 0.7, { grav: 9.8, water: 1 }); }
    else if (hit) { for (let i = 0; i < 8; i++) this.P(3, p1, [(r() - 0.5) * 6, 1 + r() * 4, (r() - 0.5) * 6], 0.04 + r() * 0.05, 0, 0.8, [0.55, 0.12, 0.08], 1, { grav: 9.8 }); this.P(1, p1, [0, 0, 0], 0.3, 1.5, 0.08, [3, 2, 1], 1, { add: 1 }); }
  }
  // sword clashes while two ships are lashed together
  melee(a, b, dt) {
    this.meleeT = (this.meleeT || 0) - dt; if (this.meleeT > 0) return; this.meleeT = 0.09; const r = this.rnd;
    const m = [(a.com[0] + b.com[0]) / 2, (a.com[1] + b.com[1]) / 2 + 11 * a.s, (a.com[2] + b.com[2]) / 2];
    for (let i = 0; i < 2; i++) {
      const p = [m[0] + (r() - 0.5) * 14 * a.s, m[1] + r() * 1.5, m[2] + (r() - 0.5) * 20 * a.s];
      this.P(1, p, [(r() - 0.5) * 6, 2 + r() * 4, (r() - 0.5) * 6], 0.12, 0, 0.18, [3, 2.4, 1.2], 1, { add: 1, grav: 9 });
    }
    if (r() < 0.12) { const p = [m[0] + (r() - 0.5) * 10, m[1], m[2] + (r() - 0.5) * 16]; this.P(0, p, [0, 1, 0], 0.5, 0.6, 1.6, [0.3, 0.3, 0.3], 0.25, { drag: 1, wind: 0.5 }); return true; }
  }
  // bow spray, stern wash and the boiling sea above a sinking ship
  shipFX(s, dt, t, wind) {
    if (s.dead) return; const r = this.rnd, sp = Math.hypot(s.vel[0], s.vel[2]);
    if (!s.sunk && sp > 2.2) {
      const bow = s.toWorld([0, 3 * s.s, 23 * s.s]), hw = Waves.height(bow[0], bow[2], t), vy = s.pointVel(bow)[1];
      const n = sp * (0.5 + Math.max(0, -vy) * 1.6 + (bow[1] < hw + 1.2 ? 2 : 0)) * dt * s.s * 14, fw = [s.R[2], 0, s.R[8]];
      for (let i = 0; i < n; i++) { const side = r() < 0.5 ? -1 : 1, sideV = s.toWorld([side * 4 * s.s, 0, 18 * s.s]); this.P(2, [bow[0] + (r() - 0.5) * 2, hw + 0.2, bow[2] + (r() - 0.5) * 2], [fw[0] * sp * 0.6 + (sideV[0] - s.com[0]) * 0.15 + (r() - 0.5) * 2, 2 + r() * (2 + sp * 0.5), fw[2] * sp * 0.6 + (sideV[2] - s.com[2]) * 0.15 + (r() - 0.5) * 2], 0.18 + r() * 0.35, 0.5, 0.7 + r() * 0.7, [0.7, 0.76, 0.78], 0.6, { grav: 9.8, drag: 0.3, water: 1 }); }
    }
    if (s.sunk && s.com[1] > -24) { // air and foam bursting up from the wreck
      const n = 26 * dt * s.s; for (let i = 0; i < n; i++) { const p = s.toWorld([(r() - 0.5) * 8 * s.s, 0, (r() - 0.5) * 40 * s.s]), hw = Waves.height(p[0], p[2], t);
        this.P(2, [p[0], hw + 0.1, p[2]], [(r() - 0.5) * 3, 3 + r() * 7, (r() - 0.5) * 3], 0.35 + r() * 0.6, 0.6, 0.8 + r() * 0.9, [0.78, 0.84, 0.86], 0.75, { grav: 9.8, drag: 0.2, water: 1 }); if (r() < 0.15) this.P(0, [p[0], hw + 0.5, p[2]], [0, 1, 0], 1.6, 2.2, 3, [0.6, 0.66, 0.68], 0.35, { drag: 1, wind: 0.4 }); }
    }
  }
  sinkBurst(s, t) {
    const r = this.rnd; for (let i = 0; i < 45; i++) { const p = s.toWorld([(r() - 0.5) * 6 * s.s, 2, (r() - 0.5) * 40 * s.s]), hw = Waves.height(p[0], p[2], t); this.P(2, [p[0], hw + 0.3, p[2]], [(r() - 0.5) * 8, 6 + r() * 12, (r() - 0.5) * 8], 0.5 + r() * 0.9, 1, 1.3 + r(), [0.8, 0.86, 0.88], 0.8, { grav: 9.8, drag: 0.2, water: 1 }); }
    for (let i = 0; i < 6; i++) { const p = s.toWorld([(r() - 0.5) * 6, 6 * s.s, (r() - 0.5) * 30 * s.s]); this.P(0, p, [(r() - 0.5) * 4, 4 + r() * 4, (r() - 0.5) * 4], 3, 3.5, 6, [0.5, 0.5, 0.52], 0.45, { drag: 0.8, wind: 0.5 }); }
    this.shake = Math.min(1, this.shake + 0.35);
  }
  // seagulls wheeling above the fleet in calm weather
  updateBirds(dt, cam, env, t) {
    const want = env.rain < 400 && env.wind < 16 && env.light > 0.5 ? 9 : 0; const B = this.birds || (this.birds = []);
    while (B.length < want) B.push({ a: this.rnd() * 6.28, r: 70 + this.rnd() * 160, h: 28 + this.rnd() * 50, w: 0.15 + this.rnd() * 0.25, ph: this.rnd() * 6, s: 1.1 + this.rnd() * 0.6 });
    while (B.length > want) B.pop();
    for (const b of B) { b.a += b.w * dt; const x = cam[0] + Math.cos(b.a) * b.r, z = cam[2] + Math.sin(b.a) * b.r, y = b.h + Math.sin(t * 0.3 + b.ph) * 4; const d = Math.hypot(x - cam[0], y - cam[1], z - cam[2]);
      this.P(4, [x, y, z], [0, 0, 0], Math.max(0.7, 0.75 * b.s), 0, Math.max(dt * 1.6, 0.03), [0.9, 0.9, 0.92], 0.95, { fade: 0 }).seed = t * (7 + b.ph) + b.ph; }
  }
  // burning hull: flames + black smoke
  burn(ship, dt, wind) {
    if (!ship.fires || !ship.fires.length) return; this.fireT -= dt; if (this.fireT > 0) return; this.fireT = 0.045; const r = this.rnd;
    for (const f of ship.fires) {
      const p = ship.toWorld(f.p), k = Math.min(1, f.t / 4);
      this.P(1, [p[0] + (r() - 0.5) * 1.2, p[1], p[2] + (r() - 0.5) * 1.2], [(r() - 0.5) * 1.5, 3 + r() * 3, (r() - 0.5) * 1.5], 0.7 + r() * 0.6, 0.6, 0.5 + r() * 0.4, [2.6, 1.0, 0.25], 0.8 * k, { add: 1, drag: 0.5 });
      this.P(0, [p[0], p[1] + 1, p[2]], [wind[0] * 0.2, 4 + r() * 3, wind[2] * 0.2], 0.8, 1.6 + r(), 5 + r() * 3, [0.05, 0.05, 0.055], 0.45 * k + 0.1, { drag: 0.6, wind: 0.6 });
      this.addLight(p, 14 * k, 0.1);
    }
  }
  add(p) { if (this.ps.length >= this.max) this.ps.shift(); this.ps.push(p); return p; }
  P(kind, pos, vel, size, grow, life, col, a0, o = {}) {
    return this.add({ x: pos[0], y: pos[1], z: pos[2], vx: vel[0], vy: vel[1], vz: vel[2], size, grow, age: 0, life, r: col[0], g: col[1], b: col[2], a0, add: o.add ? 1 : 0, kind, drag: o.drag ?? 0, grav: o.grav ?? 0, wind: o.wind ?? 0, rot: this.rnd() * 6.28, seed: this.rnd(), spin: o.spin ?? (this.rnd() - 0.5), water: o.water ?? 0, fade: o.fade ?? 1 });
  }
  muzzle(pos, dir, ship) {
    const r = this.rnd, sv = ship.pointVel(pos);
    this.P(1, pos, sv, 3.4, 6, 0.13, [6, 3.6, 1.3], 1, { add: 1 }); this.addLight(pos, 110, 0.14);
    for (let i = 0; i < 9; i++) { const sp = 25 + r() * 55; this.P(1, [pos[0] + dir[0] * r() * 2, pos[1] + dir[1] * r() * 2, pos[2] + dir[2] * r() * 2], [dir[0] * sp + sv[0] + (r() - 0.5) * 12, dir[1] * sp + (r() - 0.5) * 12, dir[2] * sp + sv[2] + (r() - 0.5) * 12], 0.8 + r() * 0.8, 2.5, 0.12 + r() * 0.16, [3.2, 1.7, 0.6], 0.9, { add: 1, drag: 3 }); }
    for (let i = 0; i < 18; i++) {
      const sp = 6 + r() * 34; const lit = 0.17 + r() * 0.07;
      this.P(0, [pos[0] + dir[0] * r() * 2.5, pos[1] + dir[1] * r() * 2.5, pos[2] + dir[2] * r() * 2.5], [dir[0] * sp + sv[0] * 0.6 + (r() - 0.5) * 6, dir[1] * sp * 0.6 + r() * 3, dir[2] * sp + sv[2] * 0.6 + (r() - 0.5) * 6], 1.5 + r() * 1.2, 1.3 + r() * 1.6, 5 + r() * 6, [lit, lit * 0.98, lit * 0.95], 0.4, { drag: 1.3, wind: 0.5 + r() * 0.4, grav: -0.25 });
    }
  }
  hit(pos, vel, ship, kind, power) {
    const r = this.rnd, n = kind === 'break' ? 40 : 14;
    this.P(1, pos, [0, 0, 0], 0.9 * power + 0.6, 3, 0.09, [4, 2.2, 0.8], 1, { add: 1 }); this.addLight(pos, 30 * power, 0.1);
    for (let i = 0; i < n * power; i++) {
      const sp = 3 + r() * 16 * power; this.P(3, pos, [(r() - 0.5) * sp + ship.vel[0], r() * sp * 0.9 + 1, (r() - 0.5) * sp + ship.vel[2]], 0.05 + r() * 0.11, 0, 1.4 + r() * 1.6, kind === 'sail' ? [0.7, 0.66, 0.55] : [0.32, 0.21, 0.11], 1, { grav: 9.8, drag: 0.4 });
    }
    for (let i = 0; i < (kind === 'sail' ? 3 : 7); i++) this.P(0, pos, [(r() - 0.5) * 5 + ship.vel[0] * 0.5, r() * 3 + 1, (r() - 0.5) * 5 + ship.vel[2] * 0.5], 0.5 + r() * 0.5, 0.9, 2 + r() * 2, [0.2, 0.17, 0.14], 0.38, { drag: 1.2, wind: 0.6 });
    this.shake = Math.min(1, this.shake + 0.08 * power);
  }
  splash(pos, power, vel) {
    const r = this.rnd, n = 10 + 46 * power;
    for (let i = 0; i < n; i++) {
      const up = (4 + r() * 20) * power, a = r() * 6.28, sp = (r() * 5) * power;
      this.P(2, [pos[0] + Math.cos(a) * r() * 0.6, pos[1] + 0.1, pos[2] + Math.sin(a) * r() * 0.6], [Math.cos(a) * sp + vel[0] * 0.03, up, Math.sin(a) * sp + vel[2] * 0.03], 0.25 + r() * 0.5 * power + 0.2, 0.8, 1.2 + r() * 1.3, [0.5, 0.55, 0.57], 0.7, { grav: 9.8, drag: 0.15, water: 1 });
    }
    this.P(0, [pos[0], pos[1] + 0.5, pos[2]], [0, 2 * power, 0], 1.3 * power + 0.6, 2.2 * power + 1, 2.4, [0.34, 0.38, 0.4], 0.4, { drag: 1, wind: 0.5 });
  }
  update(dt, t, wind, camPos) {
    if (dt <= 0) return; this.t += dt;
    for (const l of this.lights) l.t -= dt; this.lights = this.lights.filter(l => l.t > 0); const S = Waves;
    for (const p of this.ps) {
      p.age += dt; if (p.age > p.life) { p.dead = true; continue; }
      if (p.drag) { const k = Math.min(1, p.drag * dt), wx = p.wind ? wind[0] * p.wind : 0, wz = p.wind ? wind[2] * p.wind : 0; p.vx += (wx - p.vx) * k; p.vz += (wz - p.vz) * k; p.vy += (0 - p.vy) * k * (p.kind === 0 ? 1 : 0.3); }
      else if (p.wind) { p.vx += (wind[0] * p.wind - p.vx) * dt; p.vz += (wind[2] * p.wind - p.vz) * dt; }
      p.vy -= p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.size += p.grow * dt * (p.kind === 0 ? Math.max(0.1, 1 - p.age / p.life) : 1); p.rot += p.spin * dt;
      if (p.water && p.vy < 0 && p.y < S.height(p.x, p.z, t)) p.dead = true;
    }
    this.ps = this.ps.filter(p => !p.dead);
    // lightning
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) { if (this.boltEvery > 0) this.strike(camPos); this.nextBolt = (this.boltEvery || 8) * (0.6 + this.rnd() * 0.9); }
    let f = 0; for (const q of this.pulses) { q.t -= dt; if (q.t < 0) { const k = -q.t; f = Math.max(f, q.a * Math.exp(-k * 6)); } }
    this.pulses = this.pulses.filter(q => q.t > -0.6);
    this.flash = f; if (this.bolt) { this.bolt.age += dt; this.bolt.a = f > 0.05 ? Math.min(1, f + 0.2) * (0.6 + 0.4 * Math.sin(this.bolt.age * 90)) : 0; if (this.bolt.age > 0.5) this.bolt = null; }
    this.shake = Math.max(0, this.shake - dt * 1.5);
  }
  strike(cam) {
    const r = this.rnd, a = r() * 6.28, d = 500 + r() * 900; const cx = cam[0] + Math.cos(a) * d, cz = cam[2] + Math.sin(a) * d;
    const v = []; const seg = (p, q) => v.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    const bolt = (p0, p1, depth, jag) => {
      const n = 14; let prev = p0;
      for (let i = 1; i <= n; i++) {
        const f = i / n; const j = jag * (1 - f * 0.5);
        const p = [lerp(p0[0], p1[0], f) + (r() - 0.5) * j, lerp(p0[1], p1[1], f), lerp(p0[2], p1[2], f) + (r() - 0.5) * j]; if (i === n) { p[0] = p1[0]; p[2] = p1[2]; }
        seg(prev, p); if (depth > 0 && r() < 0.16) bolt(p, [p[0] + (r() - 0.5) * 300, p[1] - 150 - r() * 200, p[2] + (r() - 0.5) * 300], depth - 1, jag * 0.5); prev = p;
      }
    };
    bolt([cx, 750, cz], [cx + (r() - 0.5) * 60, 0, cz + (r() - 0.5) * 60], 2, 90);
    this.bolt = { verts: new Float32Array(v), age: 0, a: 1 }; this.flashDir = V3.norm([cx - cam[0], 300, cz - cam[2]]);
    const s = this.t; this.pulses = [{ t: 0, a: 1.0 }, { t: 0.11, a: 0.55 }, { t: 0.2, a: 1.15 }, { t: 0.45 + r() * 0.2, a: 0.4 }];
    if (this.onThunder) this.onThunder(d);
  }
  draw(R, vp, view, fr) {
    const gl = R.gl; const p = R.pPart.use(); p.m('uVP', vp); p.f('uRight', ...view.right); p.f('uUp', ...view.up);
    const bufs = [[], []]; let n = [0, 0];
    // draw far-to-near for the alpha batch
    const cp = fr.cam.pos; const list = this.ps.slice();
    const lk = clamp(Math.sqrt(fr.env.light) * 0.85 + 0.15, 0.22, 1.7), sm = Math.max(...fr.env.sun, 0.01), tn = fr.env.sun.map(x => lerp(1, x / sm, 0.4));
    for (const q of list) q.d = (q.x - cp[0]) ** 2 + (q.y - cp[1]) ** 2 + (q.z - cp[2]) ** 2;
    list.sort((a, b) => b.d - a.d);
    for (const q of list) {
      const k = q.add ? 1 : 0; if (n[k] >= 8000) continue; const b = this.buf[k], o = n[k]++ * 12; const f = 1 - q.age / q.life; const al = q.a0 * (q.kind === 0 ? Math.min(1, q.age * 6) * f * f : Math.pow(f, q.fade * (q.add ? 1.5 : 1)));
      b[o] = q.x; b[o + 1] = q.y; b[o + 2] = q.z; b[o + 3] = q.size; b[o + 4] = q.r; b[o + 5] = q.g; b[o + 6] = q.b; b[o + 7] = al; b[o + 8] = q.kind === 4 ? 0 : q.rot; b[o + 9] = q.seed; b[o + 10] = q.kind; b[o + 11] = 0;
      if (!q.add && q.kind === 0) { const lit = lk * (1 + fr.flash * 2.5); b[o + 4] *= lit * tn[0]; b[o + 5] *= lit * tn[1]; b[o + 6] *= lit * tn[2]; }
    }
    for (let k = 0; k < 2; k++) {
      if (!n[k]) continue; if (k === 1) gl.blendFunc(gl.SRC_ALPHA, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      p.i('uAdd', k); gl.bindVertexArray(R.pvao[k].vao); gl.bindBuffer(gl.ARRAY_BUFFER, R.pvao[k].vb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.buf[k], 0, n[k] * 12);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n[k]);
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
}
