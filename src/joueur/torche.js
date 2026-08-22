/* ═══ JOUEUR / TORCHE ═══
   Éteinte, il ne reste que les cristaux, les fenêtres et les yeux de la bête.
   Allumée, elle consomme du combustible ramassé au sol.

   Elle interagit avec le froid : allumée, elle divise la perte de chaleur par
   presque deux (SETUP.froid.torcheAllumee). Elle ne réchauffe pas — elle
   ralentit. Le seul vrai réchauffement vient des braseros et des cachettes.  */

import {SETUP} from '../setup.js';
import {rnd, ri} from '../noyau/rng.js';
import {floorH, idx, blocked, c2w, celluleLibre} from '../monde/grille.js';

export const torche = {on:true, jus:1};

export const combustibles = [];
export const refuges = [];

export function placerCombustible(){
  combustibles.length = 0;
  for(let k=0; k<20000 && combustibles.length < SETUP.torche.nbCombustibles; k++){
    const c = celluleLibre(ri), i = idx(c.x, c.z);
    if(blocked[i]) continue;
    combustibles.push({x:c2w(c.x), y:floorH[i]+0.35, z:c2w(c.z), pris:false});
  }
}

/* Les braseros. Le seul endroit où la chaleur remonte vite, et le seul endroit
   où elle ne descend pas du tout. Ça donne une raison de mémoriser le terrain. */
export function placerRefuges(props, lights){
  refuges.length = 0;
  const DIST = SETUP.cachettes.ecartMin * 2.4;
  for(let k=0; k<12000 && refuges.length < SETUP.decor.nbRefuges; k++){
    const c = celluleLibre(ri), i = idx(c.x,c.z);
    const wx = c2w(c.x), wz = c2w(c.z);
    if(refuges.some(r => Math.hypot(r.x-wx, r.z-wz) < DIST)) continue;
    const y = floorH[i];
    refuges.push({x:wx, z:wz, y, cell:i});
    const parts = [
      {x:wx, y:y+0.35, z:wz, sx:1.5, sy:.7,  sz:1.5,  c:[.20,.17,.15]},
      {x:wx, y:y+0.85, z:wz, sx:1.05,sy:.5,  sz:1.05, c:[2.6,1.25,0.35], emis:1},
    ];
    for(const [ox,oz] of [[1.5,1.5],[-1.5,1.5],[1.5,-1.5],[-1.5,-1.5]])
      parts.push({x:wx+ox, y:y+1.3, z:wz+oz, sx:.22, sy:2.6, sz:.22, c:[.24,.20,.17]});
    props.push({parts, cell:i});
    for(let q=0;q<4;q++)
      lights.push({x:wx, y:y+0.9+q*0.8, z:wz, c:[1.9,0.85,0.28], ph:q*1.3});
  }
}

/** Un brasero est-il à portée ? */
export function refugeProche(x, y, z){
  for(const r of refuges)
    if(Math.hypot(r.x-x, r.z-z) < 3.4 && Math.abs(r.y-y) < 3) return r;
  return null;
}

/**
 * Consommation, ramassage, recharge au brasero.
 * @returns true si un combustible vient d'être ramassé
 */
export function updateTorche(dt, joueur, presBrasero){
  if(torche.on) torche.jus = Math.max(0, torche.jus - dt*SETUP.torche.conso);
  if(torche.jus <= 0) torche.on = false;

  let ramasse = false;
  for(const f of combustibles){
    if(f.pris) continue;
    if(Math.hypot(f.x-joueur.x, f.z-joueur.z) < 1.6 && Math.abs(f.y-joueur.gy) < 2.4){
      f.pris = true;
      torche.jus = Math.min(1, torche.jus + SETUP.torche.recharge);
      ramasse = true;
    }
  }
  if(presBrasero){
    torche.jus = Math.min(1, torche.jus + dt*SETUP.torche.rechargeBrasero);
    torche.on = true;
  }
  return ramasse;
}

export function basculerTorche(){
  if(torche.jus > 0) torche.on = !torche.on;
}

export function reinitialiserTorche(){ torche.on = true; torche.jus = 1; }
