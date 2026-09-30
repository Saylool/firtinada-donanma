'use strict';
// ONE wave function shared by physics (JS) and the water/ship shaders (GLSL).
// h(x,z,t) = sum_i A_i * ( exp(s_i (sin(k_i.p - w_i t + phi_i) - 1)) - m_i )    (sharp-crested, deep-water dispersion w^2 = g k)
const GRAV = 9.81;
const Waves = {
  N: 8,
  amp: 1.0,          // sea-state scale (shared with shader through uniform)
  sharpMul: 1.0,     // crest sharpness multiplier (calm swell vs. breaking chop)
  windAngle: 0.6,    // direction the wind blows TOWARD, radians in the x-z plane
  windSpeed: 21,
  A: new Float32Array(32), B: new Float32Array(32), // uniform arrays (vec4 x8)
  def: [ // wavelength, amplitude, direction offset (deg), sharpness
    [128, 3.1, 0, 1.6], [88, 2.3, 14, 1.5], [61, 1.7, -18, 1.4], [43, 1.2, 28, 1.3],
    [30, 0.85, -32, 1.2], [21, 0.58, 40, 1.1], [15, 0.38, -46, 1.0], [10.5, 0.24, 55, 0.9]],
  kx: [], kz: [], om: [], ph: [], amps: [], sh: [], se: [], mean: [], kk: [],
  init(seed, windAngle) {
    const rnd = mulberry32(seed || 7);
    this.windAngle = windAngle;
    for (let i = 0; i < this.N; i++) {
      const [lam, a, off, s] = this.def[i];
      const k = TAU / lam, ang = windAngle + off * Math.PI / 180;
      this.kk[i] = k; this.kx[i] = Math.cos(ang) * k; this.kz[i] = Math.sin(ang) * k;
      this.om[i] = Math.sqrt(GRAV * k); this.ph[i] = rnd() * TAU; this.amps[i] = a; this.sh[i] = s;
    }
    this.upload();
  },
  setAmp(a, sharp) { this.amp = a; if (sharp !== undefined) this.sharpMul = sharp; this.upload(); },
  upload() {
    for (let i = 0; i < this.N; i++) {
      const s = this.se[i] = this.sh[i] * this.sharpMul; // mean of exp(s(sin-1)) = exp(-s) I0(s)
      let I0 = 0, term = 1; for (let n = 0; n < 30; n++) { I0 += term; term *= (s / 2) * (s / 2) / ((n + 1) * (n + 1)); }
      this.mean[i] = Math.exp(-s) * I0;
      this.A.set([this.kx[i], this.kz[i], this.om[i], this.ph[i]], i * 4);
      this.B.set([this.amps[i] * this.amp, this.se[i], this.mean[i], 0], i * 4);
    }
  },
  height(x, z, t) {
    let h = 0;
    for (let i = 0; i < this.N; i++) {
      const th = this.kx[i] * x + this.kz[i] * z - this.om[i] * t + this.ph[i];
      h += this.amps[i] * this.amp * (Math.exp(this.se[i] * (Math.sin(th) - 1)) - this.mean[i]);
    }
    return h;
  },
  // out = [h, dh/dx, dh/dz, dh/dt, ux, uz]  (u = horizontal orbital velocity of the water)
  sample(x, z, t, out) {
    let h = 0, gx = 0, gz = 0, ht = 0, ux = 0, uz = 0;
    const amp = this.amp;
    for (let i = 0; i < this.N; i++) {
      const kx = this.kx[i], kz = this.kz[i], om = this.om[i], A = this.amps[i] * amp;
      const th = kx * x + kz * z - om * t + this.ph[i];
      const e = Math.exp(this.se[i] * (Math.sin(th) - 1));
      const eta = A * (e - this.mean[i]);
      const d = A * this.se[i] * e * Math.cos(th);
      h += eta; gx += d * kx; gz += d * kz; ht -= d * om;
      const kk = this.kk[i]; ux += om * eta * kx / kk; uz += om * eta * kz / kk;
    }
    out[0] = h; out[1] = gx; out[2] = gz; out[3] = ht; out[4] = ux; out[5] = uz;
    return out;
  },
  glsl: `
uniform vec4 uWA[8]; uniform vec4 uWB[8]; uniform float uTime;
float waveH(vec2 p){ float h=0.; for(int i=0;i<8;i++){ float th=dot(uWA[i].xy,p)-uWA[i].z*uTime+uWA[i].w; h+=uWB[i].x*(exp(uWB[i].y*(sin(th)-1.))-uWB[i].z);} return h; }
vec3 waveHG(vec2 p){ float h=0.; vec2 g=vec2(0.); for(int i=0;i<8;i++){ float th=dot(uWA[i].xy,p)-uWA[i].z*uTime+uWA[i].w; float e=exp(uWB[i].y*(sin(th)-1.)); h+=uWB[i].x*(e-uWB[i].z); g+=uWB[i].x*uWB[i].y*e*cos(th)*uWA[i].xy; } return vec3(h,g); }
`,
};
