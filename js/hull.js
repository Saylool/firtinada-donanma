'use strict';
// Procedural ship of the line: hull shape functions (shared by mesh, buoyancy columns and cannonball hit tests) + mesh generation.
// Local frame: +y up, +z bow, +x port (left when looking to the bow), origin on the keel line at mid-length.
const Hull = (() => {
  const L = 52, HL = 26, HB = 6.5;
  const rim = s => 11.1 + 0.9 * s * s * (s > 0 ? 1.6 : 0.7) + 2.6 * smoothstep(-0.30, -0.42, s) + 1.7 * smoothstep(0.62, 0.72, s);
  const deckY = s => rim(s) - 1.1;
  const keel = s => (s > 0.45 ? 3.2 * Math.pow((s - 0.45) / 0.55, 2) : s < -0.55 ? 2.2 * Math.pow((-s - 0.55) / 0.45, 2) : 0);
  const halfBeam = s => (s > 0 ? HB * Math.pow(Math.max(0, 1 - Math.pow(s, 2.3)), 0.62) : HB * (1 - 0.36 * Math.pow(-s, 2.4)));
  const sec = t => Math.pow(Math.sin(Math.min(1, t) * Math.PI / 2), 0.55) * (1 - 0.08 * smoothstep(0.7, 1, t)) / 0.945;
  const halfWidth = (s, y) => {
    const k = keel(s), r = rim(s); if (y <= k) return 0;
    return halfBeam(s) * sec((y - k) / (r - k));
  };
  const bottomY = (s, ax) => { // lowest y of the hull at lateral offset ax (bisection on monotone part of the section)
    const hb = halfBeam(s), k = keel(s), r = rim(s);
    if (hb < 1e-3) return r;
    let lo = 0, hi = 0.8;
    if (ax >= hb * sec(0.8)) return k + 0.8 * (r - k);
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (hb * sec(m) < ax) lo = m; else hi = m; }
    return k + hi * (r - k);
  };
  const inside = (x, y, z) => {
    const s = z / HL; if (s < -1 || s > 1) return false;
    if (y < keel(s) || y > rim(s)) return false;
    return Math.abs(x) <= halfWidth(s, y);
  };
  const MASTS = [
    { z: 14.5, h: 37 }, { z: 1.0, h: 42 }, { z: -11.5, h: 32 }];
  const SAILS = [ // fractions of mast height: yb, yt, bottom width factor
    [0.14, 0.50, 0.63], [0.53, 0.78, 0.47], [0.80, 0.97, 0.34]];
  const PORT_ROWS = [6.9, 8.7];
  const PORT_Z = []; for (let k = 0; k < 9; k++) PORT_Z.push(-17 + 4 * k);

  function mastSails(mi) {
    const m = MASTS[mi]; const out = [];
    for (let i = (mi === 2 ? 1 : 0); i < 3; i++) {
      const [a, b, w] = SAILS[i]; out.push({ yb: a * m.h, yt: b * m.h, wb: w * m.h, wt: w * m.h * 0.88, idx: i });
    }
    return out;
  }
  function columns(nl = 7, ns = 17) {
    const cols = [];
    for (let j = 0; j < ns; j++) {
      const s = -1 + (j + 0.5) * 2 / ns, hb = halfBeam(s) * 0.96, dz = L / ns, dx = hb * 2 / nl;
      for (let i = 0; i < nl; i++) {
        const x = (-1 + (i + 0.5) * 2 / nl) * hb, yb = bottomY(s, Math.abs(x)), yt = deckY(s);
        if (yt - yb < 0.3) continue;
        cols.push({ p: [x, yb, s * HL], area: dx * dz, thick: yt - yb, dz, lat: Math.abs(x) > hb * 0.55 });
      }
    }
    return cols;
  }
  function guns() {
    const g = [];
    for (const side of [1, -1]) for (let r = 0; r < PORT_ROWS.length; r++) for (const z of PORT_Z) {
      const y = PORT_ROWS[r], s = z / HL;
      g.push({ p: [side * (halfWidth(s, y) + 0.4), y, z], side, row: r });
    }
    return g;
  }

  // ---------- mesh builder ----------
  class MB {
    constructor() { this.v = []; this.i = []; this.n = 0; }
    vert(p, n, u, v, mat, ex) { if (this.uo) { u = this.uo[0]; v = this.uo[1]; } this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], u, v, mat, ex || 0); return this.n++; }
    tri(a, b, c) { this.i.push(a, b, c); }
    quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
    mark() { return this.i.length; }
    cyl(p0, p1, r0, r1, seg, mat, ex) {
      const ax = V3.norm(V3.sub(p1, p0)); const t = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = V3.norm(V3.cross(ax, t)), w = V3.cross(ax, u);
      const base = this.n;
      for (let i = 0; i <= seg; i++) {
        const a = i / seg * TAU, c = Math.cos(a), s = Math.sin(a);
        const nn = [u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s];
        this.vert([p0[0] + nn[0] * r0, p0[1] + nn[1] * r0, p0[2] + nn[2] * r0], nn, i / seg, 0, mat, ex);
        this.vert([p1[0] + nn[0] * r1, p1[1] + nn[1] * r1, p1[2] + nn[2] * r1], nn, i / seg, 1, mat, ex);
      }
      for (let i = 0; i < seg; i++) { const a = base + i * 2; this.quad(a, a + 2, a + 3, a + 1); }
    }
    box(c, s, mat, ex) {
      const hx = s[0] / 2, hy = s[1] / 2, hz = s[2] / 2;
      const F = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
        [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
      for (const [n, a, b] of F) {
        const k = [n[0] * hx, n[1] * hy, n[2] * hz]; const A = [a[0] * hx, a[1] * hy, a[2] * hz], B = [b[0] * hx, b[1] * hy, b[2] * hz];
        const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => this.vert([c[0] + k[0] + A[0] * i + B[0] * j, c[1] + k[1] + A[1] * i + B[1] * j, c[2] + k[2] + A[2] * i + B[2] * j], n, (i + 1) / 2, (j + 1) / 2, mat, ex));
        this.quad(q[0], q[1], q[2], q[3]); this.quad(q[0], q[3], q[2], q[1]);
      }
    }
    // grid surface: f(u,v)->[p,n]
    grid(nu, nv, f, mat, ex) {
      const base = this.n;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const [p, n] = f(i / nu, j / nv); this.vert(p, n, i / nu, j / nv, mat, ex); }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = base + j * (nu + 1) + i; this.quad(a, a + 1, a + nu + 2, a + nu + 1); }
    }
  }

  function build() {
    const mb = new MB(); const out = { ranges: {}, masts: [], lines: [] };
    // ---- hull sides ----
    const NS = 44, NT = 18;
    const P = (s, t, side) => { const k = keel(s), r = rim(s); const y = k + t * (r - k); return [side * halfBeam(s) * sec(t), y, s * HL]; };
    const start = mb.mark();
    for (const side of [1, -1]) {
      mb.grid(NS, NT, (a, b) => {
        const s = -Math.cos(a * Math.PI), t = b; const e = 1e-3;
        const p = P(s, t, side), ps = P(Math.min(1, s + e), t, side), pt = P(s, Math.min(1, t + e), side);
        let n = V3.cross(V3.sub(pt, p), V3.sub(ps, p)); if (side < 0) n = V3.scale(n, -1);
        n = V3.norm(n); if (n[0] * side < -0.5 && t > 0.3) n = V3.scale(n, -1);
        return [p, n];
      }, 0, 0);
    }
    // transom
    mb.grid(10, NT, (a, b) => { const s = -1, t = b; const k = keel(s), r = rim(s); const w = halfBeam(s) * sec(t); return [[(a * 2 - 1) * w, k + t * (r - k), s * HL], [0, 0.15, -1]]; }, 0, 1);
    // deck
    mb.grid(4, NS, (a, b) => { const s = -Math.cos(b * Math.PI); const w = Math.max(0.02, halfBeam(s) * sec(1) - 0.05); return [[(a * 2 - 1) * w, deckY(s), s * HL], [0, 1, 0]]; }, 1, 0);
    // hatches, capstan, wheel
    mb.box([0, deckY(0.05) + 0.3, 6], [3.4, 0.6, 3.4], 3); mb.box([0, deckY(0.05) + 0.3, -4], [3, 0.6, 5], 3);
    mb.cyl([0, deckY(0.3), 9.5], [0, deckY(0.3) + 1.3, 9.5], 0.5, 0.45, 8, 3);
    mb.box([0, deckY(-0.5) + 0.35, -18.5], [1.6, 0.7, 1.4], 3); mb.cyl([0, deckY(-0.5) + 1.0, -19.5], [0, deckY(-0.5) + 1.0, -19.5 + 0.01], 0.6, 0.6, 10, 3);
    // rail cap along the bulwark, open taffrail + forecastle rail, quarter galleries, lifeboat, anchors, lion figurehead
    for (const side of [1, -1]) {
      let prev = null;
      for (let j = 0; j <= 44; j++) {
        const sj = -Math.cos(j / 44 * Math.PI), z = sj * HL, w = halfBeam(sj) * sec(1), cur = [side * (w + 0.02), rim(sj) + 0.1, z];
        if (prev && w > 0.3) mb.cyl(prev, cur, 0.1, 0.1, 5, 3);
        if (j % 3 === 0 && w > 0.8 && (sj < -0.3 || sj > 0.66)) mb.cyl([cur[0], rim(sj) - 0.2, z], [cur[0], rim(sj) + 0.95, z], 0.07, 0.07, 4, 3);
        prev = w > 0.3 ? cur : null;
      }
      const rl = []; for (let j = 0; j <= 14; j++) { const sj = -1 + j / 14 * 0.66, w = halfBeam(sj) * sec(1); rl.push([side * (w + 0.02), rim(sj) + 0.95, sj * HL]); } for (let j = 1; j < rl.length; j++) mb.cyl(rl[j - 1], rl[j], 0.06, 0.06, 4, 3);
      const fr = []; for (let j = 0; j <= 8; j++) { const sj = 0.66 + j / 8 * 0.3, w = halfBeam(sj) * sec(1); if (w > 0.3) fr.push([side * (w + 0.02), rim(sj) + 0.95, sj * HL]); } for (let j = 1; j < fr.length; j++) mb.cyl(fr[j - 1], fr[j], 0.06, 0.06, 4, 3);
      // quarter gallery
      const gx = side * (halfBeam(-0.93) * sec(1) + 0.55), gz = -HL * 0.95, gy = rim(-0.95) - 2.8;
      mb.box([gx, gy, gz], [1.5, 3.3, 3.4], 3); mb.box([gx, gy + 1.9, gz], [1.8, 0.3, 3.8], 4); mb.box([gx, gy - 1.75, gz], [1.7, 0.25, 3.7], 4);
      for (const dz of [-1, 0, 1]) mb.box([gx + side * 0.76, gy + 0.1, gz + dz * 1.0], [0.08, 1.1, 0.7], 4, 1);
      // anchor on the cathead
      const ax = side * (halfBeam(0.8) * sec(1) + 0.4), ay = rim(0.8) - 1.4, az = 0.8 * HL; mb.cyl([ax, ay - 1.2, az], [ax, ay + 1.0, az], 0.11, 0.11, 5, 6); mb.box([ax, ay + 0.75, az], [1.5, 0.12, 0.12], 6); mb.box([ax, ay - 1.25, az], [0.12, 0.35, 1.3], 6);
    }
    { const y = deckY(-0.27) + 0.05; mb.box([0, y + 0.45, -8], [2.0, 0.9, 5.2], 3); mb.box([0, y + 0.95, -8], [1.6, 0.2, 4.6], 1); mb.box([0, y + 0.45, -8], [0.12, 0.92, 5.3], 4); }
    { const hy = rim(1) + 0.9; mb.box([0, hy, 27.3], [0.9, 0.9, 1.4], 4); mb.box([0, hy - 0.45, 28.1], [0.55, 0.5, 0.9], 4); mb.cyl([0, hy, 26.6], [0, hy, 27.0], 0.75, 0.6, 8, 4); for (const sx of [-1, 1]) mb.box([sx * 0.27, hy + 0.55, 27.6], [0.14, 0.35, 0.14], 4); }
    // cannon barrels poking through the ports
    for (const g of guns()) {
      const side = g.side, s = g.p[2] / HL, w = halfWidth(s, g.p[1]);
      mb.cyl([side * (w - 1.3), g.p[1], g.p[2]], [side * (w + 0.35), g.p[1], g.p[2]], 0.27, 0.2, 8, 6, 1 + g.row * 16 + PORT_Z.indexOf(g.p[2]));
    }
    // bowsprit, figurehead, stern lanterns
    const bs0 = [0, rim(0.95) - 1.6, 20], bs1 = [0, rim(1) + 6.2, 37.5];
    mb.cyl(bs0, bs1, 0.5, 0.2, 8, 3);
    mb.cyl([0, rim(1) - 1.0, 26.2], [0, rim(1) + 0.3, 29.5], 0.5, 0.2, 8, 4);
    mb.cyl([0, bs1[1], bs1[2]], [0, bs1[1] + 0.6, bs1[2] + 1.5], 0.12, 0.05, 6, 3);
    for (const sx of [-1, 1]) { mb.cyl([sx * 4.2, rim(-1) + 0.6, -25.6], [sx * 4.2, rim(-1) + 2.6, -25.6], 0.32, 0.5, 8, 4); }
    mb.cyl([0, rim(-1) + 0.5, -25.4], [0, rim(-1) + 5.5, -25.4], 0.08, 0.08, 5, 3);
    // jib + staysail (fore-and-aft triangular sails)
    const tri = (T, H, C) => mb.grid(8, 8, (u, v) => [[T[0] + u * (1 - v) * (C[0] - T[0]) + v * (H[0] - T[0]), T[1] + u * (1 - v) * (C[1] - T[1]) + v * (H[1] - T[1]), T[2] + u * (1 - v) * (C[2] - T[2]) + v * (H[2] - T[2])], [1, 0, 0]], 2, 1);
    tri([0, bs1[1] - 0.3, bs1[2] - 0.6], [0, 33, 15.6], [0, rim(0.7) + 3.5, 22]);
    tri([0, bs1[1] - 2.5, bs1[2] - 9], [0, 27, 15.6], [0, rim(0.7) + 2.5, 21]);
    // ---- crew: baked into the hull mesh, animated in the vertex shader (id/part packed in aEx, base height in uv.x)
    { const rnd = mulberry32(9), spots = [];
      const add = (x, z, yaw) => spots.push([x, z, yaw]);
      for (let z = -14; z <= 17; z += 3.1) for (const sd of [-1, 1]) { const s2 = z / HL; add(sd * (halfBeam(s2) * sec(1) - 1.25), z + (rnd() - 0.5) * 0.8, sd > 0 ? Math.PI / 2 : -Math.PI / 2); }
      add(0, -20.4, 0); add(1.2, -21.5, 3.1); add(-1.3, -18, 1); add(0.5, -23, 3); add(2.6, 20.5, 0); add(-2.6, 20.8, 0); add(0, 22.5, 0);
      add(1.8, 4.5, 1.5); add(-1.8, 6.5, -1.5); add(1.4, -3.5, 0.5); add(-1.4, 10.5, 2);
      for (let i = spots.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [spots[i], spots[j]] = [spots[j], spots[i]]; }
      out.crewN = spots.length;
      spots.forEach(([x, z, yaw], id) => {
        const y0 = deckY(z / HL), c = Math.cos(yaw), sn = Math.sin(yaw); mb.uo = [y0, id];
        const P = (dx, dy, dz) => [x + dx * c + dz * sn, y0 + dy, z - dx * sn + dz * c];
        const part = k => id * 8 + k;
        mb.cyl(P(-0.16, 0.05, 0), P(-0.16, 0.85, 0), 0.11, 0.1, 5, 7, part(0)); mb.cyl(P(0.16, 0.05, 0), P(0.16, 0.85, 0), 0.11, 0.1, 5, 7, part(0));
        mb.cyl(P(0, 0.85, 0), P(0, 1.5, 0), 0.24, 0.2, 6, 7, part(1));
        mb.cyl(P(-0.29, 1.45, 0), P(-0.34, 0.8, 0.12), 0.07, 0.06, 4, 7, part(2)); mb.cyl(P(0.29, 1.45, 0), P(0.36, 0.85, 0.35), 0.07, 0.06, 4, 7, part(2));
        mb.cyl(P(0, 1.5, 0), P(0, 1.78, 0), 0.13, 0.12, 6, 7, part(3)); mb.cyl(P(0, 1.78, 0), P(0, 1.9, 0), 0.19, 0.12, 6, 7, part(4));
        mb.cyl(P(0.36, 0.85, 0.35), P(0.45, 1.5, 0.75), 0.03, 0.02, 4, 7, part(5)); // cutlass in the right hand
      }); mb.uo = null; }
    out.ranges.hull = [start, mb.mark() - start];

    // ---- masts, yards, sails, flags ----
    MASTS.forEach((m, mi) => {
      const yd = deckY(m.z / HL) - 0.0;
      const s0 = mb.mark(); m.anchor = [0, yd, m.z];
      const top = m.h;
      mb.cyl([0, -1.5, 0], [0, top * 0.55, 0], 0.62, 0.42, 10, 3);
      mb.cyl([0, top * 0.5, 0], [0, top, 0], 0.4, 0.14, 8, 3);
      mb.box([0, top * 0.5, 0], [3.4, 0.25, 3.0], 3);
      for (const sl of mastSails(mi)) {
        const yl = sl.yt;
        mb.cyl([-(sl.wt / 2 + 1.2), yl, 0.1], [sl.wt / 2 + 1.2, yl, 0.1], 0.26, 0.26, 6, 3);
        mb.grid(14, 10, (u, v) => { const w = lerp(sl.wb, sl.wt, v); const y = lerp(sl.yb + (1 - Math.abs(u * 2 - 1)) * 0.0, sl.yt, v); return [[(u - 0.5) * w, y, 0.7], [0, 0, 1]]; }, 2, 0);
      }
      // pennant
      mb.grid(8, 2, (u, v) => [[0, top + 0.3 + v * 1.5 * (1 - u * 0.6), 0 - u * 7.5], [1, 0, 0]], 5, 0);
      out.masts.push({ anchor: m.anchor, h: m.h, z: m.z, range: [s0, mb.mark() - s0], sails: mastSails(mi) });
    });
    // ensign at the stern
    const e0 = mb.mark();
    mb.cyl([0, rim(-1) + 0.4, -25.4], [0, rim(-1) + 5.6, -25.4], 0.08, 0.08, 5, 3);
    mb.grid(10, 4, (u, v) => [[0, rim(-1) + 5.4 - v * 3.0, -25.4 - u * 5.5], [1, 0, 0]], 5, 1);
    out.ranges.hull[1] += 0; out.ensign = [e0, mb.mark() - e0];
    out.mesh = { verts: new Float32Array(mb.v), idx: new Uint32Array(mb.i) };

    // ---- rigging lines ----
    const lv = []; const seg = (a, b) => lv.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    MASTS.forEach((m, mi) => {
      const l0 = lv.length / 3, yd = m.anchor[1];
      for (const sd of [-1, 1]) {
        const shr = [];
        for (let j = 0; j < 4; j++) {
          const z = m.z + (j - 1.5) * 1.7, s = z / HL;
          const bot = [sd * (halfBeam(s) * sec(1) - 0.3), deckY(s) + 0.9, z], topP = [sd * 0.6, yd + m.h * 0.5, m.z + (j - 1.5) * 0.4];
          seg(bot, topP); shr.push([bot, topP]);
        }
        for (let j = 0; j < 3; j++) for (let r = 1; r < 9; r++) { const f = r / 9.5; const A = shr[j], B = shr[j + 1]; seg([lerp(A[0][0], A[1][0], f), lerp(A[0][1], A[1][1], f) , lerp(A[0][2], A[1][2], f)], [lerp(B[0][0], B[1][0], f), lerp(B[0][1], B[1][1], f), lerp(B[0][2], B[1][2], f)]); }
      }
      const topP = [0, yd + m.h, m.z];
      if (mi === 0) { seg(topP, bs1); seg([0, yd + m.h * 0.8, m.z], [0, bs1[1] - 2, bs1[2] - 8]); }
      else seg(topP, [0, MASTS[mi - 1].anchor[1] + MASTS[mi - 1].h * 0.55, MASTS[mi - 1].z - 0.3]);
      if (mi === 2) seg(topP, [0, rim(-1) + 1.6, -25]);
      seg([0, yd + m.h * 0.5, m.z], [2.5, deckY((m.z - 6) / HL) + 0.5, m.z - 6]); seg([0, yd + m.h * 0.5, m.z], [-2.5, deckY((m.z - 6) / HL) + 0.5, m.z - 6]);
      out.lines.push([l0, lv.length / 3 - l0]);
    });
    out.lineVerts = new Float32Array(lv);
    return out;
  }
  return { MB, L, HL, HB, rim, deckY, keel, halfBeam, halfWidth, bottomY, inside, sec, MASTS, PORT_ROWS, PORT_Z, mastSails, columns, guns, build };
})();
