// Node-side physics test: node tools/phys.mjs [seconds] [seaAmp] [ships]
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
const files=['math','waves','hull','physics','world'];
const src=files.map(f=>readFileSync(`js/${f}.js`,'utf8').replace(/^'use strict';/,'')).join('\n');
const ctx=vm.createContext({console,Math,Float32Array,Float64Array,Uint32Array,Set,performance});
vm.runInContext(src+`
Hull.build();
globalThis.run=function(sec,amp,n,seed){ const w=new World(); w.setup(seed||11,n||3); Waves.setAmp(amp); w.windSpeed=14+amp*7.5;
 const out=[]; const t0=performance.now(); const N=Math.round(sec*120);
 for(let i=0;i<N;i++){ w.update(1/120); if(i%(120*10)===0){ out.push(w.t.toFixed(0)+'s '+JSON.stringify(w.ships.map(s=>({sp:+(s.speed||0).toFixed(1),y:+s.com[1].toFixed(1),heel:+(Math.asin(Math.max(-1,Math.min(1,s.R[3])))*57.3).toFixed(0),pit:+(Math.asin(Math.max(-1,Math.min(1,-s.R[7])))*57.3).toFixed(0),fl:+(s.flood/1e3).toFixed(0),h:s.holes.length,m:s.masts.filter(m=>m.alive).length,sk:s.sunk?1:0,hd:+(Math.atan2(s.R[2],s.R[8])*57.3).toFixed(0)})))); } }
 out.push('cpu ms '+(performance.now()-t0).toFixed(0)+' balls '+w.balls.length+' debris '+w.debris.length+' shots '+w.ships.map(s=>s.stats.shots)+' hits '+w.ships.map(s=>s.stats.hits));
 return out.join('\\n'); }
`,ctx);
console.log(ctx.run(+process.argv[2]||30,+process.argv[3]||1,+process.argv[4]||3));
