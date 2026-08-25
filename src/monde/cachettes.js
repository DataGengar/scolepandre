/* ═══ MONDE / CACHETTES ═══
   Littéralement des trous. Peu dans le monde, discrètement visibles sur la
   carte.

   RÈGLE DE LA CACHETTE — tenue partout, comme celle du froid :
     · on y entre avec E quand on est à moins de 2 m de l'entrée ;
     · dedans, la créature ne perçoit NI ton odeur NI tes vibrations
       (creatures/mere.js interroge joueur.abrite avant de te sentir) ;
     · le vent ne t'atteint plus : l'exposition au froid tombe à zéro et la
       chaleur remonte lentement ;
     · le monde extérieur passe par un filtre passe-bas : on entend qu'on est
       enterré ;
     · sur le sismographe : un petit losange creux, visible seulement à moins
       de SETUP.cachettes.porteeMarqueur. « Discrètement visible » : il faut
       s'en approcher pour le voir, et donc les mémoriser.

   Ce n'est pas un abri gratuit : dedans on ne voit presque rien, on ne ramasse
   rien, et la créature continue de patrouiller. C'est une pause, pas une
   solution.                                                                 */

import {SETUP} from '../setup.js';
import {rnd, ri, rf} from '../noyau/rng.js';
import {
  GW, GH, CELL, FLOOR, grid, floorH, ceilH, openN, blocked, biome, vide,
  idx, inB, isFloor, isFree, celluleLibre,
} from './grille.js';
import {BIOMES} from './biomes.js';
import {autorise} from './plan.js';
import {lights} from './props.js';

export const cachettes = [];

/**
 * Creuse les trous. Chaque cachette est une alcôve de 2×2 cellules creusée
 * DANS la roche, reliée au couloir par une entrée d'une seule cellule et à
 * plafond bas — on doit ramper pour y entrer.
 */
export function placerCachettes(props){
  cachettes.length = 0;
  const S = SETUP.cachettes;

  for(let essai=0; essai<60000 && cachettes.length < S.nombre; essai++){
    const c = celluleLibre(ri);
    const i0 = idx(c.x, c.z);
    // on veut une paroi juste à côté : la cachette se creuse dedans,
    // et plutôt dans un boyau que dans une salle
    if(openN[i0] > 0.55) continue;
    if(!autorise('cachettes', c.x, c.z)) continue;

    let dir = null;
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      if(isFloor(c.x+dx, c.z+dz)) continue;                  // il faut du plein
      if(!inB(c.x+dx*4, c.z+dz*4)) continue;
      // les 4 cellules à creuser doivent être de la roche, pas un autre couloir
      let plein = true;
      for(let k=1; k<=4 && plein; k++)
        for(let s=0; s<=1 && plein; s++){
          const px = c.x + dx*k + (dz ? s : 0), pz = c.z + dz*k + (dx ? s : 0);
          if(!inB(px,pz) || grid[idx(px,pz)] === FLOOR) plein = false;
        }
      if(plein){ dir = [dx,dz]; break; }
    }
    if(!dir) continue;

    const [dx,dz] = dir;
    const wx = (c.x+0.5)*CELL, wz = (c.z+0.5)*CELL;
    if(cachettes.some(k => Math.hypot(k.x-wx, k.z-wz) < S.ecartMin)) continue;

    const h = floorH[i0], b = biome[i0];
    const cellules = [];

    // entrée : une cellule, plafond très bas → rampé obligatoire
    {
      const ex = c.x+dx, ez = c.z+dz, ei = idx(ex,ez);
      grid[ei] = FLOOR; floorH[ei] = h - 0.25; ceilH[ei] = h + 0.95;
      biome[ei] = b; openN[ei] = 0.05; blocked[ei] = 0; vide[ei] = 0;
      cellules.push(ei);
    }
    // alcôve 2 × 2, un peu plus haute : on peut s'y asseoir
    for(let k=2; k<=3; k++) for(let s=0; s<=1; s++){
      const px = c.x + dx*k + (dz ? s : 0), pz = c.z + dz*k + (dx ? s : 0);
      if(!inB(px,pz)) continue;
      const pi = idx(px,pz);
      grid[pi] = FLOOR; floorH[pi] = h - 0.25; ceilH[pi] = h + 1.35;
      biome[pi] = b; openN[pi] = 0.05; blocked[pi] = 0; vide[pi] = 0;
      cellules.push(pi);
    }

    const centre = {
      x: (c.x + dx*2.5 + 0.5) * CELL,
      z: (c.z + dz*2.5 + 0.5) * CELL,
      y: h - 0.25,
      entree: {x: (c.x + dx + 0.5)*CELL, z: (c.z + dz + 0.5)*CELL},
      cellules,
    };
    cachettes.push(centre);

    /* ── UNE BALISE, PAS UN REPÈRE DISCRET ──
       La version précédente posait trois éclats « assez pour qu'on remarque le
       trou en passant devant à la torche, pas assez pour le voir de loin ».
       C'était l'intention, et c'était une erreur : avec 7,7 m de visibilité,
       « en passant devant » veut dire à moins de deux mètres. On ne trouvait
       aucune cachette, jamais.

       Il faut une VRAIE source lumineuse. Une lampe perce le brouillard bien
       au-delà de la distance à laquelle on distingue une surface : c'est
       exactement la propriété dont on a besoin. On aperçoit une lueur verte
       au loin, on va voir, on trouve un trou. */
    const t = BIOMES[b].lum;
    const bal = S.balise;
    const parts = [];
    for(let k=0; k<3; k++)
      parts.push({
        x: centre.entree.x + rf(-0.5,0.5), y: h + rf(0.1,0.6),
        z: centre.entree.z + rf(-0.5,0.5),
        sx:0.07, sy:rf(0.18,0.38), sz:0.07,
        c:[bal[0]*2.2, bal[1]*2.4, bal[2]*2.2], r:rf(-0.4,0.4), emis:1,
      });
    props.push({parts, cell: idx(c.x+dx, c.z+dz)});

    if(lights.length < SETUP.decor.maxLumieres)
      lights.push({x: centre.entree.x, y: h + 0.55, z: centre.entree.z,
                   c:[bal[0]*S.baliseGain, bal[1]*S.baliseGain,
                      bal[2]*S.baliseGain], ph: rnd()*6.28});
  }
  return cachettes.length;
}

/** La cachette dont l'entrée est à portée, ou null. */
export function cachetteProche(wx, wz, portee = 2.2){
  for(const k of cachettes)
    if(Math.hypot(k.entree.x - wx, k.entree.z - wz) < portee) return k;
  return null;
}

/** Es-tu à l'intérieur de cette cachette ? (utilisé pour la sortie auto) */
export function dansCachette(k, wx, wz){
  return k && Math.hypot(k.x - wx, k.z - wz) < 3.2;
}
