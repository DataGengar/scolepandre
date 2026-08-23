/* ══════════════════════════════════════════════════════════════════════════
   ÉDITEUR — ASSEMBLAGE
   ──────────────────────────────────────────────────────────────────────────
   Trois onglets, un seul moteur :

     TERRAIN    poser des zones sur la planche : quel biome où, quelle
                altitude, et ce qu'on a le droit d'y générer.
     ASSETS     composer un élément de décor et le voir tourner.
     CRÉATURE   régler le scolopandre en le regardant bouger.

   Ce fichier ne contient aucune logique d'édition : il branche les modules,
   fabrique les panneaux, et fait tourner la boucle. Comme jeu.js pour le jeu.
   ══════════════════════════════════════════════════════════════════════════ */

import {SETUP, lire, ecrire} from '../setup.js';
import {semer, graine} from '../noyau/rng.js';
import {cv} from '../noyau/gl.js';
import {M} from '../noyau/math.js';
import {BIOMES} from '../monde/biomes.js';
import {plan, zoneEn, CONTENUS, effacerPlan, enregistrerPlan} from '../monde/plan.js';
import {construireMonde, rapportMonde} from '../monde/index.js';
import {ST} from '../creatures/etats.js';
import * as Grille from '../monde/grille.js';
import * as Villages from '../monde/villages.js';

import * as A3 from './apercu3d.js';
import * as Pont from './pont.js';
import * as Terrain from './terrain.js';
import * as Assets from './assets.js';
import * as Creature from './creature-edit.js';
import * as Projet from './projet.js';
import {info, succes, alerte, erreur, discret, tableau,
        capturerErreurs} from './console.js';

const el = id => document.getElementById(id);
const html = (id, s) => { const e = el(id); if(e) e.innerHTML = s; };

const etat = {onglet: 'terrain', dernier: performance.now(),
              images: 0, tImages: 0};

/* L'aide souris depend de l'onglet : ce ne sont pas les memes gestes. */
const AIDE = {
  terrain:  'clic <b>tracer</b> · MAJ+glisser <b>deplacer</b> · molette <b>zoom</b>',
  assets:   'gauche <b>orbite</b> · droit <b>panoramique</b> · molette <b>zoom</b>',
  creature: 'gauche <b>orbite</b> · droit <b>panoramique</b> · molette <b>zoom</b>',
};

/* ═══════════════ ONGLETS ═══════════════ */

function montrer(nom){
  etat.onglet = nom;
  for(const o of ['terrain','assets','creature']){
    el('vue-' + o).hidden = (o !== nom);
    el('pan-' + o).hidden = (o !== nom);
    el('ong-' + o).setAttribute('aria-pressed', String(o === nom));
  }
  // le canvas 3D n'existe qu'une fois : on le déplace dans l'onglet actif
  const hote = el('hote3d-' + nom);
  if(hote && cv.parentElement !== hote) hote.appendChild(cv);
  cv.hidden = (nom === 'terrain');
  el('etatOnglet').textContent = nom.toUpperCase();
  el('aideScene').innerHTML = AIDE[nom];
  el('etatPerf').textContent = '';
  if(nom === 'terrain') Terrain.dessiner();
  else {
    A3.redimensionner();
    if(nom === 'assets'){
      const b = Assets.bornes();
      A3.cadrer(b.centre, b.rayon);
    } else {
      A3.cadrer([0, 0.6, 0], Creature.envergure());
    }
  }
}

/* ═══════════════ PANNEAU : TERRAIN ═══════════════ */

function panneauTerrain(){
  const opts = ['<option value="-1">auto (stratigraphie)</option>']
    .concat(BIOMES.map((b, i) => `<option value="${i}">${b.n}</option>`)).join('');

  html('pan-terrain', `
    <h3>OUTIL</h3>
    <div class="rangee" id="outils">
      <button class="ot" data-o="rect" aria-pressed="true">Rectangle</button>
      <button class="ot" data-o="ellipse">Ellipse</button>
      <button class="ot" data-o="choisir">Choisir</button>
      <button class="ot" data-o="effacer">Effacer</button>
    </div>

    <h3>BIOME À POSER</h3>
    <select id="biomePose">${opts}</select>
    <p class="aide">« auto » laisse la stratigraphie décider selon l'altitude —
    exactement comme un monde sans plan.</p>

    <h3>ZONE SÉLECTIONNÉE</h3>
    <div id="detailZone"><p class="aide">Aucune. Trace un rectangle, ou prends
    l'outil « Choisir ».</p></div>

    <h3>MONDE</h3>
    <div class="rangee">
      <button id="btGen">Générer un aperçu</button>
      <button id="btApercuOff">Masquer</button>
    </div>
    <div id="rapport" class="aide"></div>
    <div class="rangee">
      <button id="btVider">Tout effacer</button>
    </div>
    <p class="aide">« <span>Jouer</span> », en haut a droite, enregistre le plan
    et ouvre le jeu — qui le relit tout seul.</p>
  `);

  el('outils').addEventListener('click', e => {
    const b = e.target.closest('.ot'); if(!b) return;
    Terrain.etat.outil = b.dataset.o;
    for(const o of el('outils').children)
      o.setAttribute('aria-pressed', String(o === b));
  });
  el('biomePose').addEventListener('change', e => {
    Terrain.etat.biome = parseInt(e.target.value, 10);
  });
  el('btGen').addEventListener('click', genererApercu);
  el('btApercuOff').addEventListener('click', () => {
    Terrain.effacerApercu(); discret('APERCU', 'masque');
  });
  el('btVider').addEventListener('click', () => {
    if(!confirm('Effacer toutes les zones du plan ?')) return;
    const combien = plan.zones.length;
    effacerPlan(); Terrain.etat.selection = null;
    Projet.enregistrer(); detailZone(); Terrain.dessiner(); majEtatPlan();
    alerte('PLAN', combien + ' zones effacees — le monde redevient procedural');
  });
}

function detailZone(){
  const z = Terrain.etat.selection;
  if(!z){
    html('detailZone', `<p class="aide">Aucune. Trace un rectangle, ou prends
      l'outil « Choisir ».</p>`);
    return;
  }
  const opts = ['<option value="-1">auto</option>']
    .concat(BIOMES.map((b,i) => `<option value="${i}">${b.n}</option>`)).join('');
  const cases = CONTENUS.map(c =>
    `<label class="case"><input type="checkbox" data-c="${c}"
      ${z.contenu[c] !== false ? 'checked' : ''}> ${c}</label>`).join('');

  html('detailZone', `
    <label>Nom<input id="zNom" type="text" value="${z.nom}"></label>
    <label>Biome<select id="zBiome">${opts}</select></label>
    <label>Altitude imposée
      <input id="zAlt" type="text" placeholder="auto"
             value="${z.altitude === null || z.altitude === undefined ? '' : z.altitude}">
    </label>
    <label>Pente (m / cellule)
      <input id="zPente" type="number" step="0.05" value="${z.pente || 0}"></label>
    <label>Densité du décor <i>${(z.densite ?? 1).toFixed(2)}</i>
      <input id="zDens" type="range" min="0" max="3" step="0.05" value="${z.densite ?? 1}"></label>
    <div class="aide">Position ${z.x},${z.z} · ${z.w}×${z.h} cellules
      (${Math.round(z.w*1.5)}×${Math.round(z.h*1.5)} m)</div>
    <h4>On peut y générer</h4>
    <div class="cases">${cases}</div>
    <button id="zSuppr">Supprimer cette zone</button>
  `);

  el('zBiome').value = String(z.biome);
  const maj = () => {
    enregistrerPlan(); Projet.enregistrer(); Terrain.dessiner(); majEtatPlan();
  };

  el('zNom').addEventListener('input', e => { z.nom = e.target.value; maj(); });
  el('zBiome').addEventListener('change', e => {
    z.biome = parseInt(e.target.value, 10); maj();
  });
  el('zAlt').addEventListener('change', e => {
    const v = e.target.value.trim();
    z.altitude = v === '' ? null : parseFloat(v);
    if(Number.isNaN(z.altitude)) z.altitude = null;
    maj();
  });
  el('zPente').addEventListener('change', e => { z.pente = parseFloat(e.target.value)||0; maj(); });
  el('zDens').addEventListener('input', e => {
    z.densite = parseFloat(e.target.value);
    e.target.previousElementSibling && (e.target.parentElement.querySelector('i').textContent
      = z.densite.toFixed(2));
    maj();
  });
  for(const c of el('detailZone').querySelectorAll('[data-c]'))
    c.addEventListener('change', e => {
      z.contenu[e.target.dataset.c] = e.target.checked; maj();
    });
  el('zSuppr').addEventListener('click', () => {
    discret('ZONE', 'supprimee : ' + z.nom);
    plan.zones.splice(plan.zones.indexOf(z), 1);
    Terrain.etat.selection = null;
    maj(); detailZone();
  });
}

async function genererApercu(){
  const r = el('rapport');
  const t0 = performance.now();
  semer(undefined);
  info('GENERATION', `graine ${graine()} · ${plan.zones.length} zones au plan`);

  const gen = construireMonde({});
  for(;;){
    const {value, done} = gen.next();
    if(done) break;
    r.textContent = value.nom + '…';
    discret('etape', value.nom);
    await new Promise(res => requestAnimationFrame(res));
  }

  Terrain.capturerApercu();
  const rap = rapportMonde();
  r.innerHTML = Object.entries(rap)
    .map(([k, v]) => `<span>${k}</span> ${v}`).join('<br>');
  succes('GENERATION', `terminee en ${((performance.now()-t0)/1000).toFixed(1)} s`);
  tableau('monde', rap);

  /* Le controle qui compte : une zone qui ne produit aucune cellule de sol est
     une zone qu'on a dessinee pour rien, et rien a l'ecran ne le dirait. */
  for(const z of plan.zones){
    let sol = 0;
    for(let cz=z.z; cz<z.z+z.h; cz++) for(let cx=z.x; cx<z.x+z.w; cx++)
      if(Grille.grid[Grille.idx(cx, cz)] === Grille.FLOOR) sol++;
    if(sol === 0)
      alerte('ZONE VIDE', `« ${z.nom} » n'a produit aucune cellule de sol — `
        + 'le generateur ne creuse rien la. Deplace-la ou agrandis-la.');
    else discret('zone', `${z.nom} · ${sol} cellules de sol`);
  }
}

/* ═══════════════ PANNEAU : ASSETS ═══════════════
   La forge. Le panneau est bâti une fois, puis rafraîchi par morceaux : la
   liste des parts, le détail de la sélection, la pile de modificateurs et les
   statistiques bougent chacun de leur côté. Tout reconstruire à chaque frappe
   ferait perdre le focus du champ qu'on est en train de saisir.             */

const echap = t => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;')
                            .replace(/"/g,'&quot;');

const rgbHex = c => '#' + c.map(v =>
  Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16)
    .padStart(2,'0')).join('');

/** La part de référence de la sélection : celle dont on montre le détail. */
function partActive(){
  const i = Assets.selection.values().next().value;
  return (i === undefined) ? null : Assets.el().parts[i];
}

function panneauAssets(){
  const types = Assets.TYPES.map(t => `<option>${t}</option>`).join('');
  const biomes = BIOMES.map((b,i) => `<option value="${i}">${b.n}</option>`).join('');
  const formes = Assets.ORDRE.map(k =>
    `<button class="pt" data-forme="${k}" title="${echap(Assets.PRIMITIVES[k].aide)}"
     >+ ${Assets.PRIMITIVES[k].nom.toLowerCase()}</button>`).join('');
  const mods = Object.entries(Assets.MODIFS).map(([k,d]) =>
    `<button class="pt" data-mod="${k}" title="${echap(d.aide)}">+ ${d.nom}</button>`
    ).join('');

  html('pan-assets', `
    <h3>ÉLÉMENT</h3>
    <div class="rangee">
      <select id="aBiblio" style="flex:3 1 120px"></select>
      <button id="aNeuf"  title="nouvel élément">+</button>
      <button id="aDupEl" title="dupliquer l'élément">⧉</button>
      <button id="aDelEl" title="supprimer l'élément">✕</button>
    </div>
    <label>Nom du <span>case</span> dans props.js
      <input type="text" id="aNom"></label>

    <h3>PARTIR D'UN ÉLÉMENT DU JEU</h3>
    <div class="rangee">
      <select id="aType" style="flex:2 1 110px">${types}</select>
      <select id="aBiome" style="flex:2 1 110px">${biomes}</select>
    </div>
    <div class="rangee">
      <button id="aCharger" class="accent">Charger</button>
      <button id="aRegraine">Autre tirage</button>
    </div>
    <p class="aide">Appelle la vraie fonction du jeu et récupère la géométrie
    produite. C'est l'élément tel qu'il apparaît en partie, pas une imitation.</p>

    <h3>PRIMITIVES</h3>
    <div class="rangee">${formes}</div>
    <div id="aListe" class="liste"></div>
    <div class="rangee">
      <button id="aDup" title="Ctrl+D">Dupliquer</button>
      <button id="aDel" title="Suppr">Supprimer</button>
      <button id="aTout" title="Ctrl+A">Tout</button>
      <button id="aVider">Vider</button>
    </div>

    <h3>SÉLECTION</h3>
    <div id="aDetail"></div>

    <h3>MODIFICATEURS</h3>
    <div class="rangee">${mods}</div>
    <div id="aPile"></div>
    <p class="aide">La pile s'applique aux primitives, de haut en bas. La base
    reste modifiable : change une dimension, les copies suivent.</p>
    <div class="rangee">
      <button id="aFiger" title="le résultat devient la nouvelle base">Figer la pile</button>
    </div>

    <h3>APERÇU</h3>
    <div class="rangee">
      <button id="aEclairage" title="juger la forme, ou juger sa lisibilité en jeu"
        >Éclairage : studio</button>
      <button id="aCadrer">Recadrer</button>
    </div>
    <div class="cases">
      <label class="case"><input type="checkbox" id="aJauge" checked> silhouette 1,75 m</label>
      <label class="case"><input type="checkbox" id="aGrille" checked> grille 50 cm</label>
      <label class="case"><input type="checkbox" id="aTeinte"> teinte du biome</label>
      <label class="case"><input type="checkbox" id="aBase"> base seule</label>
      <label class="case"><input type="checkbox" id="aTourne"> rotation</label>
      <label class="case"><input type="checkbox" id="aAimant" checked> magnétisme 5 cm</label>
    </div>

    <h3>SORTIE</h3>
    <div id="aStats" class="aide"></div>
    <div class="rangee">
      <button id="aCode">Copier le code</button>
      <button id="aEcrire" class="accent" hidden>Écrire dans props.js</button>
    </div>

    <div id="aSemis" hidden>
      <h4>semer dans le monde</h4>
      <p class="aide">Écrire le <span>case</span> ne suffit pas : le générateur
      tire au sort dans la liste de chaque biome. Tant que l'élément n'y figure
      pas, il n'apparaîtra jamais.</p>
      <div class="cases" id="aBiomesCases"></div>
      <label>Fréquence <i id="aPoidsV">1</i>
        <input type="range" id="aPoids" min="1" max="5" step="1" value="1"></label>
      <div class="rangee">
        <button id="aSemer" class="accent">Semer</button>
        <button id="aDesemer">Retirer</button>
      </div>
    </div>

    <textarea id="aSortie" rows="6" readonly
      placeholder="le code produit apparaît ici"></textarea>
  `);

  brancherAssets();
  majBiblio();
  majListe();
  majPile();
}

/* ─────────────── câblage ─────────────── */

let graineAsset = 1;

function brancherAssets(){
  const e = el('pan-assets');

  el('aBiblio').addEventListener('change', ev => {
    Assets.choisirElement(+ev.target.value);
    majBiblio(); majListe(); majPile(); recadrerAsset();
    if(Pont.disponible()) majBiomesCases();
  });
  el('aNeuf').addEventListener('click', () => {
    Assets.ajouterElement(); majBiblio(); majListe(); majPile();
    Projet.enregistrer(); info('ÉLÉMENT', 'nouvel élément');
  });
  el('aDupEl').addEventListener('click', () => {
    Assets.dupliquerElement(); majBiblio(); majListe(); majPile();
    Projet.enregistrer();
  });
  el('aDelEl').addEventListener('click', () => {
    const nom = Assets.el().nom;
    if(!Assets.supprimerElement(Assets.biblio.courant)){
      alerte('ÉLÉMENT', 'le dernier élément ne peut pas être supprimé');
      return;
    }
    majBiblio(); majListe(); majPile(); Projet.enregistrer();
    discret('ÉLÉMENT', 'supprimé : ' + nom);
  });
  el('aNom').addEventListener('input', ev => {
    Assets.el().nom = ev.target.value.trim() || 'element';
    majBiblio(); Projet.enregistrer();
  });

  el('aCharger').addEventListener('click', chargerAsset);
  el('aType').addEventListener('change', chargerAsset);
  el('aRegraine').addEventListener('click', () => { graineAsset++; chargerAsset(); });
  el('aBiome').addEventListener('change', ev => {
    Assets.el().biome = +ev.target.value;
    majTeinte(); Projet.enregistrer();
  });

  for(const b of e.querySelectorAll('[data-forme]'))
    b.addEventListener('click', () => {
      Assets.ajouter(b.dataset.forme);
      majListe(); Projet.enregistrer();
    });

  for(const b of e.querySelectorAll('[data-mod]'))
    b.addEventListener('click', () => {
      Assets.ajouterModif(b.dataset.mod);
      majPile(); majListe(); Projet.enregistrer();
      info('MODIF', Assets.MODIFS[b.dataset.mod].nom + ' ajouté à la pile');
    });

  el('aDup').addEventListener('click',  () => { Assets.dupliquerParts(); majListe(); });
  el('aDel').addEventListener('click',  () => { Assets.supprimerParts(); majListe(); });
  el('aTout').addEventListener('click', () => { Assets.toutSelectionner(); majListe(); });
  el('aVider').addEventListener('click',() => { Assets.vider(); majListe(); });
  el('aCadrer').addEventListener('click', recadrerAsset);
  el('aFiger').addEventListener('click', () => {
    const n = Assets.figerPile();
    majListe(); majPile(); Projet.enregistrer();
    succes('FIGÉ', n + ' primitives sont devenues la nouvelle base');
  });

  el('aEclairage').addEventListener('click', ev => {
    const jeu = A3.options.eclairage !== 'jeu';
    A3.options.eclairage = jeu ? 'jeu' : 'studio';
    ev.target.textContent = 'Éclairage : ' + (jeu ? 'jeu' : 'studio');
    ev.target.setAttribute('aria-pressed', String(jeu));
  });

  const bascule = (id, fn) => el(id).addEventListener('change', ev => fn(ev.target.checked));
  bascule('aJauge',  v => A3.options.jauge = v);
  bascule('aGrille', v => A3.options.grille = v);
  bascule('aTourne', v => A3.options.tourne = v);
  bascule('aTeinte', () => majTeinte());
  bascule('aBase',   v => { Assets.reglages.montrerBase = v; Assets.salir(); majStats(); });
  bascule('aAimant', v => Assets.reglages.magnetisme = v ? 0.05 : 0);

  el('aCode').addEventListener('click', () => {
    const t = el('aSortie');
    t.value = Assets.versCode();
    t.select();
    let copie = false;
    try{ copie = document.execCommand('copy'); }catch(err){}
    if(copie) succes('CODE', 'copié — à coller dans le switch de monde/props.js');
    else alerte('CODE', 'copie refusée par le navigateur : le texte est sélectionné');
  });

  el('aEcrire').addEventListener('click', ecrireDansProps);
  el('aPoids').addEventListener('input', ev => {
    el('aPoidsV').textContent = ev.target.value;
  });
  el('aSemer').addEventListener('click', () => semerElement(false));
  el('aDesemer').addEventListener('click', () => semerElement(true));
}

/* ─────────────── semis dans les biomes ─────────────── */

/** Les biomes tels que biomes.js les déclare, relus après chaque semis. */
let biomesConnus = [];

async function majBiomesCases(){
  const z = el('aBiomesCases');
  if(!z) return;
  try{
    biomesConnus = await Pont.biomes();
  }catch(err){
    z.innerHTML = '<p class="aide">' + err.message + '</p>';
    return;
  }
  const nom = Assets.el().nom;
  z.innerHTML = biomesConnus.map((b, i) => {
    const n = b.props.filter(p => p === nom).length;
    return `<label class="case"><input type="checkbox" data-bi="${i}"
      ${n ? 'checked' : ''}> ${b.nom.toLowerCase()}${
      n > 1 ? ` <i>×${n}</i>` : ''}</label>`;
  }).join('');
}

async function semerElement(retirer){
  const nom = Assets.el().nom;
  const choisis = [...el('aBiomesCases').querySelectorAll('[data-bi]')]
    .filter(c => c.checked).map(c => +c.dataset.bi);

  if(!retirer && !choisis.length){
    alerte('SEMIS', 'coche au moins un biome');
    return;
  }
  // Pour retirer, on vise TOUS les biomes : décocher une case puis cliquer
  // « Retirer » doit enlever l'élément de partout, pas seulement de ce qui
  // reste coché — sinon le geste ne fait rien et on ne comprend pas.
  const cibles = retirer ? biomesConnus.map((_, i) => i) : choisis;

  try{
    const r = await Pont.semer(nom, cibles, +el('aPoids').value, retirer);
    if(r.biomes && r.biomes.length)
      succes('SEMIS', `« ${nom} » ${r.action} dans ${r.biomes.length} biome(s)`
        + (r.sauvegarde ? ' · sauvegarde ' + r.sauvegarde : ''));
    else discret('SEMIS', 'rien à faire — c\'était déjà le cas');
    await majBiomesCases();
    info('SEMIS', 'relance une partie pour le voir : le monde est bâti '
      + 'au chargement');
  }catch(err){
    erreur('SEMIS', err.message);
  }
}

function majTeinte(){
  const on = el('aTeinte') && el('aTeinte').checked;
  A3.options.teinte = on ? BIOMES[Assets.el().biome].c : null;
}

function recadrerAsset(){
  const b = Assets.bornes();
  A3.cadrer(b.centre, b.rayon);
}

function chargerAsset(){
  const type = el('aType').value;
  const bi = +el('aBiome').value;
  let n = 0;
  try{
    n = Assets.chargerDuJeu(type, bi, graineAsset);
  }catch(err){
    erreur('ASSET', type + ' a levé une exception : ' + err.message);
  }
  majBiblio(); majListe(); majPile(); recadrerAsset(); Projet.enregistrer();
  if(n) info('ASSET', `${type} · ${n} primitives · ${Assets.triangles()} triangles`);
  else alerte('ASSET', `${type} n'a produit aucune géométrie pour ce biome — `
    + 'essaie un autre tirage ou un autre biome.');
}

/* ─────────────── bibliothèque ─────────────── */

function majBiblio(){
  const sel = el('aBiblio');
  if(!sel) return;
  sel.innerHTML = Assets.biblio.elements.map((x, i) =>
    `<option value="${i}">${echap(x.nom)}</option>`).join('');
  sel.value = String(Assets.biblio.courant);
  el('aNom').value = Assets.el().nom;
  el('aBiome').value = String(Assets.el().biome);
  majTeinte();
}

/* ─────────────── liste des primitives ─────────────── */

function majListe(){
  const parts = Assets.el().parts;
  html('aListe', parts.length
    ? parts.map((q, i) => {
        const forme = Assets.formeDe(q);
        return `<button class="pt${Assets.selection.has(i) ? ' sel' : ''}"
          data-i="${i}">${i}·${forme}${q.emis ? ' ✦' : ''}</button>`;
      }).join('')
    : '<p class="aide">Vide. Ajoute une primitive, ou charge un élément du jeu.</p>');

  for(const b of el('aListe').querySelectorAll('.pt'))
    b.addEventListener('click', ev => {
      Assets.choisir(+b.dataset.i, ev.shiftKey || ev.ctrlKey);
      majListe();
    });

  majDetail();
  majStats();
}

/* ─────────────── détail de la sélection ─────────────── */

function majDetail(){
  const q = partActive();
  const n = Assets.selection.size;

  if(!q){
    html('aDetail', `<p class="aide">Rien de sélectionné. Clique une primitive
      dans la liste, ou <span>dans la vue 3D</span>.</p>`);
    return;
  }

  const forme = Assets.formeDe(q);
  const champs = Assets.PRIMITIVES[forme].champs;
  const conv = Assets.ORDRE.filter(k => k !== forme).map(k =>
    `<button class="pt" data-conv="${k}">${Assets.PRIMITIVES[k].nom}</button>`).join('');

  const ligne = (c, i) => `<label>${c.libelle} <i id="av${i}">${
      (+c.lire(q)).toFixed(c.pas >= 1 ? 0 : 2)}</i>
      <input type="range" id="ar${i}" min="${c.mn}" max="${c.mx}"
             step="${c.pas}" value="${c.lire(q)}"></label>`;

  html('aDetail', `
    <p class="aide">${n > 1 ? `<span>${n} primitives</span> — les champs
      s'appliquent à la première, les transformations à toutes.`
      : `<span>${Assets.PRIMITIVES[forme].nom}</span>`}</p>

    ${champs.map(ligne).join('')}

    <div class="g3" style="margin-top:8px">
      <label>couleur<input type="color" id="apc" value="${rgbHex(q.c)}"></label>
      <label>éclat<input type="number" step="0.1" min="0" max="4" id="api" value="1"></label>
      <label class="case" style="align-self:end;padding-bottom:6px"
        ><input type="checkbox" id="ape" ${q.emis?'checked':''}> émissif</label>
    </div>

    <h4>déplacer la sélection</h4>
    <div class="g3">
      <button data-t="-1,0,0">← X</button>
      <button data-t="0,1,0">↑ Y</button>
      <button data-t="0,0,-1">← Z</button>
      <button data-t="1,0,0">X →</button>
      <button data-t="0,-1,0">↓ Y</button>
      <button data-t="0,0,1">Z →</button>
    </div>
    <div class="g3" style="margin-top:6px">
      <button data-ry="-1">↺ 15°</button>
      <button data-e="0.9">− 10 %</button>
      <button data-e="1.111">+ 10 %</button>
      <button data-ry="1">↻ 15°</button>
      <button id="aSol">poser au sol</button>
      <button id="aCentre">recentrer</button>
    </div>

    <h4>convertir en</h4>
    <div class="rangee">${conv}</div>
  `);

  // curseurs de la forme
  champs.forEach((c, i) => {
    const r = el('ar' + i);
    r.addEventListener('pointerdown', () => Assets.memoriser());
    r.addEventListener('input', ev => {
      const v = parseFloat(ev.target.value);
      for(const k of Assets.selection){
        const p = Assets.el().parts[k];
        if(Assets.formeDe(p) === forme) c.ecrire(p, v);
      }
      el('av' + i).textContent = v.toFixed(c.pas >= 1 ? 0 : 2);
      Assets.salir(); majStats();
    });
    r.addEventListener('change', () => Projet.enregistrer());
  });

  // couleur, éclat, émissif
  const majCouleur = () => {
    const h = el('apc').value, k = parseFloat(el('api').value) || 1;
    const c = [parseInt(h.slice(1,3),16)/255*k,
               parseInt(h.slice(3,5),16)/255*k,
               parseInt(h.slice(5,7),16)/255*k];
    for(const i of Assets.selection){
      Assets.el().parts[i].c = c.slice();
      Assets.el().parts[i].emis = el('ape').checked ? 1 : 0;
    }
    Assets.salir(); majStats();
  };
  el('apc').addEventListener('input', majCouleur);
  el('api').addEventListener('input', majCouleur);
  el('ape').addEventListener('change', () => { majCouleur(); majListe(); });

  // transformations
  const pas = Assets.reglages.magnetisme || 0.05;
  for(const b of el('aDetail').querySelectorAll('[data-t]'))
    b.addEventListener('click', () => {
      Assets.memoriser();
      const d = b.dataset.t.split(',').map(Number);
      Assets.transformerSelection({t: d.map(v => v * pas * 4)});
      majDetail(); majStats(); Projet.enregistrer();
    });
  for(const b of el('aDetail').querySelectorAll('[data-ry]'))
    b.addEventListener('click', () => {
      Assets.memoriser();
      Assets.transformerSelection({ry: (+b.dataset.ry) * Math.PI / 12});
      majDetail(); majStats(); Projet.enregistrer();
    });
  for(const b of el('aDetail').querySelectorAll('[data-e]'))
    b.addEventListener('click', () => {
      Assets.memoriser();
      Assets.transformerSelection({echelle: +b.dataset.e});
      majDetail(); majStats(); Projet.enregistrer();
    });
  for(const b of el('aDetail').querySelectorAll('[data-conv]'))
    b.addEventListener('click', () => {
      Assets.convertirSelection(b.dataset.conv);
      majListe(); Projet.enregistrer();
    });
  el('aSol').addEventListener('click', () => {
    Assets.poserAuSol(); majDetail(); majStats(); Projet.enregistrer();
  });
  el('aCentre').addEventListener('click', () => {
    Assets.recentrer(); majDetail(); majStats(); recadrerAsset(); Projet.enregistrer();
  });
}

/* ─────────────── pile de modificateurs ─────────────── */

function majPile(){
  const pile = Assets.el().pile;
  if(!pile.length){
    html('aPile', `<p class="aide">Pile vide. Un modificateur démultiplie les
      primitives selon une règle — c'est ce qui permet de faire une grille de
      barreaux sans poser vingt barreaux.</p>`);
    return;
  }

  html('aPile', pile.map((m, i) => {
    const d = Assets.MODIFS[m.type];
    const reglages = d.reglages.map(([cle, genre, opt, libelle]) => {
      const id = `mo${i}_${cle}`;
      if(genre === 'case')
        return `<label class="case"><input type="checkbox" id="${id}"
          ${m[cle] ? 'checked' : ''}> ${libelle}</label>`;
      if(genre === 'liste')
        return `<label>${libelle}<select id="${id}">${opt.map(o =>
          `<option${o === m[cle] ? ' selected' : ''}>${o}</option>`).join('')
          }</select></label>`;
      const [mn, mx, pas] = opt;
      return `<label>${libelle} <i id="${id}v">${
        (+m[cle]).toFixed(pas >= 1 ? 0 : 2)}</i>
        <input type="range" id="${id}" min="${mn}" max="${mx}" step="${pas}"
               value="${m[cle]}"></label>`;
    }).join('');

    return `<div style="border:1px solid var(--border);border-radius:5px;
              padding:8px;margin-bottom:7px;background:var(--content-bg)">
      <div class="rangee" style="margin-bottom:6px">
        <label class="case" style="flex:2 1 auto"><input type="checkbox"
          id="ma${i}" ${m.actif ? 'checked' : ''}> <b>${d.nom}</b></label>
        <button class="pt" data-up="${i}" title="monter">↑</button>
        <button class="pt" data-dn="${i}" title="descendre">↓</button>
        <button class="pt" data-rm="${i}" title="retirer">✕</button>
      </div>
      ${reglages}
    </div>`;
  }).join(''));

  const zone = el('aPile');
  pile.forEach((m, i) => {
    const d = Assets.MODIFS[m.type];
    el('ma' + i).addEventListener('change', ev => {
      m.actif = ev.target.checked; Assets.salir(); majStats(); Projet.enregistrer();
    });
    for(const [cle, genre, opt] of d.reglages){
      const id = `mo${i}_${cle}`;
      const w = el(id);
      if(!w) continue;
      if(genre === 'case'){
        w.addEventListener('change', ev => {
          m[cle] = ev.target.checked; Assets.salir(); majStats(); Projet.enregistrer();
        });
      } else if(genre === 'liste'){
        w.addEventListener('change', ev => {
          m[cle] = ev.target.value; Assets.salir(); majStats(); Projet.enregistrer();
        });
      } else {
        const pas = opt[2];
        w.addEventListener('input', ev => {
          m[cle] = parseFloat(ev.target.value);
          el(id + 'v').textContent = m[cle].toFixed(pas >= 1 ? 0 : 2);
          Assets.salir(); majStats();
        });
        w.addEventListener('change', () => Projet.enregistrer());
      }
    }
  });
  for(const b of zone.querySelectorAll('[data-up]'))
    b.addEventListener('click', () => { Assets.deplacerModif(+b.dataset.up, -1);
                                        majPile(); majStats(); Projet.enregistrer(); });
  for(const b of zone.querySelectorAll('[data-dn]'))
    b.addEventListener('click', () => { Assets.deplacerModif(+b.dataset.dn, 1);
                                        majPile(); majStats(); Projet.enregistrer(); });
  for(const b of zone.querySelectorAll('[data-rm]'))
    b.addEventListener('click', () => { Assets.supprimerModif(+b.dataset.rm);
                                        majPile(); majStats(); Projet.enregistrer(); });
  majStats();
}

/* ─────────────── statistiques et budget ─────────────── */

function majStats(){
  const z = el('aStats');
  if(!z) return;
  const st = Assets.stats();
  const t = st.taille.map(v => v.toFixed(2)).join(' × ');

  const couleur = {confortable:'var(--log-success)', tendu:'var(--log-warning)',
                   lourd:'var(--log-error)'}[st.verdict];

  const etapes = st.etapes.length
    ? '<br>' + st.etapes.map(e => `<span>${e.type}</span> → ${
        e.erreur ? ('⚠ ' + e.erreur) : (e.parts + ' parts')}`).join('<br>')
    : '';

  z.innerHTML =
    `<span>${st.base}</span> de base → <span>${st.parts}</span> primitives · `
    + `<b style="color:${couleur}">${st.triangles} triangles</b> (${st.verdict})`
    + `<br><span>${t}</span> m`
    + (st.tronque ? '<br><b style="color:var(--log-error)">tronqué à '
        + '6000 primitives — réduis un réseau</b>' : '')
    + etapes;
}

/* ─────────────── écrire dans le jeu ─────────────── */

async function ecrireDansProps(){
  const nom = Assets.el().nom;
  const code = Assets.versCode();
  el('aSortie').value = code;
  try{
    const r = await Pont.ecrireProp(nom, code);
    succes('PROPS.JS', `« ${nom} » ${r.action} (${r.lignes} lignes)`
      + (r.sauvegarde ? ' · sauvegarde ' + r.sauvegarde : ''));
    await majBiomesCases();
    if(r.action === 'ajouté')
      info('À FAIRE', `« ${nom} » existe, mais n'est encore semé nulle part. `
        + 'Coche un biome ci-dessous et sème-le.');
  }catch(err){
    erreur('PROPS.JS', err.message);
  }
}

/* ─────────────── surbrillance de la sélection ───────────────
   Les parts choisies sont recuites à part, en bleu émissif, et dessinées
   par-dessus. Sans repère visuel dans la vue, la liste de gauche et l'objet
   de droite sont deux mondes séparés : on règle un curseur sans savoir quelle
   pièce bouge.

   Cuire un second maillage plutôt que teinter le premier coûte quelques
   dizaines de triangles et évite de toucher aux couleurs qu'on est justement
   en train de régler. */

let surM = null;

function maillageSurbrillance(){
  if(surM){ A3.libererMesh(surM); surM = null; }

  const parts = Assets.el().parts;
  const choisies = [...Assets.selection].filter(i => parts[i]);
  if(!choisies.length) return null;

  // Recuit à chaque image, sans cache : la part bouge pendant qu'on tire un
  // curseur, et c'est précisément le moment où l'on regarde. Quelques dizaines
  // de triangles, une fois par image — c'est gratuit à cette échelle.
  surM = Assets.cuireFantomes(choisies.map(i => parts[i]));
  return surM;
}

/** Le clic dans la vue 3D désigne une primitive. */
function brancherClic3D(){
  let bougé = false, ox = 0, oy = 0;

  cv.addEventListener('pointerdown', e => {
    bougé = false; ox = e.clientX; oy = e.clientY;
  });
  cv.addEventListener('pointermove', e => {
    if(Math.abs(e.clientX - ox) + Math.abs(e.clientY - oy) > 4) bougé = true;
  });
  cv.addEventListener('pointerup', e => {
    // Un clic gauche NET, pas une fin d'orbite : sinon chaque rotation de la
    // vue changerait la sélection, ce qui est insupportable.
    if(e.button !== 0 || bougé || etat.onglet !== 'assets') return;
    const r = cv.getBoundingClientRect();
    const {o, d} = A3.rayonEcran((e.clientX - r.left) * (cv.width / r.width),
                                 (e.clientY - r.top) * (cv.height / r.height));
    const i = Assets.viser(o, d);
    Assets.choisir(i, e.shiftKey || e.ctrlKey);
    majListe();
  });
}

/* ─────────────── raccourcis ───────────────
   Uniquement dans l'onglet assets, et jamais pendant qu'on tape dans un
   champ — sinon écrire « Dupliquer » dans un nom déclencherait la moitié des
   commandes. */

function brancherRaccourcis(){
  addEventListener('keydown', e => {
    if(etat.onglet !== 'assets') return;
    const t = e.target;
    if(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;

    const ctrl = e.ctrlKey || e.metaKey;
    const pas = (Assets.reglages.magnetisme || 0.05) * (e.shiftKey ? 4 : 1);
    let pris = true;

    if(ctrl && e.key.toLowerCase() === 'z'){
      if(Assets.annuler()){ majBiblio(); majListe(); majPile();
                            discret('ANNULÉ', ''); }
    } else if(ctrl && (e.key.toLowerCase() === 'y'
              || (e.shiftKey && e.key.toLowerCase() === 'z'))){
      if(Assets.retablir()){ majBiblio(); majListe(); majPile();
                             discret('RÉTABLI', ''); }
    } else if(ctrl && e.key.toLowerCase() === 'd'){
      Assets.dupliquerParts(); majListe();
    } else if(ctrl && e.key.toLowerCase() === 'a'){
      Assets.toutSelectionner(); majListe();
    } else if(e.key === 'Delete' || e.key === 'Backspace'){
      Assets.supprimerParts(); majListe();
    } else if(e.key === 'ArrowLeft'  || e.key === 'ArrowRight'
           || e.key === 'ArrowUp'    || e.key === 'ArrowDown'
           || e.key === 'PageUp'     || e.key === 'PageDown'){
      const d = {ArrowLeft:[-1,0,0], ArrowRight:[1,0,0],
                 ArrowUp:[0,0,-1],   ArrowDown:[0,0,1],
                 PageUp:[0,1,0],     PageDown:[0,-1,0]}[e.key];
      Assets.memoriser();
      Assets.transformerSelection({t: d.map(v => v * pas)});
      majDetail(); majStats();
    } else if(e.key === 'f' || e.key === 'F'){
      recadrerAsset();
    } else pris = false;

    if(pris){ e.preventDefault(); Projet.enregistrer(); }
  });
}

/* ═══════════════ PANNEAU : CRÉATURE ═══════════════ */

function panneauCreature(){
  const etats = Object.entries(ST)
    .map(([k, v]) => `<option value="${v}">${v}</option>`).join('');
  const curseurs = Creature.CURSEURS.map(([chemin, mn, mx, pas, nom], i) => `
    <label>${nom} <i id="cv${i}">${lire(chemin)}</i>
      <input type="range" id="cs${i}" min="${mn}" max="${mx}" step="${pas}"
             value="${lire(chemin)}"></label>`).join('');

  html('pan-creature', `
    <h3>ÉTAT</h3>
    <select id="crEtat">${etats}</select>
    <p class="aide">Change la grammaire des yeux et la cadence des pattes.
    « poursuite » les fait virer à l'orange et éteint les interstices.</p>

    <h3>POSE</h3>
    <label>Courbure du corps <i id="crCourbeV">0.55</i>
      <input type="range" id="crCourbe" min="0" max="2" step="0.05" value="0.55"></label>
    <label>Étirement <i id="crLongV">1.00</i>
      <input type="range" id="crLong" min="0.3" max="2.5" step="0.05" value="1"></label>
    <label class="case"><input type="checkbox" id="crAnime" checked> animer</label>
    <label class="case"><input type="checkbox" id="crTourne"> faire tourner la vue</label>

    <h3>ANATOMIE</h3>
    ${curseurs}
    <p class="aide">Ces valeurs sont celles de SETUP.creature : elles partent
    directement dans le jeu.</p>
    <div id="crStats" class="aide"></div>
  `);

  el('crEtat').value = Creature.reglages.etat;
  el('crEtat').addEventListener('change', e => { Creature.reglages.etat = e.target.value; });
  const lierR = (id, idv, fn, fmt) => {
    el(id).addEventListener('input', e => {
      const v = parseFloat(e.target.value); fn(v);
      el(idv).textContent = fmt ? fmt(v) : v.toFixed(2);
      Projet.enregistrer();
    });
  };
  lierR('crCourbe', 'crCourbeV', v => Creature.reglages.courbure = v);
  lierR('crLong', 'crLongV', v => Creature.reglages.longueur = v);
  el('crAnime').addEventListener('change', e => { Creature.reglages.anime = e.target.checked; });
  el('crTourne').addEventListener('change', e => { A3.options.tourne = e.target.checked; });

  Creature.CURSEURS.forEach(([chemin, mn, mx, pas], i) => {
    el('cs'+i).addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      ecrire(chemin, pas >= 1 ? Math.round(v) : v);
      el('cv'+i).textContent = lire(chemin);
      Projet.enregistrer();
    });
  });
}

/* ═══════════════ BOUCLE ═══════════════ */

let ratees = 0;

function boucle(now){
  const dt = Math.min(0.05, (now - etat.dernier) / 1000);
  etat.dernier = now;

  etat.images++; etat.tImages += dt;
  if(etat.tImages >= 0.5){
    if(etat.onglet !== 'terrain')
      el('etatPerf').innerHTML = `<b>${Math.round(etat.images / etat.tImages)}</b> ips`;
    etat.images = 0; etat.tImages = 0;
  }

  try{
    if(etat.onglet === 'assets'){
      A3.redimensionner();
      A3.rendre([{m: Assets.maillageAsset()},
                 {m: maillageSurbrillance(), emit: 0.85}], dt);
    } else if(etat.onglet === 'creature'){
      A3.redimensionner();
      A3.rendre([], dt);                 // la grille et le fond
      const tris = Creature.rendreCreature(dt);
      const s = el('crStats');
      if(s) s.textContent = tris.toFixed(0) + ' triangles';
    }
  }catch(e){
    /* Une image ratee ne doit pas tuer la boucle — mais elle ne doit pas
       passer inapercue non plus, sinon on regarde un ecran fige sans savoir
       pourquoi. On le dit une fois, puis on compte. */
    if(++ratees === 1) erreur('RENDU', e.message);
    else if(ratees % 120 === 0) erreur('RENDU', ratees + ' images ratees · ' + e.message);
  }
  requestAnimationFrame(boucle);
}

/* ═══════════════ DÉMARRAGE ═══════════════ */

/* Poignées de mise au point, comme index.html?debug pour le jeu. C'est aussi
   ce que pilote outils/smoke_editeur.py : sans ça il n'y aurait aucun moyen de
   vérifier automatiquement que le générateur suit bien le plan. */
function exposer(){
  if(!location.search.includes('debug')) return;
  window.__PLAN = plan;
  window.__ASSETS = Assets;
  window.__PONT = Pont;
  window.__PROJET = Projet;
  window.__A3 = A3;
  /** Le générateur a-t-il respecté la première zone du plan ? */
  window.__VERIF = () => {
    const z = plan.zones[0];
    if(!z) return {cellules:0, bonBiome:0, pct:'—', villagesDedans:0, villagesDehors:0};
    let cellules = 0, bon = 0;
    for(let cz=z.z; cz<z.z+z.h; cz++) for(let cx=z.x; cx<z.x+z.w; cx++){
      const i = Grille.idx(cx, cz);
      if(Grille.grid[i] !== Grille.FLOOR) continue;
      cellules++;
      if(Grille.biome[i] === z.biome) bon++;
    }
    let dedans = 0, dehors = 0;
    for(const v of Villages.villages){
      const cx = Grille.w2c(v.x), cz = Grille.w2c(v.z);
      if(cx >= z.x && cx < z.x+z.w && cz >= z.z && cz < z.z+z.h) dedans++;
      else dehors++;
    }
    return {cellules, bonBiome:bon,
            pct: cellules ? (bon/cellules*100).toFixed(1) : '—',
            villagesDedans:dedans, villagesDehors:dehors};
  };
}

function majEtatPlan(){
  el('etatPlan').innerHTML = plan.zones.length
    ? `<b>${plan.zones.length}</b> zones au plan`
    : 'plan vide — le monde reste procedural';
}

function demarrer(){
  capturerErreurs();          // avant tout le reste : on veut voir les pannes
  info('FORGE', 'demarrage');
  Projet.charger();
  exposer();

  panneauTerrain();
  panneauAssets();
  panneauCreature();

  Terrain.brancherSouris();
  Terrain.brancher(detailZone);
  A3.brancherSouris(cv);
  brancherClic3D();
  brancherRaccourcis();

  /* Le lanceur est-il derrière nous ? De sa réponse dépend un seul bouton,
     mais c'est celui qui fait la différence entre un éditeur et une
     visionneuse : écrire l'élément directement dans le jeu. */
  Pont.tester().then(ok => {
    const b = el('aEcrire');
    if(b) b.hidden = !ok;
    const sem = el('aSemis');
    if(sem) sem.hidden = !ok;
    if(ok) majBiomesCases();
    if(ok) succes('PONT', 'lanceur détecté — la forge peut écrire dans props.js');
    else discret('PONT', 'lancé hors application : export par copie et '
      + 'téléchargement uniquement');
  });

  for(const o of ['terrain','assets','creature'])
    el('ong-' + o).addEventListener('click', () => montrer(o));

  el('btSauver').addEventListener('click', () => {
    Projet.telecharger(plan.nom);
    succes('ENREGISTRE', plan.nom + '.json');
  });
  el('btJouer').addEventListener('click', () => {
    enregistrerPlan(); Projet.enregistrer();
    info('JOUER', plan.zones.length + ' zones transmises au jeu');
    open('index.html', '_blank');
  });
  el('btOuvrir').addEventListener('click', () => el('fichier').click());
  el('fichier').addEventListener('change', e => {
    const f = e.target.files[0]; if(!f) return;
    const r = new FileReader();
    r.onload = () => {
      try{
        Projet.depuisObjet(JSON.parse(r.result));
        Projet.enregistrer();
        detailZone(); majBiblio(); majListe(); majPile(); Terrain.dessiner();
        majEtatPlan(); succes('OUVERT', f.name);
      }catch(err){
        erreur('OUVERTURE', f.name + ' illisible : ' + err.message);
        alert('Fichier illisible : ' + err.message);
      }
    };
    r.readAsText(f);
  });
  Projet.brancherDepot(nom => {
    detailZone(); majBiblio(); majListe(); majPile(); Terrain.dessiner(); majEtatPlan();
    succes('DEPOSE', nom);
  });

  addEventListener('resize', () => {
    if(etat.onglet === 'terrain') Terrain.dessiner(); else A3.redimensionner();
  });

  montrer('terrain');
  detailZone();
  Terrain.dessiner();
  majEtatPlan();

  succes('PRET', 'moteur du jeu charge · ' + BIOMES.length + ' biomes · '
    + Assets.TYPES.length + ' types d\'elements');
  discret('astuce', 'trace une zone, choisis son biome, puis « Generer un apercu »');

  requestAnimationFrame(boucle);
}

demarrer();
