/* ═══ RENDU / LUMIÈRES ═══
   Choisit les NLIGHT sources les plus proches et les prépare pour le shader.

   La v2 triait la totalité des lampes à chaque image — plus de 3 000 objets
   alloués et triés 60 fois par seconde. On ne regarde que les pavés voisins,
   et on insère dans un tableau de taille fixe sans jamais trier l'ensemble.

   ── LES YEUX (v3) ──────────────────────────────────────────────────────────
   Les lumières temporaires des créatures (creatures/geometrie.js) sont
   insérées EN PRIORITÉ, avant les lampes du décor : si la bête est dans le
   champ, ses yeux passent devant un cristal. C'est ce qui garantit qu'ils
   alimentent les godrays du post-process et se voient de très loin dans le
   fog.                                                                       */

import {NLIGHT} from '../noyau/shaders.js';
import {CH, CHW, CHH, w2c} from '../monde/grille.js';
import {lampesParPave} from '../monde/maillage.js';
import {lumieresTemporaires} from '../creatures/geometrie.js';

/* Lumières dynamiques hors créatures : feux de camp, fusées, loupiotes de
   pancartes. jeu.js les remplit à chaque image, avant le rendu. Elles passent
   AVANT le décor dans le choix des sources — un feu qu'on vient d'allumer doit
   éclairer, même s'il y a des cristaux plus près. */
export const lumieresDynamiques = [];

export const lpArr = new Float32Array(NLIGHT*3);
export const lcArr = new Float32Array(NLIGHT*3);

const meilleurs  = new Array(NLIGHT);
const dMeilleurs = new Float32Array(NLIGHT);

/**
 * @returns le nombre de lumières actives (à passer à uLN)
 */
export function choisirLumieres(px, pz, temps){
  for(let i=0;i<NLIGHT;i++){ meilleurs[i] = null; dMeilleurs[i] = Infinity; }

  const inserer = (L, d) => {
    if(d >= dMeilleurs[NLIGHT-1]) return;
    let j = NLIGHT-1;
    while(j>0 && dMeilleurs[j-1] > d){
      dMeilleurs[j] = dMeilleurs[j-1]; meilleurs[j] = meilleurs[j-1]; j--;
    }
    dMeilleurs[j] = d; meilleurs[j] = L;
  };

  /* Les yeux d'abord, avec une distance artificiellement réduite : ils gagnent
     toujours leur place. Deux yeux + deux jeunes au plus, le décor garde six
     emplacements sur dix. */
  let forcees = 0;
  for(const L of lumieresTemporaires){
    if(forcees++ >= 4) break;
    inserer(L, ((L.x-px)**2 + (L.z-pz)**2) * 0.06);
  }
  // feux, fusées, pancartes : prioritaires eux aussi, mais moins que les yeux
  for(const L of lumieresDynamiques)
    inserer(L, ((L.x-px)**2 + (L.z-pz)**2) * 0.30);

  const cx = (w2c(px)/CH)|0, cz = (w2c(pz)/CH)|0;
  for(let dz=-1;dz<=1;dz++) for(let dx=-1;dx<=1;dx++){
    const a = cx+dx, b = cz+dz;
    if(a<0 || b<0 || a>=CHW || b>=CHH) continue;
    const lot = lampesParPave.get(b*CHW + a);
    if(!lot) continue;
    for(const L of lot) inserer(L, (L.x-px)**2 + (L.z-pz)**2);
  }

  let n = 0;
  for(let i=0;i<NLIGHT;i++) if(meilleurs[i]) n = i+1;
  for(let i=0;i<n;i++){
    const L = meilleurs[i];
    // les yeux n'ont pas de phase : ils ne scintillent pas comme une torche
    const fl = L.ph === undefined ? 1 : 0.72 + 0.28*Math.sin(temps*(2.3+L.ph) + L.ph*7);
    lpArr[i*3] = L.x; lpArr[i*3+1] = L.y; lpArr[i*3+2] = L.z;
    lcArr[i*3] = L.c[0]*fl; lcArr[i*3+1] = L.c[1]*fl; lcArr[i*3+2] = L.c[2]*fl;
  }
  return n;
}

/**
 * Projette les trois lumières les plus fortes en coordonnées d'écran, pour les
 * godrays. On privilégie les plus INTENSES et non les plus proches : les yeux
 * en poursuite sont à 3.0 de luminance, ils passent devant tout.
 * @returns {n, positions:Float32Array(6), couleurs:Float32Array(9)}
 */
const sp = new Float32Array(6), sc = new Float32Array(9);

export function projeterGodrays(nLum, view, projM){
  // on classe par luminance décroissante, en gardant l'index d'origine
  const ordre = [];
  for(let i=0;i<nLum;i++)
    ordre.push({i, l: lcArr[i*3] + lcArr[i*3+1]*0.8 + lcArr[i*3+2]*0.6});
  ordre.sort((a,b) => b.l - a.l);

  let n = 0;
  for(const {i} of ordre){
    if(n >= 3) break;
    const lx = lpArr[i*3], ly = lpArr[i*3+1], lz = lpArr[i*3+2];
    const vx = view[0]*lx + view[4]*ly + view[8]*lz  + view[12];
    const vy = view[1]*lx + view[5]*ly + view[9]*lz  + view[13];
    const vz = view[2]*lx + view[6]*ly + view[10]*lz + view[14];
    const w = -vz;
    if(w < 0.25) continue;
    const px2 = (projM[0]*vx)/w, py2 = (projM[5]*vy)/w;
    if(Math.abs(px2) > 1.7 || Math.abs(py2) > 1.7) continue;
    sp[n*2] = px2*0.5 + 0.5; sp[n*2+1] = py2*0.5 + 0.5;
    sc[n*3] = lcArr[i*3]; sc[n*3+1] = lcArr[i*3+1]; sc[n*3+2] = lcArr[i*3+2];
    n++;
  }
  return {n, positions:sp, couleurs:sc};
}
