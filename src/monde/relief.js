/* ═══ MONDE / RELIEF ═══
   Gouffres sans fond, précipices, corniches de bord.

   Le tableau `vide[]` existait déjà en v2 mais n'était rempli qu'en bordure de
   planche : le monde avait un horizon, pas de trous. Ici on creuse des fosses
   À L'INTÉRIEUR — des blobs allongés, bordés d'une lèvre nette.

   La mécanique de mort est déjà en place ailleurs : blockedAt() laisse passer
   le vide (on ne se cogne pas contre un trou) et le joueur meurt quand il
   descend sous SETUP.relief.fondDuVide sous le sol le plus bas du monde.
   Ici on ne fait que creuser et border.                                     */

import {SETUP} from '../setup.js';
import {rnd, ri, rf} from '../noyau/rng.js';
import {BIOMES} from './biomes.js';
import {
  GW, GH, CELL, FLOOR, grid, floorH, openN, vide, falaise, biome,
  idx, inB, isFloor, isFree,
} from './grille.js';

/** Les gouffres posés, pour que les ponts sachent où enjamber et l'audio où
    faire souffler le vent. {x,z,rx,rz} en cellules. */
export const gouffres = [];

/**
 * Creuse les fosses sans fond.
 *
 * Deux garde-fous, sinon on coupe le monde en deux :
 *   · on ne creuse que dans du sol assez ouvert (openN),
 *   · on laisse toujours une lèvre de sol autour, jamais de trou affleurant
 *     un mur — sinon le bord n'est pas lisible et on tombe sans comprendre.
 */
export function creuserGouffres(lights){
  gouffres.length = 0;
  const S = SETUP.relief;
  // les valeurs de SETUP sont en MÈTRES : on les convertit en cellules ici,
  // pour qu'un changement de granularité ne change pas la taille des trous.
  const LMIN = Math.round(S.gouffreLongMin / CELL);
  const LMAX = Math.round(S.gouffreLongMax / CELL);
  const WMIN = Math.round(S.gouffreLargMin / CELL);
  const WMAX = Math.round(S.gouffreLargMax / CELL);

  for(let essai=0; essai<40000 && gouffres.length < S.nbGouffres; essai++){
    const cx = ri(30, GW-31), cz = ri(30, GH-31);
    if(!isFree(cx,cz) || openN[idx(cx,cz)] < 0.62) continue;

    const horiz = rnd() < 0.5;
    const lon = ri(LMIN, LMAX), lar = ri(WMIN, WMAX);
    const rx = horiz ? lon>>1 : lar>>1;
    const rz = horiz ? lar>>1 : lon>>1;

    // le rectangle plus une marge de 2 cellules doit être entièrement du sol
    let ok = true;
    for(let z=cz-rz-2; z<=cz+rz+2 && ok; z++)
      for(let x=cx-rx-2; x<=cx+rx+2 && ok; x++)
        if(!isFloor(x,z) || vide[idx(x,z)]) ok = false;
    if(!ok) continue;

    // trop près d'un autre gouffre : on éviterait un archipel illisible
    if(gouffres.some(g => Math.abs(g.x-cx) < rx+g.rx+14 && Math.abs(g.z-cz) < rz+g.rz+14))
      continue;

    // creusement en ellipse, avec un bord bruité pour ne pas faire piscine
    for(let z=cz-rz; z<=cz+rz; z++) for(let x=cx-rx; x<=cx+rx; x++){
      const u = (x-cx)/Math.max(1,rx), v = (z-cz)/Math.max(1,rz);
      const d = u*u + v*v;
      if(d > 1 - 0.22*Math.sin(x*0.7 + z*0.5)) continue;
      if(!inB(x,z)) continue;
      vide[idx(x,z)] = 1;
    }

    borderPrecipice(cx, cz, rx, rz, lights);
    gouffres.push({x:cx, z:cz, rx, rz});
  }
  return gouffres.length;
}

/**
 * La lèvre du gouffre. Un trou dans le fog est invisible jusqu'à ce qu'on soit
 * dedans, ce qui n'est pas de la tension mais de la frustration. On marque le
 * bord : falaise (paroi nette au maillage), un léger relèvement du sol, et une
 * lumière rasante tous les quelques mètres. On voit le précipice arriver.
 */
function borderPrecipice(cx, cz, rx, rz, lights){
  const bord = [];
  for(let z=cz-rz-2; z<=cz+rz+2; z++) for(let x=cx-rx-2; x<=cx+rx+2; x++){
    if(!isFloor(x,z) || vide[idx(x,z)]) continue;
    let voisinVide = false;
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])
      if(inB(x+dx,z+dz) && vide[idx(x+dx,z+dz)]){ voisinVide = true; break; }
    if(!voisinVide) continue;
    const i = idx(x,z);
    falaise[i] = 1;
    floorH[i] += 0.12;                    // légère lèvre : le pied la sent
    bord.push({x,z,i});
  }
  // une lumière rasante toutes les ~6 cellules du pourtour
  const teinte = bord.length ? BIOMES[biome[bord[0].i]].lum : [0.6,0.3,0.1];
  for(let k=0; k<bord.length; k += 6){
    const b = bord[k];
    if(lights.length >= SETUP.decor.maxLumieres) break;
    lights.push({
      x:(b.x+0.5)*CELL, y:floorH[b.i]+0.25, z:(b.z+0.5)*CELL,
      c:[teinte[0]*0.8, teinte[1]*0.55, teinte[2]*0.4], ph:rnd()*6.28,
    });
  }
}

/**
 * Éboulis local : appelé par les effondrements dynamiques. Fait tomber le
 * plafond sur quelques cellules et renvoie les gravats à ajouter au décor.
 */
export function effondrerZone(cx, cz, rayon){
  const touchees = [];
  for(let z=cz-rayon; z<=cz+rayon; z++) for(let x=cx-rayon; x<=cx+rayon; x++){
    if(!isFloor(x,z)) continue;
    const d = Math.hypot(x-cx, z-cz);
    if(d > rayon) continue;
    const i = idx(x,z);
    floorH[i] += rf(0.15, 0.55) * (1 - d/rayon);
    touchees.push({x, z, i});
  }
  return touchees;
}
