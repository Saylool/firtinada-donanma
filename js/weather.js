'use strict';
// Weather presets: sea state, wind, sky, light, rain, fog... blended smoothly when the preset changes.
const WEATHER = {
  firtina:   { name: 'Fırtına',        amp: 1.0, sharp: 1.0, wind: 21, lo: .30, zen: [.028, .038, .058], hor: [.20, .225, .25], cd: [.030, .034, .042], cl: [.36, .37, .40], elev: .17, sun: [1.05, .63, .36], glow: [.42, 1.6], rain: 6500, fog: .00050, bolt: 8, exp: 1.25, light: 1.0, wd: [.006, .024, .034], ws: [.03, .10, .105], bloom: .55 },
  kasirga:   { name: 'Kasırga',        amp: 1.65, sharp: 1.2, wind: 32, lo: .18, zen: [.014, .018, .028], hor: [.12, .13, .15], cd: [.02, .022, .028], cl: [.24, .25, .28], elev: .10, sun: [.5, .34, .2], glow: [.15, .5], rain: 14000, fog: .00095, bolt: 3.5, exp: 1.4, light: .75, wd: [.004, .016, .022], ws: [.02, .07, .075], bloom: .6 },
  acik:      { name: 'Açık & güneşli', amp: .45, sharp: .65, wind: 9, lo: .70, zen: [.05, .17, .48], hor: [.42, .60, .84], cd: [.42, .45, .5], cl: [1.1, 1.1, 1.08], elev: .52, sun: [3.0, 2.75, 2.3], glow: [.14, 1.4], rain: 0, fog: .00016, bolt: 0, exp: .95, light: 2.1, wd: [.010, .07, .11], ws: [.03, .22, .24], bloom: .5 },
  sisli:     { name: 'Sisli',          amp: .38, sharp: .6, wind: 6, lo: .28, zen: [.30, .33, .37], hor: [.46, .49, .52], cd: [.36, .38, .41], cl: [.62, .64, .66], elev: .30, sun: [1.0, .95, .85], glow: [.2, .3], rain: 0, fog: .0042, bolt: 0, exp: 1.05, light: 1.5, wd: [.02, .06, .07], ws: [.05, .13, .14], bloom: .4 },
  gunbatimi: { name: 'Gün batımı',     amp: .62, sharp: .8, wind: 12, lo: .46, zen: [.07, .09, .24], hor: [.95, .42, .22], cd: [.20, .11, .12], cl: [1.5, .7, .4], elev: .035, sun: [3.6, 1.5, .55], glow: [.7, 2.8], rain: 0, fog: .00032, bolt: 0, exp: .95, light: 1.05, wd: [.012, .04, .07], ws: [.10, .11, .14], bloom: .7 },
  gece:      { name: 'Gece fırtınası', amp: 1.1, sharp: 1.0, wind: 19, lo: .30, zen: [.003, .005, .012], hor: [.018, .026, .045], cd: [.004, .005, .008], cl: [.05, .06, .09], elev: .55, sun: [.32, .40, .62], glow: [0, 0], rain: 6000, fog: .00055, bolt: 6, exp: 1.5, light: .14, wd: [.002, .008, .012], ws: [.008, .03, .04], bloom: .8 },
  yagmur:    { name: 'Yağmurlu',       amp: .78, sharp: .85, wind: 14, lo: .30, zen: [.09, .10, .12], hor: [.28, .30, .32], cd: [.09, .10, .12], cl: [.34, .36, .38], elev: .25, sun: [.9, .85, .75], glow: [.1, .2], rain: 4200, fog: .0009, bolt: 0, exp: 1.2, light: 1.1, wd: [.008, .03, .04], ws: [.03, .09, .10], bloom: .45 },
};
const WEATHER_KEYS = Object.keys(WEATHER);
const Weather = {
  key: 'firtina', cur: null, tgt: null, auto: false, autoT: 0,
  flat(w) { return [w.amp, w.sharp, w.wind, w.lo, ...w.zen, ...w.hor, ...w.cd, ...w.cl, w.elev, ...w.sun, ...w.glow, w.rain, w.fog, w.bolt, w.exp, w.light, ...w.wd, ...w.ws, w.bloom]; },
  init(key) { this.set(key, true); },
  set(key, instant) { if (!WEATHER[key]) return; this.key = key; this.tgt = this.flat(WEATHER[key]); if (instant || !this.cur) this.cur = this.tgt.slice(); },
  update(dt) {
    const k = 1 - Math.exp(-dt * 0.35);
    for (let i = 0; i < this.cur.length; i++) this.cur[i] += (this.tgt[i] - this.cur[i]) * k;
    if (this.auto) { this.autoT -= dt; if (this.autoT <= 0) { this.autoT = 70 + Math.random() * 50; this.set(WEATHER_KEYS[(Math.random() * WEATHER_KEYS.length) | 0]); if (this.onAuto) this.onAuto(this.key); } }
    return this.env();
  },
  env() {
    if (!this.cur) this.set('firtina', true);
    const c = this.cur; let i = 0; const take = n => { const a = c.slice(i, i + n); i += n; return n === 1 ? a[0] : a; };
    const e = { amp: take(1), sharp: take(1), wind: take(1), lo: take(1), zen: take(3), hor: take(3), cd: take(3), cl: take(3), elev: take(1), sun: take(3), glow: take(2), rain: take(1), fog: take(1), bolt: take(1), exp: take(1), light: take(1), wd: take(3), ws: take(3), bloom: take(1) };
    const az = 2.2, ce = Math.cos(Math.asin(Math.min(.95, e.elev)));
    e.sunDir = V3.norm([Math.cos(az) * ce, e.elev, Math.sin(az) * ce]);
    return e;
  },
};
