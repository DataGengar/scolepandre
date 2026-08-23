/* ═══ ÉDITEUR / PROJET ═══
   Ce qui se sauve, où, et sous quelle forme.

   ── DEUX SUPPORTS, DEUX USAGES ─────────────────────────────────────────────
   NAVIGATEUR (localStorage) — automatique, à chaque modification. C'est le
   filet : on ferme l'onglet par erreur, on retrouve son travail. Le jeu lit le
   plan au même endroit, donc « éditer puis jouer » ne demande aucune
   manipulation.

   FICHIER (.json) — explicite, par les boutons. C'est ce qu'on met sur le
   dépôt, ce qu'on s'envoie, ce dont on garde plusieurs versions.

   ── CE QUE CONTIENT UN PROJET ──────────────────────────────────────────────
     plan      les zones du monde
     assets    les éléments de décor composés
     creature  les réglages du scolopandre
     setup     UNIQUEMENT les valeurs modifiées, pas tout SETUP

   Ce dernier point compte : enregistrer SETUP en entier figerait les défauts
   du jour. En ne gardant que les écarts, un projet reste valable après une mise
   à jour du jeu — les valeurs auxquelles tu n'as pas touché suivent.         */

import {SETUP} from '../setup.js';
import {plan, appliquer as appliquerPlan, enregistrerPlan} from '../monde/plan.js';
import * as Assets from './assets.js';
import {reglages as reglagesCreature} from './creature-edit.js';

const CLE = 'scolopandre.projet.v1';

/** Les branches de SETUP que l'éditeur a le droit de sauvegarder. */
const BRANCHES = ['creature', 'jeunes', 'image', 'lampe', 'lumiereDecor',
                  'lune', 'monde', 'relief', 'villages', 'cachettes'];

/** Instantané des défauts, pris au chargement : sert à calculer les écarts. */
const DEFAUTS = JSON.parse(JSON.stringify(
  Object.fromEntries(BRANCHES.map(b => [b, SETUP[b]]))));

/** Les seules valeurs qui diffèrent des défauts, en chemins plats. */
function ecarts(){
  const out = {};
  const parcourir = (a, b, prefixe) => {
    for(const k in b){
      const va = a ? a[k] : undefined, vb = b[k];
      if(vb && typeof vb === 'object' && !Array.isArray(vb)){
        parcourir(va, vb, prefixe + k + '.');
      } else if(JSON.stringify(va) !== JSON.stringify(vb)){
        out[prefixe + k] = vb;
      }
    }
  };
  for(const b of BRANCHES) parcourir(DEFAUTS[b], SETUP[b], b + '.');
  return out;
}

function appliquerEcarts(e){
  if(!e) return;
  for(const chemin in e){
    const parts = chemin.split('.');
    const cle = parts.pop();
    let o = SETUP;
    for(const p of parts){ if(!o[p]) return; o = o[p]; }
    o[cle] = e[chemin];
  }
}

/* ─────────────── forme sérialisée ─────────────── */

export function versObjet(){
  return {
    version: 1,
    date: new Date().toISOString().slice(0, 19).replace('T', ' '),
    plan: {version: plan.version, nom: plan.nom, zones: plan.zones},
    /* La BIBLIOTHÈQUE entière, piles de modificateurs comprises. Ce sont
       les recettes qu'on voudra reprendre : garder seulement les primitives
       finales reviendrait à jeter la règle et à ne conserver que son
       résultat, impossible à retoucher. */
    assets: Assets.versObjet(),
    creature: {...reglagesCreature},
    setup: ecarts(),
  };
}

export function depuisObjet(o){
  if(!o) return false;
  if(o.plan) appliquerPlan(o.plan);
  // `o.asset` est l'ancien format, à un seul élément sans pile.
  if(o.assets || o.asset) Assets.depuisObjet(o.assets || o.asset);
  if(o.creature) Object.assign(reglagesCreature, o.creature);
  appliquerEcarts(o.setup);
  return true;
}

/* ─────────────── navigateur ─────────────── */

export function enregistrer(){
  try{
    localStorage.setItem(CLE, JSON.stringify(versObjet()));
    enregistrerPlan();          // le jeu lit le plan à sa propre clé
    return true;
  }catch(e){ return false; }
}

export function charger(){
  try{
    const b = localStorage.getItem(CLE);
    return b ? depuisObjet(JSON.parse(b)) : false;
  }catch(e){ return false; }
}

/* ─────────────── fichier ─────────────── */

export function telecharger(nom){
  const blob = new Blob([JSON.stringify(versObjet(), null, 2)],
                        {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (nom || plan.nom || 'projet') + '.scolo.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Branche le glisser-déposer d'un .json sur toute la page. */
export function brancherDepot(surCharge){
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if(!f) return;
    const r = new FileReader();
    r.onload = () => {
      try{
        depuisObjet(JSON.parse(r.result));
        enregistrer();
        if(surCharge) surCharge(f.name);
      }catch(err){ alert('Fichier illisible : ' + err.message); }
    };
    r.readAsText(f);
  });
}
