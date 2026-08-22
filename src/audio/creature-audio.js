/* ═══ AUDIO / CRÉATURE ═══
   Le bus de la créature, séparé de la nappe et spatialisé en HRTF sur sa
   position réelle.

   ── LE BUG DE LA v3.0 : ON NE L'ENTENDAIT PAS DU TOUT ──────────────────────
   Retour de test : « on n'entend PAS DU TOUT le bruit des scolopandres » et
   « où est le son terrifiant quand un scolopandre est pas loin ? ».
   Mesuré, c'était structurel : LA DISTANCE ÉTAIT APPLIQUÉE DEUX FOIS.

     · le PannerNode atténuait (refDistance 2, rolloff 0.75) ;
     · une courbe explicite en n³ atténuait encore par-dessus.

   Produit des deux, il restait 6 % du signal à 10 m, 1 % à 30 m, et 0,01 % à
   80 m. Autrement dit : jamais rien.

   Correction : le panner ne sert plus qu'à donner la DIRECTION — refDistance
   très grand, rolloff quasi nul — et c'est la courbe qui porte seule
   l'éloignement, avec un exposant réglable (SETUP.audio.creatureCourbe).

   ── LES CINQ VOIX ──────────────────────────────────────────────────────────
     infra       14 Hz, hors panner, jusqu'à 170 m. On la SENT.
     menace      deux sinus désaccordés qui battent + un growl filtré
     frottement  bruit passe-bande : la chitine sur la roche
     clics       train d'impulsions, cadence proportionnelle à la proximité
     panique     sous 14 m : une couche stridente qui monte, un cœur qui cogne
                 et un souffle de mandibules. C'est le « elle est SUR toi ».
     cri         glissando descendant, joué au passage en poursuite            */

import {SETUP} from '../setup.js';
import {clamp, lerp} from '../noyau/math.js';
import {A, bruitBuffer, panner, placer, ping} from './contexte.js';

const CR = {
  pan:null, filt:null, gain:null, noise:null,
  menace:null, infra:null,
  panique:null, prochainCoeur:0,
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

/** La couche de panique : stridence + souffle, muette au-delà de quelques mètres. */
function construirePanique(dest){
  const ctx = A.ctx;
  // stridence : une dent de scie très filtrée, dissonante
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 320;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 7;
  const g = ctx.createGain(); g.gain.value = 0;
  o.connect(f).connect(g).connect(dest);
  o.start();
  // souffle de mandibules : bruit passe-haut, très proche
  const s = ctx.createBufferSource(); s.buffer = bruitBuffer(ctx, 3); s.loop = true;
  const fh = ctx.createBiquadFilter();
  fh.type = 'highpass'; fh.frequency.value = 1800; fh.Q.value = 0.8;
  const gs = ctx.createGain(); gs.gain.value = 0;
  s.connect(fh).connect(gs).connect(dest);
  s.start();
  return {o, f, g, gs};
}

export function construireCreatureAudio(){
  if(!A.ctx || CR.pan) return;
  const ctx = A.ctx;
  const S = SETUP.audio;

  CR.pan = panner(S.creatureDistanceMax, S.creatureRolloff, S.creatureRefDistance);

  const src = ctx.createBufferSource();
  src.buffer = bruitBuffer(ctx, 4); src.loop = true;
  CR.filt = ctx.createBiquadFilter();
  CR.filt.type = 'bandpass'; CR.filt.frequency.value = 260; CR.filt.Q.value = 1.1;
  CR.gain = ctx.createGain(); CR.gain.gain.value = 0;
  src.connect(CR.filt).connect(CR.gain).connect(CR.pan);
  src.start(); CR.noise = src;

  CR.menace = construireMenace(CR.pan, 30);
  CR.panique = construirePanique(CR.pan);

  /* L'INFRA ne passe PAS par le panner : un son de 14 Hz n'est pas localisable
     et l'atténuation par distance le tuerait. Il va droit au master, gain
     piloté à la main sur 170 m. C'est le « je la sens quelque part ». */
  const oi = ctx.createOscillator(), gi = ctx.createGain();
  oi.type = 'sine'; oi.frequency.value = 14.5;
  gi.gain.value = 0;
  oi.connect(gi).connect(A.master);
  oi.start();
  CR.infra = {o:oi, g:gi};

  // bus des jeunes : leur propre panner, sur le plus proche
  CR.jPan = panner(S.creatureDistanceMax, S.creatureRolloff, S.jeunesRefDistance);
  CR.jMenace = construireMenace(CR.jPan, 58);
}

/** Proximité normalisée 0..1, courbe réglable. C'est LA fonction de distance. */
function proximite(dist, portee){
  const n = clamp(1 - dist/portee, 0, 1);
  return Math.pow(n, SETUP.audio.creatureCourbe);
}

/**
 * La menace de la mère. Plus elle est près, plus c'est grave et plus ça pousse :
 * le son se rapproche et s'enfonce en même temps.
 */
export function menace(dist, chasse){
  if(!A.ctx || !CR.menace) return;
  const S = SETUP.audio;
  const t = A.ctx.currentTime;
  const n = proximite(dist, S.creaturePorteeMenace);
  const gainBase = chasse ? S.creatureGainChasse : S.creatureGain;

  CR.menace.o1.frequency.setTargetAtTime(lerp(40, 16, n), t, 0.35);
  CR.menace.o2.frequency.setTargetAtTime(lerp(40, 16, n)*1.011, t, 0.35);
  CR.menace.g.gain.setTargetAtTime(n * gainBase, t, 0.18);
  CR.menace.fg.frequency.setTargetAtTime(lerp(70, 240, n), t, 0.30);
  CR.menace.gg.gain.setTargetAtTime(n * gainBase * 0.55, t, 0.22);

  // l'infra : audible bien plus loin, courbe très douce
  const ni = clamp(1 - dist / S.creaturePorteeInfra, 0, 1);
  CR.infra.g.gain.setTargetAtTime(ni*ni * (chasse ? 0.30 : 0.18), t, 0.9);
  CR.infra.o.frequency.setTargetAtTime(lerp(17, 11, ni), t, 1.4);
}

/**
 * Frottement, clics et PANIQUE, posés sur sa position dans le repère de
 * l'auditeur (qui regarde vers −Z).
 */
export function creature(lx, ly, lz, dist, chasse, dt){
  if(!A.ctx || !CR.pan) return;
  placer(CR.pan, lx, ly, lz);
  const S = SETUP.audio;
  const t = A.ctx.currentTime;
  const near = proximite(dist, S.creaturePorteeMenace);

  CR.gain.gain.setTargetAtTime(near * (chasse ? 0.52 : 0.30), t, 0.15);
  CR.filt.frequency.setTargetAtTime(lerp(150, 1250, near), t, 0.2);

  const cadence = lerp(0.9, 9.0, near) * (chasse ? 1.7 : 1);
  CR.prochainClic -= dt;
  if(CR.prochainClic <= 0 && near > 0.02){
    CR.prochainClic = 1/cadence * (0.7 + Math.random()*0.6);
    ping(1500 + Math.random()*900, 0.030, 0.055*near, 'square', CR.pan);
  }

  /* ═══ ELLE EST SUR TOI ═══
     Sous SETUP.audio.creaturePorteePanique, une couche entièrement séparée
     s'ouvre : stridence dissonante qui monte en hauteur à mesure qu'elle
     approche, souffle de mandibules, et un cœur qui cogne. C'est le signal
     que la v3.0 n'avait pas du tout — il ne se passait rien de particulier
     quand elle arrivait à trois mètres. */
  const p = clamp(1 - dist / S.creaturePorteePanique, 0, 1);
  const p2 = p * p;
  if(CR.panique){
    CR.panique.g.gain.setTargetAtTime(p2 * 0.24, t, 0.10);
    CR.panique.o.frequency.setTargetAtTime(lerp(180, 560, p), t, 0.12);
    CR.panique.f.frequency.setTargetAtTime(lerp(600, 2100, p), t, 0.12);
    CR.panique.gs.gain.setTargetAtTime(p2 * 0.16, t, 0.10);
  }
  if(p > 0.05){
    CR.prochainCoeur -= dt;
    if(CR.prochainCoeur <= 0){
      CR.prochainCoeur = lerp(0.95, 0.42, p);
      ping(52, 0.14, 0.20*p, 'sine');
      setTimeout(() => ping(44, 0.17, 0.14*p, 'sine'), 175);
    }
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
  g.gain.exponentialRampToValueAtTime(0.34, t + 0.03);
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
  g2.gain.exponentialRampToValueAtTime(0.24, t + 0.09);
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
  const n = proximite(dist, SETUP.audio.jeunesPortee);
  CR.jMenace.o1.frequency.setTargetAtTime(lerp(78, 42, n), t, 0.30);
  CR.jMenace.o2.frequency.setTargetAtTime(lerp(78, 42, n)*1.014, t, 0.30);
  CR.jMenace.g.gain.setTargetAtTime(n * 0.34, t, 0.20);
  CR.jMenace.fg.frequency.setTargetAtTime(lerp(110, 360, n), t, 0.25);
  CR.jMenace.gg.gain.setTargetAtTime(n * 0.22, t, 0.22);
}

/** Un stridulement bref : les jeunes se répondent entre eux. */
export function stridulation(){
  if(!A.ctx || !CR.jPan) return;
  const n = 3 + Math.floor(Math.random()*4);
  for(let k=0;k<n;k++)
    setTimeout(() => ping(2200 + Math.random()*1400, 0.022, 0.045, 'square', CR.jPan),
               k * (28 + Math.random()*26));
}
