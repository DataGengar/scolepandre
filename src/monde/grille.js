/* ═══ MONDE / GRILLE ═══
   Les champs par cellule et les accesseurs. C'est la structure de données
   centrale du jeu : tout le reste lit ou écrit ici.

   GRANULARITÉ (v3) : la cellule passe de 3,0 m à 1,5 m et la planche de
   544² à 1088². Le monde garde ses 1632 m de côté mais devient deux fois plus
   fin — corniches de 1,5 m, boyaux d'une seule cellule de large.
   Coût : 1 183 744 cellules, ~20 Mo de tableaux typés.

   DEUX ÉTAGES : le champ de hauteur ne connaît qu'une altitude par colonne.
   `pont[i]` marque une passerelle et `pontH[i]` sa cote : on passe DESSOUS
   comme avant et DESSUS en montant une échelle. Ce n'est pas de la 3D
   complète, c'est deux étages — assez pour des ponts, des galeries et des
   gouffres qu'on enjambe.                                                   */

import {SETUP, DERIVE} from '../setup.js';
import {BIOMES} from './biomes.js';

export const GW    = SETUP.monde.largeur;
export const GH    = SETUP.monde.hauteur;
export const CELL  = SETUP.monde.cellule;
export const CH    = SETUP.monde.pave;            // côté d'un pavé, en cellules
export const CHW   = DERIVE.pavesX;
export const CHH   = DERIVE.pavesZ;

export const WALL = 1, FLOOR = 0;
export const LEDGE  = SETUP.monde.corniche;
export const STEPUP = SETUP.monde.marcheJoueur;

const N = GW * GH;

/* ── les champs ── */
export const grid     = new Uint8Array(N).fill(WALL);  // FLOOR ou WALL
export const blocked  = new Uint8Array(N);   // occupé par un élément de décor massif
export const floorH   = new Float32Array(N); // cote du sol
export const ceilH    = new Float32Array(N); // cote du plafond
export const openN    = new Float32Array(N); // 0 = boyau, 1 = grande salle
export const biome    = new Uint8Array(N);
export const platform = new Uint8Array(N);   // surélévations volontaires
export const sky      = new Uint8Array(N);   // à ciel ouvert : aucun plafond
export const falaise  = new Uint8Array(N);   // arête franche : le joueur ne monte pas
export const pont     = new Uint8Array(N);   // passerelle au-dessus
export const pontH    = new Float32Array(N);
export const echelle  = new Uint8Array(N);   // relie les deux étages
export const vide     = new Uint8Array(N);   // pas de sol du tout : on y tombe
export const navCost  = new Float32Array(N);

/* Bornes d'altitude du monde courant. Calculées UNE FOIS à la génération :
   la v2 les recalculait sur toute la grille trois fois par seconde, ce qui
   était déjà cher à 544² et devient inacceptable à 1088². */
export const bornes = {min:0, max:0};

export function majBornes(){
  let mn = 1e9, mx = -1e9;
  for(let i=0;i<N;i++){
    if(grid[i] !== FLOOR) continue;
    const h = floorH[i];
    if(h < mn) mn = h;
    if(h > mx) mx = h;
  }
  bornes.min = mn === 1e9 ? 0 : mn;
  bornes.max = mx === -1e9 ? 0 : mx;
}

/** Profondeur normalisée : 0 en surface, 1 au point le plus bas du monde. */
export function profondeurDe(y){
  return 1 - (y - bornes.min) / Math.max(1, bornes.max - bornes.min);
}

/* ── accesseurs ── */
export const idx    = (x,z) => z * GW + x;
export const inB    = (x,z) => x > 0 && z > 0 && x < GW-1 && z < GH-1;
export const isFloor= (x,z) => inB(x,z) && grid[idx(x,z)] === FLOOR;
/* ── LA RÈGLE : RIEN NE FLOTTE AU-DESSUS DU VIDE ──
   « Au-dessus des gouffres il y a des objets flottants. Rectifier et les
   virer. Règle. »

   La cause tenait ici. `isFree` disait « cette cellule est libre » sans jamais
   regarder `vide[]` — et c'est cette fonction que `celluleLibre()` interroge
   pour semer le décor, les cartes, le bois, les leurres. Un gouffre creusé au
   milieu d'un ancien sol laissait donc tout ce qu'on y avait posé suspendu
   dans les airs.

   Corrigé À LA SOURCE plutôt qu'objet par objet : la règle vaut pour tout ce
   qui est semé, y compris ce qu'on ajoutera demain. C'est la différence entre
   corriger un symptôme et poser une règle. */
export const isFree = (x,z) =>
  isFloor(x,z) && !blocked[idx(x,z)] && !vide[idx(x,z)];
export const w2c    = v => Math.floor(v / CELL);
export const c2w    = c => (c + 0.5) * CELL;
export const estVide= (x,z) => (x<0 || z<0 || x>=GW || z>=GH) || vide[idx(x,z)] === 1;

/** Hauteur du sol au point monde donné. 0 hors carte. */
export function groundAt(wx, wz){
  const x = w2c(wx), z = w2c(wz);
  if(!isFloor(x,z)) return 0;
  return floorH[idx(x,z)];
}

/** Hauteur libre sous plafond. Sert au rampé forcé et à l'exposition au froid. */
export function degagement(wx, wz){
  const x = w2c(wx), z = w2c(wz);
  if(!isFloor(x,z)) return 99;
  const i = idx(x,z);
  return sky[i] ? 99 : ceilH[i] - floorH[i];
}

/** Une cellule libre au hasard. Renvoie {x,z} — jamais null. */
export function celluleLibre(rnd_ri){
  for(let k=0;k<5000;k++){
    const x = rnd_ri(1, GW-2), z = rnd_ri(1, GH-2);
    if(isFree(x,z)) return {x,z};
  }
  return {x:1, z:1};
}

/** Remet tous les champs à zéro avant une nouvelle génération. */
export function viderGrille(){
  grid.fill(WALL);
  blocked.fill(0); floorH.fill(0); ceilH.fill(0); openN.fill(0);
  biome.fill(0); platform.fill(0); sky.fill(0); falaise.fill(0);
  pont.fill(0); pontH.fill(0); echelle.fill(0); vide.fill(0); navCost.fill(0);
  bornes.min = bornes.max = 0;
}

/** Le biome sous un point monde. Utilisé par le froid, l'audio et le HUD. */
export function biomeAt(wx, wz){
  const x = w2c(wx), z = w2c(wz);
  if(!isFloor(x,z)) return 0;
  return biome[idx(x,z)];
}

export const biomeDe = i => BIOMES[biome[i]];

/** Coût de navigation : la créature préfère longer les murs aux grandes salles. */
export function rebuildNavCost(){
  const w = SETUP.creature.aversionOuvert;
  for(let z=0;z<GH;z++) for(let x=0;x<GW;x++){
    const i = idx(x,z);
    if(grid[i] !== FLOOR || blocked[i]){ navCost[i] = 0; continue; }
    const hug = (!isFree(x+1,z) || !isFree(x-1,z) || !isFree(x,z+1) || !isFree(x,z-1)) ? 0.4 : 0;
    navCost[i] = Math.min(8, Math.max(0.35, 1 + openN[i]*w - hug));
  }
}

/** Ouverture locale : proportion de sol dans un voisinage. 0 = boyau, 1 = salle.
    Le rayon suit la taille de cellule pour couvrir la même surface qu'en v2.

    Image intégrale plutôt que double boucle : la v2 faisait 49 lectures par
    cellule, ce qui coûtait 58 M d'accès sur la grille 1088². Ici c'est deux
    passes linéaires, quel que soit le rayon. */
export function calculerOuverture(){
  const R = Math.max(3, Math.round(4.5 / CELL));   // ~4,5 m de rayon
  const T = (2*R+1) * (2*R+1);
  const W = GW + 1;
  const S = new Int32Array(W * (GH + 1));          // somme cumulée

  for(let z=0; z<GH; z++){
    let ligne = 0;
    for(let x=0; x<GW; x++){
      if(grid[idx(x,z)] === FLOOR) ligne++;
      S[(z+1)*W + x+1] = S[z*W + x+1] + ligne;
    }
  }
  const somme = (x0,z0,x1,z1) => {          // bornes comprises, déjà écrêtées
    return S[(z1+1)*W + x1+1] - S[z0*W + x1+1] - S[(z1+1)*W + x0] + S[z0*W + x0];
  };

  for(let z=0; z<GH; z++) for(let x=0; x<GW; x++){
    const i = idx(x,z);
    if(grid[i] !== FLOOR) continue;
    const x0 = Math.max(0, x-R), x1 = Math.min(GW-1, x+R);
    const z0 = Math.max(0, z-R), z1 = Math.min(GH-1, z+R);
    openN[i] = somme(x0,z0,x1,z1) / T;
  }
}
