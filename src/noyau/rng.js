/* ═══ NOYAU / RNG ═══
   Générateur congruentiel linéaire à graine explicite. Toute la génération du
   monde passe par ici : une même graine redonne exactement le même monde, ce
   qui rend les bugs de terrain reproductibles.

   Ne pas confondre avec Math.random(), qui reste utilisé pour l'audio et les
   effets visuels — eux n'ont pas besoin d'être rejouables. */

let etat = (Date.now() >>> 0) ^ 0x9e3779b9;
let graineCourante = etat;

/** Fixe la graine. Passer undefined en tire une nouvelle au hasard. */
export function semer(g){
  graineCourante = (g === undefined ? (Math.random()*4294967295) : g) >>> 0;
  etat = graineCourante;
  return graineCourante;
}

/** La graine du monde actuellement en mémoire. Affichée dans le HUD. */
export const graine = () => graineCourante;

/** Flottant dans [0,1[. */
export function rnd(){
  etat = (etat * 1664525 + 1013904223) & 0xffffffff;
  return ((etat >>> 8) & 0xffffff) / 0xffffff;
}

/** Entier dans [a,b], bornes comprises. */
export const ri = (a,b) => a + Math.floor(rnd() * (b - a + 1));

/** Flottant dans [a,b[. Raccourci très utilisé par le décor. */
export const rf = (a,b) => a + rnd() * (b - a);

/** Un élément au hasard dans un tableau. */
export const rchoix = (arr) => arr[ri(0, arr.length - 1)];
