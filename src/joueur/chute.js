/* ═══ JOUEUR / CHUTE ═══
   Trois façons de tomber, une seule mécanique.

   1. CHUTE SISMIQUE — nouvelle en v3.
      « Le personnage peut chuter dû aux mouvements sismiques. »
      Au-delà de SETUP.joueur.seuilChute de tremblement, on tire une chute avec
      une probabilité proportionnelle à l'excès. Tomber met au sol 1,4 s sans
      aucun contrôle, et ÉMET UNE VIBRATION DE RAYON 22 : tomber te trahit.
      C'est ce qui rend une créature proche doublement dangereuse — elle fait
      trembler le sol, le sol te fait tomber, et ta chute lui dit où tu es.

   2. CHUTE DE FALAISE — au-delà de 6 m on est sonné (prone), au-delà de 14 m
      on meurt. Avec la verticalité ×3 et les corniches franches, c'est devenu
      une vraie cause de mort.

   3. CHUTE DANS LE VIDE — un gouffre n'a pas de fond. On meurt en passant
      sous SETUP.relief.fondDuVide.

   Le module ne décide de rien tout seul : il renvoie ce qui s'est passé et
   jeu.js applique. Ça le rend testable et ça évite les dépendances croisées. */

import {SETUP} from '../setup.js';
import {clamp} from '../noyau/math.js';
import {joueur, emettreSon, tombeDansLeVide} from './joueur.js';

/** Résultats possibles, pour que jeu.js n'ait pas à deviner. */
export const CHUTE = {
  RIEN:      'rien',
  SISMIQUE:  'sismique',
  SONNE:     'sonne',
  MORT_HAUTEUR: 'mortHauteur',
  MORT_VIDE: 'mortVide',
};

let cooldown = 0;

/**
 * Tirage de la chute sismique. Appelé une fois par image.
 * @returns CHUTE.SISMIQUE si le joueur vient de tomber, sinon CHUTE.RIEN
 */
export function tirerChuteSismique(dt){
  cooldown = Math.max(0, cooldown - dt);
  if(cooldown > 0 || joueur.prone > 0 || joueur.abrite) return CHUTE.RIEN;

  const J = SETUP.joueur;
  const exces = joueur.shake - J.seuilChute;
  if(exces <= 0) return CHUTE.RIEN;

  // probabilité par seconde, proportionnelle à l'excès de tremblement
  const p = J.tauxChute * (exces / Math.max(0.01, 1 - J.seuilChute)) * dt;
  if(Math.random() > p) return CHUTE.RIEN;

  tomber(1.0);
  return CHUTE.SISMIQUE;
}

/**
 * Impact au sol après une chute libre.
 * @param hauteur  mètres parcourus en chute
 * @returns un des CHUTE.*
 */
export function impactSol(hauteur){
  const R = SETUP.relief;
  if(hauteur >= R.mortChute) return CHUTE.MORT_HAUTEUR;
  if(hauteur >= R.degatChute){
    tomber(clamp(hauteur / R.mortChute, 0.4, 1));
    return CHUTE.SONNE;
  }
  return CHUTE.RIEN;
}

/** Le joueur est-il déjà passé sous le monde ? */
export function verifierVide(){
  return tombeDansLeVide() ? CHUTE.MORT_VIDE : CHUTE.RIEN;
}

/** Met le joueur au sol et émet la vibration qui va le trahir. */
export function tomber(force){
  joueur.prone = SETUP.joueur.dureeProne * (0.7 + force*0.5);
  joueur.vx *= 0.2; joueur.vz *= 0.2;
  joueur.shake = Math.min(1, joueur.shake + 0.3);
  emettreSon(joueur.x, joueur.z, SETUP.joueur.bruitChute * force, false);
  cooldown = 3.0;                 // pas deux chutes coup sur coup
}

export function reinitialiserChute(){ cooldown = 0; }
