/* ═══ AUDIO / NAPPES ═══
   Les drones d'ambiance. Un par biome.

   ── D'OÙ VIENT CE MOTEUR ───────────────────────────────────────────────────
   Il est repris de SessionMasterTauri, sur demande d'Orlando, et la version
   précédente a été jetée. Elle faisait pédale tenue plus marche aléatoire sur
   une gamme, avec des accords qui se succédaient. C'était « juste passable »,
   et il avait raison : un mouvement brownien sur une gamme n'est pas une
   mélodie, et une harmonie qui change toute seule finit par raconter quelque
   chose qu'on n'a pas demandé.

   ── CE QUI FAIT LA DIFFÉRENCE ──────────────────────────────────────────────
   CE NE SONT PAS DES ACCORDS TENUS. Chaque drone est une PÉDALE sur laquelle
   se pose un ARPÈGE LENT : une note toutes les 0,6 à 1,5 s selon le drone,
   tenue environ 1,6 s. Deux ou trois notes se recouvrent donc en permanence,
   et c'est ce recouvrement — pas l'accord — qui produit la matière.

   Les fréquences ne sont pas construites depuis une gamme théorique : elles
   sont RELEVÉES sur des enregistrements réels, par analyse résolue dans le
   temps, avec leur niveau en dB. C'est pour ça que ça sonne comme un lieu et
   pas comme un synthétiseur.

   Deux règles héritées, et gardées :
     1. Un drone ne se transforme JAMAIS en un autre. Changer de biome fait un
        fondu sortant complet puis un fondu entrant.
     2. À l'intérieur d'un drone, la mélodie ne se répète pas. Les notes sont
        tirées par une marche sur la gamme relevée, à pas voisin la plupart du
        temps et saut de temps en temps : c'est ce qui fait entendre une LIGNE
        plutôt qu'une suite de notes au hasard.

   ── DEUX OCTAVES PLUS BAS ──────────────────────────────────────────────────
   Demandé explicitement. SessionMaster est un fond de travail ; ici c'est un
   souterrain. `TRANSPOSITION` vaut donc 0,25.

   Attention : deux octaves sous 55 Hz font 13,75 Hz, sous le seuil d'audition.
   Les fondamentales les plus basses ne s'entendent plus comme des notes mais
   comme une pression — c'est voulu, et c'est pour cela que chaque drone garde
   des partiels plus hauts dans sa gamme. Un drone entièrement transposé sous
   30 Hz serait silencieux sur un ordinateur portable.                       */

import {SETUP} from '../setup.js';
import {A, dbG, bruitBuffer} from './contexte.js';

/** Deux octaves sous les valeurs relevées. */
const TRANSPOSITION = 0.25;

/* ═══════════════ LES DRONES ═══════════════

   `pedale`  notes tenues sous l'arpège, [Hz, dB]
   `gamme`   les notes de l'arpège, [Hz, dB] — relevées, pas calculées
   `duree`   tenue d'une note, en secondes
   `ecart`   temps entre deux attaques
   `coupure` fréquence du passe-bas sur le lit de bruit
   `pente`   pente relevée : au-delà de −13 dB/oct on met deux filtres
   `bruit`   niveau du lit de bruit, 0 à 1                                   */

export const DRONES = [
  {
    id:'caverne', nom:'Caverne', sous:'la mineur, fondamentale à 55 Hz',
    pedale:[],
    gamme:[[55.0,-6.5], [110.0,-9.2], [164.8,-17.4], [220.0,-14.5],
           [329.6,-15.1], [440.0,-20.4], [659.3,-18.2]],
    duree:1.6, ecart:0.6, coupure:55, pente:-11.2, bruit:0.07,
  },
  {
    id:'brume', nom:'Brume', sous:'si mineur, mouvement dense',
    pedale:[],
    gamme:[[110.0,-15.0], [123.5,-10.8], [146.8,-8.3], [185.0,-8.5],
           [233.1,-9.6]],
    duree:1.8, ecart:0.6, coupure:494, pente:-12.2, bruit:0.20,
  },
  {
    id:'suspendu', nom:'Suspendu', sous:'la sans tierce, notes rares',
    pedale:[[220.0,-6.0], [329.6,-6.0]],
    gamme:[[110.0,-7.0], [174.6,-7.2], [293.7,-7.7], [349.2,-10.7],
           [440.0,-13.1], [587.3,-5.2], [659.3,-12.2]],
    duree:1.8, ecart:0.8, coupure:112, pente:-11.2, bruit:0.09,
  },
  {
    id:'clairiere', nom:'Clairière', sous:'do majeur, arpège calme sur pédale',
    pedale:[[164.8,-6.0], [196.0,-6.0]],
    gamme:[[65.4,-6.6], [130.8,-10.9], [246.9,-8.8], [329.6,-8.5],
           [392.0,-11.5]],
    duree:1.6, ecart:0.6, coupure:166, pente:-14.4, bruit:0.04,
  },
  {
    id:'cathedrale', nom:'Cathédrale', sous:'quintes de ré♯, très ouvert',
    pedale:[],
    gamme:[[155.6,-4.0], [233.1,-5.9], [311.1,-4.1], [349.2,-4.5],
           [466.2,-7.1], [740.0,-6.7]],
    duree:1.6, ecart:0.6, coupure:77, pente:-9.2, bruit:0.17,
  },
  {
    id:'abysse', nom:'Abysse', sous:'sol souterrain, notes très espacées',
    pedale:[],
    gamme:[[98.0,-3.9], [196.0,-13.7], [220.0,-13.7], [784.0,-9.3]],
    duree:1.4, ecart:1.5, coupure:99, pente:-7.4, bruit:0.49,
  },
];

/* ═══════════════ ÉTAT ═══════════════ */

const N = {
  drone:null, dernier:null, horloge:null,
  pedales:[], bruitSrc:null, bruitG:null, f1:null, f2:null,
  bus:null, gain:null,
  gen:0,                    // génération : invalide les rappels d'un ancien drone
  enTransition:false,
};

export const nomNappe = () => N.drone ? N.drone.nom : '—';

const droneDe = id => DRONES.find(d => d.id === id) || DRONES[0];

/* ═══════════════ UNE NOTE ═══════════════ */

/**
 * Une note de l'arpège, ou de la pédale.
 *
 * Deux oscillateurs désaccordés de ±3 cents : c'est ce qui donne l'épaisseur.
 * Un seul sonne comme un test de tonalité.
 *
 * L'enveloppe est exponentielle des deux côtés — jamais linéaire, jamais
 * jusqu'à zéro. `exponentialRampToValueAtTime(0)` est interdit par la norme et
 * lève une exception ; 0,0001 est inaudible et légal.
 */
function jouerNote(freq, db, duree, attaque){
  const ctx = A.ctx;
  if(!ctx || !N.bus) return;
  const t = ctx.currentTime;
  const relache = Math.max(0.4, duree * 0.55);
  const cible = dbG(db) * SETUP.audio.gainNote;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(cible, t + attaque);
  g.gain.setValueAtTime(cible, t + duree);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duree + relache);
  g.connect(N.bus);

  const oscs = [-3, 3].map(cents => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    o.detune.value = cents;
    o.connect(g);
    o.start(t);
    o.stop(t + duree + relache + 0.2);
    return o;
  });

  /* Sans déconnexion explicite, les nœuds éteints s'accumulent : au bout
     d'une heure de jeu cela fait plusieurs milliers de gains fantômes. */
  oscs[1].onended = () => { try{ g.disconnect(); }catch(e){} };
}

/* ═══════════════ L'ARPÈGE ═══════════════ */

/**
 * Le degré suivant : un pas voisin la plupart du temps, un saut parfois.
 *
 * C'est LE détail qui fait entendre une ligne plutôt qu'une suite de notes au
 * hasard. Un tirage uniforme donne du bruit ; une boucle donne une comptine.
 */
function choisirIndex(n){
  if(n <= 1) return 0;
  if(N.dernier === null){ N.dernier = Math.floor(Math.random()*n); return N.dernier; }
  let i = N.dernier;
  for(let essai = 0; essai < 8 && i === N.dernier; essai++){
    const pas = (Math.random() < 0.72 ? 1 : 2) * (Math.random() < 0.5 ? -1 : 1);
    i = N.dernier + pas;
    if(i < 0) i += n;
    if(i >= n) i -= n;
  }
  N.dernier = i;
  return i;
}

function planifier(){
  if(!A.ctx || !N.drone) return;
  const d = N.drone;
  const [f, db] = d.gamme[choisirIndex(d.gamme.length)];

  /* Durée et écart tirés AUTOUR des valeurs relevées. Une cadence
     parfaitement régulière s'entend comme une horloge, et une horloge dans un
     souterrain, on l'écoute au lieu de l'oublier. */
  const duree = d.duree * (0.8 + Math.random()*0.5);
  jouerNote(f * TRANSPOSITION, db, duree, 0.30);

  const ecart = d.ecart * (0.7 + Math.random()*0.8);
  N.horloge = setTimeout(planifier, ecart * 1000);
}

/* ═══════════════ LA PÉDALE ═══════════════ */

function monterPedale(d){
  const ctx = A.ctx, t = ctx.currentTime;
  N.pedales = d.pedale.map(([f, db], i) => {
    const g = ctx.createGain();
    const cible = dbG(db) * SETUP.audio.gainPedale;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(cible, t + SETUP.audio.attaquePedale);
    g.connect(N.bus);

    const oscs = [-3, 3].map(cents => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * TRANSPOSITION;
      o.detune.value = cents;
      o.connect(g);
      o.start(t);
      return o;
    });

    // Elle respire très lentement, sinon elle s'entend comme une sirène.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.043 + i * 0.017;
    const prof = ctx.createGain();
    prof.gain.value = cible * 0.22;
    lfo.connect(prof).connect(g.gain);
    lfo.start(t);

    return {g, oscs, lfo};
  });
}

/* ═══════════════ LE LIT DE BRUIT ═══════════════ */

function monterBruit(d){
  const ctx = A.ctx;
  const src = ctx.createBufferSource();
  src.buffer = bruitBuffer(ctx, 6);
  src.loop = true;

  /* Un biquad passe-bas vaut −12 dB/octave. La pente relevée dit combien il
     en faut : au-delà de −13, un seul filtre ne suffit pas. */
  const f1 = ctx.createBiquadFilter();
  f1.type = 'lowpass';
  f1.frequency.value = d.coupure;
  f1.Q.value = d.pente > -10 ? 0.4 : 0.7;
  src.connect(f1);
  let sortie = f1;

  let f2 = null;
  if(d.pente <= -13){
    f2 = ctx.createBiquadFilter();
    f2.type = 'lowpass';
    f2.frequency.value = d.coupure * 1.3;
    f2.Q.value = 0.5;
    sortie.connect(f2);
    sortie = f2;
  }

  const g = ctx.createGain();
  g.gain.value = d.bruit * SETUP.audio.gainBruit;
  sortie.connect(g).connect(N.bus);
  src.start();

  N.bruitSrc = src; N.bruitG = g; N.f1 = f1; N.f2 = f2;
}

/* ═══════════════ MONTER, DESCENDRE ═══════════════ */

function demonter(){
  clearTimeout(N.horloge); N.horloge = null;
  const ctx = A.ctx;
  if(!ctx) return;
  const t = ctx.currentTime;

  for(const p of N.pedales){
    try{
      p.g.gain.cancelScheduledValues(t);
      p.g.gain.setValueAtTime(Math.max(0.0001, p.g.gain.value), t);
      p.g.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
      p.oscs.forEach(o => o.stop(t + 2.3));
      p.lfo.stop(t + 2.3);
    }catch(e){}
  }
  N.pedales = [];

  if(N.bruitG){
    try{
      N.bruitG.gain.cancelScheduledValues(t);
      N.bruitG.gain.setValueAtTime(Math.max(0.0001, N.bruitG.gain.value), t);
      N.bruitG.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
      N.bruitSrc.stop(t + 2.3);
    }catch(e){}
  }
  N.bruitSrc = N.bruitG = N.f1 = N.f2 = null;
  N.dernier = null;
}

function monter(d){
  const ctx = A.ctx;
  if(!ctx) return;
  N.drone = d;

  if(!N.bus){
    N.bus = ctx.createGain();
    N.bus.gain.value = 1;
    N.bus.connect(A.pan);
  }
  monterPedale(d);
  monterBruit(d);
  planifier();
}

/* ═══════════════ INTERFACE ═══════════════ */

export function demarrerNappe(id){
  if(!A.ctx) return;
  demonter();
  monter(droneDe(id));
}

/**
 * Change de drone.
 *
 * RÈGLE : un drone ne se transforme jamais en un autre. On éteint
 * complètement, puis on rallume. Interpoler entre deux tables de fréquences
 * relevées ne donne rien de musical — juste une bouillie pendant dix secondes.
 * Marcher d'un biome à l'autre EST le geste, et il doit s'entendre.
 */
export function changerNappe(id){
  if(!A.ctx) return;
  if(N.drone && N.drone.id === id) return;
  if(N.enTransition) return;

  N.enTransition = true;
  const gen = ++N.gen;
  demonter();
  setTimeout(() => {
    if(gen !== N.gen){ N.enTransition = false; return; }
    monter(droneDe(id));
    N.enTransition = false;
  }, 2400);
}

/**
 * Un accroc : la nappe se fige une seconde, puis reprend.
 *
 * Utilisé quand la créature passe tout près. Ce n'est pas un effet sonore,
 * c'est une ABSENCE : on remarque le silence d'un fond qu'on avait cessé
 * d'entendre, et c'est bien plus efficace qu'un bruit de plus.
 */
export function accroc(){
  if(!A.ctx || !N.bus) return;
  const t = A.ctx.currentTime;
  const g = N.bus.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.exponentialRampToValueAtTime(0.06, t + 0.10);
  g.exponentialRampToValueAtTime(1.0, t + 1.30);
}
