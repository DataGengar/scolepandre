/* ═══ JOUEUR / JOUEUR ═══
   État, déplacement, collision, traces.

   Collision : un mur, un élément solide, ou une marche trop haute. Descendre
   est toujours permis — on tombe. C'est la moitié basse de l'asymétrie
   verticale : elle grimpe 2,90 m, toi 1,25 m.

   Le vide NE BLOQUE PAS : on marche dans un gouffre et on y tombe. C'est
   volontaire, et c'est ce qui rend les précipices dangereux.               */

import {SETUP} from '../setup.js';
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
  joueur.prone = 0; joueur.shake = 0; joueur.chuteDepuis = null;
  joueur.surPont = false;
  odeur.length = 0; sons.length = 0;
}

/* ═══════════════ LES DEUX ÉTAGES ═══════════════
   Le champ de hauteur ne connaît qu'une altitude par colonne. `pont[i]` marque
   un tablier et `pontH[i]` sa cote : on passe DESSOUS par défaut, et DESSUS
   quand `joueur.surPont` est vrai.

   On monte et on descend par les ÉCHELLES, posées aux deux bouts de chaque
   tronçon par monde/ponts.js. La touche E est contextuelle : une cachette si
   tu es devant, sinon une échelle si tu es dessus.

   Sortir du tablier par le côté ne bloque pas : tu quittes l'étage et tu
   tombes. C'est un pont suspendu, pas un couloir.                          */

/** Cote du sol sur lequel le joueur se tient, étage courant compris. */
export function coteSol(wx, wz){
  const x = w2c(wx), z = w2c(wz);
  if(x<0 || z<0 || x>=GW || z>=GH) return -99999;
  const i = idx(x,z);
  if(joueur.surPont && pont[i]) return pontH[i];
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

/* ─────────────── collision ─────────────── */

let collParCell = new Map();

export function indexerColliders(){
  collParCell = new Map();
  for(const co of colliders){
    const cx = w2c(co.x), cz = w2c(co.z);
    for(let dz=-1;dz<=1;dz++) for(let dx=-1;dx<=1;dx++){
      const k = idx(clamp(cx+dx,0,GW-1), clamp(cz+dz,0,GH-1));
      if(!collParCell.has(k)) collParCell.set(k, []);
      collParCell.get(k).push(co);
    }
  }
}

function heurteElement(nx, nz){
  const k = idx(clamp(w2c(nx),0,GW-1), clamp(w2c(nz),0,GH-1));
  const lot = collParCell.get(k);
  if(!lot) return false;
  const R = SETUP.joueur.rayon;
  for(const co of lot){
    const dx = nx-co.x, dz = nz-co.z, rr = co.r + R;
    if(dx*dx + dz*dz < rr*rr) return true;
  }
  return false;
}

export function bloqueA(nx, nz, depuis){
  /* Sur un tablier, on est au-dessus de tout : ni le relief ni les éléments du
     sol ne peuvent nous arrêter. Seul le bord du tablier compte, et il ne
     bloque pas — il laisse tomber. */
  if(joueur.surPont) return false;

  if(heurteElement(nx,nz)) return true;
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

/* ─────────────── déplacement ─────────────── */

/**
 * @param mult   multiplicateur de vitesse venant du froid
 * @param hooks  {pas(force), impactSol(vitesse)}
 */
export function updateJoueur(dt, mult, hooks){
  const J = SETUP.joueur;
  const H = hooks || {};

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
  if(!bloqueA(nx, joueur.z, joueur.gy)) joueur.x = nx; else joueur.vx = 0;
  if(!bloqueA(joueur.x, nz, joueur.gy)) joueur.z = nz; else joueur.vz = 0;

  appliquerGravite(dt, H);

  const mv = Math.hypot(joueur.vx, joueur.vz);
  joueur.vitesse = mv;
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
  if(joueur.surPont){
    const i = idx(clamp(w2c(joueur.x),0,GW-1), clamp(w2c(joueur.z),0,GH-1));
    if(!pont[i]) joueur.surPont = false;
  }
  const gt = coteSol(joueur.x, joueur.z);

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
  } else {
    joueur.gy = lerp(joueur.gy, gt, 1 - Math.exp(-16*dt));
    joueur.vy = 0; joueur.chuteDepuis = null;
  }
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

/** Es-tu tombé assez bas pour que ce soit fini ? */
export function tombeDansLeVide(){
  return joueur.gy < bornes.min - SETUP.relief.fondDuVide;
}
