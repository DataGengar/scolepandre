/* ═══ UI / MENU ═══
   Le voile de départ, ses trois onglets, et l'écran de chargement.

   Le verrouillage du pointeur confisque la souris : les réglages seraient donc
   inatteignables en jeu. ÉCHAP le relâche et rouvre ce menu, où la souris
   fonctionne. Le panneau de réglages y est déplacé au lieu de flotter.      */

import {construireReglages} from './reglages.js';
import {majAffichage} from '../carte/collection.js';

const el = id => document.getElementById(id);

/** L'onglet ouvert. On ne lance la partie que depuis « Descendre ». */
let vueActive = 'jouer';

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
      vueActive = b.dataset.vue;
      if(vueActive === 'collection') majAffichage();
    });
  });

  /* ═══ LANCER LA PARTIE ═══
     Le voile ENTIER est cliquable, pas seulement la ligne de texte. Deux
     raisons, mesurées et non supposées :

       · le voile porte `cursor:pointer` sur toute sa surface — il PROMET
         d'être cliquable partout, et ne l'était que sur `#mJouer` ;
       · au centre exact de l'écran se trouve la rangée d'onglets. Cliquer
         « au milieu », le geste le plus naturel, changeait donc d'onglet au
         lieu de lancer la partie.

     Le clic DROIT lance aussi : un événement `click` n'est jamais émis pour le
     bouton secondaire, donc l'écouter ne suffisait pas — il faut `contextmenu`,
     dont on annule le menu système.

     Exclusions : les onglets et l'intérieur des panneaux Réglages et
     Collection, sinon relâcher un curseur hors de sa piste lancerait la
     partie. On n'accepte le lancement que depuis l'onglet « Descendre ». */
  const veil = el('veil');
  if(!veil) return;

  const surCommande = cible =>
    !!(cible && cible.closest && cible.closest('.mo, #mReglages, #mCollection'));

  const tenter = e => {
    if(vueActive !== 'jouer') return;
    if(surCommande(e.target)) return;
    e.preventDefault();
    surJouer();
  };

  veil.addEventListener('click', tenter);
  veil.addEventListener('contextmenu', tenter);

  /* Au clavier aussi : Entrée ou Espace depuis le menu. Le verrouillage du
     pointeur accepte n'importe quel geste utilisateur, pas seulement la
     souris. */
  addEventListener('keydown', e => {
    if(veil.style.display === 'none') return;
    if(vueActive !== 'jouer') return;
    if(e.code !== 'Enter' && e.code !== 'Space') return;
    e.preventDefault();
    surJouer();
  });
}

/** Remplace la ligne d'invite du menu (échec de verrouillage, attente…). */
export function messageMenu(txt){
  const g = document.querySelector('#mJouer .go');
  if(g) g.textContent = txt;
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
