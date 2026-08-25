/* ═══ MONDE / SORTIE ═══
   L'objectif. Sans sortie il n'y a pas de jeu, seulement une promenade.

   Elle est tirée AU HASARD, seulement contrainte d'être loin du départ. Poser
   la sortie au point le plus bas la rendait trouvable en descendant bêtement ;
   descendre reste utile pour les cartes rares et pour la chaleur géothermique,
   plus pour la sortie. Les deux objectifs ne tirent plus dans le même sens, ce
   qui oblige à choisir.                                                      */

import {SETUP} from '../setup.js';
import {ri} from '../noyau/rng.js';
import {DERIVE} from '../setup.js';
import {floorH, openN, idx, c2w, celluleLibre, w2c, isFree} from './grille.js';

/* Porteur : voir la note de src/monde/import-png.js. */
export const objectif = {sortie:null};

export function placerSortie(joueur, props, lights){
  let best = null;
  const DMIN = DERIVE.largeurMonde * 0.26;
  for(let k=0;k<20000;k++){
    const c = celluleLibre(ri), i = idx(c.x,c.z);
    if(openN[i] < 0.45) continue;
    if(Math.hypot(c2w(c.x) - joueur.x, c2w(c.z) - joueur.z) < DMIN) continue;
    best = {x:c2w(c.x), z:c2w(c.z), y:floorH[i], cell:i};
    break;
  }
  if(!best){
    const c = celluleLibre(ri);
    best = {x:c2w(c.x), z:c2w(c.z), y:floorH[idx(c.x,c.z)], cell:idx(c.x,c.z)};
  }
  objectif.sortie = best;
  const sortie = best;

  /* ══════════════ ELLE DOIT S'ANNONCER ══════════════
     « Je ne trouve jamais la sortie. »

     Le monde a été ramené de 1632 m à 816 m, ce qui divise par quatre le
     terrain à couvrir. Ça ne suffit pas : la sortie reste UN point dans
     0,19 km², et on ne voit qu'à 7,7 m. Il faut qu'elle porte plus loin
     qu'elle ne se voit.

     Une colonne de dix lampes existait déjà, et elle ne portait pas : dix
     petites sources au même endroit ne font pas une balise, elles font une
     lueur locale que le brouillard mange à quinze mètres.

     TROIS PORTÉES, et il les faut toutes les trois :

       LE FANAL    une source très intense, très haut. Une lampe perce la
                   brume bien au-delà de la distance à laquelle on distingue
                   une surface — c'est le seul phénomène du moteur qui
                   traverse le fog, et c'est donc le seul outil disponible.
       LA COLONNE  un faisceau vertical qui monte jusqu'au plafond. On ne le
                   voit pas de face, on le voit AU-DESSUS des obstacles :
                   c'est ce qui la rend repérable depuis un couloir voisin.
       LES JALONS  une couronne de petites bornes à quarante mètres autour.
                   On tombe dessus avant de trouver la sortie, et elles disent
                   « c'est par là » sans donner la direction — on ne triche
                   pas, on récompense l'approche.

     Aucun marqueur sur la carte : le repérage se mérite, comme pour les
     villages. Mais chercher un point invisible dans le noir n'est pas du
     mérite, c'est une loterie.                                             */

  const S = SETUP.sortie;
  const parts = [];

  // ── le fanal ──
  lights.push({x:sortie.x, y:sortie.y + S.hauteurFanal, z:sortie.z,
               c:[S.teinte[0]*S.gainFanal, S.teinte[1]*S.gainFanal,
                  S.teinte[2]*S.gainFanal], ph:0});

  // ── la colonne : elle monte, et on la voit par-dessus le décor ──
  for(let k = 0; k < S.hauteurColonne; k += 2){
    const t = 1 - k / S.hauteurColonne;
    lights.push({x:sortie.x, y:sortie.y + 1 + k, z:sortie.z,
                 c:[S.teinte[0]*1.6*t, S.teinte[1]*1.6*t, S.teinte[2]*1.6*t],
                 ph:k*0.5});
    parts.push({x:sortie.x, y:sortie.y + 1 + k, z:sortie.z,
                sx:0.30, sy:1.9, sz:0.30,
                c:[S.teinte[0]*2.4*t, S.teinte[1]*2.4*t, S.teinte[2]*2.4*t],
                emis:1});
  }

  // ── le portique lui-même ──
  for(const sd of [1,-1])
    parts.push({x:sortie.x+sd*1.5, y:sortie.y+2.6, z:sortie.z,
                sx:.5, sy:5.2, sz:.5, c:[.5,.45,.34]});
  parts.push({x:sortie.x, y:sortie.y+5.0, z:sortie.z,
              sx:3.6, sy:.6, sz:.6, c:[.5,.45,.34]});
  parts.push({x:sortie.x, y:sortie.y+2.4, z:sortie.z,
              sx:2.6, sy:4.6, sz:.18,
              c:[S.teinte[0]*2.6, S.teinte[1]*2.6, S.teinte[2]*2.6], emis:1});
  props.push({parts, cell:sortie.cell});

  /* ── les jalons ──
     Une couronne de bornes autour de la sortie. Elles sont plantées sur du
     sol praticable seulement : une borne au fond d'un gouffre n'indique rien
     et ferait tomber celui qui la suit. */
  for(let k = 0; k < S.nbJalons; k++){
    const a = k / S.nbJalons * 6.283 + 0.3;
    const d = S.rayonJalons * (0.75 + Math.random()*0.5);
    const jx = sortie.x + Math.cos(a)*d, jz = sortie.z + Math.sin(a)*d;
    const cx = w2c(jx), cz = w2c(jz);
    if(!isFree(cx, cz)) continue;
    const ji = idx(cx, cz);
    const jy = floorH[ji];
    lights.push({x:jx, y:jy + 1.0, z:jz,
                 c:[S.teinte[0]*0.55, S.teinte[1]*0.55, S.teinte[2]*0.42],
                 ph:Math.random()*6.28});
    props.push({parts:[
      {tube:[[jx, jy, jz], 0.10, [jx, jy + 1.5, jz], 0.07, 5], c:[.32,.29,.22]},
      {x:jx, y:jy + 1.6, z:jz, sx:0.22, sy:0.22, sz:0.22,
       c:[S.teinte[0]*2.2, S.teinte[1]*2.2, S.teinte[2]*1.7], emis:1},
    ], cell:ji});
  }

  return sortie;
}

export function atteinte(joueur){
  const sortie = objectif.sortie;
  return sortie
      && Math.hypot(sortie.x - joueur.x, sortie.z - joueur.z) < 2.4
      && Math.abs(sortie.y - joueur.gy) < 3;
}
