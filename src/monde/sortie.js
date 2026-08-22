/* ═══ MONDE / SORTIE ═══
   L'objectif. Sans sortie il n'y a pas de jeu, seulement une promenade.

   Elle est tirée AU HASARD, seulement contrainte d'être loin du départ. Poser
   la sortie au point le plus bas la rendait trouvable en descendant bêtement ;
   descendre reste utile pour les cartes rares et pour la chaleur géothermique,
   plus pour la sortie. Les deux objectifs ne tirent plus dans le même sens, ce
   qui oblige à choisir.                                                      */

import {SETUP} from '../setup.js';
import {ri} from '../noyau/rng.js';
import {DERIVE} from '../setup.js';
import {floorH, openN, idx, c2w, celluleLibre} from './grille.js';

/* Porteur : voir la note de src/monde/import-png.js. */
export const objectif = {sortie:null};

export function placerSortie(joueur, props, lights){
  let best = null;
  const DMIN = DERIVE.largeurMonde * 0.26;
  for(let k=0;k<20000;k++){
    const c = celluleLibre(ri), i = idx(c.x,c.z);
    if(openN[i] < 0.45) continue;
    if(Math.hypot(c2w(c.x) - joueur.x, c2w(c.z) - joueur.z) < DMIN) continue;
    best = {x:c2w(c.x), z:c2w(c.z), y:floorH[i], cell:i};
    break;
  }
  if(!best){
    const c = celluleLibre(ri);
    best = {x:c2w(c.x), z:c2w(c.z), y:floorH[idx(c.x,c.z)], cell:idx(c.x,c.z)};
  }
  objectif.sortie = best;
  const sortie = best;

  // une colonne de lumière visible de loin à travers le fog
  for(let k=0;k<10;k++)
    lights.push({x:sortie.x, y:sortie.y+1+k*2.2, z:sortie.z, c:[1.5,1.25,0.6], ph:k*0.6});

  const parts = [];
  for(const sd of [1,-1])
    parts.push({x:sortie.x+sd*1.5, y:sortie.y+2.6, z:sortie.z, sx:.5, sy:5.2, sz:.5, c:[.5,.45,.34]});
  parts.push({x:sortie.x, y:sortie.y+5.0, z:sortie.z, sx:3.6, sy:.6,  sz:.6,  c:[.5,.45,.34]});
  parts.push({x:sortie.x, y:sortie.y+2.4, z:sortie.z, sx:2.6, sy:4.6, sz:.18, c:[2.2,1.8,0.9], emis:1});
  props.push({parts, cell:sortie.cell});
  return sortie;
}

export function atteinte(joueur){
  const sortie = objectif.sortie;
  return sortie
      && Math.hypot(sortie.x - joueur.x, sortie.z - joueur.z) < 2.4
      && Math.abs(sortie.y - joueur.gy) < 3;
}
