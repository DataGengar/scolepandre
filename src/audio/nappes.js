/* ═══ AUDIO / NAPPES ═══
   Les drones d'ambiance. Un par biome, en fondu sortant/entrant.

   ── CE QUI A CHANGÉ, ET POURQUOI ───────────────────────────────────────────
   La v2 faisait : pédale tenue + marche aléatoire sur une gamme. Une marche
   aléatoire n'est pas une mélodie, c'est un mouvement brownien — d'où le
   « pas assez mélodieux ». Trois changements :

   1. HARMONIE. Chaque drone a un MODE (les modes sombres : phrygien, mineur
      harmonique, locrien) et une PROGRESSION de degrés. Un accord est tenu 25
      à 50 s puis fondu vers le suivant. La voix mélodique choisit ses notes
      DANS L'ACCORD COURANT, pas dans toute la gamme : c'est ce qui transforme
      la dérive en musique. Elle privilégie le mouvement conjoint, avec un saut
      de temps en temps.

   2. REGISTRE. Les fondamentales descendent encore (16–28 Hz au lieu de 20–37)
      et une voix médiane tient la tierce mineure ou la quinte diminuée — c'est
      l'intervalle qui fait la couleur sinistre. Plus grave ET plus sombre.

   3. NIVEAU. Gains de note et de pédale relevés, limiteur desserré, courbe de
      volume linéarisée. Tout est dans SETUP.audio.

   RÈGLE CONSERVÉE : un drone ne se transforme jamais en un autre. Changer de
   biome fait un fondu sortant complet puis un fondu entrant. Marcher dans la
   glacière EST le geste.                                                    */

import {SETUP} from '../setup.js';
import {A, dbG, bruitBuffer, ping} from './contexte.js';

/* ─────────────── modes ─────────────── */
/* En demi-tons depuis la tonique. Ce sont tous des modes mineurs sombres. */
const MODES = {
  phrygien:        [0,1,3,5,7,8,10],
  mineurHarmonique:[0,2,3,5,7,8,11],
  locrien:         [0,1,3,5,6,8,10],
  mineurNaturel:   [0,2,3,5,7,8,10],
};

/**
 * Un accord = trois degrés empilés en tierces DANS le mode.
 * Renvoie les demi-tons depuis la tonique.
 */
function accordDe(mode, degre){
  const m = MODES[mode];
  const note = d => m[d % m.length] + 12 * Math.floor(d / m.length);
  return [note(degre), note(degre+2), note(degre+4)];
}

const hz = (racine, demiTons) => racine * Math.pow(2, demiTons/12);

/* ─────────────── les drones ─────────────── */
/* racine : la tonique en Hz, très bas.
   progression : degrés du mode, dans l'ordre. i, VI, iv, V… sombres. */
export const DRONES = [
  {
    id:'gouffre', nom:'Gouffre',
    racine:20.6, mode:'phrygien', progression:[0,5,3,1],
    coupure:34, pente:-13.5, bruit:0.22,
    duree:3.6, ecart:2.1,
  },
  {
    id:'givre', nom:'Givre',
    racine:27.5, mode:'locrien', progression:[0,4,2,6],
    coupure:68, pente:-10.5, bruit:0.40,
    duree:3.0, ecart:1.7,
  },
  {
    id:'beton', nom:'Béton',
    racine:16.4, mode:'mineurNaturel', progression:[0,3,5,4],
    coupure:28, pente:-8.0, bruit:0.56,
    duree:4.2, ecart:2.9,
  },
  {
    id:'ville', nom:'Ville rouge',
    racine:21.8, mode:'mineurHarmonique', progression:[0,5,4,0,3],
    coupure:32, pente:-12.0, bruit:0.32,
    duree:3.8, ecart:2.5,
  },
  {
    id:'gelisol', nom:'Gélisol',
    racine:24.5, mode:'phrygien', progression:[0,2,5,4],
    coupure:46, pente:-11.5, bruit:0.44,
    duree:3.4, ecart:2.4,
  },
];

/* ─────────────── état ─────────────── */
const N = {
  drone:null, id:null,
  pedales:[], mediane:null,
  src:null, fb1:null, fb2:null, gb:null,
  horloge:null, horlogeEvt:null, horlogeAccord:null, retourMaree:null,
  accord:0, dernierDegre:null,
  enTransition:false,
};

export const nomNappe = () => N.drone ? N.drone.nom : '—';

/* ─────────────── voix ─────────────── */

/**
 * Une note tenue, deux oscillateurs légèrement désaccordés qui battent.
 * @param opts.attaque / opts.relache pour les apparitions lentes.
 */
function jouerNote(freq, db, duree, gmax, opts){
  opts = opts || {};
  const ctx = A.ctx, t = ctx.currentTime;
  const att = opts.attaque || Math.min(duree*0.45, 1.4);
  const rel = opts.relache || duree*0.9;
  const cible = Math.max(0.0002, dbG(db) * gmax);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(cible, t + att);
  g.gain.setValueAtTime(cible, t + duree);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duree + rel);
  g.connect(A.pan);
  const oscs = [-3,3].map(cents => {
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = freq; o.detune.value = cents;
    o.connect(g); o.start(t); o.stop(t + duree + rel + 0.2);
    return o;
  });
  oscs[1].onended = () => { try{ g.disconnect(); }catch(e){} };
}

/**
 * La voix mélodique. Elle choisit un degré de L'ACCORD COURANT et une octave,
 * en privilégiant le mouvement conjoint. C'est ici que la nappe devient une
 * mélodie plutôt qu'un tirage.
 */
function planifierMelodie(){
  if(!A.ctx || !N.drone) return;
  const d = N.drone;
  const notes = accordDe(d.mode, d.progression[N.accord]);

  // pas conjoint la plupart du temps, saut d'accord parfois
  let i;
  if(N.dernierDegre === null) i = Math.floor(Math.random()*notes.length);
  else {
    const pas = (Math.random() < 0.70 ? 1 : 2) * (Math.random() < 0.5 ? -1 : 1);
    i = (N.dernierDegre + pas + notes.length*3) % notes.length;
  }
  N.dernierDegre = i;

  // 3 à 5 octaves au-dessus de la tonique : la mélodie plane loin au-dessus
  // du grave, comme une voix dans une cathédrale vide.
  const octave = 36 + [0,0,12,12,24][Math.floor(Math.random()*5)];
  const f = hz(d.racine, notes[i] + octave);
  const db = -8 - i*2.5 - (octave > 40 ? 6 : 0);

  jouerNote(f, db, d.duree * (0.8 + Math.random()*0.5), SETUP.audio.gainNote);
  N.horloge = setTimeout(planifierMelodie, d.ecart * (0.7 + Math.random()*0.8) * 1000);
}

/**
 * Les pédales : tonique et quinte, tenues, très graves, avec un LFO lent sur
 * le gain. Elles ne changent pas d'accord — elles sont le sol.
 */
function monterPedale(d){
  const ctx = A.ctx, t = ctx.currentTime;
  const voix = [[0, -5.0], [7, -9.5]];       // tonique, quinte juste
  N.pedales = voix.map(([demi, db], i) => {
    const f = hz(d.racine, demi);
    const g = ctx.createGain(), cible = dbG(db) * SETUP.audio.gainPedale;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(cible, t + 11);
    g.connect(A.pan);
    const oscs = [-3,3].map(c => {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f; o.detune.value = c;
      o.connect(g); o.start(t); return o;
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.043 + i*0.017;
    const prof = ctx.createGain(); prof.gain.value = cible*0.22;
    lfo.connect(prof).connect(g.gain); lfo.start(t);
    return {g, oscs, lfo};
  });
}

/**
 * La voix médiane : elle tient la TIERCE de l'accord courant, deux octaves
 * au-dessus de la pédale. C'est elle qui porte la couleur — mineure, ou
 * diminuée en locrien. Elle glisse d'un accord au suivant.
 */
function monterMediane(d){
  const ctx = A.ctx, t = ctx.currentTime;
  const notes = accordDe(d.mode, d.progression[0]);
  const g = ctx.createGain();
  const cible = dbG(-13) * SETUP.audio.gainPedale;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(cible, t + 14);
  g.connect(A.pan);
  const oscs = [-4, 4].map(c => {
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = hz(d.racine, notes[1] + 24);
    o.detune.value = c; o.connect(g); o.start(t); return o;
  });
  N.mediane = {g, oscs};
}

/**
 * Avance d'un accord. La médiane glisse vers sa nouvelle tierce en
 * SETUP.audio.accordFondu secondes — c'est le mouvement harmonique qu'on
 * entend, et c'est ce qui manquait complètement en v2.
 */
function avancerAccord(){
  if(!A.ctx || !N.drone) return;
  const d = N.drone;
  N.accord = (N.accord + 1) % d.progression.length;
  const notes = accordDe(d.mode, d.progression[N.accord]);
  if(N.mediane){
    const t = A.ctx.currentTime, f = hz(d.racine, notes[1] + 24);
    N.mediane.oscs.forEach(o =>
      o.frequency.setTargetAtTime(f, t, SETUP.audio.accordFondu/3));
  }
  const [a,b] = SETUP.audio.accordDuree;
  N.horlogeAccord = setTimeout(avancerAccord, (a + Math.random()*(b-a)) * 1000);
}

/* ─────────────── lit de bruit ─────────────── */

function construireBruit(d){
  const ctx = A.ctx;
  const src = ctx.createBufferSource();
  src.buffer = bruitBuffer(ctx, 8); src.loop = true;
  const f1 = ctx.createBiquadFilter();
  f1.type = 'lowpass'; f1.frequency.value = d.coupure; f1.Q.value = d.pente > -10 ? 0.4 : 0.7;
  let out = f1, f2 = null;
  if(d.pente <= -13){
    f2 = ctx.createBiquadFilter();
    f2.type = 'lowpass'; f2.frequency.value = d.coupure*1.3; f2.Q.value = 0.5;
    f1.connect(f2); out = f2;
  }
  const g = ctx.createGain(); g.gain.value = d.bruit * 0.34;
  src.connect(f1); out.connect(g); g.connect(A.pan); src.start();
  N.src = src; N.fb1 = f1; N.fb2 = f2; N.gb = g;
}

/* ─────────────── événements lents ─────────────── */

/* La cloche : une note de l'accord courant, très haut, très loin. 6 s
   d'attaque — une apparition, jamais une frappe. */
function evtCloche(){
  const d = N.drone;
  const notes = accordDe(d.mode, d.progression[N.accord]);
  const n = notes[Math.floor(Math.random()*notes.length)];
  jouerNote(hz(d.racine, n + 60), -24, 4, SETUP.audio.gainNote, {attaque:6, relache:12});
}

/* La marée : la coupure du lit de bruit s'ouvre lentement puis se referme.
   Le fond « respire ». */
function evtMaree(){
  const gen = A.gen, base = N.drone.coupure;
  N.fb1.frequency.setTargetAtTime(base*3, A.ctx.currentTime, 8);
  if(N.fb2) N.fb2.frequency.setTargetAtTime(base*3.9, A.ctx.currentTime, 8);
  N.retourMaree = setTimeout(() => {
    if(!A.ctx || gen !== A.gen || !N.fb1) return;
    N.fb1.frequency.setTargetAtTime(base, A.ctx.currentTime, 8);
    if(N.fb2) N.fb2.frequency.setTargetAtTime(base*1.3, A.ctx.currentTime, 8);
  }, 25000);
}

/* Le soupir : un glissando descendant très lent sur la quinte diminuée. Le son
   le plus explicitement inquiétant de la nappe. Nouveau en v3. */
function evtSoupir(){
  const d = N.drone, ctx = A.ctx, t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'triangle';
  o.frequency.setValueAtTime(hz(d.racine, 30), t);
  o.frequency.exponentialRampToValueAtTime(hz(d.racine, 18), t + 9);
  f.type = 'lowpass'; f.frequency.value = 340; f.Q.value = 2.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(dbG(-16)*SETUP.audio.gainNote, t + 3.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 11);
  o.connect(f).connect(g).connect(A.pan);
  o.start(t); o.stop(t + 11.5);
  o.onended = () => { try{ g.disconnect(); }catch(e){} };
}

function planifierEvt(premier){
  clearTimeout(N.horlogeEvt);
  const min = premier ? 0.5 + Math.random()*1.0 : 1.4 + Math.random()*3;
  const gen = A.gen;
  N.horlogeEvt = setTimeout(() => {
    if(gen !== A.gen) return;
    const lot = [evtCloche, evtSoupir];
    if(N.drone.bruit >= 0.10 && N.fb1) lot.push(evtMaree);
    try{ lot[Math.floor(Math.random()*lot.length)](); }catch(e){}
    planifierEvt(false);
  }, min * 60000);
}

/* ─────────────── montage / démontage ─────────────── */

function monterDrone(d){
  N.drone = d; N.id = d.id; N.dernierDegre = null; N.accord = 0;
  monterPedale(d);
  monterMediane(d);
  construireBruit(d);
  planifierMelodie();
  planifierEvt(true);
  const [a,b] = SETUP.audio.accordDuree;
  N.horlogeAccord = setTimeout(avancerAccord, (a + Math.random()*(b-a)) * 1000);
}

function descendreDrone(apres){
  const ctx = A.ctx;
  if(!ctx){ if(apres) apres(); return; }
  [N.horloge, N.horlogeEvt, N.horlogeAccord, N.retourMaree].forEach(clearTimeout);
  N.horloge = N.horlogeEvt = N.horlogeAccord = N.retourMaree = null;

  const t = ctx.currentTime, rel = 3.5;
  const eteindre = v => { try{
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setValueAtTime(Math.max(0.0001, v.g.gain.value), t);
    v.g.gain.exponentialRampToValueAtTime(0.0001, t + rel);
    v.oscs.forEach(o => o.stop(t + rel + 0.3));
    if(v.lfo) v.lfo.stop(t + rel + 0.3);
  }catch(e){} };

  N.pedales.forEach(eteindre);
  if(N.mediane) eteindre(N.mediane);
  if(N.gb){ try{
    N.gb.gain.cancelScheduledValues(t);
    N.gb.gain.setValueAtTime(N.gb.gain.value, t);
    N.gb.gain.linearRampToValueAtTime(0.0001, t + rel);
    N.src.stop(t + rel + 0.3);
  }catch(e){} }

  N.pedales = []; N.mediane = null;
  N.src = N.gb = N.fb1 = N.fb2 = null;
  if(apres) setTimeout(apres, (rel + 0.4) * 1000);
}

/* ─────────────── API ─────────────── */

export function demarrerNappe(id){
  monterDrone(DRONES.find(d => d.id === id) || DRONES[0]);
}

/** Fondu sortant puis entrant. Jamais de morphose : c'est la règle. */
export function changerNappe(id){
  const d = DRONES.find(x => x.id === id) || DRONES[0];
  if(!A.ctx || N.enTransition || d.id === N.id) return;
  N.enTransition = true; N.id = d.id;
  const gen = A.gen;
  descendreDrone(() => {
    if(gen !== A.gen) return;
    N.enTransition = false;
    monterDrone(d);
  });
}

/** Un accroc bref dans la nappe : elle vient de te repérer. */
export function accroc(){
  if(!A.ctx || !N.drone) return;
  const t = A.ctx.currentTime;
  N.pedales.forEach(v => {
    try{
      const g = v.g.gain.value;
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setValueAtTime(g, t);
      v.g.gain.linearRampToValueAtTime(g*0.15, t + 0.08);
      v.g.gain.setTargetAtTime(g, t + 0.5, 1.4);
    }catch(e){}
  });
}
