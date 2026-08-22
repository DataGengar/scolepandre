/* ═══ UI / RÉGLAGES ═══
   Le panneau de réglages se CONSTRUIT TOUT SEUL à partir de SETUP.CURSEURS.

   C'est le troisième mécanisme de synchronisation du projet : en v2, ajouter
   un réglage demandait trois modifications séparées — un <input> dans le HTML,
   une clé dans TUNE, un appel à bind(). Les trois pouvaient diverger, et le
   HTML gardait la valeur par défaut en dur, donc changer TUNE ne changeait
   rien tant qu'on n'avait pas touché au HTML.

   Ici : une ligne dans CURSEURS, et c'est tout. La valeur affichée vient
   toujours de SETUP, jamais du HTML.                                        */

import {SETUP, CURSEURS, lire, ecrire} from '../setup.js';

export function construireReglages(){
  const hote = document.getElementById('tune');
  if(!hote) return;

  let html = '<h4>RÉGLAGES</h4>';
  CURSEURS.forEach((c, n) => {
    if(c.groupe){ html += `<div class="grp">${c.groupe}</div>`; return; }
    const v = lire(c.chemin);
    html += `<div class="row">
      <label>${c.nom}<i id="cv${n}"></i></label>
      <input id="cs${n}" type="range" min="${c.min}" max="${c.max}" step="${c.pas}" value="${v}">
    </div>`;
  });
  hote.innerHTML = html;

  CURSEURS.forEach((c, n) => {
    if(c.groupe) return;
    const el  = document.getElementById('cs'+n);
    const lab = document.getElementById('cv'+n);
    const rafraichir = () => { lab.textContent = c.fmt(lire(c.chemin)); };
    el.addEventListener('input', () => {
      ecrire(c.chemin, parseFloat(el.value));   // les abonnés réagissent seuls
      rafraichir();
    });
    rafraichir();
  });
}

/** Remet les curseurs en phase avec SETUP (après un chargement de profil). */
export function rafraichirReglages(){
  CURSEURS.forEach((c, n) => {
    if(c.groupe) return;
    const el = document.getElementById('cs'+n), lab = document.getElementById('cv'+n);
    if(!el) return;
    el.value = lire(c.chemin);
    lab.textContent = c.fmt(lire(c.chemin));
  });
}
