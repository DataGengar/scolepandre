/* ═══ CARTE / COLLECTION ═══
   Ce que tu possèdes, et la grille qui l'affiche.

   La collection survit à la mort et au changement de monde — c'est le seul
   état persistant du jeu. Elle est aussi sauvegardée dans localStorage : perdre
   une heure de collecte parce qu'on a rechargé l'onglet serait absurde.     */

import {RANGS} from './rangs.js';
import {CATALOGUE, identite, total} from './catalogue.js';

const CLE = 'scoleopandre.collection.v3';

export const possede = new Set();

export function charger(){
  try{
    const brut = localStorage.getItem(CLE);
    if(brut) for(const id of JSON.parse(brut)) possede.add(id);
  }catch(e){ /* mode privé, quota, peu importe : on joue sans sauvegarde */ }
}

export function ajouter(id){
  possede.add(id);
  try{ localStorage.setItem(CLE, JSON.stringify([...possede])); }catch(e){}
}

export function oublierTout(){
  possede.clear();
  try{ localStorage.removeItem(CLE); }catch(e){}
}

/** Redessine les deux grilles (menu et inventaire). */
export function majAffichage(){
  const n = total();
  for(const cible of ['grille','invG']){
    const el = document.getElementById(cible);
    if(!el) continue;
    let html = '';
    for(let id=0; id<n; id++){
      const {rang, nom, img} = identite(id);
      const eue = possede.has(id);
      const R = RANGS[rang];
      const col = `rgb(${R.couleur.map(v => Math.round(v*255)).join(',')})`;
      /* L'image est une VRAIE balise <img>, plus un fond CSS.
         Deux raisons, et la seconde est celle qui compte :
           · `background:#000` posait un rectangle noir derrière une carte
             découpée — le défaut signalé en jeu, à l'identique ;
           · un GIF animé en fond CSS s'anime, mais on ne peut pas le cliquer
             ni l'agrandir. En balise, il se manipule. */
      html += `<div class="carte${eue?' eue':''}" title="${nom}"`
        + (eue ? ` data-id="${id}"` : '')
        + ` style="${eue ? `box-shadow:0 0 22px ${col}33` : ''}">`
        + (eue
            ? (img ? `<img src="${img.src}" alt="${nom}">`
                   : `${nom}<br><span style="color:${col};font-size:7px">${R.nom.toUpperCase()}</span>`)
            : '—')
        + '</div>';
    }
    el.innerHTML = html;
  }
  const e = document.getElementById('oCartes');
  if(e) e.textContent = possede.size + '/' + n;
}

/* ═══════════════ ADMIRER DE PRÈS ═══════════════
   « Pouvoir les collecter et admirer de près depuis l'inventaire. »

   Un clic sur une carte possédée l'ouvre en plein écran. C'est le seul endroit
   du jeu où l'on regarde une image tranquillement, et surtout : le GIF y joue
   TOUT SEUL. Pas de moteur 3D, pas de texture rafraîchie onze fois par
   seconde, pas de brouillard — le navigateur affiche le fichier tel qu'il a
   été dessiné. C'est là que les cartes sont les plus belles, et c'est normal
   que ce soit là.                                                           */

let loupeBranchee = false;

export function brancherLoupe(){
  if(loupeBranchee) return;
  loupeBranchee = true;

  const loupe = document.getElementById('loupe');
  if(!loupe) return;
  const img = loupe.querySelector('img');
  const nom = loupe.querySelector('.nom');

  /* Un seul écouteur sur la grille, pas un par vignette : la grille est
     reconstruite à chaque ramassage, et rebrancher cinquante écouteurs à
     chaque fois est le genre de fuite qu'on ne voit jamais venir. */
  for(const cible of ['grille', 'invG']){
    const el = document.getElementById(cible);
    if(!el) continue;
    el.addEventListener('click', e => {
      const carte = e.target.closest('.carte.eue[data-id]');
      if(!carte) return;
      const id = +carte.dataset.id;
      const ident = identite(id);
      if(!ident.img) return;
      img.src = ident.img.src;
      nom.textContent = ident.nom + '   ·   '
        + RANGS[ident.rang].nom.toUpperCase();
      loupe.style.display = 'grid';
    });
  }

  const fermer = () => { loupe.style.display = 'none'; img.src = ''; };
  loupe.addEventListener('click', fermer);
  addEventListener('keydown', e => {
    if(loupe.style.display === 'grid' && (e.code === 'Escape' || e.code === 'KeyI')){
      e.preventDefault(); fermer();
    }
  });
}
