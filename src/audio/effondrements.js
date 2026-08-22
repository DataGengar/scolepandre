/* ═══ AUDIO / EFFONDREMENTS ═══
   L'événement dynamique du monde. Toutes les 60 à 180 s, quelque chose cède.

   ── DÉROULÉ ────────────────────────────────────────────────────────────────
     0.0 s  grondement sub qui monte           (on le sent avant de l'entendre)
     2.0 s  fracas : rafale de débris filtrés
     2.0 s  la caméra tremble fort pendant 3 s
     2.0 s  une vibration de rayon 60 est émise dans le monde
            → LA CRÉATURE ACCOURT. C'est le vrai danger de l'effondrement :
              pas la roche, mais ce qu'elle attire.
     2.0 s  le terrain se soulève localement et se couvre de gravats

   Si l'effondrement se produit à moins de 15 m, le joueur peut tomber
   (joueur/chute.js décide, à partir du tremblement).

   Ce module ne connaît ni le joueur ni la créature : il annonce l'événement
   par un callback et jeu.js s'occupe des conséquences. C'est ce qui permet de
   le tester isolément.                                                      */

import {SETUP} from '../setup.js';
import {A, bruitBrunBuffer, bruitBuffer, panner, placer} from './contexte.js';

const E = {
  pan:null, prochain:0, brun:null, rose:null,
};

export function construireEffondrements(){
  if(!A.ctx || E.pan) return;
  E.pan = panner(220, 0.5);
  E.brun = bruitBrunBuffer(A.ctx, 6);
  E.rose = bruitBuffer(A.ctx, 4);
  E.prochain = 25 + Math.random()*40;      // le premier arrive assez tôt
}

/** Le grondement qui monte : sub pur, 2 s d'attaque. */
function grondement(dureeMontee){
  const ctx = A.ctx, t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'sine';
  o.frequency.setValueAtTime(19, t);
  o.frequency.linearRampToValueAtTime(31, t + dureeMontee);
  o.frequency.exponentialRampToValueAtTime(14, t + dureeMontee + 4);
  f.type = 'lowpass'; f.frequency.value = 90; f.Q.value = 0.9;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.42, t + dureeMontee);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dureeMontee + 5);
  o.connect(f).connect(g).connect(E.pan);
  o.start(t); o.stop(t + dureeMontee + 5.5);
  o.onended = () => { try{ g.disconnect(); }catch(e){} };
}

/** Le fracas : bruit brun large + une pluie d'impacts secs. */
function fracas(){
  const ctx = A.ctx, t = ctx.currentTime;

  const s = ctx.createBufferSource(); s.buffer = E.brun; s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.setValueAtTime(1800, t);
  f.frequency.exponentialRampToValueAtTime(160, t + 3.2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.34, t + 0.10);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
  s.connect(f).connect(g).connect(E.pan);
  s.start(t); s.stop(t + 3.6);
  s.onended = () => { try{ g.disconnect(); }catch(e){} };

  // les blocs qui rebondissent : 14 à 26 impacts secs étalés sur 2,5 s
  const n = 14 + Math.floor(Math.random()*12);
  for(let k=0;k<n;k++){
    const dt = Math.pow(Math.random(), 0.6) * 2.5;
    const ti = t + dt;
    const o = ctx.createOscillator(), gi = ctx.createGain(), fi = ctx.createBiquadFilter();
    o.type = 'square';
    o.frequency.setValueAtTime(70 + Math.random()*180, ti);
    fi.type = 'lowpass'; fi.frequency.value = 480; fi.Q.value = 1.4;
    const amp = 0.10 * (1 - dt/3);
    gi.gain.setValueAtTime(0.0001, ti);
    gi.gain.exponentialRampToValueAtTime(Math.max(0.002, amp), ti + 0.004);
    gi.gain.exponentialRampToValueAtTime(0.0001, ti + 0.16);
    o.connect(fi).connect(gi).connect(E.pan);
    o.start(ti); o.stop(ti + 0.2);
    o.onended = () => { try{ gi.disconnect(); }catch(e){} };
  }
}

/**
 * Déclenche un effondrement à une position donnée dans le repère de l'auditeur.
 * @param lx,ly,lz  position relative à l'auditeur
 */
export function declencher(lx, ly, lz){
  if(!A.ctx || !E.pan) return;
  placer(E.pan, lx, ly, lz);
  const montee = 2.0;
  grondement(montee);
  setTimeout(() => { try{ fracas(); }catch(e){} }, montee * 1000);
  return montee;
}

/**
 * Appelé une fois par image. Quand le compte à rebours arrive à zéro, appelle
 * `surEvenement(distance, angle)` — c'est jeu.js qui choisit où, secoue la
 * caméra, émet la vibration et abîme le terrain.
 */
export function majEffondrements(dt, surEvenement){
  if(!A.ctx || !E.pan) return;
  E.prochain -= dt;
  if(E.prochain > 0) return;
  const [a,b] = SETUP.audio.effondrement.intervalle;
  E.prochain = a + Math.random()*(b-a);
  if(surEvenement) surEvenement();
}
