import { readFileSync } from 'node:fs'; import vm from 'node:vm';
const files=['math','waves','hull','physics','world'];
const src=files.map(f=>readFileSync(`js/${f}.js`,'utf8').replace(/^'use strict';/,'')).join('\n');
const ctx=vm.createContext({console,Math,Float32Array,Float64Array,Uint32Array,Set,performance});
vm.runInContext(src+`
Hull.build();
const w=new World(); w.setup(3,1,1.5,[{team:0,cls:'line',name:'A'},{team:1,cls:'frigate',name:'B'}]); Waves.setAmp(0.6); w.windSpeed=12;
const [a,b]=w.ships; a.com[0]=0;a.com[2]=0;b.com[0]=30;b.com[2]=5; a.vel=[0,0,0]; b.vel=[0,0,0];
for(let i=0;i<120*3;i++) w.update(1/120);
console.log('start',w.startBoard(a),'dist',Math.hypot(a.com[0]-b.com[0],a.com[2]-b.com[2]).toFixed(1));
for(let i=0;i<120*60;i++){ w.update(1/120); if(i%(120*5)==0) console.log((i/120).toFixed(0),'crew',a.crew.toFixed(2),b.crew.toFixed(2),'dist',Math.hypot(a.com[0]-b.com[0],a.com[2]-b.com[2]).toFixed(1),'board',a.board,b.board,'teams',a.team,b.team,'sunk',a.sunk,b.sunk); }
`,ctx);
