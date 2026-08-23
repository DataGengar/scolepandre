/* ═══ RENDU / SISMOGRAPHE ═══
   La mini-carte. Elle ne montre pas le monde : elle montre ce que TU peux
   déduire. Le relief, tes traces, les vibrations, sa trajectoire présumée.

   ── NOUVEAU EN v3 ──────────────────────────────────────────────────────────
     · les GOUFFRES apparaissent en noir plein, cernés d'un liseré : le seul
       moyen honnête de ne pas mourir bêtement en marchant à reculons ;
     · les PONTS sont tracés en pointillés clairs ;
     · les CACHETTES sont un losange creux, visible seulement à moins de
       SETUP.cachettes.porteeMarqueur — « discrètement visibles », comme
       demandé : il faut s'en approcher une fois pour les connaître.          */

import {SETUP} from '../setup.js';
import {clamp, lerp} from '../noyau/math.js';
import {
  GW, GH, CELL, FLOOR, grid, blocked, floorH, vide, pont, idx, w2c, groundAt,
} from '../monde/grille.js';
import {cachettes} from '../monde/cachettes.js';
import {pancartes} from '../monde/pancartes.js';
import {villages} from '../monde/villages.js';
import {creature, sampleBody} from '../creatures/mere.js';
import {jeunes} from '../creatures/jeunes.js';
import {directeur} from '../creatures/directeur.js';
import {ST} from '../creatures/etats.js';
import {diag} from '../monde/navigation.js';

const dbg = document.getElementById('dbg');
const dc  = dbg ? dbg.getContext('2d') : null;

// réassigné, donc module-local ; on expose un lecteur (cf. outils/verifier.py)
let visible = true;
export const estVisible = () => visible;
export function basculer(){
  visible = !visible;
  const el = document.getElementById('scope');
  if(el) el.style.display = visible ? 'block' : 'none';
}

const SPAN = 48;   // demi-largeur affichée, en mètres

export function dessinerScope(joueur, sons, odeur, dP){
  if(!visible || !dc) return;
  const S = dbg.width, k = S/(SPAN*2);
  const ox = joueur.x - SPAN, oz = joueur.z - SPAN;
  const X = v => (v-ox)*k, Z = v => (v-oz)*k;

  dc.fillStyle = '#07080a'; dc.fillRect(0,0,S,S);

  // ── relief, gouffres, ponts
  const x0 = Math.max(0, w2c(ox)), x1 = Math.min(GW-1, w2c(ox+SPAN*2));
  const z0 = Math.max(0, w2c(oz)), z1 = Math.min(GH-1, w2c(oz+SPAN*2));
  const ph = groundAt(joueur.x, joueur.z);
  const taille = CELL*k + 0.6;

  for(let z=z0; z<=z1; z++) for(let x=x0; x<=x1; x++){
    const i = idx(x,z);
    if(grid[i] !== FLOOR) continue;
    if(vide[i]){
      dc.fillStyle = '#000';                 // le gouffre : noir plein
    } else if(pont[i]){
      dc.fillStyle = '#3a352c';              // le tablier
    } else if(blocked[i]){
      dc.fillStyle = '#15161a';
    } else {
      // le relief se lit en clair/sombre : plus haut = plus clair
      const rel = clamp((floorH[i]-ph)/8 + 0.5, 0, 1);
      const g = Math.round(lerp(14, 58, rel));
      dc.fillStyle = `rgb(${g},${g+1},${g-2})`;
    }
    dc.fillRect(X(x*CELL), Z(z*CELL), taille, taille);
  }

  // liseré de précipice : la lèvre des gouffres, en rouge sourd
  dc.strokeStyle = 'rgba(150,60,45,.55)'; dc.lineWidth = 1;
  for(let z=z0; z<=z1; z++) for(let x=x0; x<=x1; x++){
    const i = idx(x,z);
    if(grid[i] !== FLOOR || vide[i]) continue;
    let bord = false;
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx = x+dx, nz = z+dz;
      if(nx<0||nz<0||nx>=GW||nz>=GH) continue;
      if(vide[idx(nx,nz)]){ bord = true; break; }
    }
    if(bord) dc.strokeRect(X(x*CELL), Z(z*CELL), taille, taille);
  }

  // ── cachettes : discrètes, et seulement de près
  for(const c of cachettes){
    const d = Math.hypot(c.x-joueur.x, c.z-joueur.z);
    if(d > SETUP.cachettes.porteeMarqueur) continue;
    const a = 0.25 + 0.6*(1 - d/SETUP.cachettes.porteeMarqueur);
    dc.strokeStyle = `rgba(143,168,140,${a})`; dc.lineWidth = 1;
    const px = X(c.entree.x), pz = Z(c.entree.z), r = 4;
    dc.beginPath();
    dc.moveTo(px, pz-r); dc.lineTo(px+r, pz); dc.lineTo(px, pz+r); dc.lineTo(px-r, pz);
    dc.closePath(); dc.stroke();
  }

  /* ── LES VILLAGES DÉJÀ VISITÉS ──
     Rien tant qu'on n'y est pas entré : un village doit se trouver, pas se
     lire sur une carte. Une fois découvert, il reste marqué pour de bon — un
     cercle plein, la seule tache franchement chaude du sismographe. */
  for(const v of villages){
    if(!v.vu) continue;
    const px = X(v.x), pz = Z(v.z);
    dc.fillStyle = 'rgba(255,168,72,.22)';
    dc.beginPath(); dc.arc(px, pz, v.safe*k, 0, 6.283); dc.fill();
    dc.strokeStyle = 'rgba(255,168,72,.85)'; dc.lineWidth = 1.4;
    dc.beginPath(); dc.arc(px, pz, v.safe*k, 0, 6.283); dc.stroke();
    dc.fillStyle = 'rgba(255,196,120,.95)';
    dc.beginPath(); dc.arc(px, pz, 2.6, 0, 6.283); dc.fill();
  }

  /* ── TES PANCARTES ──
     Elles apparaissent à TOUTE distance, contrairement aux cachettes : c'est
     tout leur intérêt. Un petit carré cyan qui clignote au même rythme que la
     loupiote du panneau — on fait le lien tout de suite entre ce qu'on voit
     dans le monde et ce qu'on voit sur la carte. */
  {
    const ph = (Date.now()/1600) % 1;
    const on = ph < 0.24 ? 1 : 0.32;
    for(const p of pancartes){
      dc.fillStyle = `rgba(64,215,180,${on})`;
      dc.fillRect(X(p.x)-2, Z(p.z)-2, 4, 4);
      dc.strokeStyle = `rgba(64,215,180,${on*0.45})`; dc.lineWidth = 1;
      dc.strokeRect(X(p.x)-4.5, Z(p.z)-4.5, 9, 9);
    }
  }

  // ── ta piste odorante
  dc.strokeStyle = 'rgba(143,168,140,.30)'; dc.lineWidth = 1;
  dc.beginPath();
  for(let i=0;i<odeur.length;i++){
    const p = odeur[i];
    i ? dc.lineTo(X(p.x), Z(p.z)) : dc.moveTo(X(p.x), Z(p.z));
  }
  dc.stroke();

  // ── zone du directeur
  dc.strokeStyle = 'rgba(207,199,180,.15)'; dc.setLineDash([2,4]);
  dc.beginPath();
  dc.arc(X(directeur.zone.x), Z(directeur.zone.z), directeur.zone.r*k, 0, 6.283);
  dc.stroke(); dc.setLineDash([]);

  // ── son trajet
  const p = creature.path;
  if(p && p.length > 1){
    dc.strokeStyle = 'rgba(180,85,63,.85)'; dc.lineWidth = 1.2;
    dc.beginPath();
    dc.moveTo(X(creature.x), Z(creature.z));
    for(let i=creature.pathIdx;i<p.length;i++) dc.lineTo(X(p[i].x), Z(p[i].z));
    dc.stroke();
  }

  // ── vibrations
  for(const s of sons){
    const a = 1 - s.t/0.8;
    dc.strokeStyle = s.lure ? `rgba(207,199,180,${a*0.8})` : `rgba(207,199,180,${a*0.45})`;
    dc.lineWidth = s.lure ? 1.5 : 1;
    dc.beginPath();
    dc.arc(X(s.x), Z(s.z), s.r*k*(0.35 + s.t*0.9), 0, 6.283);
    dc.stroke();
  }

  // ── sa croyance
  const b = creature.belief;
  if(b.conf > 0.02){
    dc.lineWidth = 1;
    dc.strokeStyle = `rgba(180,85,63,${0.25 + b.conf*0.5})`;
    dc.beginPath();
    dc.arc(X(b.x), Z(b.z), 4 + (1-b.conf)*16, 0, 6.283);
    dc.stroke();
  }

  // ── les jeunes : ils doivent se voir, sinon on meurt sans comprendre
  for(const j of jeunes){
    dc.fillStyle = j.proche < 14 ? 'rgba(201,97,74,.95)' : 'rgba(180,120,90,.7)';
    dc.beginPath(); dc.arc(X(j.x), Z(j.z), 2, 0, 6.283); dc.fill();
    dc.strokeStyle = 'rgba(180,120,90,.45)'; dc.lineWidth = 1;
    dc.beginPath();
    for(let q=0;q<j.hist.length;q+=2){
      const p2 = j.hist[j.hist.length-1-q];
      if(!p2) break;
      q ? dc.lineTo(X(p2.x), Z(p2.z)) : dc.moveTo(X(p2.x), Z(p2.z));
    }
    dc.stroke();
  }

  // ── elle
  dc.fillStyle = creature.state === ST.LISTEN ? '#cfc7b4' : '#b4553f';
  dc.beginPath(); dc.arc(X(creature.x), Z(creature.z), 3, 0, 6.283); dc.fill();
  dc.strokeStyle = 'rgba(180,85,63,.55)';
  dc.beginPath();
  for(let i=0;i<creature.SEG;i++){
    const q = sampleBody(i*creature.SP);
    i ? dc.lineTo(X(q.x), Z(q.z)) : dc.moveTo(X(q.x), Z(q.z));
  }
  dc.stroke();

  // ── toi
  dc.fillStyle = joueur.abrite ? '#8fa88c' : '#cfc7b4';
  dc.beginPath(); dc.arc(S/2, S/2, 2.5, 0, 6.283); dc.fill();
  dc.strokeStyle = 'rgba(207,199,180,.45)';
  dc.beginPath(); dc.moveTo(S/2, S/2);
  dc.lineTo(S/2 - Math.sin(joueur.yaw)*13, S/2 - Math.cos(joueur.yaw)*13);
  dc.stroke();

  majLecture(dP);
}

function majLecture(dP){
  const set = (id, v, hot) => {
    const e = document.getElementById(id);
    if(!e) return;
    e.textContent = v; e.className = hot ? 'hot' : '';
  };
  const lbl = document.getElementById('stateLbl');
  if(lbl) lbl.textContent = creature.state.toUpperCase();

  const b = creature.belief;
  set('rDist', dP.toFixed(1) + ' m', dP < 12);
  set('rConf', (b.conf*100).toFixed(0) + ' %', b.conf > 0.5);
  set('rTrail',
    creature.trailCd > 0 ? 'perdue ' + creature.trailCd.toFixed(0) + 's'
    : creature.trail > 0.2 ? 'suit ' + creature.trail.toFixed(0) + 's' : '—',
    creature.trail > 0.2);
  set('rPress', (directeur.pression*100).toFixed(0) + ' %', directeur.pression > 0.7);

  let dj = 1e9;
  for(const j of jeunes) dj = Math.min(dj, j.proche);
  set('rJeunes', jeunes.length ? jeunes.length + ' · ' + dj.toFixed(0) + ' m' : 'aucun', dj < 14);

  set('rPath', (creature.path ? creature.path.length : 0) + ' nœuds · '
    + diag.expanded + ' exp.' + (diag.partiel ? ' · partiel' : ''), diag.partiel);
}
