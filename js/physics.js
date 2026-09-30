'use strict';
// Rigid-body physics: buoyancy from the SAME wave function as the shader, sail forces, flooding, cannonballs, debris.
const RHO_W = 1025, RHO_A = 1.2;
const ALL_PORTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const SHIP_CLASSES = {
  sloop:   { key: 'sloop',   name: 'Şalopa',              s: 0.62, masts: [0, 1],    rows: 1, ports: [2, 3, 4, 5, 6], desc: 'Küçük, çevik, hızlı; az top, kolay batar', sailK: 1.35, crewFrac: 0.45 },
  frigate: { key: 'frigate', name: 'Fırkateyn',           s: 0.82, masts: [0, 1, 2], rows: 1, ports: ALL_PORTS,        desc: 'Dengeli: hız, manevra, orta ateş gücü', sailK: 1.15, crewFrac: 0.7 },
  line:    { key: 'line',    name: 'Hattı Harp Gemisi',   s: 1.0,  masts: [0, 1, 2], rows: 2, ports: ALL_PORTS,        desc: 'İki sıra top, ağır ve sağlam', sailK: 1.0, crewFrac: 1 },
  first:   { key: 'first',   name: 'Birinci Sınıf Kalyon', s: 1.18, masts: [0, 1, 2], rows: 2, ports: ALL_PORTS,        desc: 'Dev gövde, en çok top ve dayanıklılık; yavaş dönüş', sailK: 1.0, crewFrac: 1 },
};

class Body {
  constructor() {
    this.com = [0, 0, 0]; this.q = [0, 0, 0, 1]; this.vel = [0, 0, 0]; this.w = [0, 0, 0];
    this.c = [0, 0, 0]; this.M = 1; this.Iinv = Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);
    this.R = new Float64Array(9); this.F = [0, 0, 0]; this.T = [0, 0, 0];
  }
  // world position of local point
  toWorld(p) { const R = this.R, x = p[0] - this.c[0], y = p[1] - this.c[1], z = p[2] - this.c[2]; return [this.com[0] + R[0] * x + R[1] * y + R[2] * z, this.com[1] + R[3] * x + R[4] * y + R[5] * z, this.com[2] + R[6] * x + R[7] * y + R[8] * z]; }
  toLocal(p) { const l = M3.mulTV(this.R, [p[0] - this.com[0], p[1] - this.com[1], p[2] - this.com[2]]); return [l[0] + this.c[0], l[1] + this.c[1], l[2] + this.c[2]]; }
  dirWorld(d) { return M3.mulV(this.R, d); }
  pointVel(pw) { const rx = pw[0] - this.com[0], ry = pw[1] - this.com[1], rz = pw[2] - this.com[2], w = this.w; return [this.vel[0] + w[1] * rz - w[2] * ry, this.vel[1] + w[2] * rx - w[0] * rz, this.vel[2] + w[0] * ry - w[1] * rx]; }
  force(px, py, pz, fx, fy, fz) {
    this.F[0] += fx; this.F[1] += fy; this.F[2] += fz;
    const rx = px - this.com[0], ry = py - this.com[1], rz = pz - this.com[2];
    this.T[0] += ry * fz - rz * fy; this.T[1] += rz * fx - rx * fz; this.T[2] += rx * fy - ry * fx;
  }
  impulse(pw, J) {
    this.vel[0] += J[0] / this.M; this.vel[1] += J[1] / this.M; this.vel[2] += J[2] / this.M;
    const r = [pw[0] - this.com[0], pw[1] - this.com[1], pw[2] - this.com[2]];
    const tq = V3.cross(r, J); const Iw = M3.mul(M3.mul(this.R, this.Iinv), M3.T(this.R)); const a = M3.mulV(Iw, tq);
    this.w[0] += a[0]; this.w[1] += a[1]; this.w[2] += a[2];
  }
  // massPts: [{m, p:[x,y,z]}] local. Recomputes M, COM, inertia; keeps material origin fixed in space.
  setMass(pts, self) {
    let M = 0, cx = 0, cy = 0, cz = 0;
    for (const a of pts) { M += a.m; cx += a.m * a.p[0]; cy += a.m * a.p[1]; cz += a.m * a.p[2]; }
    cx /= M; cy /= M; cz /= M;
    let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
    for (const a of pts) {
      const x = a.p[0] - cx, y = a.p[1] - cy, z = a.p[2] - cz, m = a.m;
      ixx += m * (y * y + z * z); iyy += m * (x * x + z * z); izz += m * (x * x + y * y); ixy -= m * x * y; ixz -= m * x * z; iyz -= m * y * z;
    }
    if (self) { ixx += self[0]; iyy += self[1]; izz += self[2]; }
    // shift COM keeping the material origin fixed
    const dc = [cx - this.c[0], cy - this.c[1], cz - this.c[2]];
    if (this.M !== 1 || this._massInit) {
      const dW = M3.mulV(this.R, dc);
      // velocity of material point at the old COM must stay; new com moves
      const dv = V3.cross(this.w, dW);
      this.com[0] += dW[0]; this.com[1] += dW[1]; this.com[2] += dW[2];
      this.vel[0] += dv[0]; this.vel[1] += dv[1]; this.vel[2] += dv[2];
    }
    this._massInit = true;
    this.c = [cx, cy, cz]; this.M = M;
    this.Iinv = M3.inv(Float64Array.of(ixx, ixy, ixz, ixy, iyy, iyz, ixz, iyz, izz));
  }
  integrate(dt) {
    const M = this.M; this.vel[0] += this.F[0] / M * dt; this.vel[1] += this.F[1] / M * dt; this.vel[2] += this.F[2] / M * dt;
    const R = this.R; const Iw_inv = M3.mul(M3.mul(R, this.Iinv), M3.T(R));
    const Iw = M3.inv(Iw_inv); const w = this.w;
    const Iww = M3.mulV(Iw, w); const gyro = V3.cross(w, Iww);
    const a = M3.mulV(Iw_inv, [this.T[0] - gyro[0], this.T[1] - gyro[1], this.T[2] - gyro[2]]);
    w[0] += a[0] * dt; w[1] += a[1] * dt; w[2] += a[2] * dt;
    const wl = Math.hypot(w[0], w[1], w[2]); if (wl > 6) { const k = 6 / wl; w[0] *= k; w[1] *= k; w[2] *= k; }
    const dq = Q.mul([w[0], w[1], w[2], 0], this.q);
    this.q[0] += 0.5 * dt * dq[0]; this.q[1] += 0.5 * dt * dq[1]; this.q[2] += 0.5 * dt * dq[2]; this.q[3] += 0.5 * dt * dq[3];
    Q.norm(this.q); Q.toMat(this.q, this.R);
    this.com[0] += this.vel[0] * dt; this.com[1] += this.vel[1] * dt; this.com[2] += this.vel[2] * dt;
  }
  modelMatrix(out) { // local origin -> world
    const o = this.toWorld([0, 0, 0]); return M4.fromRT(this.R, o, out);
  }
}

const _ws = [0, 0, 0, 0, 0, 0], _pw = [0, 0, 0];

class Ship extends Body {
  constructor(id, team, name, x, z, heading, world, cls) {
    super();
    const C = this.cls = SHIP_CLASSES[cls] || SHIP_CLASSES.line, s = this.s = C.s;
    this.id = id; this.team = team; this.name = name; this.world = world; this.human = null; this.helm = null; this.gun = null; this.hn = ''; this.gn = ''; this.sailSet = 1; this.fires = [];
    this.crew = 1; this.board = null; this.captured = false; this.ctrlH = null; this.ctrlG = null; this.musketT = Math.random() * 2;
    this.cols = Hull.columns().map(c => ({ p: [c.p[0] * s, c.p[1] * s, c.p[2] * s], area: c.area * s * s, thick: c.thick * s, dz: c.dz * s, lat: c.lat }));
    this.gunDefs = Hull.guns().filter(g => g.row < C.rows && C.ports.includes(Hull.PORT_Z.indexOf(g.p[2]))).map(g => ({ ...g, p: [g.p[0] * s, g.p[1] * s, g.p[2] * s] }));
    this.crewMax = Math.round(9 * this.gunDefs.length + 30 * s);
    this.guns = this.gunDefs.map(g => ({ ...g, t: 6 + Math.random() * 14, alive: true }));
    this.masts = Hull.MASTS.map((m, i) => ({ i, hp: 100, alive: true, yard: 0, holes: [], sailHp: Hull.mastSails(i).map(() => 1), anchor: m.anchor, h: m.h, z: m.z })).filter(m => C.masts.includes(m.i));
    this.holes = []; this.ext = []; this.rudder = 0; this.sunk = false; this.dead = false; this.ai = { target: null, side: 0, timer: 0 };
    this.comp = [0, 1, 2, 3, 4].map(i => ({ z: (-20.8 + i * 10.4) * s, vol: 0, off: 0, area: 78 * s * s }));
    this.fullArea = this.masts.reduce((a, m) => a + Hull.mastSails(m.i).reduce((b, q) => b + (q.wb + q.wt) / 2 * (q.yt - q.yb), 0), 0);
    this.sailFrac = 1; this.billow = 0; this.jibSign = 1; this.flood = 0; this.hullMassDry = 0;
    // mass budget: displace draft 5.2 m at rest
    let disp = 0; for (const c of this.cols) disp += c.area * Math.max(0, Math.min(c.thick, 5.2 * s - c.p[1]));
    this.M0 = disp * RHO_W;
    this.buildMassPoints();
    // world state
    const R = M3.rotY(heading); // heading angle: yaw about +y, forward = (sin h, 0, cos h)
    this.q = Q.axis([0, 1, 0], heading); Q.toMat(this.q, this.R);
    this.setMass(this.massPts());
    const o = [x, -5.2 * s, z];
    const cw = M3.mulV(this.R, this.c); this.com = [o[0] + cw[0], o[1] + cw[1], o[2] + cw[2]];
    this.speed = 0; this.bobT = 0; this.wake = 0; this.spawnT = 0; this.fireFlash = 0; this.cool = 0;
    this.impactCount = 0; this.stats = { hits: 0, shots: 0 };
    this.holeCap = 90;
    this.hullHp = 1;
  }
  buildMassPoints() {
    const rest = []; const M = this.M0;
    const s = this.s, s3 = s * s * s; const gunM = this.gunDefs.length * 3400 * s3; const mastM = 26000 * s3 * this.masts.length;
    const stores = 90000 * s3;
    const fixed = gunM + mastM + stores;
    const target = 4.6 * s; // KG
    // hull structure at y=5.4, ballast at y=1.0: solve for the ballast mass
    let yFix = 0; // weighted y of fixed masses
    yFix += this.gunDefs.reduce((a, g) => a + 3400 * s3 * g.p[1], 0);
    this.masts.forEach(m => { yFix += 26000 * s3 * (m.anchor[1] + m.h * 0.42) * s; });
    yFix += stores * 4.0 * s;
    const rem = M - fixed; // hull + ballast
    const Mb = (rem * 5.4 * s - (M * target - yFix)) / ((5.4 - 1.0) * s);
    const Mh = rem - Mb;
    let zb = 0, vb = 0; for (const c of this.cols) { const v = c.area * Math.max(0, Math.min(c.thick, 5.2 * s - c.p[1])); zb += v * c.p[2]; vb += v; }
    this.dry = { Mh, Mb, gunM, mastM, stores, dz: (zb / vb) * M / Mb };
    this.hullM = Mh; this.ballastM = Mb;
  }
  massPts() {
    const pts = [];
    const { Mh, Mb } = this.dry, s = this.s, s3 = s * s * s;
    let ws = 0; const wts = []; for (let i = 0; i < 13; i++) { const f = 0.55 + 0.45 * Math.cos((-24 + i * 4) / 26 * 1.5); wts.push(f); ws += f; }
    for (let i = 0; i < 13; i++) pts.push({ m: Mh * wts[i] / ws, p: [0, 5.4 * s, (-24 + i * 4) * s] });
    for (let i = 0; i < 6; i++) { const z = -15 + i * 6; for (const x of [-1.8, 1.8]) pts.push({ m: Mb / 12, p: [x * s, 1.0 * s, (z + this.dry.dz) * s] }); }
    for (const g of this.guns) if (g.alive) pts.push({ m: 3400 * s3, p: [g.p[0] * 0.8, g.p[1], g.p[2]] });
    for (const m of this.masts) if (m.alive) pts.push({ m: 26000 * s3, p: [0, (m.anchor[1] + m.h * 0.42) * s, m.z * s] });
    pts.push({ m: this.dry.stores, p: [0, 4.0 * s, 0] });
    // flood water (with sloshing offset)
    for (const c of this.comp) if (c.vol > 0.5) {
      const lvl = c.vol / c.area; pts.push({ m: c.vol * RHO_W, p: [c.off, (Hull.keel(c.z / (Hull.HL * s)) + 0.3) * s + lvl * 0.5, c.z] });
    }
    return pts;
  }
  floodMass() { let v = 0; for (const c of this.comp) v += c.vol; return v * RHO_W; }
  // ---------- forces ----------
  step(dt, t, wind) {
    const R = this.R; const world = this.world;
    // sloshing water offset + mass
    const tiltX = R[3]; // world-y component of local x axis
    for (const c of this.comp) { const tgt = clamp(-tiltX * 9 * Math.min(1, c.vol / 90), -4.2, 4.2); c.off += (tgt - c.off) * Math.min(1, dt / 1.6); }
    this._mt = (this._mt || 0) + dt;
    if (this._mt > 0.05) { this._mt = 0; this.setMass(this.massPts()); }
    this.F = [0, -this.M * GRAV, 0]; this.T = [0, 0, 0];
    for (const e of this.ext) this.force(e[0], e[1], e[2], e[3], e[4], e[5]); this.ext.length = 0;
    const cw = this.com;
    // buoyancy + hull drag column by column
    let subm = 0, latK = 0;
    const fwd = [R[2], R[5], R[8]], right = [R[0], R[3], R[6]]; // local z / x axes in world
    let fwdV = 0; { const v = this.vel; fwdV = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2]; } this.speed = fwdV;
    const ux = R[1], uy = R[4], uz = R[7]; // local up axis in world
    const cc = this.c, vel = this.vel, wv = this.w;
    for (const col of this.cols) {
      const lx = col.p[0] - cc[0], ly = col.p[1] - cc[1], lz = col.p[2] - cc[2];
      _pw[0] = cw[0] + R[0] * lx + R[1] * ly + R[2] * lz; _pw[1] = cw[1] + R[3] * lx + R[4] * ly + R[5] * lz; _pw[2] = cw[2] + R[6] * lx + R[7] * ly + R[8] * lz;
      const pw = _pw;
      Waves.sample(pw[0], pw[2], t, _ws);
      const yb = pw[1], yt = yb + uy * col.thick, lo = Math.min(yb, yt), hi = Math.max(yb, yt), hw = _ws[0];
      if (hw <= lo) continue;
      const Ls = col.thick * (hi - lo < 1e-3 ? 1 : Math.min(1, (hw - lo) / (hi - lo)));
      let cx, cy, cz; // centroid of the submerged part of this prismatic column
      if (uy >= 0) { cx = pw[0] + ux * Ls / 2; cy = pw[1] + uy * Ls / 2; cz = pw[2] + uz * Ls / 2; }
      else { cx = pw[0] + ux * (col.thick - Ls / 2); cy = pw[1] + uy * (col.thick - Ls / 2); cz = pw[2] + uz * (col.thick - Ls / 2); }
      const f = RHO_W * GRAV * col.area * Ls;
      const rx = cx - cw[0], ry = cy - cw[1], rz = cz - cw[2];
      const vy = vel[1] + wv[2] * rx - wv[0] * rz - _ws[3];
      const vx = vel[0] + wv[1] * rz - wv[2] * ry - _ws[4], vz = vel[2] + wv[0] * ry - wv[1] * rx - _ws[5];
      const damp = 0.5 * RHO_W * col.area * 1.1 * Math.min(1, Ls / 1.2);
      const fy = f - damp * vy * Math.abs(vy) * 0.6 - RHO_W * col.area * 1.6 * vy;
      const vf = vx * fwd[0] + vz * fwd[2], vl = vx * right[0] + vz * right[2];
      const areaLat = col.dz * Ls * (col.lat ? 1.2 : 0.7) * 0.22, areaFwd = col.area * 0.35 * Math.min(1, Ls / 2);
      const fdF = -0.5 * RHO_W * 0.05 * areaFwd * Math.abs(vf) * vf, fdL = -0.5 * RHO_W * 1.05 * areaLat * Math.abs(vl) * vl * 2.6;
      const ax = fwd[0] * fdF + right[0] * fdL, az = fwd[2] * fdF + right[2] * fdL;
      this.force(cx, cy, cz, ax - f * _ws[1] * 0.3, fy, az - f * _ws[2] * 0.3);
      subm += Ls;
    }
    this.subm = subm;
    // rotational damping (bilge keels, added mass)
    const s5 = Math.pow(this.s, 5), wd = this.w, K = [3e7 * s5, 1.5e7 * s5, 3e6 * s5]; // pitch(x), yaw(y), roll(z) linear damping, local axes
    const wl = M3.mulTV(R, wd);
    const dl = [-K[0] * wl[0] - 4e6 * s5 * Math.abs(wl[0]) * wl[0], -K[1] * wl[1] - 8e6 * s5 * Math.abs(wl[1]) * wl[1], -K[2] * wl[2] - 4e6 * s5 * Math.abs(wl[2]) * wl[2]];
    // z axis is roll (bow-stern): scale by submersion so a sunk hull still spins freely
    const sf = clamp(subm / (300 * this.s), 0, 1); const dW = M3.mulV(R, [dl[0] * sf, dl[1] * sf, dl[2] * sf]);
    this.T[0] += dW[0]; this.T[1] += dW[1]; this.T[2] += dW[2];
    // sails
    this.sailForces(t, wind);
    // rudder at the stern
    const rp = this.toWorld([0, 1.2 * this.s, -25 * this.s]);
    const u = Math.max(0, Math.abs(fwdV)) * Math.sign(fwdV || 1);
    const lift = 0.5 * RHO_W * 26 * this.s * this.s * 1.5 * this.rudder * (fwdV >= 0 ? 1 : -1) * (fwdV * fwdV + 5) * 0.6 * clamp(this.subm / (250 * this.s), 0, 1);
    this.force(rp[0], rp[1], rp[2], -right[0] * lift, 0, -right[2] * lift);
    // air drag on the rigging/hull
    const av = [this.vel[0] - wind[0], 0, this.vel[2] - wind[2]]; const al = Math.hypot(av[0], av[2]);
    this.force(cw[0], cw[1] + 10 * this.s, cw[2], -av[0] * al * 1.6 * this.s * this.s, 0, -av[2] * al * 1.6 * this.s * this.s);
    // flooding
    this.flooding(dt, t);
    this.integrate(dt);
  }
  sailForces(t, wind) {
    let area = 0, cnt = 0;
    for (const m of this.masts) if (m.alive) { const sl = Hull.mastSails(m.i); sl.forEach((s, k) => { area += (s.wb + s.wt) / 2 * (s.yt - s.yb) * m.sailHp[k]; }); }
    area *= this.s * this.s; this.sailArea = area;
    area *= this.sailSet * this.cls.sailK;
    const R = this.R; const fwd = [R[2], 0, R[8]]; const fl = Math.hypot(fwd[0], fwd[2]) || 1; fwd[0] /= fl; fwd[2] /= fl;
    const right = [R[0], 0, R[6]]; const rl = Math.hypot(right[0], right[2]) || 1; right[0] /= rl; right[2] /= rl;
    // apparent wind (velocity of air relative to ship)
    const aw = [wind[0] - this.vel[0], wind[2] - this.vel[2]]; const va = Math.hypot(aw[0], aw[1]);
    if (va < 0.1) { this.billow = 0; return; }
    // wind comes FROM -aw ; gamma = angle between bow and direction the wind comes from
    const cosg = -(aw[0] * fwd[0] + aw[1] * fwd[2]) / va, g = Math.acos(clamp(cosg, -1, 1));
    const sideSign = -(aw[0] * right[0] + aw[1] * right[2]) / va; // >0 : wind from local +x (port)
    const cf = polar(g, PT_G, PT_F), cs = polar(g, PT_G, PT_S);
    const heelA = Math.asin(clamp(R[3], -1, 1)), dep = Math.max(0.12, Math.pow(Math.cos(heelA), 5)); // sails spill wind when heeled
    const Q_ = 0.5 * RHO_A * va * va * area * 0.42 * dep;
    const Ff = Q_ * cf, Fs = Q_ * cs;
    // side force pushes to leeward = along wind direction component perpendicular to heading
    const lee = sideSign > 0 ? -1 : 1; // leeward local direction sign along right (right = local +x)
    const cwp = this.toWorld([0, 0, 0]); const ce = [cwp[0] + fwd[0] * 2, cwp[1] + 24 * this.s, cwp[2] + fwd[2] * 2];
    // rudder-less: minor weather helm keeps course stable
    this.force(ce[0], ce[1], ce[2], fwd[0] * Ff + right[0] * lee * Fs, 0, fwd[2] * Ff + right[2] * lee * Fs);
    this.billow = clamp(va / 22, 0, 1) * (g < 0.75 ? 0.25 : 1) * (0.15 + 0.85 * this.sailSet); this.jibSign = -lee; this.aparent = g;
    this.windSide = sideSign;
    const yard = Math.min((Math.PI - g) / 2, 1.05); // braced yards (visual)
    this.yardTarget = -Math.sign(sideSign || 1) * yard;
    for (const m of this.masts) m.yard += ((this.yardTarget || 0) - m.yard) * 0.02;
    this.sailFrac = this.sailArea / (this.fullArea * this.s * this.s);
  }
  // ---------- flooding ----------
  flooding(dt, t) {
    const R = this.R;
    for (const h of this.holes) {
      if (!h.flood) continue;
      const pw = this.toWorld(h.p);
      const hw = Waves.height(pw[0], pw[2], t);
      let ci = clamp(Math.round((h.p[2] / this.s + 20.8) / 10.4), 0, 4); const c = this.comp[ci];
      const lvl = c.vol / c.area; const floorW = this.toWorld([0, Hull.keel(c.z / (Hull.HL * this.s)) * this.s, c.z])[1] + lvl;
      const head = hw - Math.max(pw[1], floorW);
      if (head > 0) { const q = 0.62 * Math.PI * h.r * h.r * Math.sqrt(2 * GRAV * head); c.vol += q * dt; this.inflow = (this.inflow || 0) + q; }
      // crew plugs holes that stay above water for a while
      if (!h.plugged) { h.age += dt; if (h.age > h.plugAt && pw[1] > hw + 1.2) { h.plugged = true; h.r *= 0.12; } }
    }
    // pumps: a little outflow from the fullest compartment
    let mx = this.comp[0]; for (const c of this.comp) if (c.vol > mx.vol) mx = c;
    mx.vol = Math.max(0, mx.vol - 0.10 * this.s * this.s * dt);
    let cap = 0; for (const c of this.comp) { c.vol = Math.min(c.vol, c.area * 8.5 * this.s); cap += c.vol; }
    this.flood = cap * RHO_W;
  }
  addHole(pl, r, flood) {
    const h = { p: pl, r, flood, plugged: false, age: 0, plugAt: 70 + Math.random() * 60 };
    this.holes.push(h); if (this.holes.length > this.holeCap) this.holes.shift();
    if (this.world && this.world.on.hole) this.world.on.hole(this, h);
    return h;
  }
}
Ship.prototype.fullArea = (() => { let a = 0; Hull.MASTS.forEach((m, i) => Hull.mastSails(i).forEach(s => { a += (s.wb + s.wt) / 2 * (s.yt - s.yb); })); return a; })();
const PT_G = [0, 0.6, 0.9, 1.3, 1.9, 2.5, 3.1416], PT_F = [0, 0, 0.45, 0.9, 1.0, 0.85, 0.7], PT_S = [0, 0.8, 1.0, 0.9, 0.5, 0.2, 0];
function polar(g, xs, ys) { for (let i = 1; i < xs.length; i++) if (g <= xs[i]) { const f = (g - xs[i - 1]) / (xs[i] - xs[i - 1]); return lerp(ys[i - 1], ys[i], f * f * (3 - 2 * f)); } return ys[ys.length - 1]; }

// ---------------- floating debris (planks, broken masts) ----------------
class Debris extends Body {
  constructor(kind, pos, vel, size, dens, mastOf) {
    super();
    this.id = Debris.nextId++; this.kind = kind; this.size = size; this.age = 0; this.mastOf = mastOf; this.scale = 1; this.life = 70 + Math.random() * 40;
    const [lx, ly, lz] = size; const vol = lx * ly * lz;
    this.mass = vol * dens * (kind === 'mast' ? 1 : 1); this.setMass([{ m: this.mass, p: [0, 0, 0] }], [this.mass * (ly * ly + lz * lz) / 12, this.mass * (lx * lx + lz * lz) / 12, this.mass * (lx * lx + ly * ly) / 12]);
    this.com = pos.slice(); this.vel = vel.slice(); this.q = Q.norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() + 0.2]); Q.toMat(this.q, this.R);
    const n = kind === 'mast' ? 6 : 3; this.pts = [];
    for (let i = 0; i < n; i++) this.pts.push({ p: [(i / (n - 1) - 0.5) * lx * (1 - 1 / n), 0, 0], area: lx / n * lz, th: ly });
    this.w = [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3];
    this.dens = dens;
  }
  step(dt, t) {
    this.age += dt; this.F = [0, -this.M * GRAV, 0]; this.T = [0, 0, 0];
    for (const p of this.pts) {
      const pw = this.toWorld(p.p); Waves.sample(pw[0], pw[2], t, _ws);
      let hs = _ws[0] - (pw[1] - p.th / 2); if (hs <= 0) continue; if (hs > p.th) hs = p.th;
      const v = this.pointVel(pw); const rv = [v[0] - _ws[4], v[1] - _ws[3], v[2] - _ws[5]];
      const k = RHO_W * (0.4 + 0.02 * p.area) * Math.min(1, hs / p.th) * p.area * 0.6;
      this.force(pw[0], pw[1], pw[2], -k * rv[0] * 1.2, RHO_W * GRAV * p.area * hs - k * rv[1] * 1.5, -k * rv[2] * 1.2);
    }
    const wl = Math.hypot(...this.w); if (wl > 0) { const d = 1.6 * (this.pts.length > 3 ? 4 : 1) * (this.com[1] < 1 ? 1 : 0.02); this.T[0] -= this.w[0] * this.M * d; this.T[1] -= this.w[1] * this.M * d; this.T[2] -= this.w[2] * this.M * d; }
    this.integrate(dt);
  }
}

Debris.nextId = 1;
// ---------------- world: ships, balls, debris, particles hooks ----------------
class Ball {
  constructor(p, v, owner) { this.id = Ball.nextId++; this.who = null; this.p = p; this.v = v; this.owner = owner; this.age = 0; this.inside = -1; this.hitSails = new Set(); this.dead = false; this.trail = 0; }
}
Ball.nextId = 1;
