/* ═══ MONDE / GÉNÉRATION ═══
   Le terrain. Depuis la v5 il n'est plus CREUSÉ, il est ÉCHANTILLONNÉ.

   ── CE QUI A CHANGÉ, ET POURQUOI ───────────────────────────────────────────
   Jusqu'ici le monde était bâti par soustraction : on posait 300 RECTANGLES
   de salle, 90 blobs de caverne, et on les reliait par des couloirs en L. Le
   maillage a beau déplacer les coins d'un bruit (SETUP.monde.irregularite),
   ça ne rattrape rien : un rectangle a quatre angles droits, un couloir en L
   en a deux, et l'œil lit la RÈGLE avant de lire le lieu. Sur les aperçus
   c'était sans appel — un sol parfaitement plan, des murs d'aplomb à
   intervalles réguliers, un plafond en caissons.

   La v5 renverse le procédé. Le monde n'est plus une liste de pièces : c'est
   un COUPLE DE CHAMPS CONTINUS, évalués en tout point de la planche.

     · le champ d'ALTITUDE   dit à quelle cote est le sol en (x,z). Il est fait
       d'une descente d'ensemble (le fond du barrage d'un côté, la surface de
       l'autre), de plusieurs octaves de bruit pour le relief, et de failles
       qui y taillent des ressauts francs. Toute la planche en a une, roche
       comprise : le sol du monde est une surface unique, continue, sans un
       seul palier posé à la main.

     · le champ de ROCHE     dit si, en (x,z), il y a du creux ou du plein. Les
       galeries sont les LIGNES DE CRÊTE d'un bruit ridged — d'où des couloirs
       qui serpentent, se divisent et se rejoignent — et les grandes cavités
       sont les taches d'un bruit plus lent.

   Les deux champs sont évalués dans un domaine DÉFORMÉ (noyau/bruit.js,
   `deformer`) : rien n'est aligné sur les axes, les strates se plissent, une
   galerie ne part jamais droit.

   ── CE QUI N'A PAS CHANGÉ, ET C'EST VOLONTAIRE ─────────────────────────────
   Tout le reste du monde continue de lire la même grille : `grid`, `floorH`,
   `ceilH`, `biome`. Les gouffres, les ponts, les villages, la connexité, le
   décor, la navigation n'ont pas bougé d'une ligne. La stratigraphie tient
   toujours (le biome se déduit de l'altitude, monde/biomes.js), et le PLAN de
   l'éditeur garde le dernier mot sur le biome comme sur la cote.

   ── LA GARANTIE DE TRAVERSÉE ───────────────────────────────────────────────
   Un champ de bruit ne garantit rien du tout : il peut très bien ouvrir mille
   poches sans issue. Trois étapes s'en occupent, dans cet ordre :

     1. les LIEUX — les cavités les plus vastes sont repérées et chaînées par
        altitude croissante. Une galerie sinueuse relie chaque maillon au
        suivant : c'est l'ÉPINE, la seule partie du monde qu'on relaxe, donc
        la seule où l'on est certain de pouvoir marcher du fond jusqu'au jour.
     2. les POCHES — on étiquette les composantes du creux. Les petites sont
        rebouchées (une alcôve inatteignable n'est pas un lieu, c'est un bug
        qu'on ne verra jamais), les grandes reçoivent une galerie de liaison
        creusée le long du gradient de distance au continent.
     3. monde/connexite.js finit le travail sur ce qui reste séparé par une
        FALAISE plutôt que par de la roche — ce que le terrain, lui, ne peut
        pas savoir avant que le relief soit relaxé.                          */

import {SETUP} from '../setup.js';
import {lerp, clamp} from '../noyau/math.js';
import {rnd, ri} from '../noyau/rng.js';
import {fbm2, crete2, deformer, DEF} from '../noyau/bruit.js';
import {BIOMES} from './biomes.js';
/* Le biome et l'altitude d'une cellule passent par monde/plan.js : hors zone,
   il retombe sur la stratigraphie par altitude, et le monde reste 100 %
   procédural. */
import {biomeDeCellule, altitudeDeCellule} from './plan.js';
import {
  GW, GH, CELL, WALL, FLOOR, STEPUP,
  grid, floorH, ceilH, openN, biome, sky, falaise, vide,
  idx, inB, isFloor, calculerOuverture, majBornes,
} from './grille.js';

/** Les LIEUX : les grandes cavités repérées dans le champ. Le décor s'en sert
    pour poser ses colonnades, et le rapport de génération pour les compter.
    Même forme qu'en v4 ({x, z, e, b}) — props.js n'a pas eu à changer. */
export const salles = [];

/** Cellules appartenant à l'épine navigable — relaxées, donc traversables. */
export const epine = new Uint8Array(GW * GH);

/** Ce que la dernière génération a produit. Lu par le rapport.
    `ms` détaille le temps de chaque temps du terrain : sans ce détail, une
    génération qui passe de 0,1 s à 3 s ne se corrige qu'au hasard. */
export const releve = {lieux:0, poches:0, rebouchees:0, reliees:0, creux:0,
                       dehors:0, marches:0, saturee:false, ms:''};

/* ═══════════════ LES CHAMPS ═══════════════
   Ils varient sur des centaines de mètres : les évaluer une fois par cellule
   coûterait dix fois leur intérêt. On les échantillonne donc tous les
   `pasEchantillon` cellules et on interpole entre les nœuds. Mesuré : à un pas
   de 4 cellules (6 m) l'écart avec le champ exact reste sous 2 cm, pour un
   coût divisé par seize.

   Les coordonnées DÉFORMÉES sont mémorisées elles aussi : le champ de roche,
   lui, s'évalue cellule par cellule (une galerie de 3 cellules de large ne
   survivrait pas à une interpolation), mais il s'évalue dans le même domaine
   plissé que l'altitude — sinon les cavernes ne suivraient pas les couches. */

let champW = 0, champH = 0, champPas = 4;
let champAlt = null, champX = null, champZ = null;

function batirChamps(){
  const T = SETUP.terrain, M = SETUP.monde;
  champPas = Math.max(1, T.pasEchantillon);
  const w = Math.ceil(GW / champPas) + 2, h = Math.ceil(GH / champPas) + 2;

  if(!champAlt || champW !== w || champH !== h){
    champW = w; champH = h;
    champAlt = new Float32Array(w * h);
    champX   = new Float32Array(w * h);
    champZ   = new Float32Array(w * h);
  }

  for(let gz = 0; gz < h; gz++) for(let gx = 0; gx < w; gx++){
    const x = gx * champPas, z = gz * champPas;

    /* Le domaine plissé. Tout le reste s'évalue LÀ, jamais en (x,z). */
    deformer(x, z, T.echellePli, T.amplitudePli);
    const px = DEF[0], pz = DEF[1];

    /* La descente d'ensemble : une diagonale du fond vers le jour. C'est ce
       qui donne au monde son sens de lecture — le barrage tout au fond dans
       un coin, la surface gelée dans l'autre — et c'est la déformation qui
       l'empêche de ressembler à un plan incliné. */
    const t = clamp((px / GW + (1 - pz / GH)) * 0.5, 0, 1);
    let a = lerp(M.altBasse, M.altHaute, t);

    /* Le relief. Le gain est volontairement sous 0,5 : chaque octave apporte
       alors moins de PENTE que la précédente, et le sol reste marchable sans
       qu'on ait à l'aplatir après coup. */
    a += fbm2(px / T.echelleRelief, pz / T.echelleRelief,
              T.octavesRelief, T.gainRelief) * T.amplitudeRelief;

    /* Les failles. Un bruit de crête franchi d'un coup : le sol saute de
       plusieurs mètres sur quelques cellules. C'est ce qui fait les
       escarpements, les corniches et les à-pics — le relief lisse, lui, n'en
       produit aucun. Le lissage sur une bande étroite évite la marche
       parfaitement verticale, qui se lit comme un mur et non comme une
       falaise. */
    const f = crete2(px / T.echelleFaille, pz / T.echelleFaille, 2);
    const b0 = T.seuilFaille - T.largeurFaille, b1 = T.seuilFaille + T.largeurFaille;
    const u = clamp((f - b0) / Math.max(1e-6, b1 - b0), 0, 1);
    a += u * u * (3 - 2 * u) * T.hauteurFaille;

    const i = gz * w + gx;
    champAlt[i] = a; champX[i] = px; champZ[i] = pz;
  }
}

/** Interpolation bilinéaire d'un champ échantillonné. */
function lire(champ, x, z){
  const gx = x / champPas, gz = z / champPas;
  const ix = gx | 0, iz = gz | 0;
  const fx = gx - ix, fz = gz - iz;
  const i = iz * champW + ix, j = i + champW;
  const a = champ[i] + (champ[i+1] - champ[i]) * fx;
  const b = champ[j] + (champ[j+1] - champ[j]) * fx;
  return a + (b - a) * fz;
}

/**
 * Y a-t-il du creux en (x,z) ? `px,pz` sont les coordonnées déformées.
 *
 * Deux familles se réunissent :
 *   · les GALERIES — les crêtes d'un bruit ridged. Un bruit ordinaire donne
 *     des taches, un bruit de crête donne des LIGNES : elles serpentent, se
 *     divisent, se rejoignent. C'est un réseau, pas un gruyère.
 *   · les CAVITÉS — les hauts d'un bruit lent. Ce sont les salles, et elles
 *     n'ont ni coin ni côté.
 *
 * Les deux seuils sont bousculés par une RUGOSITÉ à l'échelle de la cellule.
 * Sans elle, la frontière entre creux et plein est une courbe lisse, et une
 * paroi lisse à la verticale, c'est un mur de couloir. Avec elle, la roche
 * gagne des redans, des alcôves et des éperons — de quoi se cacher, aussi.
 */
function creux(px, pz){
  const T = SETUP.terrain;
  const rug = fbm2(px / T.echelleRugosite, pz / T.echelleRugosite, 2) * T.rugositeRoche;
  if(crete2(px / T.echelleGalerie, pz / T.echelleGalerie, 3) + rug > T.seuilGalerie) return true;
  return fbm2(px / T.echelleSalle, pz / T.echelleSalle, 3) + rug > T.seuilSalle;
}

/**
 * Le RELIEF DE PROXIMITÉ, ajouté à l'altitude cellule par cellule.
 *
 * Il ne s'échantillonne pas comme le reste : c'est justement ce qui se passe
 * ENTRE deux nœuds du champ. Sans lui, le sol vu par le joueur est plat — le
 * relief d'ensemble varie de 24 m sur 300, soit un mètre sur les quinze mètres
 * que porte le regard dans le brouillard. Les aperçus de la première version
 * v5 montraient exactement ça : des strates justes, et un sol de gymnase.
 *
 * L'amplitude est petite, et c'est voulu : au-delà d'un mètre, chaque pas
 * devient une marche et la relaxation de l'épine passe son temps à raboter.
 */
function detailSol(px, pz){
  const T = SETUP.terrain;
  return fbm2(px / T.echelleDetail, pz / T.echelleDetail, 3) * T.amplitudeDetail;
}

/* ═══════════════ LE TERRAIN ═══════════════ */

/**
 * Remplit `floorH`, `biome` et `grid` pour toute la planche.
 *
 * L'altitude est écrite PARTOUT, roche comprise : le sol du monde est une
 * surface continue dont on ne voit que les portions dégagées. C'est ce qui
 * fait qu'une galerie qui débouche dans une salle arrive au bon niveau, sans
 * la moindre marche de raccord — le défaut le plus visible de la v4, où
 * chaque salle avait SA cote et où les couloirs devaient rattraper l'écart.
 */
function poserTerrain(){
  for(let z = 0; z < GH; z++) for(let x = 0; x < GW; x++){
    const i = idx(x, z);
    const px = lire(champX, x, z), pz = lire(champZ, x, z);
    const y = altitudeDeCellule(lire(champAlt, x, z) + detailSol(px, pz), x, z);
    const b = biomeDeCellule(y, x, z);
    floorH[i] = y;
    biome[i] = b;
    /* Le dehors n'est pas une caverne : au-dessus de la dernière strate, tout
       est ouvert. La surface gelée cesse d'être une salle rectangulaire à
       ciel ouvert pour devenir ce qu'elle doit être — un paysage. */
    if(BIOMES[b].sky || creux(px, pz)) grid[i] = FLOOR;
  }
}

/* ═══════════════ LES LIEUX ═══════════════ */

/**
 * Repère les grandes cavités. On ne cherche pas un maximum du bruit — ce qui
 * donnerait des lieux là où le terrain n'est peut-être pas creusé — mais une
 * forte DENSITÉ DE CREUX réelle, mesurée sur la grille déjà posée.
 *
 * Densité calculée sur une grille grossière puis lissée : c'est l'équivalent
 * de `openN` (calculé plus tard, une fois les galeries percées) pour trois
 * fois rien.
 */
function repererLieux(){
  const T = SETUP.terrain;
  const P = Math.max(2, T.pasLieux);
  const w = Math.ceil(GW / P), h = Math.ceil(GH / P);
  const dens = new Float32Array(w * h);

  for(let z = 0; z < GH; z++){
    const gz = (z / P) | 0;
    for(let x = 0; x < GW; x++)
      if(grid[idx(x,z)] === FLOOR) dens[gz * w + ((x / P) | 0)]++;
  }
  const parCase = P * P;

  /* Lissage 3×3 : une case seule ne dit rien, une case entourée de creux est
     une salle. */
  const lisse = new Float32Array(w * h);
  for(let gz = 1; gz < h-1; gz++) for(let gx = 1; gx < w-1; gx++){
    let s = 0;
    for(let dz = -1; dz <= 1; dz++) for(let dx = -1; dx <= 1; dx++)
      s += dens[(gz+dz) * w + gx+dx];
    lisse[gz * w + gx] = s / (9 * parCase);
  }

  /* Les meilleures cases, en s'interdisant deux lieux trop proches. On tire
     dans l'ordre décroissant de densité : les vraies salles d'abord. */
  const cand = [];
  for(let gz = 1; gz < h-1; gz++) for(let gx = 1; gx < w-1; gx++)
    if(lisse[gz * w + gx] > T.densiteLieu) cand.push([lisse[gz*w+gx], gx, gz]);
  cand.sort((a, b) => b[0] - a[0]);

  const ECART = Math.max(1, Math.round(T.ecartLieux / P));
  const pris = new Uint8Array(w * h);
  salles.length = 0;

  for(const [, gx, gz] of cand){
    if(salles.length >= SETUP.monde.nbSalles) break;
    if(pris[gz * w + gx]) continue;
    for(let dz = -ECART; dz <= ECART; dz++) for(let dx = -ECART; dx <= ECART; dx++){
      const nx = gx+dx, nz = gz+dz;
      if(nx >= 0 && nz >= 0 && nx < w && nz < h) pris[nz * w + nx] = 1;
    }
    /* Le centre de la case, ramené sur une cellule creuse : le lieu doit être
       un endroit où l'on peut se tenir, pas une coordonnée moyenne. */
    const c = plusProcheCreux(gx * P + (P>>1), gz * P + (P>>1), 12);
    if(!c) continue;
    const i = idx(c.x, c.z);
    salles.push({x: c.x, z: c.z, e: floorH[i], b: biome[i]});
  }
}

/** La cellule creuse la plus proche de (x,z), dans un rayon de `r` cellules. */
function plusProcheCreux(x, z, r){
  if(isFloor(x, z)) return {x, z};
  for(let k = 1; k <= r; k++){
    for(let dz = -k; dz <= k; dz++) for(let dx = -k; dx <= k; dx++){
      if(Math.abs(dx) !== k && Math.abs(dz) !== k) continue;
      if(isFloor(x+dx, z+dz)) return {x: x+dx, z: z+dz};
    }
  }
  return null;
}

/* ═══════════════ LES GALERIES ═══════════════ */

/**
 * Creuse une galerie sinueuse entre deux points, et la marque comme épine.
 *
 * Le tracé n'est pas droit : chaque pas est écarté perpendiculairement par du
 * bruit, d'une amplitude proportionnelle à la longueur du trajet. Un couloir
 * de v4 allait tout droit puis tournait à angle droit ; celui-ci ondule, et
 * l'on ne voit jamais où il finit.
 *
 * Le sol suit le TERRAIN, il ne l'invente pas : une galerie est un vide dans
 * la roche, pas une passerelle. La relaxation de l'épine se chargera ensuite
 * de raboter les marches trop hautes qu'elle traverse.
 */
function galerie(ax, az, bx, bz, largeur){
  const T = SETUP.terrain;
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if(dist < 1) return;
  const pas = Math.max(2, Math.round(dist));
  const nx = -dz / dist, nz = dx / dist;          // la perpendiculaire
  const ampl = Math.min(T.sinuositeMax, dist * T.sinuosite);
  const phase = rnd() * 1000;

  for(let s = 0; s <= pas; s++){
    const t = s / pas;
    /* Le décalage s'annule aux deux bouts (sin(πt)) : la galerie arrive
       exactement sur ses deux lieux, elle ne les rate pas de dix mètres. */
    const d = fbm2(phase + t * dist / T.echelleSinus, phase * 0.7, 2)
            * ampl * Math.sin(Math.PI * t);
    const cx = Math.round(ax + dx * t + nx * d);
    const cz = Math.round(az + dz * t + nz * d);
    /* La largeur respire : un boyau, puis une salle, puis un boyau. Bornée des
       deux côtés — le bruit est calibré en écart-type, il sort donc
       régulièrement de [−1,1] et une largeur négative creuserait à l'envers. */
    const respire = clamp(fbm2(t * dist / 40 + phase, 17.3, 2), -1, 1);
    const r = largeur * (1 + 0.45 * respire);

    const R = Math.ceil(r);
    for(let oz = -R; oz <= R; oz++) for(let ox = -R; ox <= R; ox++){
      if(ox*ox + oz*oz > r*r) continue;
      const x = cx + ox, z = cz + oz;
      if(!inB(x, z)) continue;
      grid[idx(x, z)] = FLOOR;
      epine[idx(x, z)] = 1;
    }
  }
}

/**
 * Épaissit l'épine de `marge` cellules. La relaxation a besoin de place de
 * part et d'autre du tracé pour étaler une rampe ; sans marge elle rabote un
 * couloir d'une cellule de large entre deux parois et ne lisse rien.
 *
 * Une vague en largeur, et non un carré marqué autour de chaque pas de chaque
 * galerie : à 440 galeries et 6 cellules de marge, la seconde méthode écrivait
 * vingt-quatre millions de fois dans un tableau d'un million de cases, et
 * c'était à elle seule la moitié du temps de génération.
 */
function dilaterEpine(marge){
  if(marge <= 0) return;
  const N = GW * GH;
  const file = new Int32Array(N);
  const dist = new Uint8Array(N);
  let tete = 0, queue = 0;
  for(let i = 0; i < N; i++) if(epine[i]){ dist[i] = 1; file[queue++] = i; }
  while(tete < queue){
    const i = file[tete++];
    const d = dist[i];
    if(d > marge) continue;
    const x = i % GW;
    if(x > 0)      voisin(i - 1, d);
    if(x < GW-1)   voisin(i + 1, d);
    if(i >= GW)    voisin(i - GW, d);
    if(i < N - GW) voisin(i + GW, d);
  }
  function voisin(j, d){
    if(dist[j]) return;
    dist[j] = d + 1;
    epine[j] = 1;
    file[queue++] = j;
  }
}

/**
 * Étend l'ourlet de `marge` cellules, à ciel ouvert uniquement. Même vague que
 * `dilaterEpine`, mais qui refuse de repartir sous terre : le souterrain est
 * déjà relaxé, et l'ourlet n'a pas à ronger le dehors plus loin que sa lisière.
 */
function dilaterEpineCiel(marge, depart){
  if(marge <= 0) return;
  const N = GW * GH;
  const file = new Int32Array(N);
  const dist = new Uint8Array(N);
  let tete = 0, queue = 0;
  for(const i of depart){ dist[i] = 1; file[queue++] = i; }
  while(tete < queue){
    const i = file[tete++];
    const d = dist[i];
    if(d > marge) continue;
    const x = i % GW;
    if(x > 0)      voisin(i - 1, d);
    if(x < GW-1)   voisin(i + 1, d);
    if(i >= GW)    voisin(i - GW, d);
    if(i < N - GW) voisin(i + GW, d);
  }
  function voisin(j, d){
    if(dist[j] || grid[j] !== FLOOR || !BIOMES[biome[j]].sky) return;
    dist[j] = d + 1;
    epine[j] = 1;
    file[queue++] = j;
  }
}

/**
 * Chaîne les lieux par altitude croissante et les relie. C'est l'épine : le
 * chemin garanti du point le plus bas du monde jusqu'au jour.
 *
 * Puis des RACCOURCIS entre lieux voisins, pour que le monde soit un réseau et
 * non un fil. Sans eux, chaque cul-de-sac oblige à revenir sur ses pas.
 */
function relierLesLieux(){
  const T = SETUP.terrain;
  if(salles.length < 2) return;

  const ordre = salles.slice().sort((a, b) => a.e - b.e);
  for(let k = 1; k < ordre.length; k++){
    const a = ordre[k-1], b = ordre[k];
    galerie(a.x, a.z, b.x, b.z, rnd() < 0.3 ? T.largeurGalerie + 1 : T.largeurGalerie);
  }

  /* Raccourcis : un lieu, et le plus proche parmi ceux qui le suivent dans la
     chaîne. On ne relie jamais deux altitudes éloignées — un puits vertical de
     soixante mètres ne se descend pas. */
  for(let k = 0; k < SETUP.monde.nbRaccourcis && ordre.length > 3; k++){
    const i = ri(0, ordre.length - 2);
    const a = ordre[i];
    let meilleur = null, md = 1e9;
    for(let j = Math.max(0, i-8); j < Math.min(ordre.length, i+9); j++){
      if(j === i) continue;
      const c = ordre[j];
      if(Math.abs(c.e - a.e) > T.deniveleRaccourci) continue;
      const d = (c.x-a.x)**2 + (c.z-a.z)**2;
      if(d < md){ md = d; meilleur = c; }
    }
    if(meilleur) galerie(a.x, a.z, meilleur.x, meilleur.z, T.largeurGalerie);
  }
}

/* ═══════════════ LES POCHES ═══════════════ */

/**
 * Étiquette les composantes du CREUX (voisinage à 4, sans tenir compte du
 * relief), reboûche les petites et relie les grandes au continent.
 *
 * Pourquoi ici et pas dans monde/connexite.js : celui-ci raisonne en
 * PRATICABILITÉ (une marche trop haute coupe), ce qui demande un relief déjà
 * relaxé, et il travaille à coups de rampes et de galeries comptées. Une poche
 * murée par de la roche, elle, ne se répare qu'en creusant, et le terrain est
 * le seul à savoir combien il en a produit. Mesuré sur la v4 : 57 % des
 * frontières de morceau isolé étaient de la roche non creusée.
 *
 * @returns {poches, rebouchees, reliees}
 */
function relierLesPoches(){
  const T = SETUP.terrain;
  const N = GW * GH;
  const comp = new Int32Array(N).fill(-1);
  const file = new Int32Array(N);
  const tailles = [];
  let nb = 0;

  for(let depart = 0; depart < N; depart++){
    if(comp[depart] !== -1 || grid[depart] !== FLOOR) continue;
    let tete = 0, queue = 0, taille = 0;
    file[queue++] = depart; comp[depart] = nb;
    while(tete < queue){
      const i = file[tete++]; taille++;
      const x = i % GW;
      if(x > 0)      essai(i - 1);
      if(x < GW-1)   essai(i + 1);
      if(i >= GW)    essai(i - GW);
      if(i < N - GW) essai(i + GW);
    }
    function essai(j){
      if(comp[j] !== -1 || grid[j] !== FLOOR) return;
      comp[j] = nb; file[queue++] = j;
    }
    tailles.push(taille); nb++;
  }

  if(nb === 0) return {poches:0, rebouchees:0, reliees:0};

  let continent = 0;
  for(let k = 1; k < nb; k++) if(tailles[k] > tailles[continent]) continent = k;

  /* Distance au continent, en cellules, À TRAVERS LA ROCHE. Une seule vague
     multi-sources : on saura, depuis n'importe quelle poche, dans quelle
     direction creuser pour retomber sur le monde. */
  const dist = new Int32Array(N).fill(-1);
  let tete = 0, queue = 0;
  for(let i = 0; i < N; i++) if(comp[i] === continent){ dist[i] = 0; file[queue++] = i; }
  while(tete < queue){
    const i = file[tete++];
    const x = i % GW, d = dist[i] + 1;
    if(x > 0      && dist[i-1]  < 0){ dist[i-1]  = d; file[queue++] = i-1; }
    if(x < GW-1   && dist[i+1]  < 0){ dist[i+1]  = d; file[queue++] = i+1; }
    if(i >= GW    && dist[i-GW] < 0){ dist[i-GW] = d; file[queue++] = i-GW; }
    if(i < N - GW && dist[i+GW] < 0){ dist[i+GW] = d; file[queue++] = i+GW; }
  }

  /* Le point de chaque poche le plus proche du continent : c'est de là qu'on
     creuse, et c'est le percement le moins cher. */
  const meilleur = new Int32Array(nb).fill(-1);
  for(let i = 0; i < N; i++){
    const c = comp[i];
    if(c < 0 || c === continent) continue;
    if(meilleur[c] < 0 || dist[i] < dist[meilleur[c]]) meilleur[c] = i;
  }

  let rebouchees = 0, reliees = 0;

  /* Les poches trop petites sont rendues à la roche EN UNE SEULE PASSE. Une
     boucle sur la grille par poche coûtait 220 balayages d'un million de
     cellules — un quart de seconde de génération pour une opération qui n'en
     demande qu'un. */
  const aReboucher = new Uint8Array(nb);
  for(let c = 0; c < nb; c++)
    if(c !== continent && tailles[c] < T.pocheMin){ aReboucher[c] = 1; rebouchees++; }
  if(rebouchees){
    for(let i = 0; i < N; i++){
      const c = comp[i];
      if(c >= 0 && aReboucher[c]) grid[i] = WALL;
    }
  }

  for(let c = 0; c < nb; c++){
    if(c === continent || meilleur[c] < 0 || aReboucher[c]) continue;

    /* Le gradient de distance dit OÙ déboucher — c'est le percement le moins
       cher — mais on ne creuse pas le long de lui. Une descente de gradient
       sur une grille ne produit que des segments alignés sur les axes, et la
       carte du monde en était rayée de traits parfaitement droits : le défaut
       même qu'on venait de retirer du reste du terrain. On ne retient donc que
       le point d'arrivée, et on y va par une galerie sinueuse comme les
       autres. */
    let i = meilleur[c], garde = 0;
    while(dist[i] > 0 && garde++ < 4000){
      let suivant = -1, md = dist[i];
      for(const j of [i-1, i+1, i-GW, i+GW]){
        if(j < 0 || j >= N) continue;
        if(dist[j] >= 0 && dist[j] < md){ md = dist[j]; suivant = j; }
      }
      if(suivant < 0) break;
      i = suivant;
    }
    galerie(meilleur[c] % GW, (meilleur[c] / GW) | 0,
            i % GW, (i / GW) | 0, T.largeurLiaison);
    reliees++;
  }
  return {poches: nb - 1, rebouchees, reliees};
}

/* ═══════════════ RELAXATION SUR L'ÉPINE ═══════════════ */

/**
 * Rend le champ de hauteur franchissable partout où l'épine passe : entre deux
 * cellules voisines d'épine, plus aucune marche ne dépasse ce que le joueur
 * enjambe. On ne fait que BAISSER — jamais monter — donc le relief garde sa
 * forme et ses creux.
 *
 * ── POURQUOI DES SEAUX, ET PAS UNE FILE ────────────────────────────────────
 * La v3 tenait une file d'attente : on abaissait une cellule, on remettait ses
 * voisines en question, et on recommençait. Ça converge, mais le nombre de
 * visites explose dès que la zone relaxée est vaste — chaque grand plateau se
 * fait raboter par vagues successives. Avec l'épine étroite de la v4 c'était
 * invisible ; en v5, où TOUT le souterrain est relaxé, le garde-fou coupait la
 * boucle avant la fin (2 778 marches infranchissables laissées derrière, sans
 * un mot), et le lever coûtait douze secondes de génération.
 *
 * Le problème est en réalité un PLUS COURT CHEMIN : la cote finale d'une
 * cellule vaut la plus petite valeur de « cote d'une cellule + MAX × distance
 * jusqu'à elle ». Toutes les arêtes ayant le même poids (MAX), un tas de
 * priorité est inutile : des seaux de largeur MAX suffisent, et l'ordre est
 * exact. Abaisser une cellule la range forcément dans un seau POSTÉRIEUR à
 * celui qu'on traite — on ne revient donc jamais en arrière, chaque cellule
 * est réglée une fois, et le procédé se termine tout seul. Plus de garde-fou,
 * plus de saturation muette.
 *
 * Mesuré sur la grille 1088² avec tout le souterrain relaxé : 12,1 s → 0,2 s,
 * et zéro marche infranchissable.
 */
export function relaxerEpine(){
  /* La quantification passe APRÈS et arrondit au quart de mètre : deux cotes
     séparées de la marche maximale peuvent en ressortir séparées d'un quart de
     mètre de plus. On garde donc la marge, sinon la garantie est fausse. */
  const MAX = STEPUP - SETUP.monde.quantifierRelief - 0.03;
  const NB = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const N = GW*GH;

  let hmin = Infinity, hmax = -Infinity, combien = 0;
  for(let i = 0; i < N; i++){
    if(grid[i] !== FLOOR || !epine[i]) continue;
    combien++;
    if(floorH[i] < hmin) hmin = floorH[i];
    if(floorH[i] > hmax) hmax = floorH[i];
  }
  releve.marches = 0;
  releve.saturee = false;
  if(!combien) return;

  const NS = Math.ceil((hmax - hmin) / MAX) + 3;
  const seaux = new Array(NS);
  for(let b = 0; b < NS; b++) seaux[b] = [];
  const ranger = i => {
    let b = ((floorH[i] - hmin) / MAX) | 0;
    if(b < 0) b = 0; else if(b >= NS) b = NS - 1;
    seaux[b].push(i);
  };

  for(let i = 0; i < N; i++) if(grid[i] === FLOOR && epine[i]) ranger(i);

  const regle = new Uint8Array(N);
  for(let b = 0; b < NS; b++){
    const lot = seaux[b];
    for(let k = 0; k < lot.length; k++){
      const i = lot[k];
      if(regle[i]) continue;
      regle[i] = 1;
      const h = floorH[i], x = i % GW, z = (i / GW) | 0;
      for(const [dx,dz] of NB){
        const nx = x+dx, nz = z+dz;
        if(!isFloor(nx,nz)) continue;
        const n = idx(nx,nz);
        if(!epine[n] || regle[n]) continue;   // hors épine : la falaise reste
        if(floorH[n] > h + MAX){
          floorH[n] = h + MAX;
          ranger(n);                          // toujours dans un seau plus loin
        }
      }
    }
  }

  /* Ce qui reste : deux cellules voisines, toutes deux relaxées, que le joueur
     ne peut pas franchir. Doit valoir zéro — et le rapport de génération le
     dit, plutôt que de laisser le monde se couper en silence. */
  let restes = 0;
  for(let z = 1; z < GH-1; z++) for(let x = 1; x < GW-1; x++){
    const i = idx(x,z);
    if(grid[i] !== FLOOR || !epine[i]) continue;
    for(const [dx,dz] of [[1,0],[0,1]]){
      const nx = x+dx, nz = z+dz;
      if(!isFloor(nx,nz) || !epine[idx(nx,nz)]) continue;
      if(Math.abs(floorH[i] - floorH[idx(nx,nz)]) > STEPUP) restes++;
    }
  }
  releve.marches = restes;
}

/**
 * Marque les arêtes franches. Une cellule est `falaise` si l'un de ses voisins
 * de sol est plus bas de plus de SETUP.relief.falaiseMin : le maillage y
 * dessine une paroi nette, le joueur ne peut pas la remonter, la créature si.
 */
export function marquerFalaises(){
  const S = SETUP.relief.falaiseMin;
  const NB = [[1,0],[-1,0],[0,1],[0,-1]];
  for(let z=1; z<GH-1; z++) for(let x=1; x<GW-1; x++){
    const i = idx(x,z);
    if(grid[i] !== FLOOR) continue;
    falaise[i] = 0;
    for(const [dx,dz] of NB){
      if(!isFloor(x+dx, z+dz)) continue;
      if(floorH[i] - floorH[idx(x+dx,z+dz)] > S){ falaise[i] = 1; break; }
    }
  }
}

/* ═══════════════ LE PLAN DU MONDE ═══════════════ */


/**
 * Bâtit le terrain. Quatre temps : les champs, la matière, les lieux et leurs
 * galeries, enfin le recollement des poches.
 */
export function creuserPlan(){
  salles.length = 0;
  epine.fill(0);

  const t = [performance.now()];
  batirChamps();      t.push(performance.now());
  poserTerrain();     t.push(performance.now());
  repererLieux();     t.push(performance.now());
  relierLesLieux();   t.push(performance.now());
  const r = relierLesPoches();
  t.push(performance.now());
  dilaterEpine(SETUP.relief.epineMarge);

  /* ── TOUT LE SOUTERRAIN EST-IL GARANTI MARCHABLE ? ──
     Mesuré sur la v5 : avec la seule épine relaxée, 88 % du sol praticable
     tenait dans un morceau, contre 98 % en v4 — et sept morceaux
     significatifs restaient inatteignables. La cause n'est pas le décor mais
     la forme du terrain : une galerie de trois cellules de large qu'une
     faille traverse est coupée net, et il n'y a pas de « par le côté » dans
     un boyau.

     On étend donc l'épine à tout le creux SOUS TERRE. Le dehors, lui, garde
     son relief brut : à ciel ouvert on contourne, et c'est là que les à-pics
     ont un sens. */
  if(SETUP.terrain.relaxerSouterrain){
    for(let i = 0; i < GW*GH; i++)
      if(grid[i] === FLOOR && (SETUP.terrain.relaxerDehors || !BIOMES[biome[i]].sky))
        epine[i] = 1;

    /* ── L'OURLET DU DEHORS ──
       Si l'on relaxe le souterrain et pas la surface, on abaisse d'un côté de
       la frontière et pas de l'autre : il se forme une marche tout le long de
       la lisière, et la surface entière se décroche du monde. Mesuré : un
       monde sur trois avait son dehors — la destination du jeu — entièrement
       inatteignable à pied.

       On relaxe donc un ourlet de quelques cellules côté ciel : de quoi
       recoudre les deux, sans toucher aux à-pics du grand dehors. */
    if(!SETUP.terrain.relaxerDehors){
      const bord = [];
      for(let z = 1; z < GH-1; z++) for(let x = 1; x < GW-1; x++){
        const i = idx(x,z);
        if(grid[i] !== FLOOR || !BIOMES[biome[i]].sky) continue;
        for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const n = idx(x+dx, z+dz);
          if(grid[n] === FLOOR && !BIOMES[biome[n]].sky){ bord.push(i); break; }
        }
      }
      for(const i of bord) epine[i] = 1;
      if(bord.length) dilaterEpineCiel(SETUP.terrain.ourletDehors, bord);
    }
  }
  t.push(performance.now());

  /* Pas de mur d'enceinte : au bord, le sol s'arrête et c'est le vide. Un
     monde clos par une paroi invisible n'a pas d'horizon. */
  const B = SETUP.monde.bordVide;
  for(let z=0; z<GH; z++) for(let x=0; x<GW; x++){
    if(x<B || z<B || x>=GW-B || z>=GH-B){
      const i = idx(x,z);
      if(grid[i] !== FLOOR) vide[i] = 1;
    }
  }

  let creuse = 0, dehors = 0;
  for(let i=0; i<GW*GH; i++){
    if(grid[i] !== FLOOR) continue;
    creuse++;
    if(BIOMES[biome[i]].sky) dehors++;
  }
  releve.dehors = dehors;
  const noms = ['champs', 'terrain', 'lieux', 'galeries', 'poches', 'épine'];
  releve.ms = noms.map((n, k) => n + ' ' + (t[k+1] - t[k]).toFixed(0)).join(' · ');
  releve.lieux = salles.length;
  releve.poches = r.poches; releve.rebouchees = r.rebouchees; releve.reliees = r.reliees;
  releve.creux = creuse;
}

/**
 * Pose les plafonds. Nettement plus bas qu'en v2 : le souterrain doit être
 * exigu. Sous SETUP.monde.plafondRampe il faut ramper — ce qui a un intérêt
 * mécanique direct, puisque ramper n'imprime aucune trace.
 *
 * Le plafond ONDULE (v5). C'était l'autre moitié du « tout est cubique » : un
 * plafond à hauteur constante au-dessus d'un sol plat donne un caisson, et
 * c'est exactement ce que montraient les aperçus. Le bruit est indépendant du
 * sol — voûtes et fonds de galerie ne respirent pas ensemble.
 */
export function poserPlafonds(){
  const {plafondBase, plafondOuvert, plafondCiel} = SETUP.monde;
  const T = SETUP.terrain;
  for(let z=0; z<GH; z++) for(let x=0; x<GW; x++){
    const i = idx(x,z);
    if(grid[i] !== FLOOR){ ceilH[i] = 0; continue; }
    const B = BIOMES[biome[i]];
    if(B.sky){
      // Dehors : pas de plafond, et de hautes parois tout autour. On est au
      // fond d'une vallée, pas dans une salle repeinte en gris.
      sky[i] = 1; ceilH[i] = floorH[i] + plafondCiel;
    } else {
      const voute = 1 + fbm2(x / T.echellePlafond, z / T.echellePlafond, 2)
                      * T.reliefPlafond;
      ceilH[i] = floorH[i]
               + Math.max(T.plafondMin, (plafondBase + openN[i]*plafondOuvert) * B.h * voute);
    }
  }
}

/**
 * Arrondit le champ de hauteur à un pas fixe. Voir SETUP.monde.quantifierRelief.
 * Appelé APRÈS la relaxation : quantifier avant reviendrait à quantifier, puis
 * à tout réétaler, et il ne resterait rien de plan.
 */
export function quantifierRelief(){
  const pas = SETUP.monde.quantifierRelief;
  if(!pas) return;
  const inv = 1/pas;
  for(let i=0;i<GW*GH;i++){
    if(grid[i] !== FLOOR) continue;
    floorH[i] = Math.round(floorH[i]*inv)*pas;
    ceilH[i]  = Math.round(ceilH[i]*inv)*pas;
  }
}

/** Recalcule ouverture, bornes et falaises après une modification du relief. */
export function finaliserRelief(){
  quantifierRelief();
  calculerOuverture();
  poserPlafonds();
  marquerFalaises();
  majBornes();
}
