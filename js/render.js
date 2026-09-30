'use strict';
class Prog {
  constructor(gl, name, vs, fs) {
    this.gl = gl; this.name = name; this.loc = {};
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(`[shader ${name}] ${type === gl.VERTEX_SHADER ? 'VS' : 'FS'}: ` + gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n').slice(0, 200)); } return s; };
    this.p = gl.createProgram(); gl.attachShader(this.p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(this.p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(this.p); if (!gl.getProgramParameter(this.p, gl.LINK_STATUS)) console.error(`[program ${name}] ` + gl.getProgramInfoLog(this.p));
  }
  use() { this.gl.useProgram(this.p); return this; }
  u(n) { let l = this.loc[n]; if (l === undefined) { l = this.gl.getUniformLocation(this.p, n); this.loc[n] = l; } return l; }
  f(n, a, b, c, d) { const gl = this.gl, l = this.u(n); if (l === null) return; if (d !== undefined) gl.uniform4f(l, a, b, c, d); else if (c !== undefined) gl.uniform3f(l, a, b, c); else if (b !== undefined) gl.uniform2f(l, a, b); else gl.uniform1f(l, a); }
  v(n, arr, comp) { const l = this.u(n); if (l === null) return; this.gl['uniform' + comp + 'fv'](l, arr); }
  i(n, x) { const l = this.u(n); if (l !== null) this.gl.uniform1i(l, x); }
  m(n, m) { const l = this.u(n); if (l !== null) this.gl.uniformMatrix4fv(l, false, m); }
}

class Renderer {
  constructor(canvas) {
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 desteklenmiyor');
    if (!gl.getExtension('EXT_color_buffer_float')) console.warn('EXT_color_buffer_float yok');
    gl.getExtension('OES_texture_float_linear');
    this.canvas = canvas; this.scale = 1;
    const P = (n, v, f) => new Prog(gl, n, v, f);
    this.pSky = P('sky', SH.skyVS, SH.skyFS); this.pWater = P('water', SH.waterVS, SH.waterFS); this.pShip = P('ship', SH.shipVS, SH.shipFS);
    this.pLine = P('line', SH.lineVS, SH.lineFS); this.pRain = P('rain', SH.rainVS, SH.rainFS); this.pPart = P('part', SH.partVS, SH.partFS);
    this.pCopy = P('copy', SH.postVS, SH.copyFS); this.pBright = P('bright', SH.postVS, SH.brightFS); this.pBlur = P('blur', SH.postVS, SH.blurFS);
    this.pComp = P('comp', SH.postVS, SH.compFS); this.pFxaa = P('fxaa', SH.postVS, SH.fxaaFS);
    this.emptyVAO = gl.createVertexArray();
    this.buildWater(); this.buildShipMesh(); this.buildBox(); this.buildParticleBuffers();
    this.exposure = 1.25; this.bloom = 0.55; this.foamT = 3.2;
    this.bolt = null; this.tmp = new Float32Array(16);
  }
  // ---------- geometry ----------
  buildWater() {
    const gl = this.gl, NR = 280, NA = 192; const v = new Float32Array((NR + 1) * (NA + 1) * 2); let k = 0;
    for (let i = 0; i <= NR; i++) { const r = 1.2 * Math.pow(1.033, i) - 1.0; for (let j = 0; j <= NA; j++) { v[k++] = r; v[k++] = j / NA * TAU; } }
    const idx = new Uint32Array(NR * NA * 6); k = 0;
    for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + NA + 1; idx[k++] = a; idx[k++] = b; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1; }
    this.waterVAO = gl.createVertexArray(); gl.bindVertexArray(this.waterVAO);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    const l = gl.getAttribLocation(this.pWater.p, 'aP'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.waterCount = idx.length; gl.bindVertexArray(null);
  }
  meshVAO(verts, idx) {
    const gl = this.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const at = [['aPos', 3, 0], ['aNrm', 3, 12], ['aUV', 2, 24], ['aMat', 1, 32], ['aEx', 1, 36]];
    for (const [n, c, o] of at) { const l = gl.getAttribLocation(this.pShip.p, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, c, gl.FLOAT, false, 40, o); }
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null); return vao;
  }
  buildShipMesh() {
    const gl = this.gl; this.design = Hull.build(); this.shipVAO = this.meshVAO(this.design.mesh.verts, this.design.mesh.idx);
    this.lineVAO = gl.createVertexArray(); gl.bindVertexArray(this.lineVAO);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, this.design.lineVerts, gl.STATIC_DRAW);
    const l = gl.getAttribLocation(this.pLine.p, 'aPos'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
    this.boltBuf = gl.createBuffer();
  }
  buildBox() { const mb = new Hull.MB(); mb.box([0, 0, 0], [1, 1, 1], 3, 0); this.boxVAO = this.meshVAO(new Float32Array(mb.v), new Uint32Array(mb.i)); this.boxCount = mb.i.length; }
  buildParticleBuffers() {
    const gl = this.gl; this.pvao = [];
    for (let k = 0; k < 2; k++) {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, 12 * 4 * 8000, gl.DYNAMIC_DRAW);
      [['aP', 0], ['aC', 16], ['aS', 32]].forEach(([n, o]) => { const l = gl.getAttribLocation(this.pPart.p, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 48, o); gl.vertexAttribDivisor(l, 1); });
      gl.bindVertexArray(null); this.pvao.push({ vao, vb });
    }
  }
  // ---------- targets ----------
  tex(w, h, ifmt, fmt, type, filt) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, ifmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t;
  }
  fbo(w, h, depth, hdr = true) {
    const gl = this.gl, f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    const c = hdr ? this.tex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR) : this.tex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, c, 0);
    let d = null; if (depth) { d = this.tex(w, h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, d, 0); }
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER); if (st !== gl.FRAMEBUFFER_COMPLETE) console.error('FBO incomplete', st.toString(16), w, h);
    return { f, c, d, w, h };
  }
  resize(W, H) {
    const gl = this.gl; W = Math.max(16, W | 0); H = Math.max(16, H | 0);
    if (this.W === W && this.H === H) return; this.W = W; this.H = H;
    this.canvas.width = W; this.canvas.height = H;
    this.A = this.fbo(W, H, true); this.B = this.fbo(W, H, true);
    const hw = W >> 1, hh = H >> 1, qw = W >> 2, qh = H >> 2, ew = W >> 3, eh = H >> 3;
    this.h0 = this.fbo(hw, hh, false); this.q1 = this.fbo(qw, qh, false); this.q2 = this.fbo(qw, qh, false); this.e1 = this.fbo(ew, eh, false); this.e2 = this.fbo(ew, eh, false);
    this.C = this.fbo(W, H, false, false);
  }
  // Consistency check: evaluate the shader's wave function at sample points on the GPU and read it back.
  gpuWaveHeights(pts, t) {
    const gl = this.gl, n = pts.length / 2;
    if (!this.pTest) this.pTest = new Prog(gl, 'wavetest', SH.postVS, HEAD + Waves.glsl + 'uniform vec2 uPts[64]; out vec4 o; void main(){ vec2 p=uPts[int(gl.FragCoord.x)]; vec3 hg=waveHG(p); o=vec4(hg,waveH(p)); }'.replace('gl.FragCoord', 'gl_FragCoord'));
    const f = this.fbo(n, 1, false, true); gl.bindFramebuffer(gl.FRAMEBUFFER, f.f); gl.viewport(0, 0, n, 1);
    const fl = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fl);
    const tx = this.tex(n, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0);
    const p = this.pTest.use(); this.waveU(p, t); p.v('uPts', new Float32Array(pts), 2); gl.bindVertexArray(this.emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Float32Array(n * 4); gl.readPixels(0, 0, n, 1, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fl); gl.deleteTexture(tx); gl.deleteFramebuffer(f.f);
    return out;
  }
  // ---------- frame ----------
  pass(fb, prog) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, fb ? fb.f : null); gl.viewport(0, 0, fb ? fb.w : this.W, fb ? fb.h : this.H); prog.use(); gl.bindVertexArray(this.emptyVAO); return prog; }
  bindTex(unit, tex) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
  env(p, fr) {
    p.f('uSunDir', ...fr.sunDir); p.f('uSunCol', ...fr.sunCol); p.f('uFlash', fr.flash); p.f('uFlashDir', ...fr.flashDir); p.f('uCloudOff', fr.cloudOff[0], fr.cloudOff[1]); p.f('uFogD', fr.fogD); p.f('uCam', ...fr.cam.pos);
    const e = fr.env; p.f('uZen', ...e.zen); p.f('uHor', ...e.hor); p.f('uCloudD', ...e.cd); p.f('uCloudL', ...e.cl); p.f('uGlow', ...e.glow); p.f('uCoverLo', e.lo); p.f('uLight', e.light);
    p.f('uWaterD', ...e.wd); p.f('uWaterS', ...e.ws); const L = fr.lights; p.i('uLightN', L.n); p.v('uLights', L.arr, 4);
  }
  waveU(p, t) { p.v('uWA', Waves.A, 4); p.v('uWB', Waves.B, 4); p.f('uTime', t); }
  frame(fr) {
    const gl = this.gl, cam = fr.cam, w = fr.world;
    this.resize(fr.width, fr.height);
    const asp = this.W / this.H, proj = M4.perspective(cam.fov, asp, 0.4, 30000), view = M4.lookAt(cam.pos, cam.target, [0, 1, 0]);
    const vp = M4.mul(proj, view.m); this.vp = vp; this.viewInfo = view;
    // ---- scene A ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.A.f); gl.viewport(0, 0, this.W, this.H);
    gl.clearColor(0, 0, 0, 1); gl.clearDepth(1); gl.depthMask(true); gl.disable(gl.BLEND); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    let p = this.pSky.use(); this.env(p, fr); p.f('uRight', ...view.right); p.f('uUp', ...view.up); p.f('uFwd', ...view.fwd); p.f('uTan', Math.tan(cam.fov / 2)); p.f('uAsp', asp);
    gl.bindVertexArray(this.emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    this.drawShips(fr, vp);
    // ---- copy to B ----
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.A.f); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.B.f);
    gl.blitFramebuffer(0, 0, this.W, this.H, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    // ---- water ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.B.f); gl.viewport(0, 0, this.W, this.H); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    p = this.pWater.use(); this.env(p, fr); this.waveU(p, fr.time); p.m('uVP', vp);
    p.f('uCenter', Math.round(cam.pos[0] / 2) * 2, Math.round(cam.pos[2] / 2) * 2); p.f('uRes', this.W, this.H); p.f('uNear', 0.4); p.f('uFar', 30000);
    p.f('uAmp', Waves.amp); p.f('uWindAng', Waves.windAngle); p.f('uFoamT', this.foamT * (0.75 + 0.25 * Waves.amp));
    this.bindTex(0, this.A.c); p.i('uScene', 0); this.bindTex(1, this.A.d); p.i('uDepthT', 1);
    const sa = new Float32Array(48), sb = new Float32Array(48); let n = 0;
    for (const s of w.ships) { if (s.dead || n >= 12) continue; const R = s.R; let fx = R[2], fz = R[8]; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l; const o = s.toWorld([0, 0, 0]);
      sa.set([o[0], o[2], fx, fz], n * 4); sb.set([25 * s.s, 6.5 * s.s, Math.hypot(s.vel[0], s.vel[2]), s.sunk ? 0.4 : 1], n * 4); n++; }
    p.v('uShipA', sa, 4); p.v('uShipB', sb, 4); p.i('uShipN', n);
    gl.bindVertexArray(this.waterVAO); gl.drawElements(gl.TRIANGLES, this.waterCount, gl.UNSIGNED_INT, 0);
    // ---- transparent stuff ----
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    if (fr.rain > 0) { p = this.pRain.use(); p.m('uVP', vp); p.f('uCam', ...cam.pos); p.f('uTime', fr.time); p.f('uWindV', ...w.wind); p.f('uFlash', fr.flash); gl.bindVertexArray(this.emptyVAO); gl.drawArrays(gl.LINES, 0, 2 * fr.rain); }
    if (fr.bolt) this.drawBolt(fr, vp);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    fr.fx.draw(this, vp, view, fr);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
    this.post(fr);
  }
  drawBolt(fr, vp) {
    const gl = this.gl, b = fr.bolt; const p = this.pLine.use(); this.env(p, fr); p.m('uVP', vp); p.m('uModel', M4.fromRT(Q.toMat([0, 0, 0, 1]), [0, 0, 0]));
    p.f('uCol', 6 * b.a, 6.5 * b.a, 9 * b.a, 1); gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.boltBuf); gl.bufferData(gl.ARRAY_BUFFER, b.verts, gl.DYNAMIC_DRAW);
    const l = gl.getAttribLocation(p.p, 'aPos'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, b.verts.length / 3);
  }
  drawShips(fr, vp) {
    const gl = this.gl, w = fr.world, d = this.design;
    let p = this.pShip.use(); this.env(p, fr); this.waveU(p, fr.time); p.m('uVP', vp); p.f('uScale', 1, 1, 1); p.i('uKind', 0);
    const hole = new Float32Array(96), sh = new Float32Array(40), sm = new Float32Array(9);
    gl.bindVertexArray(this.shipVAO);
    for (const s of w.ships) {
      if (s.dead) continue;
      const sc = s.s, C = s.cls, team = s.team;
      const model = s.modelMatrix(this.tmp);
      p.f('uHullCol', ...(team === 0 ? [.075, .07, .065] : [.07, .075, .085])); p.f('uStripeCol', ...(team === 0 ? [.78, .58, .12] : [.72, .74, .70])); p.f('uTeamCol', ...(team === 0 ? [.82, .06, .05] : [.08, .22, .82]));
      p.f('uRows', C.rows); p.f('uPZ', Hull.PORT_Z[C.ports[0]] - 2, Hull.PORT_Z[C.ports[C.ports.length - 1]] + 2);
      p.f('uScale', sc, sc, sc);
      p.m('uModel', model); p.f('uBillow', 0); p.f('uJibSign', s.jibSign || 1);
      hole.fill(0); let n = 0; for (let i = s.holes.length - 1; i >= 0 && n < 24; i--, n++) { const h = s.holes[i]; hole.set([h.p[0] / sc, h.p[1] / sc, h.p[2] / sc, h.r / sc], n * 4); }
      p.v('uHole', hole, 4); p.i('uHoleN', n); p.i('uSHoleN', 0);
      gl.drawElements(gl.TRIANGLES, d.ranges.hull[1], gl.UNSIGNED_INT, d.ranges.hull[0] * 4);
      gl.drawElements(gl.TRIANGLES, d.ensign[1], gl.UNSIGNED_INT, d.ensign[0] * 4);
      // masts (yards braced with the wind)
      p.i('uHoleN', 0); p.f('uBillow', s.billow || 0);
      for (const m of s.masts) {
        if (!m.alive) continue;
        const R = M3.mul(s.R, M3.rotY(m.yard)); const a = s.toWorld([m.anchor[0] * sc, m.anchor[1] * sc, m.anchor[2] * sc]); const mm = M4.fromRT(R, a, this.tmp);
        p.m('uModel', mm); sh.fill(0); m.holes.forEach((h, i) => sh.set(h, i * 4)); p.v('uSHole', sh, 4); p.i('uSHoleN', m.holes.length);
        gl.drawElements(gl.TRIANGLES, d.masts[m.i].range[1], gl.UNSIGNED_INT, d.masts[m.i].range[0] * 4);
      }
    }
    // broken masts floating in the water
    p.i('uSHoleN', 0); p.f('uBillow', 0); p.f('uRows', 2); p.f('uPZ', -21, 19);
    for (const db of w.debris) if (db.kind === 'mast') {
      const sc = db.scale || 1; p.f('uScale', sc, sc, sc);
      const off = Q.toMat([0, 0, Math.sin(-Math.PI / 4), Math.cos(-Math.PI / 4)]);
      const a = db.toWorld([0, 0, 0]); const base = M3.mul(db.R, off); const m = Hull.MASTS[db.mastOf];
      const c = M3.mulV(base, [0, -m.h * 0.5 * sc, 0]); p.m('uModel', M4.fromRT(base, [a[0] + c[0], a[1] + c[1], a[2] + c[2]], this.tmp));
      gl.drawElements(gl.TRIANGLES, d.masts[db.mastOf].range[1], gl.UNSIGNED_INT, d.masts[db.mastOf].range[0] * 4);
    }
    // planks
    p.i('uHoleN', 0); gl.bindVertexArray(this.boxVAO);
    for (const db of w.debris) if (db.kind === 'plank') {
      p.m('uModel', db.modelMatrix(this.tmp)); p.f('uScale', db.size[0], db.size[1], db.size[2]); gl.drawElements(gl.TRIANGLES, this.boxCount, gl.UNSIGNED_INT, 0);
    }
    p.f('uScale', 1, 1, 1);
    // rigging lines
    gl.bindVertexArray(this.lineVAO); p = this.pLine.use(); this.env(p, fr); p.m('uVP', vp); p.f('uCol', .07, .05, .035, 1);
    for (const s of w.ships) {
      if (s.dead) continue; const sc = s.s; const R = s.R; const Rs = Float64Array.from([R[0] * sc, R[1] * sc, R[2] * sc, R[3] * sc, R[4] * sc, R[5] * sc, R[6] * sc, R[7] * sc, R[8] * sc]);
      p.m('uModel', M4.fromRT(Rs, s.toWorld([0, 0, 0]), this.tmp)); for (const m of s.masts) if (m.alive) gl.drawArrays(gl.LINES, d.lines[m.i][0], d.lines[m.i][1]);
    }
  }
  post(fr) {
    const gl = this.gl; gl.disable(gl.DEPTH_TEST);
    let p = this.pass(this.h0, this.pBright); this.bindTex(0, this.B.c); p.i('uT', 0); p.f('uTexel', 1 / this.W, 1 / this.H); gl.drawArrays(gl.TRIANGLES, 0, 3);
    const blur = (src, dst, dx, dy) => { const q = this.pass(dst, this.pBlur); this.bindTex(0, src.c); q.i('uT', 0); q.f('uDir', dx / src.w, dy / src.h); gl.drawArrays(gl.TRIANGLES, 0, 3); };
    const down = (src, dst) => { const q = this.pass(dst, this.pCopy); this.bindTex(0, src.c); q.i('uT', 0); gl.drawArrays(gl.TRIANGLES, 0, 3); };
    down(this.h0, this.q1); blur(this.q1, this.q2, 1, 0); blur(this.q2, this.q1, 0, 1);
    down(this.q1, this.e1); blur(this.e1, this.e2, 1, 0); blur(this.e2, this.e1, 0, 1); blur(this.e1, this.e2, 1.5, 0); blur(this.e2, this.e1, 0, 1.5);
    p = this.pass(this.C, this.pComp); this.bindTex(0, this.B.c); this.bindTex(1, this.q1.c); this.bindTex(2, this.e1.c); p.i('uT', 0); p.i('uB1', 1); p.i('uB2', 2);
    p.f('uExp', fr.env.exp * (1 - Math.min(0.35, fr.flash * 0.3))); p.f('uTime', fr.time % 100); p.f('uFlash', fr.flash); p.f('uBloom', fr.env.bloom + fr.flash * 0.3); p.f('uRes', this.W, this.H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    p = this.pass(null, this.pFxaa); this.bindTex(0, this.C.c); p.i('uT', 0); p.f('uTexel', 1 / this.W, 1 / this.H); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
