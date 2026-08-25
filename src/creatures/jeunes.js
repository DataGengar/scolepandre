/* ═══ CRÉATURES / JEUNES ═══
   Les petits. Leur nombre suit la profondeur : la surface est calme, le fond
   grouille.

   ── LES TROIS BUGS DE LA v2, ET LEUR CORRECTIF ─────────────────────────────
   « J'ai souvent vu des mini scolopandres bloqués ou immobiles. »
   Il y avait trois causes distinctes, pas une :

   1. LE DÉPLACEMENT N'AVAIT AUCUN REPLI.
      v2 :  if(isFree(nx,nz)){ j.x=nx; j.z=nz; }
      Quand c'était bloqué, on ne bougeait pas — mais le cap ne changeait pas
      non plus. Le jeune restait planté dans le mur pour toujours.
      → v3 : glissement le long de l'obstacle (on tente X seul puis Z seul),
        puis détecteur de blocage.

   2. AUCUN CONTRÔLE DE MARCHE.
      Il tentait de traverser des dénivelés que le relief refuse. Avec les
      falaises de la v3 ce serait devenu systématique.
      → v3 : même test de marche que la mère (CLIMB).

   3. LA CHARGE ALLAIT EN LIGNE DROITE.
      À moins de 13 m il visait le joueur sans tenir compte des murs, donc se
      coinçait en biais contre une paroi dès qu'il y avait un angle.
      → v3 : A* à petit budget, recalculé toutes les 0,8 s.

   Plus un quatrième, dans majJeunes() :
      un `break` inconditionnel en fin de `while` n'ajoutait qu'un jeune par
      appel, et le min/max d'altitude était recalculé sur toute la grille trois
      fois par seconde — insoutenable à 1,18 M de cellules.
      → v3 : boucle correcte, et les bornes viennent de grille.bornes.

   ── LE DÉTECTEUR DE BLOCAGE ────────────────────────────────────────────────
   Filet de sécurité final, indépendant des trois correctifs : si un jeune
   parcourt moins de 0,3 m en 1,2 s alors qu'il essaie d'avancer, on lui donne
   un cap neuf. Si ça dure plus de 4 s, on le replace hors du champ de vision.
   Aucun jeune ne peut donc rester immobile plus de quatre secondes.        */

import {SETUP} from '../setup.js';
import {edifices} from '../monde/edifices.js';
import {clamp, deltaAngle} from '../noyau/math.js';
import {rnd, ri} from '../noyau/rng.js';
import {
  floorH, idx, isFree, w2c, c2w, groundAt, celluleLibre, profondeurDe, vide,
} from '../monde/grille.js';
import {aStar, smooth, CLIMB} from '../monde/navigation.js';
import {nouvelEtatYeux, majYeux} from './lueurs.js';
import {ST} from './etats.js';
import {dansSafe} from '../monde/villages.js';

export const jeunes = [];

/** Callback pour les stridulations. Branché par jeu.js. */
let surStridulation = null;
export const brancherStridulation = fn => { surStridulation = fn; };

/** Renvoie la source de feu la plus proche d'un jeune, ou null. Branché par
    jeu.js : les jeunes n'ont pas à connaître la torche ni les feux de camp. */
let sourceDeFeu = null;
export const brancherFeu = fn => { sourceDeFeu = fn; };

/**
 * Un leurre vient de tomber. Les jeunes assez proches vont l'étudier.
 * C'était la demande : « impossibles à leurrer ».
 */
export function attirerJeunes(x, z){
  const S = SETUP.jeunes;
  let n = 0;
  for(const j of jeunes){
    if(Math.hypot(j.x-x, j.z-z) > S.porteeLeurre) continue;
    j.leurre = {x, z};
    j.leurreT = S.fixationLeurre * (0.7 + Math.random()*0.6);
    j.chargeT = 0;
    j.path = null; j.repathT = 0;
    n++;
  }
  return n;
}

function nouveauJeune(wx, wz, wy){
  return {
    x:wx, z:wz, y:wy, h:rnd()*6.28,
    hist:[], cum:0, t:0, ph:rnd()*6.28,
    ech: SETUP.jeunes.echelleMin + rnd()*(SETUP.jeunes.echelleMax - SETUP.jeunes.echelleMin),
    // navigation
    path:null, pathIdx:1, repathT:0, cible:null,
    // charge : elle s'essouffle, et un leurre la détourne
    chargeT:0, reposT:0, leurre:null, leurreT:0, fuiteT:0,
    /* Ils peuvent mourir, depuis qu'on a des armes. La mère, elle, n'a pas
       de points de vie et n'en aura pas : voir joueur/armes.js. */
    pv: SETUP.jeunes.pv,
    sonne: 0,                 // secondes d'étourdissement après un coup

    // détecteur de blocage
    refX:wx, refZ:wz, blocT:0, coinceT:0,
    // rendu
    etat:ST.PATROL, yeux:nouvelEtatYeux(),
    proche:999, stridT: 4 + rnd()*20,
  };
}

/** Ajuste la population selon la profondeur du joueur. Appelé ~3 fois/s. */
export function majPopulation(joueur){
  const prof = profondeurDe(joueur.gy);
  const voulu = Math.round(prof*prof * SETUP.jeunes.maxParProfondeur);

  while(jeunes.length > voulu) jeunes.pop();

  // v2 : un `break` inconditionnel limitait l'ajout à un par appel.
  // On en ajoute jusqu'à deux par appel — assez pour se remplir vite, pas
  // assez pour faire une pointe de coût sur un seul tour de boucle.
  let ajoutes = 0;
  while(jeunes.length < voulu && ajoutes < 2){
    /* D'abord une brèche d'église ; à défaut, n'importe où. */
    const p = pointDeBreche(joueur, 22, 90) || pointDApparition(joueur, 26, 90);
    if(!p) break;
    jeunes.push(nouveauJeune(p.x, p.z, p.y));
    ajoutes++;
  }
}

/* ═══════════════ D'OÙ ILS SORTENT ═══════════════
   « Des gobelins qui s'échappent des églises et envahissent le monde. »

   Ils ne naissent pas n'importe où : ils SORTENT. Chaque cathédrale a une
   brèche dans le dallage de son chœur, et c'est par là qu'ils remontent. Le
   monde est donc envahi DEPUIS des points précis, ce qui change tout par
   rapport à une apparition uniforme :

     · on peut remonter à la source. Trois cathédrales, trois foyers, et la
       densité décroît quand on s'en éloigne — sans qu'aucune règle ne le
       dise, simplement parce qu'ils marchent depuis là ;
     · s'approcher d'une église devient une décision. C'est là que sont les
       vitraux, les tours, ce qu'on veut voir — et c'est de là qu'ils sortent ;
     · on comprend le monde sans qu'on nous l'explique.

   Si aucune cathédrale n'est atteignable — trop loin, ou monde sans église —
   on retombe sur l'ancienne apparition dispersée. Un monde sans gobelins
   serait plus étrange qu'un gobelin sans église.                            */

function pointDeBreche(joueur, dMin, dMax){
  if(!edifices.length) return null;
  // les brèches à portée : ni sur nous, ni à l'autre bout du monde
  const proches = [];
  for(const e of edifices){
    if(!e.breche) continue;
    const d = Math.hypot(e.breche.x - joueur.x, e.breche.z - joueur.z);
    if(d > dMax * 2.4) continue;
    proches.push(e);
  }
  if(!proches.length) return null;

  const e = proches[ri(0, proches.length - 1)];
  /* Ils sortent du trou, puis s'égaillent. On les pose donc dans un anneau
     autour de la brèche, pas dessus : sinon ils apparaissent tous au même
     point et le premier bloque les suivants. */
  for(let k = 0; k < 40; k++){
    const a = rnd() * 6.283, d = 1.5 + rnd() * SETUP.jeunes.rayonBreche;
    const wx = e.breche.x + Math.cos(a)*d, wz = e.breche.z + Math.sin(a)*d;
    const cx = w2c(wx), cz = w2c(wz);
    if(!isFree(cx, cz)) continue;
    const dj = Math.hypot(wx - joueur.x, wz - joueur.z);
    if(dj < dMin) continue;               // pas dans le dos du joueur
    return {x: wx, z: wz, y: floorH[idx(cx, cz)]};
  }
  return null;
}

/** Une cellule libre à bonne distance du joueur, ou null. */
function pointDApparition(joueur, dMin, dMax){
  for(let k=0;k<200;k++){
    const c = celluleLibre(ri);
    const wx = c2w(c.x), wz = c2w(c.z);
    const d = Math.hypot(wx - joueur.x, wz - joueur.z);
    if(d < dMin || d > dMax) continue;
    return {x:wx, z:wz, y: floorH[idx(c.x,c.z)] + 0.3};
  }
  return null;
}

/**
 * @returns {mort:boolean, plusProche:number} — distance du plus proche
 */
export function updateJeunes(dt, joueur, temps, sons){
  const S = SETUP.jeunes;
  let plusProche = 1e9, mort = false;

  for(const j of jeunes){
    j.t += dt;
    const d = Math.hypot(joueur.x - j.x, joueur.z - j.z);
    j.proche = d;
    plusProche = Math.min(plusProche, d);

    /* ═══ CE QUI LES REND JOUABLES ═══
       Retour de test : « trop rapides et impossibles à leurrer ». Les deux
       étaient vrais : 4,2 m/s contre 3,2 en marche, et aucune réaction aux
       leurres. Trois contre-mesures maintenant, dans l'ordre de priorité. */

    // 1. LE FEU. Une torche brandie ou un feu de camp les fait reculer.
    j.fuiteT = Math.max(0, j.fuiteT - dt);
    const feu = sourceDeFeu ? sourceDeFeu(j) : null;
    if(feu) j.fuiteT = 0.6;

    // 2. LE LEURRE. Un impact les fixe : ils vont l'étudier et t'oublient.
    j.leurreT = Math.max(0, j.leurreT - dt);
    if(j.leurreT <= 0) j.leurre = null;

    // 3. L'ESSOUFFLEMENT. Ils ne peuvent pas charger indéfiniment.
    j.reposT = Math.max(0, j.reposT - dt);
    /* ── LÂCHE SEUL, HARDI EN MEUTE ──
       Un gobelin isolé tourne autour et n'ose pas. À partir de trois, ils se
       jettent. C'est ce qui les rend inquiétants plutôt que pénibles : on
       peut en tenir un à distance, on ne peut pas en tenir cinq, et on voit
       le basculement arriver.

       Ça donne aussi un sens au pied-de-biche. Tuer le troisième d'un groupe
       de quatre ne fait pas que retirer un ennemi : ça fait RECULER les
       trois autres, d'un coup. Une arme qui change une situation vaut mieux
       qu'une arme qui grignote une barre de vie. */
    let voisins = 0;
    for(const autre of jeunes){
      if(autre === j) continue;
      if(Math.hypot(autre.x - j.x, autre.z - j.z) < S.rayonMeute) voisins++;
    }
    const enMeute = voisins + 1 >= S.tailleMeute;
    j.enMeute = enMeute;
    if(!enMeute && d < S.porteeCharge * 1.4 && d > 2.2){
      /* Il rôde : il garde ses distances et tourne. Il n'attaque pas, mais
         il ne part pas non plus — et c'est en le regardant tourner qu'on
         entend arriver les autres. */
      const a = Math.atan2(j.z - joueur.z, j.x - joueur.x) + 0.9;
      j.cible = {x: joueur.x + Math.cos(a)*S.rayonRode,
                 z: joueur.z + Math.sin(a)*S.rayonRode};
    }

    let charge = enMeute && d < S.porteeCharge && !joueur.abrite
              && j.reposT <= 0 && !j.leurre && j.fuiteT <= 0;
    if(charge){
      j.chargeT += dt;
      if(j.chargeT > S.endurance){ j.chargeT = 0; j.reposT = S.repos; charge = false; }
    } else j.chargeT = Math.max(0, j.chargeT - dt*0.5);

    j.etat = charge ? ST.CHASE : ST.PATROL;
    const v = j.fuiteT > 0 ? S.vitesseCharge
            : charge      ? S.vitesseCharge
            : j.leurre    ? S.vitesseErrance * 1.6
            :               S.vitesseErrance;

    /* ── CIBLE ──
       En charge : A* vers le joueur, recalculé périodiquement. La ligne droite
       de la v2 était la cause principale des blocages en angle.
       En errance : un point devant soi, réévalué quand on l'atteint. */
    j.repathT -= dt;
    if(j.fuiteT > 0){
      // fuir le feu : demi-tour, tout droit, pas de calcul de chemin
      j.path = null;
      j.cible = {x: j.x + (j.x - feu.x)*3, z: j.z + (j.z - feu.z)*3};
    } else if(j.leurre){
      // aller étudier le leurre : c'est la contre-mesure du joueur
      if(j.repathT <= 0 || !j.path){
        const cells = aStar(w2c(j.x), w2c(j.z), w2c(j.leurre.x), w2c(j.leurre.z), S.budgetAStar);
        j.path = cells ? smooth(cells) : null;
        j.pathIdx = 1; j.repathT = S.repath;
      }
      j.cible = j.leurre;
    } else if(charge){
      if(j.repathT <= 0 || !j.path){
        const cells = aStar(w2c(j.x), w2c(j.z), w2c(joueur.x), w2c(joueur.z), S.budgetAStar);
        j.path = cells ? smooth(cells) : null;
        j.pathIdx = 1;
        j.repathT = S.repath;
      }
    } else if(!j.cible || Math.hypot(j.cible.x - j.x, j.cible.z - j.z) < 2.5 || j.repathT <= 0){
      const a = j.h + (rnd()-0.5)*1.6;
      j.cible = {x: j.x - Math.sin(a)*10, z: j.z - Math.cos(a)*10};
      j.repathT = 3 + rnd()*3;
      j.path = null;
    }

    // le point à viser cette image
    let tx, tz;
    if(j.fuiteT > 0){
      tx = j.cible.x; tz = j.cible.z;
    } else if((charge || j.leurre) && j.path && j.pathIdx < j.path.length){
      let n = j.path[j.pathIdx];
      if(Math.hypot(n.x - j.x, n.z - j.z) < 0.9){
        j.pathIdx++;
        n = j.path[Math.min(j.pathIdx, j.path.length-1)];
      }
      tx = n.x; tz = n.z;
    } else if(charge){
      tx = joueur.x; tz = joueur.z;
    } else if(j.leurre){
      tx = j.leurre.x; tz = j.leurre.z;
    } else {
      tx = j.cible.x; tz = j.cible.z;
    }

    // cap
    const want = Math.atan2(-(tx - j.x), -(tz - j.z));
    j.h += clamp(deltaAngle(want - j.h), -3*dt, 3*dt);

    /* ── DÉPLACEMENT AVEC GLISSEMENT ──
       On tente le pas complet ; s'il est refusé, on tente l'axe X seul puis
       l'axe Z seul. C'est ce qui fait glisser le long d'un mur au lieu de s'y
       écraser — exactement ce que fait déjà le joueur. */
    const pas = v * dt;
    const dx = -Math.sin(j.h)*pas, dz = -Math.cos(j.h)*pas;
    const solIci = groundAt(j.x, j.z);
    let bouge = false;
    if(praticable(j.x+dx, j.z+dz, solIci)){ j.x += dx; j.z += dz; bouge = true; }
    else {
      if(praticable(j.x+dx, j.z, solIci)){ j.x += dx; bouge = true; }
      if(praticable(j.x, j.z+dz, solIci)){ j.z += dz; bouge = true; }
    }

    /* ── DÉTECTEUR DE BLOCAGE ──
       Filet final. Il ne remplace pas les correctifs ci-dessus, il garantit
       qu'aucun cas oublié ne produise un jeune immobile. */
    j.blocT += dt;
    if(j.blocT >= S.fenetreBlocage){
      const parcouru = Math.hypot(j.x - j.refX, j.z - j.refZ);
      if(parcouru < S.seuilBlocage){
        j.coinceT += j.blocT;
        j.h = rnd()*6.283;                  // cap neuf, tout de suite
        j.path = null; j.cible = null; j.repathT = 0;
        if(j.coinceT >= S.delaiTeleport){
          // vraiment coincé : on le replace hors de vue et on repart à zéro
          const p = pointDApparition(joueur, 34, 90);
          if(p){ j.x = p.x; j.z = p.z; j.y = p.y; j.hist.length = 0; j.cum = 0; }
          j.coinceT = 0;
        }
      } else j.coinceT = 0;
      j.refX = j.x; j.refZ = j.z; j.blocT = 0;
    }

    // altitude : on suit le sol, et on ne flotte jamais au-dessus d'un gouffre
    const solCible = groundAt(j.x, j.z) + 0.3;
    j.y += (solCible - j.y) * (1 - Math.exp(-9*dt));

    // trace du corps
    const l = j.hist[j.hist.length-1];
    const st = l ? Math.hypot(j.x - l.x, j.z - l.z) : 9;
    if(st > 0.07){
      j.cum += st;
      j.hist.push({x:j.x, y:j.y, z:j.z, cum:j.cum});
      while(j.hist.length > 2 && j.cum - j.hist[0].cum > 7) j.hist.shift();
    }

    // stridulations : ils se répondent. Ça les rend présents sans les voir.
    j.stridT -= dt;
    if(j.stridT <= 0){
      j.stridT = 6 + rnd()*22;
      if(d < SETUP.audio.jeunesPortee && surStridulation) surStridulation();
    }

    majYeux(j.yeux, j.etat, dt, temps);

    if(d < 1.0) mort = true;
  }

  return {mort, plusProche};
}

/** Sol praticable pour un jeune : libre, pas de vide, marche acceptable, et
    surtout PAS dans une place barricadée de village — ils n'y entrent pas. */
function praticable(wx, wz, depuis){
  if(dansSafe(wx, wz)) return false;
  const cx = w2c(wx), cz = w2c(wz);
  if(!isFree(cx,cz)) return false;
  const i = idx(cx,cz);
  if(vide[i]) return false;                 // ils ne se jettent pas dans les trous
  return Math.abs(floorH[i] - depuis) <= CLIMB;
}

export function viderJeunes(){ jeunes.length = 0; }


/* ═══════════════ LES COUPS ═══════════════
   Un jeune, ça se tue. C'est la différence de fond avec la mère, et c'est ce
   qui donne un sens aux armes : sans elles, on ne pouvait que subir les
   jeunes, qui sont nombreux et rapides.

   Un coup non fatal ÉTOURDIT. C'est important : frapper doit produire un
   effet visible même quand ça ne suffit pas, sinon on ne sait pas si l'on a
   touché.                                                                   */

/**
 * @returns 'mort', 'touche', ou null si la référence n'existe plus
 */
export function blesserJeune(j, degats, poussee, dx, dz){
  const k = jeunes.indexOf(j);
  if(k < 0) return null;

  j.pv -= degats;
  if(j.pv <= 0){
    jeunes.splice(k, 1);
    return 'mort';
  }

  j.sonne = Math.max(j.sonne, SETUP.jeunes.sonneSecondes);
  /* La poussée : on le repousse dans l'axe du coup. Elle passe par la même
     porte que tout le reste — pas de téléportation, on décale la cible et le
     déplacement fait le travail. */
  j.x += dx * poussee * 0.22;
  j.z += dz * poussee * 0.22;
  j.cible = {x: j.x + dx * 6, z: j.z + dz * 6};
  j.path = null;
  return 'touche';
}
