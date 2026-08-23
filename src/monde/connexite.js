/* ═══ MONDE / CONNEXITÉ ═══
   Trouve les morceaux du monde qui sont COUPÉS les uns des autres, et n'y
   place des rampes que là où elles servent réellement à quelque chose.

   ── POURQUOI LES RAMPES NE MARCHAIENT PAS ──────────────────────────────────
   Retour de test : « les plateformes sont un peu placées au hasard, elles sont
   inaccessibles et ne mènent nulle part ».

   C'était littéralement le cas. La version précédente tirait une cellule AU
   HASARD, regardait si elle avait par chance un voisin plus bas, et y bâtissait
   un escalier. Elle ne se demandait jamais si cette falaise SÉPARAIT quoi que
   ce soit. Sur ~140 rampes posées, la quasi-totalité tombait donc sur des
   arêtes déjà contournables — un escalier au milieu de nulle part, montant vers
   un endroit qu'on pouvait déjà atteindre par le côté.

   ── CE QU'ON FAIT À LA PLACE ───────────────────────────────────────────────
   1. On calcule les COMPOSANTES CONNEXES du sol praticable, avec la vraie règle
      du joueur : on ne relie deux cellules voisines que si la marche entre
      elles est franchissable DANS LES DEUX SENS. Une corniche dont on peut
      sauter mais pas remonter n'est donc PAS une liaison.
   2. On trie les composantes par taille. La plus grande est le continent.
   3. Pour chaque autre composante d'une taille qui compte, on cherche le point
      de sa frontière où la marche vers une composante déjà reliée est la PLUS
      FAIBLE — le franchissement le moins cher.
   4. On y taille un escalier d'éboulis, et on fusionne les deux composantes.

   Résultat : chaque rampe RELIE deux morceaux du monde qui étaient coupés, et
   il n'y en a aucune qui ne mène nulle part. Il y en a beaucoup moins qu'avant
   — trente ou quarante au lieu de cent quarante — et c'est exactement le but.

   Le même calcul sert à repérer les morceaux séparés par du VIDE, que seul un
   pont peut atteindre : monde/ponts.js s'en sert pour prioriser ses tronçons. */

import {SETUP} from '../setup.js';
import {rnd, ri, rf} from '../noyau/rng.js';
import {BIOMES} from './biomes.js';
import {
  GW, GH, CELL, FLOOR, STEPUP,
  grid, floorH, ceilH, blocked, vide, platform, falaise, biome, pont,
  idx, isFloor,
} from './grille.js';

const N = () => GW * GH;

/** Numéro de composante par cellule, −1 si la cellule n'est pas praticable. */
export const composante = new Int32Array(GW * GH);

/** [{id, taille, cellule}] trié par taille décroissante. */
export const morceaux = [];

/* Praticable pour le JOUEUR : du sol, pas d'élément massif, pas de vide —
   OU un tablier, qui porte au-dessus du vide et relie ses deux rives.
   L'oublier faisait tailler des rampes pour franchir des gouffres qu'un pont
   enjambait déjà. */
const praticable = i =>
  pont[i] || (grid[i] === FLOOR && !blocked[i] && !vide[i]);

/* Deux cellules voisines sont reliées si la marche passe DANS LES DEUX SENS.
   C'est la nuance qui compte : une corniche d'où l'on saute sans pouvoir
   remonter ne relie rien, et c'est précisément ce qu'une rampe doit réparer. */
const relie = (a, b) => Math.abs(floorH[a] - floorH[b]) <= STEPUP;

/**
 * Étiquette toutes les composantes connexes. Parcours en largeur avec une file
 * plate : sur 1,18 M de cellules une récursion exploserait la pile.
 */
export function analyser(){
  const n = N();
  composante.fill(-1);
  morceaux.length = 0;

  const file = new Int32Array(n);
  let id = 0;

  for(let depart=0; depart<n; depart++){
    if(composante[depart] !== -1 || !praticable(depart)) continue;

    let tete = 0, queue = 0;
    file[queue++] = depart;
    composante[depart] = id;
    let taille = 0;

    while(tete < queue){
      const i = file[tete++];
      taille++;
      const x = i % GW, z = (i / GW) | 0;
      if(x < 1 || z < 1 || x >= GW-1 || z >= GH-1) continue;
      for(const d of [1, -1, GW, -GW]){
        const j = i + d;
        if(composante[j] !== -1 || !praticable(j) || !relie(i, j)) continue;
        composante[j] = id;
        file[queue++] = j;
      }
    }
    morceaux.push({id, taille, cellule: depart});
    id++;
  }

  morceaux.sort((a, b) => b.taille - a.taille);
  return morceaux;
}

/**
 * Toutes les frontières entre deux composantes différentes : les endroits où
 * une rampe aurait un sens. On ne garde que la marche la plus faible par paire
 * de composantes — inutile de proposer dix passages au même endroit.
 *
 * @returns Map "a|b" -> {a, b, haut, bas, chute, dir}
 */
function frontieres(){
  const best = new Map();
  for(let z=2; z<GH-2; z++) for(let x=2; x<GW-2; x++){
    const i = idx(x, z);
    const ca = composante[i];
    if(ca < 0) continue;
    for(const [dx, dz] of [[1,0],[0,1]]){
      const j = idx(x+dx, z+dz);
      const cb = composante[j];
      if(cb < 0 || cb === ca) continue;

      const haut = floorH[i] >= floorH[j] ? i : j;
      const bas  = haut === i ? j : i;
      const chute = floorH[haut] - floorH[bas];
      // trop haut pour un escalier : c'est un pont qu'il faudrait
      if(chute > SETUP.relief.rampeChuteMax) continue;

      const cle = ca < cb ? ca + '|' + cb : cb + '|' + ca;
      const vieux = best.get(cle);
      if(vieux && vieux.chute <= chute) continue;
      // direction du haut vers le bas, en cardinal
      const dir = haut === i ? [dx, dz] : [-dx, -dz];
      best.set(cle, {a: ca, b: cb, haut, bas, chute, dir});
    }
  }
  return best;
}

/**
 * Taille un escalier d'éboulis depuis le pied de la falaise.
 *
 * On ne CREUSE jamais : on RELÈVE des cellules de sol déjà praticables du côté
 * bas. Une rampe ne peut donc pas ouvrir un passage qui n'existait pas dans le
 * plan, seulement rendre franchissable une marche qui ne l'était pas.
 *
 * @returns true si l'escalier a pu être bâti
 */
function tailler(f, lights, props){
  const MARCHE = STEPUP - 0.08;
  const marches = Math.max(1, Math.ceil(f.chute / MARCHE));
  const [dx, dz] = f.dir;                    // du haut vers le bas
  const hx = f.haut % GW, hz = (f.haut / GW) | 0;
  const hHaut = floorH[f.haut];

  // largeur perpendiculaire : une rampe d'une seule cellule est introuvable
  const px = dz, pz = dx;
  const DEMI = 1;

  /* Toutes les cellules du couloir doivent déjà être du sol, libres de pont, et
     appartenir au côté BAS. Sinon on renonce : mieux vaut pas de rampe qu'une
     rampe qui traverse une paroi. */
  for(let k=1; k<=marches; k++)
    for(let s=-DEMI; s<=DEMI; s++){
      const cx = hx + dx*k + px*s, cz = hz + dz*k + pz*s;
      if(!isFloor(cx, cz)) return false;
      const c = idx(cx, cz);
      if(pont[c] || vide[c] || blocked[c]) return false;
    }

  // les marches, de la plus haute (contre la falaise) à la plus basse
  const touchees = [];
  for(let k=1; k<=marches; k++){
    const y = hHaut - (f.chute * k / (marches + 1));
    for(let s=-DEMI; s<=DEMI; s++){
      const cx = hx + dx*k + px*s, cz = hz + dz*k + pz*s;
      const c = idx(cx, cz);
      if(floorH[c] >= y) continue;           // déjà plus haut : on n'abaisse pas
      floorH[c] = y;
      platform[c] = 1;
      falaise[c] = 0;                        // ce n'est plus une arête franche
      touchees.push({x:cx, z:cz, i:c, y});
    }
  }
  if(!touchees.length) return false;

  /* Ça doit SE LIRE comme un pan de paroi effondré, pas comme un escalier de
     jardin. Des gravats sur les bords des marches, et deux repères lumineux —
     une rampe qu'on ne voit pas dans la brume est une rampe inutile. */
  const teinte = BIOMES[biome[f.haut]].lum;
  const parts = [];
  for(const t of touchees){
    if(rnd() > 0.55) continue;
    const wx = (t.x + 0.5)*CELL, wz = (t.z + 0.5)*CELL;
    for(let q=0; q<2; q++){
      const s = rf(0.18, 0.44);
      parts.push({x: wx + rf(-0.6,0.6), y: t.y + s*0.4, z: wz + rf(-0.6,0.6),
                  sx:s, sy:s*rf(0.5,0.9), sz:s*rf(0.7,1.1),
                  c: BIOMES[biome[t.i]].wall, r: rf(0,3)});
    }
  }
  if(parts.length) props.push({parts, cell: f.haut});

  for(const [cx, cz, cy] of [
        [hx, hz, hHaut],
        [hx + dx*marches, hz + dz*marches, floorH[f.bas]]]){
    if(lights.length >= SETUP.decor.maxLumieres) break;
    lights.push({
      x:(cx+0.5)*CELL, y:cy+0.8, z:(cz+0.5)*CELL,
      c:[teinte[0]*1.8, teinte[1]*1.3, teinte[2]*0.9], ph:rnd()*6.28,
    });
  }
  return true;
}

/**
 * Le travail complet : analyser, relier, recommencer tant qu'on progresse.
 *
 * @returns {rampes, avant, apres, isoles} — de quoi juger si ça a marché
 */
export function relierLeMonde(lights, props){
  const S = SETUP.relief;
  let rampes = 0;

  analyser();
  const avant = morceaux.length;

  for(let passe = 0; passe < S.rampePasses; passe++){
    const fr = frontieres();
    if(!fr.size) break;

    /* On traite les franchissements les moins chers d'abord : ils sont les plus
       plausibles physiquement (un petit éboulis) et les plus sûrs à bâtir. */
    const liste = [...fr.values()].sort((a, b) => a.chute - b.chute);

    // taille de chaque composante, pour ignorer les miettes
    const taille = new Map();
    for(const m of morceaux) taille.set(m.id, m.taille);

    let posees = 0;
    for(const f of liste){
      if(rampes >= S.nbRampes) break;
      const ta = taille.get(f.a) || 0, tb = taille.get(f.b) || 0;
      // relier deux cailloux entre eux n'intéresse personne
      if(Math.max(ta, tb) < S.rampeTailleMin) continue;
      if(Math.min(ta, tb) < S.rampeTailleMin && Math.min(ta, tb) < 40) continue;
      if(tailler(f, lights, props)){ rampes++; posees++; }
    }
    if(!posees) break;
    analyser();                              // la topologie a changé
  }

  /* Les rampes ne savent franchir qu'un dénivelé. Ce qui reste isolé l'est
     surtout par de la ROCHE — mesuré : 60 % des frontières de poche. On
     perce. */
  const galeries = percerEnclaves();

  analyser();
  const apres = morceaux.length;
  const isoles = morceaux.filter(m => m.taille >= S.rampeTailleMin).length;
  return {rampes, galeries, avant, apres, isoles};
}

/* ═══════════════ PERCER LES ENCLAVES ═══════════════

   ── LE CONSTAT ─────────────────────────────────────────────────────────────
   Après les rampes, il restait en moyenne quatre morceaux significatifs
   inatteignables. `outils/diag_passage.py` a dit pourquoi, en longeant leurs
   frontières :

       roche non creusée   60 %
       falaise             15 %
       élément de décor    15 %
       gouffre             10 %

   Ce ne sont donc ni les ponts ni le décor : ce sont des poches que le
   creusement a ouvertes sans jamais les raccorder. Aucune rampe ne peut rien
   pour elles — il n'y a pas de dénivelé à franchir, il y a un mur.

   ── LA MÉTHODE ─────────────────────────────────────────────────────────────
   Un seul parcours en largeur depuis TOUTE la composante principale à la
   fois, qui se propage à travers la roche en retenant d'où il vient. Chaque
   poche isolée n'a plus qu'à remonter cette chaîne jusqu'au monde connu, et
   on creuse le long du chemin.

   Une seule passe pour toutes les poches, au lieu d'une recherche par poche :
   sur 1,18 M de cellules, la différence n'est pas cosmétique.

   ── CE QU'ON CREUSE ────────────────────────────────────────────────────────
   Une galerie d'une cellule, basse. L'altitude est interpolée entre les deux
   bouts, ce qui rabote au passage la falaise qui aurait pu s'y trouver ; et
   un élément qui condamnait la cellule est simplement libéré. La même passe
   règle donc les trois causes sur quatre.

   Ce n'est pas un couloir décoré : c'est une fissure. Elle a exactement le
   rôle qu'elle doit avoir — dire « on peut passer par là », sans promettre
   que ce soit agréable.                                                     */

export function percerEnclaves(){
  const S = SETUP.relief;
  const n = N();

  analyser();
  if(morceaux.length < 2) return 0;

  // la plus grande composante est la référence : c'est « le monde »
  const principale = morceaux[0].id;

  /* Les poches qui méritent une galerie. On ignore les miettes : creuser
     jusqu'à une alcôve de trente cellules coûte le même travail et n'ouvre
     rien. */
  const aRelier = morceaux.filter(m => m.id !== principale
                                    && m.taille >= S.enclaveTailleMin);
  if(!aRelier.length) return 0;

  /* ── parcours en largeur depuis toute la composante principale ──
     `venuDe[i]` retient la cellule d'où l'on est arrivé en i : c'est ce qui
     permet de rebrousser chemin sans refaire de recherche. */
  const venuDe = new Int32Array(n).fill(-1);
  const vu = new Uint8Array(n);
  const file = new Int32Array(n);
  let tete = 0, queue = 0;

  for(let i = 0; i < n; i++)
    if(composante[i] === principale){ vu[i] = 1; file[queue++] = i; }

  const pousser = (de, vers) => {
    if(vu[vers]) return;
    if(vide[vers]) return;                 // on ne perce pas au-dessus du vide
    vu[vers] = 1; venuDe[vers] = de; file[queue++] = vers;
  };

  while(tete < queue){
    const c = file[tete++];
    const x = c % GW, z = (c / GW) | 0;
    if(x > 1)      pousser(c, c - 1);
    if(x < GW - 2) pousser(c, c + 1);
    if(z > 1)      pousser(c, c - GW);
    if(z < GH - 2) pousser(c, c + GW);
  }

  /* ── pour chaque poche, la cellule la plus proche du monde ── */
  let galeries = 0;
  for(const m of aRelier){
    if(galeries >= S.nbGaleries) break;

    // on cherche, dans la poche, la cellule que le parcours a atteinte
    let depart = -1;
    for(let i = 0; i < n; i++){
      if(composante[i] !== m.id || !vu[i]) continue;
      depart = i; break;
    }
    if(depart < 0) continue;               // poche murée par du vide : tant pis

    if(creuserGalerie(depart, venuDe)) galeries++;
  }
  return galeries;
}

/** Remonte la chaîne `venuDe` depuis `depart` et creuse tout du long. */
function creuserGalerie(depart, venuDe){
  const chemin = [];
  let c = depart, garde = 0;
  while(c >= 0 && garde++ < 4000){
    chemin.push(c);
    c = venuDe[c];
  }
  if(chemin.length < 2) return false;

  const hA = floorH[chemin[0]];
  const hB = floorH[chemin[chemin.length - 1]];

  for(let k = 0; k < chemin.length; k++){
    const i = chemin[k];
    const u = k / (chemin.length - 1);
    // interpolation : la galerie rabote la falaise qu'elle traverse
    const y = hA + (hB - hA) * u;
    grid[i] = FLOOR;
    floorH[i] = y;
    blocked[i] = 0;                         // un élément qui condamnait cède
    if(ceilH[i] < y + 2.0) ceilH[i] = y + 2.0;
  }
  return true;
}
