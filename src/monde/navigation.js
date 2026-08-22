/* ═══ MONDE / NAVIGATION ═══
   A* sur la grille, tas binaire, lissage de trajet, ligne de vue.

   Repris intégralement de la v2 : cette partie était juste, il n'y avait rien
   à corriger. Deux ajustements liés à la v3 :

     · le budget vient de SETUP (la grille est 4× plus dense, les trajets font
       deux fois plus de cellules pour la même distance en mètres) ;
     · une cellule `vide` n'est jamais franchissable — les gouffres coupent
       vraiment le passage, et c'est aux ponts de les rétablir.             */

import {SETUP} from '../setup.js';
import {
  GW, GH, CELL, floorH, navCost, vide,
  idx, isFree, c2w, w2c, groundAt,
} from './grille.js';

export const CLIMB   = SETUP.creature.escalade;   // ce qu'elle franchit
export const DROPMAX = SETUP.creature.chuteMax;

const gS     = new Float32Array(GW*GH);
const came   = new Int32Array(GW*GH);
const stamp  = new Int32Array(GW*GH);
const closed = new Uint8Array(GW*GH);
let epoch = 0;

/** Diagnostic affiché dans le sismographe. */
export const diag = {expanded:0, partiel:false};

class Heap {
  constructor(){ this.k=[]; this.v=[]; }
  get size(){ return this.k.length; }
  clear(){ this.k.length=0; this.v.length=0; }
  push(key,val){
    const k=this.k, v=this.v; k.push(key); v.push(val);
    let i = k.length-1;
    while(i>0){
      const p=(i-1)>>1;
      if(k[p]<=k[i]) break;
      [k[p],k[i]]=[k[i],k[p]]; [v[p],v[i]]=[v[i],v[p]]; i=p;
    }
  }
  pop(){
    const k=this.k, v=this.v, top=v[0], lk=k.pop(), lv=v.pop();
    if(k.length){
      k[0]=lk; v[0]=lv;
      let i=0;
      for(;;){
        const l=i*2+1, r=l+1; let m=i;
        if(l<k.length && k[l]<k[m]) m=l;
        if(r<k.length && k[r]<k[m]) m=r;
        if(m===i) break;
        [k[m],k[i]]=[k[i],k[m]]; [v[m],v[i]]=[v[i],v[m]]; i=m;
      }
    }
    return top;
  }
}
const heap = new Heap();

const DIRS = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],
              [1,1,1.4142],[1,-1,1.4142],[-1,1,1.4142],[-1,-1,1.4142]];

/** Praticable pour un agent : du sol, pas d'élément massif, pas de vide. */
const passable = (x,z) => isFree(x,z) && !vide[idx(x,z)];

export function nearestFree(x,z){
  if(passable(x,z)) return idx(x,z);
  for(let r=1;r<14;r++)
    for(let dz=-r;dz<=r;dz++) for(let dx=-r;dx<=r;dx++)
      if(Math.abs(dx)===r || Math.abs(dz)===r)
        if(passable(x+dx, z+dz)) return idx(x+dx, z+dz);
  return -1;
}

const stepOK = (from,to) => {
  const d = floorH[to] - floorH[from];
  return d <= CLIMB && -d <= DROPMAX;
};

/**
 * A* écrêté. Renvoie un tableau d'indices de cellules, ou null.
 * Si le budget est épuisé, renvoie le meilleur chemin partiel : une créature
 * qui avance dans la bonne direction vaut mieux qu'une créature figée.
 */
export function aStar(sx, sz, tx, tz, budget = SETUP.creature.budgetAStar){
  const s = nearestFree(sx,sz), t = nearestFree(tx,tz);
  if(s<0 || t<0) return null;
  if(s===t) return [s];

  const tX = t % GW, tZ = (t / GW) | 0;
  const hOf = n => {
    const dx = Math.abs(n%GW - tX), dz = Math.abs(((n/GW)|0) - tZ);
    return (Math.max(dx,dz) + 0.4142*Math.min(dx,dz)) * 0.7;
  };
  const trace = n => { const o=[]; while(n!==-1){ o.push(n); n=came[n]; } return o.reverse(); };

  epoch++; heap.clear(); diag.expanded = 0; diag.partiel = false;
  gS[s]=0; came[s]=-1; stamp[s]=epoch; closed[s]=0;
  let best = s, bestH = hOf(s);
  heap.push(0, s);

  while(heap.size){
    const cur = heap.pop();
    if(closed[cur]===1 && stamp[cur]===epoch) continue;
    closed[cur]=1;
    if(cur===t) return trace(t);
    const hc = hOf(cur); if(hc<bestH){ bestH=hc; best=cur; }
    if(++diag.expanded > budget){ diag.partiel = true; return trace(best); }

    const cx = cur % GW, cz = (cur / GW) | 0;
    for(const [dx,dz,mul] of DIRS){
      const nx = cx+dx, nz = cz+dz;
      if(!passable(nx,nz)) continue;
      if(dx && dz && (!passable(cx+dx,cz) || !passable(cx,cz+dz))) continue;
      const n = idx(nx,nz);
      if(!stepOK(cur,n)) continue;                    // le relief filtre ici
      if(stamp[n]===epoch && closed[n]===1) continue;
      const climb = Math.max(0, floorH[n]-floorH[cur]) * 0.55;
      const g = gS[cur] + (navCost[n] + climb) * mul;
      if(stamp[n]===epoch && g>=gS[n]) continue;
      stamp[n]=epoch; closed[n]=0; gS[n]=g; came[n]=cur;
      heap.push(g + hOf(n), n);
    }
  }
  diag.partiel = true;
  return best===s ? null : trace(best);
}

/** Ligne de vue au sol, avec un corps de rayon r. Refuse le vide. */
export function clearLine(x0,z0,x1,z1,r=0.85){
  const dx = x1-x0, dz = z1-z0, L = Math.hypot(dx,dz);
  if(L < 1e-4) return true;
  const ux=dx/L, uz=dz/L, px=-uz*r, pz=ux*r;
  const steps = Math.ceil(L / (CELL*0.28));
  let ph = groundAt(x0,z0);
  for(let i=0;i<=steps;i++){
    const t = i/steps, x = x0+dx*t, z = z0+dz*t;
    for(const [ox,oz] of [[0,0],[px,pz],[-px,-pz]])
      if(!passable(w2c(x+ox), w2c(z+oz))) return false;
    const nh = groundAt(x,z);
    if(nh-ph > CLIMB || ph-nh > DROPMAX) return false;
    ph = nh;
  }
  return true;
}

/** Réduit un chemin cellule-par-cellule à ses points de rupture. */
export function smooth(cells){
  const pts = cells.map(c => ({x: c2w(c % GW), z: c2w((c/GW)|0)}));
  if(pts.length < 3) return pts;
  const out = [pts[0]];
  let i = 0;
  while(i < pts.length-1){
    let j = pts.length-1;
    for(; j>i+1; j--) if(clearLine(pts[i].x, pts[i].z, pts[j].x, pts[j].z)) break;
    out.push(pts[j]); i = j;
  }
  return out;
}
