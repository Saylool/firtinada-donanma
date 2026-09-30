'use strict';
// First-person characters that walk around a moving ship (kinematic, in the ship's local frame).
// Levels: 0 = main deck, 1 = upper gun deck, 2 = lower gun deck. Ladder at the main hatch; wheel at the stern.
const Char = {
  EYE: 1.55, WALK: 2.9, RUN: 4.8,
  make(ship) { // spawn on the quarterdeck, facing the bow
    const s = ship.s; return { ship, lvl: 0, x: 1.6 * s, z: -15 * s, yaw: 0, pitch: 0, mode: 0, moving: 0, phase: 0, climb: null, eyeY: 0, gi: -1 };
  },
  floorY(ch) { return Hull.floorY(ch.lvl, ch.z / ch.ship.s) * ch.ship.s; },
  wheelPos(ship) { const s = ship.s; return [0, -21.2 * s]; },
  ladderPos(ship) { const s = ship.s; return [0, (Hull.HATCH.z1 + 1.3) * s]; },
  // can the character stand here?
  ok(ch, x, z) {
    const s = ch.ship.s, w = Hull.halfW(ch.lvl, z / s) * s; if (w < 1.0 * s) return false;
    const lim = ch.lvl === 0 ? w - 0.3 * s : w - 2.75 * s; if (Math.abs(x) > Math.max(lim, 0.4 * s)) return false;
    if (Math.abs(z) > 23.5 * s) return false;
    for (const m of ch.ship.masts) { if (m.alive && Math.hypot(x, z - m.z * s) < 0.95 * s) return false; }
    if (ch.lvl < 2 && Math.abs(x) < (Hull.HATCH.x + 0.35) * s && z > (Hull.HATCH.z0 - 0.35) * s && z < (Hull.HATCH.z1 + 0.15) * s) return false; // the hatch opening
    if (ch.lvl === 0 && Math.abs(x) < 1.0 * s && z > -19.4 * s && z < -17.6 * s) return false; // helm box
    return true;
  },
  // k = {fwd, strafe (+ right), run, look dx/dy already applied by caller}
  step(ch, k, dt) {
    const s = ch.ship.s; ch.moving = 0;
    if (ch.climb) { // ladder animation
      ch.climb.t += dt / 0.9; const t = Math.min(1, ch.climb.t), e = t * t * (3 - 2 * t);
      ch.eyeY = lerp(ch.climb.y0, ch.climb.y1, e); if (t >= 1) { ch.lvl = ch.climb.to; ch.climb = null; } ch.moving = 0.5; return;
    }
    if (ch.mode === 1) { const w = Char.wheelPos(ch.ship); ch.x = w[0]; ch.z = w[1]; }
    else if (k.fwd || k.strafe) {
      const sp = (k.run ? Char.RUN : Char.WALK) * (0.55 + 0.45 * s) * dt, len = Math.hypot(k.fwd, k.strafe) || 1;
      const fx = Math.sin(ch.yaw), fz = Math.cos(ch.yaw), rx = -Math.cos(ch.yaw), rz = Math.sin(ch.yaw); // +x is port: "right" points to -x
      const dx = (fx * k.fwd + rx * k.strafe) / len * sp, dz = (fz * k.fwd + rz * k.strafe) / len * sp;
      if (Char.ok(ch, ch.x + dx, ch.z + dz)) { ch.x += dx; ch.z += dz; } else if (Char.ok(ch, ch.x + dx, ch.z)) ch.x += dx; else if (Char.ok(ch, ch.x, ch.z + dz)) ch.z += dz;
      ch.moving = k.run ? 1 : 0.7; ch.phase += dt * (k.run ? 10 : 7);
    }
    const base = Char.floorY(ch) + Char.EYE * s; ch.eyeY = base + Math.sin(ch.phase) * 0.035 * s * ch.moving;
  },
  near(ch, p, r) { return Math.hypot(ch.x - p[0], ch.z - p[1]) < r * ch.ship.s; },
  // E: interact with whatever is close (wheel / ladder down); Q: ladder up.  Returns a status string.
  use(ch, dir) {
    if (ch.climb) return '';
    const s = ch.ship.s;
    if (ch.mode === 1) { ch.mode = 0; ch.z = -19.9 * s; return 'Dümeni bıraktın'; }
    if (dir > 0 && ch.lvl === 0 && Char.near(ch, Char.wheelPos(ch.ship), 2.6)) { ch.mode = 1; ch.yaw = 0; return 'Dümendesin'; }
    const lp = Char.ladderPos(ch.ship);
    if (Char.near(ch, lp, 2.2)) {
      const to = ch.lvl + (dir > 0 ? 1 : -1); if (to < 0 || to > 2) return '';
      ch.climb = { t: 0, y0: ch.eyeY, y1: Hull.floorY(to, ch.z / s) * s + Char.EYE * s, to }; ch.x = lp[0]; ch.z = lp[1] - 0.3 * s; return to > ch.lvl ? 'Aşağı iniyorsun' : 'Yukarı çıkıyorsun';
    }
    return '';
  },
  // nearest gun on this deck within reach (returns index or -1)
  nearestGun(ch) {
    if (ch.lvl === 0 || ch.mode === 1 || ch.climb) return -1; const s = ch.ship.s; const row = ch.lvl === 2 ? 0 : 1; let bi = -1, bd = 1e9;
    ch.ship.guns.forEach((g, i) => { if (!g.alive || g.row !== row) return; const inner = [g.p[0] - g.side * 2.6 * s, g.p[2]]; const d = Math.hypot(ch.x - inner[0], ch.z - inner[1]); if (d < 2.4 * s && d < bd) { bd = d; bi = i; } });
    return bi;
  },
  // look direction in ship-local axes, clamped into the gun's port arc (the barrel points where you look through the port)
  gunDir(ch, g) {
    const cp = Math.cos(ch.pitch), d = [cp * Math.sin(ch.yaw), Math.sin(ch.pitch), cp * Math.cos(ch.yaw)];
    let az = Math.atan2(d[2], d[0] * g.side), ev = Math.asin(clamp(d[1], -1, 1)); az = clamp(az, -0.45, 0.45); ev = clamp(ev, -0.15, 0.27);
    return [g.side * Math.cos(ev) * Math.cos(az), Math.sin(ev), Math.cos(ev) * Math.sin(az)];
  },
  eyeLocal(ch) { return [ch.x, ch.eyeY, ch.z]; },
};
