/* ═══ MONDE / VILLAGES ENGLOUTIS ═══
   « Placer des zones d'anciens villages dépeuplés car tous mangés, mais qui
   ont une safe zone et des trousses médicales épuisables. »

   ── CE QU'EST UN VILLAGE ───────────────────────────────────────────────────
   Un amas de maisons crevées, de voitures sur le flanc et de lampadaires dont
   deux sur trois marchent encore, disposé en couronne autour d'une PLACE
   BARRICADÉE. Rare — vingt-deux sur 1 632 m — mais on le voit venir de loin,
   parce que c'est la seule chose du monde qui produise autant de lumière.

   ── LA PLACE BARRICADÉE ────────────────────────────────────────────────────
   Ce n'est pas une zone magique : c'est un cercle de ferraille dressée et de
   braseros. La règle est simple et se tient :

     · la créature et les jeunes REFUSENT d'y entrer (creatures/mere.js et
       jeunes.js interrogent `dansSafe()`) ;
     · on s'y réchauffe presque comme à un brasero ;
     · il y a une à trois TROUSSES MÉDICALES, et elles sont épuisables : une
       fois prises, elles ne repoussent pas.

   Le prix est double : c'est fixe, donc il faut y retourner, et c'est éclairé,
   donc tout ce qui rôde sait exactement où c'est. Un village est un répit, pas
   une solution — comme les cachettes, mais à l'opposé : visible et confortable
   au lieu d'être invisible et misérable.                                     */

import {SETUP} from '../setup.js';
import {rnd, ri, rf} from '../noyau/rng.js';
import {
  GW, GH, CELL, FLOOR, grid, floorH, openN, blocked, biome, vide, sky,
  idx, inB, isFloor, isFree, c2w, celluleLibre,
} from './grille.js';
import {addProp, lights, props} from './props.js';
import {autorise} from './plan.js';

/** [{x, z, y, rayon, safe, trousses:[…]}] */
export const villages = [];

/** Les trousses médicales posées dans le monde. Épuisables. */
export const trousses = [];

/** Les fagots de bois au sol. */
export const bois = [];

/** Les fusées de détresse au sol. */
export const fusees = [];

export function placerVillages(){
  villages.length = 0; trousses.length = 0;
  const V = SETUP.villages;
  const RC = Math.round(V.rayon / CELL);        // rayon en cellules

  for(let essai=0; essai<40000 && villages.length < V.nombre; essai++){
    const c = celluleLibre(ri);
    const i0 = idx(c.x, c.z);
    // il faut de la place : un village dans un boyau n'a pas de sens
    if(openN[i0] < 0.58) continue;
    if(!autorise('villages', c.x, c.z)) continue;

    const wx = c2w(c.x), wz = c2w(c.z);
    if(villages.some(v => Math.hypot(v.x-wx, v.z-wz) < V.ecartMin)) continue;

    // la couronne doit être majoritairement du sol praticable
    let sol = 0, total = 0;
    for(let z=c.z-RC; z<=c.z+RC; z+=2) for(let x=c.x-RC; x<=c.x+RC; x+=2){
      total++;
      if(isFloor(x,z) && !vide[idx(x,z)]) sol++;
    }
    if(total === 0 || sol/total < 0.52) continue;

    const y = floorH[i0];
    const v = {x:wx, z:wz, y, rayon:V.rayon, safe:V.safeRayon, cell:i0,
               trousses:[], vu:false};

    batirVillage(v, c, RC);
    villages.push(v);
  }
  return villages.length;
}

function batirVillage(v, c, RC){
  const V = SETUP.villages;

  /* Les bâtiments, en couronne : on laisse la place centrale dégagée, sinon
     la safe zone serait un tas de gravats. */
  const poser = (kind, combien, dedansMin, dedansMax) => {
    for(let k=0; k<combien; k++){
      for(let essai=0; essai<40; essai++){
        const a = rnd()*6.283;
        const r = rf(dedansMin, dedansMax) * RC;
        const x = Math.round(c.x + Math.cos(a)*r), z = Math.round(c.z + Math.sin(a)*r);
        if(!isFloor(x,z)) continue;
        const i = idx(x,z);
        if(blocked[i] || vide[i]) continue;
        addProp(kind, x, z, i);
        break;
      }
    }
  };

  v.angleCabane = rnd()*6.283;
  poser('maison',     ri(...V.maisons),     0.40, 1.0);
  poser('carcasse',   ri(...V.carcasses),   0.30, 1.0);
  poser('lampadaire', ri(...V.lampadaires), 0.22, 0.9);

  /* ── LA BARRICADE ──
     Un anneau de ferraille dressée, ouvert en deux endroits pour qu'on puisse
     entrer. Elle ne bloque pas physiquement (on l'enjambe) : c'est un signal,
     et c'est ce que les créatures lisent. */
  const RS = Math.round(v.safe / CELL);
  const parts = [];
  const ouverture1 = rnd()*6.283, ouverture2 = ouverture1 + 3.14;
  for(let k=0; k<34; k++){
    const a = k/34*6.283;
    const dA1 = Math.abs(((a - ouverture1 + 9.42) % 6.283) - 3.14);
    const dA2 = Math.abs(((a - ouverture2 + 9.42) % 6.283) - 3.14);
    if(dA1 > 2.85 || dA2 > 2.85) continue;      // les deux portes
    const px = v.x + Math.cos(a)*v.safe, pz = v.z + Math.sin(a)*v.safe;
    const ht = rf(0.9, 1.8);
    parts.push({tube:[[px, v.y, pz], 0.07,
                      [px + rf(-0.3,0.3), v.y + ht, pz + rf(-0.3,0.3)], 0.04, 5],
                c:[0.20,0.13,0.10]});
    // des plaques de tôle entre les piquets, une fois sur deux
    if(rnd() < 0.5)
      parts.push({x:px, y:v.y + ht*0.45, z:pz, sx:0.9, sy:ht*0.7, sz:0.06,
                  c:[0.17,0.14,0.12], r:a});
  }

  /* Quatre braseros aux points cardinaux de la place : c'est eux qui font la
     lumière du village, et c'est eux qui réchauffent. */
  for(let k=0;k<4;k++){
    const a = k/4*6.283 + 0.78;
    const px = v.x + Math.cos(a)*v.safe*0.72, pz = v.z + Math.sin(a)*v.safe*0.72;
    parts.push({x:px, y:v.y+0.35, z:pz, sx:1.0, sy:0.7, sz:1.0, c:[0.18,0.15,0.13]});
    parts.push({x:px, y:v.y+0.82, z:pz, sx:0.7, sy:0.5, sz:0.7,
                c:[2.8,1.35,0.40], emis:1});
    for(let q=0;q<3;q++)
      if(lights.length < SETUP.decor.maxLumieres)
        lights.push({x:px, y:v.y+0.9+q*0.9, z:pz, c:[2.1,0.95,0.32], ph:q*1.3+k});
  }
  props.push({parts, cell:v.cell});

  /* ── LA CABANE ──
     « Toujours une zone / cabane / maison où se restaurer complètement et en
     sécurité. » Une baraque de tôle au centre de la place, porte ouverte. À
     l'intérieur, la chaleur ET la santé remontent jusqu'au maximum — c'est le
     seul endroit du monde où l'on récupère vraiment, sans consommer de
     ressource. Elle est fixe : le prix, c'est le trajet. */
  {
    const cs = Math.cos(v.angleCabane), sn = Math.sin(v.angleCabane);
    const cx2 = v.x + cs*v.safe*0.30, cz2 = v.z + sn*v.safe*0.30;
    v.cabane = {x:cx2, z:cz2, r:2.6};
    const mur = [0.21,0.19,0.17], tole = [0.16,0.15,0.14];
    const L2 = 4.0, P2 = 3.4, H2 = 2.5;
    // trois murs pleins, le quatrième percé d'une porte
    for(let k=0;k<4;k++){
      const a = k*1.5708 + v.angleCabane;
      const px = cx2 + Math.cos(a)*P2*0.5, pz = cz2 + Math.sin(a)*P2*0.5;
      if(k === 0){                       // la façade : deux jambages
        for(const sd of [1,-1])
          parts.push({x:px + Math.cos(a+1.5708)*1.3*sd, y:v.y+H2*0.5,
                      z:pz + Math.sin(a+1.5708)*1.3*sd,
                      sx:1.3, sy:H2, sz:0.22, c:mur, r:a});
        parts.push({x:px, y:v.y+H2-0.25, z:pz, sx:L2, sy:0.5, sz:0.22, c:mur, r:a});
      } else {
        parts.push({x:px, y:v.y+H2*0.5, z:pz, sx:L2, sy:H2, sz:0.24, c:mur, r:a});
      }
    }
    // le toit, en tôle, légèrement de travers
    parts.push({x:cx2, y:v.y+H2+0.12, z:cz2, sx:L2+0.6, sy:0.22, sz:P2+0.6,
                c:tole, r:v.angleCabane+0.05});
    // une lanterne à l'intérieur : on doit la voir depuis la place
    parts.push({x:cx2, y:v.y+H2-0.45, z:cz2, sx:0.26, sy:0.30, sz:0.26,
                c:[2.6,2.2,1.3], emis:1});
    if(lights.length < SETUP.decor.maxLumieres)
      lights.push({x:cx2, y:v.y+1.5, z:cz2, c:[1.9,1.6,1.0], ph:rnd()*6.28});
  }

  /* ── LES TROUSSES ──
     Sur la place, bien visibles, en nombre limité. Elles ne repoussent pas :
     c'est ce qui fait qu'on compte ses passages. */
  const n = ri(...V.trousses);
  for(let k=0;k<n;k++){
    const a = rnd()*6.283, r = rnd()*v.safe*0.6;
    const t = {x: v.x + Math.cos(a)*r, y: v.y + 0.4, z: v.z + Math.sin(a)*r, prise:false};
    trousses.push(t); v.trousses.push(t);
    if(lights.length < SETUP.decor.maxLumieres)
      lights.push({x:t.x, y:t.y+0.3, z:t.z, c:[0.30,1.0,0.55], ph:rnd()*6.28});
  }

  // du bois empilé contre les maisons : c'est là qu'on vient s'approvisionner
  const nb = ri(...V.boisParVillage);
  for(let k=0;k<nb;k++){
    const a = rnd()*6.283, r = rf(0.35, 0.95)*v.rayon;
    bois.push({x: v.x + Math.cos(a)*r, y: v.y + 0.22, z: v.z + Math.sin(a)*r, pris:false});
  }
}

/* ═══ DÉCOUVERTE ═══
   « Les villages sont des zones mortes donc pas besoin de les voir, et il n'y a
   aucune raison de savoir où ils sont initialement. Par contre une fois
   découvert on peut faire qu'il y a un beacon pour le retrouver sur la carte. »

   Exactement ça : rien sur le sismographe au départ. On entre une fois dans la
   place barricadée, le village est marqué, et il le reste — sauvegardé par
   graine de monde, comme les pancartes. Le repérage se mérite.               */

const CLE_VUS = 'scolopandre.villages.v1';
let graineCourante = 0;

export function chargerVillagesVus(graine){
  graineCourante = graine >>> 0;
  for(const v of villages) v.vu = false;
  try{
    const tout = JSON.parse(localStorage.getItem(CLE_VUS) || '{}');
    const lot = tout[graineCourante] || [];
    for(const [x, z] of lot){
      const v = villages.find(w => Math.abs(w.x-x) < 2 && Math.abs(w.z-z) < 2);
      if(v) v.vu = true;
    }
  }catch(e){}
}

function enregistrerVus(){
  try{
    const tout = JSON.parse(localStorage.getItem(CLE_VUS) || '{}');
    tout[graineCourante] = villages.filter(v => v.vu)
                                   .map(v => [Math.round(v.x), Math.round(v.z)]);
    const cles = Object.keys(tout);
    if(cles.length > 8) for(const k of cles.slice(0, cles.length-8)) delete tout[k];
    localStorage.setItem(CLE_VUS, JSON.stringify(tout));
  }catch(e){}
}

/**
 * Appelé quand le joueur est dans une place. Renvoie le village s'il vient
 * d'être découvert (donc une seule fois), null sinon.
 */
export function marquerDecouvert(v){
  if(!v || v.vu) return null;
  v.vu = true;
  enregistrerVus();
  return v;
}

/** Es-tu dans la place barricadée d'un village ? Renvoie le village, ou null. */
export function dansSafe(x, z){
  for(const v of villages)
    if(Math.hypot(v.x - x, v.z - z) < v.safe) return v;
  return null;
}

/** Es-tu DANS la cabane ? C'est là qu'on se restaure complètement. */
export function dansCabane(x, z){
  for(const v of villages)
    if(v.cabane && Math.hypot(v.cabane.x - x, v.cabane.z - z) < v.cabane.r) return v;
  return null;
}

/* ─────────────── bois et fusées répartis dans tout le monde ─────────────── */

export function placerBoisEtFusees(){
  const F = SETUP.feu;
  // le bois du monde s'ajoute à celui des villages, déjà posé
  for(let k=0; k<30000 && bois.length < F.nbBois; k++){
    const c = celluleLibre(ri), i = idx(c.x, c.z);
    if(blocked[i]) continue;
    bois.push({x:c2w(c.x), y:floorH[i]+0.22, z:c2w(c.z), pris:false});
  }
  fusees.length = 0;
  for(let k=0; k<20000 && fusees.length < F.nbFusees; k++){
    const c = celluleLibre(ri), i = idx(c.x, c.z);
    if(blocked[i]) continue;
    fusees.push({x:c2w(c.x), y:floorH[i]+0.3, z:c2w(c.z), prise:false});
  }
}

export function viderVillages(){
  villages.length = 0; trousses.length = 0; bois.length = 0; fusees.length = 0;
}
