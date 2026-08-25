/* ═══ MONDE / DESTRUCTION ═══
   Le plafond cède pour de bon.

   ── CE QUI EXISTAIT, ET POURQUOI ÇA NE COMPTAIT PAS ────────────────────────
   Il y avait déjà des « effondrements » : un grondement, un fracas, la caméra
   qui tremble, une vibration qui attire la mère, et — côté terrain —
   `effondrerZone()`, qui relevait le sol de quinze à cinquante centimètres.

   Autrement dit : tout le théâtre, et rien qui tombe. Le jeu promettait un
   événement et n'en tenait aucun. C'est exactement le genre de promesse non
   tenue qui apprend au joueur à ne plus faire attention.

   ── LES DEUX ISSUES ────────────────────────────────────────────────────────
   Un effondrement fait l'une ou l'autre, jamais un mélange :

     ÉBOULIS      le plafond descend, le sol monte, l'espace SE FERME. Un
                  passage disparaît. On doit contourner.
     TROU BÉANT   le sol cède. Une fosse s'ouvre, on y tombe, et il faut
                  désormais la franchir.

   Deux issues plutôt qu'une, parce qu'un événement qui fait toujours la même
   chose cesse d'être un événement au troisième. Et deux issues OPPOSÉES —
   l'une ferme, l'autre ouvre — pour qu'on ne sache jamais si l'on doit
   s'éloigner ou se réjouir.

   ── LA RÈGLE DU TROU ───────────────────────────────────────────────────────
   On ne perce JAMAIS dans un boyau. Un trou dans un couloir d'une cellule de
   large coupe la carte en deux, définitivement — il n'y a pas de générateur de
   ponts qui repasse après. Les trous ne s'ouvrent donc que dans les volumes
   dégagés, où l'on peut contourner. Dans un couloir, c'est un éboulis : ça
   bloque aussi, mais ça se contourne parce que le couloir menait quelque part.

   ── LE COÛT ────────────────────────────────────────────────────────────────
   Modifier le terrain oblige à remailler. On n'invalide QUE les pavés touchés,
   pas le monde entier : l'ancien code appelait `libererTousLesPaves()` après
   chaque effondrement, ce qui reconstruisait tout ce qui est en vue — une
   à deux secondes de gel, pour un événement censé faire sursauter.          */

import {SETUP} from '../setup.js';
import {rnd, ri, rf} from '../noyau/rng.js';
import {
  GW, GH, CELL, FLOOR, WALL,
  grid, floorH, ceilH, openN, blocked, sky, vide, biome, navCost,
  idx, isFloor, c2w, w2c,
} from './grille.js';
import {chOf, paves, libererPave, indexerProps} from './maillage.js';
import {addProp, props, lights} from './props.js';

/** Ce que le dernier effondrement a fait, pour le rapport et les tests. */
export const dernierEffondrement = {
  issue: null, cellules: 0, x: 0, z: 0, rayon: 0,
};

/**
 * Le plafond cède autour d'une cellule.
 *
 * @param cx,cz   le centre
 * @param rayon   en cellules
 * @param forcer  'eboulis' | 'trou' | null (on décide selon le lieu)
 * @returns {issue, cellules, mortelle:[{x,z}]}
 */
export function effondrer(cx, cz, rayon, forcer = null){
  const S = SETUP.destruction;
  if(!isFloor(cx, cz)) return {issue:null, cellules:0, zone:[]};

  /* ── quelle issue ? ──
     Un trou ne s'ouvre que dans un volume dégagé. Voir la règle du trou. */
  const degage = openN[idx(cx, cz)] >= S.ouvertureTrou;
  const issue = forcer
    || (degage && rnd() < S.partTrous ? 'trou' : 'eboulis');

  const zone = [];
  const pavesTouches = new Set();

  for(let z = cz - rayon; z <= cz + rayon; z++)
    for(let x = cx - rayon; x <= cx + rayon; x++){
      if(x < 2 || z < 2 || x >= GW-2 || z >= GH-2) continue;
      if(!isFloor(x, z)) continue;
      const d = Math.hypot(x - cx, z - cz);
      if(d > rayon) continue;
      const i = idx(x, z);
      if(vide[i]) continue;

      const t = 1 - d / rayon;            // 1 au centre, 0 au bord
      zone.push({x, z, i, t});
      pavesTouches.add(chOf(x, z));
    }

  if(!zone.length) return {issue:null, cellules:0, zone:[]};

  if(issue === 'trou') percer(zone, rayon);
  else                 ensevelir(zone);

  /* ── remailler, mais SEULEMENT ce qui a bougé ──
     Un effondrement touche trois ou quatre pavés. En libérer trois cents
     parce que c'est plus simple à écrire, c'est une seconde de gel sur un
     événement censé faire sursauter. */
  for(const k of pavesTouches) libererPave(k);
  // les pavés voisins aussi : leurs bords partagent des coins avec la zone
  for(const k of [...pavesTouches]){
    const px = k % Math.ceil(GW / SETUP.monde.pave);
    const pz = (k / Math.ceil(GW / SETUP.monde.pave)) | 0;
    for(const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const v = (pz+dz) * Math.ceil(GW / SETUP.monde.pave) + (px+dx);
      if(paves.has(v)) libererPave(v);
    }
  }
  indexerProps();

  dernierEffondrement.issue = issue;
  dernierEffondrement.cellules = zone.length;
  dernierEffondrement.x = c2w(cx);
  dernierEffondrement.z = c2w(cz);
  dernierEffondrement.rayon = rayon * CELL;

  return {issue, cellules: zone.length, zone};
}

/* ─────────────── ÉBOULIS : l'espace se ferme ─────────────── */

function ensevelir(zone){
  const S = SETUP.destruction;
  for(const {x, z, i, t} of zone){
    const espace = ceilH[i] - floorH[i];
    /* Le plafond descend et le sol monte. Au centre ils se rejoignent : la
       cellule devient de la roche, et c'est ce qui FERME le passage. Sur les
       bords, il reste un espace bas où l'on rampe. */
    const comble = espace * t * S.combleEboulis;
    floorH[i] += comble * 0.62;
    ceilH[i]  -= comble * 0.38;

    if(ceilH[i] - floorH[i] < S.hauteurMuree){
      grid[i] = WALL;                    // muré
      blocked[i] = 1;
      navCost[i] = 0;
    } else {
      // des gravats, là où il reste de la place
      if(rnd() < 0.35 * t) addProp('gravats', x, z, i);
    }
  }
}

/* ─────────────── TROU : le sol cède ─────────────── */

function percer(zone, rayon){
  const S = SETUP.destruction;
  for(const {x, z, i, t} of zone){
    if(t > S.partFond){
      /* Le cœur tombe : plus de sol du tout. C'est un vrai gouffre, avec la
         mécanique de chute qui existe déjà — on n'invente rien, on ouvre. */
      vide[i] = 1;
      blocked[i] = 0;
      navCost[i] = 0;
    } else {
      // la lèvre : elle s'affaisse et se couvre d'éboulis
      floorH[i] -= (t / S.partFond) * S.affaissementLevre;
      if(rnd() < 0.42) addProp('gravats', x, z, i);
    }
  }

  /* Une poussière lumineuse au fond, pour qu'on VOIE le trou avant d'y
     tomber. Sans elle, un gouffre neuf au milieu d'une salle qu'on
     traversait est un piège invisible, et un piège invisible n'est pas de la
     tension, c'est une injustice. */
  const c = zone[0];
  if(lights.length < SETUP.decor.maxLumieres)
    lights.push({x: c2w(c.x), y: floorH[c.i] - 2.0, z: c2w(c.z),
                 c: [0.30, 0.16, 0.09], ph: rnd()*6.28});
}

/* ─────────────── QUI EST DESSOUS ─────────────── */

/**
 * Un point est-il dans la zone d'un effondrement ?
 *
 * Sert au joueur comme aux créatures : ce qui tombe ne fait pas de
 * différence. La hauteur compte — être sur une passerelle au-dessus d'une
 * salle qui s'effondre, ce n'est pas être dedans.
 */
export function sousLEffondrement(wx, wz, gy){
  const d = dernierEffondrement;
  if(!d.issue) return false;
  if(Math.hypot(wx - d.x, wz - d.z) > d.rayon) return false;
  const i = idx(w2c(wx), w2c(wz));
  return Math.abs(gy - floorH[i]) < 6;
}
