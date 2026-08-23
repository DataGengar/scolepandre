/* ═══ ÉDITEUR / PONT ═══
   Le lien entre la forge, qui tourne dans une page, et le disque.

   Une page web n'écrit pas de fichiers. Le lanceur (`Scolopandre.exe`) sert
   donc le jeu par un petit serveur local qui expose quelques routes
   `/_forge/…` — voir `lanceur/forge.py` pour ce qu'elles acceptent et ce
   qu'elles refusent.

   ── DÉGRADATION VOLONTAIRE ─────────────────────────────────────────────────
   Ces routes n'existent que si l'application tourne. Ouvrir `editeur.html`
   par un `python -m http.server` reste parfaitement valable : `disponible()`
   renvoie faux, la forge masque les boutons d'écriture, et on retombe sur le
   presse-papiers et le téléchargement. Aucun message d'erreur, aucune
   fonctionnalité cassée — juste une commodité en moins.

   C'est pour ça que tout passe par `disponible()` plutôt que par des
   exceptions attrapées çà et là : l'interface doit savoir AVANT d'afficher
   un bouton s'il pourra faire quelque chose.                                */

let etat = {teste: false, ok: false, racine: null, props: null};

async function json(url, options){
  const r = await fetch(url, options);
  let d = null;
  try{ d = await r.json(); }catch(e){ /* réponse vide ou HTML : d reste nul */ }
  if(!r.ok || !d || d.ok === false)
    throw new Error((d && d.erreur) || ('HTTP ' + r.status));
  return d;
}

/**
 * Le lanceur est-il derrière nous ?
 *
 * Interrogé une seule fois, au démarrage. Un serveur ne se met pas à répondre
 * en cours de séance, et re-tester à chaque clic donnerait une interface qui
 * change d'avis toute seule.
 */
export async function tester(){
  if(etat.teste) return etat.ok;
  etat.teste = true;
  try{
    const d = await json('/_forge/ping');
    etat.ok = !!d.forge;
    etat.racine = d.racine;
    etat.props = d.props;
  }catch(e){
    etat.ok = false;
  }
  return etat.ok;
}

export const disponible = () => etat.ok;
export const racine = () => etat.racine;

/** Le contenu d'un fichier du projet. */
export async function lire(chemin){
  return (await json('/_forge/lire?chemin=' + encodeURIComponent(chemin))).contenu;
}

/** Écrit un fichier du projet. Le serveur en garde une copie horodatée. */
export async function ecrire(chemin, contenu){
  return json('/_forge/ecrire', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chemin, contenu}),
  });
}

/** Les noms d'éléments présents dans le `switch` de props.js. */
export async function listerProps(){
  return (await json('/_forge/props')).noms;
}

/**
 * Pose — ou remplace — un `case` dans `props.js`.
 *
 * Le serveur ne compose pas de JavaScript : il reçoit le bloc entier, tel que
 * le bouton « copier » l'aurait produit, et le glisse au bon endroit en
 * comptant les accolades. Il refuse d'écrire si le fichier n'est plus
 * équilibré après coup.
 */
export async function ecrireProp(nom, code){
  return json('/_forge/prop', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({nom, code}),
  });
}
