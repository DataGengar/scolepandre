/* ═══ ÉDITEUR / PRIMITIVES ═══
   La description des cinq formes, pour que la forge n'ait pas à les connaître.

   ── POURQUOI DÉCRIRE PLUTÔT QUE CODER ──────────────────────────────────────
   Le panneau de droite pourrait tester la forme et afficher les bons champs
   à coups de `if`. Ça marche, et ça se périme : le jour où une primitive gagne
   un paramètre, il faut y penser à trois endroits — la géométrie, l'interface,
   l'export — et on n'y pense jamais aux trois.

   Ici chaque forme dit ce qu'elle est : ses champs, leurs bornes, leur nom
   lisible, comment les lire et les écrire. La forge parcourt la description
   et fabrique l'interface. Ajouter un paramètre, c'est ajouter une ligne.
   C'est le même parti pris que `CURSEURS` dans setup.js, qui construit tout
   seul le panneau des réglages du jeu.

   ── LES ACCESSEURS ─────────────────────────────────────────────────────────
   Un tube range ses points dans des tableaux imbriqués (`tube[0][1]`), une
   boîte a des champs plats (`sy`). Plutôt que d'inventer une syntaxe de
   chemin, chaque champ porte ses deux fonctions. C'est trois caractères de
   plus à écrire et zéro ambiguïté à la lecture.                             */

import {trianglesPart, etenduePart} from '../monde/formes.js';

/* Un champ : [clé, libellé, mini, maxi, pas, lire, écrire] */
const champ = (cle, libelle, mn, mx, pas, lire, ecrire) =>
  ({cle, libelle, mn, mx, pas, lire, ecrire});

/* Les trois champs de position, identiques pour toutes les formes centrées. */
const POSITION = [
  champ('x', 'x', -20, 20, 0.01, q => q.x, (q,v) => q.x = v),
  champ('y', 'y', -20, 20, 0.01, q => q.y, (q,v) => q.y = v),
  champ('z', 'z', -20, 20, 0.01, q => q.z, (q,v) => q.z = v),
];

const ORIENTATION = [
  champ('r',  'inclinaison', -3.15, 3.15, 0.01, q => q.r  || 0, (q,v) => q.r  = v),
  champ('ry', 'lacet',       -3.15, 3.15, 0.01, q => q.ry || 0, (q,v) => q.ry = v),
];

const TAILLE = [
  champ('sx', 'largeur',   0.01, 20, 0.01, q => q.sx, (q,v) => q.sx = v),
  champ('sy', 'hauteur',   0.01, 20, 0.01, q => q.sy, (q,v) => q.sy = v),
  champ('sz', 'profondeur',0.01, 20, 0.01, q => q.sz, (q,v) => q.sz = v),
];

export const PRIMITIVES = {

  bloc: {
    nom: 'Bloc',
    aide: 'Une boîte. 12 triangles. Ce dont tout est fait.',
    creer: () => ({x:0, y:0.5, z:0, sx:0.4, sy:1, sz:0.4,
                   r:0, ry:0, emis:0, c:[0.28,0.26,0.23]}),
    reconnait: q => !q.tube && !q.coin && !q.plaque && !q.roche,
    champs: [...POSITION, ...TAILLE, ...ORIENTATION],
  },

  coin: {
    nom: 'Coin',
    aide: 'Un prisme triangulaire. Toits, rampes, éboulis, appuis. 8 triangles.',
    creer: () => ({coin:1, x:0, y:0.3, z:0, sx:1, sy:0.6, sz:1,
                   r:0, ry:0, emis:0, c:[0.28,0.26,0.23]}),
    reconnait: q => !!q.coin,
    champs: [...POSITION, ...TAILLE, ...ORIENTATION,
      champ('coin', 'sens de la pente', -1, 1, 2,
            q => q.coin, (q,v) => q.coin = (v < 0 ? -1 : 1))],
  },

  plaque: {
    nom: 'Plaque',
    aide: 'Un quadrilatère sans épaisseur, visible des deux côtés. '
        + '4 triangles au lieu de 12 : c\'est la forme des objets fins.',
    creer: () => ({plaque:1, x:0, y:0.6, z:0, sx:0.6, sy:0.4,
                   r:0, ry:0, emis:0, c:[0.34,0.31,0.27]}),
    reconnait: q => !!q.plaque,
    champs: [...POSITION,
      champ('sx', 'largeur', 0.01, 20, 0.01, q => q.sx, (q,v) => q.sx = v),
      champ('sy', 'hauteur', 0.01, 20, 0.01, q => q.sy, (q,v) => q.sy = v),
      ...ORIENTATION],
  },

  tube: {
    nom: 'Tube',
    aide: 'Un prisme effilé entre deux points. Troncs, os, câbles, cannelures.',
    creer: () => ({tube:[[0,0,0], 0.18, [0,1.1,0], 0.08, 6],
                   emis:0, c:[0.28,0.26,0.23]}),
    reconnait: q => !!q.tube,
    champs: [
      champ('p0x','x départ',-20,20,0.01, q=>q.tube[0][0], (q,v)=>q.tube[0][0]=v),
      champ('p0y','y départ',-20,20,0.01, q=>q.tube[0][1], (q,v)=>q.tube[0][1]=v),
      champ('p0z','z départ',-20,20,0.01, q=>q.tube[0][2], (q,v)=>q.tube[0][2]=v),
      champ('p1x','x arrivée',-20,20,0.01, q=>q.tube[2][0], (q,v)=>q.tube[2][0]=v),
      champ('p1y','y arrivée',-20,20,0.01, q=>q.tube[2][1], (q,v)=>q.tube[2][1]=v),
      champ('p1z','z arrivée',-20,20,0.01, q=>q.tube[2][2], (q,v)=>q.tube[2][2]=v),
      champ('r0','rayon départ',0.005,6,0.005, q=>q.tube[1], (q,v)=>q.tube[1]=v),
      champ('r1','rayon arrivée',0.005,6,0.005, q=>q.tube[3], (q,v)=>q.tube[3]=v),
      champ('nc','côtés',3,24,1, q=>q.tube[4]||6,
            (q,v)=>q.tube[4]=Math.max(3, Math.round(v))),
    ],
  },

  roche: {
    nom: 'Roche',
    aide: 'Un icosaèdre bruité. La seule forme sans arêtes vives du moteur. '
        + '20 triangles, 80 si on subdivise.',
    creer: () => ({roche:[0.35, 1, 0], x:0, y:0.35, z:0, emis:0,
                   c:[0.24,0.23,0.21]}),
    reconnait: q => !!q.roche,
    champs: [...POSITION,
      champ('rayon','rayon', 0.03, 8, 0.01, q=>q.roche[0], (q,v)=>q.roche[0]=v),
      champ('graine','graine', 1, 999, 1, q=>q.roche[1],
            (q,v)=>q.roche[1]=Math.round(v)),
      champ('sub','subdivision', 0, 1, 1, q=>q.roche[2],
            (q,v)=>q.roche[2]=(v>0.5?1:0)),
    ],
  },
};

export const ORDRE = ['bloc', 'coin', 'plaque', 'tube', 'roche'];

/** Le nom de forme d'une part. */
export function formeDe(q){
  if(!q) return null;
  for(const k of ORDRE) if(k !== 'bloc' && PRIMITIVES[k].reconnait(q)) return k;
  return 'bloc';
}

/** Une part neuve de la forme demandée. */
export function creer(forme){
  const d = PRIMITIVES[forme];
  return d ? d.creer() : PRIMITIVES.bloc.creer();
}

/**
 * Convertit une part d'une forme vers une autre en gardant ce qui a un sens.
 *
 * Utile plus souvent qu'il n'y paraît : on pose une boîte, on se rend compte
 * qu'un coin irait mieux, et on ne veut pas ressaisir six nombres. Ce qui ne
 * se traduit pas — le rayon d'un tube vers les côtés d'une boîte — est
 * approché plutôt qu'abandonné.
 */
export function convertir(q, versForme){
  const c = q.c ? q.c.slice() : [0.28,0.26,0.23];
  const emis = q.emis || 0;
  const n = creer(versForme);
  n.c = c; n.emis = emis;

  // récupérer un centre et une taille approximatifs, quelle que soit l'origine
  let cx, cy, cz, tx, ty, tz;
  if(q.tube){
    const [p0, r0, p1, r1] = q.tube;
    cx = (p0[0]+p1[0])/2; cy = (p0[1]+p1[1])/2; cz = (p0[2]+p1[2])/2;
    const L = Math.hypot(p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]);
    tx = tz = Math.max(r0, r1) * 2; ty = L || 0.2;
  } else if(q.roche){
    cx = q.x; cy = q.y; cz = q.z;
    tx = ty = tz = q.roche[0] * 2;
  } else {
    cx = q.x; cy = q.y; cz = q.z;
    tx = q.sx || 0.3; ty = q.sy || 0.3; tz = q.sz || 0.3;
  }

  if(versForme === 'tube'){
    n.tube = [[cx, cy - ty/2, cz], Math.max(tx, tz)/2,
              [cx, cy + ty/2, cz], Math.max(tx, tz)/2 * 0.7, 6];
    return n;
  }
  n.x = cx; n.y = cy; n.z = cz;
  if(versForme === 'roche'){
    n.roche = [Math.max(tx, ty, tz)/2, (q.roche ? q.roche[1] : 1), 0];
    return n;
  }
  n.sx = tx; n.sy = ty;
  if(versForme !== 'plaque') n.sz = tz;
  n.r = q.r || 0; n.ry = q.ry || 0;
  if(versForme === 'coin') n.coin = q.coin || 1;
  return n;
}

/** Le centre d'une part, quelle que soit sa forme. Sert au pivot et au clic. */
export function centreDe(q){
  if(!q) return [0,0,0];
  if(q.tube) return [(q.tube[0][0]+q.tube[2][0])/2,
                     (q.tube[0][1]+q.tube[2][1])/2,
                     (q.tube[0][2]+q.tube[2][2])/2];
  return [q.x, q.y, q.z];
}

/** Un rayon englobant, pour désigner une part au clic. */
export function rayonDe(q){
  if(!q) return 0;
  if(q.tube){
    const [p0, r0, p1, r1] = q.tube;
    return Math.hypot(p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2])/2
         + Math.max(r0, r1);
  }
  if(q.roche) return q.roche[0] * 1.26;
  const e = etenduePart(q);
  return Math.max(e, (q.sy || 0) * 0.5);
}

export {trianglesPart};
