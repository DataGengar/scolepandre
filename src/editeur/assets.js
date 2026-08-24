/* ═══ ÉDITEUR / ASSETS ═══
   La forge d'éléments de décor.

   ── LE PRINCIPE : NE RIEN RÉIMPLÉMENTER ────────────────────────────────────
   L'aperçu n'a pas sa propre géométrie. Il appelle `cuireParts()` de
   monde/maillage.js, c'est-à-dire EXACTEMENT le code qui cuit le décor du jeu.
   Un éditeur qui redessine à sa façon finit toujours par diverger du moteur,
   et on ne s'en aperçoit qu'une fois en partie.

   ── CE QU'ON MANIPULE ──────────────────────────────────────────────────────
   Une BIBLIOTHÈQUE d'éléments. Chaque élément a :

     · un nom — celui du `case` dans props.js ;
     · des PARTS de base, les primitives posées à la main ;
     · une PILE DE MODIFICATEURS qui les démultiplie (voir modificateurs.js) ;
     · un biome de référence, pour le juger dans sa lumière.

   Les parts finales, celles qu'on voit et qu'on exporte, sont le résultat de
   la pile appliquée à la base. La base reste toujours modifiable : on change
   une dimension, les quarante copies suivent.

   ── TROIS FAÇONS DE COMMENCER ──────────────────────────────────────────────
   1. Empiler des primitives.
   2. CHARGER UN ÉLÉMENT DU JEU — pilier, maison, carcasse… — pour voir de quoi
      il est fait et le retoucher. C'est le mode le plus utile : la plupart du
      temps on ne veut pas inventer, on veut corriger.
   3. Repartir d'un élément de la bibliothèque du projet.

   ── OÙ ÇA SORT ─────────────────────────────────────────────────────────────
   Un extrait de code prêt à coller, et — si le lanceur tourne — directement
   dans `src/monde/props.js`, par découpe du `switch`. Le jeu ne charge aucun
   asset à l'exécution : tout y est procédural, et c'est ce qui lui permet de
   tenir en un seul fichier.                                                 */

import {cuireParts} from '../monde/maillage.js';
import {trianglesPart} from '../monde/formes.js';
import {libererMesh} from '../noyau/gl.js';
import {addProp, props as propsJeu, lights as lightsJeu} from '../monde/props.js';
import {grid, floorH, ceilH, biome, blocked, sky, idx, FLOOR, c2w} from '../monde/grille.js';
import {semer} from '../noyau/rng.js';

import {PRIMITIVES, ORDRE, formeDe, creer, convertir, centreDe, rayonDe}
  from './primitives.js';
import {MODIFS, modifNeuf, evaluer, bornesDe, transformer, refleter}
  from './modificateurs.js';

/** Les éléments que le jeu sait déjà fabriquer, pour le menu « charger ». */
export const TYPES = [
  'pilier','arche','gravats','stalag','glace','poutre','conduit','tronc',
  'monolithe','tourFenetres','meneau','cristal','souche','os','cotes','crane',
  'maison','hutte','carcasse','lampadaire','pylone','champignon',
];

/**
 * Budget de triangles par élément.
 *
 * Ce n'est pas une limite dure, c'est un seuil d'alerte. Le décor pose
 * plusieurs milliers d'éléments dans un pavé ; à 400 triangles pièce on tient,
 * à 4 000 on perd la moitié des images par seconde et on ne comprend pas
 * pourquoi trois semaines plus tard.
 */
export const BUDGET = {confortable: 200, tendu: 600};

/* ═══════════════ ÉTAT ═══════════════ */

const elementNeuf = (nom = 'element') => ({
  nom,
  parts: [],
  pile: [],
  biome: 0,
});

export const biblio = {
  elements: [elementNeuf()],
  courant: 0,
};

/** L'élément en cours d'édition. */
export const el = () => biblio.elements[biblio.courant];

/** Les indices des parts de base sélectionnées. */
export const selection = new Set();

export const reglages = {
  magnetisme: 0.05,        // 0 = libre
  montrerBase: false,      // n'afficher que la base, sans les modificateurs
};

/* ═══════════════ CUISSON ═══════════════ */

let maillage = null, sale = true;
let cache = {parts: [], triangles: 0, tronque: false, etapes: []};

export const salir = () => { sale = true; };

/** Le résultat de la pile — recalculé seulement quand quelque chose a bougé. */
export function resultat(){
  if(sale){
    const e = el();
    cache = reglages.montrerBase
      ? {parts: e.parts.map(q => JSON.parse(JSON.stringify(q))),
         triangles: e.parts.reduce((s,q) => s + trianglesPart(q), 0),
         tronque: false, etapes: []}
      : evaluer(e.parts, e.pile);
    if(maillage){ libererMesh(maillage); maillage = null; }
    sale = false;
  }
  return cache;
}

/** Le maillage GL à jour. */
export function maillageAsset(){
  const r = resultat();
  if(!maillage && r.parts.length) maillage = cuireParts(r.parts);
  return maillage;
}

export const triangles = () => resultat().triangles;
export const partsFinales = () => resultat().parts;

/* ═══════════════ ANNULATION ═══════════════
   Une pile d'instantanés JSON de l'élément courant. Grossier — on recopie tout
   à chaque geste — mais un élément fait quelques kilo-octets et le coût est
   invisible, alors qu'un système de deltas serait trois fois plus de code
   pour le même service. */

const passe = [], futur = [];
const MAX_ANNULE = 80;

const instantane = () => JSON.stringify(el());

export function memoriser(){
  passe.push(instantane());
  if(passe.length > MAX_ANNULE) passe.shift();
  futur.length = 0;
}

function restaurer(txt){
  biblio.elements[biblio.courant] = JSON.parse(txt);
  selection.clear();
  salir();
}

export function annuler(){
  if(!passe.length) return false;
  futur.push(instantane());
  restaurer(passe.pop());
  return true;
}

export function retablir(){
  if(!futur.length) return false;
  passe.push(instantane());
  restaurer(futur.pop());
  return true;
}

export const peutAnnuler  = () => passe.length > 0;
export const peutRetablir = () => futur.length > 0;

/* ═══════════════ BIBLIOTHÈQUE ═══════════════ */

export function ajouterElement(nom){
  biblio.elements.push(elementNeuf(nom || ('element' + biblio.elements.length)));
  biblio.courant = biblio.elements.length - 1;
  passe.length = 0; futur.length = 0;
  selection.clear(); salir();
}

export function choisirElement(i){
  if(i < 0 || i >= biblio.elements.length) return;
  biblio.courant = i;
  passe.length = 0; futur.length = 0;
  selection.clear(); salir();
}

export function supprimerElement(i){
  if(biblio.elements.length <= 1) return false;
  biblio.elements.splice(i, 1);
  biblio.courant = Math.min(biblio.courant, biblio.elements.length - 1);
  passe.length = 0; futur.length = 0;
  selection.clear(); salir();
  return true;
}

export function dupliquerElement(){
  const c = JSON.parse(JSON.stringify(el()));
  c.nom = c.nom + '2';
  biblio.elements.splice(biblio.courant + 1, 0, c);
  biblio.courant++;
  passe.length = 0; futur.length = 0;
  selection.clear(); salir();
}

/* ═══════════════ PARTS ═══════════════ */

const accrocher = v => {
  const m = reglages.magnetisme;
  return m > 0 ? Math.round(v / m) * m : v;
};

export function ajouter(forme){
  memoriser();
  const q = creer(forme);
  el().parts.push(q);
  selection.clear();
  selection.add(el().parts.length - 1);
  salir();
  return q;
}

export function dupliquerParts(){
  const e = el();
  if(!selection.size) return;
  memoriser();
  const neufs = [];
  for(const i of [...selection].sort((a,b) => a-b)){
    const c = JSON.parse(JSON.stringify(e.parts[i]));
    transformer(c, {t: [0.25, 0, 0.25]});
    e.parts.push(c);
    neufs.push(e.parts.length - 1);
  }
  selection.clear();
  for(const i of neufs) selection.add(i);
  salir();
}

export function supprimerParts(){
  if(!selection.size) return;
  memoriser();
  const e = el();
  for(const i of [...selection].sort((a,b) => b-a)) e.parts.splice(i, 1);
  selection.clear();
  salir();
}

export function vider(){
  memoriser();
  el().parts.length = 0;
  selection.clear();
  salir();
}

/** Change la forme des parts sélectionnées en gardant position et taille. */
export function convertirSelection(forme){
  if(!selection.size) return;
  memoriser();
  const e = el();
  for(const i of selection) e.parts[i] = convertir(e.parts[i], forme);
  salir();
}

/**
 * Déplace / tourne / redimensionne la sélection en bloc.
 *
 * Le pivot est le centre de la sélection, pas l'origine du monde : tourner
 * trois blocs les fait tourner ensemble sur eux-mêmes, ce qui est ce qu'on
 * attend. Avec l'origine comme pivot ils partiraient en orbite.
 */
export function transformerSelection({t, ry, echelle}){
  if(!selection.size) return;
  const e = el();
  const parts = [...selection].map(i => e.parts[i]);
  const b = bornesDe(parts);
  const pivot = [b.centre[0], b.min[1], b.centre[2]];   // au sol, pas au milieu
  for(const q of parts) transformer(q, {t, ry, echelle, pivot});
  if(t && reglages.magnetisme > 0) for(const q of parts) aligner(q);
  salir();
}

/** Ramène les coordonnées d'une part sur la grille magnétique. */
function aligner(q){
  if(q.tube){
    for(const k of [0, 2]) for(let j = 0; j < 3; j++)
      q.tube[k][j] = accrocher(q.tube[k][j]);
    return;
  }
  q.x = accrocher(q.x); q.y = accrocher(q.y); q.z = accrocher(q.z);
}

/** Pose la sélection sur le sol (y minimum à 0). */
export function poserAuSol(){
  const e = el();
  const parts = selection.size ? [...selection].map(i => e.parts[i]) : e.parts;
  if(!parts.length) return;
  memoriser();
  const b = bornesDe(parts);
  for(const q of parts) transformer(q, {t: [0, -b.min[1], 0]});
  salir();
}

/** Recentre l'élément entier sur l'origine, au sol. C'est ce que props.js
    attend : les coordonnées y sont relatives à la cellule et à sa hauteur. */
export function recentrer(){
  const e = el();
  if(!e.parts.length) return;
  memoriser();
  const b = bornesDe(evaluer(e.parts, e.pile).parts);
  for(const q of e.parts)
    transformer(q, {t: [-b.centre[0], -b.min[1], -b.centre[2]]});
  salir();
}

/* ═══════════════ MODIFICATEURS ═══════════════ */

export function ajouterModif(type){
  memoriser();
  el().pile.push(modifNeuf(type));
  salir();
}

export function supprimerModif(i){
  memoriser();
  el().pile.splice(i, 1);
  salir();
}

export function deplacerModif(i, delta){
  const p = el().pile;
  const j = i + delta;
  if(j < 0 || j >= p.length) return;
  memoriser();
  [p[i], p[j]] = [p[j], p[i]];
  salir();
}

/**
 * Fige la pile : le résultat devient la nouvelle base, la pile est vidée.
 *
 * Le moment où l'on veut retoucher trois copies sur quarante à la main. C'est
 * irréversible au sens de la recette — d'où l'instantané juste avant, qui
 * permet quand même de revenir en arrière d'un Ctrl+Z.
 */
export function figerPile(){
  const r = evaluer(el().parts, el().pile);
  memoriser();
  el().parts = r.parts;
  el().pile = [];
  selection.clear();
  salir();
  return r.parts.length;
}

/* ═══════════════ SÉLECTION PAR LE CLIC ═══════════════ */

/**
 * Quelle part de base un rayon touche-t-il ?
 *
 * Test rayon/sphère englobante, pas rayon/triangle. C'est volontairement
 * approximatif : viser une part dans un tas s'apprend en deux clics, alors
 * qu'un test exact demanderait de garder tous les triangles en mémoire et de
 * les retransformer à chaque image. Quand deux sphères sont touchées, on
 * garde la plus proche de l'œil.
 *
 * @param o origine du rayon, d direction normalisée
 * @return l'indice de la part, ou -1
 */
export function viser(o, d){
  const parts = el().parts;
  let meilleur = -1, meilleurT = Infinity;
  for(let i = 0; i < parts.length; i++){
    const c = centreDe(parts[i]);
    const r = rayonDe(parts[i]) * 1.05;
    const ox = o[0]-c[0], oy = o[1]-c[1], oz = o[2]-c[2];
    const b = ox*d[0] + oy*d[1] + oz*d[2];
    const cc = ox*ox + oy*oy + oz*oz - r*r;
    const disc = b*b - cc;
    if(disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    const tt = (t < 0) ? (-b + Math.sqrt(disc)) : t;
    if(tt < 0 || tt >= meilleurT) continue;
    meilleurT = tt; meilleur = i;
  }
  return meilleur;
}

export function choisir(i, ajouter){
  if(i < 0){ if(!ajouter) selection.clear(); return; }
  if(!ajouter) selection.clear();
  if(selection.has(i) && ajouter) selection.delete(i);
  else selection.add(i);
}

export function toutSelectionner(){
  selection.clear();
  for(let i = 0; i < el().parts.length; i++) selection.add(i);
}

/* ═══════════════ CHARGER UN ÉLÉMENT DU JEU ═══════════════ */

/**
 * Fabrique un élément du jeu dans un bac à sable et récupère ses parts.
 *
 * `addProp()` écrit dans les tableaux globaux du monde et lit la grille
 * (altitude, plafond, biome). On prépare donc une cellule d'essai, on appelle
 * la VRAIE fonction, on récupère ce qu'elle a produit, et on remet tout en
 * place. C'est laid mais c'est honnête : on regarde la géométrie que le jeu
 * produit réellement, pas une imitation qui divergera.
 */
export function chargerDuJeu(type, biomeIndex, graine){
  const avantP = propsJeu.length, avantL = lightsJeu.length;
  const cx = 4, cz = 4, i = idx(cx, cz);

  const sauve = {g:grid[i], f:floorH[i], c:ceilH[i], b:biome[i],
                 bl:blocked[i], s:sky[i]};
  grid[i] = FLOOR; floorH[i] = 0; ceilH[i] = 6; biome[i] = biomeIndex;
  blocked[i] = 0; sky[i] = 0;

  semer(graine >>> 0);
  let panne = null;
  try{ addProp(type, cx, cz, i); }catch(e){ panne = e; }

  const neufs = propsJeu.slice(avantP);
  propsJeu.length = avantP;
  lightsJeu.length = avantL;
  grid[i] = sauve.g; floorH[i] = sauve.f; ceilH[i] = sauve.c;
  biome[i] = sauve.b; blocked[i] = sauve.bl; sky[i] = sauve.s;

  // on recentre sur l'origine : il a été bâti autour de la cellule d'essai
  const dx = c2w(cx), dz = c2w(cz);
  const parts = [];
  for(const pr of neufs) for(const q of pr.parts){
    const c = JSON.parse(JSON.stringify(q));
    if(c.tube){
      c.tube[0][0] -= dx; c.tube[0][2] -= dz;
      c.tube[2][0] -= dx; c.tube[2][2] -= dz;
    } else { c.x -= dx; c.z -= dz; }
    parts.push(c);
  }

  memoriser();
  const e = el();
  e.parts = parts;
  e.pile = [];                 // le jeu a déjà déplié sa géométrie
  e.nom = type;
  e.biome = biomeIndex;
  selection.clear();
  salir();
  if(panne) throw panne;
  return parts.length;
}

/* ═══════════════ MESURES ═══════════════ */

export function bornes(){ return bornesDe(partsFinales()); }

/** De quoi remplir la barre d'état d'un coup d'œil. */
export function stats(){
  const r = resultat();
  const b = bornesDe(r.parts);
  const t = r.triangles;
  return {
    base: el().parts.length,
    parts: r.parts.length,
    triangles: t,
    tronque: r.tronque,
    etapes: r.etapes,
    taille: b.taille,
    verdict: t <= BUDGET.confortable ? 'confortable'
           : t <= BUDGET.tendu       ? 'tendu' : 'lourd',
  };
}

/* ═══════════════ EXPORT ═══════════════ */

const f = v => {
  const n = Number(v);
  if(Math.abs(n) < 1e-4) return '0';
  return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};
const col = c => `[${c.map(v => Number(v).toFixed(3)).join(',')}]`;

/** Une part, en source JavaScript, coordonnées relatives à la cellule. */
function partVersCode(q){
  const P = (x, y, z) => `[wx+${f(x)},h+${f(y)},wz+${f(z)}]`;
  const opt = (q.emis ? ', emis:1' : '');

  if(q.tube){
    const [p0, r0, p1, r1, n] = q.tube;
    return `{tube:[${P(p0[0],p0[1],p0[2])}, ${f(r0)}, `
         + `${P(p1[0],p1[1],p1[2])}, ${f(r1)}, ${n||6}], c:${col(q.c)}${opt}}`;
  }
  const pos = `x:wx+${f(q.x)}, y:h+${f(q.y)}, z:wz+${f(q.z)}`;
  if(q.roche)
    return `{roche:[${f(q.roche[0])},${q.roche[1]|0},${q.roche[2]|0}], `
         + `${pos}, c:${col(q.c)}${opt}}`;

  const tour = (q.r ? `, r:${f(q.r)}` : '') + (q.ry ? `, ry:${f(q.ry)}` : '');
  if(q.plaque)
    return `{plaque:1, ${pos}, sx:${f(q.sx)}, sy:${f(q.sy)}, `
         + `c:${col(q.c)}${tour}${opt}}`;
  if(q.coin)
    return `{coin:${q.coin < 0 ? -1 : 1}, ${pos}, sx:${f(q.sx)}, sy:${f(q.sy)}, `
         + `sz:${f(q.sz)}, c:${col(q.c)}${tour}${opt}}`;
  return `{${pos}, sx:${f(q.sx)}, sy:${f(q.sy)}, sz:${f(q.sz)}, `
       + `c:${col(q.c)}${tour}${opt}}`;
}

/**
 * Le bloc `case` complet, prêt à poser dans le `switch` de props.js.
 *
 * `solide` dit si l'élément bloque le passage. On le devine à sa taille plutôt
 * que de le demander : un objet large d'un mètre au sol arrête le joueur, un
 * caillou non. La valeur reste modifiable à la main dans le code produit —
 * c'est une ligne, et un défaut raisonnable vaut mieux qu'une question de plus.
 */
export function versCode(){
  const e = el();
  const r = resultat();
  const b = bornesDe(r.parts);
  const solide = Math.max(b.taille[0], b.taille[2]) > 0.9 && b.taille[1] > 1.2;

  const lignes = r.parts.map(q => `      parts.push(${partVersCode(q)});`);
  const entete = [
    `    case '${e.nom}': {`,
    `      /* ${r.parts.length} primitives · ${r.triangles} triangles`
      + ` · ${b.taille.map(v => v.toFixed(2)).join(' × ')} m`,
    `         composé dans la forge — src/editeur/ */`,
  ];
  return entete.concat(lignes,
    [`      solid = ${solide}; break; }`, '']).join('\n');
}

/** Le projet, pour l'enregistrement. Les modificateurs sont conservés :
    c'est la recette, et c'est elle qu'on voudra reprendre. */
export function versObjet(){
  return {elements: JSON.parse(JSON.stringify(biblio.elements)),
          courant: biblio.courant};
}

export function depuisObjet(o){
  if(!o) return;
  // Tolérant à l'ancien format, qui n'avait qu'un élément et pas de pile.
  if(Array.isArray(o.parts)){
    biblio.elements = [{nom: o.nom || 'element', parts: o.parts,
                        pile: [], biome: 0}];
    biblio.courant = 0;
  } else if(Array.isArray(o.elements) && o.elements.length){
    biblio.elements = o.elements.map(e => ({
      nom: e.nom || 'element',
      parts: Array.isArray(e.parts) ? e.parts : [],
      pile: Array.isArray(e.pile) ? e.pile.filter(m => m && MODIFS[m.type]) : [],
      biome: e.biome | 0,
    }));
    biblio.courant = Math.min(o.courant | 0, biblio.elements.length - 1);
  }
  passe.length = 0; futur.length = 0;
  selection.clear(); salir();
}

/* Réexports pour que la forge n'ait qu'un module à importer. */
export {PRIMITIVES, ORDRE, formeDe, MODIFS, bornesDe, refleter};

/* ═══════════════ SURBRILLANCE ═══════════════ */

/**
 * Cuit une copie bleue et légèrement enflée des parts données.
 *
 * Sert à montrer la sélection dans la vue. On enfle de 3,5 % plutôt que de
 * jouer sur la profondeur : le fantôme enveloppe la vraie part et se voit
 * sous tous les angles, sans avoir à toucher au test de profondeur ni à
 * dessiner en deux passes.
 */
export function cuireFantomes(parts){
  const bleu = [0.16, 0.42, 0.95];
  const copies = parts.map(q => {
    const c = JSON.parse(JSON.stringify(q));
    c.c = bleu;
    c.emis = 1;
    const centre = centreDe(c);
    return transformer(c, {echelle: 1.035, pivot: centre});
  });
  return copies.length ? cuireParts(copies) : null;
}
