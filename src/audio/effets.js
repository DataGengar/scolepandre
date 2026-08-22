/* ═══ AUDIO / EFFETS ═══
   Les sons ponctuels du joueur. Courts, hors nappe, sans spatialisation
   (ils viennent de toi, ils sont donc au centre).

   Le souffle est nouveau : c'est l'effet audible du palier ENGOURDI du froid.
   Il te rend repérable, ce qui donne une conséquence de jeu à un chiffre de
   HUD — la règle du froid dit qu'à moins de 70 tu émets une vibration.      */

import {SETUP} from '../setup.js';
import {A, bruitBuffer, ping} from './contexte.js';

let bruitCourt = null;

export function construireEffets(){
  if(A.ctx && !bruitCourt) bruitCourt = bruitBuffer(A.ctx, 2);
}

export const pas = g => ping(58 + Math.random()*22, 0.09, g*0.07, 'triangle');

export function ramasse(){
  ping(700, 0.13, 0.16, 'sine');
  setTimeout(() => ping(1050, 0.10, 0.10, 'sine'), 55);
}

/** Ramassage d'une carte. Le rang décide de la hauteur : on entend la rareté. */
export function carte(rang){
  ping(520 + rang*260, 0.30, 0.24, 'triangle');
  setTimeout(() => ping(780 + rang*360, 0.40, 0.21, 'sine'), 90);
  setTimeout(() => ping(1170 + rang*450, 0.50, 0.15, 'sine'), 190);
  if(rang >= 2)   // légendaire : une quatrième voix, très haute
    setTimeout(() => ping(2340, 0.90, 0.10, 'sine'), 320);
}

export const lance  = () => ping(300, 0.09, 0.11, 'triangle');
export const impact = () => ping(84, 0.34, 0.26, 'square');

/** Entrer dans une cachette : un frottement sourd et le monde qui s'éteint. */
export function entrerCachette(){
  souffleFiltre(0.28, 240, 0.16);
  setTimeout(() => ping(52, 0.5, 0.10, 'sine'), 120);
}

export const sortirCachette = () => souffleFiltre(0.22, 420, 0.13);

/** Le joueur tombe : impact mat plus un froissement. */
export function chute(force){
  ping(46, 0.42, 0.20*force, 'sine');
  souffleFiltre(0.35, 300, 0.14*force);
}

/** Respiration visible. `intensite` suit le palier de froid. */
export function souffle(intensite){
  souffleFiltre(0.55 + Math.random()*0.35, 320 + Math.random()*260, 0.05*intensite);
}

/** Bruit filtré à enveloppe douce. Sert au souffle, aux frottements, aux chutes. */
function souffleFiltre(duree, freq, gain){
  if(!A.ctx || !bruitCourt) return;
  const ctx = A.ctx, t = ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = bruitCourt;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0005, gain), t + duree*0.30);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
  s.connect(f).connect(g).connect(A.bus);
  s.start(t); s.stop(t + duree + 0.05);
  s.onended = () => { try{ g.disconnect(); }catch(e){} };
}

/** Battement de cœur en hypothermie. Deux coups, comme il se doit. */
export function coeur(intensite){
  ping(44, 0.16, 0.13*intensite, 'sine');
  setTimeout(() => ping(38, 0.20, 0.09*intensite, 'sine'), 210);
}
