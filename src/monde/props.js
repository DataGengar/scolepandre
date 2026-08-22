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
  let solid = true, parts = [];

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
  for(const q of parts){
    if(q.tube) ray = Math.max(ray, Math.max(q.tube[1], q.tube[3]));
    else ray = Math.max(ray, Math.max(q.sx, q.sz) * 0.5);
  }
  props.push({parts, cell:i, r:ray, solide:solid});
  if(solid){
    colliders.push({x:wx, z:wz, r:Math.min(ray, 1.4)});
    if(ray >= CELL * 0.78) blocked[i] = 1;   // seuls les vrais massifs coupent la nav
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
    const b = BIOMES[biome[i]];
    lights.push({x:c2w(x), y:floorH[i]+0.5+rnd()*1.6, z:c2w(z), c:b.lum, ph:rnd()*6.28});
  }
}

/** Remise à zéro avant une nouvelle génération. */
export function viderDecor(){
  props.length = 0; lights.length = 0; colliders.length = 0;
}
