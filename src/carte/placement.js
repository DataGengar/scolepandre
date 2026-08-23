/* ═══ CARTE / PLACEMENT ═══
   Répartit les cartes dans le monde. La rareté vient de la PROFONDEUR : les
   rangs élevés ne sortent qu'en dessous de leur `profondeurMin`.

   C'est la mécanique qui donne un sens à descendre, et elle se combine avec la
   géothermie du froid (joueur/froid.js) : plus bas il fait plus chaud ET les
   cartes sont meilleures — mais c'est là qu'elle vit.                       */

import {SETUP} from '../setup.js';
import {ri, rnd} from '../noyau/rng.js';
import {
  idx, floorH, blocked, c2w, celluleLibre, profondeurDe,
} from '../monde/grille.js';
import {RANGS, rangsPermis} from './rangs.js';
import {autorise} from '../monde/plan.js';
import {tirerDansRang} from './catalogue.js';

/** [{x,y,z,rang,id,prise}] */
export const cartes = [];

export function placerCartes(){
  cartes.length = 0;
  const S = SETUP.cartes;

  for(let k=0; k<S.essaisPlacement && cartes.length < S.nombreDansLeMonde; k++){
    const c = celluleLibre(ri);
    const i = idx(c.x, c.z);
    if(blocked[i]) continue;
    if(!autorise('cartes', c.x, c.z)) continue;

    const prof = profondeurDe(floorH[i]);
    const permis = rangsPermis(prof);
    if(!permis.length) continue;

    // tirage pondéré parmi les rangs autorisés ici, biaisé vers le plus rare
    // à mesure qu'on descend : à profondeur 1 le poids des rangs élevés triple.
    let somme = 0;
    const poids = permis.map(r => {
      const p = r.poids * (1 + prof * prof * 2 * (r.profondeurMin > 0 ? 1 : 0));
      somme += p; return p;
    });
    let t = rnd() * somme, choisi = permis[0];
    for(let n=0; n<permis.length; n++){ t -= poids[n]; if(t <= 0){ choisi = permis[n]; break; } }

    const rang = RANGS.indexOf(choisi);
    cartes.push({
      x: c2w(c.x), y: floorH[i] + SETUP.cartes.hauteurFlottement, z: c2w(c.z),
      rang, id: tirerDansRang(rang, ri), prise:false,
    });
  }
  return cartes.length;
}

/** Ramassage. Renvoie la carte prise, ou null. */
export function ramasser(px, py, pz){
  for(const k of cartes){
    if(k.prise) continue;
    if(Math.hypot(k.x-px, k.z-pz) < 1.6 && Math.abs(k.y-py) < 2.4){
      k.prise = true;
      return k;
    }
  }
  return null;
}
