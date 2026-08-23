/* ═══ CARTE / CATALOGUE ═══
   Trouver les cartes présentes sur le disque, et les charger.

   ── POURQUOI LE SONDAGE NUMÉRIQUE A ÉTÉ ABANDONNÉ ──────────────────────────
   La v3 demandait `1.gif`, `2.gif`, `3.gif`… jusqu'à trois échecs d'affilée.
   Séduisant sur le papier : aucun manifeste à tenir. Mais ça impose de
   RENOMMER ses fichiers, et le jour où les vraies cartes sont arrivées —
   `carte_045.png`, `carte_046.png`… — le jeu n'en a trouvé aucune. Zéro. Sans
   le moindre message : le sondage échouait trois fois et concluait « dossier
   vide », ce qui est exactement ce qu'il était censé détecter.

   Un outil qui oblige à renommer cinquante fichiers pour lui plaire n'est pas
   un outil pratique, c'est un outil qui a gagné.

   ── COMMENT ON TROUVE, MAINTENANT ──────────────────────────────────────────
   On demande le DOSSIER au serveur et on lit ce qu'il répond. Le serveur du
   lanceur, comme `python -m http.server`, renvoie une page de liens : il
   suffit d'en extraire les noms de fichiers image. On dépose ses fichiers, ils
   sont dans le jeu, quel que soit leur nom.

   Si le serveur ne liste pas (hébergement statique), on retombe sur l'ancien
   sondage numérique. Rien ne casse, on perd juste la liberté de nommage.

   ── L'ORDRE EST L'IDENTIFIANT ──────────────────────────────────────────────
   Une carte est identifiée par sa place dans CATALOGUE. Le tri est donc
   strictement déterministe — rang, puis nom — sinon une collection sauvegardée
   désignerait d'autres cartes à la partie suivante.                         */

import {RANGS, NOMS_REPLI} from './rangs.js';

/** [{rang, nom, fichier, img}] — l'ordre EST l'identifiant. */
export const CATALOGUE = [];

export const etat = {sonde:false, enCours:false, methode:''};

/** Ce qu'on accepte comme carte. Le GIF anime ; les autres sont fixes. */
const EXTENSIONS = ['gif', 'png', 'webp', 'jpg', 'jpeg'];

const estImage = nom =>
  EXTENSIONS.includes((nom.split('.').pop() || '').toLowerCase());

/**
 * Les noms de fichiers d'un dossier, lus dans la page d'index du serveur.
 * @returns un tableau, vide si le serveur ne liste pas.
 */
async function lireDossier(chemin){
  try{
    const r = await fetch(chemin, {headers:{'Accept':'text/html'}});
    if(!r.ok) return [];
    const html = await r.text();
    // `python -m http.server` produit <a href="carte_045.png">carte_045.png</a>
    const noms = [];
    for(const m of html.matchAll(/href="([^"?#]+)"/g)){
      const brut = decodeURIComponent(m[1]).split('/').pop();
      if(brut && estImage(brut) && !noms.includes(brut)) noms.push(brut);
    }
    return noms;
  }catch(e){
    return [];                    // hors ligne, file://, ou pas de listage
  }
}

/** L'ancien sondage : 1.ext, 2.ext… jusqu'à trois échecs. Filet de secours. */
function sonderNumeros(chemin, ext, sur){
  let n = 1, echecs = 0;
  const trouves = [];
  const suivant = () => {
    if(echecs >= 3){ sur(trouves); return; }
    const f = n + '.' + ext;
    const img = new Image();
    img.onload  = () => { trouves.push({fichier:f, img}); echecs = 0; n++; suivant(); };
    img.onerror = () => { echecs++; n++; suivant(); };
    img.src = chemin + f;
  };
  suivant();
}

const charger = (url) => new Promise(res => {
  const img = new Image();
  img.onload  = () => res(img);
  img.onerror = () => res(null);
  img.src = url;
});

/**
 * Remplit CATALOGUE.
 * @param apres  appelé une fois les trois dossiers épuisés
 */
export async function sonderStacks(apres){
  if(etat.enCours) return;
  etat.enCours = true;
  CATALOGUE.length = 0;
  let parListage = 0, parSondage = 0;

  for(let si = 0; si < RANGS.length; si++){
    const st = RANGS[si];
    const noms = await lireDossier(st.chemin);

    if(noms.length){
      noms.sort();                                  // déterminisme
      const imgs = await Promise.all(noms.map(f => charger(st.chemin + f)));
      imgs.forEach((img, k) => {
        if(img) CATALOGUE.push({rang:si, nom:noms[k], fichier:noms[k], img});
      });
      parListage++;
    } else {
      await new Promise(res => sonderNumeros(st.chemin, st.ext, t => {
        for(const e of t)
          CATALOGUE.push({rang:si, nom:e.fichier, fichier:e.fichier, img:e.img});
        res();
      }));
      parSondage++;
    }
  }

  /* Rang puis nom : l'identifiant d'une carte ne doit pas changer d'une
     partie à l'autre, sinon la collection désigne autre chose. */
  CATALOGUE.sort((a, b) => a.rang - b.rang || (a.nom < b.nom ? -1 : 1));

  etat.sonde = true;
  etat.enCours = false;
  etat.methode = parListage
    ? (parSondage ? 'listage + sondage' : 'listage du dossier')
    : 'sondage numérique';
  if(apres) apres();
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
    // le nom affiché : le fichier sans extension, en capitales
    const lisible = e.nom.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').toUpperCase();
    return {rang: e.rang, nom: lisible, img: e.img, fichier: e.fichier};
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
