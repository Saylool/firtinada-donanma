// Headless Chrome test driver (CDP over pipe, no network port needed).
// usage: node tools/shot.mjs steps.json
// steps.json: { url, width, height, steps:[ {eval:"js"} | {wait:ms} | {shot:"file.png"} | {log:"js expr to print"} ] }
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const W = cfg.width || 1280, H = cfg.height || 720;
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const udir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'chr-'));
const flags = cfg.flags || ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const p = spawn(chrome, ['--headless=new', '--remote-debugging-pipe', '--no-sandbox', '--disable-gpu-sandbox',
  '--user-data-dir=' + udir, `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...flags, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
p.stderr.on('data', d => { const s = d.toString(); if (/ERROR|FATAL/.test(s) && !/dbus|Fontconfig|cv_display_link|GPU stall|gcm|registration/.test(s)) console.log('[chrome]', s.trim().slice(0, 300)); });
const wr = p.stdio[3], rd = p.stdio[4];
let id = 0; const pending = new Map(); const listeners = [];
let buf = '';
rd.on('data', d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else listeners.forEach(f => f(m));
  }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej });
  wr.write(JSON.stringify({ id: i, method, params, sessionId }) + '\0');
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vars = {}; const errors = []; const sessMap = new Map();
listeners.push(m => {
  if (m.method === 'Runtime.consoleAPICalled') {
    const t = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    console.log(`[console.${m.params.type}${sessMap.get(m.sessionId) ? '#' + sessMap.get(m.sessionId) : ''}]`, t);
    if (m.params.type === 'error' || m.params.type === 'assert') errors.push(t);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails; const t = (d.exception?.description || d.text) + ` @${d.lineNumber}:${d.columnNumber} ${d.url || ''}`;
    console.log('[EXCEPTION]', t); errors.push(t);
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    console.log('[log.error]', m.params.entry.text, m.params.entry.url || ''); errors.push(m.params.entry.text);
  }
});
try {
  await sleep(500);
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const urls = cfg.urls || [cfg.url]; const sessions = [];
  for (let i = 0; i < urls.length; i++) {
    let tid = t.targetId; if (i > 0) tid = (await send('Target.createTarget', { url: 'about:blank', newWindow: true })).targetId;
    const { sessionId } = await send('Target.attachToTarget', { targetId: tid, flatten: true }); sessions.push(sessionId); sessMap.set(sessionId, i);
    const S0 = (m, pr) => send(m, pr, sessionId);
    await S0('Page.enable'); await S0('Runtime.enable'); await S0('Log.enable');
    await S0('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    const u = urls[i]; const url = u.startsWith('http') || u.startsWith('file:') ? u : 'file://' + resolve(u);
    await S0('Page.navigate', { url });
  }
  await sleep(cfg.loadWait ?? 1500);
  let S = (m, pr) => send(m, pr, sessions[0]);
  mkdirSync('shots', { recursive: true });
  for (const st of cfg.steps || []) {
    S = (m, pr) => send(m, pr, sessions[st.tab || 0]);
    if (st.wait) await sleep(st.wait);
    if (st.eval || st.log) {
      const expr = (st.eval || st.log).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k]);
      const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: st.timeout || 600000 });
      if (r.exceptionDetails) { const d = r.exceptionDetails; console.log('[EVAL-EXC]', d.exception?.description || d.text); errors.push('eval'); }
      else if (st.store) vars[st.store] = r.result.value;
      if (!r.exceptionDetails && st.log) console.log('[log]', typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value));
    }
    if (st.shot) {
      const r = await S('Page.captureScreenshot', { format: 'png' });
      writeFileSync(st.shot, Buffer.from(r.data, 'base64')); console.log('saved', st.shot);
    }
  }
} catch (e) { console.log('HARNESS ERROR', e.message); errors.push(e.message); }
p.kill('SIGKILL');
console.log(errors.length ? `ERRORS: ${errors.length}` : 'NO ERRORS');
process.exit(errors.length ? 1 : 0);
