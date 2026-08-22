/* ═══ AUDIO / VENT ═══
   Le vent, absent de la v2 alors qu'il pilotait déjà l'effacement des traces.

   ── CONSTRUCTION ──────────────────────────────────────────────────────────
   Bruit brun (plus grave que le rose) → deux passe-bande en parallèle :
     · une bande basse, large, lentement modulée : le souffle de fond ;
     · une bande haute, étroite, très résonante : le sifflement dans une arête.
   Un LFO lent balaie les deux fréquences ; des rafales viennent par-dessus,
   avec une enveloppe de 4 à 12 s.

   ── OÙ ON L'ENTEND ────────────────────────────────────────────────────────
   Le gain suit trois choses, calculées par jeu.js et passées à souffler() :
     · ciel ouvert   → plein vent
     · ouverture     → une grande salle siffle, un boyau non
     · gouffre proche→ le trou aspire, c'est le son du danger
   Dans une cachette il tombe à zéro : le silence y est un soulagement
   physique, ce qui est exactement le but de la mécanique.                  */

import {SETUP} from '../setup.js';
import {A, bruitBrunBuffer} from './contexte.js';

const V = {
  src:null, bande1:null, bande2:null, g1:null, g2:null, sortie:null,
  lfo1:null, lfo2:null, rafale:null, gRafale:null, horloge:null,
  cible:0,
};

export function construireVent(){
  if(!A.ctx || V.src) return;
  const ctx = A.ctx;

  V.sortie = ctx.createGain(); V.sortie.gain.value = 0;
  V.sortie.connect(A.bus);

  V.src = ctx.createBufferSource();
  V.src.buffer = bruitBrunBuffer(ctx, 12);
  V.src.loop = true;

  // bande basse : le souffle
  V.bande1 = ctx.createBiquadFilter();
  V.bande1.type = 'bandpass'; V.bande1.frequency.value = 190; V.bande1.Q.value = 0.8;
  V.g1 = ctx.createGain(); V.g1.gain.value = 1.0;

  // bande haute : le sifflement dans les arêtes de roche
  V.bande2 = ctx.createBiquadFilter();
  V.bande2.type = 'bandpass'; V.bande2.frequency.value = 900; V.bande2.Q.value = 6.5;
  V.g2 = ctx.createGain(); V.g2.gain.value = 0.28;

  V.src.connect(V.bande1).connect(V.g1).connect(V.sortie);
  V.src.connect(V.bande2).connect(V.g2).connect(V.sortie);

  // deux LFO incommensurables : le vent ne se répète jamais à l'oreille
  V.lfo1 = ctx.createOscillator(); V.lfo1.frequency.value = 0.037;
  const p1 = ctx.createGain(); p1.gain.value = 85;
  V.lfo1.connect(p1).connect(V.bande1.frequency); V.lfo1.start();

  V.lfo2 = ctx.createOscillator(); V.lfo2.frequency.value = 0.019;
  const p2 = ctx.createGain(); p2.gain.value = 420;
  V.lfo2.connect(p2).connect(V.bande2.frequency); V.lfo2.start();

  // rafales : une seconde source, ouverte par bouffées
  V.rafale = ctx.createBufferSource();
  V.rafale.buffer = bruitBrunBuffer(ctx, 9); V.rafale.loop = true;
  const fr = ctx.createBiquadFilter();
  fr.type = 'bandpass'; fr.frequency.value = 430; fr.Q.value = 1.6;
  V.gRafale = ctx.createGain(); V.gRafale.gain.value = 0;
  V.rafale.connect(fr).connect(V.gRafale).connect(V.sortie);

  V.src.start(); V.rafale.start();
  planifierRafale();
}

function planifierRafale(){
  const [a,b] = SETUP.audio.vent.ecartRafale;
  V.horloge = setTimeout(() => {
    if(!A.ctx || !V.gRafale){ return; }
    const [d0,d1] = SETUP.audio.vent.dureeRafale;
    const duree = d0 + Math.random()*(d1-d0);
    const t = A.ctx.currentTime;
    const force = (0.35 + Math.random()*0.65) * V.cible;
    V.gRafale.gain.cancelScheduledValues(t);
    V.gRafale.gain.setValueAtTime(V.gRafale.gain.value, t);
    V.gRafale.gain.linearRampToValueAtTime(force, t + duree*0.35);
    V.gRafale.gain.linearRampToValueAtTime(0.0001, t + duree);
    planifierRafale();
  }, (a + Math.random()*(b-a)) * 1000);
}

/**
 * Règle l'intensité. Appelé une fois par image par jeu.js.
 * @param ciel     1 si à ciel ouvert
 * @param ouvert   openN de la cellule, 0..1
 * @param gouffre  0..1 — proximité d'un précipice
 * @param abrite   true si le joueur est dans une cachette
 */
export function souffler(ciel, ouvert, gouffre, abrite){
  if(!A.ctx || !V.sortie) return 0;
  const brut = abrite ? 0
    : Math.min(1, ciel*0.75 + ouvert*0.35 + gouffre*0.55);
  V.cible = brut * SETUP.audio.vent.gain;
  V.sortie.gain.setTargetAtTime(V.cible, A.ctx.currentTime, 1.2);
  // renvoyé au jeu : c'est cette valeur qui alimente l'exposition au froid
  // et le déplacement des traces d'odeur. Une seule source pour les trois.
  return brut;
}

/** Force actuelle du vent, 0..1. Lue par le froid et par les traces. */
export const force = () => V.cible / Math.max(0.001, SETUP.audio.vent.gain);
