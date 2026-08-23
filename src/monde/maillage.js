/* ═══ MONDE / MAILLAGE ═══
   Transforme la grille et le décor en triangles, par pavés chargés à la volée.

   Un monde de 1,6 km à 1,5 m de cellule fait ~14 M de sommets. Tout construire
   au chargement coûterait des centaines de mégaoctets et plusieurs secondes de
   gel. On ne construit donc que les pavés à portée de vue, et on libère les
   autres : la taille du monde ne coûte plus rien en mémoire.

   Le décor est CUIT dans le maillage du pavé : un seul appel de rendu pour le
   sol, les parois et tous les éléments qui s'y trouvent.                    */

import {SETUP} from '../setup.js';
import {hash2} from '../noyau/math.js';
import {gl, mesh, libererMesh} from '../noyau/gl.js';
import {BIOMES} from './biomes.js';
import {
  GW, GH, CELL, CH, CHW, CHH, FLOOR, LEDGE,
  grid, floorH, ceilH, biome, sky, vide,
  idx, isFloor, c2w, w2c,
} from './grille.js';
import {props, lights} from './props.js';

/* ─────────────── index spatial ─────────────── */

export const chOf = (x,z) => (((z/CH)|0) * CHW) + ((x/CH)|0);

let propsParPave = new Map();
/* Réassigner un `export let` marche en modules ES (liaisons vivantes) mais PAS
   une fois concaténé par outils/bundler.py, qui capture la valeur à
   l'initialisation. On garde donc TOUJOURS le même objet et on le vide.
   outils/verifier.py refuse désormais toute réassignation d'export. */
export const lampesParPave = new Map();

export function indexerProps(){
  propsParPave = new Map();
  lampesParPave.clear();
  for(const pr of props){
    const k = chOf(pr.cell % GW, (pr.cell / GW) | 0);
    if(!propsParPave.has(k)) propsParPave.set(k, []);
    propsParPave.get(k).push(pr);
  }
  for(const L of lights){
    const k = chOf(Math.min(GW-1, Math.max(0, w2c(L.x))),
                   Math.min(GH-1, Math.max(0, w2c(L.z))));
    if(!propsParPave.has(k)) propsParPave.set(k, []);
    propsParPave.get(k).push({lampe:L});
    if(!lampesParPave.has(k)) lampesParPave.set(k, []);
    lampesParPave.get(k).push(L);
  }
}

/* ─────────────── streaming ─────────────── */

export const paves = new Map();      // k -> {m, x, z}

export const paveCentre = k => ({
  x: ((k % CHW) + 0.5) * CH * CELL,
  z: (((k / CHW) | 0) + 0.5) * CH * CELL,
});

export function libererPave(k){
  const p = paves.get(k);
  if(!p) return;
  /* Un pavé entièrement rocheux est mémorisé avec m:null pour ne pas être
     rebâti sans cesse. La v2 le déréférençait quand même, ce qui faisait
     mourir la boucle de rendu — c'était CE bug. On garde le garde-fou. */
  if(p.m) libererMesh(p.m);
  paves.delete(k);
}

export function libererTousLesPaves(){
  for(const k of [...paves.keys()]) libererPave(k);
}

/**
 * Construit / libère les pavés autour du joueur.
 * @param px,pz  position monde du joueur
 * @param fogD   densité de fog courante — c'est elle qui borne la portée
 */
export function majPaves(px, pz, fogD){
  const PORTEE = (2.4 / (fogD * 0.01)) + CH * CELL * 1.6, P2 = PORTEE * PORTEE;
  const r = Math.ceil(PORTEE / (CH * CELL));
  let budget = 3;                                  // au plus 3 pavés bâtis par image
  const cx = (w2c(px) / CH) | 0, cz = (w2c(pz) / CH) | 0;

  for(let dz=-r; dz<=r; dz++) for(let dx=-r; dx<=r; dx++){
    const a = cx+dx, b = cz+dz;
    if(a<0 || b<0 || a>=CHW || b>=CHH) continue;
    const k = b*CHW + a;
    if(paves.has(k)) continue;
    const c = paveCentre(k);
    if((c.x-px)**2 + (c.z-pz)**2 > P2) continue;
    if(budget-- <= 0) continue;
    paves.set(k, {m: batirPave(k), x:c.x, z:c.z});
  }
  for(const [k,p] of paves)
    if((p.x-px)**2 + (p.z-pz)**2 > P2*2.4) libererPave(k);
}

/* ─────────────── cuisson d'un pavé ─────────────── */

/* Hauteur d'un coin : moyenne des cellules voisines dont l'altitude est
   proche. Au-delà du seuil LEDGE l'arête reste franche — c'est ainsi qu'on
   obtient à la fois des pentes lisses et de vraies corniches, et c'est ce qui
   fait que les falaises de monde/relief.js se lisent comme des falaises. */
function cornerH(x,z,ox,oz,base,arr){
  let s = base, n = 1;
  for(const [dx,dz] of [[ox,0],[0,oz],[ox,oz]]){
    if(!isFloor(x+dx,z+dz)) continue;
    const v = arr[idx(x+dx,z+dz)];
    if(Math.abs(v-base) > LEDGE) continue;
    s += v; n++;
  }
  return s/n;
}

/* ═══════════════ GREEDY MESHING ═══════════════
   Le sol d'une salle carvée est plat sur des dizaines de cellules : en émettre
   deux triangles par cellule est un gaspillage pur. Le greedy meshing fusionne
   les cellules voisines qui portent EXACTEMENT la même chose en un seul grand
   rectangle, avant de produire la géométrie.

   ── LES DEUX CONDITIONS DE FUSION ──────────────────────────────────────────
   1. La cellule doit être PLATE : ses quatre coins interpolés par cornerH()
      valent sa propre hauteur, à epsilon près. Dès qu'un voisin est à une
      altitude différente, cornerH biseaute le coin — et fusionner effacerait ce
      biseau, donc les pentes douces et les corniches. Ces cellules-là restent
      donc traitées une par une, exactement comme avant.
   2. Elle doit partager sa clé avec sa voisine : même hauteur, même biome,
      même NIVEAU DE TEINTE.

   ── LA TEINTE, LE PIÈGE ────────────────────────────────────────────────────
   Chaque cellule était mouchetée par hash2(x,z), une valeur continue : deux
   cellules n'avaient donc JAMAIS la même couleur, et rien n'aurait pu
   fusionner. On quantifie la moucheture en quelques paliers. On garde la
   variation qui casse les grands aplats, on gagne la fusion — et le tramage du
   post-process brouille de toute façon les frontières entre paliers.

   ── LES PAROIS ─────────────────────────────────────────────────────────────
   Fusion en une dimension seulement : le long d'un mur, les cellules
   consécutives qui montent à la même hauteur donnent un seul quad. C'est le
   cas de tous les périmètres de salle.                                       */

const TEINTES = 5;               // paliers de moucheture
const BLOC_TEINTE = 4;           // cellules : la moucheture varie par BLOC
const PLAT = 0.012;              // tolérance pour juger une cellule plate

/* ── POURQUOI LA MOUCHETURE EST PAR BLOC ──
   Première tentative : hash2(x,z) par cellule, quantifié en cinq paliers. Deux
   cellules voisines partageaient donc leur palier une fois sur cinq, et la
   plage fusionnable moyenne tombait à 1,25 cellule — mesuré, 3 % de gain.
   Même une salle parfaitement plate ne pouvait pas fusionner, uniquement à
   cause de la couleur.

   La moucheture est maintenant tirée par bloc de 4 × 4 cellules, soit 6 m. À
   20 m de visibilité c'est encore une variation qu'on perçoit sur les grandes
   surfaces, et les salles fusionnent enfin. */

/** Compteurs du dernier pavé bâti. Lus par le rapport de génération. */
export const statsMaillage = {quadsBruts:0, quadsEmis:0, paves:0,
                              plats:0, nonPlats:0,
                              paroisBrutes:0, paroisEmises:0};

export function batirPave(k){
  const P=[], N=[], C=[];
  const kx0 = (k % CHW) * CH, kz0 = ((k / CHW) | 0) * CH;
  const kx1 = Math.min(GW, kx0+CH), kz1 = Math.min(GH, kz0+CH);
  const LX = kx1 - kx0, LZ = kz1 - kz0;
  if(LX <= 0 || LZ <= 0) return null;

  const quad = (p,n,c) => {
    const push = (v,cc) => { P.push(v[0],v[1],v[2]); N.push(n[0],n[1],n[2]); C.push(cc[0],cc[1],cc[2]); };
    push(p[0],c[0]); push(p[1],c[1]); push(p[2],c[2]);
    push(p[0],c[0]); push(p[2],c[2]); push(p[3],c[3]);
  };
  const h = CELL/2;

  const teinteDe = (x,z) => Math.floor(
    hash2(Math.floor(x/BLOC_TEINTE), Math.floor(z/BLOC_TEINTE)) * TEINTES);

  /** Un coin de cellule en coordonnées monde. sa/sb valent ±1 sur chaque axe. */
  const coin = (x, z, s2) => [c2w(x) + s2[0]*h, c2w(z) + s2[1]*h];
  const facteur  = niv => 0.88 + (niv + 0.5) / TEINTES * 0.24;

  /* ── passe 1 : les clés ──
     Pour chaque cellule du pavé, on note si elle est fusionnable et sous quelle
     clé. Une clé nulle veut dire « à traiter individuellement ». */
  const cleSol = new Float64Array(LX*LZ).fill(NaN);
  const clePla = new Float64Array(LX*LZ).fill(NaN);
  const vus    = new Uint8Array(LX*LZ);

  for(let z=kz0; z<kz1; z++) for(let x=kx0; x<kx1; x++){
    const i = idx(x,z);
    if(grid[i] !== FLOOR || vide[i]) continue;
    const l = (z-kz0)*LX + (x-kx0);
    const f = floorH[i], ce = ceilH[i];

    const platSol =
      Math.abs(cornerH(x,z,-1,-1,f,floorH) - f) < PLAT &&
      Math.abs(cornerH(x,z, 1,-1,f,floorH) - f) < PLAT &&
      Math.abs(cornerH(x,z, 1, 1,f,floorH) - f) < PLAT &&
      Math.abs(cornerH(x,z,-1, 1,f,floorH) - f) < PLAT;
    const platPla = !sky[i] &&
      Math.abs(cornerH(x,z,-1,-1,ce,ceilH) - ce) < PLAT &&
      Math.abs(cornerH(x,z, 1,-1,ce,ceilH) - ce) < PLAT &&
      Math.abs(cornerH(x,z, 1, 1,ce,ceilH) - ce) < PLAT &&
      Math.abs(cornerH(x,z,-1, 1,ce,ceilH) - ce) < PLAT;

    /* La clé encode hauteur (au centimètre), biome et teinte dans un seul
       nombre : la comparaison de fusion devient un test d'égalité. */
    const t = teinteDe(x,z);
    if(platSol) statsMaillage.plats++; else statsMaillage.nonPlats++;
    if(platSol) cleSol[l] = Math.round(f*100)*1000 + biome[i]*TEINTES + t;
    if(platPla) clePla[l] = Math.round(ce*100)*1000 + biome[i]*TEINTES + t;
  }

  /* ── passe 2 : fusion gloutonne ──
     Pour chaque cellule non encore vue, on étend le rectangle vers la droite
     tant que la clé tient, puis vers le bas tant que TOUTE la rangée tient.
     C'est l'algorithme classique, en O(cellules). */
  const gloutonner = (cles, versLeHaut) => {
    vus.fill(0);
    for(let lz=0; lz<LZ; lz++) for(let lx=0; lx<LX; lx++){
      const l = lz*LX + lx;
      if(vus[l] || Number.isNaN(cles[l])) continue;
      const cle = cles[l];

      let w = 1;
      while(lx+w < LX && !vus[l+w] && cles[l+w] === cle) w++;

      let ht = 1;
      croissance:
      while(lz+ht < LZ){
        const base = (lz+ht)*LX + lx;
        for(let q=0; q<w; q++)
          if(vus[base+q] || cles[base+q] !== cle) break croissance;
        ht++;
      }

      for(let dz=0; dz<ht; dz++) for(let dx=0; dx<w; dx++) vus[(lz+dz)*LX + lx+dx] = 1;
      statsMaillage.quadsBruts += w*ht;
      statsMaillage.quadsEmis++;

      // le rectangle en coordonnées monde
      const x0 = kx0+lx, z0 = kz0+lz;
      const i0 = idx(x0, z0);
      const y  = versLeHaut ? floorH[i0] : ceilH[i0];
      const ax = c2w(x0) - h,        az = c2w(z0) - h;
      const bx = c2w(x0+w-1) + h,    bz = c2w(z0+ht-1) + h;
      const v = facteur(teinteDe(x0, z0));
      const base = versLeHaut ? BIOMES[biome[i0]].floor : BIOMES[biome[i0]].ceil;
      const col = [base[0]*v, base[1]*v, base[2]*v];

      if(versLeHaut)
        quad([[ax,y,az],[bx,y,az],[bx,y,bz],[ax,y,bz]],[0,1,0],[col,col,col,col]);
      else
        quad([[ax,y,bz],[bx,y,bz],[bx,y,az],[ax,y,az]],[0,-1,0],[col,col,col,col]);
    }
  };

  gloutonner(cleSol, true);
  gloutonner(clePla, false);

  /* ── passe 3 : le reste, cellule par cellule ──
     Tout ce qui n'était pas plat : pentes, corniches, abords de gouffre. Plus
     TOUTES les parois, traitées ensuite avec leur propre fusion 1D. */
  for(let z=kz0; z<kz1; z++) for(let x=kx0; x<kx1; x++){
    const i = idx(x,z);
    if(grid[i] !== FLOOR || vide[i]) continue;
    const l = (z-kz0)*LX + (x-kx0);
    const B = BIOMES[biome[i]], cx = c2w(x), cz = c2w(z), f = floorH[i], ce = ceilH[i];
    const v = facteur(teinteDe(x,z));
    const tint = a => [a[0]*v, a[1]*v, a[2]*v];

    const f00=cornerH(x,z,-1,-1,f,floorH), f10=cornerH(x,z,1,-1,f,floorH),
          f11=cornerH(x,z,1,1,f,floorH),   f01=cornerH(x,z,-1,1,f,floorH);
    const c00=cornerH(x,z,-1,-1,ce,ceilH), c10=cornerH(x,z,1,-1,ce,ceilH),
          c11=cornerH(x,z,1,1,ce,ceilH),   c01=cornerH(x,z,-1,1,ce,ceilH);
    const cf=tint(B.floor), cc=tint(B.ceil), wt=tint(B.wall),
          wb=[wt[0]*0.42, wt[1]*0.42, wt[2]*0.42];

    // sol et plafond : uniquement s'ils n'ont pas été fusionnés
    if(Number.isNaN(cleSol[l])){
      statsMaillage.quadsBruts++; statsMaillage.quadsEmis++;
      quad([[cx-h,f00,cz-h],[cx+h,f10,cz-h],[cx+h,f11,cz+h],[cx-h,f01,cz+h]],
           [0,1,0],[cf,cf,cf,cf]);
    }
    if(!sky[i] && Number.isNaN(clePla[l])){
      statsMaillage.quadsBruts++; statsMaillage.quadsEmis++;
      quad([[cx-h,c01,cz+h],[cx+h,c11,cz+h],[cx+h,c10,cz-h],[cx-h,c00,cz-h]],
           [0,-1,0],[cc,cc,cc,cc]);
    }

  }

  /* ═══ PASSE 4 : LES PAROIS, FUSIONNÉES EN BANDES ═══
     Mesuré : les parois représentaient 61 % de la géométrie d'un pavé (45 786
     quads contre 29 064 pour les sols et plafonds réunis) et n'étaient pas
     fusionnées du tout. C'est là qu'était le gisement, pas dans les sols dont
     seuls 21 % sont réellement plans.

     Fusion en UNE dimension : le long d'un mur, les cellules consécutives dont
     le profil est identique donnent un seul quad. Un périmètre de salle ou une
     paroi de gouffre, qui font des dizaines de cellules de long à hauteur
     constante, passent ainsi de trente quads à un seul.

     Condition de fusion : le quad doit être un vrai rectangle, donc ses deux
     bords verticaux doivent être à la même hauteur (ha == hb et ca == cb). Dès
     que la paroi est en biais — une corniche qui descend en pente — on retombe
     sur l'émission cellule par cellule, qui reste exacte.                    */
  const BORD = 0.02;

  /* Les quatre côtés. Pour chacun : le voisin visé, l'axe de parcours, et les
     deux coins du segment. On les décrit une fois pour ne pas écrire quatre
     fois la même boucle. */
  const COTES = [
    {nx:0,  nz:1,  axe:'x', n:[0,0,1],  ca:'00', cb:'10', sa:[-1,-1], sb:[ 1,-1]},
    {nx:0,  nz:-1, axe:'x', n:[0,0,-1], ca:'11', cb:'01', sa:[ 1, 1], sb:[-1, 1]},
    {nx:1,  nz:0,  axe:'z', n:[1,0,0],  ca:'01', cb:'00', sa:[-1, 1], sb:[-1,-1]},
    {nx:-1, nz:0,  axe:'z', n:[-1,0,0], ca:'10', cb:'11', sa:[ 1,-1], sb:[ 1, 1]},
  ];

  for(const C of COTES){
    const longAxeX = C.axe === 'x';
    const nLong = longAxeX ? LX : LZ;
    const nTrav = longAxeX ? LZ : LX;

    for(let t=0; t<nTrav; t++){
      /* `courant` accumule la bande en cours. On la vide dès qu'une cellule ne
         prolonge pas le même rectangle. */
      let courant = null;

      const vider = () => {
        if(!courant) return;
        const q = courant;
        quad([[q.ax, q.y0, q.az], [q.bx, q.y0, q.bz],
              [q.bx, q.y1, q.bz], [q.ax, q.y1, q.az]],
             C.n, [q.cBas, q.cBas, q.cHaut, q.cHaut]);
        statsMaillage.paroisEmises++;
        courant = null;
      };

      for(let u=0; u<nLong; u++){
        const x = kx0 + (longAxeX ? u : t), z = kz0 + (longAxeX ? t : u);
        const i = idx(x,z);
        if(grid[i] !== FLOOR || vide[i]){ vider(); continue; }

        const pxc = x - C.nx, pzc = z - C.nz;
        const f = floorH[i], ce = ceilH[i];
        const co = {
          '00': cornerH(x,z,-1,-1,f,floorH), '10': cornerH(x,z,1,-1,f,floorH),
          '11': cornerH(x,z,1,1,f,floorH),   '01': cornerH(x,z,-1,1,f,floorH),
        };
        const ct = {
          '00': cornerH(x,z,-1,-1,ce,ceilH), '10': cornerH(x,z,1,-1,ce,ceilH),
          '11': cornerH(x,z,1,1,ce,ceilH),   '01': cornerH(x,z,-1,1,ce,ceilH),
        };
        const ha = co[C.ca], hb = co[C.cb], ca = ct[C.ca], cb = ct[C.cb];

        const v = facteur(teinteDe(x,z));
        const B = BIOMES[biome[i]];
        const wt = [B.wall[0]*v, B.wall[1]*v, B.wall[2]*v];
        const wb = [wt[0]*0.42, wt[1]*0.42, wt[2]*0.42];

        /* Quelle sorte de paroi, et entre quelles hauteurs ? On n'en garde
           qu'UNE par cellule pour la fusion — le second quad éventuel (un
           décrochement de plafond en plus d'une corniche) est rare et sort
           tout seul, sans fusion. */
        let kind = 0, y0 = 0, y1 = 0, bas = wb, haut = wt, extra = null;

        if(!isFloor(pxc,pzc)){
          kind = 1; y0 = ha; y1 = ca;                    // mur plein
        } else if(vide[idx(pxc,pzc)]){
          kind = 2; y0 = Math.min(ha,hb) - 40; y1 = ha;  // paroi de gouffre
          bas = [0,0,0]; haut = [wb[0]*0.25, wb[1]*0.25, wb[2]*0.25];
        } else {
          const nf = floorH[idx(pxc,pzc)], nc = ceilH[idx(pxc,pzc)];
          if(nf < Math.min(ha,hb)-0.05){ kind = 3; y0 = nf; y1 = ha; }
          if(nc < Math.max(ca,cb)-0.05)
            extra = {y0:nc, y1:ca, y1b:cb};              // décrochement de plafond
        }

        // le décrochement de plafond, non fusionné : trop rare pour valoir la peine
        if(extra){
          statsMaillage.paroisBrutes++;
          const A = coin(x, z, C.sa), Bp = coin(x, z, C.sb);
          quad([[A[0], extra.y0, A[1]], [Bp[0], extra.y0, Bp[1]],
                [Bp[0], extra.y1b, Bp[1]], [A[0], extra.y1, A[1]]],
               C.n, [wb, wb, wt, wt]);
          statsMaillage.paroisEmises++;
        }

        if(!kind){ vider(); continue; }
        statsMaillage.paroisBrutes++;      // une paroi de plus, fusionnée ou non

        // rectangle ? sinon on sort la cellule seule, en gardant le biais
        const droit = Math.abs(ha - hb) < BORD &&
                      (kind !== 1 || Math.abs(ca - cb) < BORD);
        const A = coin(x, z, C.sa), Bp = coin(x, z, C.sb);

        if(!droit){
          vider();
          const yb = kind === 1 ? ca : (kind === 2 ? ha : ha);
          const y0a = kind === 1 ? ha : y0, y0b = kind === 1 ? hb : y0;
          const yha = kind === 1 ? ca : ha, yhb = kind === 1 ? cb : hb;
          quad([[A[0], y0a, A[1]], [Bp[0], y0b, Bp[1]],
                [Bp[0], yhb, Bp[1]], [A[0], yha, A[1]]],
               C.n, [bas, bas, haut, haut]);
          statsMaillage.paroisEmises++;
          continue;
        }

        /* La clé n'inclut PAS la moucheture. Mesuré : avec elle, une bande
           cassait tous les quatre blocs et la fusion tombait à 2 %. Une paroi
           prend donc la teinte de sa première cellule — sur une surface
           verticale, presque toujours dans l'ombre, ça ne se voit pas, et ça
           rend la fusion possible sur toute la longueur d'un mur.
           Les hauteurs sont arrondies à 5 cm : en deçà, l'écart est invisible
           sur une paroi et il empêchait toute bande de se former. */
        const Q = 20;                                   // 1/20 m = 5 cm
        const qy0 = Math.round(y0*Q)/Q, qy1 = Math.round(y1*Q)/Q;
        const cle = kind + '|' + qy0 + '|' + qy1 + '|' + biome[i];
        y0 = qy0; y1 = qy1;
        if(courant && courant.cle === cle){
          courant.bx = Bp[0]; courant.bz = Bp[1];        // on prolonge la bande
        } else {
          vider();
          courant = {cle, y0, y1, cBas:bas, cHaut:haut,
                     ax:A[0], az:A[1], bx:Bp[0], bz:Bp[1]};
        }
      }
      vider();
    }
  }

  // éléments de décor cuits dans le même maillage
  for(const pr of propsParPave.get(k) || []){
    if(pr.lampe){
      const L = pr.lampe, sL = 0.16;
      quad([[L.x-sL,L.y-sL,L.z],[L.x+sL,L.y-sL,L.z],[L.x+sL,L.y+sL,L.z],[L.x-sL,L.y+sL,L.z]],
           [0,0,1],[L.c,L.c,L.c,L.c]);
      quad([[L.x,L.y-sL,L.z-sL],[L.x,L.y-sL,L.z+sL],[L.x,L.y+sL,L.z+sL],[L.x,L.y+sL,L.z-sL]],
           [1,0,0],[L.c,L.c,L.c,L.c]);
      continue;
    }
    for(const q of pr.parts){
      if(q.emis){    // sommets clairs : le shader les remonte via uEmit global
        q.c = [Math.min(1.6,q.c[0]), Math.min(1.6,q.c[1]), Math.min(1.6,q.c[2])];
      }
      if(q.tube) cuireTube(quad, q);
      else       cuireBoite(quad, q);
    }
  }

  statsMaillage.paves++;
  return P.length ? mesh(P,N,C) : null;
}

/** Boîte orientée autour de Z. La primitive historique. */
export function cuireBoite(quad, q){
  const co = Math.cos(q.r||0), si = Math.sin(q.r||0);
  const hx = q.sx/2, hy = q.sy/2, hz = q.sz/2;
  const V = (sx,sy,sz) => {
    const X = sx*hx, Y = sy*hy, Z = sz*hz;
    return [q.x + X*co - Y*si, q.y + X*si + Y*co, q.z + Z];
  };
  const F = [
    [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1],[0,0,1]],
    [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1],[0,0,-1]],
    [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1],[co,si,0]],
    [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1],[-co,-si,0]],
    [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1],[-si,co,0]],
    [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[si,-co,0]],
  ];
  for(const f of F) quad([V(...f[0]),V(...f[1]),V(...f[2]),V(...f[3])], f[4], [q.c,q.c,q.c,q.c]);
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


/* ═══ CUISSON HORS PAVÉ ═══
   Fabrique un maillage autonome à partir d'une liste de `parts`, avec
   EXACTEMENT les mêmes primitives que le décor du jeu.

   C'est ce qui permet à l'éditeur d'assets de montrer la vérité : il ne
   réimplémente pas la géométrie, il appelle le même code. Un éditeur qui
   redessine à sa façon finit toujours par diverger du moteur, et on ne s'en
   aperçoit qu'en jeu.                                                       */
export function cuireParts(parts){
  const P=[], N=[], C=[];
  const quad = (p,n,c) => {
    const push = (v,cc) => { P.push(v[0],v[1],v[2]); N.push(n[0],n[1],n[2]); C.push(cc[0],cc[1],cc[2]); };
    push(p[0],c[0]); push(p[1],c[1]); push(p[2],c[2]);
    push(p[0],c[0]); push(p[2],c[2]); push(p[3],c[3]);
  };
  for(const q of parts){
    if(!q) continue;
    if(q.tube) cuireTube(quad, q);
    else       cuireBoite(quad, q);
  }
  return P.length ? mesh(P,N,C) : null;
}
