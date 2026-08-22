/* ═══ AUDIO / CAVERNES ═══
   Ce qui vit dans la roche : gouttes d'eau, craquements, résonances lointaines.

   Tout est génératif et spatialisé. Chaque événement est posé à une position
   aléatoire autour du joueur, dans le plan de l'auditeur — on tourne la tête
   et le son est ailleurs. C'est ce qui donne du volume à un couloir vide.

   Le taux d'événements suit le biome et l'exiguïté : un boyau resserré goutte
   beaucoup et résonne court ; une grande salle goutte peu et résonne long.  */

import {SETUP} from '../setup.js';
import {A, bruitBuffer, bruitBrunBuffer, panner, placer, ping} from './contexte.js';

const C = {
  pan:null,
  prochaineGoutte:0,
  prochainCraquement:0,
  prochaineResonance:0,
  bruitCourt:null,
};

export function construireCavernes(){
  if(!A.ctx || C.pan) return;
  C.pan = panner(SETUP.audio.gouttes.portee * 1.6, 1.0);
  C.bruitCourt = bruitBuffer(A.ctx, 2);
}

/** Place le bus des cavernes à une position aléatoire autour de l'auditeur. */
function placerAuHasard(portee){
  const a = Math.random() * 6.283;
  const d = 2 + Math.random() * portee;
  placer(C.pan, Math.cos(a)*d, (Math.random()-0.35)*4, Math.sin(a)*d);
}

/* ── une goutte : impulsion très courte, deux harmoniques, queue de réverbe ── */
function goutte(exiguite){
  placerAuHasard(SETUP.audio.gouttes.portee);
  const f = 900 + Math.random()*1700;
  ping(f, 0.055, 0.05 + Math.random()*0.05, 'sine', C.pan);
  // la seconde impulsion, plus grave et décalée, fait « plic » et non « bip »
  setTimeout(() => ping(f*0.42, 0.14, 0.030, 'sine', C.pan), 26);
  // dans un boyau, l'écho revient tout de suite
  if(exiguite > 0.5)
    setTimeout(() => ping(f*0.98, 0.05, 0.012, 'sine', C.pan), 90 + Math.random()*70);
}

/* ── un craquement : la roche travaille. Bruit filtré à enveloppe très raide ── */
function craquement(){
  if(!A.ctx) return;
  placerAuHasard(30);
  const ctx = A.ctx, t = ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = C.bruitCourt;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 220 + Math.random()*700; f.Q.value = 3.5;
  const g = ctx.createGain();
  const dur = 0.10 + Math.random()*0.30;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09 + Math.random()*0.07, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(C.pan);
  s.start(t); s.stop(t + dur + 0.05);
  s.onended = () => { try{ g.disconnect(); }catch(e){} };
}

/* ── une résonance lointaine : quelque chose de très gros a bougé, très loin.
     Sub filtré à attaque lente. Ce n'est pas la créature — et c'est justement
     pour ça que c'est inquiétant : on ne sait pas ce que c'est. ── */
function resonance(){
  if(!A.ctx) return;
  const ctx = A.ctx, t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'sine';
  const base = 26 + Math.random()*18;
  o.frequency.setValueAtTime(base, t);
  o.frequency.exponentialRampToValueAtTime(base*0.72, t + 5.5);
  f.type = 'lowpass'; f.frequency.value = 120; f.Q.value = 1.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 1.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 7);
  o.connect(f).connect(g).connect(A.bus);
  o.start(t); o.stop(t + 7.5);
  o.onended = () => { try{ g.disconnect(); }catch(e){} };
}

/**
 * Appelé une fois par image.
 * @param dt
 * @param exiguite  0 = grande salle, 1 = boyau très resserré
 * @param humide    0..1 — le souterrain et le barrage gouttent, la surface non
 * @param abrite    dans une cachette : on n'entend presque plus rien
 */
export function majCavernes(dt, exiguite, humide, abrite){
  if(!A.ctx || !C.pan) return;
  const G = SETUP.audio.gouttes;
  const actif = abrite ? 0.25 : 1;

  C.prochaineGoutte -= dt * actif;
  if(C.prochaineGoutte <= 0){
    const taux = (G.tauxMin + (G.tauxMax - G.tauxMin) * exiguite) * humide;
    C.prochaineGoutte = taux > 0.01
      ? (1/taux) * (0.4 + Math.random()*1.6)
      : 6;
    if(humide > 0.15) goutte(exiguite);
  }

  C.prochainCraquement -= dt * actif;
  if(C.prochainCraquement <= 0){
    C.prochainCraquement = 6 + Math.random()*26;
    craquement();
  }

  C.prochaineResonance -= dt;
  if(C.prochaineResonance <= 0){
    C.prochaineResonance = 40 + Math.random()*90;
    resonance();
  }
}
