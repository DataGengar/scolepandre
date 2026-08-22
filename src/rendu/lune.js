/* ═══ RENDU / LUNE BRISÉE ═══
   Dehors, une lune éclatée en fragments dérivants — le ciel de « La Machine à
   explorer le temps ». Elle n'éclaire presque pas : c'est l'ambiante du biome
   qui porte la clarté. Elle donne la direction, l'échelle et le motif, et
   elle dit tout de suite qu'il s'est passé quelque chose.

   ── COMMENT ELLE EST DESSINÉE ──────────────────────────────────────────────
   Comme un FOND DE CIEL, pas comme un objet du monde :

     · le maillage est construit une fois, centré sur zéro ;
     · à chaque image on le translate sur la position de la caméra plus une
       direction fixe — elle reste donc à distance constante quoi qu'on fasse,
       exactement comme un vrai astre ;
     · on la dessine EN PREMIER, test de profondeur coupé, avec l'uniforme
       uCiel à 1 : le shader saute alors la brume et l'éclairage et rend
       l'émissif pur. Sans ça, la brume l'effacerait à 260 m.

   Le corps principal est une sphère à laquelle il manque un quartier, et les
   fragments sont des éclats anguleux répartis le long de l'orbite de rupture,
   avec une traînée de poussière plus fine. Rien ne bouge : à cette distance
   le mouvement ne se verrait pas, et une lune qui tourne visiblement fait
   décor de fond d'écran.                                                    */

import {SETUP} from '../setup.js';
import {mesh} from '../noyau/gl.js';

/** Sphère UV, avec un quartier arraché entre `trouA` et `trouB` en longitude. */
function sphere(P, N, C, cx, cy, cz, r, seg, col, trouA, trouB, bruit){
  const pousser = (t, a) => {
    // t : latitude −π/2..π/2   a : longitude 0..2π
    const rr = r * (1 + (bruit ? (Math.sin(t*7.3 + a*5.1) * 0.5 + Math.sin(a*11.7)*0.5) * bruit : 0));
    return [cx + Math.cos(t)*Math.cos(a)*rr,
            cy + Math.sin(t)*rr,
            cz + Math.cos(t)*Math.sin(a)*rr];
  };
  const tri = (a, b, c, teinte) => {
    const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    let n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const L = Math.hypot(n[0],n[1],n[2]) || 1;
    n = [n[0]/L, n[1]/L, n[2]/L];
    for(const p of [a,b,c]){
      P.push(p[0],p[1],p[2]); N.push(n[0],n[1],n[2]); C.push(teinte[0],teinte[1],teinte[2]);
    }
  };

  for(let i=0;i<seg;i++){
    const t0 = (i/seg - 0.5)*Math.PI, t1 = ((i+1)/seg - 0.5)*Math.PI;
    for(let j=0;j<seg*2;j++){
      const a0 = j/(seg*2)*6.283185, a1 = (j+1)/(seg*2)*6.283185;
      // le quartier manquant
      if(trouB !== undefined && a0 > trouA && a1 < trouB) continue;

      /* Relief : des mers sombres, comme sur une vraie lune. Le motif est
         déterministe pour que la lune soit la même d'une partie à l'autre —
         c'est un décor de fond, pas un élément généré. */
      const mer = Math.sin(t0*3.1 + a0*2.3) * Math.cos(a0*1.7 - t0*2.9);
      const k = mer > 0.35 ? 0.52 : mer < -0.45 ? 1.14 : 0.86;
      const teinte = [col[0]*k, col[1]*k, col[2]*k];

      tri(pousser(t0,a0), pousser(t0,a1), pousser(t1,a1), teinte);
      tri(pousser(t0,a0), pousser(t1,a1), pousser(t1,a0), teinte);
    }
  }
}

/** Un éclat : polyèdre anguleux, volontairement irrégulier. */
function eclat(P, N, C, cx, cy, cz, r, col, graine){
  const h = n => { const s = Math.sin(n*127.1 + graine*311.7)*43758.5453; return s - Math.floor(s); };
  const S = [];
  for(let i=0;i<6;i++){
    const a = i/6*6.283185 + h(i)*0.7;
    const t = (h(i+20) - 0.5) * 1.9;
    const rr = r * (0.45 + h(i+40)*0.85);
    S.push([cx + Math.cos(t)*Math.cos(a)*rr, cy + Math.sin(t)*rr, cz + Math.cos(t)*Math.sin(a)*rr]);
  }
  const haut = [cx, cy + r*(0.7 + h(9)*0.7), cz];
  const bas  = [cx, cy - r*(0.7 + h(3)*0.7), cz];
  const tri = (a,b,c,k) => {
    const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    let n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const L = Math.hypot(n[0],n[1],n[2]) || 1;
    n = [n[0]/L, n[1]/L, n[2]/L];
    for(const p of [a,b,c]){
      P.push(p[0],p[1],p[2]); N.push(n[0],n[1],n[2]);
      C.push(col[0]*k, col[1]*k, col[2]*k);
    }
  };
  for(let i=0;i<6;i++){
    const j = (i+1)%6;
    tri(haut, S[i], S[j], 0.75 + h(i)*0.5);
    tri(bas,  S[j], S[i], 0.34 + h(i+7)*0.3);
  }
}

/**
 * Construit le maillage. Une seule fois : il ne dépend d'aucune graine.
 * @returns un maillage statique, ou null si la lune est désactivée
 */
export function creerLune(){
  const L = SETUP.lune;
  if(!L || L.rayon <= 0) return null;
  const P = [], N = [], C = [];
  const col = L.couleur;

  // le corps, amputé d'un quartier
  sphere(P, N, C, 0, 0, 0, L.rayon, 16, col, 2.15, 3.35, 0.05);

  /* Les fragments s'échappent le long de l'ancienne ligne de rupture, de plus
     en plus petits et de plus en plus espacés : on lit la trajectoire. */
  for(let i=0;i<L.fragments;i++){
    const t = (i+1)/L.fragments;
    const a = 2.75 + t*2.1;
    const dist = L.rayon * (1.25 + t*2.9);
    const derive = Math.sin(i*2.7)*L.rayon*0.55;
    eclat(P, N, C,
      Math.cos(a)*dist,
      derive + Math.sin(i*1.3)*L.rayon*0.35,
      Math.sin(a)*dist,
      L.rayon * (0.30 - t*0.20) + 0.4,
      col, i+1);
  }

  // poussière : de très petits éclats, plus loin encore
  for(let i=0;i<26;i++){
    const a = 2.6 + (i/26)*2.7 + Math.sin(i*3.1)*0.2;
    const dist = L.rayon * (1.6 + (i/26)*3.8);
    eclat(P, N, C,
      Math.cos(a)*dist,
      Math.sin(i*0.9)*L.rayon*0.8,
      Math.sin(a)*dist,
      L.rayon * 0.055,
      col, 100+i);
  }

  return mesh(P, N, C);
}

/** Direction unitaire vers la lune, depuis SETUP.lune. */
export function directionLune(){
  const L = SETUP.lune;
  const h = Math.max(-0.2, Math.min(1, L.hauteur));
  const inc = h * Math.PI * 0.5;
  return [Math.cos(inc)*Math.cos(L.azimut), Math.sin(inc), Math.cos(inc)*Math.sin(L.azimut)];
}
