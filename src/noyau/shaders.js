/* ═══ NOYAU / SHADERS ═══
   Les quatre sources GLSL du jeu, isolées ici pour qu'on puisse les lire sans
   dérouler le pipeline.

     VS  / FS   passe monde : décor, décor cuit, créature
     VSP / FSP  passe écran : godrays, tramage, grain, vignette, neige, froid

   Deux évolutions par rapport à la v2 :
     · NLIGHT passe de 6 à 10. Les yeux de la créature occupent deux emplacements
       et il ne fallait pas qu'ils évincent les repères du décor.
     · FSP reçoit uVision et uFroid : le rétrécissement du champ et la
       désaturation sont les effets visibles des paliers de froid. Sans eux la
       règle du froid resterait un nombre dans un coin du HUD.                */

export const NLIGHT = 10;

export const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol;
uniform mat4 uProj,uView,uModel;
out vec3 vN,vC,vW;
void main(){
  vec4 w=uModel*vec4(aPos,1.0);
  vW=w.xyz; vN=mat3(uModel)*aNrm; vC=aCol;
  gl_Position=uProj*uView*w;
}`;

export const FS = `#version 300 es
precision highp float;
in vec3 vN,vC,vW;
uniform vec3 uCam,uFwd,uFog,uTint;
uniform float uFogD,uEmit,uLampGain,uAmb;
uniform vec3 uLP[${NLIGHT}],uLC[${NLIGHT}];
uniform int uLN;
out vec4 frag;
void main(){
  vec3 toCam=uCam-vW; float d=length(toCam);
  vec3 L=toCam/max(d,1e-4), N=normalize(vN);

  // lampe frontale : un cône serré posé sur une faible diffusion
  float cone=pow(max(dot(-L,uFwd),0.0),3.0);
  float lamp=max(dot(N,L),0.0)*exp(-d*0.085)*(0.28+1.30*cone)*uLampGain;

  // sources fixes du décor : les seuls repères dans le fog.
  // Les yeux de la créature entrent par ce même tableau — c'est ce qui les
  // rend visibles de très loin sans code de rendu dédié.
  vec3 pt=vec3(0.0);
  for(int i=0;i<${NLIGHT};i++){
    if(i>=uLN) break;
    vec3 dl=uLP[i]-vW; float dd=length(dl);
    pt += uLC[i]*max(dot(N,dl/max(dd,1e-4)),0.0)/(1.0+0.22*dd+0.16*dd*dd);
  }

  vec3 col=vC*uTint*(uAmb+lamp)+vC*uTint*pt+vC*uEmit;
  float f=exp(-pow(max(d-0.6,0.0)*uFogD*0.01,2.0));
  frag=vec4(mix(uFog,col,clamp(f,0.0,1.0)),1.0);
}`;

export const VSP = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);
  vUv=p; gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`;

export const FSP = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime,uGrain,uDread,uSnow,uRays,uWind,uVision,uFroid,uCoeur;
uniform vec2 uSun[3];
uniform vec3 uSunC[3];
uniform int uSunN;
const float BAY[16]=float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
float rnd(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}

void main(){
  vec2 px=vUv*uRes; vec3 c=texture(uTex,vUv).rgb;

  /* GODRAYS — diffusion volumétrique en espace écran. On marche depuis le
     pixel vers la source lumineuse en accumulant ce qui brille sur le trajet :
     là où le décor coupe le rayon, l'accumulation s'arrête, et les colonnes de
     lumière se découpent dans le fog. Les yeux de la créature sont éligibles
     comme sources : deux traits rouges dans la brume, bien avant sa silhouette. */
  if(uRays>0.01){
    for(int L=0;L<3;L++){
      if(L>=uSunN) break;
      vec2 dir=(uSun[L]-vUv);
      float dl=length(dir);
      if(dl>0.95) continue;
      dir/=26.0;
      vec2 uv2=vUv; float poids=1.0, acc=0.0;
      for(int i=0;i<26;i++){
        uv2+=dir;
        vec3 t=texture(uTex,clamp(uv2,0.0,1.0)).rgb;
        acc+=max(0.0,dot(t,vec3(0.32,0.36,0.28))-0.055)*poids;
        poids*=0.955;
      }
      c+=uSunC[L]*acc*uRays*(1.0-dl*0.85)*0.055;
    }
  }

  // tramage ordonné : la palette reste basse sans banding franc
  int bi=int(mod(px.y,4.0))*4+int(mod(px.x,4.0));
  float b=(BAY[bi]+0.5)/16.0-0.5; float lv=22.0;
  c=floor(c*lv+b*1.1)/lv;

  float n=rnd(px+vec2(fract(uTime*37.0)*91.0,fract(uTime*23.0)*57.0))-0.5;
  c+=n*uGrain*(0.55+0.9*(1.0-length(c)));

  /* VIGNETTE — c'est elle qui porte le rétrécissement du champ dû au froid.
     uVision vaut 1 quand on va bien, 0.68 en hypothermie : le cercle se
     referme, on voit littéralement moins. */
  float r=length(vUv-0.5)*1.42/max(uVision,0.30);
  c*=1.0-0.92*pow(clamp(r,0.0,1.0),2.3);

  // battement de cœur en hypothermie : la vignette pulse
  if(uCoeur>0.001){
    float bpm=sin(uTime*7.4)*0.5+0.5;
    c*=1.0-uCoeur*0.30*pow(clamp(r,0.0,1.0),1.6)*bpm;
  }

  // dread : elle est proche. Virage rouge + bruit.
  c=mix(c,c*vec3(1.35,0.70,0.64)+rnd(px+uTime)*0.055*uDread,uDread);

  /* FROID — désaturation vers un bleu de gel. Le dernier palier vide l'image
     de sa couleur : on comprend qu'on meurt sans lire un chiffre. */
  if(uFroid>0.001){
    float g=dot(c,vec3(0.30,0.59,0.11));
    c=mix(c,vec3(g*0.78,g*0.90,g*1.16),uFroid);
  }

  // neige : trois nappes de profondeurs différentes, tombant à des vitesses
  // différentes. Presque gratuit à 360 px de haut, et ça fait le dehors.
  if(uSnow>0.01){
    float n2=0.0;
    for(int L=0;L<3;L++){
      float fl=float(L)+1.0;
      vec2 q=px/(2.2*fl);
      q.y+=uTime*(11.0*fl); q.x+=uTime*uWind*(9.0*fl)+sin(uTime*0.5+fl*2.0)*3.0;
      vec2 ip=floor(q), fp=fract(q);
      if(rnd(ip+fl*37.0)>0.955) n2+=smoothstep(0.46,0.0,length(fp-0.5))/fl;
    }
    c+=vec3(0.50,0.54,0.60)*n2*uSnow;
  }

  frag=vec4(max(c,0.0),1.0);
}`;

/** Noms des uniformes, pour unis(). Tenus à côté des sources exprès : ajouter
    un uniforme sans l'ajouter ici est l'erreur classique. */
export const UNIS_MONDE = ['uProj','uView','uModel','uCam','uFwd','uFog','uFogD',
  'uTint','uEmit','uLampGain','uAmb','uLP','uLC','uLN'];

export const UNIS_POST = ['uTex','uRes','uTime','uGrain','uDread','uSnow','uRays',
  'uWind','uVision','uFroid','uCoeur','uSun','uSunC','uSunN'];
