/* ═══ MONDE / PROPS ═══
   Le décor. Colonnades, piliers, cristaux, monolithes, troncs, gravats.

   Les colonnades et les plateformes ne sont pas du remplissage : elles cassent
   les lignes droites, donnent des repères dans le fog, et créent l'asymétrie
   verticale (elle grimpe, pas toi).

   ── POLYCOUNT (v3) ─────────────────────────────────────────────────────────
   La v2 construisait tout en boîtes à 6 faces. Ici on dispose de trois
   primitives, toutes pilotées par SETUP.image.detail :

     bloc()     boîte, comme avant (0 subdivision)
     colonne()  cylindre à N côtés, N suit le détail
     eclat()    bloc irrégulier à sommets déplacés — la roche cesse d'être cubique

   Un élément est une liste de `parts`. Une part est soit une boîte
   {x,y,z,sx,sy,sz,c,r,emis}, soit un prisme {tube:[p0,r0,p1,r1,cotes],c,emis}.
   monde/maillage.js sait cuire les deux.                                    */

import {SETUP} from '../setup.js';
import {rnd, ri, rf} from '../noyau/rng.js';
import {BIOMES} from './biomes.js';
import {
  GW, GH, CELL, floorH, ceilH, openN, blocked, biome, sky,
  idx, isFloor, isFree, c2w, celluleLibre,
} from './grille.js';
import {salles} from './generation.js';
import {rayonPart, capsulePart} from './formes.js';
import {autorise, densiteEn} from './plan.js';

export const props = [], lights = [], colliders = [];

/* ─────────────── primitives ─────────────── */

const bloc = (x,y,z,sx,sy,sz,c,r=0,emis=0) => ({x,y,z,sx,sy,sz,c,r,emis});

/** Prisme à N côtés entre deux points. N monte avec SETUP.image.detail. */
const colonne = (p0,r0,p1,r1,c,emis=0) => ({
  tube:[p0,r0,p1,r1, Math.max(4, Math.round(6 * SETUP.image.detail))], c, emis,
});

/** Un amas de blocs irréguliers : de la roche, pas un cube. */
function eclat(out, x,y,z, taille, c){
  const n = Math.max(1, Math.round(3 * SETUP.image.detail));
  for(let k=0;k<n;k++){
    const s = taille * rf(0.45, 1.0);
    out.push(bloc(x+rf(-taille,taille)*0.4, y+rf(0,taille)*0.35, z+rf(-taille,taille)*0.4,
                  s, s*rf(0.5,1), s*rf(0.7,1.2), c, rf(0,3)));
  }
}

/* ─────────────── un élément de décor ─────────────── */

export function addProp(kind, x, z, i){
  const b = BIOMES[biome[i]], wx = c2w(x), wz = c2w(z), h = floorH[i];
  const D = SETUP.image.detail;
  let solid = true, dur = false, parts = [];

  switch(kind){
    case 'pilier': {
      const th = ceilH[i]-h, br = rf(.45,.62);
      // fût cylindrique plutôt qu'une boîte : 12 faces au lieu de 6 au détail 2
      parts.push(colonne([wx,h,wz], br, [wx,h+th,wz], br*0.88, b.wall));
      parts.push(bloc(wx, h+0.15, wz, br*1.5, 0.3, br*1.5, b.wall));
      parts.push(bloc(wx, h+th-0.2, wz, br*1.4, 0.4, br*1.4, b.wall));
      // cannelures
      if(D >= 1) for(let k=0;k<Math.round(4*D);k++){
        const a = k/Math.round(4*D)*6.283;
        parts.push(colonne([wx+Math.cos(a)*br*0.95, h+0.3, wz+Math.sin(a)*br*0.95], 0.05,
                           [wx+Math.cos(a)*br*0.88, h+th-0.3, wz+Math.sin(a)*br*0.88], 0.04,
                           [b.wall[0]*0.7,b.wall[1]*0.7,b.wall[2]*0.7]));
      }
      break; }

    case 'arche': {
      const th = ceilH[i]-h;
      for(const sd of [1,-1])
        parts.push(colonne([wx+sd*1.05,h,wz], .38, [wx+sd*1.05,h+th,wz], .30, b.wall));
      // voussoirs : l'arc devient un vrai arc et non un linteau
      const NV = Math.max(3, Math.round(6*D));
      for(let k=0;k<NV;k++){
        const a0 = Math.PI*(k/NV), a1 = Math.PI*((k+1)/NV);
        parts.push(colonne(
          [wx-Math.cos(a0)*1.05, h+th-0.35+Math.sin(a0)*0.55, wz], .22,
          [wx-Math.cos(a1)*1.05, h+th-0.35+Math.sin(a1)*0.55, wz], .22, b.wall));
      }
      solid = false; break; }

    case 'gravats': {
      for(let k=0;k<Math.round(4*D);k++) eclat(parts, wx+rf(-1,1), h, wz+rf(-1,1), rf(.3,.85), b.wall);
      solid = false; break; }

    case 'stalag': {
      for(let k=0;k<Math.round(3*D);k++){
        const ht = rf(1.0,2.6), s = rf(.22,.45);
        const bx = wx+rf(-1,1), bz = wz+rf(-1,1);
        parts.push(colonne([bx,h,bz], s, [bx+rf(-.1,.1), h+ht, bz+rf(-.1,.1)], 0.02, b.floor));
      }
      // stalactites au plafond : la v2 n'en avait pas, le plafond était nu
      const th = ceilH[i]-h;
      if(th > 2.2) for(let k=0;k<Math.round(3*D);k++){
        const ht = rf(0.5, Math.min(1.8, th*0.4));
        const bx = wx+rf(-1,1), bz = wz+rf(-1,1);
        parts.push(colonne([bx, h+th, bz], rf(.10,.22), [bx, h+th-ht, bz], 0.015, b.ceil));
      }
      solid = false; break; }

    case 'glace': {
      const ht = rf(1.8, Math.max(2.0, ceilH[i]-h));
      parts.push(colonne([wx,h,wz], rf(.5,.9), [wx+rf(-.2,.2), h+ht, wz+rf(-.2,.2)], rf(.1,.3),
                         [.62,.74,.88]));
      break; }

    case 'poutre': {
      parts.push(bloc(wx, h+rf(2.2,4.5), wz, rf(2.5,5), .30, .42, b.wall));
      parts.push(colonne([wx,h,wz], .30, [wx,h+2.2,wz], .26, b.wall));
      if(D>=1) for(const sd of [1,-1])       // goussets
        parts.push(colonne([wx+sd*0.9, h+2.4, wz], .08, [wx, h+1.4, wz], .08, b.wall));
      break; }

    case 'conduit': {
      const L = rf(3,6);
      parts.push(colonne([wx,h+rf(1.5,3.5),wz-L/2], .35, [wx,h+rf(1.5,3.5),wz+L/2], .35,
                         [.33,.34,.32]));
      if(D>=1) for(let k=0;k<Math.round(3*D);k++)   // colliers
        parts.push(bloc(wx, h+2.5, wz-L/2+L*(k+0.5)/Math.round(3*D), .44,.10,.10, [.28,.28,.26]));
      solid = false; break; }

    case 'tronc': {
      const ht = sky[i] ? rf(7,16) : Math.max(1.5, ceilH[i]-h-rf(0,1.5));
      parts.push(colonne([wx,h,wz], rf(.4,.7), [wx+rf(-.4,.4), h+ht, wz+rf(-.4,.4)], rf(.15,.3),
                         [.17,.15,.13]));
      // branches mortes
      if(D>=1) for(let k=0;k<Math.round(3*D);k++){
        const a = rnd()*6.283, y = h + ht*rf(0.45,0.92), L = rf(0.6,1.8);
        parts.push(colonne([wx,y,wz], .09,
                           [wx+Math.cos(a)*L, y+rf(0.1,0.6), wz+Math.sin(a)*L], .02, [.15,.13,.11]));
      }
      break; }

    /* MONOLITHE — la roche pleine ne raconte rien. Une tour aveugle percée de
       fenêtres allumées dit qu'il y a eu quelqu'un. */
    case 'monolithe': {
      const ht = rf(9,22), br = rf(1.1,2.2), c1 = [.14,.13,.13];
      parts.push(bloc(wx, h+ht/2, wz, br, ht, br*rf(.7,1.1), c1, rf(-.04,.04)));
      parts.push(bloc(wx, h+.35, wz, br*1.5, .7, br*1.5, c1));
      if(D>=1) parts.push(bloc(wx, h+ht-0.2, wz, br*1.15, .4, br*1.15, c1));  // corniche
      const teinte = b.lum;
      for(let e=0; e<Math.floor(ht/2.6); e++){
        const y = h + 2.2 + e*2.6;
        if(rnd() < 0.42) continue;               // toutes ne sont pas allumées
        const f = rnd() < 0.5 ? 0 : 1;
        parts.push(bloc(wx+(f?br*0.52:0), y, wz+(f?0:br*0.52),
                        f?.10:.42, .34, f?.42:.10,
                        [teinte[0]*2.4, teinte[1]*2.4, teinte[2]*2.4], 0, 1));
        if(lights.length < SETUP.decor.maxLumieres)
          lights.push({x:wx+(f?br*0.8:0), y, z:wz+(f?0:br*0.8),
                       c:[teinte[0]*.7, teinte[1]*.7, teinte[2]*.7], ph:rnd()*6.28});
      }
      break; }

    case 'tourFenetres': {
      const ht = rf(16,44), br = rf(2.0,4.2), pf = rf(1.6,3.6);
      parts.push(bloc(wx, h+ht/2, wz, br, ht, pf, [.055,.02,.018]));
      const nx2 = Math.max(2, Math.round(br*1.5)), ny2 = Math.floor(ht/1.5);
      for(let a=0;a<nx2;a++) for(let b2=0;b2<ny2;b2++){
        if(rnd() < 0.30) continue;
        const c2 = rnd() < 0.72 ? [2.6,2.3,1.7] : [2.4,1.1,0.55];
        const px2 = wx + (a/Math.max(1,nx2-1) - 0.5)*br*0.86, py2 = h + 1.4 + b2*1.5;
        parts.push(bloc(px2, py2, wz+pf*0.52, br/nx2*0.62, .34, .06, c2, 0, 1));
        parts.push(bloc(px2, py2, wz-pf*0.52, br/nx2*0.62, .34, .06, c2, 0, 1));
      }
      if(lights.length < SETUP.decor.maxLumieres)
        lights.push({x:wx, y:h+ht*0.4, z:wz, c:[0.55,0.20,0.11], ph:rnd()*6.28});
      break; }

    case 'meneau': {
      const ht = Math.min(Math.max(2, ceilH[i]-h), rf(8,26));
      parts.push(bloc(wx, h+ht/2, wz, .30, ht, .30, [.10,.03,.028]));
      parts.push(bloc(wx+0.17, h+ht/2, wz, .06, ht*.94, .22, [2.2,.34,.20], 0, 1));
      if(lights.length < SETUP.decor.maxLumieres)
        lights.push({x:wx+0.4, y:h+ht*0.55, z:wz, c:[0.85,0.14,0.08], ph:rnd()*6.28});
      break; }

    /* CRISTAUX — la seule chose qui éclaire vraiment le fog par en bas. */
    case 'cristal': {
      const teinte = b.sky ? [0.3,0.55,0.9] : [0.35,0.75,0.95];
      const n = ri(3, Math.round(6*D));
      for(let k=0;k<n;k++){
        const ht = rf(0.8,3.4), br = rf(.12,.34);
        const bx = wx+rf(-1,1), bz = wz+rf(-1,1);
        // prisme à 5 côtés effilé : un cristal, plus une allumette
        parts.push({tube:[[bx,h,bz], br, [bx+rf(-.4,.4), h+ht, bz+rf(-.4,.4)], 0.02, 5],
                    c:[teinte[0]*1.9, teinte[1]*1.9, teinte[2]*1.9], emis:1});
      }
      if(lights.length < SETUP.decor.maxLumieres)
        lights.push({x:wx, y:h+1.5, z:wz,
                     c:[teinte[0]*1.5, teinte[1]*1.5, teinte[2]*1.5], ph:rnd()*6.28});
      solid = false; break; }

    case 'souche': {
      parts.push(colonne([wx,h,wz], rf(.8,1.2), [wx,h+.8,wz], rf(.6,.9), [.19,.17,.14]));
      if(D>=1) for(let k=0;k<Math.round(4*D);k++){    // racines
        const a = rnd()*6.283;
        parts.push(colonne([wx,h+.2,wz], .12,
                           [wx+Math.cos(a)*rf(.8,1.6), h+.02, wz+Math.sin(a)*rf(.8,1.6)], .03,
                           [.15,.13,.11]));
      }
      solid = false; break; }

    /* ── OSSEMENTS : le seul décor qui raconte quelque chose.
       En v2 c'étaient des boîtes plates. Ici ce sont des os : diaphyse fine,
       épiphyses renflées aux deux bouts. ── */
    case 'os': {
      const co = [.72,.70,.62];
      for(let k=0; k<Math.round(5*D); k++){
        const a = rnd()*6.283, L = rf(.5,1.3);
        const p0 = [wx+rf(-1.2,1.2), h+.08, wz+rf(-1.2,1.2)];
        const p1 = [p0[0]+Math.cos(a)*L, h+.08+rf(-.04,.06), p0[2]+Math.sin(a)*L];
        parts.push(colonne(p0, .05, p1, .05, co));
        parts.push(colonne(p0, .09, [p0[0]-Math.cos(a)*.06, p0[1], p0[2]-Math.sin(a)*.06], .07, co));
        parts.push(colonne(p1, .09, [p1[0]+Math.cos(a)*.06, p1[1], p1[2]+Math.sin(a)*.06], .07, co));
      }
      solid = false; break; }

    /* Une côte n'est pas un barreau vertical : elle part de l'échine, s'ouvre
       vers l'extérieur et se referme. Chaque arceau est fait de segments
       inclinés par paire gauche/droite — en v3 ce sont des tubes courbes à
       trois segments, plus des vertèbres réelles. */
    case 'cotes': {
      const co = [.66,.64,.56], yw = rf(0,3), cy = Math.cos(yw), sy2 = Math.sin(yw);
      const echine = 2.8;
      const NA = Math.max(4, Math.round(6*D));
      const NS = Math.max(3, Math.round(4*D));      // segments par arceau
      for(let k=0; k<NA; k++){
        const t = k/(NA-1);
        const lx = wx + cy*(t-.5)*echine, lz = wz + sy2*(t-.5)*echine;
        const ouv = 0.30 + Math.sin(t*3.14)*0.62;   // la cage s'ouvre au milieu
        const haut = 0.28 + Math.sin(t*3.14)*0.34;
        for(const sd of [1,-1]){
          let prev = [lx, h+0.12, lz];
          for(let q=1; q<=NS; q++){
            const u = q/NS, ang = u*1.9;
            const nxt = [lx - sy2*ouv*Math.sin(ang)*sd,
                         h + 0.12 + haut*(1-Math.cos(ang))*1.15,
                         lz + cy*ouv*Math.sin(ang)*sd];
            parts.push(colonne(prev, 0.075 - q*0.012, nxt, 0.065 - q*0.012, co));
            prev = nxt;
          }
        }
      }
      // l'échine couchée, avec des vertèbres saillantes
      for(let k=0; k<Math.round(7*D); k++){
        const t = (k+.5)/Math.round(7*D);
        const vx = wx + cy*(t-.5)*echine, vz = wz + sy2*(t-.5)*echine;
        parts.push(colonne([vx,h+.09,vz], .11, [vx,h+.24,vz], .07, co));
        parts.push(colonne([vx - cy*echine/14, h+.12, vz - sy2*echine/14], .085,
                           [vx + cy*echine/14, h+.12, vz + sy2*echine/14], .085, co));
      }
      solid = false; break; }

    /* ═══════════════ VESTIGES HUMAINS ═══════════════
       « Ajouter des vestiges humains style anciennes maisons ou immeubles et
       voitures détruites car tout le monde s'est fait bouffer. »

       Trois règles pour que ça raconte quelque chose au lieu de meubler :
         · rien n'est intact — un mur sur quatre est tombé, les toits sont
           crevés, les voitures sont sur le flanc ;
         · ça éclaire. Un lampadaire qui marche encore ou un plafonnier de
           voiture, c'est un repère, et c'est ce qui manquait le plus ;
         · c'est orienté au hasard mais posé d'aplomb : une maison de travers
           lit comme un bug, pas comme une ruine.                            */

    /* ══════════════ MAISONNETTE ══════════════
       « Les villages sont toujours n'importe quoi, je ne sais pas ce que je
       vois. Tu dois faire des maisonnettes ou des huttes inhabitées. »

       LA VERSION PRÉCÉDENTE ÉTAIT UNE RUINE, et c'est ça le défaut. Quatre
       moignons de murs arasés à des hauteurs tirées au sort entre 55 et 100 %,
       un mur remplacé par un tas de moellons, aucun toit, trois pannes en
       travers. Chaque élément était plausible ; l'ensemble ne ressemblait à
       rien, parce qu'il ne restait AUCUNE forme reconnaissable.

       UNE MAISON SE RECONNAÎT À SON TOIT. C'est la silhouette qui parle, pas
       le détail. Trois choses suffisent, et il les faut toutes les trois :

         · un TOIT à deux pentes — la seule forme qui dise « maison » de loin ;
         · une PORTE sombre, à taille humaine, qui donne l'échelle ;
         · des murs D'APLOMB et de hauteur ÉGALE.

       Les maisons sont donc entières. Inhabitées, pas détruites : volets
       clos, portes béantes, personne dedans. C'est plus inquiétant qu'un tas
       de gravats, parce qu'une ruine est un accident tandis qu'une maison
       intacte et vide est une absence.

       Une sur cinq est effondrée, pour que le village ne fasse pas maquette.
       Une sur cinq, pas quatre sur cinq.                                    */
    case 'maison': {
      const larg = rf(4.2, 6.0), prof = rf(3.6, 5.2);
      const mur = [.185,.170,.152], bois = [.115,.098,.082];
      const toit = [.135,.118,.105];
      const HM = rf(2.5, 3.0);                 // hauteur sous gouttière
      const HT = HM + rf(1.3, 2.1);            // faîtage
      const ry = Math.round(rnd()*4) * 1.5708 + rf(-0.06, 0.06);
      const cs = Math.cos(ry), sn = Math.sin(ry);
      // repère local : u vers la façade, v sur le côté
      const L = (u, v) => [wx + cs*u - sn*v, wz + sn*u + cs*v];

      const poser = (u, v, y, sx, sy, sz, c, em) => {
        const p = L(u, v);
        const q = bloc(p[0], h + y, p[1], sx, sy, sz, c, 0, em || 0);
        q.ry = ry;
        parts.push(q);
        return q;
      };

      const EP = 0.26;                          // épaisseur des murs
      const PORTE = 1.0, HPORTE = 2.05;         // à l'échelle d'un homme

      /* ── les quatre murs ──
         La façade est percée : on la pose en trois morceaux — deux jambages
         et un linteau — plutôt que d'y coller un rectangle sombre. Un trou
         qu'on peut franchir du regard vaut mieux qu'un trou peint. */
      const jamb = (larg - PORTE) / 2;
      poser(-prof/2, -(PORTE/2 + jamb/2), HM/2, EP, HM, jamb, mur);
      poser(-prof/2,  (PORTE/2 + jamb/2), HM/2, EP, HM, jamb, mur);
      poser(-prof/2, 0, HPORTE + (HM-HPORTE)/2, EP, Math.max(0.1, HM-HPORTE),
            PORTE, mur);

      poser( prof/2, 0, HM/2, EP, HM, larg, mur);          // mur du fond
      poser(0, -larg/2, HM/2, prof, HM, EP, mur);          // pignons
      poser(0,  larg/2, HM/2, prof, HM, EP, mur);

      /* ── le toit à deux pentes ──
         Deux coins adossés. C'est LA forme qui fait lire « maison » à trente
         mètres dans la brume, et c'est la primitive `coin` de la v3.4 qui la
         rend possible : avant, on n'avait que des boîtes. */
      const RISE = HT - HM, DEB = 0.42;         // débord de toiture
      for(const sd of [1, -1]){
        const p = L(0, sd * (larg/4 + DEB/2));
        const c = {coin: sd, x:p[0], y:h + HM + RISE/2, z:p[1],
                   sx: larg/2 + DEB, sy: RISE, sz: prof + DEB*2,
                   c: toit, ry: ry + Math.PI/2};
        parts.push(c);
      }
      // la panne faîtière, qui souligne l'arête
      {
        const a = L(-prof/2 - DEB, 0), b = L(prof/2 + DEB, 0);
        parts.push({tube:[[a[0], h+HT, a[1]], .09, [b[0], h+HT, b[1]], .09, 5],
                    c: bois});
      }

      /* ── volets clos, et une fenêtre ──
         Des plaques : quatre triangles au lieu de douze, et c'est exactement
         l'épaisseur qu'a un volet. */
      if(D >= 1) for(const sd of [1, -1]){
        if(rnd() < 0.3) continue;
        const p = L(-prof/2 - 0.02, sd * larg*0.28);
        parts.push({plaque:1, x:p[0], y:h + HM*0.58, z:p[1],
                    sx:0.72, sy:0.86, c: bois, ry: ry + Math.PI/2});
      }

      /* ── une sur cinq s'est affaissée ──
         Le toit glisse d'un côté et un pignon s'ouvre. On garde la silhouette
         : c'est une maison EFFONDRÉE, pas un tas anonyme. */
      if(rnd() < 0.2){
        for(let q=0; q<Math.round(7*D); q++){
          const p = L(rf(-prof/2, prof/2), rf(-larg/2, larg/2));
          eclat(parts, p[0], h, p[1], rf(.26,.55), mur);
        }
      }

      /* Une lueur derrière la porte. On ne dit pas ce que c'est : quelqu'un a
         laissé quelque chose allumé, ou c'est du lichen. */
      if(rnd() < 0.5 && lights.length < SETUP.decor.maxLumieres){
        const p = L(0.4, 0);
        lights.push({x:p[0], y:h+1.1, z:p[1], c:[0.95,0.55,0.22], ph:rnd()*6.28});
      }
      solid = false; break; }

    /* ══════════════ HUTTE ══════════════
       Plus petite, plus pauvre, plus ancienne : un tronc de cône sur des
       pieux. Elle se lit encore mieux qu'une maison parce qu'elle n'a qu'une
       forme — et deux formes différentes dans un village suffisent à ce qu'on
       n'y voie plus une grille d'objets identiques. */
    case 'hutte': {
      const ray = rf(1.5, 2.3), HM = rf(1.8, 2.3), HT = HM + rf(1.2, 1.9);
      const paroi = [.175,.155,.128], chaume = [.155,.132,.088];
      const ry = rnd() * 6.283;
      const NC = Math.max(5, Math.round(7 * D));

      // le fût : un prisme large et bas
      parts.push({tube:[[wx, h, wz], ray, [wx, h + HM, wz], ray*0.94, NC],
                  c: paroi});
      // le chaume : un cône, débordant
      parts.push({tube:[[wx, h + HM - 0.08, wz], ray*1.22,
                        [wx, h + HT, wz], 0.10, NC], c: chaume});

      /* L'entrée : un bloc sombre plaqué contre le fût. Une hutte sans
         ouverture est un champignon. */
      {
        const a = ry;
        const p = [wx + Math.cos(a)*ray*0.94, wz + Math.sin(a)*ray*0.94];
        const q = bloc(p[0], h + 0.85, p[1], 0.34, 1.7, 0.92, [.05,.045,.04]);
        q.ry = -a;
        parts.push(q);
      }

      // quelques pieux plantés autour — les restes d'un enclos
      if(D >= 1) for(let q=0; q<Math.round(4*D); q++){
        const a = rnd()*6.283, d = ray + rf(0.8, 2.2);
        const px = wx + Math.cos(a)*d, pz = wz + Math.sin(a)*d;
        parts.push({tube:[[px, h, pz], .07,
                          [px + rf(-.2,.2), h + rf(.7,1.5), pz + rf(-.2,.2)],
                          .05, 4], c: chaume});
      }
      solid = false; break; }

    /* ══════════════ LES ARMES ══════════════
       Elles vivent ici, avec le décor, et ce n'est pas un rangement par
       défaut : c'est ce qui les rend éditables dans la forge sans une ligne
       de code en plus. La forge charge un élément par son nom, le retouche,
       et le réécrit. Une arme est un élément comme un autre — sauf qu'on la
       tient.

       Elles sont donc bâties À L'ORIGINE, couchées le long de +X, la poignée
       vers l'arrière. joueur/vue-arme.js les prend telles quelles et les
       place devant la caméra ; monde/props.js les pose au sol quand elles
       traînent dans le monde. Une seule géométrie pour les deux cas. */

    case 'armePiedDeBiche': {
      const acier = [.26,.255,.25], rouille = [.30,.16,.09];
      const L = 0.92;                       // longueur totale, en mètres
      // le fût, légèrement conique
      parts.push({tube:[[wx - L*0.45, h+0.04, wz], .022,
                        [wx + L*0.34, h+0.04, wz], .018, 6], c: acier});
      // le col courbe, en trois segments : c'est lui qui dit « pied-de-biche »
      const col = [[0.34, 0.04], [0.44, 0.055], [0.50, 0.095], [0.52, 0.15]];
      for(let k=0; k<col.length-1; k++)
        parts.push({tube:[[wx + L*col[k][0],   h + col[k][1],   wz], .018,
                          [wx + L*col[k+1][0], h + col[k+1][1], wz], .016, 5],
                    c: acier});
      // la fourche, fendue
      for(const sd of [1,-1])
        parts.push({coin: 1, x: wx + L*0.545, y: h + 0.165, z: wz + sd*0.016,
                    sx:0.075, sy:0.045, sz:0.016, c: acier, ry: 0});
      // le talon aplati, à l'autre bout
      parts.push({x: wx - L*0.47, y: h+0.04, z: wz,
                  sx:0.075, sy:0.012, sz:0.038, c: acier, r:0.22});
      // la poignée, usée
      parts.push({tube:[[wx - L*0.30, h+0.04, wz], .028,
                        [wx - L*0.05, h+0.04, wz], .027, 6], c: rouille});
      solid = false; break; }

    case 'armeThunderbolt': {
      const corps = [.19,.20,.22], cuivre = [.34,.21,.11];
      const arc   = [0.45, 0.80, 2.20];     // émissif : l'arc électrique
      const L = 0.66;

      // le canon : deux rails parallèles, et c'est entre eux que ça claque
      for(const sd of [1,-1])
        parts.push({tube:[[wx - L*0.05, h+0.05, wz + sd*0.030], .014,
                          [wx + L*0.52, h+0.05, wz + sd*0.030], .012, 5],
                    c: cuivre});
      // l'arc entre les rails, à la bouche
      parts.push({tube:[[wx + L*0.50, h+0.05, wz - 0.028], .008,
                        [wx + L*0.50, h+0.05, wz + 0.028], .008, 4],
                  c: arc, emis: 1});
      // le bloc : la masse de l'arme
      parts.push({x: wx - L*0.10, y: h+0.05, z: wz,
                  sx: L*0.42, sy: 0.10, sz: 0.075, c: corps});
      // la crosse, inclinée
      parts.push({x: wx - L*0.40, y: h+0.015, z: wz,
                  sx: 0.20, sy: 0.055, sz: 0.058, c: corps, r: 0.16});
      // la poignée, sous le bloc
      parts.push({x: wx - L*0.14, y: h-0.035, z: wz,
                  sx: 0.055, sy: 0.12, sz: 0.05, c: corps, r: -0.20});
      // la cellule, qui luit faiblement quand elle est chargée
      parts.push({x: wx - L*0.02, y: h+0.115, z: wz,
                  sx: 0.11, sy: 0.035, sz: 0.05,
                  c: [arc[0]*0.5, arc[1]*0.5, arc[2]*0.5], emis: 1});

      if(lights.length < SETUP.decor.maxLumieres)
        lights.push({x:wx + L*0.4, y:h+0.12, z:wz,
                     c:[0.16,0.28,0.72], ph:rnd()*6.28});
      solid = false; break; }

    case 'carcasse': {
      // une voiture, sur le flanc ou sur le toit. Jamais à l'endroit.
      const L = rf(3.6, 4.6), W = rf(1.6, 1.9), H = rf(1.2, 1.5);
      const a = rnd()*6.283;
      const cs = Math.cos(a), sn = Math.sin(a);
      const roule = rnd() < 0.5 ? 1.5708 : rf(-0.5, 0.5);   // sur le flanc, ou penchée
      const tole = [.13,.115,.105], rouille = [.20,.11,.07];
      const c1 = rnd() < 0.4 ? rouille : tole;

      // caisse
      parts.push({x:wx, y:h + (roule > 1 ? W/2 : H/2), z:wz,
                  sx:L, sy:(roule > 1 ? W : H), sz:(roule > 1 ? H : W),
                  c:c1, r:roule*0.35});
      // pavillon, écrasé
      parts.push({x:wx - cs*L*0.10, y:h + (roule > 1 ? W*0.55 : H*0.92), z:wz - sn*L*0.10,
                  sx:L*0.52, sy:H*0.40, sz:W*0.86, c:[c1[0]*.8,c1[1]*.8,c1[2]*.8], r:roule*0.35});
      // roues : celles qui restent
      for(const [ox, oz] of [[L*0.34,W*0.5],[L*0.34,-W*0.5],[-L*0.34,W*0.5],[-L*0.34,-W*0.5]]){
        if(rnd() < 0.28) continue;                 // il en manque toujours une
        const px = wx + cs*ox - sn*oz, pz = wz + sn*ox + cs*oz;
        parts.push(colonne([px, h+0.32, pz], .30, [px+cs*0.16, h+0.32, pz+sn*0.16], .30,
                           [.055,.05,.05]));
      }
      // vitres brisées : quelques éclats au sol
      for(let q=0;q<Math.round(4*D);q++)
        parts.push(bloc(wx+rf(-L*0.6,L*0.6), h+0.03, wz+rf(-W,W),
                        .10,.02,.10, [.30,.36,.36], rnd()*3, 0.15));
      // le plafonnier tient encore, une fois sur trois
      if(rnd() < 0.34 && lights.length < SETUP.decor.maxLumieres){
        parts.push(bloc(wx, h+H*0.7, wz, .18,.06,.18, [2.0,1.9,1.5], 0, 1));
        lights.push({x:wx, y:h+H*0.8, z:wz, c:[0.9,0.85,0.62], ph:rnd()*6.28});
      }
      /* Une voiture est longue et étroite. Le disque d'1,40 m qu'elle posait
         avant débordait de deux mètres à l'avant comme à l'arrière : on se
         cognait dans le vide. Elle prend maintenant la forme de ses parts. */
      dur = true; solid = false; break; }

    case 'lampadaire': {
      const ht = rf(4.5, 7.0);
      parts.push(colonne([wx,h,wz], .13, [wx,h+ht,wz], .09, [.17,.17,.18]));
      // la crosse
      const a = rnd()*6.283, cs = Math.cos(a), sn = Math.sin(a);
      parts.push(colonne([wx,h+ht,wz], .09,
                         [wx+cs*0.9, h+ht+0.22, wz+sn*0.9], .07, [.17,.17,.18]));
      /* Deux sur trois marchent encore. C'est invraisemblable et c'est voulu :
         un monde entièrement éteint est un monde qu'on ne peut pas parcourir. */
      if(rnd() < 0.66){
        const chaud = rnd() < 0.5 ? [2.4,1.7,0.7] : [1.5,1.9,2.2];
        parts.push(bloc(wx+cs*1.0, h+ht+0.10, wz+sn*1.0, .34,.16,.34, chaud, 0, 1));
        if(lights.length < SETUP.decor.maxLumieres)
          lights.push({x:wx+cs*1.0, y:h+ht-0.1, z:wz+sn*1.0,
                       c:[chaud[0]*0.75, chaud[1]*0.75, chaud[2]*0.75],
                       ph:rnd()*6.28});
      }
      break; }

    case 'pylone': {
      const ht = rf(11, 22), br = rf(1.4, 2.4);
      const mont = [.14,.135,.13];
      // quatre montants qui convergent
      const pied = [[br,br],[br,-br],[-br,br],[-br,-br]];
      pied.forEach(([ox,oz]) => {
        parts.push(colonne([wx+ox, h, wz+oz], .10,
                           [wx+ox*0.22, h+ht, wz+oz*0.22], .07, mont));
      });
      // les croisillons
      const N = Math.max(3, Math.round(6*D));
      for(let k=0;k<N;k++){
        const t0 = k/N, t1 = (k+1)/N;
        const y0 = h+ht*t0, y1 = h+ht*t1;
        const r0 = br*(1-t0*0.78), r1 = br*(1-t1*0.78);
        for(let q=0;q<4;q++){
          const a0 = q*1.5708, a1 = (q+1)*1.5708;
          parts.push(colonne([wx+Math.cos(a0)*r0*1.41, y0, wz+Math.sin(a0)*r0*1.41], .04,
                             [wx+Math.cos(a1)*r1*1.41, y1, wz+Math.sin(a1)*r1*1.41], .04, mont));
        }
      }
      // la traverse du haut, et des câbles qui pendent
      parts.push(colonne([wx-br*1.6, h+ht*0.92, wz], .07, [wx+br*1.6, h+ht*0.92, wz], .07, mont));
      for(const sd of [1,-1])
        parts.push(colonne([wx+sd*br*1.5, h+ht*0.92, wz], .03,
                           [wx+sd*br*1.9, h+ht*rf(0.35,0.7), wz+rf(-1,1)], .02, [.09,.09,.09]));
      break; }

    /* ═══ CHAMPIGNONS LUMINESCENTS ═══
       Le souterrain n'avait que des cristaux pour s'éclairer, et à 4× moins
       dense qu'en v2 ça ne suffisait pas du tout. Ceux-ci poussent en touffes,
       au sol et sur les parois, et donnent une lumière verte froide très
       différente de l'orange des cristaux : on lit tout de suite où on est. */
    case 'champignon': {
      const n = ri(4, Math.round(9*D));
      const vert = [0.30, 1.15, 0.62];
      for(let k=0;k<n;k++){
        const bx = wx+rf(-1.3,1.3), bz = wz+rf(-1.3,1.3);
        const ht = rf(0.14, 0.52), br = rf(.05,.13);
        parts.push(colonne([bx,h,bz], br, [bx,h+ht,bz], br*0.75, [.30,.28,.24]));
        // le chapeau, émissif
        parts.push({tube:[[bx,h+ht,bz], br*2.6, [bx,h+ht+ht*0.34,bz], br*0.5, 7],
                    c:[vert[0]*1.5, vert[1]*1.5, vert[2]*1.5], emis:1});
      }
      if(lights.length < SETUP.decor.maxLumieres)
        lights.push({x:wx, y:h+0.5, z:wz, c:vert, ph:rnd()*6.28});
      solid = false; break; }

    case 'crane': {
      const co = [.76,.73,.64], a = rf(0,6.283);
      const cx2 = Math.cos(a), cz2 = Math.sin(a);
      // boîte crânienne + museau effilé + deux orbites creuses (sombres)
      parts.push(colonne([wx - cx2*0.18, h+.30, wz - cz2*0.18], .30,
                         [wx + cx2*0.28, h+.26, wz + cz2*0.28], .22, co));
      parts.push(colonne([wx + cx2*0.28, h+.26, wz + cz2*0.28], .22,
                         [wx + cx2*0.72, h+.16, wz + cz2*0.72], .09, co));
      for(const sd of [1,-1])
        parts.push(bloc(wx + cx2*0.26 - cz2*0.14*sd, h+.34, wz + cz2*0.26 + cx2*0.14*sd,
                        .12,.12,.12, [.05,.045,.04]));
      // mandibule décrochée : c'est ce détail qui rend un crâne inquiétant
      parts.push(colonne([wx - cx2*0.10, h+.10, wz - cz2*0.10], .09,
                         [wx + cx2*0.60, h+.06, wz + cz2*0.60], .05, co));
      solid = false; break; }
  }

  /* Un rayon réel par élément : la cellule n'est condamnée que si l'élément la
     remplit vraiment. La v2 bloquait 3 m de côté pour un tronc de 60 cm. */
  let ray = 0;
  for(const q of parts) ray = Math.max(ray, rayonPart(q));
  props.push({parts, cell:i, r:ray, solide:solid});
  if(solid || dur){
    /* ── PAS DE BOUCHON DANS UN BOYAU ──
       Un élément massif au milieu d'une galerie de deux cellules de large, ce
       n'est pas du décor : c'est un mur, et tout ce qu'il y a derrière devient
       inatteignable. Ça ne se voyait pas en v4, dont les couloirs étaient
       larges et les salles rectangulaires. Sur le réseau de galeries de la v5,
       mesuré sur trois mondes : le décor à lui seul faisait tomber la part du
       monde atteignable à pied de 99,6 % à 65 % — un monde sur trois avait sa
       surface entière condamnée par quelques piliers tombés au mauvais
       endroit.

       On ne le déplace pas, on ne le rétrécit pas : on ne le pose pas. */
    if(ray > SETUP.decor.rayonBouchon && openN[i] < SETUP.decor.ouvertureMassif){
      props.pop();
      return;
    }
    poserCapsules(parts, h);
    if(solid && ray >= CELL * 0.78) blocked[i] = 1;  // seuls les vrais massifs coupent la nav
  }
}

/* Réutilisée à chaque part : `capsulePart` écrit dedans plutôt que d'allouer
   un objet par part sur les quelques centaines de milliers du décor. */
const _cap = {};

/**
 * Pose une hitbox par PART, et non plus une par élément.
 *
 * Voir l'en-tête de `capsulePart` dans monde/formes.js pour le pourquoi. Ici
 * on ne garde que ce qui peut concerner un corps debout : ce qui est sous le
 * pas se franchit, ce qui est à quatre mètres et demi ne se touche pas. Le
 * tri fin — enjamber, passer dessous — est refait à chaque image par
 * joueur/joueur.js, qui seul connaît l'altitude réelle des pieds.
 */
function poserCapsules(parts, h){
  for(const q of parts){
    const c = capsulePart(q, _cap);
    if(!c) continue;
    if(c.y1 < h + 0.15 || c.y0 > h + 4.5) continue;
    colliders.push({x0:c.x0, z0:c.z0, x1:c.x1, z1:c.z1,
                    r:c.r, y0:c.y0, y1:c.y1});
  }
}

/* ─────────────── semis ─────────────── */

export function placerProps(){
  const S = SETUP.decor;

  // colonnades : une trame régulière dans les grandes salles. C'est ce qui
  // fait lire une architecture plutôt qu'un tas d'objets.
  const PAS = Math.max(3, Math.round(4.5 / CELL));
  for(const r of salles){
    if(rnd() > 0.42) continue;
    const set = BIOMES[r.b].props;
    for(let dz=-2*PAS; dz<=2*PAS; dz+=PAS) for(let dx=-2*PAS; dx<=2*PAS; dx+=PAS){
      const x = r.x+dx, z = r.z+dz, i = idx(x,z);
      if(!isFloor(x,z) || openN[i] < 0.72 || blocked[i]) continue;
      addProp(set[0], x, z, i);
    }
  }

  // semis d'éléments non bloquants + sources lumineuses
  for(let k=0; k<S.semis; k++){
    const x = ri(2,GW-3), z = ri(2,GH-3), i = idx(x,z);
    if(!isFloor(x,z) || blocked[i]) continue;
    // le plan peut vider une zone de son décor, ou l'en gaver
    if(!autorise('decor', x, z)) continue;
    if(rnd() > densiteEn(x, z)) continue;
    const set = BIOMES[biome[i]].props;
    const kind = set[ri(0, set.length-1)];
    // rien de bloquant dans les passages étroits : la carte doit rester ouverte
    if(openN[i] < 0.55 && (kind==='pilier' || kind==='glace' || kind==='tronc')) continue;
    addProp(kind, x, z, i);
  }

  // ossuaires : quelques amas denses valent mieux qu'un semis régulier
  for(let n=0; n<S.ossuaires; n++){
    const c = celluleLibre(ri);
    for(let k=0; k<ri(5,11); k++){
      const x = c.x+ri(-5,5), z = c.z+ri(-5,5), i = idx(x,z);
      if(!isFloor(x,z) || blocked[i]) continue;
      addProp(['os','cotes','crane'][ri(0,2)], x, z, i);
    }
  }

  for(let k=0; k<16000 && lights.length < S.maxLumieres; k++){
    const x = ri(2,GW-3), z = ri(2,GH-3), i = idx(x,z);
    if(!isFloor(x,z)) continue;
    if(!autorise('lumieres', x, z)) continue;
    if(rnd() > densiteEn(x, z)) continue;
    const b = BIOMES[biome[i]];
    lights.push({x:c2w(x), y:floorH[i]+0.5+rnd()*1.6, z:c2w(z), c:b.lum, ph:rnd()*6.28});
  }
}

/** Remise à zéro avant une nouvelle génération. */
export function viderDecor(){
  props.length = 0; lights.length = 0; colliders.length = 0;
}
