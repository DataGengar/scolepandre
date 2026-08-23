/* ═══ MONDE / PONTS ═══
   Passerelles. On enjambe les gouffres — et rien d'autre.

   ── CE QUI N'ALLAIT PAS, ET POURQUOI ───────────────────────────────────────
   La version précédente posait le tablier à `max(sol) + 3,6 m` sur toute la
   longueur. Conséquence : aux DEUX BOUTS, le pont flottait à trois mètres
   cinquante au-dessus du sol, sans le moindre barreau visible. On y montait
   par une touche contextuelle sur une cellule unique, invisible, non signalée.
   Et 260 tronçons étaient posés au hasard, sans rien relier.

   Le verdict d'Orlando était exact et complet : « elles flottent, elles sont
   trop courtes, elles sont inaccessibles, on ne peut pas marcher dessus ».

   ── LA RÈGLE, MAINTENANT ───────────────────────────────────────────────────
   UN TABLIER COMMENCE ET FINIT AU NIVEAU DU SOL.

   Il part d'une culée en terre ferme, franchit le vide, et retombe sur une
   culée en terre ferme. Entre les deux il fléchit, sans jamais descendre sous
   la lèvre du gouffre. On y marche en marchant : pas d'échelle, pas de touche,
   pas d'étage à comprendre. On voit un pont, on avance, on est dessus.

   Et un pont n'existe que s'il FRANCHIT quelque chose. Plus de semis au
   hasard : chaque gouffre reçoit une traversée si la géométrie le permet, et
   c'est tout. Un pont qui ne relie rien n'est pas un pont, c'est un obstacle
   décoratif au-dessus du vide.

   ── DEUX CELLULES DE LARGE ─────────────────────────────────────────────────
   La v3 en faisait une (1,5 m), au motif que c'était plus terrifiant. Ça
   l'était surtout parce qu'on tombait en marchant droit. Trois mètres, c'est
   une passerelle qu'on emprunte au lieu de la subir — et un gouffre sans fond
   reste un gouffre sans fond.                                               */

import {SETUP} from '../setup.js';
import {rnd, ri, rf} from '../noyau/rng.js';
import {
  GW, GH, CELL, STEPUP, floorH, ceilH, openN, pont, pontH, vide,
  idx, isFloor,
} from './grille.js';
import {gouffres} from './relief.js';
import {autorise} from './plan.js';

/** Ce que la traversée d'un gouffre a donné, pour le rapport de génération. */
export const statsPonts = {tentes: 0, poses: 0, refusDenivele: 0,
                           refusCulee: 0, refusPlafond: 0, refusPlan: 0};

/**
 * @param props  tableau du décor : chaque pont y pousse son maillage
 * @returns nombre de ponts posés
 */
export function placerPonts(props){
  for(const k in statsPonts) statsPonts[k] = 0;

  /* On ne traverse QUE des gouffres. Les morceaux de monde séparés par une
     falaise sont l'affaire de monde/connexite.js, qui y taille un éboulis :
     une rampe de gravats est bien plus plausible qu'une passerelle suspendue
     entre deux corniches, et elle ne demande aucune règle nouvelle au joueur. */
  for(const g of gouffres){
    // on tente l'axe le plus court en premier : moins de portée, plus de chances
    const horizDabord = g.rx <= g.rz;
    if(traverser(props, g, horizDabord)) continue;
    traverser(props, g, !horizDabord);
  }
  return statsPonts.poses;
}

/**
 * Cherche une traversée d'un gouffre selon un axe, et la bâtit.
 *
 * @param horiz  vrai pour franchir selon X, faux selon Z
 */
function traverser(props, g, horiz){
  const S = SETUP.relief;
  const demi = horiz ? g.rx : g.rz;
  const portee = Math.round(S.pontPorteeMax / CELL);

  /* Plusieurs essais décalés le long du gouffre : sa lèvre est irrégulière, et
     l'endroit où les deux bords se font face à la même altitude n'est pas
     forcément en son milieu. */
  for(let essai = 0; essai < S.pontEssais; essai++){
    const decal = (essai === 0) ? 0 : ri(-demi, demi);
    const cx = horiz ? g.x : g.x + decal;
    const cz = horiz ? g.z + decal : g.z;

    statsPonts.tentes++;
    const t = chercherCulees(cx, cz, horiz, portee);
    if(!t) continue;
    if(batir(props, t, horiz)) return true;
  }
  return false;
}

/**
 * Depuis le centre du gouffre, marcher vers les deux bords jusqu'à retrouver
 * de la terre ferme. Renvoie les deux culées, ou null.
 */
function chercherCulees(cx, cz, horiz, portee){
  const pas = horiz ? 1 : GW;          // avancer d'une cellule sur l'axe
  const i0 = idx(cx, cz);
  if(!vide[i0]) return null;           // on ne part pas d'un gouffre : rien à franchir

  const bord = (sens) => {
    let i = i0, n = 0;
    while(n < portee){
      i += sens * pas; n++;
      const x = i % GW, z = (i / GW) | 0;
      if(x < 2 || z < 2 || x >= GW - 2 || z >= GH - 2) return null;
      if(vide[i]) continue;
      if(!isFloor(x, z)) return null;   // on a buté dans la roche, pas sur une rive
      return {i, x, z, n};
    }
    return null;
  };

  const a = bord(-1), b = bord(+1);
  if(!a || !b) { statsPonts.refusCulee++; return null; }

  /* La culée doit être un endroit où l'on tient debout, pas une aiguille. On
     recule d'une cellule de plus pour que le pont s'appuie sur du solide. */
  const dedans = (c, sens) => {
    const j = c.i + sens * pas;
    const x = j % GW, z = (j / GW) | 0;
    return isFloor(x, z) && !vide[j]
        && Math.abs(floorH[j] - floorH[c.i]) <= STEPUP;
  };
  if(!dedans(a, -1) || !dedans(b, +1)){ statsPonts.refusCulee++; return null; }

  return {a, b, longueur: a.n + b.n + 1};
}

/**
 * Pose le tablier entre deux culées.
 *
 * L'altitude va LINÉAIREMENT de `floorH[a]` à `floorH[b]`, moins une flèche
 * au milieu. C'est tout le changement par rapport à la v3, et c'est celui qui
 * rend le pont praticable : à chaque bout, la cote du tablier EST celle du
 * sol, donc on y marche sans rien faire.
 */
function batir(props, t, horiz){
  const S = SETUP.relief;
  const {a, b} = t;

  const hA = floorH[a.i], hB = floorH[b.i];
  if(Math.abs(hA - hB) > S.pontDeniveleMax){ statsPonts.refusDenivele++; return false; }

  const lon = t.longueur;
  const x0 = horiz ? a.x : a.x;
  const z0 = horiz ? a.z : a.z;
  const CX = k => horiz ? x0 + k : x0;
  const CZ = k => horiz ? z0 : z0 + k;

  if(!autorise('ponts', CX(0), CZ(0))){ statsPonts.refusPlan++; return false; }

  /* La flèche : un pont plat au-dessus d'un gouffre a l'air d'une dalle
     posée. Elle reste petite, et surtout on vérifie ensuite qu'elle ne
     descend pas sous la lèvre — un tablier qui plonge dans le trou serait
     pire que pas de pont du tout. */
  const fleche = Math.min(S.pontFlecheMax, lon * CELL * 0.035);
  const yTab = k => {
    const u = k / (lon - 1);
    return hA + (hB - hA) * u - Math.sin(u * Math.PI) * fleche;
  };

  // ── contrôles avant de rien écrire ──
  let libreMin = 1e9;
  for(let k = 0; k < lon; k++){
    const x = CX(k), z = CZ(k), i = idx(x, z);
    if(pont[i]) return false;                     // un tronçon passe déjà là
    const y = yTab(k);
    if(!vide[i]){
      // au-dessus de la terre ferme : il faut de la place sous le tablier ET
      // au-dessus, sinon on marche dans la roche
      if(y < floorH[i] - 0.05){ statsPonts.refusPlafond++; return false; }
      libreMin = Math.min(libreMin, ceilH[i] - y);
    }
  }
  if(libreMin < S.pontTeteMin){ statsPonts.refusPlafond++; return false; }

  // ── le tablier ──
  const LARG = SETUP.relief.pontLargeur;        // en cellules
  const cotes = [];
  for(let w = 0; w < LARG; w++) cotes.push(w - (LARG - 1) / 2);

  const parts = [];
  const PX = k => (CX(k) + 0.5) * CELL;
  const PZ = k => (CZ(k) + 0.5) * CELL;
  const DEMI = LARG * CELL / 2;

  for(let k = 0; k < lon; k++){
    const y = yTab(k);

    /* On marque TOUTE la largeur praticable. La v3 n'en marquait qu'une
       cellule alors qu'elle en dessinait davantage : on tombait en marchant
       sur ce qu'on voyait. Ce qui est dessiné et ce qui porte doivent être la
       même chose. */
    for(const d of cotes){
      const x = horiz ? CX(k) : CX(k) + Math.round(d);
      const z = horiz ? CZ(k) + Math.round(d) : CZ(k);
      if(x < 0 || z < 0 || x >= GW || z >= GH) continue;
      const i = idx(x, z);
      pont[i] = 1; pontH[i] = y;
    }

    // planches
    parts.push({x: PX(k), y, z: PZ(k),
                sx: horiz ? CELL * 1.02 : DEMI * 2,
                sy: 0.18,
                sz: horiz ? DEMI * 2 : CELL * 1.02,
                c: [.19, .16, .13]});

    /* Un garde-corps bas. Il n'arrête personne — on peut toujours tomber par
       le côté — mais il DIT que c'est une passerelle, et de loin dans la brume
       c'est la seule chose qui distingue un pont d'une dalle flottante. */
    if(k % 2 === 0){
      for(const sd of [1, -1]){
        const ox = horiz ? 0 : sd * DEMI * 0.92;
        const oz = horiz ? sd * DEMI * 0.92 : 0;
        parts.push({x: PX(k) + ox, y: y + 0.55, z: PZ(k) + oz,
                    sx: .07, sy: 1.1, sz: .07, c: [.24, .21, .18]});
      }
    }
    if(k % 2 === 0 && k < lon - 2){
      for(const sd of [1, -1]){
        const ox = horiz ? 0 : sd * DEMI * 0.92;
        const oz = horiz ? sd * DEMI * 0.92 : 0;
        parts.push({x: PX(k) + CELL * (horiz ? 1 : 0) + ox,
                    y: (yTab(k) + yTab(Math.min(lon - 1, k + 2))) / 2 + 1.05,
                    z: PZ(k) + CELL * (horiz ? 0 : 1) + oz,
                    sx: horiz ? CELL * 2.1 : .05, sy: .05,
                    sz: horiz ? .05 : CELL * 2.1, c: [.28, .25, .21]});
      }
    }

    // suspentes vers un câble porteur, au-dessus du vide seulement
    const i = idx(CX(k), CZ(k));
    if(vide[i] && k % 3 === 0){
      const hCab = 2.6;
      for(const sd of [1, -1]){
        const ox = horiz ? 0 : sd * DEMI * 0.92;
        const oz = horiz ? sd * DEMI * 0.92 : 0;
        parts.push({x: PX(k) + ox, y: y + hCab / 2, z: PZ(k) + oz,
                    sx: .05, sy: hCab, sz: .05, c: [.26, .24, .21]});
      }
    }
  }

  // pylônes aux culées, pour qu'on voie le pont arriver
  for(const k of [0, lon - 1])
    for(const sd of [1, -1]){
      const ox = horiz ? 0 : sd * DEMI * 0.92;
      const oz = horiz ? sd * DEMI * 0.92 : 0;
      parts.push({x: PX(k) + ox, y: yTab(k) + 1.9, z: PZ(k) + oz,
                  sx: .22, sy: 3.8, sz: .22, c: [.24, .21, .18]});
    }

  props.push({parts, cell: idx(CX(0), CZ(0))});
  statsPonts.poses++;
  return true;
}
