/* ═══ ÉDITEUR / MODIFICATEURS ═══
   Ce qui transforme un empilement de blocs en outil de composition.

   ── LE CONSTAT ─────────────────────────────────────────────────────────────
   Poser des primitives une par une, on y arrive pour un caillou. Pas pour une
   grille de barreaux, une cage thoracique, une palissade, un escalier, un tas
   d'éboulis. Ces objets-là ont une RÈGLE : « la même chose, dix fois, en
   tournant un peu ». Les décrire sommet par sommet, c'est copier-coller sa
   propre règle à la main — long, et impossible à corriger après coup.

   ── LE PRINCIPE ────────────────────────────────────────────────────────────
   Une pile de modificateurs s'applique aux parts de base :

       base ─▶ miroir ─▶ réseau ×8 ─▶ bruit ─▶ parts finales

   La base reste modifiable : on change une dimension et les dix copies
   suivent. On désactive un modificateur d'une case à cocher pour voir ce
   qu'il fait. On change son ordre dans la pile et le résultat change — un
   miroir après un réseau ne donne pas la même chose qu'avant.

   ── DÉTERMINISME ───────────────────────────────────────────────────────────
   Tout ce qui tire au sort le fait sur une graine locale, jamais sur le
   générateur du monde. Deux raisons : un asset doit être identique d'une
   session à l'autre, et régler un modificateur pendant que le monde se génère
   ne doit pas décaler le monde.

   ── CE QUI SORT ────────────────────────────────────────────────────────────
   Des parts ordinaires, exactement celles que `monde/formes.js` sait cuire.
   Les modificateurs n'existent que dans la forge : le code écrit dans
   `props.js` contient le RÉSULTAT, pas la recette. Le jeu ne charge rien à
   l'exécution, et cette propriété-là ne se négocie pas.                     */

import {etenduePart, trianglesPart} from '../monde/formes.js';

/** Au-delà, on refuse : un réseau de 40 × un réseau de 40 fige la page. */
export const MAX_PARTS = 6000;

/* ─────────────── petit générateur local ───────────────
   mulberry32 : trois lignes, très bonne distribution, et surtout reproductible
   à l'identique. On ne touche pas à noyau/rng.js, qui appartient au monde. */
function alea(graine){
  let a = (graine >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const copier = q => JSON.parse(JSON.stringify(q));

/* ═══════════════ TRANSFORMATION D'UNE PART ═══════════════ */

/**
 * Déplace, tourne et redimensionne une part, quelle que soit sa forme.
 *
 * C'est la seule fonction du fichier qui connaît les cinq formes ; tous les
 * modificateurs passent par elle. En ajouter une sixième ne demandera de
 * toucher qu'ici.
 *
 * @param T {t:[x,y,z], ry, echelle, pivot:[x,y,z]}
 *          L'ordre est : on retire le pivot, on met à l'échelle, on tourne
 *          autour de la verticale, on remet le pivot, on translate.
 */
export function transformer(q, T){
  const t = T.t || [0,0,0];
  const e = (T.echelle === undefined) ? 1 : T.echelle;
  const ry = T.ry || 0;
  const pv = T.pivot || [0,0,0];
  const cs = Math.cos(ry), sn = Math.sin(ry);

  const point = (p) => {
    let x = (p[0] - pv[0]) * e, y = (p[1] - pv[1]) * e, z = (p[2] - pv[2]) * e;
    if(ry){ const u = x; x = u*cs - z*sn; z = u*sn + z*cs; }
    return [x + pv[0] + t[0], y + pv[1] + t[1], z + pv[2] + t[2]];
  };

  if(q.tube){
    const [p0, r0, p1, r1, n] = q.tube;
    q.tube = [point(p0), r0 * e, point(p1), r1 * e, n];
    return q;
  }

  const p = point([q.x, q.y, q.z]);
  q.x = p[0]; q.y = p[1]; q.z = p[2];

  if(q.roche){ q.roche = [q.roche[0] * e, q.roche[1], q.roche[2]]; return q; }

  if(q.sx !== undefined) q.sx *= e;
  if(q.sy !== undefined) q.sy *= e;
  if(q.sz !== undefined) q.sz *= e;
  // Le lacet s'ajoute : une boîte déjà tournée de 30° puis pivotée de 90°
  // se retrouve à 120°, ce qui est la seule lecture qui ne surprenne pas.
  if(ry) q.ry = (q.ry || 0) + ry;
  return q;
}

/**
 * Reflète une part dans un plan vertical.
 *
 * Aucun problème d'orientation des faces ici, et ce n'est pas un hasard :
 * les primitives fabriquent leurs normales à partir de leurs PARAMÈTRES, pas
 * de l'ordre des sommets. Refléter revient donc à refléter les paramètres —
 * la position, le sens de l'inclinaison, celui du coin — et la forme
 * ressort correcte. Un moteur qui stockerait des maillages devrait, lui,
 * inverser l'ordre des triangles un par un.
 */
export function refleter(q, axe, pivot){
  const k = (axe === 'z') ? 2 : 0;
  const nom = k ? 'z' : 'x';

  if(q.tube){
    const t = q.tube;
    t[0][k] = 2*pivot - t[0][k];
    t[2][k] = 2*pivot - t[2][k];
    return q;
  }
  q[nom] = 2*pivot - q[nom];
  if(q.roche) return q;

  // Un lacet devient son opposé dans les deux cas ; l'inclinaison, qui vit
  // dans le plan XY, ne s'inverse que par un miroir en X.
  if(q.ry) q.ry = -q.ry;
  if(k === 0){
    if(q.r) q.r = -q.r;
    if(q.coin) q.coin = -q.coin;
  }
  return q;
}

/* ═══════════════ LES MODIFICATEURS ═══════════════
   Chacun est décrit une fois : son nom, ses réglages avec leurs bornes, et sa
   fonction. Le panneau de la forge est construit à partir de cette table —
   ajouter un modificateur, c'est ajouter une entrée, rien d'autre.          */

export const MODIFS = {

  miroir: {
    nom: 'Miroir',
    aide: 'Duplique en symétrie. La base d\'à peu près tout ce qui est bâti.',
    defauts: {axe:'x', pivot:0, garderBase:true},
    reglages: [
      ['axe',    'liste',  ['x','z'],       'axe'],
      ['pivot',  'nombre', [-8, 8, 0.05],   'position du plan'],
      ['garderBase', 'case', null,          'garder l\'original'],
    ],
    appliquer(parts, r){
      const sortie = r.garderBase ? parts.map(copier) : [];
      for(const q of parts) sortie.push(refleter(copier(q), r.axe, r.pivot));
      return sortie;
    },
  },

  reseau: {
    nom: 'Réseau',
    aide: 'N copies en ligne. Barreaux, marches, traverses, palissades.',
    defauts: {n:5, dx:0.5, dy:0, dz:0, dry:0, dechelle:1},
    reglages: [
      ['n',        'nombre', [1, 64, 1],       'copies'],
      ['dx',       'nombre', [-4, 4, 0.01],    'pas en X'],
      ['dy',       'nombre', [-4, 4, 0.01],    'pas en Y'],
      ['dz',       'nombre', [-4, 4, 0.01],    'pas en Z'],
      ['dry',      'nombre', [-1.6, 1.6, 0.01],'rotation par copie'],
      ['dechelle', 'nombre', [0.5, 1.5, 0.01], 'échelle par copie'],
    ],
    appliquer(parts, r){
      const sortie = [];
      const n = Math.max(1, Math.round(r.n));
      for(let i = 0; i < n; i++){
        for(const q of parts) sortie.push(transformer(copier(q), {
          t: [r.dx*i, r.dy*i, r.dz*i],
          ry: r.dry * i,
          echelle: Math.pow(r.dechelle, i),
          // pivot au point de départ : l'échelle et la rotation s'accumulent
          // autour de l'origine de l'objet, pas de chaque copie
          pivot: [0, 0, 0],
        }));
      }
      return sortie;
    },
  },

  radial: {
    nom: 'Radial',
    aide: 'N copies en couronne. Côtes, roues, couronnes, pattes.',
    defauts: {n:8, rayon:0.8, arc:6.283185, orienter:true, dy:0},
    reglages: [
      ['n',        'nombre', [2, 48, 1],        'copies'],
      ['rayon',    'nombre', [0, 6, 0.02],      'rayon'],
      ['arc',      'nombre', [0.2, 6.29, 0.05], 'arc couvert'],
      ['dy',       'nombre', [-2, 2, 0.02],     'montée par copie'],
      ['orienter', 'case',   null,              'orienter vers l\'extérieur'],
    ],
    appliquer(parts, r){
      const sortie = [];
      const n = Math.max(2, Math.round(r.n));
      // Sur un tour complet, la dernière copie retomberait sur la première.
      const complet = Math.abs(r.arc - 6.283185) < 0.01;
      const pas = r.arc / (complet ? n : Math.max(1, n - 1));
      for(let i = 0; i < n; i++){
        const a = pas * i;
        for(const q of parts) sortie.push(transformer(copier(q), {
          t: [Math.cos(a) * r.rayon, r.dy * i, Math.sin(a) * r.rayon],
          ry: r.orienter ? -a : 0,
          pivot: [0, 0, 0],
        }));
      }
      return sortie;
    },
  },

  dispersion: {
    nom: 'Dispersion',
    aide: 'N copies au hasard dans un disque. Éboulis, ossements, débris.',
    defauts: {n:12, rayon:1.2, graine:1, hauteur:0.15,
              echMin:0.6, echMax:1.4, tourner:true, garderBase:false},
    reglages: [
      ['n',       'nombre', [1, 200, 1],     'copies'],
      ['rayon',   'nombre', [0.1, 12, 0.05], 'rayon du disque'],
      ['hauteur', 'nombre', [0, 3, 0.02],    'dispersion verticale'],
      ['echMin',  'nombre', [0.1, 2, 0.02],  'échelle mini'],
      ['echMax',  'nombre', [0.1, 3, 0.02],  'échelle maxi'],
      ['graine',  'nombre', [1, 999, 1],     'graine'],
      ['tourner', 'case',   null,            'orientation au hasard'],
      ['garderBase', 'case', null,           'garder l\'original'],
    ],
    appliquer(parts, r){
      const rnd = alea(r.graine * 2654435761);
      const sortie = r.garderBase ? parts.map(copier) : [];
      const n = Math.max(1, Math.round(r.n));
      for(let i = 0; i < n; i++){
        // racine carrée du tirage : sans elle, tout s'agglutine au centre,
        // parce qu'un disque a plus de surface sur ses bords
        const d = Math.sqrt(rnd()) * r.rayon;
        const a = rnd() * 6.283185;
        const e = r.echMin + rnd() * Math.max(0, r.echMax - r.echMin);
        for(const q of parts) sortie.push(transformer(copier(q), {
          t: [Math.cos(a)*d, (rnd()-0.5)*2*r.hauteur, Math.sin(a)*d],
          ry: r.tourner ? rnd() * 6.283185 : 0,
          echelle: e,
          pivot: [0, 0, 0],
        }));
      }
      return sortie;
    },
  },

  bruit: {
    nom: 'Bruit',
    aide: 'Dérègle chaque part un peu. Ce qui sépare le bâti du fabriqué.',
    defauts: {graine:1, pos:0.04, ry:0.12, echelle:0.08},
    reglages: [
      ['pos',     'nombre', [0, 1, 0.005],   'position'],
      ['ry',      'nombre', [0, 1.6, 0.01],  'rotation'],
      ['echelle', 'nombre', [0, 0.8, 0.005], 'échelle'],
      ['graine',  'nombre', [1, 999, 1],     'graine'],
    ],
    appliquer(parts, r){
      const rnd = alea(r.graine * 40503);
      return parts.map(q => transformer(copier(q), {
        t: [(rnd()-0.5)*2*r.pos, (rnd()-0.5)*2*r.pos, (rnd()-0.5)*2*r.pos],
        ry: (rnd()-0.5)*2*r.ry,
        echelle: 1 + (rnd()-0.5)*2*r.echelle,
        pivot: [q.tube ? q.tube[0][0] : q.x, q.tube ? q.tube[0][1] : q.y,
                q.tube ? q.tube[0][2] : q.z],
      }));
    },
  },
};

/** Une entrée de pile toute neuve, avec ses valeurs par défaut. */
export function modifNeuf(type){
  const d = MODIFS[type];
  if(!d) throw new Error('modificateur inconnu : ' + type);
  return {type, actif: true, ...JSON.parse(JSON.stringify(d.defauts))};
}

/* ═══════════════ ÉVALUATION DE LA PILE ═══════════════ */

/**
 * Applique la pile aux parts de base.
 *
 * Renvoie `{parts, triangles, tronque, etapes}`. `etapes` dit combien de parts
 * chaque modificateur a produit : c'est ce qui permet de comprendre d'où
 * viennent quatre mille triangles quand on n'en attendait que deux cents.
 *
 * En cas de dépassement on TRONQUE au lieu de refuser. Une pile qui explose
 * est une pile qu'on est en train de régler ; couper net et le dire laisse
 * continuer, alors qu'une page figée oblige à tout recharger.
 */
export function evaluer(base, pile){
  let parts = base.map(copier);
  const etapes = [];
  let tronque = false;

  for(const m of pile || []){
    if(!m || !m.actif) continue;
    const d = MODIFS[m.type];
    if(!d){ etapes.push({type:m.type, erreur:'inconnu'}); continue; }

    let sortie;
    try{
      sortie = d.appliquer(parts, m) || [];
    }catch(e){
      etapes.push({type:m.type, erreur:e.message});
      continue;
    }

    if(sortie.length > MAX_PARTS){
      sortie = sortie.slice(0, MAX_PARTS);
      tronque = true;
    }
    parts = sortie;
    etapes.push({type:m.type, parts:parts.length});
    if(tronque) break;
  }

  let triangles = 0;
  for(const q of parts) triangles += trianglesPart(q);
  return {parts, triangles, tronque, etapes};
}

/** Boîte englobante d'une liste de parts. Sert au cadrage et à la sélection. */
export function bornesDe(parts){
  if(!parts || !parts.length)
    return {min:[0,0,0], max:[0,1,0], centre:[0,0.5,0], rayon:1, taille:[0,1,0]};
  const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  const voir = (x,y,z,r) => {
    mn[0]=Math.min(mn[0],x-r); mn[1]=Math.min(mn[1],y-r); mn[2]=Math.min(mn[2],z-r);
    mx[0]=Math.max(mx[0],x+r); mx[1]=Math.max(mx[1],y+r); mx[2]=Math.max(mx[2],z+r);
  };
  for(const q of parts){
    if(!q) continue;
    if(q.tube){
      voir(q.tube[0][0], q.tube[0][1], q.tube[0][2], q.tube[1]);
      voir(q.tube[2][0], q.tube[2][1], q.tube[2][2], q.tube[3]);
    } else {
      const e = etenduePart(q);
      const hy = q.roche ? q.roche[0]*1.26 : (q.sy || 0) * 0.5;
      voir(q.x, q.y, q.z, 0);
      voir(q.x, q.y, q.z, Math.max(e, hy));
    }
  }
  const centre = [(mn[0]+mx[0])/2, (mn[1]+mx[1])/2, (mn[2]+mx[2])/2];
  const taille = [mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]];
  return {min:mn, max:mx, centre, taille,
          rayon: Math.max(taille[0], taille[1], taille[2]) / 2 || 1};
}
