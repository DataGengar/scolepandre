/* ═══ CRÉATURES / DIRECTEUR ═══
   Le metteur en scène. Il ne contrôle pas la créature : il lui désigne une
   ZONE où patrouiller, et fait monter une PRESSION avec le temps.

   Plus la pression est haute, plus la zone se resserre et se rapproche de toi.
   C'est ce qui empêche une partie de s'installer dans un statu quo confortable
   sans jamais tricher : elle ne sait toujours pas où tu es, on lui suggère
   seulement de chercher de plus en plus près.                               */

import {SETUP} from '../setup.js';
import {lerp} from '../noyau/math.js';
import {ri} from '../noyau/rng.js';
import {celluleLibre, c2w} from '../monde/grille.js';

export const directeur = {
  pression:0,
  repos:0,
  zone:{x:0, z:0, r:9},
  minuteur:0,

  reset(joueur){
    this.pression = 0;
    this.repos = 4;
    this.choisirZone(42, joueur);
  },

  /** Une zone à environ `veut` mètres du joueur. */
  choisirZone(veut, joueur){
    let best = null, bd = 1e9;
    for(let k=0;k<90;k++){
      const c = celluleLibre(ri), wx = c2w(c.x), wz = c2w(c.z);
      const sc = Math.abs(Math.hypot(wx-joueur.x, wz-joueur.z) - veut);
      if(sc < bd){ bd = sc; best = {x:wx, z:wz}; }
    }
    if(!best) return;
    this.zone.x = best.x; this.zone.z = best.z;
    this.zone.r = lerp(16, 7, this.pression);
    this.minuteur = 0;
  },

  update(dt, joueur, creature){
    if(this.repos > 0){
      this.repos -= dt;
      this.pression = Math.max(0, this.pression - dt*0.1);
    } else {
      this.pression = Math.min(1, this.pression + dt*SETUP.creature.monteePression);
    }
    this.minuteur += dt;
    const veut = lerp(60, 24, this.pression);
    if(this.minuteur > 14 ||
       Math.hypot(creature.x - this.zone.x, creature.z - this.zone.z) < 5)
      this.choisirZone(veut, joueur);
  },

  /** Elle t'a perdu : on lui laisse du champ, et la pression retombe. */
  onPerdu(joueur){
    this.repos = 8;
    this.pression = 0.18;
    this.choisirZone(42, joueur);
  },
};
