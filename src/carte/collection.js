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
      const fond = (eue && img) ? `background:#000 center/contain no-repeat url('${img.src}')` : '';
      html += `<div class="carte${eue?' eue':''}" title="${nom}" style="${
        eue ? `border-color:${col};box-shadow:inset 0 0 18px ${col}22;${fond}` : ''}">`
        + (eue ? (img ? '' : `${nom}<br><span style="color:${col};font-size:7px">${R.nom.toUpperCase()}</span>`) : '—')
        + '</div>';
    }
    el.innerHTML = html;
  }
  const e = document.getElementById('oCartes');
  if(e) e.textContent = possede.size + '/' + n;
}
