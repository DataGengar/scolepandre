/* ═══ ÉDITEUR / CRÉATURE ═══
   Régler le scolopandre en le regardant.

   ── POURQUOI IL N'Y A PAS DE MODELEUR ICI ──────────────────────────────────
   Le scolopandre n'est pas un maillage : c'est un ALGORITHME. Son corps est
   reconstruit à chaque image à partir de sa trace, de son état et d'une
   quarantaine de paramètres — nombre d'anneaux, profil de rayon, ondulation,
   cadence des pattes, grammaire des yeux. Il n'y a pas de sommets à déplacer,
   il y a des nombres à régler.

   L'éditeur expose donc ces nombres, et rejoue le VRAI code de génération
   (creatures/geometrie.js) à chaque image. Ce qu'on voit tourner ici est
   littéralement la bête du jeu, pas une maquette.

   ── LA TRACE FACTICE ───────────────────────────────────────────────────────
   En jeu, le corps suit l'historique des positions de la tête. À l'arrêt dans
   un éditeur, cet historique est vide et la bête se replierait en un point. On
   lui fabrique donc une trace en S, qu'on peut animer : c'est ce qui permet de
   juger l'ondulation et la démarche, qui sont l'essentiel de sa présence.    */

import {SETUP} from '../setup.js';
import {creature} from '../creatures/mere.js';
import {ST} from '../creatures/etats.js';
import {nouvelEtatYeux, majYeux} from '../creatures/lueurs.js';
import {creerCreature, batirCreature, dessinerCreatures, nbSommets,
        lumieresTemporaires} from '../creatures/geometrie.js';

export const reglages = {
  etat: ST.PATROL,       // pour voir la grammaire des yeux
  courbure: 0.55,        // amplitude du S de la trace
  longueur: 1.0,         // multiplicateur de l'écart entre anneaux
  anime: true,
  vitesse: 1.0,
};

/** Les curseurs exposés. Chemin dans SETUP, borne basse, borne haute, pas. */
export const CURSEURS = [
  ['creature.segments',            8,   96,  1,  'Anneaux du corps'],
  ['creature.anneaux',             6,   32,  1,  'Sommets par anneau'],
  ['creature.paires',              4,   32,  1,  'Paires de pattes'],
  ['creature.yeux.portee',        20,  260,  5,  'Portée des yeux'],
  ['creature.yeux.transition',  0.05,  2.0,.05,  'Fondu des yeux (s)'],
  ['creature.pattes.emission',     0,  2.5,.05,  'Lueur des pattes'],
  ['creature.pattes.ondulation',   0,  2.0,.05,  'Ondulation des pattes'],
  ['creature.interstices.emissionRepos',  0, 4, .05, 'Interstices au repos'],
  ['creature.interstices.emissionChasse', 0, 4, .05, 'Interstices en chasse'],
  ['creature.interstices.periode',      0.4, 9, .1,  'Période des interstices'],
];

let pret = false, temps = 0;

export function initialiser(){
  if(pret) return;
  creerCreature();
  creature.yeux = nouvelEtatYeux();
  pret = true;
}

/**
 * Fabrique une trace en S sous la tête. C'est elle qui donne sa forme au corps :
 * sans historique, sampleBody() renvoie la tête pour tous les anneaux.
 */
function traceFactice(t){
  const c = creature;
  const N = 140;
  const pas = 0.16 * reglages.longueur;
  c.hist.length = 0;
  c.cum = 0;
  let px = 0, pz = 0;
  for(let i = N; i >= 0; i--){
    const u = i * pas;
    // un S qui se déroule : deux sinusoïdes de périodes différentes
    const x = -u;
    const z = Math.sin(u * 0.55 + t) * reglages.courbure
            + Math.sin(u * 0.21 - t * 0.6) * reglages.courbure * 0.5;
    if(i < N){
      c.cum += Math.hypot(x - px, z - pz);
    }
    c.hist.push({x, y: 0.55, z, cum: c.cum});
    px = x; pz = z;
  }
  // l'historique va de la queue vers la tête : sampleBody remonte depuis cum
  c.hist.reverse();
  let cum = 0;
  for(let i = 0; i < c.hist.length; i++){
    if(i) cum += Math.hypot(c.hist[i].x - c.hist[i-1].x, c.hist[i].z - c.hist[i-1].z);
    c.hist[i].cum = cum;
  }
  c.cum = cum;
  const tete = c.hist[c.hist.length - 1];
  c.x = tete.x; c.y = tete.y; c.z = tete.z;
  const av = c.hist[c.hist.length - 2] || tete;
  c.heading = Math.atan2(-(tete.x - av.x), -(tete.z - av.z));
}

/**
 * Reconstruit la bête et la dessine. Appelé à chaque image par l'éditeur.
 * @returns le nombre de triangles
 */
export function rendreCreature(dt){
  initialiser();
  if(reglages.anime) temps += dt * reglages.vitesse;

  creature.state = reglages.etat;
  creature.scan = Math.sin(temps * 1.6) * 0.9;
  creature.vitesse = reglages.etat === ST.CHASE ? SETUP.creature.vitesseTraque : 2.4;
  majYeux(creature.yeux, creature.state, dt, temps);

  traceFactice(temps * 0.8);
  batirCreature(temps);
  dessinerCreatures();
  return nbSommets() / 3;
}

/** Le rayon utile pour cadrer la caméra. */
export function envergure(){
  // longueur du corps = anneaux × pas d'échantillonnage, et on cadre la moitié
  return Math.max(3, SETUP.creature.segments * creature.SP * 0.52 * 0.5);
}

export {lumieresTemporaires};
