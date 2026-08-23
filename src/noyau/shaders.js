/* ═══ NOYAU / SHADERS ═══
   Les quatre sources GLSL du jeu, isolées ici pour qu'on puisse les lire sans
   dérouler le pipeline.

     VS  / FS   passe monde : décor, décor cuit, créature, lune
     VSP / FSP  passe écran : godrays, tramage, grain, vignette, neige, froid

   ── CE QUI A CHANGÉ EN v3.1, ET POURQUOI ───────────────────────────────────
   Retour de test : « on ne voit absolument rien, genre rien ». Mesuré, c'était
   vrai — trois causes dans ce fichier :

   1. LA « TORCHE » N'EN ÉTAIT PAS UNE. Un cône mou en pow(cos,3) et une
      atténuation exp(-d×0.085), soit 18 % à 20 m. Remplacée par une vraie
      LAMPE DE POCHE : cœur net, bord franc via smoothstep, nappe faible
      autour, portée de plusieurs dizaines de mètres. Tous les paramètres
      viennent de SETUP.lampe.

   2. LES LUMIÈRES DU DÉCOR MOURAIENT À 5 M. L'atténuation
      1/(1+0.22d+0.16d²) ne laissait que 16 % à 5 m : cristaux, fenêtres et
      braseros n'éclairaient plus rien. Les coefficients sont désormais des
      uniformes (SETUP.lumiereDecor).

   3. LA VIGNETTE MANGEAIT 92 % DES BORDS. Réglable, 55 % par défaut.

   Plus deux ajouts : uEmit est maintenant TEINTÉ (les cartes retrouvent leur
   halo coloré) et le monde extérieur a une LUNE BRISÉE, dessinée comme un
   fond de ciel avec uCiel.                                                  */

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
uniform float uConeIn,uConeOut,uFaisceau,uHalo,uPortee;
uniform float uAttLin,uAttQuad,uGainPt;
uniform float uCiel;                       // 1 = fond de ciel : ni fog ni lumière
uniform vec3 uLP[${NLIGHT}],uLC[${NLIGHT}];
uniform int uLN;
out vec4 frag;

void main(){
  /* FOND DE CIEL — la lune. Aucun éclairage, aucune brume : elle est à
     260 m et n'importe quelle brume l'effacerait. On sort tout de suite. */
  if(uCiel > 0.5){
    frag = vec4(vC * uTint * uEmit, 1.0);
    return;
  }

  vec3 toCam = uCam - vW;
  float d = length(toCam);
  vec3 L = toCam / max(d, 1e-4), N = normalize(vN);

  /* ── LAMPE DE POCHE ──
     ang est le cosinus de l'angle entre l'axe du regard et la direction du
     point éclairé. smoothstep entre le bord et le cœur donne un vrai disque
     de lumière avec une frange, là où pow(cos,3) donnait une bouillie. */
  float ang = max(dot(-L, uFwd), 0.0);
  float faisceau = smoothstep(uConeOut, uConeIn, ang);
  float portee = exp(-d * uPortee);
  float lamp = max(dot(N, L), 0.0) * portee * (uHalo + uFaisceau * faisceau) * uLampGain;

  /* Sources fixes du décor : les seuls repères dans la brume quand la lampe
     est éteinte. Les yeux de la créature entrent par ce même tableau — c'est
     ce qui les rend visibles de très loin sans code de rendu dédié. */
  vec3 pt = vec3(0.0);
  for(int i=0;i<${NLIGHT};i++){
    if(i >= uLN) break;
    vec3 dl = uLP[i] - vW;
    float dd = length(dl);
    pt += uLC[i] * max(dot(N, dl/max(dd,1e-4)), 0.0)
          / (1.0 + uAttLin*dd + uAttQuad*dd*dd);
  }
  pt *= uGainPt;

  // uEmit est TEINTÉ : sans ça le halo d'une carte rare sortait blanc.
  vec3 col = vC*uTint*(uAmb + lamp) + vC*uTint*pt + vC*uTint*uEmit;

  float f = exp(-pow(max(d-0.6,0.0)*uFogD*0.01, 2.0));
  frag = vec4(mix(uFog, col, clamp(f,0.0,1.0)), 1.0);
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
uniform float uTime,uGrain,uDread,uSnow,uRays,uWind,uVision,uFroid,uCoeur,uVign;
uniform float uDesat;                      // 0 = criard, 1 = noir et blanc
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
     comme sources : deux traits rouges dans la brume, avant sa silhouette. */
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

  /* DÉSATURATION — la dernière étape avant la vignette.

     Elle passe APRÈS le brouillard et AVANT les effets d'état (froid, dread),
     pour deux raisons : le brouillard doit garder sa propre couleur, qui est
     ce qui distingue un smog d'une ténèbre ; et le virage rouge de la peur ou
     le bleu de l'hypothermie doivent rester lisibles, sinon on perd le seul
     signal qui dit qu'on est en train de mourir. */
  if(uDesat>0.001){
    float lum=dot(c,vec3(0.299,0.587,0.114));
    c=mix(c,vec3(lum),uDesat);
  }

  /* VIGNETTE — elle porte aussi le rétrécissement du champ dû au froid.
     uVign valait 0.92 en dur : les bords de l'écran étaient noirs et on
     jouait dans un trou de serrure. */
  float r=length(vUv-0.5)*1.42/max(uVision,0.30);
  c*=1.0-uVign*pow(clamp(r,0.0,1.0),2.3);

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

  /* NEIGE — uniquement à ciel ouvert. En v3.0 elle suivait le biome, et la
     glacière étant SOUTERRAINE, il neigeait dans les grottes. Le pilote est
     maintenant l'ouverture réelle du ciel au-dessus du joueur. */
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
  'uTint','uEmit','uLampGain','uAmb','uLP','uLC','uLN',
  'uConeIn','uConeOut','uFaisceau','uHalo','uPortee',
  'uAttLin','uAttQuad','uGainPt','uCiel'];

export const UNIS_POST = ['uTex','uRes','uTime','uGrain','uDread','uSnow','uRays',
  'uWind','uVision','uFroid','uCoeur','uVign','uDesat','uSun','uSunC','uSunN'];
