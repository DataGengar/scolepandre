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

/** Ramassage d'une carte. Le rang décide de la hauteur : on entend la rareté.
    Relevé en v3.1 — le son existait mais disparaissait sous la saturation
    générale, qui est corrigée par ailleurs (écrêteur doux dans contexte.js). */
export function carte(rang){
  const f = 520 + rang*260;
  ping(f,        0.34, 0.40, 'triangle');
  setTimeout(() => ping(f*1.5,  0.44, 0.34, 'sine'), 85);
  setTimeout(() => ping(f*2.0,  0.55, 0.26, 'sine'), 175);
  setTimeout(() => ping(f*3.0,  0.70, 0.16, 'sine'), 265);
  // une nappe brève par-dessous : la prise a du corps
  souffleFiltre(0.9, f*0.6, 0.10);
  if(rang >= 2){
    // légendaire : une quinte qui monte et tient
    setTimeout(() => ping(f*4.0, 1.20, 0.13, 'sine'), 360);
    setTimeout(() => ping(f*6.0, 1.60, 0.08, 'sine'), 520);
  }
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

/** Un feu qui prend : le frottement, puis le souffle qui s'installe. */
export function feu(){
  souffleFiltre(0.45, 900, 0.13);
  setTimeout(() => souffleFiltre(1.6, 240, 0.16), 220);
  setTimeout(() => ping(70, 0.5, 0.09, 'triangle'), 260);
}

/** Une fusée qu'on amorce : le crachement sec, puis la combustion. */
export function fusee(){
  souffleFiltre(0.14, 2400, 0.22);
  setTimeout(() => souffleFiltre(1.1, 1300, 0.15), 90);
  ping(880, 0.10, 0.14, 'square');
}

/** Une trousse médicale : deux notes montantes, franches. Le seul son
    franchement positif du jeu — il doit s'entendre comme un soulagement. */
export function soin(){
  ping(520, 0.16, 0.19, 'sine');
  setTimeout(() => ping(784, 0.22, 0.17, 'sine'), 110);
  setTimeout(() => ping(1046, 0.34, 0.12, 'sine'), 220);
}

/** Une morsure de jeune : impact mat, craquement, et un cri étouffé. */
export function morsure(){
  ping(120, 0.10, 0.26, 'square');
  souffleFiltre(0.22, 620, 0.20);
  setTimeout(() => souffleFiltre(0.5, 340, 0.13), 120);
}

/** Battement de cœur en hypothermie. Deux coups, comme il se doit. */
export function coeur(intensite){
  ping(44, 0.16, 0.13*intensite, 'sine');
  setTimeout(() => ping(38, 0.20, 0.09*intensite, 'sine'), 210);
}
