/* ═══ AUDIO / INDEX ═══
   Façade unique de tout le son. jeu.js n'importe QUE ce fichier — les autres
   modules audio ne sont jamais appelés directement de l'extérieur.

   C'est ce qui garde le lien synchronisé : si demain la chaîne change, seule
   cette façade doit rester stable.                                          */

import {A, construire, reprendre, volume, reglerReverb, murer} from './contexte.js';
import {SETUP} from '../setup.js';
import {demarrerNappe, changerNappe, nomNappe, accroc} from './nappes.js';
import {construireVent, souffler, force as forceVent} from './vent.js';
import {construireCavernes, majCavernes} from './cavernes.js';
import {construireEffondrements, majEffondrements, declencher} from './effondrements.js';
import {construireCreatureAudio, menace, creature, cri, jeunes, stridulation} from './creature-audio.js';
import * as effets from './effets.js';

let demarre = false;

/** Premier clic du joueur : c'est le seul moment où un AudioContext peut naître. */
export function demarrer(idNappe){
  if(demarre) return;
  try{ construire(); }catch(e){ console.warn('audio indisponible', e); return; }
  construireVent();
  construireCavernes();
  construireEffondrements();
  construireCreatureAudio();
  effets.construireEffets();
  demarrerNappe(idNappe);
  A.master.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, Math.pow(SETUP.audio.volume/100, SETUP.audio.courbeVolume)*SETUP.audio.facteurVolume),
    A.ctx.currentTime + 3);
  demarre = true;
}

export const pret = () => demarre;

export {
  reprendre, volume, reglerReverb, murer,
  changerNappe, nomNappe, accroc,
  souffler, forceVent,
  majCavernes,
  majEffondrements, declencher,
  menace, creature, cri, jeunes, stridulation,
  effets,
};
