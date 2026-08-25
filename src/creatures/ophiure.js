/* ═══ CRÉATURES / OPHIURE ═══
   Le colosse. Un disque et cinq bras, sur le plan du fossile.

   ── CE QU'ELLE EST, ET CE QU'ELLE N'EST PAS ────────────────────────────────
   Ce n'est PAS un second prédateur. Deux prédateurs se marchent dessus : toute
   l'identité du scolopandre tient dans « elle est aveugle, elle t'entend »,
   et un colosse qui chasserait jouerait sur le même registre en le diluant.

   L'ophiure ne chasse pas. Elle TRAVERSE. Elle part d'un bord du monde, va
   vers un autre, et ce qu'elle rencontre cesse d'exister — murs éventrés,
   plafonds effondrés, gouffres ouverts. On ne la combat pas, on ne la fuit
   même pas vraiment : on s'écarte de son chemin, et on récupère un monde
   modifié.

   C'est un ÉVÉNEMENT, au sens propre : rare, sans rapport avec ce que fait le
   joueur, et irréversible.

   ── LA RÈGLE ABSOLUE : SON CHEMIN IGNORE LE JOUEUR ─────────────────────────
   « Si la planque se situe sur son chemin elle est détruite et on perd tout,
   RAF. Mais tu ne dois absolument pas programmer que le monstre ait une
   chance de passer de n % sur ton terrier. Tout est purement aléatoire. »

   C'est la règle, et elle est tenue STRUCTURELLEMENT, pas sur parole :

     CE MODULE N'IMPORTE PAS monde/cachettes.js.
     CE MODULE NE REÇOIT JAMAIS LA POSITION DU JOUEUR.

   Il ne peut donc pas viser, même par accident, même dans six mois quand
   quelqu'un voudra « améliorer la mise en scène ». La trajectoire se déduit
   du monde seul : deux points sur la bordure, tirés au sort, et une ligne
   entre les deux.

   `outils/smoke_ophiure.py` vérifie l'absence de cet import. Une garantie
   qu'on peut lire dans le code vaut mieux qu'une intention dans un
   commentaire — y compris celui-ci.

   ── POURQUOI CINQ BRAS SUR UN DISQUE ───────────────────────────────────────
   C'est le plan de l'ophiure fossile : symétrie pentaradiale, disque central,
   bras très longs, très fins, sinueux, effilés. La machinerie existait déjà —
   le corps du scolopandre est un tube construit le long d'une courbe. Cinq
   bras, c'est cinq courbes qui partent d'un même point.                     */

import {SETUP} from '../setup.js';
import {rnd, ri, rf} from '../noyau/rng.js';
import {
  GW, GH, CELL, floorH, ceilH, openN, idx, isFloor, c2w, w2c, groundAt,
} from '../monde/grille.js';
import {effondrer} from '../monde/destruction.js';

/* ═══════════════ ÉTAT ═══════════════ */

export const ophiure = {
  active: false,
  x: 0, z: 0, y: 0,
  cap: 0,                    // direction de marche, en radians
  parcouru: 0,               // mètres depuis l'entrée
  longueur: 0,               // distance totale de la traversée
  t: 0,                      // temps depuis l'apparition
  prochaine: 0,              // secondes avant la prochaine traversée
  /* Les cinq bras. Chacun garde l'historique de son extrémité, exactement
     comme le corps de la mère garde celui de sa tête : c'est ce qui leur
     donne leur sinuosité sans qu'on ait à l'animer. */
  bras: [],
  derniereDestruction: 0,
};

export function reinitialiserOphiure(){
  ophiure.active = false;
  ophiure.bras = [];
  ophiure.t = 0;
  ophiure.parcouru = 0;
  ophiure.derniereDestruction = 0;
  const S = SETUP.ophiure;
  ophiure.prochaine = rf(S.premiereMin, S.premiereMax);
}

/* ═══════════════ LA TRAVERSÉE ═══════════════ */

/**
 * Elle entre.
 *
 * Deux points de bordure tirés au sort, et une ligne. C'est TOUT ce qui
 * décide de son chemin. Aucun argument de cette fonction ne parle du joueur,
 * et c'est délibéré : la seule façon de garantir qu'on ne triche pas est de
 * ne pas avoir l'information.
 */
export function entrer(){
  const S = SETUP.ophiure;
  const M = GW * CELL;

  // un bord, puis le bord opposé — elle traverse, elle ne longe pas
  const bord = ri(0, 3);
  const t0 = rnd(), t1 = rnd();
  const P = (b, t) => b === 0 ? [t*M, 0]
                    : b === 1 ? [M, t*M]
                    : b === 2 ? [t*M, M]
                    :           [0, t*M];
  const a = P(bord, t0), b2 = P((bord + 2) % 4, t1);

  ophiure.x = a[0]; ophiure.z = a[1];
  ophiure.cap = Math.atan2(b2[1] - a[1], b2[0] - a[0]);
  ophiure.longueur = Math.hypot(b2[0]-a[0], b2[1]-a[1]);
  ophiure.parcouru = 0;
  ophiure.t = 0;
  ophiure.active = true;
  ophiure.y = groundAt(ophiure.x, ophiure.z);

  /* Les cinq bras, à cent quarante-quatre degrés d'écart. Chacun démarre
     droit ; sa sinuosité vient ensuite de son histoire, pas d'une formule. */
  ophiure.bras = [];
  for(let k = 0; k < 5; k++){
    ophiure.bras.push({
      angle: k / 5 * 6.283,
      phase: rnd() * 6.283,
      longueur: S.brasLongMin + rnd() * (S.brasLongMax - S.brasLongMin),
      hist: [],
    });
  }
  return {x: ophiure.x, z: ophiure.z, cap: ophiure.cap};
}

export function sortir(){
  ophiure.active = false;
  ophiure.bras = [];
  const S = SETUP.ophiure;
  ophiure.prochaine = rf(S.entreDeuxMin, S.entreDeuxMax);
}

/**
 * Elle avance, et ce qu'elle traverse cesse d'exister.
 *
 * @param dt
 * @param surDestruction  rappel (x, z, issue) — jeu.js s'en sert pour le son
 *                        et la secousse. Ce module ne connaît ni l'audio ni
 *                        la caméra.
 */
export function majOphiure(dt, surDestruction){
  const S = SETUP.ophiure;

  if(!ophiure.active){
    ophiure.prochaine -= dt;
    if(ophiure.prochaine <= 0) return entrer();
    return null;
  }

  ophiure.t += dt;

  // ── elle avance, lentement et sans dévier ──
  const v = S.vitesse;
  ophiure.x += Math.cos(ophiure.cap) * v * dt;
  ophiure.z += Math.sin(ophiure.cap) * v * dt;
  ophiure.parcouru += v * dt;
  ophiure.y = groundAt(ophiure.x, ophiure.z);

  if(ophiure.parcouru >= ophiure.longueur){ sortir(); return null; }

  /* ── les bras ──
     Chacun balaie lentement autour du disque. On garde l'historique de son
     extrémité : le bras est ensuite construit le long de cette trace, ce qui
     lui donne sa sinuosité sans qu'on ait à l'animer image par image. */
  for(const b of ophiure.bras){
    b.angle += Math.sin(ophiure.t * S.balayage + b.phase) * dt * S.amplitudeBras;
    const ex = ophiure.x + Math.cos(b.angle + ophiure.cap) * b.longueur;
    const ez = ophiure.z + Math.sin(b.angle + ophiure.cap) * b.longueur;
    b.hist.push({x: ex, z: ez, y: groundAt(ex, ez) + rf(0.2, 1.4)});
    if(b.hist.length > S.memoireBras) b.hist.shift();
  }

  /* ── ELLE DÉTRUIT ──
     Pas en continu — ce serait un rouleau compresseur, et ça coûterait un
     remaillage par image. À intervalle, sous le disque et sous les bras. */
  ophiure.derniereDestruction += dt;
  if(ophiure.derniereDestruction < S.intervalleDestruction) return null;
  ophiure.derniereDestruction = 0;

  const cibles = [{x: ophiure.x, z: ophiure.z, r: S.rayonDisque}];
  for(const b of ophiure.bras){
    if(rnd() > S.partBrasDestructeurs) continue;
    const e = b.hist[b.hist.length - 1];
    if(e) cibles.push({x: e.x, z: e.z, r: S.rayonBras});
  }

  for(const c of cibles){
    const cx = w2c(c.x), cz = w2c(c.z);
    if(cx < 3 || cz < 3 || cx >= GW-3 || cz >= GH-3) continue;
    if(!isFloor(cx, cz)) continue;
    const r = effondrer(cx, cz, c.r);
    if(r.issue && surDestruction) surDestruction(c.x, c.z, r.issue);
  }
  return null;
}

/** À quelle distance est-elle ? Sert au son et au tremblement. */
export function distanceOphiure(wx, wz){
  if(!ophiure.active) return Infinity;
  return Math.hypot(ophiure.x - wx, ophiure.z - wz);
}
