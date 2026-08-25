/* ═══ RENDU / CARTES TEXTURÉES ═══
   Un programme à part, avec son propre quad et ses coordonnées de texture, pour
   afficher les VRAIES illustrations des cartes dans le monde.

   ── POURQUOI UN PROGRAMME SÉPARÉ ───────────────────────────────────────────
   Le maillage général du jeu ne porte que trois attributs : position, normale,
   couleur. Pas d'UV. Y ajouter un quatrième attribut obligerait à toucher
   mesh(), la disposition des VAO et tous les tampons du monde — pour une seule
   sorte d'objet qui, elle, n'a besoin ni de relief ni d'éclairage complexe.

   Un programme dédié coûte deux shaders de vingt lignes et reste isolé. C'est
   aussi la brique dont dépendra tout affichage d'image à venir : panneaux,
   affiches, écrans.

   ── CE QUE ÇA DONNE ────────────────────────────────────────────────────────
   Une carte est trois plans superposés, du fond vers l'avant :
     1. le HALO, très diffus, teinté par le rang — c'est lui qui perce la brume
     2. le CADRE, un liseré fin, plus une fine tranche sombre pour l'épaisseur
     3. l'ILLUSTRATION, texturée si le dossier de ce rang contient l'image

   Sans illustration (dossiers vides), on retombe sur un aplat de la couleur du
   rang : le jeu reste jouable et lisible.                                    */

import {gl, prog, unis} from '../noyau/gl.js';
import {SETUP} from '../setup.js';

/* ─────────────── le programme ─────────────── */

const VS = `#version 300 es
layout(location=0) in vec2 aPos;      // −0.5 … +0.5
uniform mat4 uProj, uView, uModel;
out vec2 vUv;
void main(){
  vUv = vec2(aPos.x + 0.5, 0.5 - aPos.y);      // origine en haut à gauche
  gl_Position = uProj * uView * uModel * vec4(aPos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec3 uTeinte, uFog;
uniform float uAvecTex, uEclat, uFogD, uDist;

void main(){
  vec4 t = texture(uTex, vUv);

  /* ── L'ALPHA ÉTAIT FORCÉ À 1, ET C'ÉTAIT LE BUG ──
     « Il y a comme une hachure sur l'image et elle est toute petite dans un
     fond carré noir. »

     Le carré noir n'était pas un fond : c'était la passe de LUEUR, un
     rectangle sans texture, une fois et demie plus grand que la carte, dessiné
     avec un alpha force a 1. Un aplat opaque, donc. Et la hachure, c'est le grain
     de la passe écran qui se voit sur un aplat sombre et uniforme — il est
     invisible sur une texture, il saute aux yeux sur du plat.

     La passe de lueur est supprimée. Il ne reste que l'image, et son alpha est
     celui du fichier : une carte découpée garde sa découpe. */
  if(t.a < 0.08) discard;

  vec3 c = t.rgb * uEclat;

  /* La brume, comme le reste du monde — sinon la carte flotte hors du décor.
     Mais on la MODÈRE sur les cartes : c'est le seul objet du jeu qu'on
     cherche, et le noyer à huit mètres reviendrait à le cacher. */
  float f = exp(-pow(max(uDist - 0.6, 0.0) * uFogD * 0.006, 2.0));
  frag = vec4(mix(uFog, c, clamp(f, 0.35, 1.0)), t.a);
}`;

let P = null, U = null, vao = null;

function initialiser(){
  if(P) return;
  P = prog(VS, FS);
  U = unis(P, ['uProj','uView','uModel','uTex','uTeinte','uFog',
               'uAvecTex','uEclat','uFogD','uDist']);
  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  // deux triangles, un quad unité centré
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -0.5,-0.5,  0.5,-0.5,  0.5, 0.5,
    -0.5,-0.5,  0.5, 0.5, -0.5, 0.5,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
}

/* ─────────────── les textures ─────────────── */

const textures = new WeakMap();   // HTMLImageElement -> WebGLTexture
const dernierRafraichi = new WeakMap();

/* ── LES GIF S'ANIMENT ─────────────────────────────────────────────────────
   Les cartes d'Orlando sont des GIF : elles tournent sur elles-mêmes et ont
   un reflet qui balaie. C'est tout leur intérêt, et une texture envoyée une
   fois au GPU les fige sur leur première trame.

   Il n'y a pas besoin d'un décodeur GIF. Un navigateur anime un élément img
   tout seul, et texImage2D d'un élément image en lit LA TRAME COURANTE. Il
   suffit donc de renvoyer la texture de temps en temps — le GIF joue.

   Trois précautions, sans lesquelles ça coûterait cher :
     · seulement les cartes PROCHES (le rendu les trie déjà par distance) ;
     · au plus quelques-unes par image ;
     · à cadence limitée : un GIF tourne à 10-15 trames par seconde, réenvoyer
       à 60 Hz serait quatre fois le travail pour rien.                     */

const MS_ENTRE_TRAMES = 90;    // ~11 images/s, la cadence d'un GIF
const MAX_PAR_IMAGE = 3;       // renvois de texture par image de jeu
const DIST_ANIMEE = 26;        // mètres : au-delà, la trame fixe suffit

let renvoyesCetteImage = 0;

function envoyer(t, img){
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
}

/**
 * Envoie une image au GPU. Renvoie null tant qu'elle n'est pas complètement
 * chargée — le sondage des dossiers est asynchrone, on ne peut pas supposer
 * qu'elle est prête.
 *
 * @param dist  distance au joueur ; en deçà de DIST_ANIMEE, la texture est
 *              rafraîchie pour que les GIF jouent.
 */
export function texturePour(img, dist){
  if(!img || !img.complete || !img.naturalWidth) return null;
  const dejaLa = textures.get(img);
  if(dejaLa){
    if(dist !== undefined && dist < DIST_ANIMEE
       && renvoyesCetteImage < MAX_PAR_IMAGE){
      const t = performance.now();
      if(t - (dernierRafraichi.get(img) || 0) > MS_ENTRE_TRAMES){
        dernierRafraichi.set(img, t);
        renvoyesCetteImage++;
        envoyer(dejaLa, img);
      }
    }
    return dejaLa;
  }

  initialiser();
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  /* Mipmaps + filtrage linéaire : une carte vue de loin scintillerait
     atrocement en NEAREST, et c'est le seul élément du jeu qui porte un dessin
     fin. Le reste du rendu garde son aspect brut. */
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  textures.set(img, t);
  return t;
}

/* ─────────────── le rendu ─────────────── */

/**
 * Dessine toutes les cartes à portée.
 *
 * @param ctx {proj, view, cam, cartes, rangs, identite, temps, fog, fogD}
 */
export function dessinerCartes(ctx){
  const {proj, view, cam, cartes, rangs, identite, temps, fog, fogD, modele, trs} = ctx;
  initialiser();

  const C = SETUP.cartes;
  const PORTEE2 = C.porteeRendu * C.porteeRendu;
  // budget de renvois de texture pour cette image (voir texturePour)
  renvoyesCetteImage = 0;

  gl.useProgram(P);
  gl.uniformMatrix4fv(U.uProj, false, proj);
  gl.uniformMatrix4fv(U.uView, false, view);
  gl.uniform3fv(U.uFog, fog);
  gl.uniform1f(U.uFogD, fogD);
  gl.bindVertexArray(vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(U.uTex, 0);

  /* ── LE MÉLANGE ALPHA, ACTIVÉ POUR LES CARTES SEULES ──
     Le reste du jeu est entièrement opaque : le moteur n'allume jamais le
     mélange. Or les cartes sont découpées, et leur bord est adouci sur
     quelques pixels. Sans mélange, ce bord se rend en marches d'escalier.

     On l'allume ici, on l'éteint juste après. L'écriture de profondeur reste
     active : deux cartes qui se recouvrent sont rarissimes, et les trier
     coûterait plus que le défaut qu'on éviterait. */
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  for(const k of cartes){
    if(k.prise) continue;
    const dx = k.x - cam.x, dz = k.z - cam.z;
    const d2 = dx*dx + dz*dz;
    if(d2 > PORTEE2) continue;
    const dist = Math.sqrt(d2);

    const rang = rangs[k.rang];
    const col = rang.couleur;
    const bob = Math.sin(temps*1.4 + k.id) * C.amplitudeFlottement;

    /* FACE AU JOUEUR, ET NON EN ROTATION.
       Les cartes sont des GIF qui tournent DÉJÀ sur eux-mêmes. Les faire
       pivoter en plus donnait deux rotations superposées, à des vitesses
       différentes, et l'illustration passait la moitié du temps de profil —
       c'est-à-dire invisible. Le moteur les présente donc simplement, et
       laisse l'image jouer son propre mouvement.

       Un léger balancement demeure : une carte parfaitement immobile face à
       soi ressemble à une affiche collée dans l'air. */
    const yaw = Math.atan2(k.x - cam.x, k.z - cam.z)
              + Math.sin(temps*0.7 + k.id) * C.balancement;
    const y = k.y + bob;
    const puls = 0.84 + 0.16*Math.sin(temps*2.2 + k.id*1.7);

    const img = identite(k.id).img;
    const tex = texturePour(img, dist);

    const poser = (l, ht, e) => {
      trs(modele, k.x, y, k.z, yaw, 0, 0, l, ht, 1);
      gl.uniformMatrix4fv(U.uModel, false, modele);
      gl.uniform1f(U.uEclat, e);
      gl.uniform1f(U.uDist, dist);
    };

    /* ── RIEN QUE LA CARTE ──
       « Je ne veux que voir les jolies cartes. »

       Une seule passe, une seule chose à l'écran : l'image, avec son propre
       alpha. Plus de cadre, plus de lueur. La lueur était un rectangle opaque
       — voir le shader — et elle produisait exactement le fond noir hachuré
       signalé en test.

       Ce qui fait qu'on la repère de loin, désormais, c'est la LAMPE qu'elle
       porte : une vraie source lumineuse posée à sa hauteur, qui perce le
       brouillard là où un aplat ne perçait rien. C'est le même remède que
       pour les armes et les cachettes. */
    if(!tex) continue;                      // pas encore chargée : on n'affiche rien
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1f(U.uAvecTex, 1);
    poser(C.largeur, C.hauteur, C.eclatIllustration * puls);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}
