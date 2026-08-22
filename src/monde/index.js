/* ═══ MONDE / INDEX ═══
   Le chef d'orchestre de la génération. C'est le seul fichier à lire pour
   comprendre DANS QUEL ORDRE le monde se construit — et l'ordre compte.

   Chaque étape rend la main : la génération est un générateur JavaScript, ce
   qui permet à jeu.js d'afficher une barre de progression. Sur la grille 1088²
   la génération tient en ~1,4 s (mesuré), mais rendre la main reste utile :
   sans ça la page se fige, et sur une machine lente ça dure plusieurs
   secondes. Le rapport final donne la durée réelle.                        */

import {SETUP} from '../setup.js';
import {ri} from '../noyau/rng.js';
import {BIOMES} from './biomes.js';
import {
  GW, GH, FLOOR, grid, floorH, ceilH, biome, sky, vide,
  idx, viderGrille, calculerOuverture, majBornes, rebuildNavCost, bornes,
} from './grille.js';
import {
  creuserPlan, relaxerEpine, placerRampes, finaliserRelief, poserPlafonds, salles,
} from './generation.js';
import {creuserGouffres, gouffres} from './relief.js';
import {placerPonts} from './ponts.js';
import {placerCachettes, cachettes} from './cachettes.js';
import {placerProps, viderDecor, props, lights, colliders} from './props.js';
import {placerVillages, placerBoisEtFusees, viderVillages, villages} from './villages.js';
import {indexerProps, libererTousLesPaves} from './maillage.js';
import {importee} from './import-png.js';

export {props, lights, colliders} from './props.js';
export {cachettes} from './cachettes.js';
export {gouffres} from './relief.js';
export {villages, trousses, bois, fusees, dansSafe} from './villages.js';

/* Les objets posés dans le monde. Remplis par les modules qui les possèdent
   (carte/placement.js, joueur/leurres.js…) mais listés ici pour que l'ordre
   de placement soit visible d'un seul endroit. */
export const monde = {
  refuges: [],
  combustibles: [],
  leurres: [],
  sortie: null,
};

/**
 * Générateur : chaque `yield` est une étape nommée, avec sa part de progression.
 * Usage :  for(const etape of construireMonde()) afficher(etape);
 */
export function* construireMonde(hooks){
  const H = hooks || {};
  chrono.debut = performance.now();

  yield {nom:'remise à zéro', part:0.02};
  viderGrille(); viderDecor(); viderVillages(); libererTousLesPaves();
  monde.refuges.length = 0; monde.combustibles.length = 0;
  monde.leurres.length = 0; monde.sortie = null;

  if(importee.carte){
    yield {nom:'lecture de ta carte', part:0.20};
    batirDepuisCarte();
    yield {nom:'ouverture des volumes', part:0.35};
    calculerOuverture();
    poserPlafonds();
    majBornes();
    // pas de relaxation : ton relief reste le tien
  } else {
    yield {nom:'creusement des salles et cavernes', part:0.30};
    creuserPlan();

    yield {nom:'relaxation de l’épine navigable', part:0.48};
    relaxerEpine();

    yield {nom:'ouverture des volumes', part:0.55};
    calculerOuverture();

    yield {nom:'rampes de franchissement', part:0.58};
    chrono.rampes = placerRampes(lights, props);

    yield {nom:'gouffres et précipices', part:0.64};
    creuserGouffres(lights);

    yield {nom:'plafonds, falaises, bornes', part:0.68};
    finaliserRelief();
  }

  yield {nom:'passerelles suspendues', part:0.74};
  chrono.ponts = placerPonts(props);

  yield {nom:'cachettes', part:0.77};
  placerCachettes(props);

  yield {nom:'villages engloutis', part:0.82};
  chrono.villages = placerVillages();

  yield {nom:'décor', part:0.90};
  placerProps();

  yield {nom:'bois et fusées', part:0.93};
  placerBoisEtFusees();

  yield {nom:'objets et objectifs', part:0.96};
  if(H.placerObjets) H.placerObjets();

  yield {nom:'index de navigation', part:0.99};
  rebuildNavCost();
  indexerProps();

  chrono.duree = (performance.now() - chrono.debut) / 1000;
  yield {nom:'prêt', part:1.0};
}

/** Compteurs remplis pendant la génération. */
const chrono = {debut:0, duree:0, ponts:0, rampes:0, villages:0};

/* ─────────────── carte importée ─────────────── */

function batirDepuisCarte(){
  const C = importee.carte;
  for(let i=0; i<GW*GH; i++){
    if(C.biome[i] === 0){ grid[i] = 1; continue; }
    grid[i] = FLOOR;
    floorH[i] = C.alt[i];
    biome[i] = C.biome[i] - 1;          // 0 = roche dans l'éditeur
  }
  for(let x=0;x<GW;x++){ grid[idx(x,0)]=1; grid[idx(x,GH-1)]=1; }
  for(let z=0;z<GH;z++){ grid[idx(0,z)]=1; grid[idx(GW-1,z)]=1; }
}

/* ─────────────── diagnostic ─────────────── */

/** Compte-rendu affiché après génération. Utile pour vérifier une carte. */
export function rapportMonde(){
  let sol = 0, videN = 0, falaises = 0;
  for(let i=0;i<GW*GH;i++){
    if(grid[i]===FLOOR) sol++;
    if(vide[i]) videN++;
  }
  return {
    duree: chrono.duree.toFixed(1) + ' s',
    salles: salles.length,
    gouffres: gouffres.length,
    rampes: chrono.rampes,
    villages: chrono.villages,
    ponts: chrono.ponts,
    cachettes: cachettes.length,
    elements: props.length,
    lumieres: lights.length,
    cellulesSol: sol,
    cellulesVide: videN,
    altitudeMin: bornes.min.toFixed(0) + ' m',
    altitudeMax: bornes.max.toFixed(0) + ' m',
  };
}
