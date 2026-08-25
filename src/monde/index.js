/* ═══ MONDE / INDEX ═══
   Le chef d'orchestre de la génération. C'est le seul fichier à lire pour
   comprendre DANS QUEL ORDRE le monde se construit — et l'ordre compte.

   Chaque étape rend la main : la génération est un générateur JavaScript, ce
   qui permet à jeu.js d'afficher une barre de progression. Sur la grille 1088²
   la génération tient en ~1,4 s (mesuré), mais rendre la main reste utile :
   sans ça la page se fige, et sur une machine lente ça dure plusieurs
   secondes. Le rapport final donne la durée réelle.                        */

import {SETUP} from '../setup.js';
import {ri, graine} from '../noyau/rng.js';
import {semerBruit} from '../noyau/bruit.js';
import {BIOMES} from './biomes.js';
import {
  GW, GH, FLOOR, grid, floorH, ceilH, biome, sky, vide, blocked,
  idx, viderGrille, calculerOuverture, majBornes, rebuildNavCost, bornes,
  celluleLibre, c2w,
} from './grille.js';
import {
  creuserPlan, relaxerEpine, finaliserRelief, poserPlafonds, quantifierRelief,
  salles, releve,
} from './generation.js';
import {creuserGouffres, gouffres} from './relief.js';
import {relierLeMonde, percerEnclaves} from './connexite.js';
import {placerPonts} from './ponts.js';
import {placerCachettes, cachettes} from './cachettes.js';
import {placerProps, viderDecor, props, lights, colliders} from './props.js';
import {placerVillages, placerBoisEtFusees, viderVillages, villages} from './villages.js';
import {placerEdifices, viderEdifices, edifices} from './edifices.js';
import {placerArmes, armesAuSol, cellulesAuSol} from '../joueur/armes.js';
import {indexerProps, libererTousLesPaves, statsMaillage} from './maillage.js';
import {importee} from './import-png.js';
import {plan, planActif} from './plan.js';

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
  /* Les champs de bruit suivent la graine du monde : même graine, même
     terrain, au bit près. C'est ici et nulle part ailleurs, pour que l'éditeur
     et les outils en profitent sans y penser. */
  semerBruit(graine());
  viderGrille(); viderDecor(); viderVillages(); viderEdifices();
  libererTousLesPaves();
  monde.refuges.length = 0; monde.combustibles.length = 0;
  monde.leurres.length = 0; monde.sortie = null;

  if(importee.carte){
    yield {nom:'lecture de ta carte', part:0.20};
    batirDepuisCarte();
    yield {nom:'ouverture des volumes', part:0.35};
    calculerOuverture();
    poserPlafonds();
    quantifierRelief();
    majBornes();
    // pas de relaxation : ton relief reste le tien
  } else {
    yield {nom:'échantillonnage du terrain', part:0.30};
    creuserPlan();

    yield {nom:'relaxation de l’épine navigable', part:0.48};
    relaxerEpine();

    yield {nom:'ouverture des volumes', part:0.55};
    calculerOuverture();


    yield {nom:'gouffres et précipices', part:0.64};
    creuserGouffres(lights);

    yield {nom:'plafonds, falaises, bornes', part:0.68};
    finaliserRelief();
  }

  yield {nom:'passerelles suspendues', part:0.74};
  chrono.ponts = placerPonts(props);

  /* APRÈS les ponts : un pont relie déjà des morceaux, inutile d'y bâtir une
     rampe en plus. On analyse donc la connexité une fois le monde complet, et
     on ne comble que ce qui reste vraiment coupé. */
  yield {nom:'liaison des morceaux isolés', part:0.79};
  {
    const r = relierLeMonde(lights, props);
    chrono.rampes = r.rampes;
    chrono.galeries = r.galeries;
    chrono.morceaux = r.avant + ' → ' + r.apres;
    chrono.isoles = r.isoles;
  }

  yield {nom:'cachettes', part:0.77};
  placerCachettes(props);

  yield {nom:'villages engloutis', part:0.82};
  chrono.villages = placerVillages();

  /* Les cathédrales AVANT le décor : elles aplanissent le terrain et lèvent
     le plafond sur leur emprise, et il ne faut pas qu'un pilier semé se
     retrouve au milieu de la nef. */
  yield {nom:'cathédrales', part:0.86};
  chrono.edifices = placerEdifices();

  yield {nom:'décor', part:0.90};
  placerProps();

  yield {nom:'bois et fusées', part:0.93};
  placerBoisEtFusees();

  /* Les armes. `placerArmes` ne connaît pas la grille — il reçoit de quoi
     poser, pour rester utilisable par la forge et par les tests, où il n'y a
     pas de monde. */
  placerArmes((liste, combien, fabriquer) => {
    const S = SETUP.armes;
    for(let k=0; k<60000 && liste.length < combien; k++){
      const c = celluleLibre(ri), i = idx(c.x, c.z);
      if(blocked[i] || vide[i]) continue;
      const o = fabriquer(c2w(c.x), floorH[i] + 0.24, c2w(c.z));
      liste.push(o);

      /* UNE BALISE. Sans elle, une arme posée au sol est invisible : on ne
         voit qu'à 7,7 m et il y en a une tous les 15 000 m². Une lampe, elle,
         perce le brouillard bien au-delà de la distance à laquelle on
         distingue une surface. On aperçoit un reflet, on va voir.

         C'est le seul moyen honnête : le contraire serait de poser un
         marqueur sur la carte, ce qui transforme la découverte en course. */
      if(lights.length < SETUP.decor.maxLumieres)
        lights.push({x:o.x, y:o.y + 0.30, z:o.z,
                     c:[S.balise[0]*S.baliseGain, S.balise[1]*S.baliseGain,
                        S.balise[2]*S.baliseGain], ph: Math.random()*6.28});
    }
  });

  /* ── DERNIER CONTRÔLE DE PASSAGE ──
     Une seconde passe de perçage, APRÈS le décor. La première tourne avant
     que les éléments ne soient posés : villages, cachettes et décor peuvent
     ensuite reboucher un couloir et rouvrir des poches qu'on venait de
     relier. Mesuré : la passe unique laissait 2,7 morceaux significatifs
     inatteignables, dont 14 % de frontières condamnées par du décor.

     Elle est bornée par SETUP.relief.nbGaleries, donc elle ne peut pas
     transformer le monde en gruyère si la génération part de travers. */
  yield {nom:'dernier contrôle de passage', part:0.94};
  chrono.galeriesFinales = percerEnclaves();

  yield {nom:'objets et objectifs', part:0.96};
  if(H.placerObjets) H.placerObjets();

  yield {nom:'index de navigation', part:0.99};
  rebuildNavCost();
  indexerProps();

  chrono.duree = (performance.now() - chrono.debut) / 1000;
  yield {nom:'prêt', part:1.0};
}

/** Compteurs remplis pendant la génération. */
const chrono = {debut:0, duree:0, ponts:0, rampes:0, galeries:0, edifices:0,
                galeriesFinales:0, villages:0, morceaux:'', isoles:0};

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
    plan: planActif() ? plan.nom + ' (' + plan.zones.length + ' zones)' : 'procédural',
    /* Plus de « gain glouton » : la fusion a été retirée, elle perçait des
       fentes dans le sol. Voir l'en-tête de monde/maillage.js. */
    quadsSolPlafond: statsMaillage.quadsEmis,
    parois: statsMaillage.paroisEmises,
    lieux: salles.length,
    creuse: (releve.creux / (GW*GH) * 100).toFixed(1) + ' % de la planche',
    dehors: (releve.dehors / Math.max(1, releve.creux) * 100).toFixed(0)
          + ' % du creux est à ciel ouvert',
    marchesInfranchissables: releve.marches + (releve.saturee ? ' (RELAXATION SATURÉE)' : ''),
    terrainMs: releve.ms,
    poches: releve.poches + ' (' + releve.rebouchees + ' rebouchées, '
          + releve.reliees + ' reliées)',
    gouffres: gouffres.length,
    rampes: chrono.rampes,
    galeries: chrono.galeries + ' + ' + chrono.galeriesFinales + ' après décor',
    morceaux: chrono.morceaux,
    isoles: chrono.isoles,
    villages: chrono.villages,
    cathedrales: chrono.edifices,
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
