/* ═══ MONDE / GÉNÉRATION ═══
   Creuse la planche : salles, cavernes, couloirs, puis relaxation du relief.

   ── LE POINT DÉLICAT (v3) ──────────────────────────────────────────────────
   La v2 relaxait TOUT le champ de hauteur pour qu'aucune marche ne dépasse ce
   que le joueur enjambe. C'était la garantie « pas de cul-de-sac », mais ça
   interdisait aussi toute falaise : le monde était une pente douce continue.
   Avec une amplitude ×3 (−126 → +132 m) ce serait pire encore, tout aplati.

   La v3 relaxe UNIQUEMENT le long d'une « épine navigable » : le chemin qui
   relie les salles dans l'ordre du plan, plus une marge de quelques cellules.
   Partout ailleurs, le dénivelé brut survit — et c'est exactement ça, les
   falaises et les précipices. On garde la garantie de traversée (l'épine est
   toujours praticable) tout en obtenant un relief violent autour.

   La relaxation elle-même passe d'un balayage à 120 passes (142 M d'itérations
   sur la grille 1088²) à une file d'attente : on ne réexamine que les voisins
   d'une cellule qui vient d'être abaissée.                                  */

import {SETUP} from '../setup.js';
import {lerp, clamp} from '../noyau/math.js';
import {rnd, ri} from '../noyau/rng.js';
import {BIOMES, biomePourAltitude} from './biomes.js';
import {
  GW, GH, CELL, WALL, FLOOR, STEPUP,
  grid, floorH, ceilH, openN, biome, platform, sky, falaise, vide, pont,
  idx, inB, isFloor, calculerOuverture, majBornes,
} from './grille.js';

export const salles = [];
/** Cellules appartenant à l'épine navigable — relaxées, donc traversables. */
export const epine = new Uint8Array(GW * GH);

/* ─────────────── creusement ─────────────── */

/* Le biome n'est JAMAIS passé en paramètre : il se déduit de l'altitude et de
   la position, via monde/biomes.js. C'est ce qui garantit qu'on ne peut pas
   avoir deux biomes différents à la même profondeur au même endroit. */
export function carveRect(x0,z0,w,h,e){
  for(let z=z0; z<z0+h; z++) for(let x=x0; x<x0+w; x++)
    if(inB(x,z)){
      const i = idx(x,z);
      grid[i] = FLOOR; floorH[i] = e; biome[i] = biomePourAltitude(e, x, z);
    }
}

export function carveBlob(cx,cz,steps,e){
  let x=cx, z=cz;
  for(let i=0;i<steps;i++){
    for(let dz=-1;dz<=1;dz++) for(let dx=-1;dx<=1;dx++) if(inB(x+dx,z+dz)){
      const k = idx(x+dx, z+dz);
      grid[k] = FLOOR;
      // relief doux dans les cavernes : jamais de falaise en travers du passage
      const h = e + Math.sin(x*0.31)*0.28 + Math.cos(z*0.27)*0.28;
      floorH[k] = h;
      biome[k] = biomePourAltitude(h, x+dx, z+dz);
    }
    const d = ri(0,3);
    x += d===0?1 : d===1?-1 : 0;
    z += d===2?1 : d===3?-1 : 0;
    x = clamp(x, 3, GW-4); z = clamp(z, 3, GH-4);
  }
}

/* Le couloir interpole l'altitude cellule par cellule et MARQUE L'ÉPINE : ces
   cellules-là seront relaxées, donc toujours franchissables. */
function corridor(a,b,wdt){
  const pts=[];
  let x=a.x, z=a.z;
  while(x!==b.x){ pts.push([x,z]); x += Math.sign(b.x-x); }
  while(z!==b.z){ pts.push([x,z]); z += Math.sign(b.z-z); }
  pts.push([b.x,b.z]);
  const M = SETUP.relief.epineMarge;
  pts.forEach(([x,z],i)=>{
    const t = i / Math.max(1, pts.length-1);
    const e = lerp(a.e, b.e, t);
    for(let i2=0;i2<wdt;i2++) for(let j=0;j<wdt;j++) if(inB(x+i2,z+j)){
      const k = idx(x+i2, z+j);
      grid[k]=FLOOR; floorH[k]=e; biome[k]=biomePourAltitude(e, x+i2, z+j);
    }
    // marge d'épine autour du tracé : la relaxation a de quoi lisser la rampe
    for(let dz=-M; dz<=M+wdt; dz++) for(let dx=-M; dx<=M+wdt; dx++)
      if(inB(x+dx, z+dz)) epine[idx(x+dx, z+dz)] = 1;
  });
}

/* Un couloir en L direct est souvent trop court pour absorber un écart
   d'altitude sans que la relaxation ne l'aplatisse. On insère un point de
   passage qui rallonge le trajet : la rampe devient longue et douce, et le
   dénivelé survit. Avec l'amplitude ×3, ce détour est devenu la règle plus
   que l'exception. */
export function corridorLong(a,b,wdt){
  const dE = Math.abs(a.e - b.e);
  const dist = Math.abs(a.x-b.x) + Math.abs(a.z-b.z);
  const besoin = dE / (STEPUP * 0.32);     // cellules nécessaires pour la rampe
  if(dist >= besoin){ corridor(a,b,wdt); return; }
  const manque = besoin - dist;
  const dir = rnd() < 0.5 ? 1 : -1;
  const wp = {
    x: clamp(Math.round((a.x+b.x)/2 + dir*manque*0.5), 2, GW-3),
    z: clamp(Math.round((a.z+b.z)/2 - dir*manque*0.5), 2, GH-3),
    e: (a.e + b.e)/2, b: a.b,
  };
  corridor(a,wp,wdt); corridor(wp,b,wdt);
}

/* ─────────────── relaxation sur l'épine seulement ─────────────── */

/**
 * Rend le champ Lipschitz LE LONG DE L'ÉPINE : aucune marche entre deux
 * cellules voisines d'épine ne dépasse ce que le joueur franchit. On ne fait
 * que BAISSER, donc le procédé converge.
 *
 * File d'attente : quand une cellule est abaissée, seuls ses voisins sont
 * remis en question. Coût proportionnel au nombre de corrections, pas au
 * nombre de cellules × nombre de passes.
 */
export function relaxerEpine(){
  const MAX = STEPUP - 0.03;
  const NB = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const N = GW*GH;

  /* File CIRCULAIRE. Une file linéaire débordait : `file[queue++]` au-delà de
     la capacité d'un Int32Array est silencieusement ignoré en JavaScript, si
     bien que la relaxation s'arrêtait au milieu sans le moindre message et
     laissait des marches infranchissables sur l'épine.
     `dansFile` garantit qu'une cellule n'est présente qu'une fois : la file ne
     contient donc jamais plus de N éléments, et N+1 cases suffisent. */
  const CAP = N + 1;
  const file = new Int32Array(CAP);
  const dansFile = new Uint8Array(N);
  let tete = 0, queue = 0, taille = 0;

  const pousser = i => {
    if(dansFile[i]) return;
    dansFile[i] = 1;
    file[queue] = i;
    queue = (queue + 1) % CAP;
    taille++;
  };

  for(let z=1; z<GH-1; z++) for(let x=1; x<GW-1; x++){
    const i = idx(x,z);
    if(grid[i]===FLOOR && epine[i]) pousser(i);
  }

  // Garde-fou : sur 1,18 M cellules une boucle mal bornée gèle l'onglet.
  const PLAFOND = N * SETUP.relief.relaxPasses;
  let traites = 0;

  while(taille > 0 && traites++ < PLAFOND){
    const i = file[tete];
    tete = (tete + 1) % CAP;
    taille--;
    dansFile[i] = 0;
    const x = i % GW, z = (i / GW) | 0;
    for(const [dx,dz] of NB){
      const nx=x+dx, nz=z+dz;
      if(!isFloor(nx,nz)) continue;
      const n = idx(nx,nz);
      if(!epine[n]) continue;                 // hors épine : la falaise reste
      if(floorH[i] - floorH[n] > MAX){
        floorH[i] = floorH[n] + MAX;
        pousser(i);
        for(const [ax,az] of NB){
          if(isFloor(x+ax, z+az) && epine[idx(x+ax,z+az)]) pousser(idx(x+ax,z+az));
        }
        break;
      }
    }
  }
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
    for(const [dx,dz] of NB){
      if(!isFloor(x+dx, z+dz)) continue;
      if(floorH[i] - floorH[idx(x+dx,z+dz)] > S){ falaise[i] = 1; break; }
    }
  }
}

/* ─────────────── plateformes ─────────────── */

/* Les rampes de franchissement ont déménagé dans monde/connexite.js : elles
   ne relèvent plus du décor mais de la TOPOLOGIE. Voir l'explication là-bas —
   en résumé, les poser au hasard produisait des escaliers qui ne reliaient
   rien, ce qui était exactement le reproche fait à la version d'avant.      */

/* ─────────────── plan du monde ─────────────── */

/**
 * Creuse salles, cavernes et couloirs. Le monde est ordonné en altitude : le
 * barrage tout au fond, la surface tout en haut, les salles posées le long
 * d'une diagonale pour que la remontée soit longue. C'est la longueur du
 * chemin, et non l'altitude visée, qui décide du dénivelé qui survit.
 */
export function creuserPlan(){
  salles.length = 0;
  epine.fill(0);

  const {altBasse, altHaute, nbSalles, nbCavernes, nbRaccourcis} = SETUP.monde;

  /* Le plan ne porte plus que des ALTITUDES. Le biome n'est plus une donnée
     du plan : il se déduit de l'altitude au moment du creusement. C'est la
     correction du « biomes placés au bol » — il devient impossible qu'une
     salle à −100 m soit autre chose que du barrage. */
  const PLAN = [];
  for(let k=0; k<nbSalles; k++){
    const t = k / (nbSalles - 1);
    PLAN.push({ e: lerp(altBasse, altHaute, t) + ri(-6,6) });
  }

  PLAN.forEach((P,i)=>{
    const t = i / (PLAN.length - 1);
    // diagonale + dispersion : les extrêmes se retrouvent aux deux bouts
    const cx = Math.round(lerp(18, GW-19, t) + ri(-14,14));
    const cz = Math.round(lerp(GH-19, 18, t) + ri(-14,14));
    const b = biomePourAltitude(P.e, cx, cz);
    const grand = b === 3 || b === 2;          // dehors et le barrage sont vastes
    const w = grand ? ri(26,40) : ri(14,26), h = grand ? ri(26,40) : ri(14,26);
    const x = clamp(cx - (w>>1), 2, GW-w-3), z = clamp(cz - (h>>1), 2, GH-h-3);
    carveRect(x, z, w, h, P.e);
    salles.push({x: x + (w>>1), z: z + (h>>1), e: P.e, b});
  });

  // cavernes : réparties sur toute la hauteur, biome déduit comme le reste
  for(let k=0; k<nbCavernes; k++){
    const t = k / (nbCavernes - 1);
    const e = lerp(altBasse+4, altHaute-4, t) + ri(-8,8);
    const tt = (e - altBasse) / (altHaute - altBasse);
    const cx = clamp(Math.round(lerp(20, GW-21, tt) + ri(-12,12)), 18, GW-19);
    const cz = clamp(Math.round(lerp(GH-21, 20, tt) + ri(-12,12)), 18, GH-19);
    carveBlob(cx, cz, ri(1400,3000), e);
    salles.push({x:cx, z:cz, e, b: biomePourAltitude(e, cx, cz)});
  }

  // la chaîne suit l'ordre du plan : on ne saute jamais 60 m d'un coup
  for(let i=1; i<salles.length; i++)
    corridorLong(salles[i-1], salles[i], rnd()<0.35 ? 3 : 2);

  // raccourcis, mais seulement entre paliers voisins
  for(let i=0; i<nbRaccourcis; i++){
    const a = ri(0, salles.length - 2);
    corridorLong(salles[a], salles[a+1], 2);
  }

  /* Pas de mur d'enceinte : au bord, le sol s'arrête et c'est le vide. Un
     monde clos par une paroi invisible n'a pas d'horizon. */
  const B = SETUP.monde.bordVide;
  for(let z=0; z<GH; z++) for(let x=0; x<GW; x++){
    if(x<B || z<B || x>=GW-B || z>=GH-B){
      const i = idx(x,z);
      if(grid[i] !== FLOOR) vide[i] = 1;
    }
  }
}

/**
 * Pose les plafonds. Nettement plus bas qu'en v2 : le souterrain doit être
 * exigu. Sous SETUP.monde.plafondRampe il faut ramper — ce qui a un intérêt
 * mécanique direct, puisque ramper n'imprime aucune trace.
 */
export function poserPlafonds(){
  const {plafondBase, plafondOuvert, plafondCiel} = SETUP.monde;
  for(let i=0; i<GW*GH; i++){
    if(grid[i] !== FLOOR){ ceilH[i] = 0; continue; }
    const B = BIOMES[biome[i]];
    if(B.sky){
      // Dehors : pas de plafond, et de hautes parois tout autour. On est au
      // fond d'une vallée, pas dans une salle repeinte en gris.
      sky[i] = 1; ceilH[i] = floorH[i] + plafondCiel;
    } else {
      ceilH[i] = floorH[i] + (plafondBase + openN[i]*plafondOuvert) * B.h;
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
