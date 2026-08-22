/* ═══ UI / MENU ═══
   Le voile de départ, ses trois onglets, et l'écran de chargement.

   Le verrouillage du pointeur confisque la souris : les réglages seraient donc
   inatteignables en jeu. ÉCHAP le relâche et rouvre ce menu, où la souris
   fonctionne. Le panneau de réglages y est déplacé au lieu de flotter.      */

import {construireReglages} from './reglages.js';
import {majAffichage} from '../carte/collection.js';

const el = id => document.getElementById(id);

export function construireMenu(surJouer){
  // le panneau de réglages vit dans l'onglet, pas en surimpression
  const tune = el('tune'), hote = el('mReglages');
  if(tune && hote) hote.appendChild(tune);
  construireReglages();

  const vues = {jouer:'mJouer', reglages:'mReglages', collection:'mCollection'};
  document.querySelectorAll('.mo').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.mo').forEach(o =>
        o.setAttribute('aria-pressed', String(o === b)));
      for(const k in vues) el(vues[k]).hidden = (k !== b.dataset.vue);
      if(b.dataset.vue === 'collection') majAffichage();
    });
  });

  const jouer = el('mJouer');
  if(jouer) jouer.addEventListener('click', surJouer);
}

/* ─────────────── écran de chargement ─────────────── */

export function ouvrirChargement(){
  const c = el('charge');
  if(c) c.style.display = 'grid';
}

export function majChargement(nom, part){
  const t = el('chargeTxt'), b = el('chargeBarre');
  if(t) t.textContent = nom;
  if(b) b.style.width = (part*100).toFixed(0) + '%';
}

export function fermerChargement(){
  const c = el('charge');
  if(c) c.style.display = 'none';
}

/** Le voile de départ, affiché quand le pointeur n'est pas verrouillé. */
export function afficherVoile(oui){
  const v = el('veil');
  if(v) v.style.display = oui ? 'grid' : 'none';
}
