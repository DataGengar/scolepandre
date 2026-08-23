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
import * as Terrain from './terrain.js';
import * as Assets from './assets.js';
import * as Creature from './creature-edit.js';
import * as Projet from './projet.js';

const el = id => document.getElementById(id);
const html = (id, s) => { const e = el(id); if(e) e.innerHTML = s; };

const etat = {onglet: 'terrain', dernier: performance.now()};

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
      <button id="btJouer" class="fort">Jouer ce monde</button>
      <button id="btVider">Tout effacer</button>
    </div>
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
  el('btApercuOff').addEventListener('click', () => Terrain.effacerApercu());
  el('btJouer').addEventListener('click', () => {
    enregistrerPlan(); Projet.enregistrer();
    open('index.html', '_blank');
  });
  el('btVider').addEventListener('click', () => {
    if(!confirm('Effacer toutes les zones du plan ?')) return;
    effacerPlan(); Terrain.etat.selection = null;
    Projet.enregistrer(); detailZone(); Terrain.dessiner();
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
  const maj = () => { enregistrerPlan(); Projet.enregistrer(); Terrain.dessiner(); };

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
    plan.zones.splice(plan.zones.indexOf(z), 1);
    Terrain.etat.selection = null;
    maj(); detailZone();
  });
}

async function genererApercu(){
  const r = el('rapport');
  r.textContent = 'génération…';
  semer(undefined);
  const gen = construireMonde({});
  for(;;){
    const {value, done} = gen.next();
    if(done) break;
    r.textContent = value.nom + '…';
    await new Promise(res => requestAnimationFrame(res));
  }
  Terrain.capturerApercu();
  const rap = rapportMonde();
  r.innerHTML = Object.entries(rap)
    .map(([k, v]) => `<span>${k}</span> ${v}`).join('<br>');
}

/* ═══════════════ PANNEAU : ASSETS ═══════════════ */

function panneauAssets(){
  const types = Assets.TYPES.map(t => `<option>${t}</option>`).join('');
  const biomes = BIOMES.map((b,i) => `<option value="${i}">${b.n}</option>`).join('');

  html('pan-assets', `
    <h3>CHARGER UN ÉLÉMENT DU JEU</h3>
    <select id="aType">${types}</select>
    <label>Biome<select id="aBiome">${biomes}</select></label>
    <div class="rangee">
      <button id="aCharger" class="fort">Charger</button>
      <button id="aRegraine">Autre tirage</button>
    </div>
    <p class="aide">Appelle la vraie fonction du jeu et récupère la géométrie
    produite. C'est l'élément tel qu'il apparaît en partie, pas une imitation.</p>

    <h3>COMPOSER</h3>
    <div class="rangee">
      <button id="aBloc">+ bloc</button>
      <button id="aTube">+ tube</button>
      <button id="aDup">Dupliquer</button>
      <button id="aDel">Supprimer</button>
      <button id="aVider">Vider</button>
    </div>
    <div id="aListe" class="liste"></div>
    <div id="aDetail"></div>

    <h3>SORTIE</h3>
    <div id="aStats" class="aide"></div>
    <div class="rangee">
      <button id="aCode">Copier le code</button>
      <button id="aCadrer">Recadrer</button>
    </div>
    <textarea id="aSortie" rows="6" readonly></textarea>
  `);

  let graineAsset = 1;
  const recharger = () => {
    Assets.chargerDuJeu(el('aType').value, parseInt(el('aBiome').value,10), graineAsset);
    const b = Assets.bornes(); A3.cadrer(b.centre, b.rayon);
    listeParts(); Projet.enregistrer();
  };
  el('aCharger').addEventListener('click', recharger);
  el('aRegraine').addEventListener('click', () => { graineAsset++; recharger(); });

  el('aBloc').addEventListener('click', () => { Assets.ajouterBloc(); listeParts(); });
  el('aTube').addEventListener('click', () => { Assets.ajouterTube(); listeParts(); });
  el('aDup').addEventListener('click',  () => { Assets.dupliquer(); listeParts(); });
  el('aDel').addEventListener('click',  () => { Assets.supprimer(); listeParts(); });
  el('aVider').addEventListener('click',() => { Assets.vider(); listeParts(); });
  el('aCadrer').addEventListener('click', () => {
    const b = Assets.bornes(); A3.cadrer(b.centre, b.rayon);
  });
  el('aCode').addEventListener('click', () => {
    const t = el('aSortie');
    t.value = Assets.versCode();
    t.select();
    try{ document.execCommand('copy'); }catch(e){}
  });
  listeParts();
}

function listeParts(){
  const p = Assets.asset.parts;
  html('aListe', p.length
    ? p.map((q, i) => `<button class="pt${i === Assets.asset.selection ? ' sel' : ''}"
        data-i="${i}">${i}. ${q.tube ? 'tube' : 'bloc'}${q.emis ? ' ✦' : ''}</button>`).join('')
    : '<p class="aide">Vide. Charge un élément, ou ajoute une primitive.</p>');
  for(const b of el('aListe').querySelectorAll('.pt'))
    b.addEventListener('click', () => {
      Assets.asset.selection = parseInt(b.dataset.i, 10);
      listeParts();
    });
  detailPart();
  el('aStats').textContent =
    `${p.length} primitives · ${Assets.triangles()} triangles`;
}

function detailPart(){
  const q = Assets.asset.parts[Assets.asset.selection];
  if(!q){ html('aDetail', ''); return; }

  const n = (lbl, id, v, pas) =>
    `<label>${lbl}<input type="number" step="${pas}" id="${id}" value="${v}"></label>`;
  const rgb = c => '#' + c.map(v =>
    Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2,'0')).join('');

  html('aDetail', (q.tube
    ? `<div class="g3">${n('x₀','p0x',q.tube[0][0],.05)}${n('y₀','p0y',q.tube[0][1],.05)}${n('z₀','p0z',q.tube[0][2],.05)}</div>
       <div class="g3">${n('x₁','p1x',q.tube[2][0],.05)}${n('y₁','p1y',q.tube[2][1],.05)}${n('z₁','p1z',q.tube[2][2],.05)}</div>
       <div class="g3">${n('r₀','r0',q.tube[1],.01)}${n('r₁','r1',q.tube[3],.01)}${n('côtés','nc',q.tube[4]||6,1)}</div>`
    : `<div class="g3">${n('x','bx',q.x,.05)}${n('y','by',q.y,.05)}${n('z','bz',q.z,.05)}</div>
       <div class="g3">${n('largeur','bsx',q.sx,.05)}${n('hauteur','bsy',q.sy,.05)}${n('prof.','bsz',q.sz,.05)}</div>
       <div class="g3">${n('rotation','br',q.r||0,.05)}</div>`)
    + `<div class="g3">
         <label>couleur<input type="color" id="pc" value="${rgb(q.c)}"></label>
         <label>intensité<input type="number" step="0.1" id="pi" value="1"></label>
         <label class="case"><input type="checkbox" id="pe" ${q.emis?'checked':''}> émissif</label>
       </div>`);

  const lier = (id, fn) => {
    const e = el(id); if(!e) return;
    e.addEventListener('input', () => { fn(parseFloat(e.value) || 0); Assets.salir();
                                        el('aStats').textContent =
      `${Assets.asset.parts.length} primitives · ${Assets.triangles()} triangles`; });
  };
  if(q.tube){
    lier('p0x', v => q.tube[0][0]=v); lier('p0y', v => q.tube[0][1]=v); lier('p0z', v => q.tube[0][2]=v);
    lier('p1x', v => q.tube[2][0]=v); lier('p1y', v => q.tube[2][1]=v); lier('p1z', v => q.tube[2][2]=v);
    lier('r0', v => q.tube[1]=v); lier('r1', v => q.tube[3]=v);
    lier('nc', v => q.tube[4]=Math.max(3, Math.round(v)));
  } else {
    lier('bx', v => q.x=v); lier('by', v => q.y=v); lier('bz', v => q.z=v);
    lier('bsx', v => q.sx=v); lier('bsy', v => q.sy=v); lier('bsz', v => q.sz=v);
    lier('br', v => q.r=v);
  }
  const maj = () => {
    const h = el('pc').value, k = parseFloat(el('pi').value) || 1;
    q.c = [parseInt(h.slice(1,3),16)/255*k,
           parseInt(h.slice(3,5),16)/255*k,
           parseInt(h.slice(5,7),16)/255*k];
    q.emis = el('pe').checked ? 1 : 0;
    Assets.salir();
  };
  el('pc').addEventListener('input', maj);
  el('pi').addEventListener('input', maj);
  el('pe').addEventListener('change', maj);
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

function boucle(now){
  const dt = Math.min(0.05, (now - etat.dernier) / 1000);
  etat.dernier = now;
  try{
    if(etat.onglet === 'assets'){
      A3.redimensionner();
      A3.rendre([{m: Assets.maillageAsset()}], dt);
    } else if(etat.onglet === 'creature'){
      A3.redimensionner();
      A3.rendre([], dt);                 // la grille et le fond
      const tris = Creature.rendreCreature(dt);
      const s = el('crStats');
      if(s) s.textContent = tris.toFixed(0) + ' triangles';
    }
  }catch(e){ console.error('image ignorée :', e); }
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

function demarrer(){
  Projet.charger();
  exposer();

  panneauTerrain();
  panneauAssets();
  panneauCreature();

  Terrain.brancherSouris();
  Terrain.brancher(detailZone);
  A3.brancherSouris(cv);

  for(const o of ['terrain','assets','creature'])
    el('ong-' + o).addEventListener('click', () => montrer(o));

  el('btSauver').addEventListener('click', () => {
    Projet.telecharger(plan.nom);
  });
  el('btOuvrir').addEventListener('click', () => el('fichier').click());
  el('fichier').addEventListener('change', e => {
    const f = e.target.files[0]; if(!f) return;
    const r = new FileReader();
    r.onload = () => {
      try{
        Projet.depuisObjet(JSON.parse(r.result));
        Projet.enregistrer();
        detailZone(); listeParts(); Terrain.dessiner();
        el('etatBarre').textContent = 'chargé : ' + f.name;
      }catch(err){ alert('Fichier illisible : ' + err.message); }
    };
    r.readAsText(f);
  });
  Projet.brancherDepot(nom => {
    detailZone(); listeParts(); Terrain.dessiner();
    el('etatBarre').textContent = 'chargé : ' + nom;
  });

  addEventListener('resize', () => {
    if(etat.onglet === 'terrain') Terrain.dessiner(); else A3.redimensionner();
  });

  montrer('terrain');
  detailZone();
  Terrain.dessiner();
  el('etatBarre').textContent = plan.zones.length
    ? plan.zones.length + ' zones chargées'
    : 'plan vide — le monde reste procédural';

  requestAnimationFrame(boucle);
}

demarrer();
