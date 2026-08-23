/* ═══ MONDE / PLAN ═══
   Le PLAN est la description que l'éditeur produit et que le générateur suit.
   C'est la couche qui manquait : jusqu'ici le monde était entièrement décidé
   par la stratigraphie (le biome déduit de l'altitude, et rien d'autre). On
   pouvait régler des nombres, pas dire « ICI, c'est une glacière ».

   ── LE PRINCIPE ────────────────────────────────────────────────────────────
   Un plan est une liste de ZONES posées sur la planche. Chaque zone dit, pour
   la portion de monde qu'elle couvre :

     · quel BIOME y règne — ou « auto », c'est-à-dire : laisse la stratigraphie
       décider, comme avant ;
     · quelle ALTITUDE imposer — ou « auto » ;
     · CE QU'ON A LE DROIT D'Y GÉNÉRER : villages, cachettes, gouffres, ponts,
       cartes, décor. C'est ça, « quels endroits peuvent être générés
       aléatoirement ou en fonction du biome spécifié ».
     · à quelle DENSITÉ.

   Hors de toute zone, le monde reste exactement ce qu'il était : procédural,
   stratifié par altitude. Un plan vide ne change donc STRICTEMENT rien — c'est
   la garantie qu'ajouter l'éditeur ne casse pas le jeu.

   ── L'ORDRE COMPTE ─────────────────────────────────────────────────────────
   La DERNIÈRE zone qui contient un point l'emporte. On peut donc poser une
   grande zone « glacière » puis y découper une petite zone « village garanti »
   par-dessus, comme des calques.

   ── OÙ IL EST LU ───────────────────────────────────────────────────────────
     monde/generation.js   biome et altitude de chaque cellule creusée
     monde/relief.js       droit de creuser un gouffre
     monde/villages.js     droit de poser un village
     monde/cachettes.js    droit de creuser un trou
     monde/props.js        densité du décor
     carte/placement.js    droit de poser une carte

   Il est produit par outils/editeur.html et rangé dans le navigateur, ou
   importé depuis un fichier .json.                                          */

import {GW, GH} from './grille.js';
import {biomePourAltitude} from './biomes.js';

/** Ce qu'une zone peut autoriser ou interdire. */
export const CONTENUS = ['decor', 'lumieres', 'gouffres', 'ponts', 'cachettes',
                         'villages', 'cartes', 'creatures'];

/** Une zone neuve, avec des valeurs qui ne changent rien. */
export function zoneNeuve(x, z, w, h){
  return {
    nom: 'zone',
    forme: 'rect',          // 'rect' | 'ellipse'
    x, z, w, h,             // en CELLULES
    biome: -1,              // −1 = auto (stratigraphie par altitude)
    altitude: null,         // null = auto ; sinon une cote en mètres
    pente: 0,               // mètres par cellule, si altitude imposée
    densite: 1,             // multiplicateur du décor et des lumières
    contenu: Object.fromEntries(CONTENUS.map(c => [c, true])),
    couleur: '#8fa88c',     // pour l'éditeur seulement
  };
}

/** Le plan courant. Vide par défaut : le monde reste 100 % procédural. */
export const plan = {
  version: 1,
  nom: 'sans titre',
  zones: [],
};

export const planActif = () => plan.zones.length > 0;

/* ─────────────── interrogation ─────────────── */

function dansZone(z, x, cz){
  if(x < z.x || cz < z.z || x >= z.x + z.w || cz >= z.z + z.h) return false;
  if(z.forme !== 'ellipse') return true;
  const u = (x - z.x - z.w/2) / (z.w/2 || 1);
  const v = (cz - z.z - z.h/2) / (z.h/2 || 1);
  return u*u + v*v <= 1;
}

/** La zone qui gouverne cette cellule, ou null. La dernière posée l'emporte. */
export function zoneEn(x, z){
  for(let i = plan.zones.length - 1; i >= 0; i--)
    if(dansZone(plan.zones[i], x, z)) return plan.zones[i];
  return null;
}

/**
 * Le biome d'une cellule. C'est LE point d'entrée : monde/generation.js
 * l'appelle partout où il appelait biomePourAltitude().
 */
export function biomeDeCellule(altitude, x, z){
  const zn = zoneEn(x, z);
  if(zn && zn.biome >= 0) return zn.biome;
  return biomePourAltitude(altitude, x, z);
}

/**
 * L'altitude à creuser. Renvoie `defaut` si aucune zone n'impose rien.
 * Une pente permet de dessiner une rampe franche entre deux paliers.
 */
export function altitudeDeCellule(defaut, x, z){
  const zn = zoneEn(x, z);
  if(!zn || zn.altitude === null || zn.altitude === undefined) return defaut;
  if(!zn.pente) return zn.altitude;
  // la pente court le long du plus grand côté de la zone
  const t = zn.w >= zn.h ? (x - zn.x) : (z - zn.z);
  return zn.altitude + t * zn.pente;
}

/**
 * A-t-on le droit de générer ça ici ? C'est la réponse à « quels endroits
 * peuvent être générés aléatoirement ou en fonction du biome spécifié ».
 */
export function autorise(quoi, x, z){
  const zn = zoneEn(x, z);
  if(!zn) return true;                     // hors zone : le monde fait ce qu'il veut
  return zn.contenu[quoi] !== false;
}

/** Multiplicateur de densité de décor à cet endroit. */
export function densiteEn(x, z){
  const zn = zoneEn(x, z);
  return zn ? (zn.densite ?? 1) : 1;
}

/* ─────────────── chargement et enregistrement ─────────────── */

const CLE = 'scolopandre.plan.v1';

export function chargerPlan(){
  try{
    const brut = localStorage.getItem(CLE);
    if(!brut) return false;
    appliquer(JSON.parse(brut));
    return plan.zones.length > 0;
  }catch(e){ return false; }
}

export function enregistrerPlan(){
  try{ localStorage.setItem(CLE, JSON.stringify(plan)); return true; }
  catch(e){ return false; }
}

export function effacerPlan(){
  plan.zones.length = 0;
  plan.nom = 'sans titre';
  try{ localStorage.removeItem(CLE); }catch(e){}
}

/** Remplace le plan courant par un objet lu depuis un JSON. */
export function appliquer(obj){
  if(!obj || !Array.isArray(obj.zones)) return false;
  plan.version = obj.version || 1;
  plan.nom = obj.nom || 'sans titre';
  plan.zones.length = 0;
  for(const z of obj.zones){
    const n = zoneNeuve(z.x|0, z.z|0, Math.max(1, z.w|0), Math.max(1, z.h|0));
    Object.assign(n, z);
    // on rebâtit `contenu` pour tolérer un fichier écrit par une version plus
    // ancienne, à qui il manquerait des clés
    n.contenu = Object.fromEntries(
      CONTENUS.map(c => [c, z.contenu ? z.contenu[c] !== false : true]));
    n.x = Math.max(0, Math.min(GW-1, n.x));
    n.z = Math.max(0, Math.min(GH-1, n.z));
    n.w = Math.max(1, Math.min(GW - n.x, n.w));
    n.h = Math.max(1, Math.min(GH - n.z, n.h));
    plan.zones.push(n);
  }
  return true;
}

/** Le plan, prêt à être écrit dans un fichier. */
export const exporter = () => JSON.stringify(plan, null, 2);
