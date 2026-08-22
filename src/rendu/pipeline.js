/* ═══ RENDU / PIPELINE ═══
   Deux passes : le monde dans un tampon interne basse résolution, puis ce
   tampon à l'écran en passant par le post-process (godrays, tramage, grain,
   vignette, neige, froid).

   La basse résolution interne n'est pas une économie : c'est l'esthétique du
   jeu. SETUP.image.res la contrôle.                                          */

import {SETUP, abonner} from '../setup.js';
import {gl, cv} from '../noyau/gl.js';
import {prog, unis} from '../noyau/gl.js';
import {VS, FS, VSP, FSP, UNIS_MONDE, UNIS_POST, NLIGHT} from '../noyau/shaders.js';
import {lerp} from '../noyau/math.js';
import {trs} from '../noyau/math.js';
import {BIOMES} from '../monde/biomes.js';
import {paves} from '../monde/maillage.js';
import {proj, view, model, cam} from './camera.js';
import {lpArr, lcArr, choisirLumieres, projeterGodrays} from './lumieres.js';
import {batirCreature, batirJeune, dessinerCreatures} from '../creatures/geometrie.js';

export const pS = prog(VS, FS);
export const uS = unis(pS, UNIS_MONDE);
export const pP = prog(VSP, FSP);
export const uP = unis(pP, UNIS_POST);

let fbo, fboTex, fboDepth;
/* Dimensions du tampon interne. Objet et non deux `let` exportés : voir la
   note de src/monde/import-png.js. */
export const tampon = {w:0, h:0};

/** Identité, allouée une fois : la v3 initiale en créait une par image. */
const IDENT = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

/** État visuel lissé. Exporté : le streaming de pavés en dépend. */
export const visuel = {
  biome:0, fog:[0,0,0], fogD:4.4, amb:0.016, neige:0, nLum:0, pavesVus:0,
};

function makeFBO(w,h){
  if(fbo){ gl.deleteFramebuffer(fbo); gl.deleteTexture(fboTex); gl.deleteRenderbuffer(fboDepth); }
  tampon.w = w; tampon.h = h;
  fboTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],
   [gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]]
    .forEach(([k,v]) => gl.texParameteri(gl.TEXTURE_2D,k,v));
  fboDepth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, fboDepth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fboDepth);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

export function resize(){
  cv.width = Math.floor(innerWidth);
  cv.height = Math.floor(innerHeight);
  const h = Math.round(SETUP.image.res);
  const w = Math.max(2, Math.round(h * (cv.width/cv.height)));
  makeFBO(w,h);
}
addEventListener('resize', resize);
abonner('image.res', () => resize());

function draw(m, tint, emit){
  gl.uniform3fv(uS.uTint, tint);
  gl.uniform1f(uS.uEmit, emit || 0);
  gl.uniformMatrix4fv(uS.uModel, false, model);
  gl.bindVertexArray(m.vao);
  gl.drawArrays(gl.TRIANGLES, 0, m.count);
}

/**
 * Une image complète.
 * @param ctx  tout ce dont le rendu a besoin, rassemblé par jeu.js :
 *   {joueur, jeunes, temps, dread, vision, froidVis, coeur, gainLampe,
 *    cartes, combustibles, leurres, meshCarte, ventX}
 */
export function rendre(ctx){
  const {joueur, jeunes, temps, dread, vision, froidVis, coeur,
         gainLampe, cartes, combustibles, leurres, meshCarte, ventX, rangs} = ctx;

  const B = BIOMES[visuel.biome];
  for(let i=0;i<3;i++) visuel.fog[i] = lerp(visuel.fog[i], B.fog[i], 0.03);
  visuel.fogD  = lerp(visuel.fogD, B.fogD * SETUP.image.fog, 0.03);
  visuel.amb   = lerp(visuel.amb, B.amb, 0.03);
  visuel.neige = lerp(visuel.neige, B.snow, 0.02);

  /* ── passe monde ── */
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0,0,tampon.w,tampon.h);
  gl.clearColor(visuel.fog[0], visuel.fog[1], visuel.fog[2], 1);
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(pS);
  gl.uniformMatrix4fv(uS.uProj, false, proj);
  gl.uniformMatrix4fv(uS.uView, false, view);
  gl.uniform3f(uS.uCam, cam.x, cam.y, cam.z);
  gl.uniform3fv(uS.uFwd, cam.fwd);
  gl.uniform3fv(uS.uFog, visuel.fog);
  gl.uniform1f(uS.uFogD, visuel.fogD);
  gl.uniform1f(uS.uAmb, visuel.amb);
  gl.uniform1f(uS.uLampGain, gainLampe);

  /* La créature est bâtie AVANT le choix des lumières : ses yeux doivent être
     dans le tableau des lumières temporaires quand on le consulte. */
  batirCreature(temps);
  for(const j of jeunes) batirJeune(j, joueur, temps);

  const n = choisirLumieres(joueur.x, joueur.z, temps);
  visuel.nLum = n;
  gl.uniform3fv(uS.uLP, lpArr);
  gl.uniform3fv(uS.uLC, lcArr);
  gl.uniform1i(uS.uLN, n);

  // ── le décor, par pavés
  const PORTEE = (2.4/(visuel.fogD*0.01)) + 48*1.4, P2 = PORTEE*PORTEE;
  visuel.pavesVus = 0;
  gl.uniform3fv(uS.uTint, [1,1,1]);
  gl.uniform1f(uS.uEmit, 0);
  gl.uniformMatrix4fv(uS.uModel, false, IDENT);
  for(const [k,p] of paves){
    if(!p.m) continue;
    if((p.x-joueur.x)**2 + (p.z-joueur.z)**2 > P2) continue;
    gl.bindVertexArray(p.m.vao);
    gl.drawArrays(gl.TRIANGLES, 0, p.m.count);
    visuel.pavesVus++;
  }

  // ── cartes : elles tournent sur elles-mêmes, face puis tranche
  for(const k of cartes){
    if(k.prise) continue;
    const dx = k.x-joueur.x, dz = k.z-joueur.z;
    if(dx*dx + dz*dz > 2600) continue;
    const col = rangs[k.rang].couleur;
    const bob = Math.sin(temps*1.6 + k.id)*0.12;
    trs(model, k.x, k.y+bob, k.z, temps*1.15+k.id, 0, 0, 0.62, 0.94, 0.045);
    draw(meshCarte, col, 0.55);
    trs(model, k.x, k.y+bob, k.z, temps*1.15+k.id, 0, 0, 0.70, 1.03, 0.02);
    draw(meshCarte, [col[0]*.35, col[1]*.35, col[2]*.35], 0.18);
  }

  // ── combustible au sol
  for(const f of combustibles){
    if(f.pris) continue;
    const dx = f.x-joueur.x, dz = f.z-joueur.z;
    if(dx*dx + dz*dz > 1400) continue;
    trs(model, f.x, f.y+Math.sin(temps*2+f.x)*0.05, f.z, temps*0.6, 0, 0, 0.30,0.30,0.30);
    draw(meshCarte, [0.85,0.55,0.20], 0.42);
  }

  // ── leurres
  for(const l of leurres){
    if(l.tenu) continue;
    const p = l.vol || l;
    const y = l.vol ? p.y : l.y;
    const dx = p.x-joueur.x, dz = p.z-joueur.z;
    if(dx*dx + dz*dz > 1400) continue;
    trs(model, p.x, y, p.z, temps*1.4, 0, 0, 0.26,0.26,0.26);
    draw(meshCarte, [0.75,0.68,0.42], 0.30);
  }

  // ── les créatures, en un seul appel
  gl.uniform3fv(uS.uTint, [1,1,1]);
  gl.uniform1f(uS.uEmit, 0.010);
  gl.uniformMatrix4fv(uS.uModel, false, IDENT);
  dessinerCreatures();

  /* ── passe écran ── */
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0,0,cv.width,cv.height);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(pP);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.uniform1i(uP.uTex, 0);
  gl.uniform2f(uP.uRes, tampon.w, tampon.h);
  gl.uniform1f(uP.uTime, temps);
  gl.uniform1f(uP.uGrain, SETUP.image.grain);
  gl.uniform1f(uP.uDread, dread);
  gl.uniform1f(uP.uSnow, visuel.neige);
  gl.uniform1f(uP.uWind, ventX);
  gl.uniform1f(uP.uVision, vision);
  gl.uniform1f(uP.uFroid, froidVis);
  gl.uniform1f(uP.uCoeur, coeur);
  gl.uniform1f(uP.uRays, SETUP.image.rays);

  const G = projeterGodrays(n, view, proj);
  gl.uniform1i(uP.uSunN, G.n);
  if(G.n){ gl.uniform2fv(uP.uSun, G.positions); gl.uniform3fv(uP.uSunC, G.couleurs); }

  gl.bindVertexArray(null);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
