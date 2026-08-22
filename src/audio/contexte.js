/* ═══ AUDIO / CONTEXTE ═══
   L'AudioContext, les bus, le limiteur, la convolution, le délai.
   Tout le reste de src/audio/ se branche ici.

   ── CHAÎNE ────────────────────────────────────────────────────────────────
     sources ──▶ pan ──▶ bus ──┬──▶ conv ──▶ wet ──┐
                               ├──▶ dry ───────────┼──▶ master ──▶ lim ──▶ sortie
                               └──▶ delai ──▶ bas ─┘
                                       ▲       │
                                       └───────┘ retour

   ── POURQUOI C'ÉTAIT TROP FAIBLE (v2) ─────────────────────────────────────
   Trois choses se cumulaient :
     1. gainMaitre = (v/100)^1.55 × 1.05 — l'exposant 1.55 écrasait tout le bas
        du curseur ; à 82 on n'obtenait que 0,78.
     2. le limiteur était réglé à −12 dB avec un ratio de 12 : il compressait
        la nappe en permanence, pas seulement les crêtes.
     3. les notes sortaient à un gain de 0,30.
   Les trois sont dans SETUP.audio et sont desserrés en v3.                  */

import {SETUP, abonner} from '../setup.js';

/** Courbe tanh pour le WaveShaper : douce jusqu'à ~0.7, ferme ensuite. */
function courbeEcreteur(k){
  const n = 4096, c = new Float32Array(n);
  for(let i=0;i<n;i++){
    const x = (i/(n-1))*2 - 1;
    c[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return c;
}

export const A = {
  ctx:null, master:null, lim:null, ecreteur:null, bus:null, pan:null,
  conv:null, wet:null, dry:null, delai:null, retour:null, lfo:null,
  // filtre appliqué quand on est dans une cachette : le monde s'éloigne
  mur:null,
  gen:0,
  pret:false,
};

export const dbG = db => Math.pow(10, db/20);

export const gainMaitre = v =>
  Math.pow(Math.max(0,v)/100, SETUP.audio.courbeVolume) * SETUP.audio.facteurVolume;

/* ─────────────── tampons ─────────────── */

/** Réponse impulsionnelle : une queue de bruit filtré qui décroît. */
export function irBuffer(ctx, sec){
  const n = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for(let c=0;c<2;c++){
    const d = buf.getChannelData(c);
    let lp = 0;
    for(let i=0;i<n;i++){
      const env = Math.pow(1 - i/n, 2.6);
      lp += (Math.random()*2 - 1 - lp) * 0.05;
      d[i] = lp * env;
    }
  }
  return buf;
}

/** Bruit rose : le blanc siffle bien trop pour un lit de fond. */
export function bruitBuffer(ctx, sec){
  const n = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0=0, b1=0, b2=0;
  for(let i=0;i<n;i++){
    const w = Math.random()*2 - 1;
    b0 = 0.99765*b0 + w*0.0990460;
    b1 = 0.96300*b1 + w*0.2965164;
    b2 = 0.57000*b2 + w*1.0526913;
    d[i] = (b0 + b1 + b2 + w*0.1848) * 0.16;
  }
  return buf;
}

/** Bruit brun : encore plus grave que le rose. Pour le vent et les grondements. */
export function bruitBrunBuffer(ctx, sec){
  const n = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for(let i=0;i<n;i++){
    last = (last + 0.022 * (Math.random()*2-1)) / 1.022;
    d[i] = last * 3.2;
  }
  return buf;
}

/* ─────────────── construction ─────────────── */

export function construire(){
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  A.ctx = ctx;

  A.lim = ctx.createDynamicsCompressor();
  A.lim.threshold.value = SETUP.audio.limiteurSeuil;
  A.lim.knee.value      = SETUP.audio.limiteurKnee;
  A.lim.ratio.value     = SETUP.audio.limiteurRatio;
  A.lim.attack.value    = 0.05;
  A.lim.release.value   = 0.7;
  /* ÉCRÊTEUR DOUX en toute fin de chaîne. Le compresseur seul ne suffisait
     pas : au-delà de son seuil il compresse, mais rien n'empêche la somme des
     voix de dépasser 1 et de claquer numériquement. Une courbe en tangente
     hyperbolique arrondit les crêtes au lieu de les couper — c'est la
     différence entre « ça sature » et « ça pousse ». */
  A.ecreteur = ctx.createWaveShaper();
  A.ecreteur.curve = courbeEcreteur(SETUP.audio.ecreteurDoux);
  A.ecreteur.oversample = '2x';
  A.lim.connect(A.ecreteur).connect(ctx.destination);

  A.master = ctx.createGain(); A.master.gain.value = 0.0001;
  A.master.connect(A.lim);

  /* Le « mur » : un passe-bas placé juste avant le master. Ouvert à 20 kHz en
     temps normal, refermé à SETUP.cachettes.filtreSon quand on est dans un
     trou. C'est le son de l'enterrement. */
  A.mur = ctx.createBiquadFilter();
  A.mur.type = 'lowpass'; A.mur.frequency.value = 20000; A.mur.Q.value = 0.7;
  A.mur.connect(A.master);

  A.bus = ctx.createGain();
  A.pan = ctx.createStereoPanner();
  A.pan.connect(A.bus);

  A.conv = ctx.createConvolver();
  A.conv.buffer = irBuffer(ctx, SETUP.audio.reverbLongue);
  A.wet = ctx.createGain(); A.wet.gain.value = 0.85;
  A.dry = ctx.createGain(); A.dry.gain.value = 0.30;
  A.bus.connect(A.conv).connect(A.wet).connect(A.mur);
  A.bus.connect(A.dry).connect(A.mur);

  A.delai = ctx.createDelay(8); A.delai.delayTime.value = 2.2;
  A.retour = ctx.createGain(); A.retour.gain.value = 0.42;
  const bas = ctx.createBiquadFilter();
  bas.type = 'lowpass'; bas.frequency.value = 300;
  A.bus.connect(A.delai); A.delai.connect(bas); bas.connect(A.retour);
  A.retour.connect(A.delai); bas.connect(A.conv); bas.connect(A.dry);

  A.lfo = ctx.createOscillator(); A.lfo.frequency.value = 0.031;
  const gP = ctx.createGain(); gP.gain.value = 0.45;
  A.lfo.connect(gP).connect(A.pan.pan);
  A.lfo.start();

  A.pret = true;
  abonner('audio.volume', v => volume(v));
  return ctx;
}

export function volume(v){
  if(!A.ctx) return;
  A.master.gain.setTargetAtTime(Math.max(0.0001, gainMaitre(v)), A.ctx.currentTime, 0.6);
}

export function reprendre(){
  if(A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
}

/** Longueur de réverbération selon le biome (biomes.js déclare `reverb`). */
export function reglerReverb(nom){
  if(!A.ctx || !A.conv) return;
  const sec = nom === 'aucune' ? 0.8
            : nom === 'courte' ? SETUP.audio.reverbCourte
            : nom === 'longue' ? SETUP.audio.reverbLongue
            : (SETUP.audio.reverbCourte + SETUP.audio.reverbLongue) / 2;
  try{ A.conv.buffer = irBuffer(A.ctx, sec); }catch(e){}
}

/** Ferme ou rouvre le mur : appelé quand on entre / sort d'une cachette. */
export function murer(oui){
  if(!A.ctx || !A.mur) return;
  A.mur.frequency.setTargetAtTime(
    oui ? SETUP.cachettes.filtreSon : 20000, A.ctx.currentTime, 0.35);
}

/** Impulsion courte, hors nappe. La brique de tous les effets ponctuels. */
export function ping(freq, dur, gain, type, dest){
  if(!A.ctx) return;
  const t = A.ctx.currentTime;
  const o = A.ctx.createOscillator(), g = A.ctx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest || A.bus);
  o.start(t); o.stop(t + dur + 0.05);
  o.onended = () => { try{ g.disconnect(); }catch(e){} };
}

/** Un panner HRTF prêt à l'emploi, branché sur le bus. */
/**
 * Un panner HRTF. `refDistance` est le rayon dans lequel il n'atténue pas du
 * tout : le mettre grand fait du panner un pur outil de DIRECTION, et laisse
 * l'appelant gérer l'éloignement avec sa propre courbe. C'est ce qu'il faut
 * pour la créature, dont la double atténuation la rendait inaudible.
 */
export function panner(distanceMax, rolloff, refDistance = 2){
  const p = A.ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = refDistance;
  p.maxDistance = distanceMax;
  p.rolloffFactor = rolloff;
  p.connect(A.bus);
  return p;
}

export function placer(p, x, y, z){
  if(!p) return;
  if(p.positionX){ p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
  else p.setPosition(x, y, z);
}
