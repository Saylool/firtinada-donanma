'use strict';
const SH = {};
const HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\n';

SH.noise = `
float ss(float a,float b,float x){ float t=clamp((x-a)/(b-a),0.,1.); return t*t*(3.-2.*t); }
float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec3 hash31(float n){ vec3 p=fract(vec3(n)*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float vnoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p,int oct){ float a=.5,s=0.; for(int i=0;i<6;i++){ if(i>=oct)break; s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.3); a*=.5;} return s; }
`;

SH.env = `
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uFlash; uniform vec3 uFlashDir; uniform vec2 uCloudOff; uniform float uFogD; uniform vec3 uCam;
uniform vec3 uZen,uHor,uCloudD,uCloudL; uniform vec2 uGlow; uniform float uCoverLo,uLight; uniform vec4 uLights[6]; uniform int uLightN;
vec3 horColor(){ return uHor*(1.+uFlash*2.2); }
vec3 flashLights(vec3 P,vec3 N){ vec3 c=vec3(0.); for(int i=0;i<6;i++){ if(i>=uLightN)break; vec3 d=uLights[i].xyz-P; float r2=dot(d,d); float att=uLights[i].w/(1.+r2*.012); c+=vec3(1.,.6,.3)*att*max(dot(N,d*inversesqrt(r2+.01)),0.); } return c; }
vec3 skyColor(vec3 d,int oct){
  float y=max(d.y,0.);
  vec3 col=mix(horColor(),uZen,pow(y,.42));
  float sd=max(dot(d,uSunDir),0.);
  float glow=pow(sd,6.)*uGlow.x+pow(sd,80.)*uGlow.y+pow(sd,1500.)*uGlow.y*14.;
  vec2 uv=d.xz/(y+.14)*.42+uCloudOff;
  float n=fbm(uv,oct);
  float cover=ss(uCoverLo,uCoverLo+.28,n+.10*(1.-y));
  cover*=ss(.0,.09,y)*.92+.08;
  float n2=fbm(uv+uSunDir.xz*.09,oct);
  float lit=clamp((n-n2)*5.+.45,0.,1.);
  vec3 ccol=mix(uCloudD,uCloudL,lit*(1.-cover*.35));
  ccol+=uSunCol*.35*glow*(.4+lit)*.5;
  col=mix(col,ccol,cover*.94*ss(.0,.06,y+.03));
  col+=uSunCol*glow*(1.-cover*.72)*ss(.0,.15,d.y+.05)*.35;
  float fl=uFlash*(.25+.75*cover)*(.45+.55*pow(max(dot(d,uFlashDir),0.),1.5));
  col+=vec3(.6,.7,1.)*fl*1.6;
  return col;
}
vec3 applyFog(vec3 c,float dist,vec3 V){ float f=1.-exp(-dist*uFogD); return mix(c,horColor()*.95,clamp(f,0.,1.)); }
`;

// ---------------- sky ----------------
SH.skyVS = HEAD + `
out vec2 vP;
void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); vP=p*2.-1.; gl_Position=vec4(vP,1.,1.); }`;
SH.skyFS = HEAD + SH.noise + SH.env + `
uniform vec3 uRight,uUp,uFwd; uniform float uTan,uAsp; in vec2 vP; out vec4 o;
void main(){ vec3 d=normalize(uFwd+vP.x*uTan*uAsp*uRight+vP.y*uTan*uUp); o=vec4(skyColor(d,5),1.); }`;

// ---------------- water ----------------
SH.waterVS = HEAD + Waves.glsl + `
in vec2 aP; uniform mat4 uVP; uniform vec2 uCenter; out vec3 vW;
void main(){ vec2 xz=uCenter+aP.x*vec2(cos(aP.y),sin(aP.y)); float h=waveH(xz); vW=vec3(xz.x,h,xz.y); gl_Position=uVP*vec4(vW,1.); }`;
SH.waterFS = HEAD + SH.noise + Waves.glsl + SH.env + `
uniform sampler2D uScene,uDepthT; uniform vec2 uRes; uniform float uNear,uFar,uAmp,uWindAng,uFoamT;
uniform vec4 uShipA[12]; uniform vec4 uShipB[12]; uniform int uShipN; uniform vec3 uWaterD,uWaterS;
in vec3 vW; out vec4 oCol;
float linZ(float d){ float z=d*2.-1.; return 2.*uNear*uFar/(uFar+uNear-z*(uFar-uNear)); }
vec3 waveHGd(vec2 p,float dist){
  float h=0.; vec2 g=vec2(0.);
  for(int i=0;i<8;i++){ float th=dot(uWA[i].xy,p)-uWA[i].z*uTime+uWA[i].w; float e=exp(uWB[i].y*(sin(th)-1.)); float lam=6.2831853/length(uWA[i].xy); float w=1.-ss(lam*3.,lam*14.,dist);
    h+=w*uWB[i].x*(e-uWB[i].z); g+=w*uWB[i].x*uWB[i].y*e*cos(th)*uWA[i].xy; }
  return vec3(h,g);
}
void main(){
  vec3 W=vW; float dist=length(W-uCam); vec3 V=(uCam-W)/dist;
  vec3 hg=waveHGd(W.xz,dist);
  // small ripples (shading only)
  vec2 gd=vec2(0.); float nd=1.-ss(40.,260.,dist);
  for(int i=0;i<6;i++){ float fi=float(i); float ang=uWindAng+(fract(sin(fi*12.9898)*43758.5)-.5)*2.6; vec2 dir=vec2(cos(ang),sin(ang)); float k=1.5+fi*1.05; float w=sqrt(9.81*k);
    float th=dot(dir,W.xz)*k-w*uTime+fi*2.1; gd+=(.028/(1.+fi*.7))*k*cos(th)*dir*nd*(.5+.5*uAmp); }
  vec3 N=normalize(vec3(-hg.y-gd.x,1.,-hg.z-gd.y));
  N=normalize(mix(N,vec3(0,1,0),ss(500.,4000.,dist)*.75));
  float ndv=max(dot(N,V),0.);
  float F=.02+.98*pow(1.-ndv,5.);
  vec3 R=reflect(-V,N); R.y=max(R.y,.015);
  vec3 refl=skyColor(R,3);
  // body colour
  float hN=clamp(hg.x/(3.2+uAmp*1.6)*.5+.5,0.,1.);
  vec3 body=mix(uWaterD,uWaterS,ss(.45,1.,hN)*.9+.1*hN);
  float sunSide=max(dot(N,uSunDir),0.);
  body+=vec3(.05,.13,.10)*pow(sunSide,2.)*.8*clamp(uLight,.1,1.5)+vec3(.04,.07,.09)*uFlash*3.;
  body+=flashLights(W,N)*.03;
  // see-through: what is beneath (ship hulls, debris)
  vec2 uv=gl_FragCoord.xy/uRes; float zw=linZ(gl_FragCoord.z);
  vec2 uvR=uv+N.xz*.02*clamp(zw*.01,0.,1.);
  float zs=linZ(texture(uDepthT,uvR).r); if(zs<zw) uvR=uv, zs=linZ(texture(uDepthT,uv).r);
  float thick=max(zs-zw,0.);
  vec3 sc=texture(uScene,uvR).rgb;
  vec3 under=sc*exp(-thick*vec3(.30,.10,.08))*.9;
  float tr=exp(-thick*.22)*step(thick,60.);
  vec3 col=mix(body,under+body*.15,tr);
  col=col*(1.-F)+refl*F;
  // foam: crests + slope, ship hull/wake
  vec2 wdir=vec2(cos(uWindAng),sin(uWindAng));
  float nz=fbm(W.xz*vec2(.55,.9)*1.3+wdir*uTime*.4,4)*.6+fbm(W.xz*2.6-uTime*.15,3)*.5;
  float crest=ss(uFoamT,uFoamT+1.6,hg.x*.85+4.6*length(hg.yz)+(nz-.5)*1.2);
  float foam=crest*ss(.34,.66,nz+.15);
  foam+=ss(.55,.8,length(hg.yz)*2.4+nz*.3)*.25*step(.5,uAmp);
  for(int i=0;i<12;i++){ if(i>=uShipN)break;
    vec2 d=W.xz-uShipA[i].xy; vec2 hd=uShipA[i].zw; float al=dot(d,hd), sd=dot(d,vec2(-hd.y,hd.x)); float hl=uShipB[i].x, hw=uShipB[i].y, sp=uShipB[i].z, sk=uShipB[i].w;
    float e=length(vec2(al/(hl+3.),sd/(hw+3.))); float f=ss(1.2,.72,e)*(.45+.6*nz);
    float bw=-al-hl; if(bw>0.){ float len=30.+sp*10.; float wid=hw*.7+bw*.17; f=max(f,ss(len,0.,bw)*ss(wid,wid*.25,abs(sd))*clamp(sp/2.5,.15,1.)*(.4+.7*nz)); }
    float fw=al-hl; if(fw>0.){ f=max(f,ss(14.,0.,fw)*ss(hw+4.,0.,abs(sd))*clamp(sp/3.,0.,1.)*nz); }
    foam=max(foam,f*sk); }
  foam=clamp(foam,0.,1.);
  vec3 foamCol=vec3(.62,.68,.70)*(.55+.45*sunSide)*(.2+.8*clamp(uLight,.12,1.8))*(1.+uFlash*3.)+vec3(.15,.09,.05)*pow(max(dot(N,uSunDir),0.),3.);
  col=mix(col,foamCol,foam*.9);
  col=applyFog(col,dist,V);
  oCol=vec4(col,1.);
}`;

// ---------------- ships / debris ----------------
SH.shipVS = HEAD + `
in vec3 aPos; in vec3 aNrm; in vec2 aUV; in float aMat; in float aEx;
uniform mat4 uVP,uModel; uniform vec3 uScale; uniform float uBillow,uJibSign,uTime;
out vec3 vPos; out vec3 vW; out vec3 vN; out vec2 vUV; flat out float vMat; flat out float vEx;
float bul(float u,float v){ float fl=sin(3.14159*u); float t=1.-v; return uBillow*3.4*fl*sin(1.5708*t)*(.55+.45*sin(3.14159*t)); }
void main(){
  vec3 p=aPos*uScale; vec3 n=aNrm; vec2 uv=aUV; int m=int(aMat+.5);
  vPos=p;
  if(m==2){
    float u=uv.x,v=uv.y; float b=bul(u,v);
    float fl=(1.-uBillow)*.55*sin(uTime*6.+p.y*.7+p.x*.4)*sin(3.14159*u)*(1.-v);
    if(aEx>.5){ // jib: bulge along x, sign follows the leeward side
      float bj=b*.7+fl; p.x+=bj*uJibSign; float e=.02; float dbdu=(bul(u+e,v)-bul(u-e,v))/(2.*e)/14.; n=normalize(vec3(uJibSign,0.,-dbdu*uJibSign)); }
    else { p.z+=b+fl; float e=.02; float dbdu=(bul(u+e,v)-bul(u-e,v))/(2.*e)/24.; float dbdv=(bul(u,v+e)-bul(u,v-e))/(2.*e)/12.; n=normalize(vec3(-dbdu,-dbdv,1.)); }
  } else if(m==5){
    float u=uv.x; float a=sin(uTime*7.-u*8.)*.9*u+sin(uTime*11.-u*5.)*.25*u; p.x+=a*(aEx>.5?1.:1.)*1.0;
  }
  vec4 w=uModel*vec4(p,1.); vW=w.xyz; vN=mat3(uModel)*n; vUV=uv; vMat=aMat; vEx=aEx;
  gl_Position=uVP*w;
}`;
SH.shipFS = HEAD + SH.noise + Waves.glsl + SH.env + `
in vec3 vPos; in vec3 vW; in vec3 vN; in vec2 vUV; flat in float vMat; flat in float vEx; out vec4 oCol;
uniform float uRows; uniform vec2 uPZ; uniform vec3 uHullCol,uStripeCol,uTeamCol; uniform vec4 uHole[24]; uniform int uHoleN; uniform vec4 uSHole[10]; uniform int uSHoleN; uniform float uBillow; uniform int uKind;
float ridge(float x,float w){ return ss(w,0.,abs(x)); }
void main(){
  int m=int(vMat+.5); vec3 P=vPos;
  if(m==6&&vEx>.5){ float e=vEx-1.; float row=floor(e/16.+.001); float pi=e-row*16.; float pz0=uPZ.x+2., pz1=uPZ.y-2.; float zz=-17.+4.*pi; if(row>uRows-.5||zz<pz0-.1||zz>pz1+.1) discard; } vec3 Vv=normalize(uCam-vW); vec3 N=normalize(vN);
  bool back=dot(N,Vv)<0.; if(back) N=-N;
  vec3 alb=vec3(.3); float spec=.1, shin=30.; float ao=1.; float emis=0.;
  float wl=waveH(vW.xz); float rel=vW.y-wl;
  float wet=ss(1.6,-.2,rel);
  if(m==0){
    if(vEx>.5){ // transom
      alb=vec3(.10,.065,.04); float wy=P.y; vec2 g=vec2(P.x*.42,(wy-(uKind==1?6.5:6.5))*.33);
      vec2 cell=floor(g); vec2 f=fract(g);
      bool win=(wy>6.4&&wy<12.6&&abs(P.x)<5.4)&&f.x>.2&&f.x<.8&&f.y>.2&&f.y<.75;
      if(win) { alb=vec3(.9,.72,.28)*.25; emis=(hash21(cell)>.55?.55:.0)*(.6+.4*sin(uTime*3.+cell.x)); alb=mix(alb,vec3(1.,.7,.25),emis); }
      if(wy>12.6&&wy<13.1||wy>9.4&&wy<9.7) alb=uStripeCol*.8;
    } else {
      float row=floor(P.y*2.4); float rt=hash21(vec2(row,3.1));
      float grain=vnoise(vec2(P.z*.55+row*7.,P.y*14.));
      float butt=hash21(vec2(row,floor(P.z/3.7+rt*4.)));
      alb=uHullCol*(.75+.5*rt)*(.72+.5*grain)*(.85+.3*butt);
      float seam=ridge(fract(P.y*2.4)-.0,.05)+ridge(fract(P.y*2.4)-1.,.05); alb*=1.-.55*clamp(seam,0.,1.);
      if(P.y<4.4) alb=vec3(.22,.13,.08)*(.7+.6*grain)*(1.+.25*step(.6,vnoise(P.xz*1.7)));
      float sy=P.y;
      if((sy>7.72&&sy<8.05)||(sy>9.75&&sy<10.05)||(sy>5.0&&sy<5.15)) alb=uStripeCol*(.75+.3*grain);
      if(sy>10.15&&sy<10.7) alb=mix(alb,uTeamCol*.55,.85);
      if(sy>4.4&&sy<5.0) alb=mix(alb,uTeamCol*.25,.4);
      // gun ports (both rows)
      float pz=mod(P.z+19.,4.)-2.;
      bool inZ=P.z>uPZ.x&&P.z<uPZ.y;
      float r1=abs(sy-6.9), r2=abs(sy-8.7);
      if(inZ&&abs(N.x)>.5&&(abs(pz)<.58&&(r1<.5||(uRows>1.5&&r2<.5)))){ alb=vec3(.16,.02,.02); if(abs(pz)>.46||min(r1,r2)>.4) alb=uTeamCol*.5; ao=.35; }
      alb=mix(alb,vec3(.6,.62,.6)*.4,ridge(rel-.02,.28)*wet*(.4+.6*vnoise(vW.xz*3.+uTime))*.6);
    }
    spec=.35; shin=60.;
    // damage holes
    for(int i=0;i<24;i++){ if(i>=uHoleN)break; float d=distance(P,uHole[i].xyz); float r=uHole[i].w; float nz=vnoise(P.xy*8.+P.z*6.)*.7+.3;
      float dd=d/(r*(.65+.7*nz));
      if(dd<1.){ if(dd<.62) discard; alb=vec3(.05,.03,.02); ao=.4; }
      else if(dd<1.7){ float w=(dd-1.)/.7; alb=mix(vec3(.62,.44,.24),alb,ss(.25,1.,w)); if(w<.3) alb=vec3(.03); spec=.05; }
    }
  } else if(m==1){
    float pl=floor(P.x*2.6); float rt=hash21(vec2(pl,1.7)); float gr=vnoise(vec2(P.z*.6+pl*9.,P.x*10.));
    alb=vec3(.40,.30,.19)*(.7+.5*rt)*(.75+.4*gr); alb*=1.-.5*ridge(fract(P.x*2.6),.05);
    alb*=1.-.4*wet; alb*=.85; spec=.12;
  } else if(m==2){
    vec3 wv=P; alb=vec3(.60,.56,.47);
    float wv1=sin(P.x*40.)*sin(P.y*36.); alb*=.9+.06*wv1; alb*=.82+.32*fbm(P.xy*.35,4); alb*=.92+.1*vnoise(P.xy*2.5);
    float hole=1.;
    for(int i=0;i<10;i++){ if(i>=uSHoleN)break; float d=distance(P.xy,uSHole[i].xy); float r=uSHole[i].w*(.7+.5*vnoise(P.xy*6.+float(i)));
      if(d<r) discard; if(d<r*1.5){ alb*=.25; } }
    spec=.02; shin=8.; ao=.72+.28*vUV.y; ao*=.8+.2*sin(3.14159*vUV.x);
    // seams
    alb*=1.-.35*ridge(fract(P.x*.11+.5)-.0,.02);
  } else if(m==3){
    float g=vnoise(vec2(P.y*1.2+P.x*3.,P.z*3.+P.x*2.)); alb=vec3(.16,.10,.06)*(.65+.7*g); spec=.12;
  } else if(m==4){ alb=vec3(.78,.55,.10); spec=.9; shin=90.; }
  else if(m==5){ float u=vUV.x; alb=uTeamCol; if(vEx>.5){ if(vUV.y>.4&&vUV.y<.7||abs(u-.4)<.08) alb=vec3(.86); } else alb=mix(uTeamCol,vec3(.86),step(.55,u)*step(.5,fract(vUV.y*1.5)))*1.0; spec=.02; }
  else { alb=vec3(.045,.045,.05); spec=.6; shin=50.; }
  // lighting
  vec3 L=uSunDir; float ndl=dot(N,L); float dif=max(ndl,0.); if(m==2||m==5){ dif=max(ndl,0.)+.5*max(-ndl,0.); }
  vec3 amb=mix(vec3(.05,.055,.062),vec3(.17,.19,.22),N.y*.5+.5)*1.1*uLight;
  vec3 fl=vec3(.55,.65,1.)*uFlash*(.4+.6*max(dot(N,uFlashDir),0.))*1.6;
  float inner=back&&m==0?.28:1.;
  vec3 col=alb*((uSunCol*dif*(1.-.5*wet)+amb+fl)*ao*inner);
  vec3 H=normalize(L+Vv); col+=uSunCol*spec*pow(max(dot(N,H),0.),shin)*(.4+wet)*step(0.,ndl);
  col+=alb*emis*2.*(.35+2.5*clamp(1.-uLight*2.5,0.,1.));
  col+=alb*flashLights(vW,N)*ao;
  // waterline darkening + fade under the sea (the water pass does the refraction)
  float dist=distance(uCam,vW); col=applyFog(col,dist,Vv);
  oCol=vec4(col,1.);
}`;

SH.lineVS = HEAD + `in vec3 aPos; uniform mat4 uVP,uModel; out vec3 vW; void main(){ vec4 w=uModel*vec4(aPos,1.); vW=w.xyz; gl_Position=uVP*w; }`;
SH.lineFS = HEAD + SH.noise + SH.env + `in vec3 vW; uniform vec4 uCol; out vec4 o; void main(){ vec3 c=uCol.rgb*(.25+.75*(1.+uFlash*4.)); o=vec4(applyFog(c,distance(uCam,vW),vec3(0)),uCol.a); }`;

// ---------------- rain ----------------
SH.rainVS = HEAD + SH.noise + `
uniform mat4 uVP; uniform vec3 uCam; uniform float uTime; uniform vec3 uWindV; out float vA;
void main(){
  float id=float(gl_VertexID>>1); bool tail=(gl_VertexID&1)==1;
  vec3 h=hash31(id); vec3 box=vec3(60.,40.,60.); vec3 vel=vec3(uWindV.x*.55,-15.,uWindV.z*.55);
  vec3 pr=mod(h*box+vel*uTime*vec3(1.,1.,1.)-uCam,box)-box*.5;
  vec3 pos=uCam+pr; vec3 dir=normalize(vel);
  if(tail) pos-=dir*(.9+h.x*.5);
  vA=(tail?.0:1.)*(1.-ss(20.,30.,length(pr.xz)));
  gl_Position=uVP*vec4(pos,1.);
}`;
SH.rainFS = HEAD + `in float vA; uniform float uFlash; out vec4 o; void main(){ o=vec4(vec3(.5,.58,.68)*(.5+uFlash*4.),vA*.22); }`;

// ---------------- particles ----------------
SH.partVS = HEAD + `
in vec4 aP; in vec4 aC; in vec4 aS; uniform mat4 uVP; uniform vec3 uRight,uUp; out vec2 vUV; out vec4 vC; out vec4 vS;
void main(){ vec2 q=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1))*2.-1.; float c=cos(aS.x),s=sin(aS.x); vec2 r=vec2(q.x*c-q.y*s,q.x*s+q.y*c);
  vec3 pos=aP.xyz+(uRight*r.x+uUp*r.y)*aP.w; vUV=q; vC=aC; vS=aS; gl_Position=uVP*vec4(pos,1.); }`;
SH.partFS = HEAD + SH.noise + `
in vec2 vUV; in vec4 vC; in vec4 vS; out vec4 o; uniform int uAdd;
void main(){
  float d=length(vUV); if(d>1.) discard; float k=vS.z; float a;
  if(k<.5){ float n=fbm(vUV*2.2+vS.y*13.,4); a=ss(1.,.15,d+ (n-.5)*.9); a*=1.-.35*n; }
  else if(k<1.5){ a=pow(1.-d,2.2); }
  else if(k<2.5){ float n=vnoise(vUV*3.+vS.y*7.); a=ss(1.,.3,d+(n-.5)*.7); }
  else { a=ss(1.,.6,d); }
  vec3 c=vC.rgb; float al=a*vC.a; o=vec4(c*(uAdd==1?al:1.),al);
}`;

// ---------------- post ----------------
SH.postVS = SH.skyVS;
SH.copyFS = HEAD + `uniform sampler2D uT; in vec2 vP; out vec4 o; void main(){ o=texture(uT,vP*.5+.5); }`;
SH.brightFS = HEAD + `uniform sampler2D uT; uniform vec2 uTexel; in vec2 vP; out vec4 o;
void main(){ vec2 uv=vP*.5+.5; vec3 c=texture(uT,uv+uTexel*vec2(-.5,-.5)).rgb+texture(uT,uv+uTexel*vec2(.5,-.5)).rgb+texture(uT,uv+uTexel*vec2(-.5,.5)).rgb+texture(uT,uv+uTexel*vec2(.5,.5)).rgb; c*=.25;
  float l=max(c.r,max(c.g,c.b)); float k=max(l-.85,0.)/max(l,1e-3); o=vec4(min(c*k,vec3(8.)),1.); }`;
SH.blurFS = HEAD + `uniform sampler2D uT; uniform vec2 uDir; in vec2 vP; out vec4 o;
void main(){ vec2 uv=vP*.5+.5; vec3 c=texture(uT,uv).rgb*.227027; vec2 off[4]=vec2[4](vec2(1.3846),vec2(3.2308),vec2(5.0),vec2(7.0)); float w[4]=float[4](.31622,.07027,.0163,.004);
  for(int i=0;i<4;i++){ vec2 o2=uDir*off[i].x; c+=(texture(uT,uv+o2).rgb+texture(uT,uv-o2).rgb)*w[i]; } o=vec4(c,1.); }`;
SH.compFS = HEAD + `uniform sampler2D uT,uB1,uB2; uniform float uExp,uTime,uFlash,uBloom; uniform vec2 uRes; in vec2 vP; out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
void main(){ vec2 uv=vP*.5+.5; vec3 c=texture(uT,uv).rgb; vec3 b=texture(uB1,uv).rgb*.6+texture(uB2,uv).rgb*.9;
  c+=b*uBloom; c*=uExp;
  float l=dot(c,vec3(.299,.587,.114)); c=mix(vec3(l),c,.92); c*=vec3(.97,1.,1.04);
  c=aces(c); c=pow(c,vec3(1./2.2));
  vec2 q=uv-.5; float v=1.-dot(q,q)*1.15; c*=clamp(v,0.,1.);
  float g=fract(sin(dot(uv*uRes+uTime,vec2(12.9898,78.233)))*43758.5453); c+=(g-.5)*.018;
  o=vec4(c,1.); }`;
SH.fxaaFS = HEAD + `uniform sampler2D uT; uniform vec2 uTexel; in vec2 vP; out vec4 o;
float lum(vec3 c){ return dot(c,vec3(.299,.587,.114)); }
void main(){ vec2 uv=vP*.5+.5;
  vec3 rgbM=texture(uT,uv).rgb; vec3 rgbNW=texture(uT,uv+vec2(-1,1)*uTexel).rgb, rgbNE=texture(uT,uv+vec2(1,1)*uTexel).rgb, rgbSW=texture(uT,uv+vec2(-1,-1)*uTexel).rgb, rgbSE=texture(uT,uv+vec2(1,-1)*uTexel).rgb;
  float lM=lum(rgbM),lNW=lum(rgbNW),lNE=lum(rgbNE),lSW=lum(rgbSW),lSE=lum(rgbSE);
  float lMin=min(lM,min(min(lNW,lNE),min(lSW,lSE))), lMax=max(lM,max(max(lNW,lNE),max(lSW,lSE)));
  vec2 dir; dir.x=-((lNW+lNE)-(lSW+lSE)); dir.y=((lNW+lSW)-(lNE+lSE));
  float dr=max((lNW+lNE+lSW+lSE)*.25*.125,1./128.); float rcp=1./(min(abs(dir.x),abs(dir.y))+dr);
  dir=clamp(dir*rcp,-8.,8.)*uTexel;
  vec3 a=.5*(texture(uT,uv+dir*(1./3.-.5)).rgb+texture(uT,uv+dir*(2./3.-.5)).rgb);
  vec3 b=a*.5+.25*(texture(uT,uv+dir*-.5).rgb+texture(uT,uv+dir*.5).rgb);
  float lb=lum(b); o=vec4((lb<lMin||lb>lMax)?a:b,1.); }`;
