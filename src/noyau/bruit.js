/* ═══ NOYAU / BRUIT ═══
   Les champs continus dont le terrain est fait. Rien d'autre : ce module ne
   connaît ni la grille, ni les biomes, ni le jeu.

   ── POURQUOI IL EXISTE ─────────────────────────────────────────────────────
   Jusqu'en v4 le monde était CREUSÉ : des rectangles, des blobs et des
   couloirs en L posés sur une planche de roche pleine. Ça se voit — un couloir
   en L a deux angles droits, une salle a quatre coins, et l'œil lit la règle
   avant de lire le lieu. Un terrain procédural ne se creuse pas, il
   s'ÉVALUE : en tout point, une fonction dit à quelle altitude est le sol et
   s'il y a de la roche. C'est ce que fournissent ces quelques fonctions.

   ── LES TROIS OUTILS ───────────────────────────────────────────────────────
     perlin2   bruit à gradients, [−1,1]. La brique de base : lisse, sans
               direction privilégiée, et surtout SANS la trame carrée qu'un
               bruit de valeur laisse toujours transparaître.
     fbm2      somme d'octaves. Le relief : grandes formes, puis les détails.
     crete2    bruit « de crête » (ridged), [0,1]. Sa particularité est de
               produire des LIGNES continues là où fbm produit des taches :
               c'est ce qui donne des galeries qui serpentent et se croisent
               au lieu d'un fromage à trous.

   Plus `deformer()` : on ne demande pas la valeur en (x,z) mais en un point
   lui-même déplacé par du bruit. C'est le domain warping, et c'est le seul
   procédé qui, à si peu de frais, fait passer un champ de « bruit d'ordinateur »
   à « géologie » — les couches se plissent, les vallées serpentent, les crêtes
   se tordent au lieu de partir droit.

   ── DÉTERMINISME ───────────────────────────────────────────────────────────
   Tout passe par un hachage entier de la graine : même graine, même monde, au
   bit près, sans stocker la moindre table. `semerBruit()` est appelée par
   monde/index.js juste après `semer()`.                                     */

/* Graine courante du champ. Multipliée dans le hachage, jamais additionnée :
   deux graines voisines doivent donner deux mondes sans aucune parenté. */
let GRAINE = 0x9e3779b9;

/** Fixe la graine des champs. À appeler avant toute génération. */
export function semerBruit(g){
  // Un entier impair, jamais 0 : le hachage perdrait sa dispersion.
  GRAINE = (((g >>> 0) * 2654435761) | 1) >>> 0;
}

/** La graine effective — utile aux tests qui veulent rejouer un champ. */
export const graineBruit = () => GRAINE;

/* ─────────────── le hachage ─────────────── */

/* Entier 32 bits bien mélangé à partir de deux entiers et de la graine.
   Math.imul est ce qui rend la multiplication 32 bits exacte en JavaScript :
   sans lui, les produits dépassent 2^53 et les bits de poids faible — les
   seuls qui nous intéressent — sont faux. */
function hachage(x, z){
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ GRAINE;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/* Les huit directions du gradient. Un jeu réduit et régulier vaut mieux qu'un
   angle tiré au hasard : c'est plus rapide, et ça ne fait apparaître aucune
   direction privilégiée tant que le hachage est bon. */
const GX = [ 1, -1, 0,  0,  0.7071, -0.7071,  0.7071, -0.7071];
const GZ = [ 0,  0, 1, -1,  0.7071,  0.7071, -0.7071, -0.7071];

/* Lissage quintique : dérivées première ET seconde nulles aux nœuds. La
   version cubique laisse une grille visible en éclairage rasant, ce qui est
   exactement notre cas — un souterrain éclairé par une lampe torche. */
const fondu = t => t*t*t*(t*(t*6 - 15) + 10);

/**
 * Bruit à gradients en deux dimensions. Renvoie environ [−1, 1] (l'amplitude
 * théorique est ±0,707 pour ce jeu de gradients : elle est remise à l'échelle
 * ici pour que l'appelant n'ait pas à le savoir).
 */
export function perlin2(x, z){
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const u = fondu(fx), v = fondu(fz);

  const h00 = hachage(x0,   z0  ) & 7;
  const h10 = hachage(x0+1, z0  ) & 7;
  const h01 = hachage(x0,   z0+1) & 7;
  const h11 = hachage(x0+1, z0+1) & 7;

  const n00 = GX[h00]*fx       + GZ[h00]*fz;
  const n10 = GX[h10]*(fx-1)   + GZ[h10]*fz;
  const n01 = GX[h01]*fx       + GZ[h01]*(fz-1);
  const n11 = GX[h11]*(fx-1)   + GZ[h11]*(fz-1);

  const a = n00 + u*(n10 - n00);
  const b = n01 + u*(n11 - n01);
  return (a + v*(b - a)) * 1.4142;
}

/* ── POURQUOI CE FACTEUR ──
   Une somme d'octaves normalisée par la somme des poids tient dans [−1,1],
   mais elle ne les REMPLIT pas : mesuré sur 40 000 points, l'écart-type vaut
   0,20 et la valeur extrême 0,55. Un appelant qui écrit « amplitude : 24 m »
   obtenait donc un relief à ±5 m, et se demandait pourquoi son monde était
   plat. C'est exactement ce qui est arrivé à la première version du terrain
   v5.

   fbm2 est donc CALIBRÉ : on divise par l'écart-type mesuré, si bien que la
   sortie a un écart-type de 1. Un appelant multiplie alors par des mètres, et
   lit son réglage comme une amplitude typique — les crêtes montant à deux ou
   trois fois cette valeur, comme dans n'importe quel relief. */
const SIGMA = 0.202;

/**
 * Somme d'octaves. `oct` octaves, chacune deux fois plus fine et `gain` fois
 * moins forte. Calibré : écart-type 1, extrêmes autour de ±2,8.
 *
 * Le décalage de 137,17 entre octaves n'est pas décoratif : sans lui toutes
 * les octaves partagent le nœud (0,0), et il apparaît au centre du monde une
 * étoile de symétrie qu'on ne voit jamais ailleurs.
 */
export function fbm2(x, z, oct = 4, gain = 0.5){
  let somme = 0, ampl = 1, total = 0, fx = x, fz = z;
  for(let o = 0; o < oct; o++){
    somme += perlin2(fx, fz) * ampl;
    total += ampl;
    ampl *= gain;
    fx = fx*2 + 137.17; fz = fz*2 - 91.31;
  }
  return somme / total / SIGMA;
}

/**
 * Bruit de crête. `1 − |perlin|` porté au carré : les zéros du bruit — qui
 * forment des LIGNES continues dans le plan — deviennent des maxima. D'où des
 * arêtes, des failles, des veines. Renvoie [0, 1].
 *
 * Chaque octave est pondérée par la précédente (`poids`) : le détail
 * n'apparaît que sur les crêtes déjà formées, et les creux restent lisses.
 * Sans cette pondération le résultat est un gribouillis uniforme.
 */
export function crete2(x, z, oct = 3, gain = 0.5){
  let somme = 0, ampl = 1, total = 0, poids = 1, fx = x, fz = z;
  for(let o = 0; o < oct; o++){
    let s = 1 - Math.abs(perlin2(fx, fz));
    s *= s * poids;
    poids = s < 0 ? 0 : s > 1 ? 1 : s;
    somme += s * ampl;
    total += ampl;
    ampl *= gain;
    fx = fx*2 + 137.17; fz = fz*2 - 91.31;
  }
  return somme / total;
}

/* ─────────────── déformation du domaine ─────────────── */

/* Sortie de `deformer()`. Un tableau de module plutôt qu'un objet neuf :
   la génération l'appelle plus d'un million de fois, et allouer deux nombres
   par cellule suffirait à faire travailler le ramasse-miettes pendant tout le
   chargement. L'appelant lit DEF[0] et DEF[1] tout de suite après l'appel. */
export const DEF = [0, 0];

/**
 * Déplace le point d'échantillonnage par du bruit : on évalue « ailleurs »,
 * et cet ailleurs varie doucement. Les bandes deviennent des plis, les
 * cercles des amibes.
 *
 * @param ech   échelle du bruit de déplacement (grand = plis larges)
 * @param ampl  amplitude du déplacement, dans l'unité de x et z
 */
export function deformer(x, z, ech, ampl){
  // Deux champs décorrélés : le second est simplement pris très loin du
  // premier. Réutiliser le même avec un signe opposé ferait glisser tout le
  // monde en diagonale.
  const dx = fbm2(x/ech, z/ech, 2);
  const dz = fbm2(x/ech + 511.3, z/ech - 733.9, 2);
  DEF[0] = x + dx*ampl;
  DEF[1] = z + dz*ampl;
  return DEF;
}
