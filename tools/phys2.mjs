import { readFileSync } from 'node:fs'; import vm from 'node:vm';
const files=['math','waves','hull','physics','world'];
const src=files.map(f=>readFileSync(`js/${f}.js`,'utf8').replace(/^'use strict';/,'')).join('\n');
const ctx=vm.createContext({console,Math,Float32Array,Float64Array,Uint32Array,Set,performance});
vm.runInContext(src+`
Hull.build();
for(const seed of [11,12,13,14]){ const w=new World(); w.setup(seed,3); Waves.setAmp(1); w.windSpeed=21.5;
 const first=[]; let end=null;
 for(let i=0;i<120*420;i++){ w.update(1/120); if(w.over && !end){end=w.t;} if(end&&w.t-end>1) break; }
 console.log('seed',seed,'over',w.over?w.t.toFixed(0):'no','winner',w.winner,'sunk times',w.ships.map(s=>s.sunk?s.sunkT.toFixed(0):'-').join(','),'flood',w.ships.map(s=>(s.flood/1e3).toFixed(0)).join(','));
}`,ctx);
