/* ═══ CRÉATURES / LUEURS ═══
   Ce qui rend le scoléopandre terrifiant : les yeux, les pattes, la carapace.

   ── LES YEUX ───────────────────────────────────────────────────────────────
   Deux points rouges, injectés dans le tableau de lumières du rendu. Comme
   rendu/lumieres.js alimente ensuite les `uSun[]` du post-process, les yeux
   produisent AUTOMATIQUEMENT des godrays rouges dans le fog : on les voit bien
   avant la silhouette, à travers la brume, sans une ligne de code de rendu
   dédiée. C'est la brique qui rend « visibles de loin » presque gratuit.

   ── LA GRAMMAIRE DE COULEUR ────────────────────────────────────────────────
   C'est un signal de jeu, donc une RÈGLE, constante et lisible :

     traque / retrait   rouge sombre       ×1.0   elle ne sait pas où tu es
     écoute             rouge fixe         ×1.0   elle s'est arrêtée, elle écoute
     approche / fouille rouge vif, pulse   ×1.3   elle a une piste
     poursuite          orange-blanc       ×2.2   elle t'a. Elle arrive.

   « Si les yeux changent de couleur ou deviennent plus gros, c'est qu'ils ont
   envie de te bouffer. » Le fondu dure 0,4 s : assez pour qu'on voie le
   changement se produire, trop court pour qu'on ait le temps de réfléchir.

   ── LES INTERSTICES ────────────────────────────────────────────────────────
   Des bandes bioluminescentes entre les anneaux de la carapace. Au repos elles
   pulsent doucement — c'est un leurre, ça attire les proies. En poursuite
   elles S'ÉTEIGNENT d'un coup : l'extinction devient le signal d'attaque, et
   la créature disparaît visuellement au moment exact où elle charge.        */

import {SETUP} from '../setup.js';
import {clamp, lerp} from '../noyau/math.js';
import {ST} from './etats.js';

/** État de fondu des yeux. Un objet par créature (mère + chaque jeune). */
export function nouvelEtatYeux(){
  return {c:[0.45,0.03,0.02], taille:1.0, pulse:0.6, phase:0};
}

const PROFIL = {
  [ST.PATROL]:  'traque',
  [ST.RETREAT]: 'traque',
  [ST.LISTEN]:  'ecoute',
  [ST.INVEST]:  'approche',
  [ST.SEARCH]:  'approche',
  [ST.CHASE]:   'poursuite',
};

/**
 * Fait glisser l'état des yeux vers le profil de l'état courant.
 * @param E     état renvoyé par nouvelEtatYeux()
 * @param etat  une valeur de ST
 */
export function majYeux(E, etat, dt, temps){
  const Y = SETUP.creature.yeux;
  const cible = Y[PROFIL[etat] || 'traque'];
  const k = 1 - Math.exp(-dt / Math.max(0.05, Y.transition));
  for(let i=0;i<3;i++) E.c[i] = lerp(E.c[i], cible.c[i], k);
  E.taille = lerp(E.taille, cible.taille, k);
  E.pulse  = lerp(E.pulse,  cible.pulse,  k);
  E.phase += dt * (1 + E.pulse * 3);
  return E;
}

/** Facteur d'éclat instantané, pulsation comprise. */
export function eclat(E, temps){
  if(E.pulse < 0.05) return 1;                    // écoute : fixe, donc pire
  return 0.72 + 0.28 * Math.sin(E.phase * E.pulse * 2.4);
}

/**
 * Pousse les deux yeux dans le tableau de lumières temporaires du rendu.
 * @param sortie  tableau {x,y,z,c} consommé par rendu/lumieres.js
 * @param tete    {p:{x,y,z}, f:[..], r:[..], u:[..]} repère de la tête
 * @param rayon   rayon du corps à la tête — les yeux s'écartent avec
 */
export function poserLumieresYeux(sortie, E, tete, rayon, temps){
  const g = eclat(E, temps) * SETUP.creature.yeux.portee / 60;
  const s = tete, ec = rayon * 0.62 * E.taille;
  for(const sd of [1,-1]){
    sortie.push({
      x: s.p.x + s.f[0]*0.42 + s.r[0]*ec*sd,
      y: s.p.y + s.f[1]*0.42 + rayon*0.30,
      z: s.p.z + s.f[2]*0.42 + s.r[2]*ec*sd,
      c: [E.c[0]*g, E.c[1]*g, E.c[2]*g],
    });
  }
}

/**
 * Couleur émissive des pattes. Elles palpitent en suivant la vague de marche :
 * on lit sa démarche dans le noir avant même de la voir.
 * @param phase  phase de la patte dans le cycle
 */
export function couleurPatte(E, phase){
  const P = SETUP.creature.pattes;
  const v = (0.5 + 0.5*Math.sin(phase)) * P.emission * P.ondulation;
  return [
    0.10 + E.c[0]*0.30*v,
    0.09 + E.c[1]*0.30*v,
    0.08 + E.c[2]*0.30*v,
  ];
}

/**
 * Intensité des interstices de carapace. Forte au repos (leurre), quasi nulle
 * en poursuite (elle s'éteint pour charger).
 * @param chasse  vrai en poursuite
 * @param t       position 0..1 le long du corps — l'onde court vers la queue
 */
export function interstice(chasse, temps, t){
  const I = SETUP.creature.interstices;
  const base = chasse ? I.emissionChasse : I.emissionRepos;
  const onde = 0.45 + 0.55 * Math.sin(temps * (6.283/I.periode) - t * 9);
  return base * onde;
}

/** Teinte des interstices : le même rouge que les yeux, en plus froid. */
export function couleurInterstice(E, intensite){
  return [
    (0.22 + E.c[0]*0.55) * intensite,
    (0.05 + E.c[1]*0.55) * intensite,
    (0.06 + E.c[2]*0.75) * intensite,
  ];
}
