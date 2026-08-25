/* ═══ MONDE / ÉDIFICES ═══
   Les bâtiments. Pour l'instant : la cathédrale.

   ── POURQUOI UN MODULE À PART ──────────────────────────────────────────────
   `props.js` pose des OBJETS : un pilier, une carcasse, une hutte. Chacun tient
   dans une cellule et se fabrique en une trentaine de primitives. Une
   cathédrale, c'est quarante mètres de long, trois nefs, des tours, et surtout
   PLUSIEURS SOLS EMPILÉS. Ce n'est pas un objet plus gros, c'est autre chose.

   Un édifice :
     · aplanit le terrain sous son emprise, et lève son plafond ;
     · pose ses planchers dans `monde/niveaux.js` — c'est ce qui permet de
       monter dans une tour et de descendre dans une crypte ;
     · pose ses murs comme des TRANCHES d'altitude, si bien qu'on passe sous
       une arche et qu'on bute contre le piédroit ;
     · produit sa géométrie sous forme de parts ordinaires.

   ── L'ARC BRISÉ ────────────────────────────────────────────────────────────
   C'est LE geste gothique, et il ne s'improvise pas. Un arc roman est un
   demi-cercle : sa hauteur est imposée par sa largeur. Un arc brisé est fait
   de DEUX arcs de cercle dont les centres sont écartés sur la ligne d'imposte ;
   on choisit donc sa hauteur indépendamment de sa portée.

   C'est exactement ce qui a permis les cathédrales : des travées de largeurs
   différentes peuvent culminer à la même hauteur, donc on peut voûter un
   rectangle et non plus seulement un carré. Sans cette propriété, une nef
   flanquée de bas-côtés est impossible.

   La conséquence pratique ici : `arcBrise()` prend une portée ET une hauteur,
   et personne d'autre dans ce fichier n'a besoin de savoir comment.         */

import {SETUP} from '../setup.js';
import {rnd, ri, rf} from '../noyau/rng.js';
import {
  GW, GH, CELL, FLOOR, grid, floorH, ceilH, blocked, openN, sky, vide, biome,
  idx, isFloor, c2w, w2c, celluleLibre,
} from './grille.js';
import {poserPlancher, poserDalle, viderNiveaux, statsNiveaux} from './niveaux.js';
import {props, lights} from './props.js';
import {autorise} from './plan.js';

/** [{x, z, y, rayon, type, tours:[…], porte:{x,z}}] */
export const edifices = [];

/* ═══════════════ PRIMITIVES D'ARCHITECTURE ═══════════════ */

/**
 * Un arc brisé, en segments de tube.
 *
 * @param a,b     les deux pieds, en coordonnées monde [x, z]
 * @param yBase   la ligne d'imposte
 * @param haut    la flèche au-dessus de l'imposte
 * @param ep      épaisseur du claveau
 * @param seg     nombre de segments par branche
 *
 * Chaque branche est un arc de cercle dont le centre est sur la ligne
 * d'imposte, du côté OPPOSÉ. Plus le centre est écarté, plus l'arc est aigu :
 * c'est le seul paramètre qui gouverne l'allure.
 */
function arcBrise(parts, a, b, yBase, haut, ep, c, seg = 7){
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const portee = Math.hypot(dx, dz);
  if(portee < 0.2) return;
  const ux = dx / portee, uz = dz / portee;

  /* Le rayon qui fait passer l'arc par le sommet. On le déduit : le centre est
     sur la ligne d'imposte, à `d` du milieu, et l'arc doit atteindre `haut` au
     centre. */
  const demi = portee / 2;
  const R = (haut*haut + demi*demi) / (2 * haut);
  const d = R - demi;                       // écartement des centres

  const branche = (sens) => {
    // le pied de cette branche, et son centre
    const pied = sens > 0 ? a : b;
    const cx = pied[0] + ux * sens * (portee/2 + d) * 0 + (sens > 0 ? a[0] : b[0]) * 0;
    // centre : sur la ligne d'imposte, décalé du pied opposé
    const ox = (sens > 0 ? a[0] : b[0]) + ux * sens * (R - haut) * 0;
    void cx; void ox;
    const centreX = (sens > 0 ? a[0] : b[0]) + ux * sens * (R - demi + demi) * 0;
    void centreX;

    /* Repris simplement : le centre de la branche partant de `pied` est situé
       à distance R de ce pied, le long de la ligne d'imposte, vers l'autre
       pied. L'arc va du pied au sommet. */
    const p0 = sens > 0 ? a : b;
    const s = sens > 0 ? 1 : -1;
    const Cx = p0[0] + ux * s * (R - 0);
    const Cz = p0[1] + uz * s * (R - 0);
    // angle du pied vu du centre, et angle du sommet
    const aPied = Math.atan2(0 - 0, -s);        // le pied est à l'horizontale
    const sommetX = (a[0] + b[0]) / 2, sommetZ = (a[1] + b[1]) / 2;
    const vx = sommetX - Cx, vz = sommetZ - Cz;
    const horiz = Math.hypot(vx, vz);
    const aSommet = Math.atan2(haut, -s * horiz * 0 + (s > 0 ? -horiz : horiz) * -s);
    void aPied; void aSommet;

    /* Paramétrage direct, plus lisible que par angles : on avance du pied vers
       le sommet et on lit la hauteur sur le cercle de centre (Cx, Cz) et de
       rayon R. */
    const pts = [];
    for(let k = 0; k <= seg; k++){
      const t = k / seg;
      // position horizontale, du pied au sommet
      const px = p0[0] + (sommetX - p0[0]) * t;
      const pz = p0[1] + (sommetZ - p0[1]) * t;
      // distance horizontale au centre
      const dh = Math.hypot(px - Cx, pz - Cz);
      const y = yBase + Math.sqrt(Math.max(0, R*R - dh*dh));
      pts.push([px, y, pz]);
    }
    for(let k = 0; k < seg; k++)
      parts.push({tube:[pts[k], ep, pts[k+1], ep, 5], c});
  };

  branche(+1);
  branche(-1);
}

/**
 * Une voûte d'ogives sur une travée rectangulaire.
 *
 * Quatre arcs sur les côtés, DEUX NERVURES DIAGONALES qui se croisent à la
 * clef, et des voûtains entre elles. Ce sont les diagonales qui font la
 * voûte gothique : elles portent, et c'est pour ça qu'on peut évider le reste.
 */
function voute(parts, cx, cz, larg, prof, yBase, fleche, ep, c, cClef){
  const hl = larg/2, hp = prof/2;
  const A = [cx - hl, cz - hp], B = [cx + hl, cz - hp];
  const C = [cx + hl, cz + hp], D = [cx - hl, cz + hp];

  // les quatre arcs de rive
  arcBrise(parts, A, B, yBase, fleche, ep, c, 5);
  arcBrise(parts, D, C, yBase, fleche, ep, c, 5);
  arcBrise(parts, A, D, yBase, fleche, ep, c, 5);
  arcBrise(parts, B, C, yBase, fleche, ep, c, 5);

  /* Les nervures diagonales montent PLUS HAUT : leur portée est la diagonale
     du rectangle, et c'est elle qui fixe la clef. Sans ce surcroît, les
     diagonales passeraient sous les arcs de rive et la voûte serait creuse au
     mauvais endroit. */
  const fd = fleche * 1.22;
  arcBrise(parts, A, C, yBase, fd, ep*0.85, c, 7);
  arcBrise(parts, B, D, yBase, fd, ep*0.85, c, 7);

  // la clef de voûte, à l'intersection
  parts.push({x:cx, y:yBase + fd, z:cz, sx:0.34, sy:0.30, sz:0.34, c:cClef});
}

/** Une colonne composée : un fût central et quatre colonnettes engagées. */
function pilier(parts, x, z, yBase, haut, r, c){
  parts.push({tube:[[x, yBase, z], r, [x, yBase + haut, z], r*0.94, 8], c});
  for(let k = 0; k < 4; k++){
    const a = k * Math.PI/2 + Math.PI/4;
    const px = x + Math.cos(a)*r*0.92, pz = z + Math.sin(a)*r*0.92;
    parts.push({tube:[[px, yBase, pz], r*0.30,
                      [px, yBase + haut*0.97, pz], r*0.27, 5], c});
  }
  // le chapiteau
  parts.push({x, y: yBase + haut, z, sx:r*2.5, sy:0.26, sz:r*2.5, c});
}

/** Une lancette : l'ouverture haute et étroite, avec son remplage. */
function lancette(parts, x, z, ry, larg, yBase, haut, c, lueur){
  const cs = Math.cos(ry), sn = Math.sin(ry);
  const a = [x - cs*larg/2, z - sn*larg/2];
  const b = [x + cs*larg/2, z + sn*larg/2];
  arcBrise(parts, a, b, yBase + haut*0.62, haut*0.38, 0.09, c, 5);
  // les meneaux verticaux
  for(const t of [-0.32, 0, 0.32]){
    const px = x + cs*larg*t, pz = z + sn*larg*t;
    parts.push({tube:[[px, yBase, pz], 0.055,
                      [px, yBase + haut*0.62, pz], 0.05, 4], c});
  }
  /* Le vitrail : une plaque émissive. C'est la seule couleur vive qu'on
     s'autorise dans ce jeu, et elle est justifiée — un vitrail éclairé par
     rien est exactement l'image qu'on cherche. */
  if(lueur)
    parts.push({plaque:1, x, y: yBase + haut*0.42, z,
                sx: larg*0.82, sy: haut*0.72, c: lueur, emis:1, ry});
}

/* ═══════════════ LA CATHÉDRALE ═══════════════ */

/**
 * Bâtit une cathédrale gothique centrée sur une cellule.
 *
 * Le plan est celui d'une église : une NEF flanquée de deux BAS-CÔTÉS, un
 * TRANSEPT en travers, un CHŒUR au fond, et deux TOURS en façade. Ce plan
 * n'est pas décoratif — c'est lui qui rend l'intérieur lisible : on entre par
 * l'ouest, on avance dans un vaisseau haut et étroit, et on débouche sur le
 * croisement. Un joueur qui n'a jamais vu de cathédrale sait quand même où il
 * est.
 */
function batirCathedrale(cx, cz, id){
  const S = SETUP.edifices;
  const parts = [];
  const h = floorH[idx(cx, cz)];

  const pierre  = [.175,.170,.158];
  const pierre2 = [.205,.198,.183];
  const nerf    = [.235,.228,.212];
  /* Le vitrail est la seule couleur saturée du jeu. Elle est justifiée : une
     rosace éclairée par rien, au fond d'un souterrain, c'est l'image. */
  const vitrail = [rf(0.35,0.95), rf(0.12,0.35), rf(0.18,0.55)];

  // ── dimensions, en cellules puis en mètres ──
  const cLong = ri(S.nefLongMin, S.nefLongMax);      // le long de Z
  const cLarg = ri(S.nefLargMin, S.nefLargMax);      // la nef seule
  const cCote = 3;                                    // chaque bas-côté
  const cTotal = cLarg + cCote*2;
  const travees = Math.max(3, Math.round(cLong / 4));

  const L = cLong * CELL, W = cTotal * CELL;
  const yNef = h;
  const hBasCote = S.hauteurBasCote;
  const hNef     = S.hauteurNef;

  const x0 = cx - Math.floor(cTotal/2), z0 = cz - Math.floor(cLong/2);
  const X = (u) => c2w(x0 + u);
  const Z = (v) => c2w(z0 + v);

  /* ── 1. LE TERRAIN CÈDE LA PLACE ──
     On aplanit et on lève le plafond. Une cathédrale ne se creuse pas dans la
     roche : elle occupe un volume, et le champ de hauteurs doit s'écarter. */
  for(let v = -2; v < cLong + 2; v++)
    for(let u = -2; u < cTotal + 2; u++){
      const x = x0 + u, z = z0 + v;
      if(x < 1 || z < 1 || x >= GW-1 || z >= GH-1) continue;
      const i = idx(x, z);
      grid[i] = FLOOR;
      floorH[i] = h;
      ceilH[i] = Math.max(ceilH[i], h + hNef + S.fleche + 6);
      vide[i] = 0;
      blocked[i] = 0;
      openN[i] = 1;
    }

  /* ── 2. LE SOL DE LA NEF ──
     Posé comme plancher d'édifice : c'est ce qui permettra d'avoir une crypte
     dessous et un triforium dessus. */
  poserDalle(x0, z0, cTotal, cLong, yNef, hNef, id);

  /* ── 3. LES MURS GOUTTEREAUX, percés d'arcades ──
     On pose le mur en tranches et on laisse les baies vides : c'est la couche
     `niveaux` qui décide où l'on bute, et elle sait ne bloquer QU'UNE tranche
     d'altitude. */
  for(let v = 0; v < cLong; v++){
    const enBaie = (v % 4) === 2;            // une baie toutes les quatre
    for(const u of [0, cTotal - 1]){
      if(enBaie) continue;                    // la baie laisse passer le regard
      poserPlancher(x0 + u, z0 + v, yNef, hBasCote, id, true);
    }
  }
  // façade ouest et chevet est, sauf la porte
  for(let u = 0; u < cTotal; u++){
    const porte = Math.abs(u - cTotal/2) < 1.6;
    if(!porte) poserPlancher(x0 + u, z0, yNef, hBasCote, id, true);
    poserPlancher(x0 + u, z0 + cLong - 1, yNef, hBasCote, id, true);
  }

  /* ── 4. LES DEUX FILES DE PILIERS ──
     Elles séparent la nef des bas-côtés. C'est la structure qui porte, et
     visuellement c'est ce qui donne la perspective : deux rangées qui fuient. */
  const uG = cCote, uD = cTotal - cCote - 1;
  const pasT = cLong / travees;
  for(let t = 0; t <= travees; t++){
    const v = Math.min(cLong - 1, Math.round(t * pasT));
    for(const u of [uG, uD]){
      pilier(parts, X(u), Z(v), h, hNef, 0.42, pierre2);
      poserPlancher(x0 + u, z0 + v, yNef, hNef, id, true);
    }
  }

  /* ── 5. LES ARCADES entre piliers, et les VOÛTES ── */
  for(let t = 0; t < travees; t++){
    const v0 = Math.round(t * pasT), v1 = Math.round((t+1) * pasT);
    const zc = (Z(v0) + Z(v1)) / 2;

    // grandes arcades le long de la nef
    for(const u of [uG, uD])
      arcBrise(parts, [X(u), Z(v0)], [X(u), Z(v1)], h + hNef*0.52,
               hNef*0.30, 0.15, pierre2, 6);

    // la voûte de la travée principale
    voute(parts, X((uG+uD)/2), zc, (uD-uG)*CELL, (v1-v0)*CELL,
          h + hNef*0.78, S.fleche, 0.13, nerf, pierre2);

    // les voûtes plus basses des bas-côtés
    for(const [ua, ub] of [[0, uG], [uD, cTotal-1]])
      voute(parts, X((ua+ub)/2), zc, (ub-ua)*CELL, (v1-v0)*CELL,
            h + hBasCote*0.72, S.fleche*0.55, 0.10, nerf, pierre2);
  }

  /* ── 6. LES MURS, EN PIERRE ──
     La géométrie des murs vient après leur pose logique : on dessine ce que la
     couche `niveaux` a déjà décidé. */
  const mur = (u0, v0, u1, v1, yb, ht) => {
    const a = [X(u0), Z(v0)], b = [X(u1), Z(v1)];
    const lg = Math.hypot(b[0]-a[0], b[1]-a[1]);
    const ang = Math.atan2(b[1]-a[1], b[0]-a[0]);
    const q = {x:(a[0]+b[0])/2, y: yb + ht/2, z:(a[1]+b[1])/2,
               sx: lg, sy: ht, sz: 0.55, c: pierre, ry: ang};
    parts.push(q);
  };
  mur(0, 0, 0, cLong-1, h, hBasCote);
  mur(cTotal-1, 0, cTotal-1, cLong-1, h, hBasCote);
  mur(0, cLong-1, cTotal-1, cLong-1, h, hBasCote);
  // façade : deux morceaux, la porte au milieu
  mur(0, 0, cTotal/2 - 1.2, 0, h, hBasCote);
  mur(cTotal/2 + 1.2, 0, cTotal-1, 0, h, hBasCote);
  // le mur haut de la nef, au-dessus des arcades — le clair-étage
  for(const u of [uG, uD]) mur(u, 0, u, cLong-1, h + hNef*0.82, hNef*0.30);

  /* ── 7. LES BAIES ET LA ROSACE ──
     Le vitrail est émissif. Une rosace éclairée par rien, au fond d'un
     souterrain, c'est l'image qu'on cherche depuis le début. */
  for(let v = 2; v < cLong - 1; v += 4){
    for(const [u, ry] of [[0, Math.PI/2], [cTotal-1, Math.PI/2]])
      lancette(parts, X(u), Z(v), ry, 2.0, h + 1.1, hBasCote - 1.6,
               pierre2, vitrail);
  }
  {
    // la rosace en façade
    const rx = X(cTotal/2 - 0.5), rz = Z(0);
    const R = Math.min(3.2, W*0.22);
    for(let k = 0; k < 12; k++){
      const a1 = k/12*6.283, a2 = (k+1)/12*6.283;
      parts.push({tube:[[rx + Math.cos(a1)*R, h + hNef*0.62 + Math.sin(a1)*R, rz],
                        0.07,
                        [rx + Math.cos(a2)*R, h + hNef*0.62 + Math.sin(a2)*R, rz],
                        0.07, 4], c: pierre2});
      parts.push({tube:[[rx, h + hNef*0.62, rz], 0.05,
                        [rx + Math.cos(a1)*R, h + hNef*0.62 + Math.sin(a1)*R, rz],
                        0.05, 4], c: pierre2});
    }
    parts.push({plaque:1, x:rx, y: h + hNef*0.62, z: rz + 0.06,
                sx: R*1.9, sy: R*1.9, c: vitrail, emis:1});
    if(lights.length < SETUP.decor.maxLumieres)
      lights.push({x:rx, y:h + hNef*0.62, z:rz + 1.2,
                   c:[vitrail[0]*0.9, vitrail[1]*0.9, vitrail[2]*0.9],
                   ph:rnd()*6.28});
  }

  /* ── 8. LES ARCS-BOUTANTS ──
     Ils reportent la poussée des voûtes vers l'extérieur. Techniquement
     inutiles ici — rien ne pousse — mais c'est la silhouette qui dit
     « gothique » de l'extérieur, autant que les flèches. */
  for(let t = 1; t < travees; t++){
    const v = Math.round(t * pasT);
    for(const [uInt, uExt, s] of [[uG, -1.6, -1], [uD, cTotal + 0.6, 1]]){
      const a = [X(uInt + s*0.6), Z(v)], b = [X(uExt), Z(v)];
      arcBrise(parts, a, b, h + hBasCote*0.95, hNef*0.22, 0.14, pierre2, 5);
      // la culée
      parts.push({x: X(uExt), y: h + hBasCote*0.55, z: Z(v),
                  sx:0.8, sy: hBasCote*1.1, sz:0.8, c: pierre});
    }
  }

  /* ── 9. LES DEUX TOURS ──
     Elles montent, et ON PEUT Y MONTER : chaque étage est un plancher dans
     `niveaux.js`. C'est la démonstration que le changement de moteur sert à
     quelque chose — avant, une tour était un décor plein. */
  const tours = [];
  for(const u of [1, cTotal - 2]){
    const th = S.hauteurTour + rf(-2, 3);
    const tx = X(u), tz = Z(1);
    // le fût, quatre murs
    for(let e = 0; e * S.etageTour < th; e++){
      const y = h + e * S.etageTour;
      poserPlancher(x0 + u, z0 + 1, y, S.etageTour - 0.3, id, false);
    }
    parts.push({x:tx, y:h + th/2, z:tz, sx:2.6, sy:th, sz:2.6, c:pierre});
    // les baies de la chambre des cloches
    for(const ry of [0, Math.PI/2])
      lancette(parts, tx, tz, ry, 1.5, h + th - 4.5, 3.4, pierre2, null);
    // la flèche
    parts.push({tube:[[tx, h + th, tz], 1.5,
                      [tx, h + th + S.fleeheTour, tz], 0.05, 6], c: pierre2});
    tours.push({x:tx, z:tz, haut: th});
  }

  /* ── 10. CE QUI VIT DEDANS ──
     Les gobelins sortent d'ici. Le trou par lequel ils sortent est visible :
     une brèche dans le dallage du chœur, avec sa lueur. */
  const brx = X(cTotal/2 - 0.5), brz = Z(cLong - 3);
  parts.push({roche:[1.1, ri(1,900), 1], x:brx, y:h - 0.5, z:brz,
              c:[.09,.075,.065]});
  if(lights.length < SETUP.decor.maxLumieres)
    lights.push({x:brx, y:h + 0.3, z:brz, c:[0.55,0.30,0.10], ph:rnd()*6.28});

  props.push({parts, cell: idx(cx, cz), r:0, solide:false});

  const e = {
    x: c2w(cx), z: c2w(cz), y: h, type:'cathedrale', id,
    rayon: Math.max(L, W) / 2,
    long: L, larg: W, travees,
    porte: {x: X(cTotal/2 - 0.5), z: Z(0)},
    breche: {x: brx, z: brz},
    tours,
    primitives: parts.length,
  };
  edifices.push(e);
  statsNiveaux.edifices++;
  return e;
}

/* ═══════════════ SEMIS ═══════════════ */

export function viderEdifices(){
  edifices.length = 0;
  viderNiveaux();
}

/**
 * Place les cathédrales. Peu nombreuses et espacées : une cathédrale qu'on
 * croise deux fois par minute n'est plus un événement.
 */
export function placerEdifices(){
  const S = SETUP.edifices;
  let poses = 0;

  for(let essai = 0; essai < 26000 && poses < S.nbCathedrales; essai++){
    const c = celluleLibre(ri);
    if(!autorise('villages', c.x, c.z)) continue;

    // il faut de la place, et un sol régulier
    const cTotal = S.nefLargMax + 6, cLong = S.nefLongMax;
    if(c.x < cTotal || c.z < cLong || c.x > GW - cTotal || c.z > GH - cLong)
      continue;

    let plat = true;
    const h0 = floorH[idx(c.x, c.z)];
    for(let v = -cLong/2; v < cLong/2 && plat; v += 3)
      for(let u = -cTotal/2; u < cTotal/2; u += 3){
        const i = idx(c.x + (u|0), c.z + (v|0));
        if(Math.abs(floorH[i] - h0) > S.deniveleMax || vide[i]){ plat = false; break; }
      }
    if(!plat) continue;

    // pas deux cathédrales côte à côte
    let tropPres = false;
    for(const e of edifices)
      if(Math.hypot(e.x - c2w(c.x), e.z - c2w(c.z)) < S.ecartMin) tropPres = true;
    if(tropPres) continue;

    batirCathedrale(c.x, c.z, edifices.length + 1);
    poses++;
  }
  return poses;
}

/** L'édifice le plus proche, ou null. */
export function edificeProche(wx, wz, portee = 60){
  let meilleur = null, md = portee;
  for(const e of edifices){
    const d = Math.hypot(e.x - wx, e.z - wz);
    if(d < md){ md = d; meilleur = e; }
  }
  return meilleur;
}
