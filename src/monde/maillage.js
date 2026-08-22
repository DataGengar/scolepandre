/* ═══ MONDE / MAILLAGE ═══
   Transforme la grille et le décor en triangles, par pavés chargés à la volée.

   Un monde de 1,6 km à 1,5 m de cellule fait ~14 M de sommets. Tout construire
   au chargement coûterait des centaines de mégaoctets et plusieurs secondes de
   gel. On ne construit donc que les pavés à portée de vue, et on libère les
   autres : la taille du monde ne coûte plus rien en mémoire.

   Le décor est CUIT dans le maillage du pavé : un seul appel de rendu pour le
   sol, les parois et tous les éléments qui s'y trouvent.                    */

import {SETUP} from '../setup.js';
import {hash2} from '../noyau/math.js';
import {gl, mesh, libererMesh} from '../noyau/gl.js';
import {BIOMES} from './biomes.js';
import {
  GW, GH, CELL, CH, CHW, CHH, FLOOR, LEDGE,
  grid, floorH, ceilH, biome, sky, vide,
  idx, isFloor, c2w, w2c,
} from './grille.js';
import {props, lights} from './props.js';

/* ─────────────── index spatial ─────────────── */

export const chOf = (x,z) => (((z/CH)|0) * CHW) + ((x/CH)|0);

let propsParPave = new Map();
/* Réassigner un `export let` marche en modules ES (liaisons vivantes) mais PAS
   une fois concaténé par outils/bundler.py, qui capture la valeur à
   l'initialisation. On garde donc TOUJOURS le même objet et on le vide.
   outils/verifier.py refuse désormais toute réassignation d'export. */
export const lampesParPave = new Map();

export function indexerProps(){
  propsParPave = new Map();
  lampesParPave.clear();
  for(const pr of props){
    const k = chOf(pr.cell % GW, (pr.cell / GW) | 0);
    if(!propsParPave.has(k)) propsParPave.set(k, []);
    propsParPave.get(k).push(pr);
  }
  for(const L of lights){
    const k = chOf(Math.min(GW-1, Math.max(0, w2c(L.x))),
                   Math.min(GH-1, Math.max(0, w2c(L.z))));
    if(!propsParPave.has(k)) propsParPave.set(k, []);
    propsParPave.get(k).push({lampe:L});
    if(!lampesParPave.has(k)) lampesParPave.set(k, []);
    lampesParPave.get(k).push(L);
  }
}

/* ─────────────── streaming ─────────────── */

export const paves = new Map();      // k -> {m, x, z}

export const paveCentre = k => ({
  x: ((k % CHW) + 0.5) * CH * CELL,
  z: (((k / CHW) | 0) + 0.5) * CH * CELL,
});

export function libererPave(k){
  const p = paves.get(k);
  if(!p) return;
  /* Un pavé entièrement rocheux est mémorisé avec m:null pour ne pas être
     rebâti sans cesse. La v2 le déréférençait quand même, ce qui faisait
     mourir la boucle de rendu — c'était CE bug. On garde le garde-fou. */
  if(p.m) libererMesh(p.m);
  paves.delete(k);
}

export function libererTousLesPaves(){
  for(const k of [...paves.keys()]) libererPave(k);
}

/**
 * Construit / libère les pavés autour du joueur.
 * @param px,pz  position monde du joueur
 * @param fogD   densité de fog courante — c'est elle qui borne la portée
 */
export function majPaves(px, pz, fogD){
  const PORTEE = (2.4 / (fogD * 0.01)) + CH * CELL * 1.6, P2 = PORTEE * PORTEE;
  const r = Math.ceil(PORTEE / (CH * CELL));
  let budget = 3;                                  // au plus 3 pavés bâtis par image
  const cx = (w2c(px) / CH) | 0, cz = (w2c(pz) / CH) | 0;

  for(let dz=-r; dz<=r; dz++) for(let dx=-r; dx<=r; dx++){
    const a = cx+dx, b = cz+dz;
    if(a<0 || b<0 || a>=CHW || b>=CHH) continue;
    const k = b*CHW + a;
    if(paves.has(k)) continue;
    const c = paveCentre(k);
    if((c.x-px)**2 + (c.z-pz)**2 > P2) continue;
    if(budget-- <= 0) continue;
    paves.set(k, {m: batirPave(k), x:c.x, z:c.z});
  }
  for(const [k,p] of paves)
    if((p.x-px)**2 + (p.z-pz)**2 > P2*2.4) libererPave(k);
}

/* ─────────────── cuisson d'un pavé ─────────────── */

/* Hauteur d'un coin : moyenne des cellules voisines dont l'altitude est
   proche. Au-delà du seuil LEDGE l'arête reste franche — c'est ainsi qu'on
   obtient à la fois des pentes lisses et de vraies corniches, et c'est ce qui
   fait que les falaises de monde/relief.js se lisent comme des falaises. */
function cornerH(x,z,ox,oz,base,arr){
  let s = base, n = 1;
  for(const [dx,dz] of [[ox,0],[0,oz],[ox,oz]]){
    if(!isFloor(x+dx,z+dz)) continue;
    const v = arr[idx(x+dx,z+dz)];
    if(Math.abs(v-base) > LEDGE) continue;
    s += v; n++;
  }
  return s/n;
}

export function batirPave(k){
  const P=[], N=[], C=[];
  const kx0 = (k % CHW) * CH, kz0 = ((k / CHW) | 0) * CH;

  const quad = (p,n,c) => {
    const push = (v,cc) => { P.push(v[0],v[1],v[2]); N.push(n[0],n[1],n[2]); C.push(cc[0],cc[1],cc[2]); };
    push(p[0],c[0]); push(p[1],c[1]); push(p[2],c[2]);
    push(p[0],c[0]); push(p[2],c[2]); push(p[3],c[3]);
  };
  const h = CELL/2;

  for(let z=kz0; z<Math.min(GH,kz0+CH); z++) for(let x=kx0; x<Math.min(GW,kx0+CH); x++){
    const i = idx(x,z);
    if(grid[i] !== FLOOR) continue;
    if(vide[i]) continue;                       // un gouffre n'a pas de fond
    const B = BIOMES[biome[i]], cx = c2w(x), cz = c2w(z), f = floorH[i], ce = ceilH[i];
    const v = 0.88 + hash2(x,z)*0.24;
    const tint = a => [a[0]*v, a[1]*v, a[2]*v];

    const f00=cornerH(x,z,-1,-1,f,floorH), f10=cornerH(x,z,1,-1,f,floorH),
          f11=cornerH(x,z,1,1,f,floorH),   f01=cornerH(x,z,-1,1,f,floorH);
    const c00=cornerH(x,z,-1,-1,ce,ceilH), c10=cornerH(x,z,1,-1,ce,ceilH),
          c11=cornerH(x,z,1,1,ce,ceilH),   c01=cornerH(x,z,-1,1,ce,ceilH);
    const cf=tint(B.floor), cc=tint(B.ceil), wt=tint(B.wall),
          wb=[wt[0]*0.42, wt[1]*0.42, wt[2]*0.42];

    quad([[cx-h,f00,cz-h],[cx+h,f10,cz-h],[cx+h,f11,cz+h],[cx-h,f01,cz+h]],[0,1,0],[cf,cf,cf,cf]);
    if(!sky[i])
      quad([[cx-h,c01,cz+h],[cx+h,c11,cz+h],[cx+h,c10,cz-h],[cx-h,c00,cz-h]],[0,-1,0],[cc,cc,cc,cc]);

    /* Parois et corniches. Le cas `vide` est nouveau : au bord d'un gouffre on
       descend la paroi de 40 m pour que le trou se lise comme un puits sans
       fond et non comme une flaque noire. */
    const edge = (nx,nz,ax,az,bx,bz,ha,hb,ca,cb) => {
      const pxc = x-nx, pzc = z-nz;
      if(!isFloor(pxc,pzc)){
        quad([[ax,ha,az],[bx,hb,bz],[bx,cb,bz],[ax,ca,az]],[nx,0,nz],[wb,wb,wt,wt]);
      } else if(vide[idx(pxc,pzc)]){
        const fond = Math.min(ha,hb) - 40;
        const noir = [wb[0]*0.25, wb[1]*0.25, wb[2]*0.25];
        quad([[ax,fond,az],[bx,fond,bz],[bx,hb,bz],[ax,ha,az]],[nx,0,nz],[[0,0,0],[0,0,0],noir,noir]);
      } else {
        const nf = floorH[idx(pxc,pzc)], nc = ceilH[idx(pxc,pzc)];
        if(nf < Math.min(ha,hb)-0.05)          // corniche : falaise vers le voisin plus bas
          quad([[ax,nf,az],[bx,nf,bz],[bx,hb,bz],[ax,ha,az]],[nx,0,nz],[wb,wb,wt,wt]);
        if(nc < Math.max(ca,cb)-0.05)          // décrochement de plafond
          quad([[ax,nc,az],[bx,nc,bz],[bx,cb,bz],[ax,ca,az]],[nx,0,nz],[wb,wb,wt,wt]);
      }
    };
    edge(0,1,  cx-h,cz-h,cx+h,cz-h, f00,f10,c00,c10);
    edge(0,-1, cx+h,cz+h,cx-h,cz+h, f11,f01,c11,c01);
    edge(1,0,  cx-h,cz+h,cx-h,cz-h, f01,f00,c01,c00);
    edge(-1,0, cx+h,cz-h,cx+h,cz+h, f10,f11,c10,c11);
  }

  // éléments de décor cuits dans le même maillage
  for(const pr of propsParPave.get(k) || []){
    if(pr.lampe){
      const L = pr.lampe, sL = 0.16;
      quad([[L.x-sL,L.y-sL,L.z],[L.x+sL,L.y-sL,L.z],[L.x+sL,L.y+sL,L.z],[L.x-sL,L.y+sL,L.z]],
           [0,0,1],[L.c,L.c,L.c,L.c]);
      quad([[L.x,L.y-sL,L.z-sL],[L.x,L.y-sL,L.z+sL],[L.x,L.y+sL,L.z+sL],[L.x,L.y+sL,L.z-sL]],
           [1,0,0],[L.c,L.c,L.c,L.c]);
      continue;
    }
    for(const q of pr.parts){
      if(q.emis){    // sommets clairs : le shader les remonte via uEmit global
        q.c = [Math.min(1.6,q.c[0]), Math.min(1.6,q.c[1]), Math.min(1.6,q.c[2])];
      }
      if(q.tube) cuireTube(quad, q);
      else       cuireBoite(quad, q);
    }
  }

  return P.length ? mesh(P,N,C) : null;
}

/** Boîte orientée autour de Z. La primitive historique. */
function cuireBoite(quad, q){
  const co = Math.cos(q.r||0), si = Math.sin(q.r||0);
  const hx = q.sx/2, hy = q.sy/2, hz = q.sz/2;
  const V = (sx,sy,sz) => {
    const X = sx*hx, Y = sy*hy, Z = sz*hz;
    return [q.x + X*co - Y*si, q.y + X*si + Y*co, q.z + Z];
  };
  const F = [
    [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1],[0,0,1]],
    [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1],[0,0,-1]],
    [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1],[co,si,0]],
    [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1],[-co,-si,0]],
    [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1],[-si,co,0]],
    [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[si,-co,0]],
  ];
  for(const f of F) quad([V(...f[0]),V(...f[1]),V(...f[2]),V(...f[3])], f[4], [q.c,q.c,q.c,q.c]);
}

/** Prisme effilé à N côtés entre deux points. C'est la primitive qui fait
    monter le polycount du décor : troncs, os, cristaux, cannelures. */
function cuireTube(quad, q){
  const [p0, r0, p1, r1, cotes] = q.tube;
  let ax = p1[0]-p0[0], ay = p1[1]-p0[1], az = p1[2]-p0[2];
  const L = Math.hypot(ax,ay,az) || 1e-4; ax/=L; ay/=L; az/=L;
  let ux=0, uy=1, uz=0;
  if(Math.abs(ay) > 0.94){ ux=1; uy=0; }
  let sx = uy*az - uz*ay, sy = uz*ax - ux*az, sz = ux*ay - uy*ax;
  const SL = Math.hypot(sx,sy,sz) || 1; sx/=SL; sy/=SL; sz/=SL;
  const tx = ay*sz - az*sy, ty = az*sx - ax*sz, tz = ax*sy - ay*sx;
  const P = (p,r,cs,sn) => [p[0]+sx*cs*r+tx*sn*r, p[1]+sy*cs*r+ty*sn*r, p[2]+sz*cs*r+tz*sn*r];
  const NC = cotes || 6, A=[], B=[];
  for(let k=0;k<NC;k++){
    const a = (k+0.5)/NC*6.283185, cs = Math.cos(a), sn = Math.sin(a);
    A.push(P(p0,r0,cs,sn)); B.push(P(p1,r1,cs,sn));
  }
  for(let k=0;k<NC;k++){ const j=(k+1)%NC; quad([A[k],A[j],B[j],B[k]],[0,1,0],[q.c,q.c,q.c,q.c]); }
  // bouchon supérieur, en éventail
  for(let k=1;k<NC-1;k++) quad([B[0],B[k],B[k+1],B[0]],[0,1,0],[q.c,q.c,q.c,q.c]);
}
