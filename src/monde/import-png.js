/* ═══ MONDE / IMPORT PNG ═══
   Lecture des cartes dessinées dans outils/releve.html.

   Format : une image de largeur PAIRE. Moitié gauche = biome (code couleur),
   moitié droite = cote en gris. La planche peut être bien plus grossière que
   la grille du jeu : on la rééchantillonne. Tu dessines un plan, pas
   1,18 million de cases.

   Quand la carte vient de toi, on NE RELAXE PAS le relief : la falaise que tu
   as tracée est voulue. C'est la relaxation qui rendait les cartes plates.

   Le code couleur vient de monde/biomes.js — une seule table pour le jeu et
   pour l'éditeur.                                                           */

import {GW, GH, idx} from './grille.js';
import {CODE_BIOME} from './biomes.js';

/* Porteur plutôt qu'un `export let` : une liaison réassignée ne survit pas à
   la concaténation du bundler. `importee.carte` vaut null en procédural. */
export const importee = {carte:null};

export function oublierCarte(){ importee.carte = null; }

/**
 * @returns null si tout va bien, sinon un message d'erreur à afficher.
 */
export function lireCartePNG(img){
  const MW = img.width >> 1, MH = img.height;
  if(MW < 8 || MH < 8 || img.width !== MW*2)
    return `format inattendu : largeur paire attendue (biome | cote), reçu ${img.width} × ${img.height}`;

  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;

  const B = new Uint8Array(GW*GH), A = new Float32Array(GW*GH);
  for(let z=0; z<GH; z++) for(let x=0; x<GW; x++){
    const mx = Math.min(MW-1, (x*MW/GW)|0), mz = Math.min(MH-1, (z*MH/GH)|0);
    let p = (mz*MW*2 + mx) * 4;
    let best = 0, bd = 1e9;
    CODE_BIOME.forEach((c2,k) => {
      const dd = (d[p]-c2[0])**2 + (d[p+1]-c2[1])**2 + (d[p+2]-c2[2])**2;
      if(dd < bd){ bd = dd; best = k; }
    });
    const i = idx(x,z);
    B[i] = best;
    p = (mz*MW*2 + MW + mx) * 4;
    // L'amplitude suit celle du monde procédural : ×3 par rapport à la v2,
    // sinon une carte dessinée serait un plateau au milieu d'un monde vertical.
    A[i] = best === 0 ? 0 : (d[p]-128)/127 * 120;
  }
  importee.carte = {biome:B, alt:A};
  return null;
}
