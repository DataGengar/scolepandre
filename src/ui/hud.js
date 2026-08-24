/* ═══ UI / HUD ═══
   Le bandeau du bas, l'objectif en haut à gauche, la jauge de chaleur.

   La jauge de froid est nouvelle : en v2 la chaleur était une ligne de texte
   noyée dans une chaîne de trois valeurs, ce qui explique en partie pourquoi
   le système « ne faisait rien » — on ne le voyait pas. Ici c'est une barre
   dédiée, qui change de couleur par palier et clignote en hypothermie.      */

import {SETUP} from '../setup.js';
import {BIOMES} from '../monde/biomes.js';
import {froid} from '../joueur/froid.js';
import {torche} from '../joueur/torche.js';
import {sante} from '../joueur/sante.js';
import {inventaire} from '../joueur/feu.js';
import {possede} from '../carte/collection.js';
import {total} from '../carte/catalogue.js';

const el = id => document.getElementById(id);

const COULEUR_PALIER = ['#8fa88c', '#b8a25f', '#6f9fc0', '#b4553f'];


export function majHUD(ctx){
  const {joueur, biome, nappe, pavesVus, pavesTotal, graine, sortie, monde} = ctx;

  /* ── EN MAIN ──
     Les mains vides montrent les leurres, comme avant. Une arme montre son
     nom et, s'il en faut, ses munitions. Un seul emplacement pour les deux :
     on tient une chose à la fois, et l'afficher deux fois brouillerait la
     seule question qui compte — qu'est-ce que je fais si ça arrive ? */
  const l = el('lures');
  if(l){
    const A = ctx.arme;
    if(!A || A.genre === 'leurre'){
      l.innerHTML = '◆'.repeat(joueur.held)
                  + '<u>' + '◆'.repeat(3-joueur.held) + '</u>';
    } else {
      const mun = A.munition
        ? '  <u>·</u>  ' + (ctx.munitions | 0)
        : '';
      l.innerHTML = A.nom + mun;
    }
  }

  // ── lieu et altitude
  const p = el('place');
  if(p) p.textContent = BIOMES[biome].n + '   ·   '
    + (joueur.gy >= 0 ? '+' : '') + joueur.gy.toFixed(0) + ' m'
    + (joueur.abrite ? '   ·   À L\'ABRI' : '');

  // ── nappe et diagnostic
  const nap = el('nappe');
  if(nap) nap.textContent = 'nappe ' + nappe + '  ·  ' + pavesVus + '/' + pavesTotal
    + ' pavés  ·  graine ' + graine.toString(16);

  // ── objectif
  if(sortie){
    const d = Math.hypot(sortie.x - joueur.x, sortie.z - joueur.z);
    const e = el('oDist');
    if(e) e.textContent = d > 400 ? 'très loin' : d.toFixed(0) + ' m';
  }
  const oc = el('oCartes');
  if(oc) oc.textContent = possede.size + '/' + total();
  const op = el('oProf');
  if(op) op.textContent = joueur.gy.toFixed(0) + ' m  ·  lampe '
    + (torche.on ? (torche.jus*100).toFixed(0) + '%' : 'éteinte');

  // sac : bois et fusées, les deux objets qu'on compte vraiment
  const sac = el('sac');
  if(sac) sac.innerHTML =
    '<b>' + inventaire.bois + '</b> bois &nbsp; <b>' + inventaire.fusees + '</b> fusée'
    + (inventaire.fusees > 1 ? 's' : '');

  // ── jauges
  majJauge();
  majSante();
}

function majJauge(){
  const barre = el('chaleurBarre'), txt = el('chaleurTxt'), boite = el('chaleur');
  if(!barre) return;
  const c = froid.chaleur;
  barre.style.width = c.toFixed(1) + '%';
  barre.style.background = COULEUR_PALIER[froid.palier];
  if(txt) txt.textContent = froid.nomPalier === '—'
    ? c.toFixed(0) + '%'
    : froid.nomPalier + ' · ' + c.toFixed(0) + '%';
  if(boite) boite.classList.toggle('critique', froid.palier === 3);

  // le message de palier passe par le même canal que le reste : voir majAlerte()
}

/* ═══ LE CANAL DES MESSAGES ═══
   BUG CORRIGÉ ICI. flash() et le message de froid écrivaient tous les deux
   dans #alerte sans se concerter. Comme la mise à jour du HUD tourne cinq fois
   par seconde et que flash() posait son texte dans `dernierMessage`, la
   comparaison `froid.message !== dernierMessage` était vraie à l'itération
   suivante — et le HUD effaçait le flash au bout de 200 ms.

   Conséquence : AUCUN message transitoire n'était lisible. Ni le texte d'une
   pancarte, ni « À L'ABRI », ni « FEU ALLUMÉ », ni « EFFONDREMENT ».

   Un seul écrivain désormais, avec une priorité explicite :
     1. le flash, tant qu'il lui reste du temps ;
     2. sinon le palier de froid ;
     3. sinon rien.                                                          */
let texteAffiche = null;

function majAlerte(){
  const m = el('alerte');
  if(!m) return;
  const voulu = flashT > 0 ? flashTexte : (froid.message || null);
  if(voulu === texteAffiche) return;
  texteAffiche = voulu;
  m.textContent = voulu || '';
  m.style.opacity = voulu ? '1' : '0';
}

/* La santé n'existait pas en v3.0 : on mourait d'un coup. Sa jauge est
   volontairement au-dessus de celle du froid — c'est celle qu'on regarde
   quand ça va mal. */
function majSante(){
  const barre = el('santeBarre'), txt = el('santeTxt'), boite = el('sante');
  if(!barre) return;
  const p = sante.pv;
  barre.style.width = p.toFixed(1) + '%';
  barre.style.background = p > 60 ? '#8fa88c' : p > 30 ? '#b8a25f' : '#b4553f';
  if(txt) txt.textContent = p.toFixed(0) + '%';
  if(boite) boite.classList.toggle('critique', p < 30);
}

/** Message ponctuel au centre bas (entrée en cachette, effondrement…). */
let flashT = 0, flashTexte = '';

export function flash(texte, duree = 2.6){
  flashTexte = texte;
  flashT = duree;
  majAlerte();
}

/** Appelé à chaque image : c'est lui qui fait vivre le canal des messages. */
export function majFlash(dt){
  if(flashT > 0) flashT -= dt;
  majAlerte();
}

/* ═══ LE PANNEAU DE LECTURE DES PANCARTES ═══
   Un flash de deux secondes ne convient pas à un panneau : on veut le lire, et
   surtout le RELIRE en s'approchant. Le panneau reste donc affiché tant qu'on
   est à portée, sans appuyer sur quoi que ce soit. C'est aussi ce qui rend la
   touche B utile pour autre chose : écrire, pas déchiffrer. */
let pancarteAffichee = null;

export function majPancarte(p){
  const el2 = el('pancarte');
  if(!el2) return;
  if(p === pancarteAffichee) return;
  pancarteAffichee = p;
  if(!p){ el2.style.opacity = '0'; return; }
  el2.innerHTML = p.texte
    ? '<i>« </i>' + echapper(p.texte) + '<i> »</i>'
      + '<u>B pour réécrire · MAJ+B pour retirer</u>'
    : '<i>pancarte vierge</i><u>B pour y écrire</u>';
  el2.style.opacity = '1';
}

const echapper = t => String(t)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
