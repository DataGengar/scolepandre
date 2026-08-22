/* ═══ CRÉATURES / MÈRE ═══
   L'IA de la grande. Elle est aveugle : elle ne connaît que le sol qui tremble
   et l'odeur que tu laisses.

   Reprise intégralement de la v2 — cette IA était équilibrée et testée, je n'y
   touche pas. Trois raccords v3 :

     · l'état des yeux vit ici (creature.yeux) et est mis à jour chaque image ;
     · un joueur `abrite` (dans une cachette) est INVISIBLE à sense() : ni son
       odeur ni ses pas ne l'atteignent. C'est ce qui donne sa valeur au trou ;
     · sa vitesse instantanée est mémorisée (creature.vitesse), parce que le
       tremblement de caméra en dépend : une créature immobile ne fait pas
       trembler le sol.                                                      */

import {SETUP} from '../setup.js';
import {clamp, deltaAngle} from '../noyau/math.js';
import {rnd, ri} from '../noyau/rng.js';
import {
  floorH, idx, isFree, w2c, groundAt, c2w, celluleLibre,
} from '../monde/grille.js';
import {aStar, smooth, clearLine, CLIMB} from '../monde/navigation.js';
import {ST} from './etats.js';
import {directeur} from './directeur.js';
import {nouvelEtatYeux, majYeux} from './lueurs.js';

export const creature = {
  x:0, z:0, y:0, heading:0,
  state:ST.PATROL, stateT:0,
  belief:{x:0, z:0, conf:0},
  path:null, pathIdx:0, repathT:0, target:{x:0, z:0},
  searchPts:[], chaseT:0, lostT:0, listenT:0, distract:0,
  trail:0, trailCd:0, scan:0,
  hist:[], cum:0,
  SEG:20, SP:0.58,
  vitesse:0,                 // m/s réels — pilote le tremblement de caméra
  yeux:nouvelEtatYeux(),
};

/** Appelé par jeu.js quand elle entre en poursuite (pour le cri). */
let surPoursuite = null;
export const brancherCri = fn => { surPoursuite = fn; };

export function spawnCreature(joueur, minD = 48){
  for(let k=0;k<400;k++){
    const c = celluleLibre(ri), wx = c2w(c.x), wz = c2w(c.z);
    if(Math.hypot(wx-joueur.x, wz-joueur.z) > minD){ creature.x = wx; creature.z = wz; break; }
  }
  creature.y = groundAt(creature.x, creature.z) + 0.5;
  creature.state = ST.PATROL; creature.stateT = 0; creature.path = null;
  creature.belief.conf = 0; creature.hist.length = 0; creature.cum = 0;
  creature.chaseT = 0; creature.lostT = 0; creature.trail = 0;
  creature.trailCd = 0; creature.distract = 0; creature.vitesse = 0;
  creature.yeux = nouvelEtatYeux();
}

function setState(s){
  if(creature.state === s) return;
  if(s === ST.CHASE && creature.state !== ST.CHASE && surPoursuite) surPoursuite();
  creature.state = s; creature.stateT = 0; creature.path = null;
  if(s === ST.LISTEN) creature.listenT = 1.4 + rnd()*2.1;
}

/* ─────────────── perception ─────────────── */

/**
 * @param joueur  doit porter .x .z et .abrite
 * @param sons    tableau de vibrations {x,z,r,t,lure}
 * @param odeur   tableau de marqueurs {x,z,t}
 */
function sense(dt, joueur, sons, odeur, temps){
  const c = creature, b = c.belief;
  b.conf = Math.max(0, b.conf - dt*0.21);
  c.trailCd = Math.max(0, c.trailCd - dt);
  c.distract = Math.max(0, c.distract - dt);
  const dP = Math.hypot(joueur.x - c.x, joueur.z - c.z);

  /* DANS UNE CACHETTE, TU N'EXISTES PAS. Ni contact, ni odeur, ni pas. Elle
     continue de patrouiller normalement — elle ne t'a pas perdu, elle ne t'a
     jamais eu. C'est ce qui fait du trou un vrai refuge. */
  if(joueur.abrite){
    if(c.state === ST.CHASE && c.stateT > 1.2){
      directeur.onPerdu(joueur); setState(ST.LISTEN);
    }
    return dP;
  }

  if(dP < 1.7){
    b.x = joueur.x; b.z = joueur.z; b.conf = 1; c.distract = 0;
    setState(ST.CHASE); return dP;
  }

  /* LE LEURRE PASSE AVANT TOUT.
     En poursuite sa certitude est à 100 % : un impact ne pouvait donc jamais
     la battre, et l'objet ne servait à rien au seul moment où on en a besoin.
     Ici l'impact écrase la croyance et ouvre une fenêtre de fixation pendant
     laquelle tes propres pas ne l'intéressent plus. */
  for(const s of sons){
    if(s.t > 0.05 || !s.lure) continue;
    const d = Math.hypot(s.x - c.x, s.z - c.z);
    if(d > s.r * (c.state === ST.LISTEN ? 2 : 1)) continue;
    b.x = s.x; b.z = s.z; b.conf = 0.85; c.distract = 4.5; c.trail = 0;
    setState(ST.INVEST);
  }

  // vibrations — à l'arrêt elle entend deux fois mieux
  const gain = c.state === ST.LISTEN ? 2 : 1;
  if(c.distract <= 0) for(const s of sons){
    if(s.t > 0.05 || s.lure) continue;
    const d = Math.hypot(s.x - c.x, s.z - c.z), r = s.r * gain;
    if(d > r) continue;
    const conf = clamp(1 - d/r, 0, 1);
    if(conf > b.conf){ b.x = s.x; b.z = s.z; b.conf = conf; }
    if(c.state !== ST.RETREAT){
      if(conf > 0.74 && d < 12) setState(ST.CHASE); else setState(ST.INVEST);
    }
  }

  /* PISTE ODORANTE — trois freins. La certitude plafonne à 0,26 (jamais de
     poursuite déclenchée par l'odeur seule), le rayon de lecture est court, et
     surtout elle SE FATIGUE : au bout de `endurancePiste` secondes elle perd
     le fil et ne peut pas en reprendre un avant `reposPiste`. */
  if((c.state === ST.PATROL || c.state === ST.SEARCH) && b.conf < 0.26 && c.trailCd <= 0){
    let bi = -1, bt = -1;
    for(let i=0;i<odeur.length;i++){
      const s = odeur[i];
      if(Math.hypot(s.x - c.x, s.z - c.z) < 1.8 && s.t > bt){ bt = s.t; bi = i; }
    }
    if(bi >= 0){
      const j = Math.min(bi + 5, odeur.length - 1);
      b.x = odeur[j].x; b.z = odeur[j].z;
      b.conf = Math.min(0.26, b.conf + 0.18);
      setState(j >= odeur.length - 1 ? ST.SEARCH : ST.INVEST);
    }
  }
  if(c.state === ST.INVEST && b.conf <= 0.4){
    c.trail += dt;
    if(c.trail > SETUP.traces.endurancePiste){
      c.trail = 0; c.trailCd = SETUP.traces.reposPiste; b.conf = 0;
      setState(ST.LISTEN);
    }
  } else c.trail = Math.max(0, c.trail - dt*0.5);

  return dP;
}

/* ─────────────── déplacement ─────────────── */

function requestPath(tx, tz){
  const cells = aStar(w2c(creature.x), w2c(creature.z), w2c(tx), w2c(tz));
  creature.path = cells ? smooth(cells) : null;
  creature.pathIdx = 1;
  creature.target = {x:tx, z:tz};
}

function follow(dt, speed, turn){
  const c = creature, p = c.path;
  let dx, dz;
  const tdx = c.target.x - c.x, tdz = c.target.z - c.z, td = Math.hypot(tdx, tdz);
  if(td < 7 && clearLine(c.x, c.z, c.target.x, c.target.z, 0.5)){
    if(td < 0.35) return false;
    dx = tdx; dz = tdz;
  } else {
    if(!p || c.pathIdx >= p.length) return false;
    let n = p[c.pathIdx]; dx = n.x - c.x; dz = n.z - c.z;
    if(Math.hypot(dx,dz) < 0.55){
      c.pathIdx++;
      if(c.pathIdx >= p.length) return false;
      n = p[c.pathIdx]; dx = n.x - c.x; dz = n.z - c.z;
    }
  }
  const want = Math.atan2(-dx, -dz);
  const diff = deltaAngle(want - c.heading);
  c.heading += clamp(diff, -turn*dt, turn*dt);
  const al = Math.max(0.25, Math.cos(clamp(diff, -1.6, 1.6)));
  const fx = -Math.sin(c.heading), fz = -Math.cos(c.heading);
  const nx = c.x + fx*speed*al*dt, nz = c.z + fz*speed*al*dt;
  const cx = w2c(nx), cz = w2c(nz);
  if(isFree(cx,cz) && Math.abs(floorH[idx(cx,cz)] - groundAt(c.x,c.z)) <= CLIMB){
    c.x = nx; c.z = nz;
  }
  return true;
}

/* ─────────────── boucle ─────────────── */

export function updateCreature(dt, joueur, sons, odeur, temps){
  const c = creature;
  const ax = c.x, az = c.z;
  c.stateT += dt; c.repathT -= dt;
  const dP = sense(dt, joueur, sons, odeur, temps);
  const b = c.belief;
  let speed = 2.4, turn = 2.2, dest = null, every = 0.9;

  switch(c.state){
    case ST.PATROL:
      speed = 2.4; turn = 2.0;
      if(!c.path || c.pathIdx >= c.path.length || c.stateT > 9){
        const a = rnd()*6.283, r = rnd()*directeur.zone.r;
        dest = {x: directeur.zone.x + Math.cos(a)*r, z: directeur.zone.z + Math.sin(a)*r};
        c.stateT = 0;
        if(rnd() < 0.25){ setState(ST.LISTEN); break; }
      }
      break;

    case ST.INVEST:
      speed = 3.4; turn = 2.6; every = 0.6; dest = {x:b.x, z:b.z};
      if(Math.hypot(b.x-c.x, b.z-c.z) < 2.0 || (b.conf < 0.12 && c.stateT > 4)){
        c.searchPts = [];
        for(let i=0;i<5;i++){
          const a = rnd()*6.283, r = 4 + rnd()*9;
          c.searchPts.push({x: b.x + Math.cos(a)*r, z: b.z + Math.sin(a)*r});
        }
        setState(ST.SEARCH);
      }
      break;

    case ST.SEARCH:
      speed = 2.9; turn = 2.4; every = 0.7;
      if(c.searchPts.length === 0 || c.stateT > 16){
        c.searchPts.length = 0; setState(ST.LISTEN); break;
      }
      {
        const p = c.searchPts[0];
        if(Math.hypot(p.x-c.x, p.z-c.z) < 2.2){
          c.searchPts.shift(); c.path = null;
          if(rnd() < 0.45) setState(ST.LISTEN);
        } else dest = p;
      }
      break;

    /* ÉCOUTE — elle s'arrête net et ne bouge plus. Une bête qui s'immobilise
       lit comme une bête qui réfléchit ; c'est plus inquiétant qu'une bête qui
       court. Et son ouïe double pendant ce temps : rester figé n'est pas
       gratuit non plus. Ses yeux cessent de pulser : ils deviennent fixes. */
    case ST.LISTEN:
      c.listenT -= dt; c.scan = Math.sin(c.stateT*1.6)*0.9;
      if(c.listenT <= 0) setState(c.searchPts.length ? ST.SEARCH : ST.PATROL);
      break;

    case ST.CHASE:
      speed = SETUP.creature.vitesseTraque; turn = 4.4; every = 0.28;
      c.chaseT += dt;
      if(c.distract <= 0 && !joueur.abrite && (b.conf > 0.25 || dP < 2.5)){
        b.x = joueur.x; b.z = joueur.z; c.lostT = 0;
        dest = {x: joueur.x, z: joueur.z};
      } else {
        c.lostT += dt; dest = {x:b.x, z:b.z};
        if(c.lostT > 2.0){
          directeur.onPerdu(joueur); c.searchPts = [];
          for(let i=0;i<6;i++){
            const a = rnd()*6.283, r = 5 + rnd()*10;
            c.searchPts.push({x: b.x + Math.cos(a)*r, z: b.z + Math.sin(a)*r});
          }
          setState(ST.LISTEN);
        }
      }
      if(c.chaseT > 15){ setState(ST.RETREAT); c.chaseT = 0; directeur.onPerdu(joueur); }
      break;

    case ST.RETREAT:
      speed = 3.2; turn = 2.0; every = 1.2;
      if(!c.path || c.pathIdx >= c.path.length)
        dest = {x: directeur.zone.x, z: directeur.zone.z};
      if(c.stateT > 7) setState(ST.PATROL);
      break;
  }
  if(c.state !== ST.CHASE) c.chaseT = Math.max(0, c.chaseT - dt);

  if(dest && (c.repathT <= 0 || !c.path ||
              Math.hypot(dest.x - c.target.x, dest.z - c.target.z) > 1.6)){
    requestPath(dest.x, dest.z); c.repathT = every;
  }
  if(c.state !== ST.LISTEN){
    const moved = follow(dt, speed, turn);
    if(!moved && c.state === ST.PATROL) c.path = null;
  }

  // trace du corps : c'est elle qui donne sa forme serpentine au maillage
  const last = c.hist[c.hist.length-1];
  const step = last ? Math.hypot(c.x-last.x, c.z-last.z) : 999;
  if(step > 0.07){
    c.cum += step;
    c.hist.push({x:c.x, y:c.y, z:c.z, cum:c.cum});
    const mb = c.SEG * c.SP + 2;
    while(c.hist.length > 2 && c.cum - c.hist[0].cum > mb) c.hist.shift();
  }

  const gy = groundAt(c.x, c.z) + 0.5;
  c.y = (c.y + (gy - c.y) * (1 - Math.exp(-10*dt))) + Math.sin(temps*7)*0.012;

  // vitesse réelle : lissée, sinon le tremblement de caméra saccade
  const inst = Math.hypot(c.x-ax, c.z-az) / Math.max(1e-4, dt);
  c.vitesse += (inst - c.vitesse) * (1 - Math.exp(-6*dt));

  majYeux(c.yeux, c.state, dt, temps);
  return dP;
}

/** Un point du corps, `back` mètres derrière la tête le long de la trace. */
export function sampleBody(back){
  const h = creature.hist;
  if(h.length < 2) return {x:creature.x, y:creature.y, z:creature.z};
  const tg = creature.cum - back;
  if(tg <= h[0].cum) return h[0];
  for(let i=h.length-1; i>0; i--){
    if(h[i-1].cum <= tg && tg <= h[i].cum){
      const t = (tg - h[i-1].cum) / Math.max(1e-4, h[i].cum - h[i-1].cum);
      return {
        x: h[i-1].x + (h[i].x - h[i-1].x)*t,
        y: h[i-1].y + (h[i].y - h[i-1].y)*t,
        z: h[i-1].z + (h[i].z - h[i-1].z)*t,
      };
    }
  }
  return h[h.length-1];
}
