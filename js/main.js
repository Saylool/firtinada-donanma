'use strict';
(function () {
  const qs = new URLSearchParams(location.search);
  const $ = id => document.getElementById(id);
  const canvas = $('c');
  let R;
  try { R = new Renderer(canvas); } catch (e) { const el = $('err'); el.style.display = 'flex'; el.textContent = 'WebGL2 başlatılamadı: ' + e.message; throw e; }
  Hull.build();
  const world = new World(), fx = new FX(), snd = new Sound();
  const cfg = { seed: +(qs.get('seed') || (Math.random() * 9999 | 0)), perTeam: +(qs.get('ships') || 3), ts: +(qs.get('ts') || 1), dpr: 1.5, scale: +(qs.get('scale') || 1) };
  const G = { role: 'spectate', my: null, name: '', cls: 'line', team: 'auto', players: new Map(), snaps: [], evq: [], evc: [], lastRecv: 0, seed: cfg.seed, perTeam: cfg.perTeam, aim: null, mouse: null, fleetN: -1, respawnT: 0 };
  let paused = false, timeScale = cfg.ts, focus = 0, camMode = qs.get('cam') || 'cine', menuOpen = true;
  const cam = { pos: [0, 30, -300], target: [0, 8, 0], fov: 58 * Math.PI / 180 };
  const orbit = { yaw: 0.6, pitch: 0.22, dist: 120 }, chase = { yawOff: 0, pitch: 0.3, dist: 100, idle: 0 };
  const cine = { t: 99, shot: 0, ship: 0, a: 0, rate: 0.04, R: 300, H: 50, wide: true, next: 12 };
  const state = { fps: 60, uiT: 0 };
  const inp = { rud: 0, sail: 1, fire: false, mouse: false };
  const keys = {};
  let env = Weather.env();

  // ------------------------------------------------------------------ utilities
  const heading = s => Math.atan2(s.R[2], s.R[8]);
  const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000, r4 = x => Math.round(x * 10000) / 10000;
  let msgT = 0;
  function flashMsg(t) { const m = $('msg'); m.textContent = t; m.style.opacity = 1; msgT = 3.5; }
  function feed(t, color) { const f = $('feed'), d = document.createElement('div'); d.textContent = t; if (color) d.style.borderLeft = '3px solid ' + color; f.appendChild(d); while (f.children.length > 6) f.firstChild.remove(); setTimeout(() => d.remove(), 9000); }
  const teamCol = t => (t ? '#4c8cf0' : '#e0523f');
  const teamName = t => (t ? 'Mavi Filo' : 'Kızıl Filo');
  const isNet = () => G.role === 'client';
  const isSim = () => G.role !== 'client';

  // ------------------------------------------------------------------ weather
  function setWeather(key, instant, broadcast) {
    Weather.set(key, instant); $('wsel').value = key; $('mweather').value = key;
    if (broadcast && G.role === 'host') Net.broadcast({ t: 'weather', key, auto: Weather.auto });
  }
  WEATHER_KEYS.forEach(k => { for (const id of ['wsel', 'mweather']) { const o = document.createElement('option'); o.value = k; o.textContent = WEATHER[k].name; $(id).appendChild(o); } });
  { const o = document.createElement('option'); o.value = 'auto'; o.textContent = 'Değişken (otomatik)'; $('mweather').appendChild(o); }
  Weather.init(qs.get('weather') && WEATHER[qs.get('weather')] ? qs.get('weather') : 'firtina'); $('wsel').value = Weather.key; $('mweather').value = Weather.key;
  $('wsel').onchange = e => { if (!isNet()) setWeather(e.target.value, false, true); else $('wsel').value = Weather.key; };
  $('wauto').onchange = e => { Weather.auto = e.target.checked; Weather.autoT = 40; if (G.role === 'host') Net.broadcast({ t: 'weather', key: Weather.key, auto: Weather.auto }); };
  Weather.onAuto = key => { $('wsel').value = key; if (G.role === 'host') Net.broadcast({ t: 'weather', key, auto: true }); flashMsg('Hava değişiyor: ' + WEATHER[key].name); };

  // ------------------------------------------------------------------ battle setup
  function aiPool(seed, n) { const r = mulberry32(seed + 77), pool = ['line', 'frigate', 'line', 'frigate', 'sloop', 'first', 'sloop']; const a = []; for (let i = 0; i < n; i++) a.push(pool[(r() * pool.length) | 0]); return a; }
  const NAMES = [['Zafer', 'Fırtına', 'Kartal', 'Şahin', 'Akrep', 'Yavuz', 'Barbaros', 'Preveze'], ['Aslan', 'Ejder', 'Yıldırım', 'Kaplan', 'Grifon', 'Hydra', 'Kraken', 'Leviathan']];
  // entries: [{team, cls, name, helm, gun, hn, gn}] (ships with humans aboard); the rest of each fleet is filled with AI ships
  function buildRoster(seed, perTeam, entries) {
    const roster = [], ai = aiPool(seed, perTeam);
    for (let team = 0; team < 2; team++) {
      const hs = entries.filter(h => h.team === team); let used = 0;
      for (const h of hs) roster.push({ ...h });
      const n = Math.max(0, perTeam - hs.length);
      for (let i = 0; i < n; i++) roster.push({ team, cls: ai[i], name: NAMES[team][(used++ + (hs.length ? 2 : 0)) % 8] });
    }
    return roster;
  }
  const slotOf = s => (s.helm === 'local' && s.gun === 'local' ? 'both' : s.helm === 'local' ? 'helm' : s.gun === 'local' ? 'gun' : null);
  function humanEntry(id, name, cls, team, slot) { return { team, cls, name, helm: slot !== 'gun' ? id : null, gun: slot !== 'helm' ? id : null, hn: slot !== 'gun' ? name : '', gn: slot !== 'helm' ? name : '' }; }
  function pickTeam(pref) {
    if (pref === 0 || pref === 1) return pref;
    const c = [0, 0]; for (const s of world.ships) if (!s.sunk && !s.dead) c[s.team] += s.human ? 1.5 : 1;
    return c[0] === c[1] ? (Math.random() < 0.5 ? 0 : 1) : (c[0] < c[1] ? 0 : 1);
  }
  function startBattle(seed, humans) {
    G.seed = seed; const roster = buildRoster(seed, G.perTeam, humans);
    world.setup(seed, G.perTeam, undefined, roster);
    world.windSpeed = env.wind; Waves.setAmp(env.amp, env.sharp);
    fx.ps.length = 0; G.snaps.length = 0; G.my = null; focus = 0; cine.t = 99; G.fleetN = -1;
    G.ch = null; world.ships.forEach(s => { if (slotOf(s)) { G.my = s; G.slot = slotOf(s); G.ch = attachChar(s, 'local'); } for (const id of [s.helm, s.gun]) if (id && id !== 'local') { const p = G.players.get(id); if (p) p.ship = s; } });
    afterSetup(); $('banner').classList.remove('show');
  }
  function afterSetup() {
    buildFleetUI(); const me = G.my;
    $('pl').style.display = me ? 'block' : 'none'; document.body.classList.toggle('playing', !!me);
    if (me) { setRoleHint(); camMode = 'fps'; chase.yawOff = 0; chase.dist = 105 * me.s + 40; $('plName').textContent = me.name; $('plCls').textContent = me.cls.name; }
    else if (camMode === 'player') camMode = 'cine';
    buildCamBtns(); $('tsl').style.display = G.role === 'solo' || G.role === 'spectate' ? '' : 'none';
    updateRoomUI();
  }
  function setRoleHint() {
    const h = { both: '<b>W A S D</b> yürü · <b>fare</b> bak · <b>E</b> dümene geç / merdiven (inmek) · <b>Q</b> merdiven (çıkmak) · top başında <b>Boşluk / tık</b> ateş · dümende <b>A/D</b> dümen, <b>W/S</b> yelken, <b>F</b> abordaj',
      helm: '<b>Dümenci:</b> kıçtaki dümene git, <b>E</b> ile geç · <b>A/D</b> dümen · <b>W/S</b> yelken · <b>F</b> abordaj. Toplara dokunamazsın.',
      gun: '<b>Topçu:</b> ambarın merdivenine git (<b>E</b> in), bir topun başına geç, bakışınla topu doğrult (nişangâh yok, gözle), <b>Boşluk / tık</b> ateş.' };
    $('plHint').innerHTML = h[G.slot || 'both'];
  }
  function humansFromWorld() { return world.ships.filter(s => s.helm || s.gun).map(s => ({ team: s.team, cls: s.cls.key, name: s.name, helm: s.helm, gun: s.gun, hn: s.hn, gn: s.gn })); }
  function nextBattle() {
    const hs = humansFromWorld(); startBattle(G.seed + 1, hs);
    if (G.role === 'host') for (const [peer, c] of Net.conns) Net.send(c, initMsg(peer));
  }

  // ------------------------------------------------------------------ menu
  const CLS_KEYS = Object.keys(SHIP_CLASSES);
  function drawIcon(cv, C) {
    const g = cv.getContext('2d'), W = cv.width = 220, H = cv.height = 60; g.clearRect(0, 0, W, H); const s = C.s;
    const L = 120 * s, hx = (W - L) / 2, wl = 50; g.fillStyle = '#1b1b1f'; g.beginPath(); g.moveTo(hx, wl - 16 * s); g.lineTo(hx + L, wl - 12 * s); g.lineTo(hx + L - 14 * s, wl + 6 * s); g.lineTo(hx + 8 * s, wl + 6 * s); g.closePath(); g.fill();
    g.strokeStyle = '#c8a24a'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(hx + 4, wl - 8 * s); g.lineTo(hx + L - 2, wl - 6 * s); g.stroke();
    if (C.rows > 1) { g.beginPath(); g.moveTo(hx + 5, wl - 2 * s); g.lineTo(hx + L - 6, wl - 1 * s); g.stroke(); }
    for (const mi of C.masts) { const mx = hx + L * (0.5 + [0.28, 0.0, -0.22][mi]), h = [37, 42, 32][mi] * 0.95 * s; g.strokeStyle = '#6a4a2a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(mx, wl - 14 * s); g.lineTo(mx, wl - 14 * s - h); g.stroke(); g.fillStyle = '#d7c9a6'; for (const [a, b, w] of [[0.14, 0.5, 0.63], [0.53, 0.78, 0.47], [0.8, 0.97, 0.34]]) { if (mi === 2 && a === 0.14) continue; g.fillRect(mx - w * 16 * s, wl - 14 * s - h * b, w * 32 * s, h * (b - a) * 0.95); } }
  }
  CLS_KEYS.forEach(k => {
    const C = SHIP_CLASSES[k], d = document.createElement('div'); d.className = 'cls' + (k === G.cls ? ' on' : ''); d.dataset.k = k;
    d.innerHTML = `<canvas></canvas><b>${C.name}</b><small>${C.desc}</small><small>Top: ${(C.rows * C.ports.length) * 2} · Direk: ${C.masts.length}</small>`;
    drawIcon(d.querySelector('canvas'), C); d.onclick = () => { G.cls = k; document.querySelectorAll('.cls').forEach(x => x.classList.toggle('on', x === d)); }; $('clsGrid').appendChild(d);
  });
  $('pname').value = (() => { try { return localStorage.getItem('gs_name') || ''; } catch (e) { return ''; } })() || ('Kaptan' + ((Math.random() * 90 | 0) + 10));
  function readMenu() {
    G.name = ($('pname').value || 'Kaptan').trim().slice(0, 14); try { localStorage.setItem('gs_name', G.name); } catch (e) { /* private mode */ }
    G.slotSel = $('prole').value; G.team = $('pteam').value === 'auto' ? 'auto' : +$('pteam').value; G.perTeam = +$('psize').value;
    const w = $('mweather').value; if (w === 'auto') { Weather.auto = true; $('wauto').checked = true; Weather.autoT = 60; } else { Weather.auto = false; $('wauto').checked = false; setWeather(w, false); }
  }
  function mstat(t, ok) { const e = $('mstat'); e.textContent = t; e.className = ok ? 'ok' : ''; }
  function closeMenu() { menuOpen = false; $('menu').classList.add('gone'); }
  function openMenu() { menuOpen = true; $('menu').classList.remove('gone'); }
  function leaveNet() { if (Net.peer) Net.close(); G.players.clear(); world.clientMode = false; $('wsel').disabled = false; $('wauto').disabled = false; }
  function startSolo() {
    readMenu(); leaveNet(); G.role = 'solo'; const t = pickTeam(G.team === 'auto' ? (Math.random() < 0.5 ? 0 : 1) : G.team);
    startBattle((Math.random() * 9999) | 0, [humanEntry('local', G.name, G.cls, t, G.slotSel)]); closeMenu(); flashMsg('Savaş başlıyor — ' + teamName(t));
  }
  function startSpectate() { readMenu(); leaveNet(); G.role = 'spectate'; camMode = 'cine'; startBattle((Math.random() * 9999) | 0, []); closeMenu(); }
  async function startHost() {
    readMenu(); leaveNet(); mstat('Oda kuruluyor…', true);
    try {
      G.role = 'host'; timeScale = 1;
      const t = pickTeam(G.team === 'auto' ? (Math.random() < 0.5 ? 0 : 1) : G.team);
      startBattle((Math.random() * 9999) | 0, [humanEntry('local', G.name, G.cls, t, G.slotSel)]);
      await Net.host({ join: hostJoin, msg: hostMsg, leave: hostLeave });
      updateRoomUI(); closeMenu(); flashMsg('Oda kodu: ' + Net.code); mstat('');
    } catch (e) { console.warn(e); G.role = 'solo'; mstat('Oda kurulamadı: ' + (e.message || e.type || e), false); }
  }
  async function startJoin(code) {
    readMenu(); code = (code || $('jcode').value).trim().toUpperCase(); if (!code) return mstat('Oda kodunu yaz');
    leaveNet(); mstat('Odaya bağlanılıyor…', true);
    try {
      G.role = 'client'; timeScale = 1; world.clientMode = true;
      await Net.join(code, { msg: clientMsg, close: () => { if (G.role === 'client') { flashMsg('Bağlantı koptu'); feed('Host ile bağlantı koptu', '#ffb9a8'); G.role = 'spectate'; world.clientMode = false; openMenu(); mstat('Bağlantı koptu — yeni oyun başlatabilirsin'); } } });
      Net.toHost({ t: 'hello', name: G.name, cls: G.cls, team: G.team, slot: G.slotSel });
      mstat('Bağlandı, savaş bilgisi alınıyor…', true);
    } catch (e) { console.warn(e); G.role = 'spectate'; world.clientMode = false; mstat('Katılamadı: ' + (e.message || e.type || e), false); }
  }
  $('bSolo').onclick = startSolo; $('bHost').onclick = startHost; $('bSpec').onclick = startSpectate; $('bJoin').onclick = () => startJoin();
  $('menuBtn').onclick = () => (menuOpen ? closeMenu() : openMenu());
  $('jcode').addEventListener('keydown', e => { if (e.key === 'Enter') startJoin(); });
  if (qs.get('room')) { $('jcode').value = qs.get('room').toUpperCase(); mstat('Odaya katılmak için “Odaya katıl”a bas', true); }
  function updateRoomUI() {
    const el = $('room');
    if (G.role === 'host' && Net.code) {
      const link = location.origin + location.pathname + '?room=' + Net.code; el.style.display = 'block'; $('title').style.display = 'none';
      el.innerHTML = `<b>🌐 Oda: <span style="color:var(--gold);letter-spacing:2px">${Net.code}</span></b> · ${Net.conns.size + 1} oyuncu<br><button id="cpl">Bağlantıyı kopyala</button>`;
      $('cpl').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(link).then(() => flashMsg('Bağlantı kopyalandı'), () => prompt('Bağlantı:', link)); };
    } else if (G.role === 'client') { el.style.display = 'block'; $('title').style.display = 'none'; el.innerHTML = `<b>🌐 Oda ${Net.code}</b> · online`; }
    else { el.style.display = 'none'; $('title').style.display = ''; }
  }

  // ------------------------------------------------------------------ HUD
  const fleetEl = $('fleet');
  function buildFleetUI() {
    G.fleetN = world.ships.length;
    fleetEl.innerHTML = world.ships.map(s => `<div class="ship" id="sh${s.id}"><div class="n"><span><i style="background:${teamCol(s.team)}"></i>${s.helm ? '⚓' : ''}${s.gun ? '🎯' : ''} ${s.hn && s.gn && s.hn !== s.gn ? s.hn + ' & ' + s.gn : s.name} <small>${s.cls.name}</small></span><span class="st">…</span></div>
      <div class="bar"><b class="fl" style="background:#4aa3df"></b></div><div class="bar"><b class="sl" style="background:#d8c48a"></b></div><small class="dt"></small></div>`).join('');
  }
  function updateFleetUI() {
    if (G.fleetN !== world.ships.length) buildFleetUI();
    for (const s of world.ships) {
      const el = $('sh' + s.id); if (!el) continue;
      const ratio = clamp(s.flood / (s.M0 * 0.42), 0, 1);
      el.classList.toggle('sunk', !!s.sunk); el.classList.toggle('me', s === G.my);
      el.querySelector('.st').textContent = s.sunk ? 'BATTI' : s.board != null ? '⚔ abordaj' : s.captured ? 'ele geçirildi' : s.fires.length ? '🔥 yanıyor' : ratio > 0.6 ? 'batıyor' : ratio > 0.2 ? 'su alıyor' : 'sağlam';
      el.querySelector('.fl').style.width = (ratio * 100) + '%'; el.querySelector('.sl').style.width = clamp((s.sailArea || 0) / (s.fullArea * s.s * s.s) * 100, 0, 100) + '%';
      el.querySelector('.dt').textContent = `mürettebat %${Math.round(s.crew * 100)} · direk ${s.masts.filter(m => m.alive).length}/${s.masts.length} · delik ${s.holes.length} · su ${(s.flood / 1e3).toFixed(0)} t`;
    }
  }
  const camNames = { fps: 'Karakter (1. şahıs)', cine: 'Sinematik', orbit: 'Serbest', player: 'Dış görünüm' };
  function buildCamBtns() {
    const ks = G.my ? ['fps', 'player', 'cine'] : ['cine', 'orbit'];
    $('camBtns').innerHTML = ks.map(k => `<button data-cam="${k}" class="${k === camMode ? 'on' : ''}">${camNames[k]}</button>`).join(' ');
    $('camBtns').querySelectorAll('button').forEach(b => b.onclick = () => setCam(b.dataset.cam));
  }
  function setCam(m) { camMode = m; buildCamBtns(); if (m === 'cine') cine.t = 99; if (m === 'orbit') { orbit.yaw = Math.atan2(cam.pos[2] - cam.target[2], cam.pos[0] - cam.target[0]); orbit.dist = clamp(V3.len(V3.sub(cam.pos, cam.target)), 30, 700); } }
  document.querySelectorAll('[data-ts]').forEach(b => b.onclick = () => { timeScale = +b.dataset.ts; document.querySelectorAll('[data-ts]').forEach(x => x.classList.toggle('on', x === b)); });
  $('snd').onclick = () => { snd.init(); snd.on = !snd.on; if (snd.master) snd.master.gain.value = snd.on ? 0.7 : 0; $('snd').textContent = 'Ses: ' + (snd.on ? 'açık' : 'kapalı'); };
  if (qs.get('hud') === '0') $('hud').classList.add('hide');

  const mm = $('mm').getContext('2d');
  function drawMinimap() {
    const W = 170, c = W / 2, my = G.my; let cx, cz, rot = 0;
    if (my && !my.dead) { cx = my.com[0]; cz = my.com[2]; rot = heading(my); } else { const f = fleetCenter(); cx = f[0]; cz = f[2]; }
    const sc = W / 2 / 420; mm.clearRect(0, 0, W, W); mm.save(); mm.beginPath(); mm.arc(c, c, c - 1, 0, TAU); mm.clip();
    mm.fillStyle = 'rgba(10,30,44,.85)'; mm.fillRect(0, 0, W, W); mm.strokeStyle = 'rgba(255,255,255,.14)'; mm.lineWidth = 1;
    for (const r of [100, 200, 300, 400]) { mm.beginPath(); mm.arc(c, c, r * sc, 0, TAU); mm.stroke(); }
    const P = (x, z) => { const dx = x - cx, dz = z - cz; const cs = Math.cos(rot), sn = Math.sin(rot); return [c + (dx * cs - dz * sn) * sc, c - (dx * sn + dz * cs) * sc]; };
    for (const s of world.ships) {
      if (s.dead) continue; const [x, y] = P(s.com[0], s.com[2]); mm.save(); mm.translate(x, y); mm.rotate(heading(s) - rot);
      mm.fillStyle = s.sunk ? '#666' : teamCol(s.team); const k = 3.2 + s.s * 2.2; mm.beginPath(); mm.moveTo(0, -k * 1.4); mm.lineTo(k * 0.8, k); mm.lineTo(-k * 0.8, k); mm.closePath(); mm.fill();
      if (s === my) { mm.strokeStyle = '#fff'; mm.lineWidth = 1.5; mm.stroke(); } mm.restore();
    }
    const wa = Math.atan2(world.windDir[0], world.windDir[1]) - rot; mm.strokeStyle = '#bfe3ff'; mm.fillStyle = '#bfe3ff'; mm.lineWidth = 2; mm.save(); mm.translate(W - 26, 26); mm.rotate(wa);
    mm.beginPath(); mm.moveTo(0, 12); mm.lineTo(0, -10); mm.stroke(); mm.beginPath(); mm.moveTo(-5, -4); mm.lineTo(0, -12); mm.lineTo(5, -4); mm.fill(); mm.restore();
    mm.fillStyle = 'rgba(255,255,255,.7)'; mm.font = '10px sans-serif'; mm.fillText('rüzgâr', W - 44, 50);
    mm.restore(); mm.strokeStyle = 'rgba(255,255,255,.25)'; mm.beginPath(); mm.arc(c, c, c - 1, 0, TAU); mm.stroke();
  }
  function updatePlayerHUD() {
    const s = G.my; if (!s) return;
    $('spd').textContent = (Math.hypot(s.vel[0], s.vel[2]) * 1.944).toFixed(1); const h = ((heading(s) * 57.3) + 360) % 360; $('hdg').textContent = String(Math.round(h)).padStart(3, '0') + '°';
    $('plSail').style.width = clamp((s.sailSet || 0) * (s.sailArea || 0) / (s.fullArea * s.s * s.s) * 100, 0, 100) + '%';
    const hull = clamp(1 - s.flood / (s.M0 * 0.42), 0, 1); const b = $('plHull'); b.style.width = hull * 100 + '%'; b.style.background = hull > 0.6 ? '#5fbf7a' : hull > 0.3 ? '#e0b040' : '#e0523f';
    const cnt = [0, 0, 0, 0]; for (const g of s.guns) { const i = g.side > 0 ? 0 : 1; cnt[i + 2]++; if (g.t <= 0) cnt[i]++; }
    $('plGuns').textContent = `◄ ${cnt[0]}/${cnt[2]} · ${cnt[1]}/${cnt[3]} ►`; $('plCrew').style.width = s.crew * 100 + '%';
    let near = null, nd = 1e9; for (const e of world.ships) { if (e.team === s.team || e.sunk || e.dead) continue; const d = Math.hypot(e.com[0] - s.com[0], e.com[2] - s.com[2]); if (d < nd) { nd = d; near = e; } }
    const hint = $('plBoard'); const ch = G.ch, slot = G.slot || 'both'; let pr = '';
    if (s.board != null) { const o = world.ships[s.board]; pr = `⚔ ABORDAJ — düşman mürettebatı %${o ? Math.round(o.crew * 100) : 0}${ch && ch.mode === 1 ? ' (F: halatları kes)' : ''}`; }
    else if (ch && !ch.climb && !s.sunk) {
      const wp = Char.wheelPos(s), lp = Char.ladderPos(s);
      if (ch.mode === 1) pr = 'Dümendesin — A/D dümen · W/S yelken · F abordaj (en yakın düşman gemisi) · E: dümeni bırak';
      else if (ch.lvl === 0 && Char.near(ch, wp, 2.6)) pr = slot === 'gun' ? 'Dümen seninle değil' : 'E: dümene geç';
      else if (Char.near(ch, lp, 2.2)) pr = ch.lvl === 0 ? 'E: ambara in (top güverteleri)' : ch.lvl === 1 ? 'E: alt güverteye in · Q: yukarı çık' : 'Q: yukarı çık';
      else if (G.nearGun >= 0) { const g = s.guns[G.nearGun]; pr = slot === 'helm' ? 'Toplara dokunamazsın — sen dümencisin' : g.t > 0 ? `Top yükleniyor… ${Math.ceil(g.t)} sn` : 'Top hazır — bakışınla doğrult, Boşluk / tık: ateş'; }
      else if (ch.lvl > 0 && slot !== 'helm') pr = 'Bir topun başına git (borda kenarı)';
      else if (ch.lvl === 0 && slot !== 'helm') pr = 'Topçu: merdivenden ambara in (E) — toplar aşağıda';
    }
    if (pr) { hint.textContent = pr; hint.style.display = 'block'; } else hint.style.display = 'none';
    if (s.sunk || s.captured) { G.respawnT += 0.2; if (G.respawnT > 6 && !$('banner').classList.contains('show')) { const b2 = $('banner'); b2.innerHTML = (s.captured ? 'Geminiz ele geçirildi' : 'Geminiz battı') + '<br><span style="font-size:16px;font-weight:400">R tuşu: yeni gemi ile yeniden katıl</span>'; b2.classList.add('show'); } } else G.respawnT = 0;
  }

  // ------------------------------------------------------------------ world hooks (local effects + network events)
  const ev = e => { if (G.role === 'host') { e.t = world.t; G.evq.push(e); } };
  const distCam = p => V3.len(V3.sub(p, cam.pos));
  function fxShot(pos, dir, ship) { fx.muzzle(pos, dir, ship); const d = distCam(pos); snd.boom(d, ship.s > 0.9 ? 1 : 0.75); fx.shake = Math.min(1, fx.shake + 0.4 / (1 + d / 40)); }
  function fxHit(pos, v, ship, kind, pw) { fx.hit(pos, v, ship, kind, pw); snd.hit(distCam(pos), kind === 'break' ? 1.5 : 1); }
  function fxSplash(pos, p, v) { fx.splash(pos, p, v); snd.splash(distCam(pos), p); }
  function sunkMsg(s) { feed(`${s.name} batıyor!`, teamCol(s.team)); if (s === G.my) flashMsg('Geminiz batıyor!'); }
  world.on.shot = (pos, dir, ship) => { fxShot(pos, dir, ship); ev({ k: 's', p: pos.map(r1), d: dir.map(r3), si: ship.id }); };
  world.on.hit = (pos, v, ship, kind, pw) => { fxHit(pos, v, ship, kind, pw); if (kind === 'break') feed(`${ship.name}: direk kırıldı`, teamCol(ship.team)); ev({ k: 'h', p: pos.map(r1), v: v.map(r1), si: ship.id, kind, pw }); };
  world.on.splash = (pos, p, v) => { fxSplash(pos, p, v); ev({ k: 'w', p: pos.map(r1), pw: r2(p), v: v.map(r1) }); };
  world.on.crash = pos => { fx.hit(pos, [0, 0, 0], { vel: [0, 0, 0] }, 'hull', 1.5); snd.hit(distCam(pos), 1.2); ev({ k: 'c', p: pos.map(r1) }); };
  world.on.sunk = s => { sunkMsg(s); fx.sinkBurst(s, world.t); ev({ k: 'k', si: s.id }); };
  function fxMusket(a, t) { fx.musket(a, t); snd.musket(distCam(a.com)); }
  function boardMsg(a, b) { feed(`⚔ ${a.name} ${b.name} gemisine abordaj yapıyor!`, teamCol(a.team)); if (a === G.my || b === G.my) flashMsg('ABORDAJ!'); }
  function capMsg(l, w) { feed(`🏴 ${w.name}, ${l.name} gemisini ele geçirdi!`, teamCol(w.team)); if (l === G.my) flashMsg('Geminiz ele geçirildi!'); buildFleetUI(); }
  world.on.musket = (a, t) => { fxMusket(a, t); ev({ k: 'm', si: a.id, ti: t.id }); };
  world.on.board = (a, b) => { boardMsg(a, b); ev({ k: 'b', si: a.id, ti: b.id }); };
  world.on.captured = (l, w) => { capMsg(l, w); ev({ k: 'x', si: l.id, ti: w.id }); if (G.role === 'host') sendSlots(l); };
  world.on.hole = (s, h) => ev({ k: 'o', si: s.id, p: h.p.map(r2), r: r2(h.r), f: h.flood ? 1 : 0 });
  world.on.shole = (s, m, h) => ev({ k: 'q', si: s.id, mi: m.i, h: h.map(r2) });
  fx.onThunder = d => snd.thunder(d);
  fx.rnd = mulberry32(99);

  // ------------------------------------------------------------------ networking: host side
  function hostJoin(peer) { /* wait for 'hello' */ }
  function hostMsg(peer, d) {
    if (!d || !d.t) return;
    if (d.t === 'hello') {
      const cls = SHIP_CLASSES[d.cls] ? d.cls : 'line', slot = ['helm', 'gun'].includes(d.slot) ? d.slot : 'both', name = String(d.name || 'Oyuncu').slice(0, 14);
      const pref = d.team === 'auto' ? 'auto' : +d.team; let s = null, isNew = false;
      if (slot !== 'both') { // join a ship whose partner slot is human and this slot is still empty
        const open = world.ships.filter(x => !x.sunk && !x.dead && !x.captured && x[slot] == null && (x.helm || x.gun) && (pref === 'auto' || x.team === pref));
        if (open.length) s = open[0];
      }
      if (s) { s[slot] = peer; s[slot === 'helm' ? 'hn' : 'gn'] = name; s.human = s.helm || s.gun; }
      else { const team = pickTeam(pref); s = world.addShip(humanEntry(peer, name, cls, team, slot)); isNew = true; }
      G.players.set(peer, { ship: s, name, slot }); s.chars = s.chars || {}; s.chars[peer] = Char.make(s);
      Net.send(Net.conns.get(peer), initMsg(peer));
      for (const [p2, c] of Net.conns) if (p2 !== peer) Net.send(c, isNew ? { t: 'add', id: s.id, e: shipEntry(s) } : slotMsg(s));
      feed(isNew ? `${name} katıldı (${teamName(s.team)})` : `${name}, ${s.name} gemisine ${slot === 'helm' ? 'dümenci' : 'topçu'} olarak bindi`, teamCol(s.team)); if (isNew) balanceTeams(); buildFleetUI(); updateRoomUI();
    } else if (d.t === 'in') {
      const p = G.players.get(peer); if (!p || !p.ship) return; const sh = p.ship; sh.chars = sh.chars || {}; const c = Array.isArray(d.c) ? d.c : null;
      let ch = sh.chars[peer]; if (!ch) ch = sh.chars[peer] = Char.make(sh);
      if (c) { ch.x = +c[0] || 0; ch.z = +c[1] || 0; ch.lvl = c[2] | 0; ch.yaw = +c[3] || 0; ch.pitch = +c[4] || 0; ch.mode = c[5] | 0; ch.moving = +c[6] || 0; ch.gi = c[7] | 0; ch.eyeY = Char.floorY(ch) + Char.EYE * sh.s; }
      if (sh.helm === peer) { const k = sh.ctrlH || (sh.ctrlH = { rud: 0, sail: 1, board: false, atHelm: false }); k.rud = clamp(+d.r || 0, -1, 1); k.sail = clamp(+d.s, 0, 1); k.atHelm = ch.mode === 1; k.board = k.board || !!d.b; }
      if (sh.gun === peer) { const g = sh.guns[ch.gi]; sh.ctrlG = { fire: !!d.f && !!g, gi: ch.gi, dl: g ? Char.gunDir(ch, g) : null }; }
    } else if (d.t === 'respawn') {
      const p = G.players.get(peer); if (!p || !p.ship || !(p.ship.sunk || p.ship.captured)) return; respawn(peer, SHIP_CLASSES[d.cls] ? d.cls : p.ship.cls.key);
    } else if (d.t === 'resync') Net.send(Net.conns.get(peer), initMsg(peer));
  }
  function hostLeave(peer) {
    const p = G.players.get(peer); if (p && p.ship) { const sh = p.ship; if (sh.helm === peer) { sh.helm = null; sh.hn = ''; } if (sh.gun === peer) { sh.gun = null; sh.gn = ''; } if (sh.chars) delete sh.chars[peer]; sh.human = sh.helm || sh.gun; feed(`${p.name} ayrıldı — görevi yapay zekâya devredildi`); Net.broadcast(slotMsg(sh)); }
    G.players.delete(peer); buildFleetUI(); updateRoomUI();
  }
  function balanceTeams() {
    for (let k = 0; k < 4; k++) {
      const c = [0, 0]; for (const s of world.ships) if (!s.sunk && !s.dead) c[s.team]++;
      if (Math.abs(c[0] - c[1]) < 2 || world.ships.length >= 12) break;
      const team = c[0] < c[1] ? 0 : 1; const s = world.addShip({ team, cls: aiPool(G.seed + world.ships.length, 1)[0], name: NAMES[team][(world.ships.length) % 8] });
      Net.broadcast({ t: 'add', id: s.id, e: shipEntry(s) });
    }
  }
  function slotMsg(s) { return { t: 'slot', si: s.id, hm: (s.helm ? 1 : 0) | (s.gun ? 2 : 0), hn: s.hn, gn: s.gn, team: s.team }; }
  function sendSlots(s) { Net.broadcast(slotMsg(s)); }
  function shipEntry(s) { const o = s.toWorld([0, 0, 0]); return { team: s.team, cls: s.cls.key, name: s.name, hm: (s.helm ? 1 : 0) | (s.gun ? 2 : 0), hn: s.hn, gn: s.gn, x: r1(o[0]), z: r1(o[2]), h: r3(heading(s)) }; }
  function respawn(id, cls) {
    const old = id === 'local' ? G.my : (G.players.get(id) || {}).ship; if (!old) return;
    const slot = old.helm === id && old.gun === id ? 'both' : old.helm === id ? 'helm' : 'gun';
    const s = world.addShip(humanEntry(id, old.name, cls, old.team, slot)); if (old.helm === id) old.helm = null; if (old.gun === id) old.gun = null; old.human = old.helm || old.gun;
    if (id === 'local') { G.my = s; G.slot = slot; G.ch = attachChar(s, 'local'); document.body.classList.add('playing'); camMode = 'fps'; buildCamBtns(); $('banner').classList.remove('show'); $('plCls').textContent = s.cls.name; setRoleHint(); } else G.players.get(id).ship = s;
    if (G.role === 'host') { Net.broadcast({ t: 'add', id: s.id, e: shipEntry(s) }); Net.broadcast(slotMsg(old)); if (id !== 'local') Net.send(Net.conns.get(id), { t: 'you', si: s.id, slot }); }
    buildFleetUI(); flashMsg('Yeni gemi denize indi');
  }
  function initMsg(peer) {
    const roster = world.ships.map(s => shipEntry(s));
    const holes = world.ships.map(s => s.holes.map(h => [...h.p.map(r2), r2(h.r), h.flood ? 1 : 0]));
    const sholes = world.ships.map(s => s.masts.map(m => m.holes.map(h => h.map(r2))));
    const ps = G.players.get(peer);
    return { t: 'init', seed: world.seed, wa: world.wa, weather: Weather.key, auto: Weather.auto, roster, my: ps && ps.ship ? ps.ship.id : -1, slot: ps ? ps.slot : null, wt: world.t, holes, sholes, gseed: G.seed };
  }
  const slotMask = s => (s.helm === 'local' && s.gun === 'local' ? 3 : s.helm === 'local' ? 1 : s.gun === 'local' ? 2 : 0);
  let snapAcc = 0;
  function encShip(s) {
    const o = s.toWorld([0, 0, 0]), q = s.q, gr = [0, 0, 0, 0]; for (const g of s.guns) { const i = g.side > 0 ? 0 : 1; gr[i + 2]++; if (g.t <= 0) gr[i]++; }
    return [s.id, r2(o[0]), r2(o[1]), r2(o[2]), r4(q[0]), r4(q[1]), r4(q[2]), r4(q[3]), r2(s.vel[0]), r2(s.vel[1]), r2(s.vel[2]), r3(s.w[0]), r3(s.w[1]), r3(s.w[2]),
      r2(s.rudder), r2(s.billow || 0), s.jibSign || 1, r2(s.sailSet), (s.sunk ? 1 : 0) | (s.dead ? 2 : 0), Math.round(s.flood), Math.round(s.sailArea || 0), s.comp.map(c => r1(c.vol)),
      s.masts.map(m => [m.alive ? 1 : 0, Math.round(m.hp), r2(m.yard), ...m.sailHp.map(r2)]), s.fires.map(f => [...f.p.map(r2), r1(f.t)]), gr, s.stats.hits, s.stats.shots, r3(s.crew), s.board == null ? -1 : s.board, s.team, s.captured ? 1 : 0];
  }
  function sendSnapshot() {
    if (!Net.conns.size) { G.evq = []; return; }
    const ds = world.debris.slice().sort((a, b) => a.age - b.age).slice(0, 70);
    const msg = { t: 'snap', tt: r3(world.t), ships: world.ships.map(encShip), balls: world.balls.slice(0, 80).map(b => [r1(b.p[0]), r1(b.p[1]), r1(b.p[2]), r1(b.v[0]), r1(b.v[1]), r1(b.v[2])]),
      deb: ds.map(d => { const o = d.toWorld([0, 0, 0]); return [d.id, d.kind === 'mast' ? 1 : 0, r1(o[0]), r1(o[1]), r1(o[2]), r3(d.q[0]), r3(d.q[1]), r3(d.q[2]), r3(d.q[3]), r2(d.size[0]), r2(d.size[1]), r2(d.size[2]), r2(d.scale || 1), d.mastOf || 0]; }),
      ch: world.ships.flatMap(s => Object.keys(s.chars || {}).map(id => { const c = s.chars[id], m = id === s.helm && id === s.gun ? 3 : id === s.helm ? 1 : id === s.gun ? 2 : (id === 'local' ? slotMask(s) : 0); return m ? [s.id, m, r2(c.x), r2(c.z), c.lvl, r2(c.yaw), c.mode, r1(c.moving || 0), r2(c.eyeY != null ? c.eyeY : Char.floorY(c) + Char.EYE * s.s)] : null; }).filter(Boolean)),
      ev: G.evq, ov: world.over ? world.winner + 2 : 0 };
    G.evq = []; Net.broadcast(msg);
  }

  // ------------------------------------------------------------------ networking: client side
  class NetBody extends Body { constructor() { super(); this.c = [0, 0, 0]; this.scale = 1; } }
  function clientMsg(d) {
    if (!d || !d.t) return;
    if (d.t === 'init') applyInit(d);
    else if (d.t === 'snap') { G.snaps.push({ d, tt: d.tt, recv: performance.now() }); if (G.snaps.length > 8) G.snaps.shift(); G.lastRecv = performance.now(); for (const e of d.ev || []) if (e.k === 'o' || e.k === 'q') applyStateEvent(e); else G.evc.push(e); }
    else if (d.t === 'add') { if (d.id === world.ships.length) { const e = d.e; const s = world.addShip({ team: e.team, cls: e.cls, name: e.name, helm: e.hm & 1 ? 'x' : null, gun: e.hm & 2 ? 'x' : null, hn: e.hn, gn: e.gn, x: e.x, z: e.z, h: e.h }); buildFleetUI(); if (e.hm) feed(`${e.name} savaşa katıldı`, teamCol(e.team)); } else Net.toHost({ t: 'resync' }); }
    else if (d.t === 'slot') { const s = world.ships[d.si]; if (s) { s.helm = d.hm & 1 ? 'x' : null; s.gun = d.hm & 2 ? 'x' : null; s.hn = d.hn; s.gn = d.gn; s.human = s.helm || s.gun; s.team = d.team; } buildFleetUI(); }
    else if (d.t === 'you') { G.my = world.ships[d.si] || null; G.slot = d.slot; G.ch = G.my ? attachChar(G.my, 'local') : null; camMode = 'fps'; buildCamBtns(); $('banner').classList.remove('show'); document.body.classList.add('playing'); if (G.my) $('plCls').textContent = G.my.cls.name; setRoleHint(); }
    else if (d.t === 'weather') { Weather.auto = d.auto; $('wauto').checked = d.auto; setWeather(d.key, false); }
  }
  function applyInit(m) {
    G.role = 'client'; world.clientMode = true; G.snaps.length = 0; G.evc.length = 0; G.seed = m.gseed;
    const roster = m.roster.map(e => ({ team: e.team, cls: e.cls, name: e.name, helm: e.hm & 1 ? 'x' : null, gun: e.hm & 2 ? 'x' : null, hn: e.hn, gn: e.gn }));
    world.setup(m.seed, 3, m.wa, roster); world.t = m.wt; world.clientMode = true;
    m.holes.forEach((hs, i) => { const s = world.ships[i]; if (s) s.holes = hs.map(h => ({ p: [h[0], h[1], h[2]], r: h[3], flood: !!h[4] })); });
    m.sholes.forEach((ms, i) => { const s = world.ships[i]; if (s) s.masts.forEach((mm2, j) => { mm2.holes = ms[j] || []; }); });
    G.my = m.my >= 0 ? world.ships[m.my] : null; G.slot = m.slot; G.ch = G.my ? attachChar(G.my, 'local') : null; Weather.auto = m.auto; $('wauto').checked = m.auto; setWeather(m.weather, true);
    fx.ps.length = 0; afterSetup(); closeMenu(); mstat(''); flashMsg(G.my ? 'Savaşa katıldın — ' + teamName(G.my.team) : 'Savaş izleniyor');
    $('tsl').style.display = 'none'; $('wsel').disabled = true; $('wauto').disabled = true;
  }
  function applyStateEvent(e) {
    const s = world.ships[e.si]; if (!s) return;
    if (e.k === 'o') { s.holes.push({ p: e.p, r: e.r, flood: !!e.f }); if (s.holes.length > 90) s.holes.shift(); }
    else if (e.k === 'q') { const m = s.masts.find(x => x.i === e.mi); if (m) { m.holes.push(e.h); if (m.holes.length > 10) m.holes.shift(); } }
  }
  function playEvent(e) {
    const s = world.ships[e.si];
    if (e.k === 's' && s) fxShot(e.p, e.d, s); else if (e.k === 'h' && s) { fxHit(e.p, e.v, s, e.kind, e.pw); if (e.kind === 'break') feed(`${s.name}: direk kırıldı`, teamCol(s.team)); }
    else if (e.k === 'w') fxSplash(e.p, e.pw, e.v); else if (e.k === 'c') { fx.hit(e.p, [0, 0, 0], { vel: [0, 0, 0] }, 'hull', 1.5); snd.hit(distCam(e.p), 1.2); }
    else if (e.k === 'k' && s) { s.sunk = true; sunkMsg(s); fx.sinkBurst(s, world.t); }
    else if (e.k === 'm' && s && world.ships[e.ti]) fxMusket(s, world.ships[e.ti]);
    else if (e.k === 'b' && s && world.ships[e.ti]) boardMsg(s, world.ships[e.ti]);
    else if (e.k === 'x' && s && world.ships[e.ti]) capMsg(s, world.ships[e.ti]);
  }
  const nlerp = (a, b, t) => { const q = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)]; if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) for (let i = 0; i < 4; i++) q[i] = lerp(a[i], -b[i], t); return Q.norm(q); };
  const netDeb = new Map();
  function clientUpdate(dt) {
    const sn = G.snaps; if (!sn.length) return; const last = sn[sn.length - 1];
    const est = last.tt + Math.min(0.3, (performance.now() - last.recv) / 1000), td = est - 0.14; world.t = td;
    let A = sn[0], B = sn[0]; for (let i = 0; i < sn.length; i++) { if (sn[i].tt <= td) A = sn[i]; if (sn[i].tt > td) { B = sn[i]; break; } B = sn[i]; }
    const f = B.tt > A.tt ? clamp((td - A.tt) / (B.tt - A.tt), 0, 1.4) : 1;
    const bm = new Map(); for (const a of B.d.ships) bm.set(a[0], a);
    for (const a of A.d.ships) {
      const s = world.ships[a[0]], b = bm.get(a[0]) || a; if (!s) continue;
      const o = [lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)];
      s.c = [0, 0, 0]; s.com = o; s.q = nlerp(a.slice(4, 8), b.slice(4, 8), Math.min(1, f)); Q.toMat(s.q, s.R);
      s.vel = [b[8], b[9], b[10]]; s.w = [b[11], b[12], b[13]];
      const n = last.d.ships.find(x => x[0] === a[0]) || b;
      s.rudder = n[14]; s.billow = n[15]; s.jibSign = n[16]; s.sailSet = n[17]; s.sunk = !!(n[18] & 1); s.dead = !!(n[18] & 2); s.flood = n[19]; s.sailArea = n[20];
      n[21].forEach((v, i) => { if (s.comp[i]) s.comp[i].vol = v; });
      n[22].forEach((mm2, i) => { const m = s.masts[i]; if (m) { m.alive = !!mm2[0]; m.hp = mm2[1]; m.yard = mm2[2]; for (let j = 0; j < m.sailHp.length; j++) m.sailHp[j] = mm2[3 + j]; } });
      s.fires = n[23].map(z => ({ p: [z[0], z[1], z[2]], t: z[3] })); s.stats.hits = n[25]; s.stats.shots = n[26]; s.crew = n[27]; s.board = n[28] < 0 ? null : n[28]; s.team = n[29]; s.captured = !!n[30];
      const cnt = [0, 0]; s.guns.forEach(g => { const i = g.side > 0 ? 0 : 1; if (cnt[i] >= n[24][i]) g.t = 1; else { g.t = 0; cnt[i]++; } });
    }
    { const mine = G.my ? (G.slot === 'both' ? 3 : G.slot === 'helm' ? 1 : 2) : 0; const seen = new Set();
      for (const c of last.d.ch || []) { const sh = world.ships[c[0]]; if (!sh || (sh === G.my && c[1] === mine)) continue; sh.chars = sh.chars || {}; const key = 'r' + c[1]; seen.add(sh.id + key);
        let ch = sh.chars[key]; if (!ch) { ch = sh.chars[key] = Char.make(sh); ch.x = c[2]; ch.z = c[3]; ch.eyeY = c[8]; }
        ch.x += (c[2] - ch.x) * 0.4; ch.z += (c[3] - ch.z) * 0.4; ch.lvl = c[4]; ch.yaw = c[5]; ch.mode = c[6]; ch.moving = c[7]; ch.eyeY += (c[8] - ch.eyeY) * 0.3; }
      for (const sh of world.ships) if (sh.chars) for (const k of Object.keys(sh.chars)) if (k[0] === 'r' && !seen.has(sh.id + k)) delete sh.chars[k]; }
    const dtl = Math.min(0.25, (performance.now() - last.recv) / 1000);
    world.balls = last.d.balls.map(b => ({ p: [b[0] + b[3] * dtl, b[1] + b[4] * dtl, b[2] + b[5] * dtl], v: [b[3], b[4], b[5]] }));
    const seen = new Set(); world.debris.length = 0;
    for (const d of last.d.deb) {
      let nb = netDeb.get(d[0]); if (!nb) { nb = new NetBody(); nb.id = d[0]; nb.kind = d[1] ? 'mast' : 'plank'; netDeb.set(d[0], nb); }
      nb.size = [d[9], d[10], d[11]]; nb.scale = d[12]; nb.mastOf = d[13]; nb.com = [d[2], d[3], d[4]]; nb.q = [d[5], d[6], d[7], d[8]]; Q.toMat(nb.q, nb.R); world.debris.push(nb); seen.add(d[0]);
    }
    for (const k of netDeb.keys()) if (!seen.has(k)) netDeb.delete(k);
    world.wind = world.windAt(td); world.over = last.d.ov ? 1 : 0; world.winner = last.d.ov ? last.d.ov - 2 : -1;
    while (G.evc.length && G.evc[0].t <= td) playEvent(G.evc.shift());
    if (G.evc.length > 300) G.evc.splice(0, G.evc.length - 300);
  }

  // ------------------------------------------------------------------ input
  const isTyping = () => document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  let drag = null;
  const locked = () => document.pointerLockElement === canvas;
  function look(dx, dy) { const ch = G.ch; if (!ch) return; ch.yaw -= dx * 0.0024; ch.pitch = clamp(ch.pitch - dy * 0.0024, -1.35, 1.35); if (ch.mode === 1) ch.yaw = clamp(ch.yaw, -2.6, 2.6); else ch.yaw = Math.atan2(Math.sin(ch.yaw), Math.cos(ch.yaw)); }
  canvas.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, moved: 0 }; inp.mouse = true; snd.init();
    if (camMode === 'fps' && G.my && !menuOpen && !locked() && canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch (er) { /* headless / denied */ } }
    else canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => { drag = null; inp.mouse = false; });
  canvas.addEventListener('pointermove', e => {
    G.mouse = { x: e.clientX, y: e.clientY };
    if (locked() && camMode === 'fps') { look(e.movementX, e.movementY); return; }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (camMode === 'fps') { look(dx, dy); return; }
    if (drag.moved < 6) return;
    if (camMode === 'cine') setCam(G.my ? 'player' : 'orbit');
    if (camMode === 'player') { chase.yawOff -= dx * 0.005; chase.pitch = clamp(chase.pitch + dy * 0.004, 0.03, 1.3); chase.idle = 0; }
    else { orbit.yaw -= dx * 0.005; orbit.pitch = clamp(orbit.pitch + dy * 0.004, -0.05, 1.4); }
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); if (camMode === 'fps') return; if (camMode === 'cine') setCam(G.my ? 'player' : 'orbit'); if (camMode === 'player') chase.dist = clamp(chase.dist * Math.exp(e.deltaY * 0.001), 30, 500); else orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 25, 900); }, { passive: false });
  document.addEventListener('pointerlockchange', () => { if (!locked() && camMode === 'fps' && G.my && !menuOpen) flashMsg('Fare serbest — tıklayınca tekrar kilitlenir'); });
  function useKey(dir) {
    const ch = G.ch, me = G.my; if (!ch || !me) return; const slot = G.slot || 'both';
    if (dir > 0 && ch.mode === 0 && ch.lvl === 0 && Char.near(ch, Char.wheelPos(me), 2.6) && slot === 'gun') { flashMsg('Dümen seninle değil — sen topçusun'); return; }
    const msg = Char.use(ch, dir); if (msg) flashMsg(msg);
  }
  addEventListener('keydown', e => {
    if (isTyping()) return; snd.init(); const k = e.key.toLowerCase(); keys[k] = true;
    if (e.key >= '1' && e.key <= '9' && !G.my) { const i = +e.key - 1; if (world.ships[i]) { focus = i; if (camMode === 'cine') setCam('orbit'); flashMsg(world.ships[i].name); } }
    else if (k === 'c') { const ks = G.my ? ['fps', 'player', 'cine'] : ['cine', 'orbit']; setCam(ks[(ks.indexOf(camMode) + 1) % ks.length]); }
    else if (k === ' ') { e.preventDefault(); if (!G.my && isSim() && G.role !== 'host') { paused = !paused; flashMsg(paused ? 'Duraklatıldı' : 'Devam'); } }
    else if (k === 'r') { if (G.my && (G.my.sunk || G.my.captured)) { if (G.role === 'client') Net.toHost({ t: 'respawn', cls: G.cls }); else respawn('local', G.cls); } else if (G.role === 'spectate' || G.role === 'solo') nextBattle(); }
    else if (k === 'e') useKey(1); else if (k === 'q') useKey(-1);
    else if (k === 'f') { if (G.my && G.slot !== 'gun') { if (G.ch && G.ch.mode === 1) inp.board = true; else flashMsg('Abordaj emri için dümende olmalısın (E)'); } }
    else if (k === 'h') $('hud').classList.toggle('hide'); else if (k === 'm') (menuOpen ? closeMenu() : openMenu());
    else if ((k === '+' || k === '=') && G.role !== 'host' && !isNet()) { timeScale = Math.min(6, timeScale * 1.5); flashMsg('Hız ×' + timeScale.toFixed(1)); }
    else if (k === '-' && G.role !== 'host' && !isNet()) { timeScale = Math.max(0.25, timeScale / 1.5); flashMsg('Hız ×' + timeScale.toFixed(1)); }
  });
  addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  // characters: walking, wheel, guns
  function attachChar(ship, id) { ship.chars = ship.chars || {}; const ch = Char.make(ship); ship.chars[id] = ch; return ch; }
  function readInput(dt) {
    const me = G.my, ch = G.ch; if (!me || !ch || ch.ship !== me) return;
    const slot = G.slot || 'both', hasH = slot !== 'gun', hasG = slot !== 'helm', dead = me.sunk || me.captured || menuOpen;
    const atHelm = ch.mode === 1;
    const fwd = (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0), str = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
    if (atHelm) { inp.rud = -str; if (fwd > 0) inp.sail = Math.min(1, inp.sail + dt * 0.6); if (fwd < 0) inp.sail = Math.max(0, inp.sail - dt * 0.6); }
    else inp.rud = 0;
    if (!dead && camMode !== 'cine') Char.step(ch, atHelm ? { fwd: 0, strafe: 0 } : { fwd, strafe: str, run: !!keys['shift'] }, dt); else Char.step(ch, { fwd: 0, strafe: 0 }, dt);
    ch.gi = hasG ? Char.nearestGun(ch) : -1;
    inp.fire = hasG && !dead && ch.gi >= 0 && (!!keys[' '] || inp.mouse);
    G.nearGun = ch.gi;
    const dl = ch.gi >= 0 ? Char.gunDir(ch, me.guns[ch.gi]) : null;
    if (G.role === 'client') { G.inT = (G.inT || 0) - dt; if (G.inT <= 0 || inp.board) { G.inT = 0.05; Net.toHost({ t: 'in', c: [r2(ch.x), r2(ch.z), ch.lvl, r3(ch.yaw), r3(ch.pitch), ch.mode, r1(ch.moving), ch.gi], r: inp.rud, s: r2(inp.sail), f: inp.fire ? 1 : 0, b: inp.board ? 1 : 0 }); inp.board = false; } }
    else {
      me.chars = me.chars || {}; me.chars.local = ch;
      if (hasH) { const c = me.ctrlH || (me.ctrlH = { rud: 0, sail: 1, board: false, atHelm: false }); c.rud = inp.rud; c.sail = inp.sail; c.atHelm = atHelm && !dead; if (inp.board) { c.board = true; inp.board = false; } }
      if (hasG) me.ctrlG = { fire: inp.fire, gi: ch.gi, dl };
    }
  }

  // ------------------------------------------------------------------ camera
  const aliveShips = () => world.ships.filter(s => !s.dead && !s.sunk);
  function fleetCenter() { const l = aliveShips(); const a = l.length ? l : world.ships; const c = [0, 0, 0]; if (!a.length) return c; a.forEach(s => { c[0] += s.com[0]; c[2] += s.com[2]; }); c[0] /= a.length; c[2] /= a.length; return c; }
  function updateCamera(dt) {
    if (camMode === 'manual') return;
    if ((camMode === 'player' || camMode === 'fps') && (!G.my || G.my.dead)) camMode = 'cine';
    if (camMode === 'fps' && G.my.sunk && G.respawnT > 3) { camMode = 'cine'; buildCamBtns(); }
    if (camMode === 'fps' && G.ch && G.ch.ship === G.my) {
      const s = G.my, ch = G.ch, e = s.toWorld(Char.eyeLocal(ch)), cp = Math.cos(ch.pitch), dw = M3.mulV(s.R, [cp * Math.sin(ch.yaw), Math.sin(ch.pitch), cp * Math.cos(ch.yaw)]);
      cam.pos = e; cam.target = [e[0] + dw[0] * 10, e[1] + dw[1] * 10, e[2] + dw[2] * 10]; cam.up = [s.R[1], s.R[4], s.R[7]]; cam.near = 0.12; cam.fov = 72 * Math.PI / 180; return;
    }
    cam.up = null; cam.near = 0.4; cam.fov = 58 * Math.PI / 180;
    let des = cam.pos, tgt = cam.target, k = 2.2;
    if (camMode === 'cine') {
      cine.t += dt;
      if (cine.t > cine.next || cine.t > 90) {
        cine.t = 0; cine.shot++; const r = Math.random, al = aliveShips();
        cine.wide = cine.shot % 3 === 1; cine.ship = al.length ? al[(r() * al.length) | 0].id : 0; cine.next = 11 + r() * 6;
        cine.a = r() * TAU; cine.rate = (r() < 0.5 ? -1 : 1) * (0.03 + r() * 0.03);
        if (cine.wide) { cine.R = 240 + r() * 120; cine.H = 25 + r() * 40; } else { cine.R = 65 + r() * 60; cine.H = 7 + r() * 14; }
      }
      cine.a += cine.rate * dt;
      const f = cine.wide || !world.ships[cine.ship] ? fleetCenter() : (() => { const s = world.ships[cine.ship]; return [s.com[0], 0, s.com[2]]; })();
      des = [f[0] + Math.cos(cine.a) * cine.R, cine.H, f[2] + Math.sin(cine.a) * cine.R]; tgt = [f[0], cine.wide ? 6 : 9, f[2]]; k = 1.2;
    } else if (camMode === 'orbit') {
      const s = world.ships[focus]; const f = s && !s.dead ? [s.com[0], 8, s.com[2]] : fleetCenter();
      const cp = Math.cos(orbit.pitch); des = [f[0] + Math.cos(orbit.yaw) * cp * orbit.dist, f[1] + Math.sin(orbit.pitch) * orbit.dist, f[2] + Math.sin(orbit.yaw) * cp * orbit.dist]; tgt = f; k = 8;
    } else if (camMode === 'player') {
      const s = G.my; chase.idle += dt; if (chase.idle > 2.5 && !drag) chase.yawOff *= Math.exp(-dt * 0.8);
      const a = heading(s) + Math.PI + chase.yawOff, cp = Math.cos(chase.pitch);
      des = [s.com[0] + Math.sin(a) * cp * chase.dist, s.com[1] + 8 + Math.sin(chase.pitch) * chase.dist, s.com[2] + Math.cos(a) * cp * chase.dist];
      const fw = [Math.sin(heading(s)), Math.cos(heading(s))]; tgt = [s.com[0] + fw[0] * 20 * s.s, s.com[1] + 8 * s.s + 2, s.com[2] + fw[1] * 20 * s.s]; k = 5;
    }
    const a = 1 - Math.exp(-dt * k);
    for (let i = 0; i < 3; i++) { cam.pos[i] += (des[i] - cam.pos[i]) * a; cam.target[i] += (tgt[i] - cam.target[i]) * Math.min(1, a * 1.5); }
    for (const sh of world.ships) {
      if (sh === G.my && camMode === 'player') continue;
      const dx = cam.pos[0] - sh.com[0], dz = cam.pos[2] - sh.com[2], d = Math.hypot(dx, dz), lim = 34 * sh.s;
      if (d < lim && cam.pos[1] < 55 * sh.s && !sh.dead) { const kk = lim / Math.max(d, 0.5); cam.pos[0] = sh.com[0] + dx * kk; cam.pos[2] = sh.com[2] + dz * kk; }
    }
    const hw = Waves.height(cam.pos[0], cam.pos[2], world.t); if (cam.pos[1] < hw + 3) cam.pos[1] = hw + 3;
    if (camMode === 'cine' && cine.t < 0.05 && cine.shot > 1) { for (let i = 0; i < 3; i++) cam.pos[i] = des[i]; for (let i = 0; i < 3; i++) cam.target[i] = tgt[i]; }
  }

  // ------------------------------------------------------------------ main loop
  const STEP = 1 / 120; let acc = 0, last = performance.now(), fpsAcc = 0, fpsN = 0;
  function frameData() {
    const t = world.t, e = env;
    return { world, fx, cam, env: e, fps: camMode === 'fps', localChar: G.ch, time: t, width: Math.floor(canvas.clientWidth * Math.min(devicePixelRatio, cfg.dpr) * cfg.scale), height: Math.floor(canvas.clientHeight * Math.min(devicePixelRatio, cfg.dpr) * cfg.scale),
      sunDir: e.sunDir, sunCol: e.sun, flash: fx.flash, flashDir: fx.flashDir, cloudOff: [world.windDir[0] * t * 0.0045 * (0.4 + e.wind / 22) + 3.1, world.windDir[1] * t * 0.0045 * (0.4 + e.wind / 22) + 1.7],
      fogD: e.fog, rain: Math.floor(e.rain), bolt: fx.bolt && fx.bolt.a > 0.02 ? fx.bolt : null, lights: fx.packLights(cam.pos) };
  }
  function render() {
    const shake = fx.shake * 0.35, saved = cam.target.slice();
    if (shake > 0.001) { cam.target[0] += (Math.random() - 0.5) * shake * 2; cam.target[1] += (Math.random() - 0.5) * shake * 2; }
    R.frame(frameData()); cam.target = saved;
  }
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = clamp((now - last) / 1000, 0, 0.1); last = now;
    fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { state.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; state.q = (state.q || 0) + 1; if (state.q % 4 === 0 && !qs.get('scale')) { if (state.fps < 28) cfg.scale = Math.max(0.55, cfg.scale * 0.88); else if (state.fps > 56 && cfg.scale < 1) cfg.scale = Math.min(1, cfg.scale * 1.06); } }
    env = Weather.update(dt); Waves.setAmp(env.amp, env.sharp); fx.boltEvery = env.bolt; world.windSpeed = env.wind;
    const ts = G.role === 'host' || isNet() ? 1 : timeScale;
    if (!paused || G.role === 'host') {
      if (isSim()) { acc += dt * ts; let n = 0; while (acc >= STEP && n < 60) { world.update(STEP); acc -= STEP; n++; } if (n >= 60) acc = 0; }
      else clientUpdate(dt);
      fx.update(dt * ts, world.t, world.wind, cam.pos); fx.updateBalls(world.balls, dt * ts, cam.pos); for (const s of world.ships) { fx.burn(s, dt * ts, world.wind); fx.shipFX(s, dt * ts, world.t, world.wind); } fx.updateBirds(dt, cam.pos, env, world.t);
      for (const a of world.ships) if (a.board != null && a.id < a.board && world.ships[a.board]) { if (fx.melee(a, world.ships[a.board], dt * ts)) snd.clang(distCam(a.com)); }
      snd.cam = cam.pos; snd.update(env.amp, env.wind);
    }
    if (G.role === 'host') { snapAcc += dt; if (snapAcc >= 1 / 15) { snapAcc = 0; sendSnapshot(); } }
    readInput(dt); updateCamera(dt); render();
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('msg').style.opacity = 0; }
    if (world.over) {
      const b = $('banner'), w = world.winner, mine = G.my && w === G.my.team;
      if (!(G.my && G.my.sunk && G.respawnT > 6)) { b.innerHTML = w < 0 ? 'Her iki filo da battı' : (w === 0 ? '<span style="color:#ff7a66">Kızıl Filo</span>' : '<span style="color:#7aaaff">Mavi Filo</span>') + ' zafer kazandı' + (G.my ? (mine ? '<br><span style="font-size:18px">🏆 Kazandın!</span>' : '<br><span style="font-size:18px">Kaybettin</span>') : ''); b.classList.add('show'); }
      if (isSim() && world.t - world.overT > 16) nextBattle();
    }
    state.uiT += dt; if (state.uiT > 0.2) { state.uiT = 0; updateFleetUI(); updatePlayerHUD(); drawMinimap();
      $('stat').textContent = `${state.fps.toFixed(0)} fps · ${world.t.toFixed(0)} sn · ${WEATHER[Weather.key].name} · rüzgâr ${env.wind.toFixed(0)} m/s · dalga ≈${(4 * 1.35 * env.amp).toFixed(1)} m`; }
  }

  // ------------------------------------------------------------------ test hooks
  window.__sim = {
    world, fx, R, cam, orbit, cfg, G, Weather, inp, netDeb,
    advance(sec) { const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) { world.update(STEP); if (i % 4 === 0) fx.update(STEP * 4, world.t, world.wind, cam.pos); } updateFleetUI(); },
    render() { env = Weather.env(); R.frame(frameData()); },
    setCam(pos, target) { camMode = 'manual'; cam.pos = pos; cam.target = target; },
    mode(m) { camMode = m; }, pause(p) { paused = p; },
    weather(k, instant = true) { Weather.set(k, instant); env = Weather.env(); Waves.setAmp(env.amp, env.sharp); world.windSpeed = env.wind; },
    snapshot() { return world.ships.map(s => ({ n: s.name, cls: s.cls.key, team: s.team, pos: s.com.map(x => +x.toFixed(1)), speed: +(s.speed || 0).toFixed(2), flood: +(s.flood / 1e3).toFixed(0), holes: s.holes.length, masts: s.masts.filter(m => m.alive).length, sunk: s.sunk, y: +s.com[1].toFixed(2), heel: +(Math.asin(clamp(s.R[3], -1, 1)) * 57.3).toFixed(1), hits: s.stats.hits, shots: s.stats.shots, M: +(s.M / 1e3).toFixed(0), sail: +(s.sailArea / (s.fullArea * s.s * s.s)).toFixed(2) })); },
    startSolo, startSpectate, startHost, startJoin, nextBattle, closeMenu,
    waveTest(t) {
      const pts = []; const r = mulberry32(5); for (let i = 0; i < 64; i++) pts.push((r() - 0.5) * 1500, (r() - 0.5) * 1500);
      const g = R.gpuWaveHeights(pts, t); let maxErr = 0, maxGrad = 0;
      for (let i = 0; i < 64; i++) { const js = [0, 0, 0, 0, 0, 0]; Waves.sample(pts[i * 2], pts[i * 2 + 1], t, js); maxErr = Math.max(maxErr, Math.abs(js[0] - g[i * 4]), Math.abs(g[i * 4 + 3] - g[i * 4])); maxGrad = Math.max(maxGrad, Math.abs(js[1] - g[i * 4 + 1]), Math.abs(js[2] - g[i * 4 + 2])); }
      return { maxHeightErr: maxErr, maxGradErr: maxGrad };
    },
  };
  buildCamBtns();
  const mode = qs.get('mode');
  if (mode === 'spectate') { startSpectate(); } else if (mode === 'solo') { startSolo(); } else { startBattle(cfg.seed, []); G.role = 'spectate'; }
  if (qs.get('t0')) window.__sim.advance(+qs.get('t0'));
  if (qs.get('room') && qs.get('autojoin')) startJoin(qs.get('room'));
  window.__ready = true;
  requestAnimationFrame(tick);
})();
