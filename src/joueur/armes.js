/* ═══ JOUEUR / ARMES ═══
   De quoi se défendre. Enfin.

   ── LA RÈGLE, ET ELLE NE SE NÉGOCIE PAS ────────────────────────────────────
   ON NE TUE PAS LA MÈRE.

   Tout le jeu tient sur le fait qu'elle est inarrêtable : elle est aveugle,
   elle t'entend, et la seule réponse est de disparaître. Lui donner des points
   de vie transformerait un jeu d'horreur en jeu de tir, et le premier joueur
   qui la tuerait n'aurait plus jamais peur.

   Une arme ACHÈTE DU TEMPS. C'est tout, et c'est déjà beaucoup :

     · sur la MÈRE — un coup au but la fait reculer et la met en retrait. On
       gagne quelques secondes pour fuir, on ne gagne pas le combat. Chaque
       coup suivant porte moins : elle apprend.
     · sur les JEUNES — là, oui, on tue. Ils sont nombreux, rapides, et sans
       arme on ne pouvait que les subir.
     · le BRUIT — tirer s'entend de très loin. Le thunderbolt règle un
       problème et en crée un plus gros, ce qui est exactement ce qu'une arme
       doit faire dans ce jeu.

   ── LES ARMES SONT DES DONNÉES ─────────────────────────────────────────────
   Une arme est une entrée de table : un nom, des dégâts, une cadence, une
   portée, un type de munition, et le nom de l'élément qui lui sert de modèle.
   La forge sait déjà composer et écrire de la géométrie ; il suffit qu'elle
   sache écrire ici aussi. Rien dans ce fichier ne code en dur une forme.    */

import {SETUP} from '../setup.js';
import {rnd} from '../noyau/rng.js';

/* ═══════════════ LE CATALOGUE ═══════════════

   `modele`    le nom de l'élément (monde/props.js) qui donne sa géométrie
   `genre`     'melee' ou 'tir'
   `degats`    sur un jeune. La mère, elle, ne perd pas de vie : voir plus bas
   `cadence`   secondes entre deux coups
   `portee`    mètres
   `arc`       demi-angle utile, en radians (mêlée : on balaie ; tir : on vise)
   `bruit`     rayon de la vibration émise. C'est le vrai coût d'une arme
   `recul`     poussée appliquée à ce qui est touché
   `munition`  null pour la mêlée, sinon la clé dans `reserves`             */

export const ARMES = {

  /* Les mains vides ne sont pas une arme : c'est l'emplacement où l'on
     retrouve le geste du jeu d'origine — lancer un leurre. Le clic gauche
     garde donc exactement son comportement d'avant tant qu'on n'a rien
     ramassé, et personne n'a de nouvelle touche à apprendre. */
  mains: {
    nom: 'MAINS', modele: null, genre: 'leurre',
    degats: 0, cadence: 0.35, portee: 0, arc: 0,
    bruit: 0, recul: 0, munition: null, repousse: 0,
  },

  piedDeBiche: {
    nom: 'PIED-DE-BICHE', modele: 'armePiedDeBiche', genre: 'melee',
    degats: 58, cadence: 0.78, portee: 2.3, arc: 0.85,
    bruit: 11, recul: 4.5, munition: null,
    /* Un coup de barre sur une carapace, ça la fait reculer. Ça ne la blesse
       pas — mais elle ne s'y attendait pas, et c'est la seconde qui compte. */
    repousse: 1.0,
    aide: 'Lourd, lent, silencieux. Ce qu\'on prend quand on ne veut pas '
        + 'ameuter le reste.',
  },

  thunderbolt: {
    nom: 'THUNDERBOLT', modele: 'armeThunderbolt', genre: 'tir',
    degats: 140, cadence: 1.35, portee: 34, arc: 0.05,
    /* 46 m de vibration. C'est ÉNORME — un pas fait 4, un leurre 30. Tirer,
       c'est dire au monde entier où l'on se trouve, et c'est délibéré : sans
       ce prix, une arme à distance viderait le jeu de sa tension. */
    bruit: 46, recul: 9, munition: 'cellule',
    repousse: 2.4,
    aide: 'Une décharge. Elle traverse, elle assomme, et elle s\'entend à '
        + 'quarante mètres.',
  },
};

/** L'ordre dans lequel les touches 1..N les sélectionnent. */
export const ORDRE_ARMES = ['mains', 'piedDeBiche', 'thunderbolt'];

/* ═══════════════ ÉTAT ═══════════════ */

export const armes = {
  /** Ce qu'on possède. Les poings, toujours. */
  possedees: ['mains'],
  courante: 'mains',

  reserves: {cellule: 0},

  /** Animation : 0 au repos, monte à 1 pendant le coup. */
  balan: 0,
  cd: 0,                 // temps avant de pouvoir frapper à nouveau
  dernierCoup: 0,        // pour l'affichage
};

export function reinitialiserArmes(){
  armes.possedees = ['mains'];
  armes.courante = 'mains';
  armes.reserves.cellule = SETUP.armes.cellulesDepart;
  armes.balan = 0; armes.cd = 0; armes.dernierCoup = 0;
}

export const armeCourante = () => ARMES[armes.courante] || ARMES.mains;

export function ramasserArme(cle){
  if(!ARMES[cle] || armes.possedees.includes(cle)) return false;
  armes.possedees.push(cle);
  armes.courante = cle;
  return true;
}

export function choisirArme(n){
  const cle = ORDRE_ARMES[n];
  if(!cle || !armes.possedees.includes(cle)) return false;
  armes.courante = cle;
  return true;
}

/** Passe à l'arme suivante possédée. */
export function armeSuivante(){
  const dispo = ORDRE_ARMES.filter(k => armes.possedees.includes(k));
  const i = dispo.indexOf(armes.courante);
  armes.courante = dispo[(i + 1) % dispo.length];
  return armes.courante;
}

export function majArmes(dt){
  armes.cd = Math.max(0, armes.cd - dt);
  // le balancement retombe vite : c'est un coup, pas un geste
  armes.balan = Math.max(0, armes.balan - dt * 4.2);
}

/* ═══════════════ FRAPPER ═══════════════ */

/**
 * Utilise l'arme courante.
 *
 * Ce module ne connaît ni la mère ni les jeunes : il calcule QUI est dans
 * l'arc et à quelle distance, et rend la main. C'est jeu.js qui applique.
 * Sans cette séparation, armes.js importerait les créatures, les créatures
 * importeraient le joueur, et on ne pourrait plus tester une arme seule.
 *
 * @param joueur  pour la position et le regard
 * @param cibles  [{x, z, rayon, ref}] — ce qui peut être touché
 * @returns {tire, arme, touches:[{ref, degats, poussee}], bruit} ou null
 */
export function frapper(joueur, cibles){
  const A = armeCourante();
  if(armes.cd > 0 || A.genre === 'leurre') return null;

  if(A.munition){
    if((armes.reserves[A.munition] | 0) <= 0)
      return {tire:false, vide:true, arme:A};
    armes.reserves[A.munition]--;
  }

  armes.cd = A.cadence;
  armes.balan = 1;
  armes.dernierCoup = 0;

  const fx = -Math.sin(joueur.yaw), fz = -Math.cos(joueur.yaw);
  const touches = [];

  for(const c of cibles){
    const dx = c.x - joueur.x, dz = c.z - joueur.z;
    const d = Math.hypot(dx, dz);
    if(d > A.portee + (c.rayon || 0)) continue;
    if(d < 1e-3) continue;

    /* L'angle au but. Une mêlée BALAIE : tout ce qui est devant est touché.
       Un tir VISE : il faut être aligné. D'où deux arcs très différents, et
       une tolérance qui s'élargit quand la cible est proche — sinon toucher
       un jeune collé à soi devient impossible, ce qui est absurde. */
    const cos = (dx*fx + dz*fz) / d;
    const tolerance = A.arc + Math.atan2(c.rayon || 0.4, Math.max(0.5, d));
    if(cos < Math.cos(tolerance)) continue;

    // la distance émousse la mêlée, pas le tir
    const affaibli = A.genre === 'melee'
      ? 1 - 0.35 * Math.min(1, d / A.portee)
      : 1;

    touches.push({
      ref: c.ref,
      degats: A.degats * affaibli,
      poussee: A.recul * affaibli,
      distance: d,
      dx: dx/d, dz: dz/d,
    });

    // un tir s'arrête à la première cible ; une barre traverse le groupe
    if(A.genre === 'tir') break;
  }

  return {tire:true, arme:A, touches, bruit:A.bruit};
}

/* ═══════════════ CE QU'UNE ARME FAIT À LA MÈRE ═══════════════ */

/**
 * Combien de temps elle recule, en secondes. Zéro veut dire « rien ».
 *
 * ELLE N'A PAS DE POINTS DE VIE, et n'en aura pas. Ce que renvoie cette
 * fonction, c'est un DÉLAI : le temps qu'elle passe en retrait avant de
 * reprendre. On l'achète, on ne la gagne pas.
 *
 * Et le prix monte. Chaque coup encaissé la rend moins impressionnable —
 * `accoutumance` ne redescend qu'avec le temps. Sans cela, il suffirait de
 * marteler la même touche pour la tenir à distance indéfiniment, et le jeu
 * serait résolu.
 */
export const memoire = {accoutumance: 0};

export function reculMere(arme){
  if(!arme.repousse) return 0;
  const S = SETUP.armes;
  const facteur = Math.pow(S.accoutumanceBase, memoire.accoutumance);
  memoire.accoutumance++;
  return arme.repousse * S.reculSecondes * facteur;
}

export function oublierCoups(dt){
  // elle oublie lentement : une minute de calme rend une arme à moitié utile
  memoire.accoutumance = Math.max(0,
    memoire.accoutumance - dt / SETUP.armes.oubliSecondes);
}

/* ═══════════════ LES ARMES QUI TRAÎNENT ═══════════════
   Semées comme le bois et les trousses : un objet au sol qu'on ramasse en
   marchant dessus. On ne montre pas leur position sur la carte — trouver une
   arme doit être un événement, pas une course à l'objectif. */

/** [{x, y, z, cle, pris}] */
export const armesAuSol = [];

/** [{x, y, z, n, pris}] — des cellules pour le thunderbolt. */
export const cellulesAuSol = [];

/**
 * @param placer  (liste, combien, fabriquer) fourni par monde/index.js, qui
 *                seul sait trouver une cellule libre. armes.js ne doit pas
 *                importer la grille : il est aussi utilisé par la forge et
 *                par les tests, où il n'y a pas de monde.
 */
export function placerArmes(placer){
  armesAuSol.length = 0;
  cellulesAuSol.length = 0;
  const S = SETUP.armes;

  /* Deux tiers de pieds-de-biche, un tiers de thunderbolts. L'arme à
     distance doit rester rare : c'est elle qui déséquilibrerait le jeu si on
     en trouvait partout. */
  placer(armesAuSol, S.nbArmesDansLeMonde, (x, y, z) => ({
    x, y, z, pris: false,
    cle: rnd() < 0.68 ? 'piedDeBiche' : 'thunderbolt',
  }));

  placer(cellulesAuSol, S.nbTasDeCellules, (x, y, z) => ({
    x, y, z, pris: false, n: SETUP.armes.cellulesParTas,
  }));
}

export function reprendreArmesAuSol(){
  for(const a of armesAuSol) a.pris = false;
  for(const c of cellulesAuSol) c.pris = false;
}

/**
 * Ramassage automatique en marchant dessus.
 * @returns {arme, cellules} — ce qui vient d'être pris, ou des valeurs nulles
 */
export function ramasserArmes(joueur){
  const R2 = 1.5 * 1.5;
  let arme = null, cellules = 0;

  for(const a of armesAuSol){
    if(a.pris) continue;
    const dx = a.x - joueur.x, dz = a.z - joueur.z;
    if(dx*dx + dz*dz > R2) continue;
    if(Math.abs(a.y - joueur.gy) > 2.2) continue;
    a.pris = true;
    /* Déjà possédée ? On la laisse au sol plutôt que de la faire disparaître
       pour rien — mais on prend quand même les cellules qu'elle porte. */
    if(ramasserArme(a.cle)) arme = a.cle;
    else { a.pris = false; }
  }

  for(const c of cellulesAuSol){
    if(c.pris) continue;
    const dx = c.x - joueur.x, dz = c.z - joueur.z;
    if(dx*dx + dz*dz > R2) continue;
    if(Math.abs(c.y - joueur.gy) > 2.2) continue;
    c.pris = true;
    armes.reserves.cellule += c.n;
    cellules += c.n;
  }

  return {arme, cellules};
}
