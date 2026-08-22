/* ═══ JOUEUR / LEURRES ═══
   L'objet à lancer. C'est la seule action offensive du jeu, et la seule
   contre-mesure contre une poursuite.

   Un leurre qui tombe émet une vibration de rayon 30, bien plus forte qu'un
   pas. Dans creatures/mere.js, un impact ÉCRASE la croyance même en pleine
   poursuite et ouvre une fenêtre de fixation de 4,5 s — sans quoi l'objet
   serait inutile au seul moment où on en a besoin.                          */

import {SETUP} from '../setup.js';
import {rnd, ri} from '../noyau/rng.js';
import {floorH, idx, isFree, w2c, c2w, groundAt, celluleLibre} from '../monde/grille.js';

export const leurres = [];
const enVol = [];

export function placerLeurres(){
  leurres.length = 0; enVol.length = 0;
  for(let k=0; k<20000 && leurres.length < SETUP.decor.nbLeurres; k++){
    const c = celluleLibre(ri), i = idx(c.x,c.z);
    leurres.push({x:c2w(c.x), y:floorH[i]+0.22, z:c2w(c.z), tenu:false, vol:null});
  }
}

export function reprendreTous(){
  for(const l of leurres) l.tenu = false;
  enVol.length = 0;
}

/** Ramassage automatique en marchant dessus. Max 3 en main. */
export function ramasserLeurres(joueur){
  let n = 0;
  for(const l of leurres){
    if(l.tenu || l.vol) continue;
    if(joueur.held < 3 &&
       Math.hypot(l.x-joueur.x, l.z-joueur.z) < 1.5 &&
       Math.abs(l.y-joueur.gy) < 2.2){
      l.tenu = true; joueur.held++; n++;
    }
  }
  return n;
}

/**
 * @param derive  tremblement de main dû au froid : la visée devient imprécise
 * @returns true si un leurre est parti
 */
export function lancer(joueur, derive = 0){
  if(joueur.held <= 0 || joueur.throwCd > 0) return false;
  const l = leurres.find(o => o.tenu);
  if(!l) return false;
  l.tenu = false; joueur.held--; joueur.throwCd = 0.45;

  // la main tremble : à GELÉ le leurre part de travers, et c'est voulu
  const eyaw   = joueur.yaw   + (Math.random()-0.5)*derive*0.55;
  const epitch = joueur.pitch + (Math.random()-0.5)*derive*0.40;

  const cp = Math.cos(epitch), sp = Math.sin(epitch);
  const dx = -Math.sin(eyaw)*cp, dy = sp, dz = -Math.cos(eyaw)*cp;
  const v = 17 * (1 - derive*0.25);
  l.vol = {x:joueur.x, y:joueur.gy+joueur.eye, z:joueur.z, vx:dx*v, vy:dy*v+3, vz:dz*v};
  enVol.push(l);
  return true;
}

/**
 * @param hooks {impact(x,y,z)} — jeu.js émet la vibration et joue le son
 */
export function updateVol(dt, hooks){
  const H = hooks || {};
  for(let i=enVol.length-1;i>=0;i--){
    const l = enVol[i], f = l.vol;
    f.vy -= 26*dt;
    const nx = f.x + f.vx*dt, nz = f.z + f.vz*dt, ny = f.y + f.vy*dt;
    const heurte = !isFree(w2c(nx), w2c(nz));
    const g = groundAt(heurte ? f.x : nx, heurte ? f.z : nz);
    if(heurte){ f.vx *= -0.25; f.vz *= -0.25; }
    else { f.x = nx; f.z = nz; }
    f.y = ny;
    if(f.y <= g + 0.2){
      l.x = f.x; l.z = f.z; l.y = g + 0.22; l.vol = null;
      enVol.splice(i,1);
      if(H.impact) H.impact(l.x, l.y, l.z);
    }
  }
}

export const leurresEnVol = () => enVol;
