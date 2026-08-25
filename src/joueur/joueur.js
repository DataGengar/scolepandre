/* ═══ JOUEUR / JOUEUR ═══
   État, déplacement, collision, traces.

   Collision : un mur, un élément solide, ou une marche trop haute. Descendre
   est toujours permis — on tombe. C'est la moitié basse de l'asymétrie
   verticale : elle grimpe 2,90 m, toi 1,25 m.

   Le vide NE BLOQUE PAS : on marche dans un gouffre et on y tombe. C'est
   volontaire, et c'est ce qui rend les précipices dangereux.               */

import {SETUP} from '../setup.js';
import {solSous, murA, aDesNiveaux} from '../monde/niveaux.js';
import {clamp, lerp} from '../noyau/math.js';
import {rnd, ri} from '../noyau/rng.js';
import {
  GW, GH, CELL, floorH, ceilH, sky, vide, pont, pontH, echelle,
  idx, isFree, isFloor, w2c, c2w,
  groundAt, degagement, celluleLibre, bornes, biomeAt,
} from '../monde/grille.js';
import {colliders} from '../monde/props.js';

export const joueur = {
  x:0, z:0, gy:0, vy:0,
  eye:SETUP.joueur.hauteurOeil,
  yaw:0, pitch:0, vx:0, vz:0,
  stepAcc:0, bob:0,
  mode:'walk',            // walk | run | crouch | prone
  held:0, throwCd:0,
  shake:0,                // tremblement sismique 0..1
  abrite:false,           // dans une cachette
  cachette:null,
  prone:0,                // temps restant au sol après une chute
  auSol:true,             // pour savoir si l'on a le droit de sauter
  sautCd:0,               // anti-rebond
  derive:0,               // tremblement de main dû au froid
  chuteDepuis:null,       // altitude du début d'une chute libre
  vitesse:0,
  surPont:false,          // second étage : on marche sur un tablier
};

export const touches = Object.create(null);
export let verrouRampe = false;
export const basculerRampe = () => { verrouRampe = !verrouRampe; };

/** Vibrations émises dans le monde. Lues par creatures/mere.js. */
export const sons = [];
/** Marqueurs d'odeur. Ramper n'en imprime aucun. */
export const odeur = [];

let accOdeur = 0;

export function emettreSon(x, z, r, lure){
  sons.push({x, z, r: r*SETUP.traces.porteeVibrations, t:0, lure: !!lure});
}

export function spawnJoueur(){
  const c = celluleLibre(ri);
  joueur.x = c2w(c.x); joueur.z = c2w(c.z);
  joueur.gy = floorH[idx(c.x,c.z)]; joueur.vy = 0;
  joueur.yaw = rnd()*6.28; joueur.pitch = 0; joueur.held = 1;
  joueur.abrite = false; joueur.cachette = null;
  /* Deux qualités d'abri. `abrite` reste le drapeau que tout le reste du jeu
     interroge — la créature, le froid, le son — et `abriSorte` dit LEQUEL,
     pour ceux qui font la différence. */
  joueur.abriSorte = null;
  joueur.degageAuto = 0;
  veille.temps = 0; veille.parcouru = 0; veille.x = 0; veille.z = 0;
  joueur.prone = 0; joueur.shake = 0; joueur.chuteDepuis = null;
  joueur.surPont = false;
  odeur.length = 0; sons.length = 0;
}

/* ═══════════════ LES DEUX ÉTAGES ═══════════════
   Le champ de hauteur ne connaît qu'une altitude par colonne. `pont[i]` marque
   un tablier et `pontH[i]` sa cote : on passe DESSOUS par défaut, et DESSUS
   quand `joueur.surPont` est vrai.

   ── ON Y MONTE EN MARCHANT ─────────────────────────────────────────────────
   Depuis la v4, un tablier commence et finit au niveau du sol (voir
   monde/ponts.js). Il suffit donc de comparer sa cote à la nôtre : si l'on
   pose le pied sur une cellule de tablier dont la cote est à portée de pas,
   on est dessus. Aucune touche, aucune échelle, rien à apprendre.

   La v3 exigeait un `E` sur une cellule unique, invisible et non signalée,
   pour monter sur une dalle flottant à trois mètres cinquante. Personne ne
   pouvait le deviner, et personne ne l'a deviné.

   Sortir du tablier par le côté ne bloque pas : on quitte l'étage et on tombe.
   C'est une passerelle au-dessus d'un gouffre, pas un couloir.             */

/**
 * Décide si l'on est sur le tablier ou dessous. Appelé chaque image.
 *
 * Extrait de la gravité pour être appelable seul : `outils/diag_passage.py`
 * s'en sert pour faire réellement traverser des ponts au joueur. Un test qui
 * réimplémenterait cette règle ne testerait que lui-même.
 */
export function majEtage(){
  const i = idx(clamp(w2c(joueur.x), 0, GW-1), clamp(w2c(joueur.z), 0, GH-1));

  if(joueur.surPont){
    if(!pont[i]) joueur.surPont = false;
    return;
  }
  if(!pont[i] || joueur.vy > 0.01) return;

  /* Monter en marchant. On ne s'accroche que si le tablier est à portée de
     pas — sinon on s'y collerait en passant DESSOUS, ce qui est le cas normal
     au milieu d'une travée. */
  const ecart = pontH[i] - joueur.gy;
  if(ecart <= SETUP.monde.marcheJoueur && ecart > -0.30){
    joueur.surPont = true;
    joueur.gy = Math.max(joueur.gy, pontH[i]);
    joueur.vy = 0; joueur.chuteDepuis = null;
    return;
  }

  /* LE TABLIER RATTRAPE. Au-dessus d'un gouffre, il n'y a rien d'autre sous
     nos pieds : si une passerelle passe là, même un peu plus bas, c'est elle
     qui nous reçoit. Sans cette clause, on traversait le pont EN TOMBANT
     dedans — mesuré, cinq traversées sur trente-six finissaient dans le vide
     alors qu'un tablier était juste dessous.

     La restriction à `vide[i]` est ce qui rend la règle sûre : sur la terre
     ferme, un pont qui passe deux mètres sous nos pieds ne doit surtout pas
     nous aspirer. */
  if(vide[i] && ecart < 0){
    joueur.surPont = true;
    joueur.gy = pontH[i];
    joueur.vy = 0; joueur.chuteDepuis = null;
  }
}

/** Cote du sol sur lequel le joueur se tient, étage courant compris. */
export function coteSol(wx, wz){
  const x = w2c(wx), z = w2c(wz);
  if(x<0 || z<0 || x>=GW || z>=GH) return -99999;
  const i = idx(x,z);
  if(joueur.surPont && pont[i]) return pontH[i];

  /* ── LES PLANCHERS DE BÂTIMENT ──
     Depuis monde/niveaux.js, une cellule peut porter plusieurs sols : la
     crypte, la nef, le triforium. On demande LE PLUS HAUT QUI SOIT SOUS LES
     PIEDS — pas le plus proche. Prendre le plus proche ferait remonter d'un
     étage en passant dessous, ce qui est le genre de téléportation qui rend
     un jeu inexplicable.

     `aDesNiveaux()` évite tout coût dans les mondes sans bâtiment. */
  if(aDesNiveaux()){
    const r = solSous(x, z, joueur.gy, SETUP.monde.marcheJoueur);
    if(r.source === 'niveau') return r.y;
  }
  if(vide[i]) return -99999;
  if(!isFloor(x,z)) return -99999;
  return floorH[i];
}

/** Y a-t-il une échelle utilisable ici ? Renvoie 'monter', 'descendre' ou null. */
export function echelleIci(){
  const x = w2c(joueur.x), z = w2c(joueur.z);
  if(!isFloor(x,z)) return null;
  const i = idx(x,z);
  if(!echelle[i]) return null;
  return joueur.surPont ? 'descendre' : 'monter';
}

/** Emprunte l'échelle. Renvoie true si on a changé d'étage. */
export function emprunterEchelle(){
  const quoi = echelleIci();
  if(!quoi) return false;
  const i = idx(w2c(joueur.x), w2c(joueur.z));
  if(quoi === 'monter'){
    if(pontH[i] - joueur.gy > 9) return false;      // trop haut pour grimper
    joueur.surPont = true;
    joueur.gy = pontH[i];
  } else {
    joueur.surPont = false;
    joueur.gy = floorH[i];
  }
  joueur.vy = 0; joueur.chuteDepuis = null;
  return true;
}

/* ═══════════════ COLLISION ═══════════════

   ── CE QUI CLOCHAIT (v4) ───────────────────────────────────────────────────
   « Je suis souvent bloqué entre deux objets », et « les hitbox sont trop
   grosses et ne correspondent pas à l'objet ». Les deux constats n'en font
   qu'un, et la cause était double :

     1. UN SEUL CERCLE PAR ÉLÉMENT. Un lampadaire, une voiture couchée, une
        poutre de barrage : tous recevaient un disque au sol, de rayon égal à
        leur part la plus large, plafonné à 1,40 m. On se cognait donc à deux
        mètres d'une carcasse, et sous une poutre suspendue à quatre mètres de
        haut. C'est corrigé dans monde/props.js : une hitbox par PART, en
        forme de capsule — un segment, un rayon, un étage. Voir `capsulePart`
        dans monde/formes.js.

     2. AUCUN GLISSEMENT. Le déplacement était testé axe par axe : si X et Z
        étaient tous deux refusés — ce qui arrive dès qu'on aborde un obstacle
        de biais — on s'arrêtait net. Entre deux objets, les deux axes sont
        refusés en permanence : c'est exactement « coincé entre deux objets ».

   ── CE QU'ON FAIT MAINTENANT ───────────────────────────────────────────────
   Le RELIEF garde le test axe par axe : il est aligné sur la grille, et longer
   un mur de roche y glisse déjà correctement.

   Les ÉLÉMENTS, eux, ne bloquent plus : ils REPOUSSENT. On avance, puis on
   sort le joueur de ce qu'il chevauche, le long de la normale. Deux objets qui
   se touchent presque le recrachent d'un côté au lieu de le pincer, et aborder
   un tronc de biais fait glisser dessus sans une ligne de plus. Le prix : on
   peut pénétrer d'un centimètre pendant une image. À 5,6 m/s et soixante
   images par seconde un pas fait 9 cm — rien ne peut être traversé.        */

let collParCell = new Map();

/**
 * Range chaque capsule dans TOUTES les cellules que sa boîte englobante
 * touche, élargie du rayon du joueur. Une requête ne consulte donc qu'une
 * cellule — la sienne — sans jamais rater un objet long.
 *
 * La v4 rangeait un cercle dans les neuf cellules autour de son centre :
 * correct pour un pilier, faux pour un mur de cinq mètres.
 */
export function indexerColliders(){
  collParCell = new Map();
  const R = SETUP.joueur.rayon;
  for(const co of colliders){
    const m = co.r + R;
    const cx0 = clamp(w2c(Math.min(co.x0, co.x1) - m), 0, GW-1);
    const cx1 = clamp(w2c(Math.max(co.x0, co.x1) + m), 0, GW-1);
    const cz0 = clamp(w2c(Math.min(co.z0, co.z1) - m), 0, GH-1);
    const cz1 = clamp(w2c(Math.max(co.z0, co.z1) + m), 0, GH-1);
    for(let z = cz0; z <= cz1; z++) for(let x = cx0; x <= cx1; x++){
      const k = idx(x, z);
      let lot = collParCell.get(k);
      if(!lot) collParCell.set(k, lot = []);
      lot.push(co);
    }
  }
}

/** Hauteur du corps. En rampant elle tombe à un mètre : on passe alors sous ce
    qu'on ne franchit pas debout, ce qui donne enfin une raison de plus de se
    mettre à plat ventre. */
const hauteurCorps = () => joueur.eye + SETUP.joueur.margeTete;

/** Cette capsule est-elle à hauteur de corps, pour des pieds à la cote `gy` ? */
function aHauteur(co, gy){
  if(co.y1 < gy + SETUP.monde.marcheJoueur) return false;   // on l'enjambe
  if(co.y0 > gy + hauteurCorps()) return false;             // on passe dessous
  return true;
}

/* Projeté du point sur le segment de la capsule. Un tableau de module plutôt
   qu'une allocation : appelé des dizaines de fois par image. */
const PROJ = [0, 0];

function distanceCapsule2(px, pz, co){
  const dx = co.x1 - co.x0, dz = co.z1 - co.z0;
  const l2 = dx*dx + dz*dz;
  let t = l2 > 1e-9 ? ((px - co.x0)*dx + (pz - co.z0)*dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  PROJ[0] = co.x0 + dx*t; PROJ[1] = co.z0 + dz*t;
  const ex = px - PROJ[0], ez = pz - PROJ[1];
  return ex*ex + ez*ez;
}

const lotEn = (x, z) =>
  collParCell.get(idx(clamp(w2c(x), 0, GW-1), clamp(w2c(z), 0, GH-1)));

/** Un élément de décor occupe-t-il ce point, à cette hauteur de pieds ? */
export function heurteElement(nx, nz, gy){
  const lot = lotEn(nx, nz);
  if(!lot) return false;
  const R = SETUP.joueur.rayon;
  for(const co of lot){
    if(!aHauteur(co, gy)) continue;
    const rr = co.r + R;
    if(distanceCapsule2(nx, nz, co) < rr*rr) return true;
  }
  return false;
}

/** Le RELIEF seul : mur de roche, ou marche trop haute. */
export function heurteTerrain(nx, nz, depuis){
  const r = SETUP.joueur.rayon;
  for(const [ox,oz] of [[r,0],[-r,0],[0,r],[0,-r],
                        [r*.7,r*.7],[-r*.7,r*.7],[r*.7,-r*.7],[-r*.7,-r*.7]]){
    const cx = w2c(nx+ox), cz = w2c(nz+oz);
    if(cx<0 || cz<0 || cx>=GW || cz>=GH) continue;
    if(vide[idx(cx,cz)]) continue;                 // le vide ne bloque pas : on y tombe
    if(!isFree(cx,cz)) return true;
    if(floorH[idx(cx,cz)] - depuis > SETUP.monde.marcheJoueur) return true;
  }
  return false;
}

/**
 * Le point est-il occupé ? Relief ET décor.
 *
 * Le déplacement n'appelle plus cette fonction pour le décor — il repousse
 * (voir `repousser`). Elle reste la question qu'on pose AVANT de poser
 * quelqu'un quelque part : le déblocage, et les outils de diagnostic.
 */
export function bloqueA(nx, nz, depuis){
  /* Sur un tablier, on est au-dessus de tout : ni le relief ni les éléments du
     sol ne peuvent nous arrêter. Seul le bord du tablier compte, et il ne
     bloque pas — il laisse tomber. */
  if(joueur.surPont) return false;

  /* Un mur de bâtiment n'occupe qu'une TRANCHE d'altitude : on passe sous une
     arche et on bute contre le piédroit qui la porte. C'est toute la
     différence entre une cathédrale et un bloc — et c'est ce que `blocked[]`
     ne sait pas exprimer, lui qui condamne une colonne entière du sol au
     ciel. */
  if(aDesNiveaux() && murA(w2c(nx), w2c(nz), depuis)) return true;

  return heurteElement(nx, nz, depuis) || heurteTerrain(nx, nz, depuis);
}

/**
 * Sort le joueur des éléments qu'il chevauche, en le poussant le long de la
 * normale. C'est ce qui remplace le blocage, et ce qui rend le pincement
 * impossible : deux objets serrés produisent deux poussées, dont la somme
 * fait sortir par le côté ouvert.
 *
 * Trois passes : sortir d'un objet peut faire entrer dans son voisin. On ne
 * pousse jamais DANS la roche, sinon on troquerait un blocage contre un mur.
 */
function repousser(gy){
  if(joueur.surPont) return;
  const R = SETUP.joueur.rayon;
  for(let passe = 0; passe < 3; passe++){
    const lot = lotEn(joueur.x, joueur.z);
    if(!lot) return;
    let bouge = false;
    for(const co of lot){
      if(!aHauteur(co, gy)) continue;
      const rr = co.r + R;
      const d2 = distanceCapsule2(joueur.x, joueur.z, co);
      if(d2 >= rr*rr) continue;
      let ex = joueur.x - PROJ[0], ez = joueur.z - PROJ[1];
      let d = Math.sqrt(d2);
      if(d < 1e-3){
        /* Pile sur l'axe de la capsule. Il faut sortir par une direction, et
           elle doit être STABLE : tirée au hasard, on vibrerait sur place. */
        ex = (co.z1 - co.z0) || 1; ez = -(co.x1 - co.x0);
        d = Math.hypot(ex, ez) || 1;
      }
      const k = (rr - d) / d;
      const px = joueur.x + ex*k, pz = joueur.z + ez*k;
      if(heurteTerrain(px, pz, gy)) continue;
      joueur.x = px; joueur.z = pz;
      bouge = true;
    }
    if(!bouge) return;
  }
}

/* ─────────────── déplacement ─────────────── */

/**
 * @param mult   multiplicateur de vitesse venant du froid
 * @param hooks  {pas(force), impactSol(vitesse)}
 */
export function updateJoueur(dt, mult, hooks){
  const J = SETUP.joueur;
  const H = hooks || {};

  joueur.sautCd = Math.max(0, joueur.sautCd - dt);

  // Au sol après une chute : aucun contrôle. C'est le prix de la secousse.
  if(joueur.prone > 0){
    joueur.prone -= dt;
    joueur.mode = 'prone';
    joueur.vx *= Math.exp(-8*dt); joueur.vz *= Math.exp(-8*dt);
    joueur.eye = lerp(joueur.eye, 0.35, 1 - Math.exp(-9*dt));
    appliquerGravite(dt, H);
    return;
  }

  const run = touches['ShiftLeft'] || touches['ShiftRight'];
  const rampe = touches['KeyC'] || touches['KeyX'] || verrouRampe
             || (!joueur.surPont && degagement(joueur.x, joueur.z) < SETUP.monde.plafondRampe);
  joueur.mode = rampe ? 'crouch' : run ? 'run' : 'walk';

  const base = rampe ? J.vitesseRampe : run ? J.vitesseCourse : J.vitesseMarche;
  const spd = base * mult;

  let f=0, s=0;
  if(touches['KeyW'] || touches['KeyZ'] || touches['ArrowUp'])    f += 1;
  if(touches['KeyS'] || touches['ArrowDown'])                     f -= 1;
  if(touches['KeyD'] || touches['ArrowRight'])                    s += 1;
  if(touches['KeyA'] || touches['KeyQ'] || touches['ArrowLeft'])  s -= 1;
  const L = Math.hypot(f,s) || 1; f/=L; s/=L;

  const fx = -Math.sin(joueur.yaw), fz = -Math.cos(joueur.yaw);
  const rx =  Math.cos(joueur.yaw), rz = -Math.sin(joueur.yaw);
  joueur.vx = lerp(joueur.vx, (fx*f + rx*s)*spd, 1 - Math.exp(-14*dt));
  joueur.vz = lerp(joueur.vz, (fz*f + rz*s)*spd, 1 - Math.exp(-14*dt));

  const nx = joueur.x + joueur.vx*dt, nz = joueur.z + joueur.vz*dt;
  /* Le relief bloque axe par axe — il est aligné sur la grille, on y glisse.
     Le décor, lui, laisse entrer puis repousse : c'est ce qui rend le
     contournement automatique, et le pincement impossible. */
  if(joueur.surPont || !heurteTerrain(nx, joueur.z, joueur.gy)) joueur.x = nx;
  else joueur.vx = 0;
  if(joueur.surPont || !heurteTerrain(joueur.x, nz, joueur.gy)) joueur.z = nz;
  else joueur.vz = 0;
  repousser(joueur.gy);

  appliquerGravite(dt, H);

  const mv = Math.hypot(joueur.vx, joueur.vz);
  joueur.vitesse = mv;
  surveillerBlocage(dt, f !== 0 || s !== 0);
  joueur.bob += mv*dt*(rampe ? 4 : run ? 9 : 6.5);
  const cible = rampe ? J.hauteurRampe : J.hauteurOeil;
  joueur.eye = lerp(joueur.eye, cible + Math.sin(joueur.bob)*0.035*(mv>0.4?1:0),
                    1 - Math.exp(-12*dt));

  // ── vibrations et traces
  if(mv > 0.35 && !joueur.abrite){
    joueur.stepAcc += mv*dt;
    const enjambee = rampe ? 1.15 : run ? 1.5 : 1.25;
    if(joueur.stepAcc > enjambee){
      joueur.stepAcc = 0;
      const T = SETUP.traces;
      emettreSon(joueur.x, joueur.z, rampe ? T.pasRampe : run ? T.pasCourse : T.pasMarche, false);
      if(H.pas) H.pas(rampe ? 0.15 : run ? 0.65 : 0.35);
    }
    /* RAMPER N'IMPRIME AUCUNE TRACE. C'est la contre-mesure du joueur : en v1
       la piste était un phare, ici elle a un interrupteur. */
    if(!rampe){
      accOdeur += dt;
      if(accOdeur > 0.4){ accOdeur = 0; odeur.push({x:joueur.x, z:joueur.z, t:0}); }
    }
  } else joueur.stepAcc = Math.max(0, joueur.stepAcc - dt);

  /* La décroissance des traces N'EST PAS appelée ici : c'est jeu.js qui la
     fait, une seule fois par image, avec le vrai vent et le vrai dt. La v3
     initiale l'appelait aux deux endroits, si bien que l'appel de jeu.js
     recevait dt=0 — la dérive au vent et l'effacement par la neige étaient
     morts sans que rien ne le signale. */
  joueur.throwCd = Math.max(0, joueur.throwCd - dt);
}

function appliquerGravite(dt, H){
  /* Quitter le tablier par le côté : on redevient un piéton ordinaire, en
     l'air, et la gravité fait le reste. C'est ce qui rend une passerelle
     étroite réellement inquiétante. */
  majEtage();
  const gt = coteSol(joueur.x, joueur.z);

  /* « Au sol » sert au saut. On le juge AVANT d'appliquer la gravité, et on
     tolère un petit seuil : sur un sol légèrement irrégulier, gy oscille de
     quelques centimètres et un test strict rendrait le saut capricieux. */
  joueur.auSol = (joueur.gy <= gt + 0.14) && joueur.vy <= 0.01;

  if(joueur.gy > gt + 0.06){
    if(joueur.chuteDepuis === null) joueur.chuteDepuis = joueur.gy;
    joueur.vy -= SETUP.joueur.gravite*dt;
    joueur.gy += joueur.vy*dt;
    if(joueur.gy < gt){
      joueur.gy = gt;
      const hauteur = joueur.chuteDepuis - gt;
      if(joueur.vy < -7) emettreSon(joueur.x, joueur.z, 16, false);
      if(H.impactSol) H.impactSol(hauteur, -joueur.vy);
      joueur.vy = 0; joueur.chuteDepuis = null;
    }
  } else if(joueur.vy > 0){
    /* On MONTE : c'est un saut. Sans cette branche, le lissage vers le sol
       ci-dessous annulait la vitesse ascendante à l'image suivante et le
       personnage ne décollait jamais. */
    joueur.vy -= SETUP.joueur.gravite*dt;
    joueur.gy += joueur.vy*dt;
  } else {
    joueur.gy = lerp(joueur.gy, gt, 1 - Math.exp(-16*dt));
    joueur.vy = 0; joueur.chuteDepuis = null;
  }
}

/**
 * Sauter. Rien ne se passe si l'on n'est pas au sol, à plat ventre, ou abrité.
 * @returns true si le saut est parti
 */
export function sauter(){
  if(!joueur.auSol || joueur.sautCd > 0) return false;
  if(joueur.prone > 0 || joueur.abrite) return false;
  joueur.vy = SETUP.joueur.forceSaut;
  joueur.auSol = false;
  joueur.sautCd = SETUP.joueur.delaiSaut;
  // décoller fait du bruit : c'est le prix de la verticalité
  emettreSon(joueur.x, joueur.z, SETUP.joueur.bruitSaut, false);
  return true;
}

/**
 * Décroissance des vibrations et dérive de l'odeur.
 * @param ventX,ventZ  déplacement du vent, fourni par jeu.js
 * @param effacement   1 = normal, plus la neige efface vite
 */
export function decroitreTraces(dt, ventX = 0, ventZ = 0, effacement = 1){
  for(let i=sons.length-1;i>=0;i--){
    sons[i].t += dt;
    if(sons[i].t > 0.8) sons.splice(i,1);
  }
  for(const sp of odeur){
    sp.t += dt;
    sp.x += ventX*dt*0.9; sp.z += ventZ*dt*0.9;
  }
  const vie = SETUP.traces.persistanceOdeur;
  while(odeur.length && odeur[0].t * effacement > vie) odeur.shift();
}

/* ═══ DÉBLOCAGE ═══
   Un moteur qui bâtit son terrain par champ de hauteur finit toujours par
   coincer quelqu'un quelque part : un coin entre deux éléments de décor, une
   marche qui s'est relevée sous les pieds après un effondrement, une cellule
   condamnée par un pilier posé trop près. Ce n'est pas la faute du joueur, et
   lui demander de recommencer sa partie pour ça serait grossier.

   La touche R cherche donc une cellule d'accueil autour de lui, en spirale, et
   l'y pose. Quatre règles :
     · JAMAIS dans le vide — on débloque, on ne tue pas ;
     · ON DOIT POUVOIR EN REPARTIR (v5) ;
     · le plus près possible, pour ne pas servir de téléportation gratuite ;
     · ça fait du bruit. Se dégager n'est pas discret, et il n'y a aucune raison
       que la bête n'entende rien.

   ── POURQUOI LA DEUXIÈME RÈGLE A ÉTÉ AJOUTÉE ───────────────────────────────
   Retour de test : « je suis souvent bloqué entre 2 objets et le R de
   déblocage ne change rien ». Il changeait pourtant quelque chose — il
   déplaçait bel et bien le joueur — mais sur la cellule LIBRE LA PLUS PROCHE,
   c'est-à-dire, quand on est pincé entre deux troncs, sur l'autre case du
   même pincement. On ressortait un mètre plus loin, toujours coincé, et le
   message « DÉGAGÉ » avait l'air de se moquer du monde.

   Une cellule d'accueil doit donc offrir une ISSUE : on compte, autour d'elle,
   combien des huit directions laissent réellement partir. En dessous de
   SETUP.joueur.issuesMin, ce n'est pas un dégagement, c'est un autre piège.  */

/* ═══════════════ DÉTECTION DU BLOCAGE ═══════════════
   Le joueur pousse une direction et n'avance pas : il est coincé.

   La règle est délibérément stricte, parce qu'un dégagement intempestif est
   pire que le blocage — c'est exactement ce que la touche « D » faisait, et
   c'est insupportable. Il faut TROIS conditions réunies :

     · une commande de marche est maintenue ;
     · le déplacement cumulé reste sous 40 cm ;
     · pendant 3 secondes pleines.

   Un mur qu'on longe en biais avance toujours d'un peu ; un coin où l'on est
   vraiment pris n'avance pas du tout. On tolère 40 cm pour ne pas déclencher
   sur un tremblement de caméra ou une pente qu'on remonte lentement.

   Ne se déclenche pas en l'air, sur un tablier, ni en cachette : dans ces
   trois cas, ne pas avancer est normal.                                     */

const veille = {temps: 0, x: 0, z: 0, parcouru: 0};

const DELAI_BLOCAGE = 3.0;      // secondes de commande sans avancer
const SEUIL_BLOCAGE = 0.40;     // mètres parcourus pendant ce temps

/** Appelé chaque image par le déplacement. `commande` : une touche est tenue. */
function surveillerBlocage(dt, commande){
  const exempt = !commande || !joueur.auSol || joueur.surPont
               || joueur.abrite || joueur.prone > 0;
  if(exempt){ veille.temps = 0; veille.parcouru = 0;
              veille.x = joueur.x; veille.z = joueur.z; return; }

  veille.parcouru += Math.hypot(joueur.x - veille.x, joueur.z - veille.z);
  veille.x = joueur.x; veille.z = joueur.z;
  veille.temps += dt;

  if(veille.temps < DELAI_BLOCAGE) return;

  if(veille.parcouru > SEUIL_BLOCAGE){
    // il avance : on repart pour un tour d'observation
    veille.temps = 0; veille.parcouru = 0;
    return;
  }
  veille.temps = 0; veille.parcouru = 0;
  joueur.degageAuto = debloquer();     // jeu.js lit ce champ et l'annonce
}

/**
 * Combien des huit directions laissent partir d'un point donné ?
 *
 * On sonde à un pas de marche — pas à un centimètre : sortir d'un pincement
 * demande de pouvoir vraiment s'éloigner, pas de frémir.
 */
function issues(wx, wz, gy){
  const P = SETUP.joueur.pasIssue;
  let n = 0;
  for(let k = 0; k < 8; k++){
    const a = k * 0.7854;
    if(!bloqueA(wx + Math.cos(a)*P, wz + Math.sin(a)*P, gy)) n++;
  }
  return n;
}

/**
 * Repositionne le joueur sur une cellule praticable proche D'OÙ L'ON PEUT
 * REPARTIR.
 *
 * Deux tours de spirale : le premier n'accepte qu'une cellule franchement
 * ouverte ; si le monde n'en offre aucune à portée, le second se contente de
 * la première cellule libre venue — mieux vaut un dégagement imparfait que
 * « AUCUNE ISSUE » et une partie perdue.
 *
 * @returns la distance parcourue, ou 0 si rien n'a été trouvé
 */
export function debloquer(){
  const depart = {x: joueur.x, z: joueur.z};
  const cx = w2c(joueur.x), cz = w2c(joueur.z);
  const MIN = SETUP.joueur.issuesMin;

  for(let exigeant = 1; exigeant >= 0; exigeant--){
    for(let r = 1; r <= 24; r++){
      let meilleur = null, md = 1e9;
      for(let dz = -r; dz <= r; dz++) for(let dx = -r; dx <= r; dx++){
        // uniquement le pourtour du carré de rayon r : on s'éloigne par paliers
        if(Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if(!isFree(x, z)) continue;
        const i = idx(x, z);
        if(vide[i]) continue;                       // surtout pas un gouffre
        if(ceilH[i] - floorH[i] < 1.0) continue;    // ni un boyau où l'on rentre pas
        const wx = c2w(x), wz = c2w(z);
        if(bloqueA(wx, wz, floorH[i])) continue;    // ni un coin déjà encombré
        // et surtout : une cellule d'où l'on peut REPARTIR
        if(exigeant && issues(wx, wz, floorH[i]) < MIN) continue;
        const d = (wx - joueur.x)**2 + (wz - joueur.z)**2;
        if(d < md){ md = d; meilleur = {x:wx, z:wz, y:floorH[i]}; }
      }
      if(meilleur){
        joueur.x = meilleur.x; joueur.z = meilleur.z;
        joueur.gy = meilleur.y; joueur.vy = 0;
        joueur.vx = joueur.vz = 0;
        joueur.chuteDepuis = null;
        joueur.surPont = false;
        // se dégager fait du bruit : elle a le droit de l'entendre
        emettreSon(joueur.x, joueur.z, 14, false);
        return Math.hypot(joueur.x - depart.x, joueur.z - depart.z);
      }
    }
  }
  return 0;
}

/** Es-tu tombé assez bas pour que ce soit fini ? */
export function tombeDansLeVide(){
  return joueur.gy < bornes.min - SETUP.relief.fondDuVide;
}
