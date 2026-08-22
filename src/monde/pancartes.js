/* ═══ MONDE / PANCARTES ═══
   « Laisser des pancartes avec possibilité d'écrire des messages et une petite
   loupiotte qui clignote pour dire que je suis déjà passé ici. »

   ── À QUOI ÇA SERT VRAIMENT ────────────────────────────────────────────────
   Le monde fait 1 632 m, il fait noir, et tout se ressemble. Le vrai problème
   n'est pas de mourir, c'est de tourner en rond sans le savoir. La pancarte
   est l'outil de cartographie mentale : une balise que TU as posée, avec ce
   que TU avais à dire.

   La loupiote clignote lentement. C'est volontairement le seul élément du jeu
   qui clignote : dans un monde de lumières fixes et de flammes qui vacillent,
   un clignotement régulier ne peut être qu'artificiel, donc humain, donc de
   toi. On le repère à travers la brume sans avoir à y penser.

   ── PERSISTANCE ────────────────────────────────────────────────────────────
   Les pancartes sont liées à la GRAINE du monde et sauvegardées dans le
   navigateur. Reviens sur le même monde, tes messages y sont encore. Change de
   monde, tu repars vierge — ce qui est la seule chose cohérente.            */

import {SETUP} from '../setup.js';
import {groundAt} from './grille.js';

/** [{x,y,z,texte,graine}] — celles du monde courant seulement. */
export const pancartes = [];

const CLE = 'scolopandre.pancartes.v1';
let graineCourante = 0;

/* ─────────────── persistance ─────────────── */

function toutCharger(){
  try{ return JSON.parse(localStorage.getItem(CLE) || '{}'); }
  catch(e){ return {}; }
}

function toutEnregistrer(tout){
  try{ localStorage.setItem(CLE, JSON.stringify(tout)); }catch(e){}
}

/** Charge les pancartes de ce monde. À appeler après chaque génération. */
export function chargerPancartes(graine){
  graineCourante = graine >>> 0;
  pancartes.length = 0;
  const tout = toutCharger();
  const lot = tout[graineCourante];
  if(Array.isArray(lot)) for(const p of lot) pancartes.push(p);
}

function enregistrer(){
  const tout = toutCharger();
  tout[graineCourante] = pancartes;
  /* On ne garde que les huit derniers mondes visités : sans ça le stockage
     enfle indéfiniment et finit par lever une exception de quota. */
  const cles = Object.keys(tout);
  if(cles.length > 8) for(const k of cles.slice(0, cles.length - 8)) delete tout[k];
  toutEnregistrer(tout);
}

/* ─────────────── pose et lecture ─────────────── */

/** Pose une pancarte à la position du joueur. Renvoie la pancarte, ou null. */
export function poser(joueur, texte){
  if(pancartes.length >= SETUP.pancartes.maxPosees) return null;
  const p = {
    x: joueur.x, z: joueur.z, y: groundAt(joueur.x, joueur.z),
    texte: (texte || '').slice(0, 48),
    yaw: joueur.yaw,
  };
  pancartes.push(p);
  enregistrer();
  return p;
}

/** La pancarte à portée de lecture, ou null. */
export function pancarteProche(x, z){
  const R = SETUP.pancartes.porteeLecture;
  let best = null, bd = R;
  for(const p of pancartes){
    const d = Math.hypot(p.x - x, p.z - z);
    if(d < bd){ bd = d; best = p; }
  }
  return best;
}

/** Retire la pancarte à portée. Renvoie true si quelque chose a été retiré. */
export function retirer(x, z){
  const p = pancarteProche(x, z);
  if(!p) return false;
  pancartes.splice(pancartes.indexOf(p), 1);
  enregistrer();
  return true;
}

export function effacerTout(){
  pancartes.length = 0;
  enregistrer();
}

/* ─────────────── rendu ─────────────── */

/**
 * Les lumières des loupiotes, cette image. Clignotement carré et lent : c'est
 * ce qui les distingue de tout le reste, qui vacille ou reste fixe.
 */
export function lumieresPancartes(sortie, temps){
  const P = SETUP.pancartes;
  for(const p of pancartes){
    const phase = (temps / P.clignotement) % 1;
    const on = phase < 0.22 ? 1 : phase < 0.30 ? 0.25 : 0.04;
    sortie.push({x:p.x, y:p.y + 1.5, z:p.z, c:[0.35*on, 2.2*on, 1.5*on]});
  }
}

/**
 * Le maillage d'une pancarte, en parts prêtes pour monde/maillage.js.
 * Un piquet, un panneau de tôle, et la loupiote au sommet.
 */
export function partsPancarte(p){
  const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
  return [
    // le piquet
    {tube:[[p.x, p.y, p.z], 0.06, [p.x, p.y + 1.45, p.z], 0.05, 5], c:[0.17,0.14,0.11]},
    // le panneau, face au joueur qui l'a posée
    {x:p.x, y:p.y + 1.12, z:p.z, sx:0.62, sy:0.40, sz:0.05,
     c:[0.34,0.31,0.26], r:0, yaw:p.yaw},
    // la loupiote
    {x:p.x, y:p.y + 1.52, z:p.z, sx:0.09, sy:0.09, sz:0.09,
     c:[0.30, 2.0, 1.4], emis:1},
  ];
}
