/* ═══ RENDU / CAMÉRA ═══
   Matrices de vue et TREMBLEMENT SISMIQUE.

   ── POURQUOI C'ÉTAIT INVISIBLE (v2) ────────────────────────────────────────
   Le tremblement valait sin(temps*47) × 0.035 sur l'œil et × 0.012 sur le
   lacet. Trois problèmes :
     1. les amplitudes étaient minuscules ;
     2. une seule sinusoïde donne un vibreur de téléphone, pas un séisme ;
     3. IL N'Y AVAIT PAS DE ROULIS. La chaîne de vue était rotX · rotY · trans,
        sans rotZ. Or c'est le roulis qui fait sentir que le SOL bouge : sans
        lui, on croit juste que la tête tremble.

   ── LA v3 ──────────────────────────────────────────────────────────────────
     · amplitudes ×3,5 (réglables dans SETUP.camera) ;
     · trois sinusoïdes de fréquences incommensurables par axe ;
     · un roulis ajouté à la chaîne de vue ;
     · l'intensité dépend de la DISTANCE, de la VITESSE RÉELLE de la créature
       et de son état. Une créature immobile ne fait pas trembler le sol ;
       en poursuite à pleine vitesse à dix mètres, c'est violent.

   Le tremblement alimente aussi joueur/chute.js : au-delà d'un seuil, on tombe. */

import {SETUP} from '../setup.js';
import {M, clamp, lerp} from '../noyau/math.js';
import {ST} from '../creatures/etats.js';

export const proj  = M.mk();
export const view  = M.mk();
export const model = M.mk();
const _c = M.mk(), _d = M.mk(), _e = M.mk(), _f = M.mk();

/** Ce que la caméra a calculé cette image. Lu par le pipeline et le HUD. */
export const cam = {
  x:0, y:0, z:0,
  yaw:0, pitch:0, roll:0,
  fwd:[0,0,-1],
};

/**
 * Cumule les sources de tremblement. Appelé avant construireVue().
 * @param joueur    porte .shake, modifié ici
 * @param creature  .x .z .state .vitesse
 * @param jeunes    tableau, chacun avec .proche
 * @param secousseEvt  tremblement imposé par un événement (effondrement)
 */
export function majTremblement(dt, joueur, creature, jeunes, secousseEvt){
  const C = SETUP.camera;
  let cible = 0;

  // ── la mère ──
  const d = Math.hypot(joueur.x - creature.x, joueur.z - creature.z);
  if(d < C.porteeTremblement){
    const prox = 1 - d / C.porteeTremblement;
    // une créature immobile ne fait pas trembler le sol
    const mvt = clamp(creature.vitesse / SETUP.creature.vitesseTraque, 0, 1);
    const etat = creature.state === ST.CHASE ? 1.0
               : creature.state === ST.LISTEN ? 0.15
               : 0.55;
    cible = Math.max(cible,
      prox*prox * etat * lerp(1 - C.poidsVitesse, 1, mvt));
  }

  // ── les jeunes : moins fort, mais ils sont plusieurs ──
  for(const j of jeunes){
    if(j.proche >= 18) continue;
    cible = Math.max(cible, (1 - j.proche/18) * 0.55);
  }

  // ── un événement (effondrement) écrase tout ──
  if(secousseEvt > 0) cible = Math.max(cible, secousseEvt);

  // montée immédiate, descente amortie : on sent l'arrivée, pas le départ
  if(cible > joueur.shake) joueur.shake = cible;
  else joueur.shake = Math.max(cible, joueur.shake - dt*C.decroissance);
  joueur.shake = clamp(joueur.shake, 0, 1);
}

/** Somme de trois sinus incommensurables : un bruit, pas un vibreur. */
const secousse = (t, f1, f2, f3) =>
  (Math.sin(t*f1) * 0.55 + Math.sin(t*f2) * 0.30 + Math.sin(t*f3) * 0.15);

/**
 * Construit proj et view. Renvoie la hauteur d'œil réellement utilisée.
 * @param vision  facteur de champ venant du froid (rétrécit le FOV)
 * @param derive  tremblement de main : dérive lente de la visée
 */
export function construireVue(joueur, temps, aspect, vision, derive){
  const C = SETUP.camera;
  const sk = joueur.shake;
  const sk2 = sk*sk;                       // la secousse monte plus vite que linéairement

  const dy   = secousse(temps, 47, 31.3, 19.7) * C.tremblementOeil   * sk2;
  const dyaw = secousse(temps, 39, 27.1, 16.3) * C.tremblementLacet  * sk2;
  const drol = secousse(temps, 23, 13.7,  8.9) * C.tremblementRoulis * sk2;

  // dérive de main due au froid : très lente, presque sournoise
  const dmx = derive > 0 ? Math.sin(temps*0.83)*derive*0.045 : 0;
  const dmy = derive > 0 ? Math.sin(temps*0.61)*derive*0.030 : 0;

  const eyeY  = joueur.gy + joueur.eye + dy;
  const yaw   = joueur.yaw   + dyaw + dmx;
  const pitch = joueur.pitch + dmy;

  cam.x = joueur.x; cam.y = eyeY; cam.z = joueur.z;
  cam.yaw = yaw; cam.pitch = pitch; cam.roll = drol;

  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  cam.fwd = [-Math.sin(yaw)*cp, sp, -Math.cos(yaw)*cp];

  // le froid resserre le champ : c'est l'effet le plus lisible du palier GELÉ
  M.persp(proj, SETUP.image.fov * clamp(vision, 0.5, 1), aspect, 0.05, 300);

  M.trans(_c, -joueur.x, -eyeY, -joueur.z);
  M.rotY(_d, -yaw);      M.mul(_e, _d, _c);
  M.rotX(_d, -pitch);    M.mul(_f, _d, _e);
  M.rotZ(_d, -drol);     M.mul(view, _d, _f);   // ← le roulis, absent en v2

  return eyeY;
}
