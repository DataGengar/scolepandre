/* ═══ MONDE / FORMES ═══
   Le vocabulaire de primitives du moteur. Cinq formes, et rien d'autre.

   ── POURQUOI UN MODULE À PART ──────────────────────────────────────────────
   Ces fonctions étaient dans maillage.js, qui les utilise pour cuire les pavés.
   Mais props.js en a besoin aussi (pour mesurer un élément), et la forge encore
   plus — d'où un cycle props → maillage → props le jour où on a branché la
   mesure. Le vocabulaire n'a aucune dépendance : il descend donc d'un cran, et
   tout le monde peut l'importer sans se croiser.

   ── LA CONVENTION ──────────────────────────────────────────────────────────
   Une PART est un objet simple. Sa forme se lit à la clé qu'elle porte :

     {x,y,z, sx,sy,sz, c, r?, ry?, emis?}          bloc      12 triangles
     {coin:±1, x,y,z, sx,sy,sz, c, r?, ry?}        coin       8
     {plaque:1, x,y,z, sx,sy, c, r?, ry?}          plaque     4
     {tube:[p0,r0,p1,r1,cotes], c, emis?}          tube       4×côtés
     {roche:[rayon,graine,subdiv], x,y,z, c}       roche     20 ou 80

   Pas de champ `type` : la clé suffit, et l'ancien décor continue de marcher
   sans être touché. `r` incline dans le plan XY, `ry` fait pivoter autour de
   la verticale, `emis` rend la part lumineuse.

   Toutes écrivent par un `quad(points, normale, couleurs)` fourni par
   l'appelant — c'est ce qui permet à la même primitive de servir au pavé du
   jeu et à l'aperçu de la forge.                                            */

import {hash2} from '../noyau/math.js';

/**
 * Boîte orientée. `r` l'incline dans le plan XY, `ry` la fait pivoter autour
 * de la verticale.
 *
 * `ry` est une addition de la v3.4. Jusque-là une boîte ne pouvait QUE
 * s'incliner : impossible de poser une caisse de biais, ni d'orienter une
 * maison autrement que face au nord. On composait donc tout sur les axes, ce
 * qui se voit. Le champ est optionnel et le chemin sans lacet reste identique
 * au précédent, y compris en coût.
 */
export function cuireBoite(quad, q){
  const co = Math.cos(q.r||0), si = Math.sin(q.r||0);
  const cy = Math.cos(q.ry||0), sy = Math.sin(q.ry||0);
  const hx = q.sx/2, hy = q.sy/2, hz = q.sz/2;
  const V = (ux,uy,uz) => {
    const X = ux*hx, Y = uy*hy, Z = uz*hz;
    let x = X*co - Y*si, y = X*si + Y*co, z = Z;
    if(q.ry){ const t = x; x = t*cy - z*sy; z = t*sy + z*cy; }
    return [q.x + x, q.y + y, q.z + z];
  };
  // La normale subit le même lacet que le sommet, sinon l'éclairage trahit
  // l'orientation d'origine et la boîte paraît mal posée.
  const N = q.ry
    ? (n => [n[0]*cy - n[2]*sy, n[1], n[0]*sy + n[2]*cy])
    : (n => n);
  const F = [
    [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1],[0,0,1]],
    [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1],[0,0,-1]],
    [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1],[co,si,0]],
    [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1],[-co,-si,0]],
    [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1],[-si,co,0]],
    [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[si,-co,0]],
  ];
  for(const f of F)
    quad([V(...f[0]),V(...f[1]),V(...f[2]),V(...f[3])], N(f[4]), [q.c,q.c,q.c,q.c]);
}

/** Prisme effilé à N côtés entre deux points. C'est la primitive qui fait
    monter le polycount du décor : troncs, os, cristaux, cannelures. */
export function cuireTube(quad, q){
  const [p0, r0, p1, r1, cotes] = q.tube;
  let ax = p1[0]-p0[0], ay = p1[1]-p0[1], az = p1[2]-p0[2];
  const L = Math.hypot(ax,ay,az) || 1e-4; ax/=L; ay/=L; az/=L;
  let ux=0, uy=1, uz=0;
  if(Math.abs(ay) > 0.94){ ux=1; uy=0; }
  let sx = uy*az - uz*ay, sy = uz*ax - ux*az, sz = ux*ay - uy*ax;
  const SL = Math.hypot(sx,sy,sz) || 1; sx/=SL; sy/=SL; sz/=SL;
  const tx = ay*sz - az*sy, ty = az*sx - ax*sz, tz = ax*sy - ay*sx;
  const P = (p,r,cs,sn) => [p[0]+sx*cs*r+tx*sn*r, p[1]+sy*cs*r+ty*sn*r, p[2]+sz*cs*r+tz*sn*r];
  const NC = cotes || 6, A=[], B=[];
  for(let k=0;k<NC;k++){
    const a = (k+0.5)/NC*6.283185, cs = Math.cos(a), sn = Math.sin(a);
    A.push(P(p0,r0,cs,sn)); B.push(P(p1,r1,cs,sn));
  }
  for(let k=0;k<NC;k++){ const j=(k+1)%NC; quad([A[k],A[j],B[j],B[k]],[0,1,0],[q.c,q.c,q.c,q.c]); }
  // bouchon supérieur, en éventail
  for(let k=1;k<NC-1;k++) quad([B[0],B[k],B[k+1],B[0]],[0,1,0],[q.c,q.c,q.c,q.c]);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PRIMITIVES SUPPLÉMENTAIRES
   ───────────────────────────────────────────────────────────────────────────
   Le décor n'avait que deux formes : la boîte et le prisme. Ça suffit pour
   bâtir, pas pour sculpter — d'où les monolithes qui restent des boîtes et les
   gravats qui ressemblent à des dés.

   Trois formes s'ajoutent, choisies pour ce qui manquait réellement :

     COIN     un prisme triangulaire — toits, éboulis, appuis, rampes.
     PLAQUE   un quadrilatère sans épaisseur — 4 triangles au lieu de 12.
              C'est la réponse à « les objets à ramasser doivent être fins » :
              une planche vue de près n'a pas besoin de six faces.
     ROCHE    un icosaèdre bruité. La seule forme non anguleuse du moteur, et
              celle qui manquait le plus : une pierre n'a pas d'arêtes vives.

   Toutes suivent la même convention que les anciennes : le `quad` reçu écrit
   dans le tampon du pavé, la normale est plate, la couleur est aux sommets.
   Une part est reconnue par la clé qu'elle porte (`tube`, `coin`, `plaque`,
   `roche`) — pas de champ `type`, pour ne rien casser de l'existant.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Applique le lacet `ry` (autour de la verticale) à un point local. */
function lacet(p, cs, sn){
  return [p[0]*cs - p[2]*sn, p[1], p[0]*sn + p[2]*cs];
}

/**
 * Prisme triangulaire. Section droite dans le plan XY, extrudée sur Z.
 *
 * `q.coin` vaut 1 (montée vers +X) ou -1 (vers -X). Le reste — x y z, sx sy sz,
 * r, ry — se lit comme une boîte, ce qui permet de transformer l'un en l'autre
 * sans réécrire les champs.
 */
export function cuireCoin(quad, q){
  const co = Math.cos(q.r||0), si = Math.sin(q.r||0);
  const cy = Math.cos(q.ry||0), sy = Math.sin(q.ry||0);
  const hx = q.sx/2, hy = q.sy/2, hz = q.sz/2;
  const sens = (q.coin < 0) ? -1 : 1;

  const V = (ux, uy, uz) => {
    let X = ux*hx, Y = uy*hy, Z = uz*hz;
    // inclinaison dans le plan XY, comme cuireBoite
    let x = X*co - Y*si, y = X*si + Y*co, z = Z;
    if(q.ry){ const p = lacet([x,y,z], cy, sy); x=p[0]; y=p[1]; z=p[2]; }
    return [q.x + x, q.y + y, q.z + z];
  };

  const b = sens;                       // le côté haut
  // les six sommets : quatre en bas, deux en haut du côté `b`
  const A0 = V(-b,-1, 1), A1 = V( b,-1, 1), A2 = V( b, 1, 1);   // face +Z
  const B0 = V(-b,-1,-1), B1 = V( b,-1,-1), B2 = V( b, 1,-1);   // face -Z

  const c4 = [q.c,q.c,q.c,q.c];
  // dessous
  quad([A0, B0, B1, A1], [0,-1,0], c4);
  // dos vertical (côté haut)
  quad([A1, B1, B2, A2], [b*co, b*si, 0], c4);
  // la pente : sa normale est perpendiculaire à l'arête A0→A2
  let nx = (A2[1]-A0[1]), ny = -(A2[0]-A0[0]), nz = 0;
  const nl = Math.hypot(nx, ny) || 1;
  nx = nx/nl*b; ny = ny/nl*b;
  if(q.ry){ const p = lacet([nx,ny,nz], cy, sy); nx=p[0]; ny=p[1]; nz=p[2]; }
  quad([A0, A2, B2, B0], [nx, ny, nz], c4);
  // les deux flancs triangulaires (un quad dégénéré, comme le bouchon du tube)
  quad([A0, A1, A2, A0], [ sy, 0,  cy], c4);
  quad([B2, B1, B0, B2], [-sy, 0, -cy], c4);
}

/**
 * Quadrilatère plat, visible des deux côtés. 4 triangles.
 *
 * `sx` × `sy` dans son plan, orienté par `r` (inclinaison) puis `ry` (lacet).
 * Sans épaisseur : c'est fait pour les panneaux, les planches, les feuilles de
 * tôle — tout ce qu'une boîte de 2 cm d'épaisseur rendrait huit fois plus cher
 * pour un résultat identique à trois mètres.
 */
export function cuirePlaque(quad, q){
  const co = Math.cos(q.r||0), si = Math.sin(q.r||0);
  const cy = Math.cos(q.ry||0), sy = Math.sin(q.ry||0);
  const hx = q.sx/2, hy = q.sy/2;
  const V = (ux, uy) => {
    const X = ux*hx, Y = uy*hy;
    let x = X*co - Y*si, y = X*si + Y*co, z = 0;
    if(q.ry){ const p = lacet([x,y,z], cy, sy); x=p[0]; y=p[1]; z=p[2]; }
    return [q.x + x, q.y + y, q.z + z];
  };
  const P0 = V(-1,-1), P1 = V(1,-1), P2 = V(1,1), P3 = V(-1,1);
  const c4 = [q.c,q.c,q.c,q.c];
  quad([P0, P1, P2, P3], [ sy, 0,  cy], c4);
  quad([P3, P2, P1, P0], [-sy, 0, -cy], c4);   // le dos, sinon elle disparaît
}

/* ── icosaèdre : 12 sommets, 20 faces. Calculé une fois. ── */
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V = [
  [-1, PHI, 0],[1, PHI, 0],[-1,-PHI, 0],[1,-PHI, 0],
  [0,-1, PHI],[0, 1, PHI],[0,-1,-PHI],[0, 1,-PHI],
  [ PHI, 0,-1],[ PHI, 0, 1],[-PHI, 0,-1],[-PHI, 0, 1],
].map(v => { const L = Math.hypot(v[0],v[1],v[2]); return [v[0]/L, v[1]/L, v[2]/L]; });
const ICO_F = [
  [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
  [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
  [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
  [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
];

/**
 * Pierre : un icosaèdre dont chaque sommet est repoussé au hasard.
 *
 * `q.roche = [rayon, graine, subdivisions]`. Sans subdivision, 20 triangles ;
 * avec une, 80. On reste bas exprès — une pierre lue à travers le brouillard
 * n'a pas besoin de plus, et le décor en pose des milliers.
 *
 * Le bruit est déterministe (hash de l'indice du sommet et de la graine) :
 * deux pierres de même graine sont identiques, ce qui permet de la régler dans
 * la forge et de la retrouver telle quelle en jeu.
 */
export function cuireRoche(quad, q){
  const [ray, gr, sub] = q.roche;
  const graine = (gr|0) * 0.61803398875;

  // déformation radiale d'un sommet unitaire, stable pour une direction donnée
  const pousser = (v) => {
    const b = hash2(v[0]*7.3 + graine, v[2]*5.9 - v[1]*3.1 + graine);
    const k = ray * (0.74 + b * 0.52);
    return [q.x + v[0]*k, q.y + v[1]*k, q.z + v[2]*k];
  };
  const milieu = (a, b) => {
    const m = [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
    const L = Math.hypot(m[0],m[1],m[2]) || 1;
    return [m[0]/L, m[1]/L, m[2]/L];
  };

  const c4 = [q.c,q.c,q.c,q.c];
  const face = (a, b, c) => {
    const A = pousser(a), B = pousser(b), C = pousser(c);
    // normale plate, par produit vectoriel — la forme est trop irrégulière
    // pour qu'une normale radiale donne un résultat correct
    const ux=B[0]-A[0], uy=B[1]-A[1], uz=B[2]-A[2];
    const vx=C[0]-A[0], vy=C[1]-A[1], vz=C[2]-A[2];
    let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const L = Math.hypot(nx,ny,nz) || 1;
    quad([A, B, C, A], [nx/L, ny/L, nz/L], c4);
  };

  for(const f of ICO_F){
    const a = ICO_V[f[0]], b = ICO_V[f[1]], c = ICO_V[f[2]];
    if(sub > 0){
      const ab = milieu(a,b), bc = milieu(b,c), ca = milieu(c,a);
      face(a,ab,ca); face(ab,b,bc); face(ca,bc,c); face(ab,bc,ca);
    } else face(a,b,c);
  }
}

/**
 * Le nombre de triangles d'une part, sans la cuire. C'est le budget.
 *
 * Les chiffres sont ceux que le GPU voit réellement, bouchons et flancs
 * compris — vérifié sommet par sommet par outils/smoke_formes.py. Un tube à
 * N côtés fait 2N triangles de paroi plus N−2 pour son unique bouchon.
 */
export function trianglesPart(q){
  if(!q) return 0;
  if(q.tube)   return 3 * (q.tube[4] || 6) - 2;
  if(q.roche)  return (q.roche[2] > 0 ? 80 : 20);
  if(q.plaque) return 4;
  if(q.coin)   return 8;
  return 12;
}

/**
 * L'ÉPAISSEUR d'une part : de quoi juger si elle bouche une cellule.
 *
 * Ce n'est délibérément PAS son étendue. Pour un tube, c'est son rayon, même
 * s'il traverse la cellule en diagonale : `props.js` s'en sert pour poser un
 * collisionneur au centre de la cellule, et un tronc couché ne doit pas
 * condamner tout le voisinage. Pour l'étendue réelle — cadrage, sélection,
 * boîte englobante — voir `etenduePart()`.
 */
export function rayonPart(q){
  if(!q) return 0;
  if(q.tube)   return Math.max(q.tube[1], q.tube[3]);
  if(q.roche)  return q.roche[0] * 1.26;      // 0.74 + 0.52 au pire
  if(q.plaque) return Math.max(q.sx, q.sy) * 0.5;
  return Math.max(q.sx, q.sz) * 0.5;
}

/**
 * L'étendue horizontale réelle, inclinaison et lacet compris.
 *
 * Majorant, jamais minorant : la forge s'en sert pour cadrer la caméra et
 * pour choisir ce que le clic a désigné. Une valeur trop petite ferait sortir
 * l'objet du cadre et rendrait certaines parts impossibles à sélectionner.
 */
export function etenduePart(q){
  if(!q) return 0;
  if(q.tube){
    const [p0, r0, p1, r1] = q.tube;
    return Math.max(Math.abs(p1[0]-p0[0]), Math.abs(p1[2]-p0[2])) / 2
         + Math.max(r0, r1);
  }
  if(q.roche) return q.roche[0] * 1.26;
  // Boîte, coin, plaque : l'inclinaison `r` mêle sx et sy, le lacet `ry` mêle
  // les deux axes horizontaux. On majore par la demi-diagonale du résultat.
  const co = Math.abs(Math.cos(q.r||0)), si = Math.abs(Math.sin(q.r||0));
  const ex = (q.sx||0)*co + (q.sy||0)*si;      // étendue sur X après inclinaison
  const ez = q.plaque ? 0 : (q.sz||0);
  if(q.ry) return Math.hypot(ex, ez) / 2;
  return Math.max(ex, ez) / 2;
}

/* ═══════════════ LA HITBOX D'UNE PART ═══════════════
   « Les hitbox sont trop grosses et ne correspondent pas à l'objet. » C'était
   exact, et la cause tenait en une ligne de props.js : un élément de décor
   entier — dix, vingt parts — recevait UN SEUL cercle, de rayon égal à sa
   part la plus large, plafonné à 1,40 m, posé au sol et sans hauteur.

   Conséquences, toutes vérifiables en jeu :
     · une poutre suspendue à quatre mètres bloquait au niveau du sol ;
     · un lampadaire bloquait sur le rayon de sa CROSSE, à sept mètres de
       haut, soit un mètre autour du mât ;
     · une voiture couchée bloquait un disque d'1,40 m alors qu'elle est
       longue et étroite ;
     · et le joueur, lui, ne fait que 0,30 m de rayon : ce n'est pas lui qui
       est trop gros.

   Une part est donc mesurée POUR CE QU'ELLE EST : une CAPSULE — un segment
   horizontal, un rayon autour, et l'étage qu'elle occupe.

     {x0,z0, x1,z1, r, y0,y1}

   Le segment est l'axe long de la forme, le rayon sa demi-épaisseur. Un mur
   de 5 m sur 26 cm devient un segment de 4,74 m et 13 cm de rayon, et non un
   disque de 2,5 m. Une colonne devient un disque de son vrai rayon. Et `y0`
   `y1` disent à quelle hauteur ça se passe : on enjambe ce qui est sous le
   pas, on passe sous ce qui est au-dessus de la tête.                       */

/**
 * La capsule de collision d'une part, ou `null` si elle est trop menue pour
 * mériter d'arrêter quelqu'un (éclats de verre, cannelures, brindilles).
 *
 * Écrit dans `out` plutôt que d'allouer : le décor en compte des dizaines de
 * milliers, et cette fonction est appelée une fois par part à la génération.
 */
export function capsulePart(q, out){
  if(!q) return null;
  const o = out || {};

  if(q.tube){
    const [p0, r0, p1, r1] = q.tube;
    const r = Math.max(r0, r1);
    if(r < 0.09) return null;
    o.x0 = p0[0]; o.z0 = p0[2]; o.x1 = p1[0]; o.z1 = p1[2]; o.r = r;
    o.y0 = Math.min(p0[1], p1[1]) - r*0.2;
    o.y1 = Math.max(p0[1], p1[1]) + r*0.2;
    return o;
  }

  if(q.roche){
    const r = q.roche[0];
    if(r < 0.09) return null;
    o.x0 = o.x1 = q.x; o.z0 = o.z1 = q.z; o.r = r;
    o.y0 = q.y - r; o.y1 = q.y + r;
    return o;
  }

  /* Boîte, coin, plaque. La plaque n'a pas d'épaisseur : on lui en donne une
     symbolique, sinon un volet fermé laisserait passer. */
  const sx = q.sx || 0, sy = q.sy || 0, sz = q.plaque ? 0.06 : (q.sz || 0);
  if(Math.max(sx, sz) < 0.18) return null;

  /* L'inclinaison `r` couche la boîte dans le plan XY : la hauteur qu'elle
     occupe réellement mêle sy et sx. On majore, une hitbox trop courte étant
     pire qu'une hitbox trop haute — on traverserait l'objet par le haut. */
  const co = Math.abs(Math.cos(q.r || 0)), si = Math.abs(Math.sin(q.r || 0));
  const hy = (sy*co + sx*si) / 2;
  const ex = sx*co + sy*si;                 // étendue sur X après inclinaison

  // l'axe long, tourné par le lacet
  const cy = Math.cos(q.ry || 0), sn = Math.sin(q.ry || 0);
  let demi, rayon, dx, dz;
  if(ex >= sz){ demi = (ex - sz) / 2; rayon = sz / 2; dx = cy;  dz = sn; }
  else        { demi = (sz - ex) / 2; rayon = ex / 2; dx = -sn; dz = cy; }

  o.x0 = q.x - dx*demi; o.z0 = q.z - dz*demi;
  o.x1 = q.x + dx*demi; o.z1 = q.z + dz*demi;
  o.r = Math.max(0.05, rayon);
  o.y0 = q.y - hy; o.y1 = q.y + hy;
  return o;
}

/** Le répartiteur : une part, la bonne primitive. Un seul endroit à toucher
    quand une forme s'ajoute — le pavé et la forge passent tous deux par ici. */
export function cuirePart(quad, q){
  if(!q) return;
  if(q.tube)        cuireTube(quad, q);
  else if(q.roche)  cuireRoche(quad, q);
  else if(q.plaque) cuirePlaque(quad, q);
  else if(q.coin)   cuireCoin(quad, q);
  else              cuireBoite(quad, q);
}
