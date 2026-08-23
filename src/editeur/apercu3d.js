/* ═══ ÉDITEUR / APERÇU 3D ═══
   Un petit moteur de visualisation, bâti sur EXACTEMENT les mêmes shaders que
   le jeu (noyau/shaders.js). C'est le point important : ce que tu vois dans
   l'éditeur est ce que tu verras en jeu, éclairage compris. Un éditeur qui
   rend autrement que le moteur ment, et on découvre l'écart trop tard.

   Ce qu'il apporte par rapport au pipeline du jeu :
     · une caméra ORBITALE (le jeu n'a qu'une caméra subjective) ;
     · pas de brume, pas de vignette, pas de grain — on veut voir l'objet, pas
       l'ambiance ;
     · une grille de sol et des axes, pour juger les proportions.

   Il ne dépend PAS de rendu/pipeline.js : l'importer entraînerait tout le jeu,
   le monde, les créatures et la boucle. Ici on ne veut qu'un contexte, un
   programme et un maillage.                                                  */

import {gl, cv, prog, unis, mesh, libererMesh} from '../noyau/gl.js';
import {VS, FS, UNIS_MONDE, NLIGHT} from '../noyau/shaders.js';
import {M, clamp} from '../noyau/math.js';

const P = prog(VS, FS);
const U = unis(P, UNIS_MONDE);

const proj = M.mk(), vue = M.mk(), modele = M.mk();
const _a = M.mk(), _b = M.mk(), _c = M.mk();

/** La caméra orbitale. Pilotée à la souris par brancherSouris(). */
export const camera = {
  cible: [0, 0.6, 0],
  distance: 4.2,
  lacet: 0.7,
  tangage: 0.42,
  fov: 1.05,
};

export const options = {
  grille: true,
  axes: true,
  fond: [0.055, 0.058, 0.066],
  ambiante: 0.42,
  tourne: false,
  vitesseRotation: 0.35,
};

/* Trois lampes fixes : une clé chaude, une contre froide, une de remplissage.
   Éclairage de studio — on juge une forme, pas une ambiance de jeu. */
const lampes = [
  {p:[ 3.4, 4.2,  2.6], c:[1.5, 1.32, 1.05]},
  {p:[-3.8, 2.4, -2.2], c:[0.42, 0.60, 0.95]},
  {p:[ 0.4, 1.0, -4.4], c:[0.55, 0.50, 0.46]},
];
const lp = new Float32Array(NLIGHT*3), lc = new Float32Array(NLIGHT*3);
lampes.forEach((L, i) => {
  lp[i*3] = L.p[0]; lp[i*3+1] = L.p[1]; lp[i*3+2] = L.p[2];
  lc[i*3] = L.c[0]; lc[i*3+1] = L.c[1]; lc[i*3+2] = L.c[2];
});

/* ─────────────── la grille de sol ─────────────── */

let grilleM = null;

function creerGrille(){
  const P2 = [], N = [], C = [];
  const N2 = 12, PAS = 0.5, e = 0.006;
  const trait = (x0, z0, x1, z1, c) => {
    const dx = z1 - z0 !== 0 ? e : 0, dz = x1 - x0 !== 0 ? e : 0;
    const q = [[x0-dx, 0, z0-dz], [x1-dx, 0, z1-dz], [x1+dx, 0, z1+dz], [x0+dx, 0, z0+dz]];
    for(const t of [[0,1,2],[0,2,3]]) for(const k of t){
      P2.push(q[k][0], q[k][1], q[k][2]); N.push(0,1,0); C.push(c[0], c[1], c[2]);
    }
  };
  for(let i=-N2;i<=N2;i++){
    const fort = i === 0;
    const c = fort ? [0.30,0.34,0.30] : (i%4 === 0 ? [0.15,0.16,0.17] : [0.095,0.10,0.11]);
    trait(i*PAS, -N2*PAS, i*PAS, N2*PAS, c);
    trait(-N2*PAS, i*PAS, N2*PAS, i*PAS, c);
  }
  grilleM = mesh(P2, N, C);
}

/* ─────────────── souris ─────────────── */

/** Orbite au clic gauche, panoramique au clic droit, molette pour zoomer. */
export function brancherSouris(el){
  let bouton = -1, lx = 0, ly = 0;
  el.addEventListener('mousedown', e => { bouton = e.button; lx = e.clientX; ly = e.clientY;
                                          e.preventDefault(); });
  addEventListener('mouseup', () => { bouton = -1; });
  addEventListener('mousemove', e => {
    if(bouton < 0) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    if(bouton === 0){
      camera.lacet -= dx * 0.008;
      camera.tangage = clamp(camera.tangage + dy * 0.008, -1.35, 1.35);
    } else {
      // panoramique dans le plan de l'écran
      const cs = Math.cos(camera.lacet), sn = Math.sin(camera.lacet);
      const k = camera.distance * 0.0016;
      camera.cible[0] += (-dx * cs) * k;
      camera.cible[2] += ( dx * sn) * k;
      camera.cible[1] += dy * k;
    }
  });
  el.addEventListener('wheel', e => {
    camera.distance = clamp(camera.distance * (1 + Math.sign(e.deltaY) * 0.12), 0.35, 90);
    e.preventDefault();
  }, {passive:false});
  el.addEventListener('contextmenu', e => e.preventDefault());
}

/** Recentre la caméra sur un objet de rayon `r`. */
export function cadrer(centre, r){
  camera.cible = [centre[0], centre[1], centre[2]];
  camera.distance = Math.max(0.7, r * 2.9);
}

/* ─────────────── rendu ─────────────── */

export function redimensionner(){
  cv.width = cv.clientWidth || 800;
  cv.height = cv.clientHeight || 600;
}

/**
 * Dessine une liste de maillages.
 * @param maillages [{m, modele?}] — modele optionnel, identité par défaut
 * @param dt        pour la rotation automatique
 */
export function rendre(maillages, dt){
  if(options.tourne) camera.lacet += dt * options.vitesseRotation;
  if(options.grille && !grilleM) creerGrille();

  gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(options.fond[0], options.fond[1], options.fond[2], 1);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // la caméra orbitale, en coordonnées sphériques autour de la cible
  const ct = Math.cos(camera.tangage), st = Math.sin(camera.tangage);
  const oeil = [
    camera.cible[0] + Math.sin(camera.lacet) * ct * camera.distance,
    camera.cible[1] + st * camera.distance,
    camera.cible[2] + Math.cos(camera.lacet) * ct * camera.distance,
  ];
  const avant = [camera.cible[0]-oeil[0], camera.cible[1]-oeil[1], camera.cible[2]-oeil[2]];
  const L = Math.hypot(...avant) || 1;
  const fwd = avant.map(v => v/L);

  M.persp(proj, camera.fov, cv.width / Math.max(1, cv.height), 0.02, 400);
  M.trans(_a, -oeil[0], -oeil[1], -oeil[2]);
  M.rotY(_b, -camera.lacet);          M.mul(_c, _b, _a);
  M.rotX(_b, camera.tangage);         M.mul(vue, _b, _c);

  gl.useProgram(P);
  gl.uniformMatrix4fv(U.uProj, false, proj);
  gl.uniformMatrix4fv(U.uView, false, vue);
  gl.uniform3f(U.uCam, oeil[0], oeil[1], oeil[2]);
  gl.uniform3fv(U.uFwd, fwd);
  gl.uniform3fv(U.uFog, options.fond);
  gl.uniform1f(U.uFogD, 0.14);          // presque pas de brume : on veut voir
  gl.uniform1f(U.uAmb, options.ambiante);
  gl.uniform1f(U.uLampGain, 0.55);
  // faisceau très large : c'est une lumière de studio, pas une lampe de poche
  gl.uniform1f(U.uConeIn, 0.2);
  gl.uniform1f(U.uConeOut, -1.0);
  gl.uniform1f(U.uFaisceau, 0.9);
  gl.uniform1f(U.uHalo, 0.6);
  gl.uniform1f(U.uPortee, 0.012);
  gl.uniform1f(U.uAttLin, 0.06);
  gl.uniform1f(U.uAttQuad, 0.012);
  gl.uniform1f(U.uGainPt, 1.0);
  gl.uniform1f(U.uCiel, 0);
  gl.uniform3fv(U.uLP, lp);
  gl.uniform3fv(U.uLC, lc);
  gl.uniform1i(U.uLN, lampes.length);
  gl.uniform3fv(U.uTint, [1,1,1]);

  M.ident(modele);
  if(options.grille && grilleM){
    gl.uniform1f(U.uEmit, 0.55);
    gl.uniformMatrix4fv(U.uModel, false, modele);
    gl.bindVertexArray(grilleM.vao);
    gl.drawArrays(gl.TRIANGLES, 0, grilleM.count);
  }

  gl.uniform1f(U.uEmit, 0);
  for(const item of maillages){
    if(!item || !item.m) continue;
    gl.uniform1f(U.uEmit, item.emit || 0);
    gl.uniformMatrix4fv(U.uModel, false, item.modele || modele);
    gl.bindVertexArray(item.m.vao);
    gl.drawArrays(gl.TRIANGLES, 0, item.m.count);
  }
  gl.bindVertexArray(null);
}

export {libererMesh, mesh};
