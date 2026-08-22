/* ═══ CARTE / CATALOGUE ═══
   Sondage des dossiers déclarés dans rangs.js et chargement des images.

   Le sondage est volontairement naïf : on demande 1.gif, 2.gif… au serveur
   jusqu'à trois 404 d'affilée. Pas de manifeste à maintenir, pas d'API : tu
   déposes des fichiers dans un dossier et ils sont dans le jeu.

   Si aucun dossier n'est rempli (ou si on est en file://), CATALOGUE reste
   vide et le reste du jeu bascule sur les noms de repli. Rien ne casse.    */

import {RANGS, NOMS_REPLI} from './rangs.js';

/** [{rang:index, n:numéro, img:HTMLImageElement}] — l'ordre EST l'identifiant. */
export const CATALOGUE = [];

export const etat = {sonde:false, enCours:false};

const ECHECS_AVANT_ARRET = 3;

/**
 * Sonde les trois dossiers en parallèle.
 * @param apres  appelé une fois les trois dossiers épuisés
 */
export function sonderStacks(apres){
  if(etat.enCours) return;
  etat.enCours = true;
  CATALOGUE.length = 0;

  let restants = RANGS.length;
  const fini = () => {
    if(--restants === 0){
      // ordre stable : rang puis numéro. Sinon l'identifiant d'une carte
      // changerait d'une partie à l'autre et la collection serait fausse.
      CATALOGUE.sort((a,b) => a.rang - b.rang || a.n - b.n);
      etat.sonde = true; etat.enCours = false;
      if(apres) apres();
    }
  };

  RANGS.forEach((st, si) => {
    let n = 1, echecs = 0;
    const suivant = () => {
      if(echecs >= ECHECS_AVANT_ARRET){ fini(); return; }
      const img = new Image();
      img.onload  = () => { CATALOGUE.push({rang:si, n, img}); echecs = 0; n++; suivant(); };
      img.onerror = () => { echecs++; n++; suivant(); };
      img.src = st.chemin + n + '.' + st.ext;
    };
    suivant();
  });
}

/** Nombre total de cartes collectionnables dans cette installation. */
export function total(){
  return CATALOGUE.length || RANGS.length * NOMS_REPLI.length;
}

/**
 * Identité d'une carte par son identifiant.
 * @returns {rang, nom, img}   img est undefined en mode repli.
 */
export function identite(id){
  if(CATALOGUE.length && CATALOGUE[id]){
    const e = CATALOGUE[id];
    return {rang: e.rang, nom: RANGS[e.rang].nom.toUpperCase() + ' ' + e.n, img: e.img};
  }
  const rang = Math.min(RANGS.length - 1, Math.floor(id / NOMS_REPLI.length));
  return {rang, nom: NOMS_REPLI[id % NOMS_REPLI.length]};
}

/** Un identifiant au hasard dans un rang donné. */
export function tirerDansRang(rang, ri){
  if(CATALOGUE.length){
    const indices = [];
    for(let i=0;i<CATALOGUE.length;i++) if(CATALOGUE[i].rang === rang) indices.push(i);
    if(indices.length) return indices[ri(0, indices.length - 1)];
    return 0;
  }
  return rang * NOMS_REPLI.length + ri(0, NOMS_REPLI.length - 1);
}
