/* ═══ ÉDITEUR / ASSETS ═══
   Composer un élément de décor à partir des primitives du moteur, et le voir
   tourner en temps réel.

   ── LE PRINCIPE : NE RIEN RÉIMPLÉMENTER ────────────────────────────────────
   L'aperçu n'a pas sa propre géométrie. Il appelle `cuireParts()` de
   monde/maillage.js, c'est-à-dire EXACTEMENT le code qui cuit le décor du jeu.
   Un éditeur qui redessine à sa façon finit toujours par diverger du moteur, et
   on ne s'en aperçoit qu'une fois en jeu.

   ── DEUX FAÇONS DE COMMENCER ───────────────────────────────────────────────
   1. Partir de rien et empiler des primitives.
   2. CHARGER UN ÉLÉMENT DU JEU — pilier, maison, carcasse, crâne… — pour voir
      de quoi il est fait et le retoucher. C'est le mode le plus utile : la
      plupart du temps on ne veut pas inventer, on veut corriger.

   ── LES DEUX PRIMITIVES ────────────────────────────────────────────────────
     BLOC  une boîte : x y z, dimensions, rotation autour de Z, couleur
     TUBE  un prisme à N côtés entre deux points, avec un rayon à chaque bout
   Les deux acceptent `emis` : la part devient une source lumineuse apparente.

   Ce qui sort d'ici est du JSON, et un extrait de code prêt à coller dans
   monde/props.js — le jeu ne charge pas d'assets à l'exécution, tout y est
   procédural, et c'est ce qui lui permet de tenir en un seul fichier.       */

import {cuireParts} from '../monde/maillage.js';
import {libererMesh} from '../noyau/gl.js';
import {addProp, props as propsJeu, lights as lightsJeu} from '../monde/props.js';
import {grid, floorH, ceilH, biome, blocked, sky, idx, FLOOR, c2w} from '../monde/grille.js';
import {semer} from '../noyau/rng.js';
import {BIOMES} from '../monde/biomes.js';

/** Les éléments que le jeu sait fabriquer, pour le menu « charger ». */
export const TYPES = [
  'pilier','arche','gravats','stalag','glace','poutre','conduit','tronc',
  'monolithe','tourFenetres','meneau','cristal','souche','os','cotes','crane',
  'maison','carcasse','lampadaire','pylone','champignon',
];

export const asset = {
  nom: 'element',
  parts: [],
  selection: -1,
};

let maillage = null, sale = true;

export const salir = () => { sale = true; };

/** Le maillage à jour, recuit seulement quand quelque chose a bougé. */
export function maillageAsset(){
  if(sale){
    if(maillage) libererMesh(maillage);
    maillage = asset.parts.length ? cuireParts(asset.parts) : null;
    sale = false;
  }
  return maillage;
}

/* ─────────────── primitives neuves ─────────────── */

export function ajouterBloc(){
  asset.parts.push({
    x:0, y:0.5, z:0, sx:0.4, sy:1.0, sz:0.4, r:0, emis:0,
    c:[0.28, 0.26, 0.23],
  });
  asset.selection = asset.parts.length - 1;
  salir();
}

export function ajouterTube(){
  asset.parts.push({
    tube: [[0,0,0], 0.22, [0,1.2,0], 0.09, 6],
    c:[0.28, 0.26, 0.23], emis:0,
  });
  asset.selection = asset.parts.length - 1;
  salir();
}

export function dupliquer(){
  const p = asset.parts[asset.selection];
  if(!p) return;
  const copie = JSON.parse(JSON.stringify(p));
  if(copie.tube){ copie.tube[0][0] += 0.3; copie.tube[2][0] += 0.3; }
  else copie.x += 0.3;
  asset.parts.push(copie);
  asset.selection = asset.parts.length - 1;
  salir();
}

export function supprimer(){
  if(asset.selection < 0) return;
  asset.parts.splice(asset.selection, 1);
  asset.selection = Math.min(asset.selection, asset.parts.length - 1);
  salir();
}

export function vider(){
  asset.parts.length = 0; asset.selection = -1; salir();
}

/* ─────────────── charger un élément du jeu ─────────────── */

/**
 * Fabrique un élément du jeu dans un bac à sable et récupère ses parts.
 *
 * addProp() écrit dans les tableaux globaux du monde et lit la grille
 * (altitude, plafond, biome). On prépare donc une cellule d'essai, on appelle
 * la vraie fonction, on récupère ce qu'elle a produit, et on nettoie derrière.
 * C'est laid mais c'est honnête : on regarde la géométrie que le jeu produit
 * réellement, pas une imitation.
 */
export function chargerDuJeu(type, biomeIndex, graine){
  const avantP = propsJeu.length, avantL = lightsJeu.length;
  const cx = 4, cz = 4, i = idx(cx, cz);

  const sauve = {g:grid[i], f:floorH[i], c:ceilH[i], b:biome[i], bl:blocked[i], s:sky[i]};
  grid[i] = FLOOR; floorH[i] = 0; ceilH[i] = 6; biome[i] = biomeIndex;
  blocked[i] = 0; sky[i] = 0;

  semer(graine >>> 0);
  try{ addProp(type, cx, cz, i); }catch(e){ console.warn(type, e); }

  const neufs = propsJeu.slice(avantP);
  propsJeu.length = avantP;
  lightsJeu.length = avantL;
  grid[i] = sauve.g; floorH[i] = sauve.f; ceilH[i] = sauve.c;
  biome[i] = sauve.b; blocked[i] = sauve.bl; sky[i] = sauve.s;

  // on recentre l'élément sur l'origine : il a été bâti autour de la cellule
  const dx = c2w(cx), dz = c2w(cz);
  asset.parts = [];
  for(const pr of neufs) for(const q of pr.parts){
    const c = JSON.parse(JSON.stringify(q));
    if(c.tube){ c.tube[0][0] -= dx; c.tube[0][2] -= dz; c.tube[2][0] -= dx; c.tube[2][2] -= dz; }
    else { c.x -= dx; c.z -= dz; }
    asset.parts.push(c);
  }
  asset.nom = type;
  asset.selection = asset.parts.length ? 0 : -1;
  salir();
  return asset.parts.length;
}

/* ─────────────── mesures ─────────────── */

/** Boîte englobante, pour cadrer la caméra et afficher les dimensions. */
export function bornes(){
  if(!asset.parts.length) return {min:[0,0,0], max:[0,1,0], centre:[0,0.5,0], rayon:1};
  const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  const voir = (x,y,z,r) => {
    mn[0]=Math.min(mn[0],x-r); mn[1]=Math.min(mn[1],y-r); mn[2]=Math.min(mn[2],z-r);
    mx[0]=Math.max(mx[0],x+r); mx[1]=Math.max(mx[1],y+r); mx[2]=Math.max(mx[2],z+r);
  };
  for(const q of asset.parts){
    if(q.tube){
      voir(q.tube[0][0], q.tube[0][1], q.tube[0][2], q.tube[1]);
      voir(q.tube[2][0], q.tube[2][1], q.tube[2][2], q.tube[3]);
    } else {
      voir(q.x, q.y, q.z, Math.max(q.sx, q.sy, q.sz)/2);
    }
  }
  const centre = [(mn[0]+mx[0])/2, (mn[1]+mx[1])/2, (mn[2]+mx[2])/2];
  const rayon = Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) / 2 || 1;
  return {min:mn, max:mx, centre, rayon};
}

/** Nombre de triangles : le seul chiffre qui compte pour le budget. */
export function triangles(){
  let n = 0;
  for(const q of asset.parts) n += q.tube ? (q.tube[4] || 6) * 4 : 12;
  return n;
}

/* ─────────────── export ─────────────── */

/** Un extrait prêt à coller dans le `switch` de monde/props.js. */
export function versCode(){
  const f = v => Number(v).toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
  const col = c => `[${c.map(v => Number(v).toFixed(3)).join(',')}]`;
  const lignes = [];
  for(const q of asset.parts){
    if(q.tube){
      const [p0,r0,p1,r1,n] = q.tube;
      lignes.push(`      parts.push({tube:[[wx+${f(p0[0])},h+${f(p0[1])},wz+${f(p0[2])}], `
        + `${f(r0)}, [wx+${f(p1[0])},h+${f(p1[1])},wz+${f(p1[2])}], ${f(r1)}, ${n||6}], `
        + `c:${col(q.c)}${q.emis ? ', emis:1' : ''}});`);
    } else {
      lignes.push(`      parts.push({x:wx+${f(q.x)}, y:h+${f(q.y)}, z:wz+${f(q.z)}, `
        + `sx:${f(q.sx)}, sy:${f(q.sy)}, sz:${f(q.sz)}, c:${col(q.c)}`
        + `${q.r ? `, r:${f(q.r)}` : ''}${q.emis ? ', emis:1' : ''}});`);
    }
  }
  return `    case '${asset.nom}': {\n${lignes.join('\n')}\n      solid = false; break; }\n`;
}
