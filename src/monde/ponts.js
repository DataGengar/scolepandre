/* ═══ MONDE / PONTS ═══
   Passerelles suspendues. On enjambe les gouffres, on longe les grandes salles.

   Un pont suspendu, pas une dalle : le tablier fléchit en son milieu, deux
   câbles portent depuis les pylônes des extrémités, et des suspentes verticales
   descendent du câble au tablier.

   Chaque tronçon reçoit une échelle à chaque bout — sans quoi on aurait des
   étages qu'on ne peut pas atteindre, c'est-à-dire du décor.

   PRIORITÉ v3 : on tente D'ABORD un pont au-dessus de chaque gouffre creusé
   par monde/relief.js. Un gouffre non franchissable coupe la carte ; un
   gouffre avec un pont est un choix (le traverser ou le contourner).       */

import {SETUP} from '../setup.js';
import {rnd, ri} from '../noyau/rng.js';
import {
  GW, GH, CELL, floorH, ceilH, openN, pont, pontH, echelle, vide,
  idx, isFloor, celluleLibre,
} from './grille.js';
import {gouffres} from './relief.js';

/**
 * @param props  tableau du décor : chaque pont y pousse son maillage
 * @returns nombre de ponts posés
 */
export function placerPonts(props){
  const S = SETUP.relief;
  let poses = 0;

  // 1. un pont par gouffre, en priorité — c'est celui qui compte
  for(const g of gouffres){
    const horiz = g.rx >= g.rz;
    const demi = horiz ? g.rx : g.rz;
    const lon = demi*2 + 8;                       // on déborde des deux côtés
    const x0 = horiz ? g.x - demi - 4 : g.x;
    const z0 = horiz ? g.z : g.z - demi - 4;
    if(poserTroncon(props, x0, z0, lon, horiz, true)) poses++;
  }

  // 2. le reste au hasard, pour la verticalité générale
  // SETUP en mètres → cellules (cf. la même conversion dans relief.js)
  const LMIN = Math.round(S.pontLongMin / CELL);
  const LMAX = Math.round(S.pontLongMax / CELL);
  for(let essai=0; essai<20000 && poses < S.nbPonts; essai++){
    const c = celluleLibre(ri);
    if(poserTroncon(props, c.x, c.z, ri(LMIN,LMAX), rnd()<0.5, false)) poses++;
  }
  return poses;
}

/**
 * @param surGouffre  si vrai, on tolère que le tronçon survole du vide (c'est
 *                    le but) ; sinon il doit rester au-dessus de sol praticable.
 */
function poserTroncon(props, x0, z0, lon, horiz, surGouffre){
  let hmax = -1e9, appuis = 0;
  for(let k=0; k<lon; k++){
    const x = horiz ? x0+k : x0, z = horiz ? z0 : z0+k;
    if(x<1 || z<1 || x>=GW-1 || z>=GH-1) return false;
    const i = idx(x,z);
    if(pont[i]) return false;
    if(vide[i]){ if(!surGouffre) return false; continue; }
    if(!isFloor(x,z)) return false;
    if(!surGouffre && openN[i] < 0.42) return false;
    hmax = Math.max(hmax, floorH[i]);
    appuis++;
  }
  if(appuis < 4 || hmax === -1e9) return false;

  const H = hmax + SETUP.relief.pontTirantAir + rnd()*2.2;

  // le plafond doit laisser la place au tablier ET à toi dessus
  for(let k=0; k<lon; k++){
    const x = horiz ? x0+k : x0, z = horiz ? z0 : z0+k;
    const i = idx(x,z);
    if(vide[i]) continue;
    if(ceilH[i] < H + 2.3) return false;
  }

  const fleche = 1.4 + rnd()*1.6;
  const parts = [];
  const PX = k => horiz ? (x0+k+0.5)*CELL : (x0+0.5)*CELL;
  const PZ = k => horiz ? (z0+0.5)*CELL   : (z0+k+0.5)*CELL;
  const yTab = k => { const t = k/(lon-1); return H - Math.sin(t*Math.PI)*fleche; };
  const yCab = k => { const t = k/(lon-1); return H + 3.2 - Math.sin(t*Math.PI)*(fleche*0.35); };
  /* Le tablier fait EXACTEMENT une cellule de large, parce que c'est une
     cellule qui est marquée praticable (`pont[i]`). Un visuel de 2,4 m sur une
     bande jouable de 1,5 m donnait un pont où l'on tombait en marchant sur ce
     qu'on voyait — mesuré en test : 7 images sur le tablier avant la chute.
     Une passerelle d'un mètre cinquante au-dessus d'un gouffre sans fond est
     de toute façon le bon niveau de terreur. */
  const LARG = CELL * 1.02;

  for(let k=0; k<lon; k++){
    const x = horiz ? x0+k : x0, z = horiz ? z0 : z0+k;
    const i2 = idx(x,z);
    pont[i2] = 1; pontH[i2] = yTab(k);
    if(k===0 || k===lon-1) echelle[i2] = 1;

    // planches du tablier
    parts.push({x:PX(k), y:yTab(k), z:PZ(k),
                sx: horiz ? CELL*1.02 : LARG, sy:0.16, sz: horiz ? LARG : CELL*1.02,
                c:[.19,.16,.13]});
    // suspentes
    if(k % 2 === 0)
      for(const sd of [1,-1])
        parts.push({x:PX(k)+(horiz?0:sd*LARG*0.48), y:(yTab(k)+yCab(k))/2,
                    z:PZ(k)+(horiz?sd*LARG*0.48:0),
                    sx:.05, sy:yCab(k)-yTab(k), sz:.05, c:[.26,.24,.21]});
    // câble porteur, en petits tronçons
    if(k < lon-1)
      for(const sd of [1,-1])
        parts.push({x:(PX(k)+PX(k+1))/2 + (horiz?0:sd*LARG*0.48),
                    y:(yCab(k)+yCab(k+1))/2,
                    z:(PZ(k)+PZ(k+1))/2 + (horiz?sd*LARG*0.48:0),
                    sx: horiz?CELL:.09, sy:.09, sz: horiz?.09:CELL, c:[.30,.27,.23]});
  }
  // pylônes
  for(const k of [0, lon-1])
    for(const sd of [1,-1])
      parts.push({x:PX(k)+(horiz?0:sd*LARG*0.48), y:yTab(k)+2.1,
                  z:PZ(k)+(horiz?sd*LARG*0.48:0),
                  sx:.20, sy:4.2, sz:.20, c:[.24,.21,.18]});

  props.push({parts, cell: idx(x0,z0)});
  return true;
}
