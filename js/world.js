'use strict';
// Simulation world: fleets, AI, gunnery, ballistics, damage.
const MUZZLE = 320, BALL_M = 16, BALL_R = 0.085;
const DRAG_K = 4.0e-4; // dv/dt = -DRAG_K |v| v  (0.17 m iron ball)
function gauss(r) { return Math.sqrt(-2 * Math.log(1 - r() * 0.999)) * Math.cos(TAU * r()); }

// ballistic elevation for horizontal range r and height difference dy (with drag) -> pitch angle
function solveElevation(r, dy, v0 = MUZZLE) {
  let lo = -0.02, hi = 0.35;
  const fly = th => { // return height error at range r
    let x = 0, y = 0, vx = v0 * Math.cos(th), vy = v0 * Math.sin(th);
    for (let i = 0; i < 600; i++) {
      const sp = Math.hypot(vx, vy); vx -= DRAG_K * sp * vx * 0.02; vy -= (GRAV + DRAG_K * sp * vy) * 0.02;
      const nx = x + vx * 0.02; if (nx >= r) { const f = (r - x) / (nx - x); return y + (vy * 0.02) * f - dy; }
      x = nx; y += vy * 0.02;
    }
    return -1e3;
  };
  for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (fly(m) < 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

class World {
  constructor() {
    this.t = 0; this.ships = []; this.balls = []; this.debris = []; this.on = {};
    this.wind = [0, 0, 0]; this.windDir = [1, 0]; this.windSpeed = 21; this.rnd = Math.random; this.damageScale = 2.3;
    this.acc = 0; this.aiT = 0; this.over = 0; this.overT = 0; this.winner = -1;
  }
  // roster: [{team, cls, name, human}] (optional). Default: mirrored random fleets.
  setup(seed, perTeam = 3, windAngle, roster) {
    this.rnd = mulberry32(seed); const r = this.rnd; this.seed = seed;
    this.t = 0; this.ships.length = 0; this.balls.length = 0; this.debris.length = 0; this.over = 0; this.winner = -1;
    const wa = windAngle ?? (Math.PI / 2 + (r() - 0.5) * 0.5);
    this.wa = wa; Waves.init(seed * 13 + 5, wa); this.windDir = [Math.cos(wa), Math.sin(wa)];
    const names = [['Zafer', 'Fırtına', 'Kartal', 'Şahin', 'Akrep', 'Yavuz', 'Barbaros', 'Preveze'], ['Aslan', 'Ejder', 'Yıldırım', 'Kaplan', 'Kartal II', 'Grifon', 'Hydra', 'Kraken']];
    if (!roster) {
      const pool = ['line', 'line', 'frigate', 'frigate', 'sloop', 'first']; roster = [];
      const pick = []; for (let i = 0; i < perTeam; i++) pick.push(pool[(r() * pool.length) | 0]);
      for (let team = 0; team < 2; team++) pick.forEach((c, i) => roster.push({ team, cls: c, name: names[team][i % 8] }));
    }
    const cnt = [0, 0];
    for (const e of roster) {
      const team = e.team, i = cnt[team]++, dir = team === 0 ? 1 : -1;
      const x = dir * (-150 + i * 105) + (r() - 0.5) * 30, z = (team === 0 ? -1 : 1) * (150 + r() * 25) + (i % 2) * 30;
      const h = team === 0 ? Math.PI / 2 + 0.05 : -Math.PI / 2 + 0.05;
      const s = new Ship(this.ships.length, team, e.name || names[team][i % 8], x, z, h + (r() - 0.5) * 0.2, this, e.cls || 'line');
      this.setSlots(s, e); s.vel = [Math.sin(h) * 4, 0, Math.cos(h) * 4];
      this.ships.push(s);
    }
    this.spinUp();
  }
  setSlots(s, e) { s.helm = e.helm || e.human || null; s.gun = e.gun || e.human || null; s.hn = e.hn || ''; s.gn = e.gn || ''; s.human = s.helm || s.gun || null; }
  spawnPoint(team) {
    const r = this.rnd || Math.random; let best = null, bd = -1;
    for (let k = 0; k < 12; k++) {
      const x = (r() - 0.5) * 420, z = (team === 0 ? -1 : 1) * (150 + r() * 60);
      let d = 1e9; for (const o of this.ships) if (!o.dead) d = Math.min(d, Math.hypot(o.com[0] - x, o.com[2] - z));
      if (d > bd) { bd = d; best = [x, z]; }
    }
    return best;
  }
  addShip(e) { // drop-in ship (players joining / respawning)
    const team = e.team, h = e.h ?? (team === 0 ? Math.PI / 2 + 0.05 : -Math.PI / 2 + 0.05);
    const [x, z] = e.x !== undefined ? [e.x, e.z] : this.spawnPoint(team);
    const s = new Ship(this.ships.length, team, e.name, x, z, h, this, e.cls || 'line'); this.setSlots(s, e); s.vel = [Math.sin(h) * 4, 0, Math.cos(h) * 4];
    const pw = s.toWorld([0, 0, 0]); s.com[1] += Waves.height(pw[0], pw[2], this.t);
    this.ships.push(s); return s;
  }
  spawnWreck(s) { // barrels and planks burst free when a ship goes down
    const r = this.rnd; if (this.debris.length > 140) return;
    for (let i = 0; i < 14; i++) { const p = s.toWorld([(r() - 0.5) * 8 * s.s, 7 * s.s, (r() - 0.5) * 40 * s.s]); const barrel = i % 3 === 0;
      const d = new Debris('plank', p, [(r() - 0.5) * 7 + s.vel[0] * 0.5, 2 + r() * 6, (r() - 0.5) * 7 + s.vel[2] * 0.5], barrel ? [0.8, 0.8, 0.8] : [1.5 + r() * 3, 0.14, 0.4 + r() * 0.3], barrel ? 420 : 520); this.debris.push(d); }
  }
  spinUp() { // let hulls settle into the water quickly
    for (const s of this.ships) { const pw = s.toWorld([0, 0, 0]); const h = Waves.height(pw[0], pw[2], 0); s.com[1] += h; }
  }
  windAt(t) { const g = 1 + 0.18 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1) + 0.08 * Math.sin(t * 1.3); const sp = this.windSpeed * g; return [this.windDir[0] * sp, 0, this.windDir[1] * sp]; }
  update(dt) { // fixed step
    const t = this.t; this.wind = this.windAt(t);
    this.collideShips(); this.grapples(dt);
    for (const s of this.ships) if (!s.dead) s.step(dt, t, this.wind);
    for (const d of this.debris) d.step(dt, t);
    this.debris = this.debris.filter(d => d.age < d.life && d.com[1] > -30);
    this.stepBalls(dt);
    this.aiT -= dt; if (this.aiT <= 0) { this.aiT = 0.1; this.ai(0.1); }
    this.cbT = (this.cbT || 0) - dt; if (this.cbT <= 0) { this.cbT = 0.5; this.combat(0.5); }
    for (const s of this.ships) {
      const rl = clamp(s.crew / 0.55, 0.2, 1); for (const g of s.guns) if (g.t > 0) g.t -= dt * rl;
      if (s.fires.length) for (let i = s.fires.length - 1; i >= 0; i--) { const f = s.fires[i]; f.t -= dt; const fw = s.toWorld(f.p); if (f.t <= 0 || fw[1] < Waves.height(fw[0], fw[2], t) + 0.2) s.fires.splice(i, 1); else if (s.masts.length && this.rnd() < dt * 0.6) { const m = s.masts[(this.rnd() * s.masts.length) | 0]; const k = (this.rnd() * m.sailHp.length) | 0; m.sailHp[k] = Math.max(0, m.sailHp[k] - 0.02); } }
      if (!s.dead) {
        const dk = s.toWorld([0, 10.0, 0]); const hw = Waves.height(dk[0], dk[2], t);
        if (!s.sunk && dk[1] < hw - 1.0) { s.sunk = true; s.sunkT = t; this.spawnWreck(s); if (this.on.sunk) this.on.sunk(s); }
        if (s.com[1] < -55) { s.dead = true; }
      }
    }
    this.t += dt;
    if (!this.over) {
      const alive = [0, 0]; for (const s of this.ships) if (!s.sunk && !s.dead) alive[s.team]++;
      if (this.t > 600 && alive[0] > 0 && alive[1] > 0) { // time limit: the fleet with more ships afloat (then less water aboard) wins
        const fl = [0, 0]; for (const s of this.ships) if (!s.sunk) fl[s.team] += s.flood;
        this.over = 1; this.overT = this.t; this.winner = alive[0] !== alive[1] ? (alive[0] > alive[1] ? 0 : 1) : (fl[0] < fl[1] ? 0 : 1); return;
      }
      if (alive[0] === 0 || alive[1] === 0) { this.over = 1; this.overT = this.t; this.winner = alive[0] > 0 ? 0 : alive[1] > 0 ? 1 : -1; }
    }
  }
  collideShips() {
    const ss = this.ships;
    for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) {
      const a = ss[i], b = ss[j]; if (a.dead || b.dead) continue;
      const dx = a.com[0] - b.com[0], dz = a.com[2] - b.com[2]; if (dx * dx + dz * dz > 90 * 90) continue;
      for (const za of [-18, -9, 0, 9, 18]) for (const zb of [-18, -9, 0, 9, 18]) {
        const pa = a.toWorld([0, 6 * a.s, za * a.s]), pb = b.toWorld([0, 6 * b.s, zb * b.s]);
        const nx = pa[0] - pb[0], nz = pa[2] - pb[2], d = Math.hypot(nx, nz), rr = 6.25 * (a.s + b.s);
        if (d >= rr || d < 1e-3) continue;
        const ux = nx / d, uz = nz / d, pen = rr - d;
        const va = a.pointVel(pa), vb = b.pointVel(pb); const rv = (va[0] - vb[0]) * ux + (va[2] - vb[2]) * uz;
        const km = Math.pow(Math.min(a.s, b.s), 3), f = km * (3e6 * pen + 1.5e6 * Math.min(0, rv) * -1 * (rv < 0 ? 1 : 0));
        a.ext.push([pa[0], pa[1], pa[2], ux * f, 0, uz * f]); b.ext.push([pb[0], pb[1], pb[2], -ux * f, 0, -uz * f]);
        if (pen > 0.5 && rv < -1.3 && (this.t - (a._cd || -9) > 1.5 || this.t - (b._cd || -9) > 1.5)) { // ramming damage: holes at the contact point, crew casualties
          a._cd = b._cd = this.t; const sp = -rv, mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
          for (const [sh, o] of [[a, b], [b, a]]) { const lm = sh.toLocal([mid[0], sh.com[1] + 1.5 * sh.s, mid[2]]); lm[1] = 3.2 * sh.s + this.rnd() * 2 * sh.s; const rm = (0.18 + 0.05 * sp) * (1 + 0.4 * (o.s / sh.s)); sh.addHole(lm, Math.min(rm, 0.9), true); sh.crew = Math.max(0, sh.crew - 0.01 * sp); }
          if (this.on.crash) this.on.crash(mid, sp);
        }
      }
    }
  }
  // ---------- AI ----------
  ai(dt) {
    const wf = [-this.windDir[0], -this.windDir[1]];
    for (const s of this.ships) {
      if (s.dead) continue;
      const enemies = this.ships.filter(e => e.team !== s.team && !e.sunk && !e.dead);
      if (s.helm || s.gun) this.playerTick(s, dt);
      if (s.sunk || !enemies.length) { if (!s.helm) s.rudder = 0; continue; }
      let best = null, bd = 1e9;
      for (const e of enemies) { const d = Math.hypot(e.com[0] - s.com[0], e.com[2] - s.com[2]) * (e === s.ai.target ? 0.8 : 1); if (d < bd) { bd = d; best = e; } }
      s.ai.target = best;
      if (!s.helm) {
      const R = s.R, fwd = [R[2], R[8]], fl = Math.hypot(fwd[0], fwd[1]) || 1; fwd[0] /= fl; fwd[1] /= fl;
      const dx = best.com[0] - s.com[0], dz = best.com[2] - s.com[2], rng = Math.hypot(dx, dz), dn = [dx / rng, dz / rng];
      // broadside: choose the perpendicular closest to current heading
      const perp = [-dn[1], dn[0]]; const sgn = Math.sign(perp[0] * fwd[0] + perp[1] * fwd[1]) || 1;
      let hd = [perp[0] * sgn, perp[1] * sgn];
      const bias = clamp((rng - 210) / 220, -0.75, 0.75);
      hd = [hd[0] * Math.cos(bias) + dn[0] * Math.sin(bias), hd[1] * Math.cos(bias) + dn[1] * Math.sin(bias)];
      // avoid other ships
      for (const o of this.ships) { if (o === s || o.dead) continue; const ox = s.com[0] - o.com[0], oz = s.com[2] - o.com[2], od = Math.hypot(ox, oz); if (od < 110) { const k = (110 - od) / 110 * 1.4; hd[0] += ox / od * k; hd[1] += oz / od * k; } }
      const hl = Math.hypot(hd[0], hd[1]); hd[0] /= hl; hd[1] /= hl;
      // stay out of irons
      const cosg = hd[0] * wf[0] + hd[1] * wf[1], gam = Math.acos(clamp(cosg, -1, 1));
      if (gam < 0.95) {
        const side = Math.sign(wf[0] * hd[1] - wf[1] * hd[0]) || 1; const a = 0.98 * side; const c = Math.cos(a), sn = Math.sin(a);
        hd = [wf[0] * c - wf[1] * sn, wf[0] * sn + wf[1] * c];
      }
      // stalled (in irons / becalmed): break out onto a beam reach
      s.ai.slow = (Math.hypot(s.vel[0], s.vel[2]) < 1.6) ? (s.ai.slow || 0) + dt : 0;
      if (s.ai.slow > 6) { const a = Math.atan2(wf[1], wf[0]) + (Math.sign(s.ai.side || 1) * 1.57); const p1 = [Math.cos(a), Math.sin(a)]; const p2 = [-p1[0], -p1[1]]; hd = (p1[0] * fwd[0] + p1[1] * fwd[1] > p2[0] * fwd[0] + p2[1] * fwd[1]) ? p1 : p2; }
      const cross = fwd[0] * hd[1] - fwd[1] * hd[0], dot = fwd[0] * hd[0] + fwd[1] * hd[1];
      const err = Math.atan2(cross, dot); // >0 : need to turn toward +x-rotation... sign resolved below
      // yaw rate about +y
      const yawRate = s.w[1];
      // positive yaw (about +y) moves forward from +z toward +x: forward=(sin h, cos h) -> d/dh = (cos h, -sin h); err sign: cross=fx*hz - fz*hx = sin(h)*... = -sin(dh)
      const need = -err;
      s.rudder = clamp(need * 2.2 - yawRate * 5, -1, 1) * clamp(1.2 - s.flood / 2.5e6, 0.2, 1);
      // boarding: AI grapples a weakened, adjacent enemy
      if (!s.board && !best.board && rng < 40 * s.s && best.crew < s.crew * 0.85 && this.rnd() < 0.05) this.startBoard(s);
      }
      if (!s.gun && !s.board) this.gunnery(s, best, dt);
    }
    // end-of-battle auto restart is handled by main
  }
  gunnery(s, tgt, dt) {
    const c = s.toWorld([0, 6 * s.s, 0]); const dx = tgt.com[0] - c[0], dz = tgt.com[2] - c[2], rng = Math.hypot(dx, dz);
    if (rng > 470 || rng < 25) return;
    const tof = rng / 280; const aim = tgt.toWorld([0, (3.6 + this.rnd() * 1.6) * tgt.s, 0]); aim[0] += tgt.vel[0] * tof; aim[2] += tgt.vel[2] * tof;
    this.fireAt(s, aim, s.gun ? 0.03 : 0.09, 470);
  }
  // fire every ready gun that can bear on the world point `aim` (guns are limited in azimuth/elevation by their ports)
  fireAt(s, aim, prob, maxRange, dry) {
    const c = s.toWorld([0, 6 * s.s, 0]); const rng = Math.hypot(aim[0] - c[0], aim[2] - c[2]);
    if (rng > maxRange || rng < 20) return 0;
    const el = solveElevation(rng, aim[1] - c[1]); let n = 0;
    for (const g of s.guns) {
      if (g.t > 0 || !g.alive || this.t - (g.mannedT || -9) < 0.8) continue;
      const gw = s.toWorld(g.p); let hx = aim[0] - gw[0], hz = aim[2] - gw[2]; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
      const dw = [hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)];
      const dl = M3.mulTV(s.R, dw);
      const az = Math.atan2(dl[2], dl[0] * g.side), ev = Math.asin(clamp(dl[1], -1, 1));
      if (Math.abs(az) < 0.5 && ev > -0.15 && ev < 0.27) { if (dry) n++; else if (this.rnd() < prob) { this.fire(s, g, dw); n++; } }
    }
    return n;
  }
  // human-controlled slots: the helmsman must stand at the wheel; the gunner must stand at a gun and sights it by eye.
  playerTick(s, dt) {
    if (s.helm) {
      const c = s.ctrlH || (s.ctrlH = { rud: 0, sail: 1, board: false, atHelm: false });
      const tr = c.atHelm ? c.rud : 0; s.rudder += (tr - s.rudder) * Math.min(1, dt * 4); if (c.atHelm) s.sailSet += (c.sail - s.sailSet) * Math.min(1, dt * 1.5);
      if (c.board) { c.board = false; if (c.atHelm) { if (!s.board) this.startBoard(s); else this.endBoard(s); } }
    }
    if (s.chars) for (const id of Object.keys(s.chars)) {
      const ch = s.chars[id]; if (!ch) continue; if (ch.gi >= 0 && s.guns[ch.gi]) s.guns[ch.gi].mannedT = this.t;
      ch.wcd = (ch.wcd || 0) - dt; if (ch.atkT > 0) ch.atkT -= dt;
      if (ch.atkReq) { ch.atkReq = false; if (ch.w > 0 && ch.wcd <= 0 && !s.sunk && ch.mode !== 1 && !ch.climb) this.charAttack(s, ch); }
    }
    if (s.gun && !s.sunk) { const c = s.ctrlG; if (c && c.fire && c.gi >= 0) this.fireGun(s, c.gi, c.dl); }
  }
  // personal weapons: cutlass (melee during boarding) and musket (hitscan at crew on enemy decks)
  charAttack(s, ch) {
    if (ch.w === 2) {
      ch.wcd = 0.6; ch.atkT = 0.5;
      if (s.board != null && ch.lvl === 0) { const e = this.ships[s.board]; if (e && !e.sunk) { e.crew = Math.max(0, e.crew - 0.011 - this.rnd() * 0.01); if (this.on.melee) this.on.melee(s, e); } }
      return;
    }
    if (ch.w === 1) {
      ch.wcd = 2.4; ch.atkT = 0.35; const sc = s.s, cp = Math.cos(ch.pitch);
      const p0 = s.toWorld([ch.x, (ch.eyeY != null ? ch.eyeY : Hull.floorY(ch.lvl, ch.z / sc) * sc + 1.55 * sc) - 0.15, ch.z]);
      const dw = M3.mulV(s.R, [cp * Math.sin(ch.yaw) + (this.rnd() - 0.5) * 0.012, Math.sin(ch.pitch) + (this.rnd() - 0.5) * 0.012, cp * Math.cos(ch.yaw) + (this.rnd() - 0.5) * 0.012]);
      let end = p0.slice(), hit = null;
      for (let t = 1.5; t < 100; t += 1.2) {
        const p = [p0[0] + dw[0] * t, p0[1] + dw[1] * t, p0[2] + dw[2] * t]; end = p;
        if (p[1] < Waves.height(p[0], p[2], this.t)) { hit = 'water'; break; }
        for (const e of this.ships) { if (e === s || e.team === s.team || e.sunk || e.dead) continue; const l = e.toLocal(p), k = e.s;
          if (Hull.inside(l[0] / k, l[1] / k, l[2] / k) || (Math.abs(l[0]) < Hull.halfW(0, l[2] / k) * k && l[1] > Hull.deckY(l[2] / (k * Hull.HL)) * k - 0.3 && l[1] < Hull.deckY(l[2] / (k * Hull.HL)) * k + 2.6 * k)) { hit = e; break; } }
        if (hit) break;
      }
      if (hit && hit !== 'water') hit.crew = Math.max(0, hit.crew - 0.006 - this.rnd() * 0.008);
      if (this.on.charShot) this.on.charShot(s, p0, end, hit && hit !== 'water' ? hit : (hit ? 'water' : null));
    }
  }
  // a human fires one specific gun along the direction he is looking (ship-local), nothing else
  fireGun(s, gi, dl) {
    const g = s.guns[gi]; if (!g || !g.alive || g.t > 0 || s.crew < 0.08 || s.board != null) return false;
    const n = V3.norm(dl); const dw = M3.mulV(s.R, n); this.fire(s, g, dw, s.gun); g.mannedT = this.t; return true;
  }
  // ---------- crew, muskets, boarding ----------
  startBoard(s) {
    if (s.board != null || s.sunk) return false; let best = null, bd = 1e9;
    for (const e of this.ships) { if (e.team === s.team || e.sunk || e.dead || e.board != null) continue; const d = Math.hypot(e.com[0] - s.com[0], e.com[2] - s.com[2]); if (d < bd) { bd = d; best = e; } }
    if (!best || bd > 46 * Math.max(s.s, best.s)) return false;
    s.board = best.id; best.board = s.id; if (this.on.board) this.on.board(s, best); return true;
  }
  endBoard(s) { const o = s.board != null ? this.ships[s.board] : null; s.board = null; if (o) o.board = null; }
  grapples(dt) { // ropes hold the two hulls together (spring + damper between hull centres)
    for (const a of this.ships) {
      if (a.board == null) continue; const b = this.ships[a.board];
      if (!b || a.sunk || b.sunk || a.dead || b.dead || b.board !== a.id) { this.endBoard(a); continue; }
      if (b.id < a.id) continue;
      const dx = b.com[0] - a.com[0], dz = b.com[2] - a.com[2], d = Math.hypot(dx, dz) || 1;
      if (d > 70) { this.endBoard(a); continue; }
      const tgt = 10.5 * (a.s + b.s), ux = dx / d, uz = dz / d, mr = a.M * b.M / (a.M + b.M), k = mr * 0.5, c = 2 * 0.8 * Math.sqrt(k * mr);
      const rv = (b.vel[0] - a.vel[0]) * ux + (b.vel[2] - a.vel[2]) * uz; const f = clamp(k * (d - tgt) + c * rv, -6e6, 6e6);
      a.ext.push([a.com[0], a.com[1] + 6 * a.s, a.com[2], ux * f, 0, uz * f]); b.ext.push([b.com[0], b.com[1] + 6 * b.s, b.com[2], -ux * f, 0, -uz * f]);
    }
  }
  combat(dt) {
    const r = this.rnd;
    for (const a of this.ships) {
      if (a.dead || a.sunk) continue;
      // musket volleys at nearby enemies
      a.musketT -= dt;
      if (a.musketT <= 0 && a.crew > 0.1) {
        let tgt = null, td = 1e9; for (const e of this.ships) { if (e.team === a.team || e.sunk || e.dead) continue; const d = Math.hypot(e.com[0] - a.com[0], e.com[2] - a.com[2]); if (d < td) { td = d; tgt = e; } }
        if (tgt && td < 75 * Math.max(a.s, tgt.s)) { a.musketT = 1.6 + r() * 1.4; const men = a.crew * a.crewMax * 0.35; tgt.crew = Math.max(0, tgt.crew - men * 0.0035 * (0.5 + r()) / tgt.crewMax * 1.4); if (this.on.musket) this.on.musket(a, tgt); } else a.musketT = 0.7;
      }
      // fire on deck kills crew
      if (a.fires.length) a.crew = Math.max(0, a.crew - a.fires.length * 0.004 * dt);
      // melee
      if (a.board != null && a.id < a.board) {
        const b = this.ships[a.board]; if (!b) continue;
        const am = a.crew * a.crewMax, bm = b.crew * b.crewMax;
        const da = 0.022 * am * (0.55 + 0.9 * r()) * dt, db = 0.022 * bm * (0.55 + 0.9 * r()) * dt;
        b.crew = Math.max(0, (bm - da) / b.crewMax); a.crew = Math.max(0, (am - db) / a.crewMax);
        if (b.crew < 0.14) this.capture(b, a); else if (a.crew < 0.14) this.capture(a, b);
      }
    }
  }
  capture(loser, winner) {
    this.endBoard(loser); loser.team = winner.team; loser.captured = true; loser.crew = Math.max(0.28, loser.crew); winner.crew = Math.max(0.25, winner.crew);
    loser.helm = loser.gun = loser.human = null; loser.ctrlH = loser.ctrlG = null; loser.ai.target = null;
    if (this.on.captured) this.on.captured(loser, winner);
  }
  fire(s, g, dw, who) {
    const r = this.rnd; g.t = 9 + r() * 7; s.stats.shots++;
    const gw = s.toWorld(g.p);
    const d = V3.norm([dw[0] + gauss(r) * 0.006, dw[1] + gauss(r) * 0.006, dw[2] + gauss(r) * 0.006]);
    const v0 = MUZZLE * (1 + gauss(r) * 0.02);
    const sv = s.pointVel(gw);
    const b = new Ball([gw[0] + d[0] * 1.2, gw[1] + d[1] * 1.2, gw[2] + d[2] * 1.2], [d[0] * v0 + sv[0], d[1] * v0 + sv[1], d[2] * v0 + sv[2]], s);
    this.balls.push(b); b.who = who || null;
    s.impulse(gw, [-d[0] * BALL_M * v0 * 1.6, -d[1] * BALL_M * v0 * 1.6, -d[2] * BALL_M * v0 * 1.6]);
    s.fireFlash = 1;
    if (this.on.shot) this.on.shot(gw, d, s, b);
    return b;
  }
  // ---------- ballistics ----------
  stepBalls(dt) {
    const sub = 2, h = dt / sub, t = this.t;
    for (const b of this.balls) {
      for (let k = 0; k < sub && !b.dead; k++) {
        const sp = Math.hypot(b.v[0], b.v[1], b.v[2]);
        const dk = b.inside >= 0 ? 14 : DRAG_K * sp;
        b.v[0] -= dk * b.v[0] * h; b.v[1] -= (GRAV + dk * b.v[1]) * h; b.v[2] -= dk * b.v[2] * h;
        const p0 = b.p.slice(); b.p[0] += b.v[0] * h; b.p[1] += b.v[1] * h; b.p[2] += b.v[2] * h; b.age += h;
        if (!this.hitShips(b, p0, b.p)) this.hitWater(b, t);
        if (b.age > 14 || b.p[1] < -60) b.dead = true;
      }
    }
    this.balls = this.balls.filter(b => !b.dead);
  }
  hitWater(b, t) {
    if (b.dead || b.inside >= 0) return;
    const p = b.p; Waves.sample(p[0], p[2], t, _ws); if (p[1] > _ws[0]) return;
    const sp = Math.hypot(...b.v); let n = V3.norm([-_ws[1], 1, -_ws[2]]);
    const vn = Math.abs(V3.dot(b.v, n)) / sp;
    if (vn < 0.14 && sp > 90 && this.rnd() < 0.85) { // ricochet
      const d = V3.dot(b.v, n); b.v = [b.v[0] - 1.9 * d * n[0], b.v[1] - 1.9 * d * n[1], b.v[2] - 1.9 * d * n[2]].map(x => x * 0.72); b.p[1] = _ws[0] + 0.1;
      if (this.on.splash) this.on.splash([p[0], _ws[0], p[2]], 0.35, b.v);
    } else { b.dead = true; if (this.on.splash) this.on.splash([p[0], _ws[0], p[2]], clamp(sp / 320, 0.3, 1.2), b.v); }
  }
  hitShips(b, p0, p1) {
    for (const s of this.ships) {
      if (s.dead) continue;
      const mx = (p0[0] + p1[0]) / 2 - s.com[0], my = (p0[1] + p1[1]) / 2 - s.com[1], mz = (p0[2] + p1[2]) / 2 - s.com[2];
      if (mx * mx + my * my + mz * mz > 3600 * s.s * s.s) continue;
      const N = 3;
      for (let k = 1; k <= N; k++) {
        const f = k / N; const pw = [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f];
        const pl = s.toLocal(pw); const ins = Hull.inside(pl[0] / s.s, pl[1] / s.s, pl[2] / s.s);
        if (b.inside === s.id) {
          if (!ins) { this.hullExit(b, s, pl, pw); return true; }
          if (Math.hypot(...b.v) < 40) { b.dead = true; return true; }
        } else if (b.inside < 0) {
          if (ins && !(b.owner === s && b.age < 0.3)) { this.hullEnter(b, s, pl, pw); return true; }
          if (b.owner === s && b.age < 0.3) continue;
          if (this.rigHit(b, s, pl, pw)) return true;
        }
      }
    }
    return false;
  }
  hullHole(s, pl, r, sp) {
    const sd = pl[2] / (Hull.HL * s.s); const low = pl[1] < Hull.deckY(sd) * s.s - 0.25;
    if (!low && this.rnd() < 0.09 && s.fires.length < 4) s.fires.push({ p: pl.slice(), t: 14 + this.rnd() * 14 });
    return s.addHole(pl, r, low);
  }
  hullEnter(b, s, pl, pw) {
    const sp = Math.hypot(...b.v); s.stats.hits++;
    const r = (0.2 + this.rnd() * 0.22) * this.damageScale;
    this.hullHole(s, pl, r, sp); s.crew = Math.max(0, s.crew - (0.004 + this.rnd() * 0.008));
    s.impulse(pw, [b.v[0] * BALL_M, b.v[1] * BALL_M, b.v[2] * BALL_M]);
    b.v = b.v.map(x => x * 0.62); b.inside = s.id;
    if (this.on.hit) this.on.hit(pw, b.v, s, 'hull', 1);
    this.spawnPlanks(s, pw, b.v, 2);
  }
  hullExit(b, s, pl, pw) {
    b.inside = -1; const sp = Math.hypot(...b.v);
    if (sp > 55) {
      const r = (0.28 + this.rnd() * 0.25) * this.damageScale; this.hullHole(s, pl, r, sp);
      if (this.on.hit) this.on.hit(pw, b.v, s, 'exit', 0.8); this.spawnPlanks(s, pw, b.v, 2);
    } else b.dead = true;
  }
  rigHit(b, s, pl, pw) {
    const sc = s.s; pl = [pl[0] / sc, pl[1] / sc, pl[2] / sc];
    if (pl[1] < Hull.deckY(pl[2] / Hull.HL) - 0.5) return false;
    for (const m of s.masts) {
      if (!m.alive) continue;
      const qx = pl[0] - m.anchor[0], qy = pl[1] - m.anchor[1], qz = pl[2] - m.anchor[2];
      if (qy < -1 || qy > m.h) continue;
      if (Math.hypot(qx, qz) < 0.62 + 0.4 * (1 - qy / m.h)) {
        s.crew = Math.max(0, s.crew - 0.012); m.hp -= 35 + this.rnd() * 45; b.v = b.v.map(x => x * 0.5); s.impulse(pw, b.v.map(x => x * BALL_M * 0.5));
        if (this.on.hit) this.on.hit(pw, b.v, s, 'mast', 1);
        this.spawnPlanks(s, pw, b.v, 3);
        if (m.hp <= 0) this.breakMast(s, m);
        return false;
      }
      // sails, in the yard-rotated mast frame
      const c = Math.cos(m.yard), sn = Math.sin(m.yard);
      const lx = c * qx - sn * qz, lz = sn * qx + c * qz;
      const sails = Hull.mastSails(m.i);
      for (let k = 0; k < sails.length; k++) {
        const sl = sails[k]; const key = s.id * 100 + m.i * 10 + k;
        if (m.sailHp[k] <= 0.02 || b.hitSails.has(key)) continue;
        if (qy > sl.yb && qy < sl.yt && Math.abs(lz - 0.7) < 0.9) {
          const w = lerp(sl.wb, sl.wt, (qy - sl.yb) / (sl.yt - sl.yb));
          if (Math.abs(lx) < w / 2) {
            b.hitSails.add(key); const r = 0.5 + this.rnd() * 0.7;
            m.holes.push([lx, qy, 0.7, r]); if (m.holes.length > 10) m.holes.shift(); if (this.on.shole) this.on.shole(s, m, [lx, qy, 0.7, r]);
            m.sailHp[k] = Math.max(0, m.sailHp[k] - 0.09 - this.rnd() * 0.07);
            b.v = b.v.map(x => x * 0.985);
            if (this.on.hit) this.on.hit(pw, b.v, s, 'sail', 0.4);
          }
        }
      }
    }
    return false;
  }
  breakMast(s, m) {
    const sc = s.s; m.alive = false; if (this.on.hit) this.on.hit(s.toWorld([0, (m.anchor[1] + 4) * sc, m.z * sc]), [0, 5, 0], s, 'break', 2);
    const len = (m.h - 3) * sc; const base = s.toWorld([0, (m.anchor[1] + 3) * sc + len / 2, m.z * sc]);
    const dir = s.dirWorld([this.rnd() - 0.5, 0, this.rnd() - 0.5]);
    const d = new Debris('mast', base, [s.vel[0] + dir[0] * 4, 2, s.vel[2] + dir[2] * 4], [len, 1.1 * sc, 1.1 * sc], 550, m.i); d.scale = sc;
    d.q = Q.mul(s.q, Q.axis([0, 0, 1], Math.PI / 2)); Q.toMat(d.q, d.R); d.w = [dir[2] * 0.5, 0, -dir[0] * 0.5]; d.life = 160;
    this.debris.push(d);
  }
  spawnPlanks(s, pw, v, n) {
    if (this.debris.length > 150) return;
    for (let i = 0; i < n; i++) {
      const r = this.rnd; const sp = Math.hypot(...v) || 1;
      const d = new Debris('plank', pw.slice(), [v[0] / sp * (4 + r() * 8) + s.vel[0] + (r() - 0.5) * 6, 3 + r() * 6, v[2] / sp * (4 + r() * 8) + s.vel[2] + (r() - 0.5) * 6], [1.3 + r() * 2.2, 0.1, 0.3 + r() * 0.3], 520);
      this.debris.push(d);
    }
  }
}
