/* ═══ JOUEUR / VUE DE L'ARME ═══
   Ce qu'on tient. Dessiné devant la caméra, à la première personne.

   ── POURQUOI CE N'EST PAS UN ÉLÉMENT DE DÉCOR DE PLUS ──────────────────────
   Une arme en main ne vit pas dans le monde : elle suit la caméra, elle ne
   doit être ni brouillardée ni masquée par une paroi, et elle est éclairée par
   la lampe qu'on tient — c'est-à-dire par une source qui est exactement à
   l'œil. Passer par le maillage des pavés reviendrait à la reconstruire à
   chaque pas.

   Elle est donc cuite UNE FOIS, à l'origine, puis posée devant l'œil par une
   matrice. La géométrie vient de `monde/props.js` : la même que celle qui
   traîne au sol, la même que celle qu'on retouche dans la forge.

   ── LE BALANCEMENT ─────────────────────────────────────────────────────────
   Trois mouvements se superposent, et il les faut tous les trois pour que
   l'objet paraisse tenu plutôt que collé à l'écran :

     · le PAS — l'arme monte et descend avec la marche ;
     · le RETARD — quand on tourne la tête, elle suit avec un temps de retard ;
     · le COUP — l'animation de frappe, pilotée par `armes.balan`.

   Sans le retard, on tient une décalcomanie. C'est le moins cher des trois et
   celui qui change le plus.                                                 */

import {SETUP} from '../setup.js';
import {gl, libererMesh} from '../noyau/gl.js';
import {M} from '../noyau/math.js';
import {cuireParts} from '../monde/maillage.js';
import {armes, armeCourante} from './armes.js';

/* Le maillage de chaque arme, cuit à la demande et gardé. Il y en a deux :
   inutile d'inventer une gestion de cache. */
const maillages = new Map();

/** Retard de la visée sur le regard. */
const retard = {yaw: 0, pitch: 0};

const mat = M.mk(), _a = M.mk(), _b = M.mk(), _c = M.mk();

/**
 * @param fabriquer  (nomModele) => [parts] — fourni par jeu.js, qui seul sait
 *                   appeler addProp dans un bac à sable
 */
export function maillagePour(nomModele, fabriquer){
  if(!nomModele) return null;
  if(maillages.has(nomModele)) return maillages.get(nomModele);
  let m = null;
  try{
    const parts = fabriquer(nomModele);
    m = parts && parts.length ? cuireParts(parts) : null;
  }catch(e){
    console.warn('arme', nomModele, e);
  }
  maillages.set(nomModele, m);
  return m;
}

export function viderMaillages(){
  for(const m of maillages.values()) if(m) libererMesh(m);
  maillages.clear();
}

export function majVueArme(dt, joueur){
  /* Le retard : on interpole vers le regard, jamais dessus. Le coefficient
     dépend de dt pour que le ressenti ne change pas avec la fréquence
     d'images — à 30 ips comme à 144. */
  const k = 1 - Math.exp(-SETUP.armes.suiviRegard * dt);
  // l'écart d'angle, ramené dans [-π, π] : sinon un passage par ±π fait
  // faire un tour complet à l'arme
  let d = joueur.yaw - retard.yaw;
  while(d >  Math.PI) d -= Math.PI*2;
  while(d < -Math.PI) d += Math.PI*2;
  retard.yaw += d * k;
  retard.pitch += (joueur.pitch - retard.pitch) * k;
}

/**
 * La matrice modèle de l'arme, dans le repère du monde.
 * @returns null s'il n'y a rien à dessiner
 */
export function matriceArme(joueur, oeilY, temps){
  const A = armeCourante();
  if(!A.modele) return null;
  const S = SETUP.armes;

  // le balancement du pas : deux fois la cadence en vertical, une en latéral
  const marche = Math.min(1, joueur.vitesse / 3.2);
  const bx = Math.sin(joueur.bob) * S.balanLateral * marche;
  const by = Math.cos(joueur.bob * 2) * S.balanVertical * marche;

  /* Le coup. `balan` va de 1 à 0 ; on en tire une courbe qui part vite et
     revient doucement — un coup est un geste asymétrique. */
  const b = armes.balan;
  const coup = b * b * (3 - 2*b);
  const avance = coup * (A.genre === 'melee' ? 0.42 : 0.10);
  const leve   = coup * (A.genre === 'melee' ? 0.55 : 0.06);
  const recul  = coup * (A.genre === 'tir' ? 0.14 : 0);

  /* Le décalage de visée : l'arme est tenue à droite et en bas, comme on
     tient réellement quelque chose. Le retard sur le regard s'ajoute ici. */
  let ecartY = (joueur.yaw - retard.yaw) * S.amplitudeRetard;
  const ecartP = (joueur.pitch - retard.pitch) * S.amplitudeRetard;

  const dx = S.tenueX + bx + ecartY;
  const dy = S.tenueY + by + ecartP + leve;
  const dz = -(S.tenueZ - avance + recul);      // -Z : devant la caméra

  /* Passage du repère caméra au monde. On refait la rotation de la vue, à
     l'envers : lacet puis tangage, appliqués à l'écart de tenue. */
  const cp = Math.cos(-joueur.pitch), sp = Math.sin(-joueur.pitch);
  const y1 = dy*cp - dz*sp, z1 = dy*sp + dz*cp;
  const cy = Math.cos(joueur.yaw), sy = Math.sin(joueur.yaw);
  const wx = dx*cy + z1*sy;
  const wz = -dx*sy + z1*cy;

  /* L'arme est bâtie couchée le long de +X, poignée vers l'arrière. On la
     tourne pour qu'elle pointe devant, puis on ajoute le tangage et
     l'inclinaison du coup. */
  M.trans(_a, joueur.x + wx, oeilY + y1, joueur.z + wz);
  M.rotY(_b, joueur.yaw + S.orientation);   M.mul(_c, _a, _b);
  M.rotZ(_b, -joueur.pitch + coup * S.inclinaisonCoup); M.mul(mat, _c, _b);
  return mat;
}

/** L'arme est-elle assez avancée dans son coup pour porter ? */
export const auContact = () => armes.balan > 0.55;
