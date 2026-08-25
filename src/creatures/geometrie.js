/* ═══ CRÉATURES / GÉOMÉTRIE ═══
   Le maillage de la mère et des jeunes, reconstruit à chaque image dans un
   seul tampon dynamique — un seul appel de rendu pour toutes les créatures.

   Le corps est un vrai tube : 64 anneaux de 22 sommets suivant l'échine, à
   section aplatie, avec crête dorsale, tête effilée, mandibules articulées en
   trois segments, antennes, et 21 paires de pattes à trois articulations
   animées en vague. ~14 000 triangles au lieu des 4 000 de la v2.

   ── CE QUI EST NOUVEAU EN v3 ───────────────────────────────────────────────
     · YEUX          deux bulbes émissifs sur la tête, taille et couleur
                     pilotées par lueurs.js. Ils sont AUSSI des lumières :
                     rendu/lumieres.js les récupère via lumieresTemporaires.
     · PATTES        tarses et griffes émissifs, palpitant avec la démarche.
     · INTERSTICES   bandes lumineuses entre les anneaux du corps. Elles
                     pulsent au repos (leurre à proies) et s'éteignent en
                     poursuite — l'extinction EST le signal d'attaque.
     · MAXILLAIRES   deux crochets supplémentaires sous les mandibules.       */

import {SETUP} from '../setup.js';
import {gl} from '../noyau/gl.js';
import {lerp, clamp} from '../noyau/math.js';
import {groundAt, estVide, w2c} from '../monde/grille.js';
import {creature, sampleBody} from './mere.js';
import {jeunes} from './jeunes.js';
import {ST} from './etats.js';
import {eclat, couleurPatte, interstice, couleurInterstice, poserLumieresYeux} from './lueurs.js';

/* Ces trois-là étaient figés à l'import (`const C_SEG = SETUP.creature.segments`),
   ce qui rendait les curseurs d'anatomie de l'éditeur strictement inopérants :
   on bougeait le nombre d'anneaux et rien ne changeait à l'écran. Ils sont
   maintenant relus à chaque image. Le coût est nul — trois lectures de
   propriété — et l'éditeur devient utile.

   C_MAXV, lui, reste figé : il dimensionne les tampons GPU, alloués une fois.
   D'où l'écrêtage dans cQuad() si l'on pousse l'anatomie trop loin. */
const cSeg    = () => SETUP.creature.segments;
const cRing   = () => SETUP.creature.anneaux;
const cPaires = () => SETUP.creature.paires;
const C_MAXV  = SETUP.creature.maxSommets;

const cP  = new Float32Array(C_MAXV*3);
const cNr = new Float32Array(C_MAXV*3);
const cC  = new Float32Array(C_MAXV*3);
let cN_ = 0;

/** Les lumières que les créatures ajoutent cette image. Lue par rendu/lumieres.js. */
export const lumieresTemporaires = [];

// module-local : réassigné, donc jamais exporté (cf. outils/verifier.py)
let crea = null;

export function creerCreature(){
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const mk = loc => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, C_MAXV*3*4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    return b;
  };
  const bp = mk(0), bn = mk(1), bc = mk(2);
  gl.bindVertexArray(null);
  crea = {vao, bp, bn, bc};
  return crea;
}

/* ─────────────── primitives ─────────────── */

function cV(p,n,c){
  const i = cN_;
  cP[i]=p[0]; cP[i+1]=p[1]; cP[i+2]=p[2];
  cNr[i]=n[0]; cNr[i+1]=n[1]; cNr[i+2]=n[2];
  cC[i]=c[0]; cC[i+1]=c[1]; cC[i+2]=c[2];
  cN_ += 3;
}

function cQuad(a,b,c,d,col){
  if(cN_ > C_MAXV*3 - 18) return;
  const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const v = [d[0]-a[0], d[1]-a[1], d[2]-a[2]];
  let n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  const L = Math.hypot(n[0],n[1],n[2]) || 1;
  n = [n[0]/L, n[1]/L, n[2]/L];
  cV(a,n,col); cV(b,n,col); cV(c,n,col);
  cV(a,n,col); cV(c,n,col); cV(d,n,col);
}

/** Prisme effilé entre deux points. La brique des pattes et des mandibules. */
function cTube(p0,r0,p1,r1,col,cotes){
  let ax=p1[0]-p0[0], ay=p1[1]-p0[1], az=p1[2]-p0[2];
  const L = Math.hypot(ax,ay,az) || 1e-4; ax/=L; ay/=L; az/=L;
  let ux=0, uy=1, uz=0;
  if(Math.abs(ay) > 0.94){ ux=1; uy=0; }
  let sx=uy*az-uz*ay, sy=uz*ax-ux*az, sz=ux*ay-uy*ax;
  const SL = Math.hypot(sx,sy,sz) || 1; sx/=SL; sy/=SL; sz/=SL;
  const tx=ay*sz-az*sy, ty=az*sx-ax*sz, tz=ax*sy-ay*sx;
  const P = (p,r,cs,sn) => [p[0]+sx*cs*r+tx*sn*r, p[1]+sy*cs*r+ty*sn*r, p[2]+sz*cs*r+tz*sn*r];
  const NC = cotes || 6, A=[], B=[];
  for(let k=0;k<NC;k++){
    const a = (k+0.5)/NC*6.283185, cs = Math.cos(a), sn = Math.sin(a);
    A.push(P(p0,r0,cs,sn)); B.push(P(p1,r1,cs,sn));
  }
  for(let k=0;k<NC;k++){ const j=(k+1)%NC; cQuad(A[k],A[j],B[j],B[k],col); }
  for(let k=1;k<NC-1;k++) cQuad(B[0],B[k],B[k+1],B[k],col);
}

/** Un bulbe : petite sphère à faible résolution. Sert aux yeux. */
function cBulbe(p, r, col, res){
  const N = res || 6;
  for(let i=0;i<N;i++){
    const t0 = (i/N - 0.5)*Math.PI, t1 = ((i+1)/N - 0.5)*Math.PI;
    for(let j=0;j<N;j++){
      const a0 = j/N*6.283185, a1 = (j+1)/N*6.283185;
      const S = (t,a) => [p[0]+Math.cos(t)*Math.cos(a)*r,
                          p[1]+Math.sin(t)*r,
                          p[2]+Math.cos(t)*Math.sin(a)*r];
      cQuad(S(t0,a0), S(t0,a1), S(t1,a1), S(t1,a0), col);
    }
  }
}

/* ─────────────── la mère ─────────────── */

export function batirCreature(temps){
  // relus à chaque image : l'éditeur peut les changer à chaud
  const C_SEG = cSeg(), C_RING = cRing(), C_PAIRES = cPaires();
  cN_ = 0;
  lumieresTemporaires.length = 0;

  const c = creature;
  const chasse = c.state === ST.CHASE, fige = c.state === ST.LISTEN;
  const cadence = fige ? 0 : (chasse ? 15 : 8.5);
  const phase = temps * cadence;

  // ── échine : positions + repère local à chaque anneau
  const S = [];
  for(let i=0;i<C_SEG;i++){
    const p = i === 0 ? {x:c.x, y:c.y, z:c.z} : sampleBody(i * c.SP * 0.52);
    S.push({p, t: i/(C_SEG-1)});
  }
  for(let i=0;i<C_SEG;i++){
    const a = S[Math.max(0,i-1)].p, b = S[Math.min(C_SEG-1,i+1)].p;
    let dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z;
    const L = Math.hypot(dx,dy,dz) || 1; dx/=L; dy/=L; dz/=L;
    if(i === 0){
      const yy = c.heading + (fige ? c.scan : 0);
      dx = -Math.sin(yy); dy = 0; dz = -Math.cos(yy);
    }
    S[i].f = [dx,dy,dz];
    let rx=dz, rz=-dx;
    const RL = Math.hypot(rx,rz) || 1; rx/=RL; rz/=RL;
    S[i].r = [rx,0,rz];
    S[i].u = [dy*rz, dz*rx-dx*rz, -dy*rx];
    const UL = Math.hypot(S[i].u[0],S[i].u[1],S[i].u[2]) || 1;
    S[i].u = S[i].u.map(v => v/UL);
    // ondulation latérale : le corps serpente, il ne suit pas un rail
    const ond = Math.sin(phase*0.55 - i*0.42) * (chasse ? 0.16 : 0.09);
    S[i].p = {x: S[i].p.x + rx*ond, y: S[i].p.y, z: S[i].p.z + rz*ond};
  }

  const rayon = i => {
    const t = i/(C_SEG-1);
    return 0.46*(0.55 + 0.45*Math.sin(Math.min(1,t*3.4)*1.571))*(1 - t*0.80) + 0.05;
  };
  const anneau = (i, gonfle) => {
    const s = S[i], R = rayon(i)*(gonfle||1), pts = [];
    for(let k=0;k<C_RING;k++){
      const a = k/C_RING*6.283185, cs = Math.cos(a), sn = Math.sin(a);
      // section aplatie + crête dorsale
      const rx = R*1.42, ry = R*(0.74 + 0.30*Math.max(0,sn));
      pts.push([s.p.x + s.r[0]*cs*rx + s.u[0]*sn*ry,
                s.p.y + s.r[1]*cs*rx + s.u[1]*sn*ry,
                s.p.z + s.r[2]*cs*rx + s.u[2]*sn*ry]);
    }
    return pts;
  };

  const chitine=[0.155,0.135,0.120], dos=[0.235,0.205,0.180],
        pale=[0.52,0.47,0.38], creme=[0.66,0.60,0.47];

  /* ── CORPS + INTERSTICES ──
     Un anneau sur deux reçoit une bande émissive sur ses flancs. C'est la
     bioluminescence de leurre : au repos elle ondule et attire, en poursuite
     elle s'éteint. */
  let A = anneau(0);
  for(let i=1;i<C_SEG;i++){
    const B = anneau(i);
    const ti = i/(C_SEG-1);
    const inten = (i % 2 === 0) ? interstice(chasse, temps, ti) : 0;
    const colInter = inten > 0.02 ? couleurInterstice(c.yeux, inten) : null;
    for(let k=0;k<C_RING;k++){
      const j = (k+1)%C_RING;
      const a = k/C_RING*6.283185;
      const haut = Math.sin(a);
      let col;
      // les flancs (|haut| faible) portent l'interstice
      if(colInter && Math.abs(haut) < 0.34) col = colInter;
      else col = haut > 0.35 ? dos : (haut < -0.55 ? [0.10,0.09,0.08] : chitine);
      cQuad(A[k],A[j],B[j],B[k],col);
    }
    A = B;
  }

  // ── tête
  const s0 = S[0];
  {
    let prev = anneau(0, 1.16);
    for(let q=1;q<=3;q++){
      const av = q*0.30, R = 1.16 - q*0.34;
      const pts = [];
      for(let k=0;k<C_RING;k++){
        const a = k/C_RING*6.283185, cs = Math.cos(a), sn = Math.sin(a);
        const rr = rayon(0)*Math.max(0.08,R);
        pts.push([s0.p.x + s0.f[0]*av + s0.r[0]*cs*rr*1.35 + s0.u[0]*sn*rr*0.80,
                  s0.p.y + s0.f[1]*av + s0.r[1]*cs*rr*1.35 + s0.u[1]*sn*rr*0.80,
                  s0.p.z + s0.f[2]*av + s0.r[2]*cs*rr*1.35 + s0.u[2]*sn*rr*0.80]);
      }
      for(let k=0;k<C_RING;k++){ const j=(k+1)%C_RING; cQuad(prev[k],prev[j],pts[j],pts[k],dos); }
      prev = pts;
    }

    /* ── LES YEUX ──
       Deux bulbes émissifs. Taille et couleur viennent de lueurs.js, qui les
       fait glisser selon l'état. En poursuite ils doublent de taille et virent
       à l'orange-blanc : c'est le signal qu'elle t'a. */
    const Y = c.yeux, g = eclat(Y, temps);
    const rTete = rayon(0);
    const rOeil = rTete * 0.30 * Y.taille;
    const colOeil = [Y.c[0]*g*1.35, Y.c[1]*g*1.35, Y.c[2]*g*1.35];
    for(const sd of [1,-1]){
      const p = [s0.p.x + s0.f[0]*0.42 + s0.r[0]*rTete*0.62*Y.taille*sd,
                 s0.p.y + s0.f[1]*0.42 + rTete*0.30,
                 s0.p.z + s0.f[2]*0.42 + s0.r[2]*rTete*0.62*Y.taille*sd];
      cBulbe(p, rOeil, colOeil, 7);
      // un halo plus large et plus sombre : l'orbite
      cBulbe(p, rOeil*1.45, [colOeil[0]*0.18, colOeil[1]*0.14, colOeil[2]*0.12], 5);
    }
    poserLumieresYeux(lumieresTemporaires, Y, s0, rTete, temps);

    // mandibules : trois segments qui se referment
    const ouv = fige ? 0.34 : 0.20 + Math.abs(Math.sin(temps*(chasse?7:2.4)))*0.40;
    for(const sd of [1,-1]){
      const base = [s0.p.x + s0.f[0]*0.52 + s0.r[0]*0.20*sd,
                    s0.p.y + s0.f[1]*0.52 - 0.04,
                    s0.p.z + s0.f[2]*0.52 + s0.r[2]*0.20*sd];
      const m1 = [base[0]+s0.f[0]*0.34+s0.r[0]*ouv*sd, base[1]-0.02, base[2]+s0.f[2]*0.34+s0.r[2]*ouv*sd];
      const m2 = [m1[0]+s0.f[0]*0.34+s0.r[0]*ouv*0.35*sd, m1[1]-0.03, m1[2]+s0.f[2]*0.34+s0.r[2]*ouv*0.35*sd];
      const m3 = [m2[0]+s0.f[0]*0.26-s0.r[0]*ouv*0.85*sd, m2[1]-0.05, m2[2]+s0.f[2]*0.26-s0.r[2]*ouv*0.85*sd];
      cTube(base,0.075,m1,0.060,pale,7);
      cTube(m1,0.060,m2,0.042,pale,7);
      cTube(m2,0.042,m3,0.012,creme,6);
      // maxillaire : un crochet court sous la mandibule. Nouveau en v3 —
      // c'est ce détail qui fait « qui mord » plutôt que « qui pince ».
      const x1 = [base[0]+s0.f[0]*0.22+s0.r[0]*0.10*sd, base[1]-0.11, base[2]+s0.f[2]*0.22+s0.r[2]*0.10*sd];
      cTube(base, 0.045, x1, 0.030, creme, 5);
      cTube(x1, 0.030, [x1[0]+s0.f[0]*0.14, x1[1]-0.06, x1[2]+s0.f[2]*0.14], 0.006, creme, 4);
    }

    // antennes : elles fouettent, surtout à l'arrêt quand elle écoute
    for(const sd of [1,-1]){
      let pt = [s0.p.x+s0.f[0]*0.44+s0.r[0]*0.22*sd, s0.p.y+0.16, s0.p.z+s0.f[2]*0.44+s0.r[2]*0.22*sd];
      const dir = [s0.f[0]*0.9+s0.r[0]*0.5*sd, 0.34, s0.f[2]*0.9+s0.r[2]*0.5*sd];
      for(let q=0;q<7;q++){
        const w = Math.sin(temps*(fige?5.5:3.0) + q*0.9 + sd)*(fige?0.20:0.11);
        const nx = [pt[0]+dir[0]*0.20+s0.r[0]*w, pt[1]+dir[1]*0.20-q*0.038, pt[2]+dir[2]*0.20+s0.r[2]*w];
        cTube(pt, 0.030-q*0.0036, nx, 0.026-q*0.0036, chitine, 5);
        pt = nx; dir[1] -= 0.13;
      }
    }
  }

  /* ── PATTES À CONTACT RÉEL ──
     On interroge le relief SOUS le pied, et le genou se replie pour absorber la
     différence. Une patte en appui reste plantée, une patte en l'air passe
     au-dessus : c'est ce qui donne la démarche.
     v3 : le tarse et la griffe sont ÉMISSIFS et palpitent avec la vague. */
  for(let n=0;n<C_PAIRES;n++){
    const i = 1 + Math.round(n*(C_SEG-7)/C_PAIRES);
    const s = S[i], R = rayon(i);
    const ph = phase*0.55 - n*0.46;
    const ech = 1.05 - Math.max(0, (i/(C_SEG-1) - 0.5))*0.95;
    for(const sd of [1,-1]){
      const dec = sd > 0 ? 0 : 2.0;               // gauche et droite en opposition
      const bal2 = Math.sin(ph+dec), lev2 = Math.max(0, Math.sin(ph+dec+1.5));
      const hanche = [s.p.x + s.r[0]*R*1.15*sd, s.p.y - R*0.15, s.p.z + s.r[2]*R*1.15*sd];
      const px = hanche[0] + s.r[0]*0.86*sd*ech + s.f[0]*bal2*0.52*ech;
      const pz = hanche[2] + s.r[2]*0.86*sd*ech + s.f[2]*bal2*0.52*ech;
      const solLocal = estVide(w2c(px), w2c(pz)) ? s.p.y - 1.4 : groundAt(px, pz);
      const appui = Math.min(solLocal + 0.03, hanche[1] - 0.10);
      const pied = [px, appui + lev2*0.30*ech, pz];
      const repli = clamp(1 - (hanche[1] - pied[1])/(0.95*ech + 0.01), 0, 1);
      const genou = [(hanche[0]+px)/2 + s.r[0]*0.16*sd,
                     hanche[1] + 0.20*ech + repli*0.30*ech + lev2*0.12,
                     (hanche[2]+pz)/2 + s.r[2]*0.16*sd];
      cTube(hanche, 0.105, genou, 0.072, dos, 7);
      cTube(genou, 0.072, pied, 0.030, chitine, 6);
      // tarse puis griffe, ÉMISSIFS : on lit sa démarche dans le noir
      const lum = couleurPatte(c.yeux, ph + dec);
      const gr = [pied[0]+s.f[0]*0.16, pied[1]-0.05-lev2*0.02, pied[2]+s.f[2]*0.16];
      cTube(pied, 0.030, gr, 0.016, lum, 5);
      cTube(gr, 0.016, [gr[0]+s.f[0]*0.09, gr[1]-0.08, gr[2]+s.f[2]*0.09], 0.004, lum, 4);
      // épine dorsale au-dessus de chaque hanche
      if(n % 2 === 0)
        cTube([s.p.x+s.u[0]*R*0.9, s.p.y+s.u[1]*R*0.9, s.p.z+s.u[2]*R*0.9], 0.05,
              [s.p.x+s.u[0]*(R*0.9+0.34)+s.f[0]*0.10, s.p.y+s.u[1]*(R*0.9+0.34),
               s.p.z+s.u[2]*(R*0.9+0.34)+s.f[2]*0.10], 0.004, [0.30,0.26,0.22], 4);
    }
  }
}

/* ─────────────── les jeunes ─────────────── */

/* ═══════════════ LES JEUNES ═══════════════
   Retour de test : « moches, pas flippants, risibles et cons » — et
   « change le design, ils sont juste risibles ».

   C'était mérité. La v3.0 les faisait avec la même recette que la mère : une
   chaîne de tubes coniques bout à bout, avec deux pattes par tube. À cette
   échelle (30 à 50 cm) ça ne lisait pas comme une bête, ça lisait comme un
   chapelet de saucisses. Rien à corriger là-dedans : il fallait un autre corps.

   ── LE NOUVEAU CORPS ───────────────────────────────────────────────────────
   Une larve cuirassée, basse et large — entre le cloporte et le trilobite :

     · 8 PLAQUES dorsales en écaille, chacune bombée et débordant sur la
       suivante. C'est le débord qui fait la carapace : une segmentation qu'on
       voit en silhouette, même de dos, même dans le noir.
     · une TÊTE distincte, plus large que le premier segment, aplatie, avec
       deux mandibules courbes qui s'ouvrent quand il charge.
     · un ABDOMEN translucide à l'arrière qui PULSE — la poche lumineuse. On
       la voit à travers la carapace, et c'est elle qu'on repère de loin.
     · 12 PATTES courtes et anguleuses, en vague, qui touchent vraiment le sol.
     · quatre YEUX en grappe, pas deux : c'est ce qui fait « insecte » plutôt
       que « animal ».

   Il est deux fois plus bas et deux fois plus large qu'avant. Une chose qui
   rampe et qu'on écraserait du pied, sauf qu'elles sont douze.               */

/** Plaque dorsale bombée : un éventail de quads sur un arc. */
function cPlaque(centre, avant, droite, larg, lon, haut, col, cotes){
  const N = cotes || 7;
  const pt = (u, v) => {
    // u : −1 (gauche) → +1 (droite)   v : 0 (avant) → 1 (arrière)
    const bomb = Math.sqrt(Math.max(0, 1 - u*u)) * haut;
    return [
      centre[0] + droite[0]*u*larg + avant[0]*(v-0.5)*lon,
      centre[1] + bomb,
      centre[2] + droite[2]*u*larg + avant[2]*(v-0.5)*lon,
    ];
  };
  for(let k=0;k<N;k++){
    const u0 = -1 + 2*k/N, u1 = -1 + 2*(k+1)/N;
    cQuad(pt(u0,0), pt(u1,0), pt(u1,1), pt(u0,1), col);
    // le rebord qui retombe : c'est lui qui donne l'épaisseur de l'écaille
    const b0 = pt(u0,1), b1 = pt(u1,1);
    cQuad(b0, b1, [b1[0], b1[1]-haut*0.55, b1[2]], [b0[0], b0[1]-haut*0.55, b0[2]],
          [col[0]*0.45, col[1]*0.45, col[2]*0.45]);
  }
}

/* ═══════════════ LE GOBELIN ═══════════════

   « Je pense que les bébés scolopandres sont nuls et cons. Peut-être tu mets
   des gobelins qui s'échappent des églises et envahissent le monde. »

   Le jugement était juste. Les jeunes étaient des LARVES : un corps
   segmenté qui suivait la trace de sa tête, comme la mère en plus court. Ça
   marchait très bien pour la mère — trois mètres d'ondulation, c'est
   terrifiant — et ça ne marchait pas du tout à quarante centimètres, où la
   même reptation devient un jouet à ressort.

   ── CE QUI REND UN GOBELIN INQUIÉTANT PLUTÔT QUE COMIQUE ──────────────────
   Ce n'est pas le nombre de polygones, c'est la POSTURE. Quatre décisions, et
   il faut les quatre :

     1. VOÛTÉ. La tête est PLUS BAS que les épaules, portée en avant au bout
        d'un cou horizontal. Un gobelin debout est un lutin ; un gobelin plié
        en avant est un animal qui va sauter.
     2. DES BRAS TROP LONGS, qui touchent presque le sol. C'est la
        disproportion qui met mal à l'aise — elle dit « ça ne marche pas
        comme nous ».
     3. DES JAMBES DIGITIGRADES, pliées à l'envers à la cheville. Un genou
        humain rend n'importe quoi sympathique.
     4. PAS D'YEUX LUMINEUX. La mère en a ; leur en donner ferait des
        miniatures d'elle. Le gobelin a une BOUCHE — large, pâle, ouverte en
        permanence — et c'est elle qu'on voit en premier.

   Sa peau est blafarde, presque blanche : dans le faisceau d'une lampe, c'est
   ce qui accroche l'œil à vingt mètres alors qu'une carapace sombre disparaît.
   Un ennemi qu'on ne voit pas venir n'est pas effrayant, il est injuste.     */

export function batirJeune(j, joueur, temps){
  if(cN_ > C_MAXV*3 - 9000) return;
  if(Math.hypot(j.x - joueur.x, j.z - joueur.z) > 62) return;

  const e = j.ech * 2.05;               // les larves étaient minuscules
  const chasse = j.etat === ST.CHASE;
  /* La cadence du pas. En charge il ne court pas plus vite qu'il ne se jette :
     le rythme double, et c'est ce qu'on entend avant de le voir. */
  const ph = temps * (chasse ? 11.5 : 5.2) + j.ph;
  const pas = Math.sin(ph), pas2 = Math.sin(ph + Math.PI);

  const peau   = [0.46, 0.44, 0.39];    // blafarde : elle accroche la lampe
  const creux  = [0.26, 0.24, 0.22];
  const gueule = [0.09, 0.055, 0.055];
  const dent   = [0.62, 0.60, 0.53];

  // ── orientation ──
  let av = [-Math.sin(j.h), 0, -Math.cos(j.h)];
  if(j.hist && j.hist.length > 1){
    const a = j.hist[j.hist.length-1], b = j.hist[Math.max(0, j.hist.length-4)];
    const dx = a.x - b.x, dz = a.z - b.z;
    const L = Math.hypot(dx, dz);
    if(L > 0.05) av = [dx/L, 0, dz/L];
  }
  const dr = [av[2], 0, -av[0]];

  const P = (u, y, v) => [j.x + av[0]*u + dr[0]*v, j.y + y, j.z + av[2]*u + dr[2]*v];

  /* ── LA POSTURE ──
     Le bassin est bas, les épaules devant et plus haut, la tête devant et
     PLUS BAS que les épaules. C'est ce décalage qui fait tout : il donne la
     silhouette penchée qu'on lit avant tout détail. */
  const hBassin  = e * 0.92;
  const hEpaule  = e * 1.34;
  const avEpaule = e * 0.30;
  const avTete   = e * 0.78;
  const hTete    = e * 1.16;            // sous les épaules : voûté

  const tangage = (chasse ? 0.16 : 0.06) * Math.sin(ph * 0.5);
  const bassin = P(0, hBassin + tangage*e*0.2, 0);
  const epaule = P(avEpaule, hEpaule + tangage*e*0.3, 0);
  const tete   = P(avTete, hTete + tangage*e*0.4, 0);

  // ── le torse : maigre, la cage saillante ──
  cTube(bassin, e*0.30, epaule, e*0.34, peau, 7);
  for(let k = 0; k < 3; k++){
    const t = 0.28 + k*0.22;
    const c = [bassin[0] + (epaule[0]-bassin[0])*t,
               bassin[1] + (epaule[1]-bassin[1])*t,
               bassin[2] + (epaule[2]-bassin[2])*t];
    // les côtes, en travers
    cTube([c[0]-dr[0]*e*0.30, c[1], c[2]-dr[2]*e*0.30], e*0.055,
          [c[0]+dr[0]*e*0.30, c[1], c[2]+dr[2]*e*0.30], e*0.055, creux, 4);
  }

  /* ── LE COU, HORIZONTAL ──
     Il ne monte pas : il avance. C'est la deuxième moitié du voûtement. */
  cTube(epaule, e*0.20, tete, e*0.17, peau, 6);

  /* ── LA TÊTE, ET SA GUEULE ──
     Pas d'yeux lumineux — la mère en a, et en donner au gobelin ferait des
     miniatures d'elle. Une bouche, large et pâle, ouverte en permanence. */
  cBulbe(tete, e*0.27, peau, 7);
  {
    const bou = [tete[0] + av[0]*e*0.20, tete[1] - e*0.06, tete[2] + av[2]*e*0.20];
    const ouvre = e * (chasse ? 0.20 : 0.11) * (0.7 + 0.3*Math.sin(ph*0.9));
    cPlaque(bou, av, dr, e*0.40, e*0.26, ouvre, gueule, 6);
    // deux rangées de dents, minuscules et nombreuses
    for(let k = -3; k <= 3; k++){
      const px = bou[0] + dr[0]*k*e*0.055 + av[0]*e*0.10;
      const pz = bou[2] + dr[2]*k*e*0.055 + av[2]*e*0.10;
      cTube([px, bou[1] + ouvre*0.5, pz], e*0.016,
            [px, bou[1] + ouvre*0.5 - e*0.06, pz], e*0.004, dent, 3);
    }
    // les oreilles : deux membranes en arrière, qui pivotent
    for(const sd of [1,-1]){
      const bat = Math.sin(ph*0.6 + (sd>0?0:1.7)) * e*0.06;
      cPlaque([tete[0] - av[0]*e*0.10 + dr[0]*sd*e*0.26,
               tete[1] + e*0.14 + bat,
               tete[2] - av[2]*e*0.10 + dr[2]*sd*e*0.26],
              [dr[0]*sd, 0.35, dr[2]*sd], av, e*0.30, e*0.34, e*0.02, peau, 5);
    }
  }

  /* ── LES BRAS, TROP LONGS ──
     Ils descendent presque au sol. La disproportion est le point : elle dit
     « ça ne marche pas comme nous » sans qu'on ait à l'expliquer. */
  for(const [sd, sw] of [[1, pas], [-1, pas2]]){
    const ep = [epaule[0] + dr[0]*sd*e*0.30, epaule[1], epaule[2] + dr[2]*sd*e*0.30];
    const coude = [ep[0] + av[0]*(e*0.16 + sw*e*0.22) + dr[0]*sd*e*0.10,
                   ep[1] - e*0.42,
                   ep[2] + av[2]*(e*0.16 + sw*e*0.22) + dr[2]*sd*e*0.10];
    const main = [coude[0] + av[0]*(e*0.26 + sw*e*0.30),
                  coude[1] - e*0.46,
                  coude[2] + av[2]*(e*0.26 + sw*e*0.30)];
    cTube(ep, e*0.115, coude, e*0.085, peau, 5);
    cTube(coude, e*0.085, main, e*0.065, peau, 5);
    // la main : trois doigts crochus, plus longs que la paume
    for(let d = -1; d <= 1; d++){
      const bout = [main[0] + av[0]*e*0.20 + dr[0]*sd*d*e*0.07,
                    main[1] - e*0.10,
                    main[2] + av[2]*e*0.20 + dr[2]*sd*d*e*0.07];
      cTube(main, e*0.035, bout, e*0.012, peau, 4);
    }
  }

  /* ── LES JAMBES, DIGITIGRADES ──
     Pliées à l'envers à la cheville, comme une patte d'oiseau. Un genou
     humain rendrait la bête sympathique, et c'est exactement ce qu'on ne
     veut pas. */
  for(const [sd, sw] of [[1, pas2], [-1, pas]]){
    const ha = [bassin[0] + dr[0]*sd*e*0.20, bassin[1], bassin[2] + dr[2]*sd*e*0.20];
    const genou = [ha[0] + av[0]*(e*0.20 + sw*e*0.26),
                   ha[1] - e*0.36,
                   ha[2] + av[2]*(e*0.20 + sw*e*0.26)];
    // la cheville part EN ARRIÈRE : c'est ça, le digitigrade
    const cheville = [genou[0] - av[0]*(e*0.12 - sw*e*0.10),
                      genou[1] - e*0.38,
                      genou[2] - av[2]*(e*0.12 - sw*e*0.10)];
    const pied = [cheville[0] + av[0]*e*0.26,
                  j.y + e*0.02,
                  cheville[2] + av[2]*e*0.26];
    cTube(ha, e*0.135, genou, e*0.095, peau, 5);
    cTube(genou, e*0.095, cheville, e*0.075, peau, 5);
    cTube(cheville, e*0.075, pied, e*0.05, peau, 4);
  }
}

export function dessinerCreatures(){
  gl.bindVertexArray(crea.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, crea.bp); gl.bufferSubData(gl.ARRAY_BUFFER, 0, cP, 0, cN_);
  gl.bindBuffer(gl.ARRAY_BUFFER, crea.bn); gl.bufferSubData(gl.ARRAY_BUFFER, 0, cNr, 0, cN_);
  gl.bindBuffer(gl.ARRAY_BUFFER, crea.bc); gl.bufferSubData(gl.ARRAY_BUFFER, 0, cC, 0, cN_);
  gl.drawArrays(gl.TRIANGLES, 0, cN_/3);
}

export const nbSommets = () => cN_/3;
