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

let dernierMessage = null;

export function majHUD(ctx){
  const {joueur, biome, nappe, pavesVus, pavesTotal, graine, sortie, monde} = ctx;

  // ── leurres en main
  const l = el('lures');
  if(l) l.innerHTML = '◆'.repeat(joueur.held) + '<u>' + '◆'.repeat(3-joueur.held) + '</u>';

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

  // message de franchissement de palier
  const m = el('alerte');
  if(!m) return;
  if(froid.message !== dernierMessage){
    dernierMessage = froid.message;
    m.textContent = froid.message || '';
    m.style.opacity = froid.message ? '1' : '0';
  } else if(!froid.message) m.style.opacity = '0';
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
let flashT = 0;
export function flash(texte, duree = 2.2){
  const m = el('alerte');
  if(!m) return;
  m.textContent = texte;
  m.style.opacity = '1';
  flashT = duree;
  dernierMessage = texte;
}

export function majFlash(dt){
  if(flashT <= 0) return;
  flashT -= dt;
  if(flashT <= 0){
    const m = el('alerte');
    if(m && !froid.message){ m.style.opacity = '0'; dernierMessage = null; }
  }
}
