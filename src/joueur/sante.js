/* ═══ JOUEUR / SANTÉ ═══
   Des points de vie, et des trousses médicales pour les remonter.

   ── POURQUOI CE MODULE EXISTE ──────────────────────────────────────────────
   La v3.0 n'avait aucune santé : toute atteinte tuait sur le coup. Ça rendait
   impossibles deux choses demandées — les trousses médicales des villages
   (soigner quoi ?) et les jeunes qu'on peut affronter plutôt que subir.

   ── LA RÈGLE ───────────────────────────────────────────────────────────────
   100 points. Ce qui les entame :

     morsure de jeune     −22, puis 1,1 s d'invulnérabilité
     chute                −9 par mètre au-delà du seuil de dégât
     froid à zéro         −3,5 par seconde
     gouffre sans fond    mort immédiate, quoi qu'il reste
     LA MÈRE              mort immédiate, toujours. Elle n'est pas un
                          adversaire, elle est une fin. On ne la combat pas.

   Ce qui les rend :

     trousse médicale     +45, et la trousse disparaît pour de bon
     repos                +0,35 par seconde, mais seulement après 12 secondes
                          sans avoir été touché. Assez pour récupérer d'une
                          mauvaise rencontre, jamais assez pour ignorer les
                          trousses.                                          */

import {SETUP} from '../setup.js';
import {clamp} from '../noyau/math.js';
import {trousses} from '../monde/villages.js';

export const sante = {
  pv: SETUP.sante.max,
  invul: 0,          // secondes d'invulnérabilité restantes
  depuisCoup: 999,   // secondes depuis la dernière blessure
  flash: 0,          // 0..1, pour teinter l'écran au moment du coup
  mort: false,
};

export function reinitialiserSante(){
  sante.pv = SETUP.sante.max;
  sante.invul = 0; sante.depuisCoup = 999; sante.flash = 0; sante.mort = false;
}

/**
 * Inflige des dégâts. Renvoie true si le coup est passé (pas d'invulnérabilité).
 * @param ignoreInvul  pour le froid, qui ronge en continu
 */
export function blesser(n, ignoreInvul){
  if(sante.mort) return false;
  if(!ignoreInvul && sante.invul > 0) return false;
  sante.pv = clamp(sante.pv - n, 0, SETUP.sante.max);
  if(!ignoreInvul) sante.invul = SETUP.sante.invulnerabilite;
  sante.depuisCoup = 0;
  sante.flash = Math.min(1, sante.flash + n / 40);
  if(sante.pv <= 0) sante.mort = true;
  return true;
}

export function soigner(n){
  sante.pv = clamp(sante.pv + n, 0, SETUP.sante.max);
}

/** Ramassage d'une trousse. Renvoie true si on en a pris une. */
export function ramasserTrousse(x, y, z){
  if(sante.pv >= SETUP.sante.max) return false;   // inutile de gâcher
  for(const t of trousses){
    if(t.prise) continue;
    if(Math.hypot(t.x-x, t.z-z) < 1.7 && Math.abs(t.y-y) < 2.4){
      t.prise = true;
      soigner(SETUP.sante.soinTrousse);
      return true;
    }
  }
  return false;
}

export function updateSante(dt){
  const S = SETUP.sante;
  sante.invul = Math.max(0, sante.invul - dt);
  sante.depuisCoup += dt;
  sante.flash = Math.max(0, sante.flash - dt*1.8);
  if(!sante.mort && sante.depuisCoup > S.seuilRepos)
    sante.pv = clamp(sante.pv + S.regen*dt, 0, S.max);
}

/** 0 quand on va bien, 1 à l'agonie. Pilote la teinte rouge de l'écran. */
export const gravite = () => 1 - sante.pv / SETUP.sante.max;
