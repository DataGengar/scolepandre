/* ═══ JOUEUR / FEU ═══
   Le bois, les feux de camp, les fusées de détresse et la lampe brandie.
   Autrement dit : se réchauffer, y voir, et se défendre.

   ── TROIS DEMANDES, UNE SEULE IDÉE ─────────────────────────────────────────
     « Trouver du bois pour se réchauffer »
     « Donner au joueur le moyen d'avoir une arme ou un objet pour se défendre »
     « On ne voit absolument rien »

   Les trois se règlent avec la même chose : LE FEU. Il chauffe, il éclaire, et
   les jeunes ne l'approchent pas. C'est aussi cohérent avec le reste du jeu —
   on ne tue pas un scolopandre, on le tient à distance.

   ── LES TROIS OBJETS ───────────────────────────────────────────────────────
     BOIS      ramassé au sol, surtout près des villages. Six au maximum.
               Un fagot = un feu de camp, allumé sur place (touche G), qui
               brûle 150 s, réchauffe dans 6 m et repousse les jeunes dans 9 m.

     FUSÉE     lancée (touche V). Brûle 26 s en éclairant dans 14 m — bien
               plus large que la lampe. C'est l'outil pour LIRE une salle, et
               accessoirement pour dégager un passage : rien n'approche.

     LAMPE     brandie (clic droit maintenu). Les jeunes reculent, mais la
               consommation est multipliée par sept. Défense de dernier
               recours, jamais une stratégie.

   AUCUN N'A D'EFFET SUR LA MÈRE. Elle est aveugle : le feu ne lui dit rien.
   C'est délibéré — lui donner une faiblesse la transformerait en ennemi.     */

import {SETUP} from '../setup.js';
import {rnd} from '../noyau/rng.js';
import {groundAt, isFree, w2c} from '../monde/grille.js';
import {bois, fusees} from '../monde/villages.js';

/** Les feux allumés par le joueur. [{x,y,z,restant}] */
export const feux = [];
/** Les fusées en cours de combustion, au sol ou en vol. */
export const fuseesActives = [];

export const inventaire = {bois:0, fusees:0, brandit:false};

export function reinitialiserFeu(){
  feux.length = 0; fuseesActives.length = 0;
  inventaire.bois = 0; inventaire.fusees = 1; inventaire.brandit = false;
}

/* ─────────────── ramassage ─────────────── */

/** @returns {bois:n, fusees:n} ce qui vient d'être ramassé */
export function ramasser(joueur){
  const F = SETUP.feu;
  let pb = 0, pf = 0;
  for(const b of bois){
    if(b.pris || inventaire.bois >= F.maxBoisPorte) continue;
    if(Math.hypot(b.x-joueur.x, b.z-joueur.z) < 1.7 && Math.abs(b.y-joueur.gy) < 2.4){
      b.pris = true; inventaire.bois++; pb++;
    }
  }
  for(const f of fusees){
    if(f.prise || inventaire.fusees >= F.maxFuseesPortees) continue;
    if(Math.hypot(f.x-joueur.x, f.z-joueur.z) < 1.7 && Math.abs(f.y-joueur.gy) < 2.4){
      f.prise = true; inventaire.fusees++; pf++;
    }
  }
  return {bois:pb, fusees:pf};
}

/* ─────────────── feu de camp ─────────────── */

/** Allume un feu là où on est. Renvoie le feu, ou null s'il n'y a pas de bois. */
export function allumerFeu(joueur){
  if(inventaire.bois <= 0) return null;
  // pas deux feux au même endroit : on rallonge celui qui est là
  for(const f of feux){
    if(Math.hypot(f.x-joueur.x, f.z-joueur.z) < 2.2){
      inventaire.bois--;
      f.restant = Math.min(SETUP.feu.dureeFeu*2, f.restant + SETUP.feu.dureeFeu);
      return f;
    }
  }
  inventaire.bois--;
  const f = {x:joueur.x, y:joueur.gy, z:joueur.z,
             restant:SETUP.feu.dureeFeu, total:SETUP.feu.dureeFeu, ph:rnd()*6.28};
  feux.push(f);
  return f;
}

/* ─────────────── fusée ─────────────── */

/** Lance une fusée dans la direction du regard. */
export function lancerFusee(joueur){
  if(inventaire.fusees <= 0) return null;
  inventaire.fusees--;
  const cp = Math.cos(joueur.pitch), sp = Math.sin(joueur.pitch);
  const v = 15;
  const f = {
    x:joueur.x, y:joueur.gy + joueur.eye, z:joueur.z,
    vx:-Math.sin(joueur.yaw)*cp*v, vy:sp*v + 4, vz:-Math.cos(joueur.yaw)*cp*v,
    restant:SETUP.feu.dureeFusee, total:SETUP.feu.dureeFusee,
    posee:false, ph:rnd()*6.28,
  };
  fuseesActives.push(f);
  return f;
}

/* ─────────────── boucle ─────────────── */

/**
 * @param hooks {surExtinction(feu)}
 * @returns le nombre de sources de feu actives
 */
export function updateFeu(dt, joueur, hooks){
  const H = hooks || {};

  for(let i=feux.length-1;i>=0;i--){
    feux[i].restant -= dt;
    if(feux[i].restant <= 0){ if(H.surExtinction) H.surExtinction(feux[i]); feux.splice(i,1); }
  }

  for(let i=fuseesActives.length-1;i>=0;i--){
    const f = fuseesActives[i];
    if(!f.posee){
      f.vy -= 22*dt;
      const nx = f.x + f.vx*dt, nz = f.z + f.vz*dt;
      if(isFree(w2c(nx), w2c(nz))){ f.x = nx; f.z = nz; }
      else { f.vx *= -0.2; f.vz *= -0.2; }
      f.y += f.vy*dt;
      const sol = groundAt(f.x, f.z);
      if(f.y <= sol + 0.15){ f.y = sol + 0.15; f.posee = true; }
    }
    f.restant -= dt;
    if(f.restant <= 0) fuseesActives.splice(i,1);
  }

  // la lampe brandie consomme vite : c'est ce qui l'empêche d'être gratuite
  return feux.length + fuseesActives.length;
}

/* ─────────────── ce que les créatures voient ─────────────── */

/**
 * La source de feu la plus proche d'un point, dans son rayon de répulsion.
 * C'est CETTE fonction que creatures/jeunes.js interroge — il n'a pas à
 * connaître ni la torche, ni les feux, ni les fusées.
 */
export function feuProche(x, z, joueur, torcheAllumee){
  const F = SETUP.feu;
  let best = null, bd = 1e9;

  const tester = (fx, fz, portee) => {
    const d = Math.hypot(fx-x, fz-z);
    if(d < portee && d < bd){ bd = d; best = {x:fx, z:fz, d}; }
  };

  for(const f of feux) tester(f.x, f.z, F.portéeRepulsion);
  for(const f of fuseesActives) tester(f.x, f.z, F.portéeRepulsion * 1.3);
  // la lampe brandie : seulement si elle est allumée ET brandie
  if(inventaire.brandit && torcheAllumee)
    tester(joueur.x, joueur.z, F.portéeRepulsion * 0.8);

  return best;
}

/** Les lumières que le feu ajoute au rendu, cette image. */
export function lumieresDuFeu(sortie, temps){
  const F = SETUP.feu;
  for(const f of feux){
    const t = Math.min(1, f.restant / 12);         // il faiblit en mourant
    const vac = 0.78 + 0.22*Math.sin(temps*8.3 + f.ph) + 0.1*Math.sin(temps*21 + f.ph*3);
    sortie.push({x:f.x, y:f.y+0.6, z:f.z,
                 c:[2.9*t*vac, 1.35*t*vac, 0.42*t*vac]});
  }
  for(const f of fuseesActives){
    const t = Math.min(1, f.restant / 6);
    const vac = 0.85 + 0.15*Math.sin(temps*17 + f.ph);
    // la fusée est BLANCHE et violente : elle écrase tout le reste
    sortie.push({x:f.x, y:f.y+0.3, z:f.z,
                 c:[4.6*t*vac, 3.4*t*vac, 2.2*t*vac]});
  }
}

/** Chaleur gagnée par seconde à la position du joueur, grâce au feu. */
export function chaleurDuFeu(x, z){
  const F = SETUP.feu;
  let g = 0;
  for(const f of feux)
    if(Math.hypot(f.x-x, f.z-z) < F.rayonFeu) g = Math.max(g, SETUP.froid.gainFeu);
  for(const f of fuseesActives)
    if(f.posee && Math.hypot(f.x-x, f.z-z) < 3) g = Math.max(g, SETUP.froid.gainFeu*0.4);
  return g;
}
