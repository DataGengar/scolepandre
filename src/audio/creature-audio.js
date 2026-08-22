/* ═══ AUDIO / CRÉATURE ═══
   Le bus de la créature, séparé de la nappe et spatialisé en HRTF sur sa
   position réelle.

   ── POURQUOI UN BUS SÉPARÉ ────────────────────────────────────────────────
   La règle des nappes interdit de transformer un drone en un autre. Faire
   passer la menace par la nappe aurait obligé à déformer le drone à chaque
   poursuite, et de toute façon un fondu de 3,5 s ne suit pas une poursuite.

   ── PORTÉE (v3) ───────────────────────────────────────────────────────────
   En v2 elle devenait inaudible à 40 m et la menace s'éteignait à 34 m : on
   la découvrait à dix mètres, ce qui ne laissait pas le temps d'avoir peur.
   Ici :
     · panner maxDistance 110 m, rolloff 0.75
     · courbe de menace sur 95 m
     · un SUB D'INFRASONS jusqu'à 150 m — on la sent avant de l'entendre.
   Les jeunes passent de 22 à 55 m.

   ── LES VOIX ──────────────────────────────────────────────────────────────
     menace     deux sinus désaccordés qui battent + un growl filtré
     infra      un sub très lent, presque sous le seuil d'audition
     frottement bruit passe-bande : la chitine sur la roche
     clics      train d'impulsions, cadence proportionnelle à la proximité
     cri        glissando descendant, joué au passage en poursuite            */

import {SETUP} from '../setup.js';
import {clamp, lerp} from '../noyau/math.js';
import {A, bruitBuffer, panner, placer, ping} from './contexte.js';

const CR = {
  pan:null, filt:null, gain:null, noise:null,
  menace:null, infra:null,
  jPan:null, jMenace:null,
  prochainClic:0,
};

/** Deux sinus qui battent + un growl. La brique de la menace. */
function construireMenace(dest, base){
  const ctx = A.ctx;
  const g = ctx.createGain(); g.gain.value = 0;
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
  o1.type = 'sine'; o2.type = 'sine';
  o1.frequency.value = base; o2.frequency.value = base * 1.011;
  const gr = ctx.createBufferSource(); gr.buffer = bruitBuffer(ctx, 4); gr.loop = true;
  const fg = ctx.createBiquadFilter();
  fg.type = 'lowpass'; fg.frequency.value = 90; fg.Q.value = 6;
  const gg = ctx.createGain(); gg.gain.value = 0;
  o1.connect(g); o2.connect(g); g.connect(dest);
  gr.connect(fg).connect(gg).connect(dest);
  o1.start(); o2.start(); gr.start();
  return {g, o1, o2, gg, fg, base};
}

export function construireCreatureAudio(){
  if(!A.ctx || CR.pan) return;
  const ctx = A.ctx;
  const S = SETUP.audio;

  CR.pan = panner(S.creatureDistanceMax, S.creatureRolloff);

  const src = ctx.createBufferSource();
  src.buffer = bruitBuffer(ctx, 4); src.loop = true;
  CR.filt = ctx.createBiquadFilter();
  CR.filt.type = 'bandpass'; CR.filt.frequency.value = 260; CR.filt.Q.value = 1.1;
  CR.gain = ctx.createGain(); CR.gain.gain.value = 0;
  src.connect(CR.filt).connect(CR.gain).connect(CR.pan);
  src.start(); CR.noise = src;

  CR.menace = construireMenace(CR.pan, 30);

  /* L'INFRA : il ne passe PAS par le panner. Un son de 14 Hz n'est pas
     localisable et l'atténuation par distance le tuerait. Il va droit au
     master, gain piloté à la main sur 150 m. C'est le « je la sens ». */
  const oi = ctx.createOscillator(), gi = ctx.createGain();
  oi.type = 'sine'; oi.frequency.value = 14.5;
  gi.gain.value = 0;
  oi.connect(gi).connect(A.master);
  oi.start();
  CR.infra = {o:oi, g:gi};

  // bus des jeunes : leur propre panner, sur le plus proche
  CR.jPan = panner(S.jeunesPortee * 1.4, 1.0);
  CR.jMenace = construireMenace(CR.jPan, 58);
}

/**
 * La menace de la mère. `dist` en mètres, `chasse` = elle est en poursuite.
 * Plus elle est près, plus c'est grave et plus ça pousse : le son se rapproche
 * et s'enfonce en même temps.
 */
export function menace(dist, chasse){
  if(!A.ctx || !CR.menace) return;
  const S = SETUP.audio;
  const t = A.ctx.currentTime;
  const n = clamp(1 - (dist - 1.5) / S.creaturePorteeMenace, 0, 1);
  const n3 = n*n*n;

  CR.menace.o1.frequency.setTargetAtTime(lerp(38, 17, n), t, 0.35);
  CR.menace.o2.frequency.setTargetAtTime(lerp(38, 17, n)*1.011, t, 0.35);
  CR.menace.g.gain.setTargetAtTime(n3 * (chasse ? 0.58 : 0.34), t, 0.18);
  CR.menace.fg.frequency.setTargetAtTime(lerp(70, 220, n), t, 0.30);
  CR.menace.gg.gain.setTargetAtTime(n3 * (chasse ? 0.34 : 0.15), t, 0.22);

  // l'infra : audible bien plus loin, courbe très douce
  const ni = clamp(1 - dist / S.creaturePorteeInfra, 0, 1);
  CR.infra.g.gain.setTargetAtTime(ni*ni * (chasse ? 0.26 : 0.15), t, 0.9);
  CR.infra.o.frequency.setTargetAtTime(lerp(17, 11, ni), t, 1.4);
}

/**
 * Frottement + clics, posés sur sa position dans le repère de l'auditeur.
 * @param lx,ly,lz  position relative (l'auditeur regarde vers −Z)
 */
export function creature(lx, ly, lz, dist, chasse, dt){
  if(!A.ctx || !CR.pan) return;
  placer(CR.pan, lx, ly, lz);
  const S = SETUP.audio;
  const near = clamp(1 - (dist - 2) / (S.creatureDistanceMax * 0.85), 0, 1);

  CR.gain.gain.value = near*near * (chasse ? 0.36 : 0.19);
  CR.filt.frequency.value = lerp(150, 1250, near);

  const cadence = lerp(0.9, 7.5, near) * (chasse ? 1.7 : 1);
  CR.prochainClic -= dt;
  if(CR.prochainClic <= 0 && near > 0.03){
    CR.prochainClic = 1/cadence * (0.7 + Math.random()*0.6);
    ping(1500 + Math.random()*900, 0.030, 0.034*near, 'square', CR.pan);
  }
}

/** Le cri : glissando descendant. Joué à l'entrée en poursuite. */
export function cri(){
  if(!A.ctx) return;
  const ctx = A.ctx, t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(680, t);
  o.frequency.exponentialRampToValueAtTime(96, t + 0.75);
  f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 3.5;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  o.connect(f).connect(g).connect(CR.pan || A.bus);
  o.start(t); o.stop(t + 1.0);
  o.onended = () => { try{ g.disconnect(); }catch(e){} };

  // une seconde voix une octave plus bas, décalée : le cri a un corps
  const o2 = ctx.createOscillator(), g2 = ctx.createGain();
  o2.type = 'sawtooth';
  o2.frequency.setValueAtTime(340, t + 0.04);
  o2.frequency.exponentialRampToValueAtTime(48, t + 0.85);
  g2.gain.setValueAtTime(0.0001, t + 0.04);
  g2.gain.exponentialRampToValueAtTime(0.15, t + 0.09);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  o2.connect(g2).connect(CR.pan || A.bus);
  o2.start(t + 0.04); o2.stop(t + 1.2);
  o2.onended = () => { try{ g2.disconnect(); }catch(e){} };
}

/** Le jeune le plus proche pilote ce bus. Même chaîne, une octave plus haut. */
export function jeunes(lx, ly, lz, dist){
  if(!A.ctx || !CR.jMenace) return;
  placer(CR.jPan, lx, ly, lz);
  const t = A.ctx.currentTime;
  const n = clamp(1 - (dist - 1.5) / SETUP.audio.jeunesPortee, 0, 1);
  const n2 = n*n;
  CR.jMenace.o1.frequency.setTargetAtTime(lerp(74, 40, n), t, 0.30);
  CR.jMenace.o2.frequency.setTargetAtTime(lerp(74, 40, n)*1.014, t, 0.30);
  CR.jMenace.g.gain.setTargetAtTime(n2 * 0.19, t, 0.20);
  CR.jMenace.fg.frequency.setTargetAtTime(lerp(110, 330, n), t, 0.25);
  CR.jMenace.gg.gain.setTargetAtTime(n2 * 0.12, t, 0.22);
}

/** Un stridulement bref : les jeunes se répondent entre eux. */
export function stridulation(){
  if(!A.ctx || !CR.jPan) return;
  const n = 3 + Math.floor(Math.random()*4);
  for(let k=0;k<n;k++)
    setTimeout(() => ping(2200 + Math.random()*1400, 0.022, 0.028, 'square', CR.jPan),
               k * (28 + Math.random()*26));
}
