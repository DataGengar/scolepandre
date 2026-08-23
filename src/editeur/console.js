/* ═══ ÉDITEUR / CONSOLE ═══
   Le pendant du terminal d'Héphaïstos : un journal horodaté à tags colorés.

   ── POURQUOI UN JOURNAL DANS UN ÉDITEUR ────────────────────────────────────
   Parce que la moitié de ce que fait cet outil est invisible. Une génération
   prend deux secondes et produit vingt mille éléments ; un asset chargé peut
   sortir vide ; un plan peut demander un biome dans une zone où le générateur
   ne creusera jamais rien. Sans trace écrite, on ne voit que le résultat, pas
   ce qui s'est passé — et on ne peut rien rapporter d'utile.

   Les six niveaux sont ceux d'Héphaïstos (LOG_COLORS), avec les mêmes noms :
   info, success, warning, error, accent, muted.                             */

const MAX = 400;                 // au-delà, on oublie les plus vieilles lignes

let boite = null;

function hote(){
  if(!boite) boite = document.getElementById('console');
  return boite;
}

const heure = () => {
  const d = new Date();
  return String(d.getHours()).padStart(2,'0') + ':'
       + String(d.getMinutes()).padStart(2,'0') + ':'
       + String(d.getSeconds()).padStart(2,'0');
};

const echapper = t => String(t)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/**
 * Écrit une ligne.
 * @param entete  le mot en tête, coloré — court et en capitales
 * @param corps   le message
 * @param niveau  info | success | warning | error | accent | muted
 */
export function journal(entete, corps, niveau = 'info'){
  const h = hote();
  if(!h){ console.log(entete, corps); return; }

  const l = document.createElement('div');
  l.className = niveau;
  l.innerHTML = `<span class="h">${heure()}</span><b>${echapper(entete)}</b> `
              + echapper(corps);
  h.appendChild(l);

  while(h.childElementCount > MAX) h.removeChild(h.firstChild);
  h.scrollTop = h.scrollHeight;

  // on double dans la console du navigateur : c'est là qu'on lit une pile
  if(niveau === 'error') console.error(entete, corps);
}

export const info    = (e, c) => journal(e, c, 'info');
export const succes  = (e, c) => journal(e, c, 'success');
export const alerte  = (e, c) => journal(e, c, 'warning');
export const erreur  = (e, c) => journal(e, c, 'error');
export const accent  = (e, c) => journal(e, c, 'accent');
export const discret = (e, c) => journal(e, c, 'muted');

/** Un tableau clé/valeur, pour les rapports de génération. */
export function tableau(entete, obj, niveau = 'muted'){
  const lignes = Object.entries(obj)
    .map(([k, v]) => `  ${k.padEnd(18, '·')} ${v}`).join('\n');
  journal(entete, '\n' + lignes, niveau);
}

/**
 * Toute exception non rattrapée finit ici. Sans ça, une erreur dans un
 * gestionnaire d'événement disparaît dans la console du navigateur, que
 * personne n'ouvre — et le bogue n'est jamais rapporté.
 */
export function capturerErreurs(){
  addEventListener('error', e => {
    erreur('ERREUR', (e.message || '?') + '  ·  '
      + (e.filename || '').split('/').pop() + ':' + e.lineno);
  });
  addEventListener('unhandledrejection', e => {
    const r = e.reason;
    erreur('PROMESSE', (r && (r.message || r)) + '');
  });
}

export function vider(){
  const h = hote();
  if(h) h.innerHTML = '';
}
