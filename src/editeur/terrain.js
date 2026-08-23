/* ═══ ÉDITEUR / TERRAIN ═══
   L'onglet où l'on dessine le monde : des ZONES posées sur la planche, chacune
   disant quel biome y règne, à quelle altitude, et CE QU'ON A LE DROIT D'Y
   GÉNÉRER.

   ── POURQUOI UNE VUE DE DESSUS ET PAS DE LA 3D ─────────────────────────────
   Le monde fait 1 088 × 1 088 cellules, soit 1,6 km de côté, et son relief va
   de −131 à +137 m. Le poser à la main en 3D serait interminable. Ce qu'on
   veut décider, ce n'est pas la forme exacte du terrain — le générateur la
   fabrique très bien — c'est OÙ SE TROUVE QUOI. Une carte de dessus est
   l'outil juste pour ça, et le bouton « aperçu » montre ensuite le résultat
   réellement généré.

   ── LES DEUX CALQUES ───────────────────────────────────────────────────────
     LE PLAN      tes zones. C'est ce que tu dessines et ce qui est enregistré.
     L'APERÇU     le monde effectivement généré à partir du plan, en couleurs
                  de biome. C'est la vérification : on voit tout de suite si
                  une zone est trop petite pour contenir un village, ou si un
                  biome imposé n'a produit aucune salle.                     */

import {GW, GH, CELL, FLOOR, grid, biome, floorH, vide, idx} from '../monde/grille.js';
import {BIOMES} from '../monde/biomes.js';
import {plan, zoneNeuve, zoneEn, CONTENUS, enregistrerPlan} from '../monde/plan.js';

const cv = document.getElementById('carte2d');
const dc = cv ? cv.getContext('2d') : null;

export const etat = {
  outil: 'rect',        // 'rect' | 'ellipse' | 'choisir' | 'effacer'
  biome: -1,            // le biome à poser (−1 = auto)
  selection: null,      // la zone sélectionnée
  apercu: null,         // ImageData du monde généré, ou null
  zoom: 1,
  ox: 0, oz: 0,         // décalage d'affichage, en cellules
};

let surChangement = null;
export const brancher = fn => { surChangement = fn; };
const changed = () => { enregistrerPlan(); if(surChangement) surChangement(); };

/* ─────────────── conversions ─────────────── */

const taille = () => Math.min(cv.width, cv.height);
const ech = () => taille() / (GW / etat.zoom);

export const versEcran = (cx, cz) => [ (cx - etat.ox) * ech(), (cz - etat.oz) * ech() ];
export const versCellule = (px, pz) => [
  Math.floor(px / ech() + etat.ox), Math.floor(pz / ech() + etat.oz),
];

/* ─────────────── aperçu du monde généré ─────────────── */

/**
 * Photographie le monde ACTUELLEMENT en mémoire, en couleurs de biome. À
 * appeler après avoir lancé une génération.
 */
export function capturerApercu(){
  if(!dc) return;
  const R = 512;                        // on sous-échantillonne : 1088 → 512
  const img = dc.createImageData(R, R);
  const d = img.data;
  for(let py=0; py<R; py++) for(let px=0; px<R; px++){
    const x = Math.floor(px * GW / R), z = Math.floor(py * GH / R);
    const i = idx(x, z);
    const o = (py*R + px) * 4;
    if(grid[i] !== FLOOR){ d[o]=8; d[o+1]=8; d[o+2]=10; d[o+3]=255; continue; }
    if(vide[i]){ d[o]=0; d[o+1]=0; d[o+2]=0; d[o+3]=255; continue; }
    const B = BIOMES[biome[i]];
    // la teinte du biome, éclaircie par l'altitude : on lit le relief
    const t = 0.55 + 0.45 * ((floorH[i] + 131) / 270);
    d[o]   = Math.min(255, B.floor[0] * 620 * t);
    d[o+1] = Math.min(255, B.floor[1] * 620 * t);
    d[o+2] = Math.min(255, B.floor[2] * 620 * t);
    d[o+3] = 255;
  }
  // ImageData ne se met pas à l'échelle : on passe par un canvas intermédiaire
  const tmp = document.createElement('canvas');
  tmp.width = R; tmp.height = R;
  tmp.getContext('2d').putImageData(img, 0, 0);
  etat.apercu = tmp;
  dessiner();
}

export function effacerApercu(){ etat.apercu = null; dessiner(); }

/* ─────────────── dessin ─────────────── */

export function dessiner(){
  if(!dc) return;
  const S = taille();
  cv.width = cv.clientWidth; cv.height = cv.clientHeight;
  dc.fillStyle = '#07080a';
  dc.fillRect(0, 0, cv.width, cv.height);

  const e = ech();

  // l'aperçu du monde généré, en fond
  if(etat.apercu){
    dc.globalAlpha = 0.85;
    dc.imageSmoothingEnabled = false;
    dc.drawImage(etat.apercu, -etat.ox*e, -etat.oz*e, GW*e, GH*e);
    dc.globalAlpha = 1;
  } else {
    dc.strokeStyle = '#16181c';
    dc.strokeRect(-etat.ox*e, -etat.oz*e, GW*e, GH*e);
  }

  // la grille de repère, tous les 128 cellules (192 m)
  dc.strokeStyle = 'rgba(80,86,92,.22)'; dc.lineWidth = 1;
  for(let c=0; c<=GW; c+=128){
    const [x] = versEcran(c, 0), [, y] = versEcran(0, c);
    dc.beginPath(); dc.moveTo(x, 0); dc.lineTo(x, cv.height); dc.stroke();
    dc.beginPath(); dc.moveTo(0, y); dc.lineTo(cv.width, y); dc.stroke();
  }

  // les zones
  for(const z of plan.zones){
    const [x0, z0] = versEcran(z.x, z.z);
    const w = z.w * e, h = z.h * e;
    const col = z.biome >= 0 ? couleurBiome(z.biome) : '#8fa88c';
    const sel = z === etat.selection;

    dc.save();
    dc.beginPath();
    if(z.forme === 'ellipse') dc.ellipse(x0+w/2, z0+h/2, w/2, h/2, 0, 0, 6.283);
    else dc.rect(x0, z0, w, h);
    dc.fillStyle = col + (sel ? '46' : '28');
    dc.fill();
    dc.strokeStyle = col;
    dc.lineWidth = sel ? 2.5 : 1.2;
    if(z.biome < 0) dc.setLineDash([5,4]);      // auto : trait discontinu
    dc.stroke();
    dc.restore();

    // ce qui est interdit ici, en petit
    const off = CONTENUS.filter(c => z.contenu[c] === false);
    if(w > 60 && h > 26){
      dc.fillStyle = col;
      dc.font = '10px "SF Mono",Consolas,monospace';
      dc.fillText(z.nom, x0 + 5, z0 + 13);
      if(off.length){
        dc.fillStyle = 'rgba(200,90,70,.9)';
        dc.font = '9px "SF Mono",Consolas,monospace';
        dc.fillText('sans ' + off.join(' '), x0 + 5, z0 + 25);
      }
    }
  }

  // le tracé en cours
  if(trace){
    const [x0, z0] = versEcran(Math.min(trace.x0, trace.x1), Math.min(trace.z0, trace.z1));
    const w = Math.abs(trace.x1 - trace.x0) * e, h = Math.abs(trace.z1 - trace.z0) * e;
    dc.strokeStyle = '#cfc7b4'; dc.lineWidth = 1.5; dc.setLineDash([4,3]);
    dc.beginPath();
    if(etat.outil === 'ellipse') dc.ellipse(x0+w/2, z0+h/2, w/2, h/2, 0, 0, 6.283);
    else dc.rect(x0, z0, w, h);
    dc.stroke(); dc.setLineDash([]);
  }
}

export function couleurBiome(i){
  return BIOMES[i] ? BIOMES[i].code : '#8fa88c';
}

/* ─────────────── souris ─────────────── */

let trace = null;

export function brancherSouris(){
  if(!cv) return;

  cv.addEventListener('mousedown', ev => {
    const r = cv.getBoundingClientRect();
    const [cx, cz] = versCellule(ev.clientX - r.left, ev.clientY - r.top);

    if(ev.button === 1 || ev.shiftKey){          // molette ou MAJ : déplacer la vue
      pan = {x: ev.clientX, y: ev.clientY, ox: etat.ox, oz: etat.oz};
      return;
    }
    if(etat.outil === 'choisir' || etat.outil === 'effacer'){
      const z = zoneEn(cx, cz);
      if(etat.outil === 'effacer' && z){
        plan.zones.splice(plan.zones.indexOf(z), 1);
        if(etat.selection === z) etat.selection = null;
        changed();
      } else {
        etat.selection = z;
        if(surChangement) surChangement();
      }
      dessiner();
      return;
    }
    trace = {x0:cx, z0:cz, x1:cx, z1:cz};
  });

  addEventListener('mousemove', ev => {
    if(pan){
      const e = ech();
      etat.ox = pan.ox - (ev.clientX - pan.x) / e;
      etat.oz = pan.oz - (ev.clientY - pan.y) / e;
      dessiner();
      return;
    }
    if(!trace) return;
    const r = cv.getBoundingClientRect();
    const [cx, cz] = versCellule(ev.clientX - r.left, ev.clientY - r.top);
    trace.x1 = cx; trace.z1 = cz;
    dessiner();
  });

  addEventListener('mouseup', () => {
    pan = null;
    if(!trace) return;
    const x = Math.max(0, Math.min(trace.x0, trace.x1));
    const z = Math.max(0, Math.min(trace.z0, trace.z1));
    const w = Math.abs(trace.x1 - trace.x0), h = Math.abs(trace.z1 - trace.z0);
    trace = null;
    if(w < 3 || h < 3){ dessiner(); return; }    // clic sec : on ne crée rien

    const zn = zoneNeuve(x, z, Math.min(w, GW-x), Math.min(h, GH-z));
    zn.forme = etat.outil === 'ellipse' ? 'ellipse' : 'rect';
    zn.biome = etat.biome;
    zn.nom = etat.biome >= 0 ? BIOMES[etat.biome].n.toLowerCase() : 'auto';
    plan.zones.push(zn);
    etat.selection = zn;
    changed();
    dessiner();
  });

  cv.addEventListener('wheel', ev => {
    const avant = ech();
    etat.zoom = Math.max(1, Math.min(8, etat.zoom * (ev.deltaY < 0 ? 1.15 : 1/1.15)));
    // on zoome vers le curseur, pas vers le coin
    const r = cv.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const apres = ech();
    etat.ox += mx/avant - mx/apres;
    etat.oz += my/avant - my/apres;
    dessiner();
    ev.preventDefault();
  }, {passive:false});

  cv.addEventListener('contextmenu', e => e.preventDefault());
}

let pan = null;
