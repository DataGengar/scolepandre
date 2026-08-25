/* ═══ MONDE / NIVEAUX ═══
   Plusieurs sols par colonne. C'est le changement de moteur.

   ── CE QUI BLOQUAIT ────────────────────────────────────────────────────────
   Le monde est un CHAMP DE HAUTEURS : une seule altitude de sol et une seule
   de plafond par cellule. C'est une structure merveilleuse pour une caverne —
   compacte, rapide, facile à creuser — et elle interdit trois choses :

     · un surplomb : rien ne peut passer AU-DESSUS d'autre chose ;
     · une voûte : un plafond en arc a besoin de matière au-dessus du vide ;
     · un étage : on ne peut pas marcher sur le toit de ce qu'on traverse.

   Une cathédrale, c'est exactement ces trois choses. Tant qu'on reste sur un
   champ de hauteurs, on peut poser des colonnes et un décor de nef, mais on ne
   peut pas monter dans une tour ni descendre dans une crypte.

   Un demi-pas avait déjà été fait : `pont[]` et `pontH[]` donnent UN étage
   au-dessus du terrain, ce qui a suffi aux passerelles. Ce fichier généralise
   ce demi-pas.

   ── CE QU'ON NE FAIT PAS, ET POURQUOI ──────────────────────────────────────
   On ne passe PAS à un champ de densité avec extraction de surface (marching
   cubes). Ce serait la réponse complète, et elle demanderait de réécrire la
   génération, la collision, la navigation et le maillage — tout ce qui suppose
   « une hauteur par colonne », c'est-à-dire à peu près tout.

   Or ce dont on a besoin n'est pas de la roche organique : ce sont des
   BÂTIMENTS. Un bâtiment a des planchers plats et empilés. Une liste de
   planchers par cellule suffit, coûte presque rien, et n'oblige à toucher
   qu'un seul endroit du code du joueur.

   ── LA STRUCTURE ───────────────────────────────────────────────────────────
   Creuse, volontairement. Les bâtiments couvrent quelques milliers de cellules
   sur 1,18 M : un tableau par niveau gaspillerait vingt mégaoctets pour du
   vide. Une Map d'indice de cellule vers une liste de planchers, triée par
   altitude, coûte ce qu'elle occupe.

   Un PLANCHER, c'est :
     y        la cote sur laquelle on marche
     tete     le dégagement au-dessus : sous cette hauteur, on ne rentre pas
     mur      vrai si la cellule est pleine à ce niveau (un pilier, un mur)
     edifice  à quel bâtiment il appartient, pour le retrouver

   Le terrain lui-même n'est PAS dans cette liste. Il reste le sol par défaut,
   et `niveaux.js` ne décrit que ce qui s'ajoute par-dessus ou par-dessous.  */

import {GW, GH, CELL, floorH, ceilH, idx} from './grille.js';

/** cellule → [{y, tete, mur, edifice}] trié par y croissant. */
const parCellule = new Map();

/** Combien de planchers en tout, pour le rapport de génération. */
export const statsNiveaux = {planchers: 0, cellules: 0, edifices: 0};

export function viderNiveaux(){
  parCellule.clear();
  statsNiveaux.planchers = 0;
  statsNiveaux.cellules = 0;
  statsNiveaux.edifices = 0;
}

/**
 * Ajoute un plancher sur une cellule.
 *
 * @param tete  dégagement au-dessus, en mètres. En dessous de la taille du
 *              joueur, la cellule existe mais on ne peut pas s'y tenir — c'est
 *              ce qui distingue un plancher d'une simple dalle décorative.
 */
export function poserPlancher(cx, cz, y, tete = 2.4, edifice = 0, mur = false){
  if(cx < 0 || cz < 0 || cx >= GW || cz >= GH) return;
  const i = idx(cx, cz);
  let l = parCellule.get(i);
  if(!l){ l = []; parCellule.set(i, l); statsNiveaux.cellules++; }

  /* Deux planchers à dix centimètres l'un de l'autre ne veulent rien dire, et
     feraient osciller le joueur entre les deux. On fusionne. */
  for(const p of l){
    if(Math.abs(p.y - y) < 0.35){
      p.tete = Math.max(p.tete, tete);
      p.mur = p.mur && mur;
      return;
    }
  }
  l.push({y, tete, mur, edifice});
  l.sort((a, b) => a.y - b.y);
  statsNiveaux.planchers++;
}

/** Les planchers d'une cellule, ou null. Ne pas modifier le tableau rendu. */
export function planchersDe(cx, cz){
  if(cx < 0 || cz < 0 || cx >= GW || cz >= GH) return null;
  return parCellule.get(idx(cx, cz)) || null;
}

export const aDesNiveaux = () => parCellule.size > 0;

/* ═══════════════ CE QUE LE JOUEUR DEMANDE ═══════════════ */

/**
 * Sur quoi se tient-on, à cette position et à cette altitude ?
 *
 * C'est LA question que pose le code du joueur, et elle a une seule bonne
 * réponse : la surface praticable la plus haute qui soit AU NIVEAU DES PIEDS
 * ou juste en dessous. Pas la plus proche — la plus haute en dessous.
 *
 * Prendre la plus proche ferait remonter le joueur d'un étage dès qu'il passe
 * sous un plancher en sautant, ce qui est exactement le genre de téléportation
 * qui rend un jeu inexplicable.
 *
 * @param gy        altitude actuelle des pieds
 * @param tolerance combien on accepte de monter d'un pas
 * @returns {y, source} — source vaut 'terrain' ou 'niveau'
 */
export function solSous(cx, cz, gy, tolerance){
  const sol = solTerrain(cx, cz);
  let meilleur = (sol > -9000 && sol <= gy + tolerance) ? sol : -99999;
  let source = 'terrain';

  const l = planchersDe(cx, cz);
  if(l){
    for(const p of l){
      if(p.mur) continue;                    // un mur ne se marche pas dessus
      if(p.y > gy + tolerance) continue;     // trop haut pour ce pas
      if(p.y > meilleur){ meilleur = p.y; source = 'niveau'; }
    }
  }
  return {y: meilleur, source};
}

const solTerrain = (cx, cz) => {
  if(cx < 0 || cz < 0 || cx >= GW || cz >= GH) return -99999;
  return floorH[idx(cx, cz)];
};

/**
 * La cellule est-elle bouchée à cette altitude ?
 *
 * Un mur de bâtiment n'occupe qu'une TRANCHE : on passe sous une arche et on
 * bute contre le piédroit qui la porte. C'est toute la différence entre une
 * cathédrale et un bloc, et c'est ce que `blocked[]` ne savait pas exprimer —
 * il condamne une colonne entière, du sol au ciel.
 */
export function murA(cx, cz, gy){
  const l = planchersDe(cx, cz);
  if(!l) return false;
  for(const p of l){
    if(!p.mur) continue;
    // le mur occupe de sa base à sa base + sa hauteur
    if(gy >= p.y - 0.15 && gy < p.y + p.tete) return true;
  }
  return false;
}

/**
 * Le plafond au-dessus des pieds : le premier plancher qu'on rencontre en
 * montant, ou le plafond du terrain.
 *
 * Sert au saut, et à savoir si l'on tient debout.
 */
export function plafondSur(cx, cz, gy){
  if(cx < 0 || cz < 0 || cx >= GW || cz >= GH) return 99999;
  let plus = ceilH[idx(cx, cz)];
  const l = planchersDe(cx, cz);
  if(l){
    for(const p of l){
      if(p.y <= gy + 0.20) continue;
      if(p.y < plus) plus = p.y;
    }
  }
  return plus;
}

/* ═══════════════ POSER UN VOLUME ═══════════════ */

/**
 * Marque un rectangle de cellules comme plancher.
 *
 * Les bâtiments se décrivent en rectangles — une nef, un bas-côté, une tour —
 * et non cellule par cellule. C'est la primitive dont `edifices.js` se sert
 * pour tout.
 */
export function poserDalle(cx0, cz0, larg, prof, y, tete, edifice){
  for(let dz = 0; dz < prof; dz++)
    for(let dx = 0; dx < larg; dx++)
      poserPlancher(cx0 + dx, cz0 + dz, y, tete, edifice, false);
}

/** Un mur plein sur un segment, d'une base à une hauteur. */
export function poserMur(cx0, cz0, cx1, cz1, y, hauteur, edifice){
  const n = Math.max(Math.abs(cx1 - cx0), Math.abs(cz1 - cz0)) + 1;
  for(let k = 0; k < n; k++){
    const t = n > 1 ? k / (n - 1) : 0;
    poserPlancher(Math.round(cx0 + (cx1 - cx0) * t),
                  Math.round(cz0 + (cz1 - cz0) * t),
                  y, hauteur, edifice, true);
  }
}

/** Rend une trouée dans un mur déjà posé : une porte, une arcade. */
export function percerNiveau(cx, cz, y, hauteur){
  const l = planchersDe(cx, cz);
  if(!l) return;
  for(let k = l.length - 1; k >= 0; k--){
    const p = l[k];
    if(!p.mur) continue;
    if(p.y < y + hauteur && p.y + p.tete > y) l.splice(k, 1);
  }
}
