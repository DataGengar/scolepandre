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
import {creerLune, directionLune} from './lune.js';
import {dessinerCartes} from './carte-rendu.js';
import {M} from '../noyau/math.js';

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

/* La lune est bâtie une fois, à la première image : elle ne dépend d'aucune
   graine et son maillage ne change jamais. */
let meshLune = null, modeleLune = M.mk(), _mL = M.mk();

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
         gainLampe, cartes, combustibles, leurres, meshCarte, ventX, rangs,
         cielOuvert = 0, monde = {}} = ctx;

  const B = BIOMES[visuel.biome];
  for(let i=0;i<3;i++) visuel.fog[i] = lerp(visuel.fog[i], B.fog[i], 0.03);
  visuel.fogD  = lerp(visuel.fogD, B.fogD * SETUP.image.fog, 0.03);
  visuel.amb   = lerp(visuel.amb, B.amb, 0.03);
  /* LA NEIGE NE TOMBE QUE DEHORS. En v3.0 elle suivait le biome, et la
     glacière étant souterraine, il neigeait dans les grottes. On croise
     maintenant la valeur du biome avec l'ouverture RÉELLE du ciel au-dessus
     du joueur : sous un plafond, aucun flocon. */
  visuel.neige = lerp(visuel.neige, B.snow * cielOuvert, 0.02);

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
  gl.uniform1f(uS.uAmb, visuel.amb * SETUP.image.ambiance);
  gl.uniform1f(uS.uLampGain, gainLampe);

  // la lampe de poche et l'atténuation des lumières du décor, depuis SETUP
  const LA = SETUP.lampe, LD = SETUP.lumiereDecor;
  gl.uniform1f(uS.uConeIn,   LA.coneInterieur);
  gl.uniform1f(uS.uConeOut,  LA.coneExterieur);
  gl.uniform1f(uS.uFaisceau, LA.intensite);
  gl.uniform1f(uS.uHalo,     LA.halo);
  gl.uniform1f(uS.uPortee,   LA.portee);
  gl.uniform1f(uS.uAttLin,   LD.attenLin);
  gl.uniform1f(uS.uAttQuad,  LD.attenQuad);
  gl.uniform1f(uS.uGainPt,   LD.gain);
  gl.uniform1f(uS.uCiel, 0);

  /* ═══ LA LUNE ═══
     Dessinée EN PREMIER, profondeur coupée : c'est un fond de ciel, tout le
     reste passe devant. uCiel=1 fait sauter au shader la brume et l'éclairage,
     sans quoi elle serait effacée par le fog à 260 m.
     Seulement quand le ciel est ouvert au-dessus du joueur : sous terre il n'y
     a pas de lune, et c'est bien le moins. */
  if(cielOuvert > 0.01){
    if(!meshLune) meshLune = creerLune();
    if(meshLune){
      const L = SETUP.lune, d = directionLune();
      M.trans(_mL, cam.x + d[0]*L.distance, cam.y + d[1]*L.distance, cam.z + d[2]*L.distance);
      M.scale(modeleLune, 1, 1, 1);
      M.mul(modeleLune, _mL, modeleLune);
      gl.depthMask(false);
      gl.disable(gl.DEPTH_TEST);
      gl.uniform1f(uS.uCiel, 1);
      gl.uniform3fv(uS.uTint, [1,1,1]);
      gl.uniform1f(uS.uEmit, L.eclat * cielOuvert);
      gl.uniformMatrix4fv(uS.uModel, false, modeleLune);
      gl.bindVertexArray(meshLune.vao);
      gl.drawArrays(gl.TRIANGLES, 0, meshLune.count);
      gl.uniform1f(uS.uCiel, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
    }
  }

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

  /* Les cartes ont leur propre programme, avec des UV et une texture : voir
     rendu/carte-rendu.js. Elles sont dessinées après tout le reste, une fois
     le programme du monde relâché. */

  /* ── OBJETS AU SOL ET FEUX ──
     Tous rendus avec la même boîte que les cartes : c'est cohérent visuellement
     (tout ce qui se ramasse tourne sur soi) et ça évite un maillage par type. */
  const proche = (x, z, r2) => { const dx = x-joueur.x, dz = z-joueur.z;
                                 return dx*dx + dz*dz < r2; };

  /* Les objets à ramasser sont FINS. En v3.1 c'étaient de gros cubes de
     40 à 55 cm posés au sol : « grossiers », et à juste titre — un fagot n'est
     pas un dé. Chacun est maintenant fait de quelques baguettes minces, ce qui
     coûte deux ou trois quads de plus et change tout à la lecture. */
  for(const b of monde.bois){
    if(b.pris || !proche(b.x, b.z, 1400)) continue;
    // trois branches croisées, presque à plat
    for(let q=0;q<3;q++){
      const a = q*1.05 + b.x*0.7;
      trs(model, b.x + Math.cos(a)*0.05, b.y - 0.06 + q*0.045, b.z + Math.sin(a)*0.05,
          a, 0, 1.5708, 0.052, 0.62, 0.052);
      draw(meshCarte, [0.34,0.24,0.15], 0.05);
    }
  }
  for(const f of monde.fusees){
    if(f.prise || !proche(f.x, f.z, 1400)) continue;
    const bob = Math.sin(temps*2 + f.x)*0.04;
    // un tube élancé, plus une coiffe rouge : ça se lit comme une fusée
    trs(model, f.x, f.y + bob, f.z, temps*0.9, 0, 0.35, 0.055, 0.40, 0.055);
    draw(meshCarte, [0.72,0.70,0.66], 0.10);
    trs(model, f.x, f.y + bob + 0.17, f.z, temps*0.9, 0, 0.35, 0.075, 0.10, 0.075);
    draw(meshCarte, [1.3,0.30,0.22], 0.85);
  }
  for(const t of monde.trousses){
    if(t.prise || !proche(t.x, t.z, 2600)) continue;
    const bob = Math.sin(temps*1.7 + t.x)*0.055;
    // une mallette plate, et la croix dessus
    trs(model, t.x, t.y + bob, t.z, temps*0.5, 0, 0, 0.34, 0.11, 0.24);
    draw(meshCarte, [0.62,0.62,0.60], 0.10);
    trs(model, t.x, t.y + bob + 0.062, t.z, temps*0.5, 0, 0, 0.19, 0.012, 0.055);
    draw(meshCarte, [0.30,1.1,0.55], 0.80);
    trs(model, t.x, t.y + bob + 0.062, t.z, temps*0.5, 0, 0, 0.055, 0.012, 0.19);
    draw(meshCarte, [0.30,1.1,0.55], 0.80);
  }

  /* Les feux et les fusées allumées : un cœur incandescent qui vacille. Le
     vacillement est irrégulier exprès — une flamme régulière fait ampoule. */
  for(const f of monde.feux){
    const t = Math.min(1, f.restant/12);
    const v = 0.8 + 0.2*Math.sin(temps*9 + f.ph) + 0.12*Math.sin(temps*23 + f.ph*3);
    trs(model, f.x, f.y + 0.30 + v*0.06, f.z, temps*1.5, 0, 0, 0.75*v, 0.85*v, 0.75*v);
    draw(meshCarte, [2.6*t, 1.15*t, 0.32*t], 1.0);
    trs(model, f.x, f.y + 0.10, f.z, 0.5, 0, 0, 1.05, 0.20, 1.05);
    draw(meshCarte, [0.20,0.16,0.13], 0.03);
  }
  for(const f of monde.fuseesActives){
    const t = Math.min(1, f.restant/6);
    const v = 0.85 + 0.15*Math.sin(temps*19 + f.ph);
    trs(model, f.x, f.y + 0.12, f.z, temps*3, 0, 0, 0.34*v, 0.34*v, 0.34*v);
    draw(meshCarte, [4.0*t, 2.9*t, 1.9*t], 1.0);
  }

  /* Les pancartes : piquet, panneau, loupiote. Elles sont posées par le joueur
     donc jamais cuites dans un pavé — on les dessine à la volée. */
  for(const p of monde.pancartes){
    if(!proche(p.x, p.z, 3200)) continue;
    trs(model, p.x, p.y + 0.72, p.z, 0, 0, 0, 0.10, 1.45, 0.10);
    draw(meshCarte, [0.20,0.16,0.13], 0.02);
    trs(model, p.x, p.y + 1.12, p.z, p.yaw, 0, 0, 0.66, 0.42, 0.06);
    draw(meshCarte, [0.38,0.35,0.29], 0.05);
    const ph = (temps / 1.6) % 1;
    const on = ph < 0.22 ? 1 : ph < 0.30 ? 0.3 : 0.05;
    trs(model, p.x, p.y + 1.52, p.z, 0, 0, 0, 0.11, 0.11, 0.11);
    draw(meshCarte, [0.30*on, 2.0*on, 1.4*on], 1.0);
  }

  // ── leurres
  for(const l of leurres){
    if(l.tenu) continue;
    const p = l.vol || l;
    const y = l.vol ? p.y : l.y;
    const dx = p.x-joueur.x, dz = p.z-joueur.z;
    if(dx*dx + dz*dz > 1400) continue;
    // un caillou : trois éclats aplatis, pas un cube doré
    const r = l.vol ? temps*7 : temps*0.4 + p.x;
    trs(model, p.x, y, p.z, r, 0, 0.4, 0.17, 0.11, 0.14);
    draw(meshCarte, [0.44,0.41,0.34], 0.05);
    trs(model, p.x, y + 0.03, p.z, r + 1.1, 0, -0.3, 0.12, 0.09, 0.16);
    draw(meshCarte, [0.52,0.48,0.40], 0.05);
  }

  // ── les créatures, en un seul appel
  gl.uniform3fv(uS.uTint, [1,1,1]);
  gl.uniform1f(uS.uEmit, 0.010);
  gl.uniformMatrix4fv(uS.uModel, false, IDENT);
  dessinerCreatures();

  /* ── les cartes, avec leur programme texturé ──
     Après le reste de la passe monde : elles écrivent dans le même tampon de
     profondeur, donc elles s'occultent correctement avec le décor. */
  if(ctx.identite) dessinerCartes({
    proj, view, cam, cartes, rangs, identite: ctx.identite,
    temps, fog: visuel.fog, fogD: visuel.fogD, modele: model, trs,
  });

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
  gl.uniform1f(uP.uVign, SETUP.image.vignette);

  const G = projeterGodrays(n, view, proj);
  gl.uniform1i(uP.uSunN, G.n);
  if(G.n){ gl.uniform2fv(uP.uSun, G.positions); gl.uniform3fv(uP.uSunC, G.couleurs); }

  gl.bindVertexArray(null);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
