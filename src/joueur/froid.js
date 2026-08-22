/* ═══ JOUEUR / FROID ═══
   LA RÈGLE DU FROID. Une seule, écrite ici, tenue partout.

   ── POURQUOI UNE RÉÉCRITURE ────────────────────────────────────────────────
   « Je ne comprends pas le système de froid. Il ne fait rien. »
   C'était exact. La v2 perdait entre 0,0008 et 0,0046 par seconde — soit plus
   de trois minutes pour descendre d'un tiers en surface gelée, et près d'une
   demi-heure sous terre — pour un seul effet, un ralentissement à peine
   perceptible sous 34 %. Aucun signal, aucun palier, aucune conséquence.

   ── LA RÈGLE ───────────────────────────────────────────────────────────────
   chaleur ∈ [0,100], départ 100.

     perte/s = base(biome) × exposition × mouvement × torche × géothermie

       base         par biome, dans SETUP.froid.base
                    souterrain 0.35 · barrage 0.50 · ville 0.60
                    glacière 1.60 · surface gelée 2.20
       exposition   1 + 1.4 × force_du_vent
                    ×0.5 sous plafond bas · 0 en cachette
       mouvement    marche 0.85 · course 0.70 · immobile 1.25 · rampé 1.10
                    (bouger produit de la chaleur ; rester planté te tue)
       torche       allumée 0.55 · éteinte 1.00
                    (elle ralentit la perte, elle ne réchauffe pas)
       géothermie   −0,4 % par mètre sous 0 m, plancher à ×0.35
                    DESCENDRE RÉCHAUFFE.

     gain/s = brasero +14 · cachette +3.5

   ── LES QUATRE PALIERS ─────────────────────────────────────────────────────
     100–70  —              aucun effet
      70–40  ENGOURDI       vitesse ×0.88 · souffle audible (r=4) : tu es repérable
      40–15  GELÉ           vitesse ×0.65 · vision −18 % · tremblement de main
      15– 0  HYPOTHERMIE    vitesse ×0.45 · vision −32 % · image désaturée ·
                            battement de cœur · 20 s à zéro = mort

   ── L'ÉQUILIBRE ────────────────────────────────────────────────────────────
   La géothermie est le point de bascule du jeu : les cartes rares sont au fond
   (carte/placement.js) ET il y fait plus chaud. Le froid ne combat donc pas la
   collection, il combat l'hésitation — rester en surface à tourner en rond est
   ce qui te tue.                                                             */

import {SETUP} from '../setup.js';
import {clamp} from '../noyau/math.js';
import {degagement, biomeAt} from '../monde/grille.js';

export const froid = {
  chaleur: SETUP.froid.depart,
  palier: 0,               // index dans SETUP.froid.paliers
  nomPalier: '—',
  aZero: 0,                // secondes passées à zéro
  message: null,           // texte à afficher au franchissement d'un seuil
  messageT: 0,
  souffleT: 0,
  coeurT: 0,
};

export function reinitialiserFroid(){
  froid.chaleur = SETUP.froid.depart;
  froid.palier = 0; froid.nomPalier = '—';
  froid.aZero = 0; froid.message = null; froid.messageT = 0;
}

/** Le palier courant, tel que décrit dans SETUP.froid.paliers. */
export function palierCourant(){
  return SETUP.froid.paliers[froid.palier];
}

/**
 * Applique la règle. Retourne ce que le reste du jeu doit savoir.
 *
 * @param dt
 * @param joueur       .x .z .gy .mode .abrite
 * @param vent         force du vent 0..1 (audio/vent.js)
 * @param presBrasero  true si un refuge est à portée
 * @param hooks        {souffle(i), coeur(i)}
 * @returns {vitesse, vision, derive, mort}
 */
export function updateFroid(dt, joueur, vent, presBrasero, hooks){
  const F = SETUP.froid;
  const H = hooks || {};

  /* ── GAIN ── */
  let delta = 0;
  if(presBrasero)      delta += F.gainBrasero;
  else if(joueur.abrite) delta += F.gainCachette;

  /* ── PERTE ── */
  if(!presBrasero){
    const bi = biomeAt(joueur.x, joueur.z);
    const base = F.base[bi] !== undefined ? F.base[bi] : F.base[0];

    let exposition;
    if(joueur.abrite) exposition = F.exposCachette;
    else {
      exposition = 1 + F.exposVent * clamp(vent, 0, 1);
      if(degagement(joueur.x, joueur.z) < 2.6) exposition *= F.exposPlafondBas;
    }

    const mouvement =
        joueur.mode === 'run'    ? F.mvtCourse
      : joueur.mode === 'crouch' ? F.mvtRampe
      : joueur.mode === 'prone'  ? F.mvtImmobile
      : joueur.vitesse > 0.4     ? F.mvtMarche
      :                            F.mvtImmobile;

    const torche = joueur.torcheAllumee ? F.torcheAllumee : F.torcheEteinte;

    // géothermie : plus on descend, moins on perd
    const geo = joueur.gy < 0
      ? Math.max(F.geoPlancher, 1 + joueur.gy * F.geoParMetre)
      : 1;

    delta -= base * exposition * mouvement * torche * geo;
  }

  froid.chaleur = clamp(froid.chaleur + delta*dt, 0, 100);

  /* ── PALIER ── */
  let p = F.paliers.length - 1;
  for(let i=0;i<F.paliers.length;i++)
    if(froid.chaleur >= F.paliers[i].min){ p = i; break; }
  if(p !== froid.palier){
    const descend = p > froid.palier;
    froid.palier = p;
    froid.nomPalier = F.paliers[p].nom;
    // On n'annonce que l'aggravation : reprendre du poil de la bête se sent.
    if(descend && F.paliers[p].nom !== '—'){
      froid.message = F.paliers[p].nom;
      froid.messageT = 3.5;
    } else if(!descend && F.paliers[p].nom === '—'){
      froid.message = 'RÉCHAUFFÉ'; froid.messageT = 2.0;
    }
  }
  if(froid.messageT > 0){
    froid.messageT -= dt;
    if(froid.messageT <= 0) froid.message = null;
  }

  const P = F.paliers[froid.palier];

  /* ── EFFETS AUDIBLES ──
     Le souffle est une VIBRATION dans le monde, pas seulement un son : à
     partir d'ENGOURDI, avoir froid te rend repérable. C'est la conséquence de
     jeu qui manquait complètement en v2. */
  let souffleRayon = 0;
  if(P.souffle > 0){
    froid.souffleT -= dt;
    if(froid.souffleT <= 0){
      froid.souffleT = 3.2 - froid.palier*0.6;
      souffleRayon = P.souffle;
      if(H.souffle) H.souffle(0.4 + froid.palier*0.3);
    }
  }
  if(froid.palier === 3){
    froid.coeurT -= dt;
    if(froid.coeurT <= 0){
      froid.coeurT = 1.1;
      if(H.coeur) H.coeur(1 - froid.chaleur/15);
    }
  }

  /* ── MORT ── */
  if(froid.chaleur <= 0.01) froid.aZero += dt;
  else froid.aZero = 0;

  return {
    vitesse: P.vitesse,
    vision:  P.vision,
    derive:  P.derive,
    souffleRayon,
    mort: froid.aZero >= F.delaiMort,
  };
}

/** 0 en pleine forme, 1 en hypothermie totale. Pilote uFroid et uCoeur. */
export function intensiteVisuelle(){
  if(froid.palier < 2) return 0;
  const P = SETUP.froid.paliers[froid.palier];
  const suivant = SETUP.froid.paliers[froid.palier - 1];
  const t = 1 - (froid.chaleur - P.min) / Math.max(1, suivant.min - P.min);
  return clamp((froid.palier - 1.5) * 0.55 + t*0.35, 0, 1);
}
