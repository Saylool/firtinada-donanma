import { readFileSync } from 'node:fs'; import vm from 'node:vm';
const files=['math','waves','hull','physics','world'];
const src=files.map(f=>readFileSync(`js/${f}.js`,'utf8').replace(/^'use strict';/,'')).join('\n');
const ctx=vm.createContext({console,Math,Float32Array,Float64Array,Uint32Array,Set,performance});
vm.runInContext(src+`
Hull.build();
for(const k of Object.keys(SHIP_CLASSES)){ const w=new World(); w.setup(3,1,1.5,[{team:0,cls:k,name:'x'}]); Waves.setAmp(1); w.windSpeed=18;
 const s=w.ships[0]; s.vel=[0,0,0]; let mx=0,sum=0,n=0,hd0=null,sp=0;
 for(let i=0;i<120*80;i++){ w.update(1/120); if(i>120*30){ const roll=Math.abs(Math.asin(Math.max(-1,Math.min(1,s.R[3])))); mx=Math.max(mx,roll); const kk=s.toWorld([0,0,0]); sum+=Waves.height(kk[0],kk[2],w.t)-kk[1]; n++; sp=Math.max(sp,s.speed);} }
 console.log(k,'M t',(s.M/1e3).toFixed(0),'guns',s.guns.length,'draft',(sum/n).toFixed(2),'(target',(5.2*s.s).toFixed(2)+')','max heel deg',(mx*57.3).toFixed(0),'maxspeed',sp.toFixed(1),'sail',s.sailArea.toFixed(0));
}`,ctx);
