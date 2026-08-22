/* ══════════════════════════════════════════════════════════════════════════
   SCOLOPANDRE v3 — ASSEMBLAGE ET BOUCLE
   ──────────────────────────────────────────────────────────────────────────
   Ce fichier ne contient aucune règle de jeu. Il branche les modules les uns
   aux autres et fait tourner la boucle. Si tu cherches un comportement, il
   est dans le dossier de son domaine :

     un réglage . . . . . . . . . . . . . . . . src/setup.js
     le terrain, les gouffres, les ponts  . . . src/monde/
     les stacks de cartes . . . . . . . . . . . src/carte/rangs.js
     la bête, ses yeux, ses petits  . . . . . . src/creatures/
     le froid, la chute, la torche  . . . . . . src/joueur/
     les nappes, le vent, les effondrements . . src/audio/
     la caméra, les lumières, le sismographe  . src/rendu/
   ══════════════════════════════════════════════════════════════════════════ */

import {SETUP, DERIVE} from './setup.js';
import {clamp, lerp} from './noyau/math.js';
import {semer, graine, rnd, ri} from './noyau/rng.js';
import {cv, boite} from './noyau/gl.js';

import {BIOMES, NAPPE_DE_BIOME} from './monde/biomes.js';
import {
  GW, GH, CELL, idx, isFloor, w2c, c2w, groundAt, degagement, biomeAt,
  openN, sky, floorH, bornes, celluleLibre, rebuildNavCost,
} from './monde/grille.js';
import * as Grille from './monde/grille.js';
import {construireMonde, rapportMonde, monde, props, lights} from './monde/index.js';
import {gouffres, effondrerZone} from './monde/relief.js';
import {cachettes, cachetteProche, dansCachette} from './monde/cachettes.js';
import {addProp} from './monde/props.js';
import {majPaves, indexerProps, libererTousLesPaves, paves} from './monde/maillage.js';
import {placerSortie, atteinte, objectif} from './monde/sortie.js';
import {lireCartePNG} from './monde/import-png.js';
import {villages, trousses, bois, fusees, dansSafe} from './monde/villages.js';
import {pancartes, chargerPancartes, poser as poserPancarte,
        pancarteProche, retirer as retirerPancarte,
        lumieresPancartes} from './monde/pancartes.js';

import {RANGS} from './carte/rangs.js';
import {sonderStacks, identite} from './carte/catalogue.js';
import {cartes, placerCartes, ramasser} from './carte/placement.js';
import {possede, ajouter, charger as chargerCollection, majAffichage} from './carte/collection.js';

import {ST} from './creatures/etats.js';
import {directeur} from './creatures/directeur.js';
import {creature, spawnCreature, updateCreature, brancherCri} from './creatures/mere.js';
import {jeunes, majPopulation, updateJeunes, viderJeunes, brancherStridulation,
        brancherFeu, attirerJeunes} from './creatures/jeunes.js';
import {creerCreature} from './creatures/geometrie.js';

import {
  joueur, touches, sons, odeur, spawnJoueur, updateJoueur, indexerColliders,
  basculerRampe, emettreSon, decroitreTraces, echelleIci, emprunterEchelle,
} from './joueur/joueur.js';
import {CHUTE, tirerChuteSismique, impactSol, verifierVide, reinitialiserChute} from './joueur/chute.js';
import {froid, updateFroid, reinitialiserFroid, intensiteVisuelle} from './joueur/froid.js';
import {
  torche, combustibles, refuges, placerCombustible, placerRefuges,
  refugeProche, updateTorche, basculerTorche, reinitialiserTorche,
} from './joueur/torche.js';
import {
  leurres, placerLeurres, reprendreTous, ramasserLeurres, lancer, updateVol,
} from './joueur/leurres.js';
import {sante, reinitialiserSante, blesser, ramasserTrousse, updateSante,
        gravite} from './joueur/sante.js';
import {
  feux, fuseesActives, inventaire, reinitialiserFeu, ramasser as ramasserFeu,
  allumerFeu, lancerFusee, updateFeu, feuProche, lumieresDuFeu, chaleurDuFeu,
} from './joueur/feu.js';

import * as Audio from './audio/index.js';
import {proj, view, cam, majTremblement, construireVue} from './rendu/camera.js';
import {rendre, resize, visuel, tampon} from './rendu/pipeline.js';
import {lumieresDynamiques} from './rendu/lumieres.js';
import {dessinerScope, basculer as basculerScope} from './rendu/sismographe.js';
import {construireMenu, ouvrirChargement, majChargement, fermerChargement,
        afficherVoile, messageMenu} from './ui/menu.js';
import {majHUD, majFlash, flash} from './ui/hud.js';

/* ─────────────── état global de la partie ─────────────── */

const jeu = {
  temps:0, dread:0,
  enCours:false, gagne:false,
  attrapeT:0, causeMort:'',
  biome:0,
  ventX:0, ventZ:0, ventForce:0,
  cielOuvert:0,          // 1 quand rien ne nous sépare du ciel : neige et lune
  secousseEvt:0,
  meshCarte:null,
  pret:false,
};

/** L'invite du menu. Rappelée au retour depuis le jeu. */
const INVITE = "CLIQUER N'IMPORTE OÙ POUR DESCENDRE";

const vent = {angle:0, freq:0.5};
let dernierT = performance.now();
let compteurUI = 0, compteurPop = -1;
let fautes = 0;

/* ─────────────── génération ─────────────── */

/** Ce que le monde doit poser une fois le terrain prêt. */
function placerObjets(){
  spawnJoueur();
  placerRefuges(props, lights);
  placerCombustible();
  placerLeurres();
  placerSortie(joueur, props, lights);
  placerCartes();
}

async function genererMonde(nouvelleGraine){
  jeu.pret = false;
  ouvrirChargement();
  semer(nouvelleGraine);

  const gen = construireMonde({placerObjets});
  for(;;){
    const {value, done} = gen.next();
    if(done) break;
    majChargement(value.nom, value.part);
    // on rend la main au navigateur pour que la barre s'affiche vraiment
    await new Promise(r => requestAnimationFrame(r));
  }

  indexerColliders();
  spawnCreature(joueur);
  directeur.reset(joueur);
  viderJeunes();
  reinitialiserFroid();
  reinitialiserTorche();
  reinitialiserChute();
  reinitialiserSante();
  reinitialiserFeu();
  reprendreTous();
  chargerPancartes(graine());
  joueur.held = 1;

  jeu.biome = biomeAt(joueur.x, joueur.z);
  visuel.biome = jeu.biome;
  visuel.fog = BIOMES[jeu.biome].fog.slice();
  jeu.gagne = false; jeu.attrapeT = 0;

  if(Audio.pret()){
    Audio.changerNappe(NAPPE_DE_BIOME[jeu.biome]);
    Audio.reglerReverb(BIOMES[jeu.biome].reverb);
  }

  console.log('MONDE', rapportMonde());
  fermerChargement();
  jeu.pret = true;
}

/* ─────────────── entrées ─────────────── */

function brancherEntrees(){
  document.addEventListener('pointerlockchange', () => {
    jeu.enCours = document.pointerLockElement === cv;
    afficherVoile(!jeu.enCours);
    if(!jeu.enCours) messageMenu(INVITE);
  });

  addEventListener('mousemove', e => {
    if(!jeu.enCours || joueur.prone > 0) return;
    joueur.yaw   -= e.movementX * 0.0022;
    joueur.pitch  = clamp(joueur.pitch - e.movementY*0.0022, -1.4, 1.4);
  });

  addEventListener('mousedown', e => {
    if(!jeu.enCours) return;
    if(e.button === 0) lancerLeurre();
    // clic droit maintenu : brandir la lampe. Les jeunes reculent, le jus fond.
    if(e.button === 2) inventaire.brandit = true;
  });
  addEventListener('mouseup', e => { if(e.button === 2) inventaire.brandit = false; });

  const inv = document.getElementById('inv');

  addEventListener('keydown', e => {
    touches[e.code] = true;

    if(e.code === 'KeyI'){
      e.preventDefault();
      const ouvert = inv.style.display === 'block';
      inv.style.display = ouvert ? 'none' : 'block';
      if(!ouvert){ majAffichage(); document.exitPointerLock(); }
      return;
    }
    if(e.code === 'KeyR'){        // un nouveau monde, y compris depuis le menu
      if(jeu.pret){ cacherEcranFin(); genererMonde(undefined); }
      return;
    }
    if(e.code === 'Tab'){ e.preventDefault(); basculerScope(); }
    if(e.code === 'KeyP'){
      const t = document.getElementById('tune');
      t.style.display = t.style.display === 'block' ? 'none' : 'block';
    }

    /* Les gestes de JEU ne valent qu'en jeu. Sans cette garde, appuyer sur
       Espace depuis le menu lançait un leurre dans un monde qu'on ne regarde
       pas — et Espace sert justement à démarrer la partie depuis le menu. */
    if(!jeu.enCours) return;

    if(e.code === 'Space'){ e.preventDefault(); lancerLeurre(); }
    if(e.code === 'KeyG'){ e.preventDefault(); allumerFeuIci(); }
    if(e.code === 'KeyV'){ e.preventDefault(); tirerFusee(); }
    if(e.code === 'KeyB'){ e.preventDefault(); gererPancarte(); }
    if(e.code === 'KeyE'){ e.preventDefault(); actionContextuelle(); }
    if(e.code === 'CapsLock') basculerRampe();
    if(e.code === 'KeyF') basculerTorche();
    // Ctrl+W et Ctrl+D sont réservés par le navigateur : on neutralise la
    // touche plutôt que de tenter un preventDefault qui ne marchera pas.
    if(e.code === 'ControlLeft' || e.code === 'ControlRight') touches[e.code] = false;
  });

  /* Le clic droit sert à lancer la partie depuis le menu et n'a aucun usage en
     jeu : on supprime le menu système dans les deux cas. */
  addEventListener('contextmenu', e => e.preventDefault());

  addEventListener('keyup', e => { touches[e.code] = false; });
  addEventListener('blur', () => { for(const k in touches) touches[k] = false; });

  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if(!f || f.type !== 'image/png') return;
    const img = new Image();
    img.onload = () => {
      const err = lireCartePNG(img);
      flash(err ? err : 'carte chargée — R pour la bâtir', 4);
    };
    img.src = URL.createObjectURL(f);
  });
}

/** G — allumer un feu de camp avec un fagot. */
function allumerFeuIci(){
  if(joueur.prone > 0 || joueur.abrite) return;
  const f = allumerFeu(joueur);
  if(f){ Audio.effets.feu(); flash('FEU ALLUMÉ · ' + inventaire.bois + ' FAGOT(S)'); }
  else flash('PAS DE BOIS');
}

/** V — lancer une fusée de détresse. La seule façon de VOIR une salle entière. */
function tirerFusee(){
  if(joueur.prone > 0 || joueur.abrite) return;
  const f = lancerFusee(joueur);
  if(f){ Audio.effets.fusee(); }
  else flash('PLUS DE FUSÉE');
}

/** B — poser une pancarte, ou lire / retirer celle qui est là. */
function gererPancarte(){
  if(joueur.prone > 0) return;
  const p = pancarteProche(joueur.x, joueur.z);
  if(p){
    // déjà une pancarte ici : on la lit, et MAJ+B la retire
    if(touches['ShiftLeft'] || touches['ShiftRight']){
      retirerPancarte(joueur.x, joueur.z);
      flash('PANCARTE RETIRÉE');
    } else {
      flash(p.texte ? '« ' + p.texte + ' »' : 'PANCARTE VIERGE', 4);
    }
    return;
  }
  /* On relâche le pointeur pour écrire : sans ça le prompt ne reçoit pas les
     touches, et on se retrouve à taper dans le vide. */
  document.exitPointerLock();
  setTimeout(() => {
    const txt = prompt('Message à laisser ici (48 caractères) :', '');
    if(txt !== null){
      poserPancarte(joueur, txt);
      flash('PANCARTE POSÉE');
    }
  }, 60);
}

function lancerLeurre(){
  if(joueur.prone > 0 || joueur.abrite) return;
  if(lancer(joueur, joueur.derive)) Audio.effets.lance();
}

/**
 * E est CONTEXTUEL : une cachette si tu es devant, sinon une échelle si tu es
 * dessus. Deux touches auraient été une de trop pour deux gestes qui ne se
 * présentent jamais au même endroit.
 */
function actionContextuelle(){
  if(joueur.abrite || cachetteProche(joueur.x, joueur.z, 2.4)){
    basculerCachette();
    return;
  }
  const quoi = echelleIci();
  if(quoi && emprunterEchelle())
    flash(quoi === 'monter' ? 'SUR LA PASSERELLE' : 'REDESCENDU');
}

/** E : entrer ou sortir d'une cachette. */
function basculerCachette(){
  if(joueur.abrite){
    joueur.abrite = false;
    // on ressort par l'entrée
    if(joueur.cachette){ joueur.x = joueur.cachette.entree.x; joueur.z = joueur.cachette.entree.z; }
    joueur.cachette = null;
    Audio.murer(false);
    Audio.effets.sortirCachette();
    flash('À DÉCOUVERT');
    return;
  }
  const k = cachetteProche(joueur.x, joueur.z, 2.4);
  if(!k) return;
  joueur.abrite = true; joueur.cachette = k;
  joueur.x = k.x; joueur.z = k.z;
  joueur.vx = joueur.vz = 0;
  Audio.murer(true);
  Audio.effets.entrerCachette();
  flash('À L\'ABRI');
}

/* ─────────────── mort et fin ─────────────── */

const ecranFin = document.getElementById('caught');

function mourir(cause){
  if(jeu.attrapeT > 0) return;
  jeu.attrapeT = 1.4;
  jeu.causeMort = cause;
  joueur.shake = 1;
}

function cacherEcranFin(){
  ecranFin.style.opacity = '0';
  const s = ecranFin.querySelector('span');
  s.style.color = ''; s.textContent = "ELLE T'A TROUVÉ";
}

const TEXTE_MORT = {
  [CHUTE.MORT_VIDE]:    'TU ES TOMBÉ',
  [CHUTE.MORT_HAUTEUR]: 'LA CHUTE T\'A TUÉ',
  creature:             "ELLE T'A TROUVÉ",
  jeunes:               'ILS T\'ONT TROUVÉ',
  froid:                'LE FROID T\'A PRIS',
};

/* ─────────────── effondrements ─────────────── */

function declencherEffondrement(){
  // quelque part autour du joueur, entre 12 et 60 m
  const a = Math.random()*6.283;
  const d = 12 + Math.random()*(SETUP.audio.effondrement.portee - 12);
  const wx = joueur.x + Math.cos(a)*d, wz = joueur.z + Math.sin(a)*d;

  // position dans le repère de l'auditeur
  const cy = Math.cos(joueur.yaw), sy = Math.sin(joueur.yaw);
  const dx = wx - joueur.x, dz = wz - joueur.z;
  Audio.declencher(dx*cy - dz*sy, 2, -(dx*-sy + dz*-cy));

  const proximite = 1 - d/SETUP.audio.effondrement.portee;
  setTimeout(() => {
    if(!jeu.pret) return;
    // la secousse, la vibration qui l'attire, et les gravats
    jeu.secousseEvt = SETUP.audio.effondrement.secousse * (0.45 + proximite*0.55);
    emettreSon(wx, wz, 60, false);
    const cx = w2c(wx), cz = w2c(wz);
    if(isFloor(cx,cz)){
      const touchees = effondrerZone(cx, cz, 3);
      for(const t of touchees) if(Math.random() < 0.4) addProp('gravats', t.x, t.z, t.i);
      indexerProps(); libererTousLesPaves();
    }
    flash('EFFONDREMENT');
  }, 2000);
}

/* ─────────────── boucle ─────────────── */

function frame(now){
  try{ coeur(now); }
  catch(e){
    // Filet de sécurité : une exception isolée ne doit pas faire perdre la
    // partie. On la signale, on saute l'image, et on continue.
    if(fautes++ < 6) console.error('image ignorée :', e);
    if(fautes === 6) console.error('erreurs suivantes silencieuses');
  }
  requestAnimationFrame(frame);
}

function coeur(now){
  const dt = Math.min(0.05, (now - dernierT)/1000);
  dernierT = now;
  if(!jeu.pret) return;
  jeu.temps += dt;

  let dP = Math.hypot(joueur.x - creature.x, joueur.z - creature.z);

  /* ── fin de partie ── */
  if(jeu.gagne){
    const s = ecranFin.querySelector('span');
    ecranFin.style.opacity = '1';
    s.textContent = 'SORTIE ATTEINTE  ·  ' + possede.size + ' CARTES  ·  R POUR UN NOUVEAU MONDE';
    s.style.color = '#8fa88c';
    dessinerImage(dt, dP);
    return;
  }

  /* ── simulation ── */
  if(jeu.enCours && jeu.attrapeT <= 0){
    simuler(dt);
    dP = Math.hypot(joueur.x - creature.x, joueur.z - creature.z);
  } else if(jeu.attrapeT > 0){
    jeu.attrapeT -= dt;
    ecranFin.style.opacity = String(clamp(jeu.attrapeT/0.4, 0, 1));
    ecranFin.querySelector('span').textContent =
      TEXTE_MORT[jeu.causeMort] || TEXTE_MORT.creature;
    if(jeu.attrapeT <= 0){
      cacherEcranFin();
      spawnJoueur(); spawnCreature(joueur); directeur.reset(joueur);
      reinitialiserFroid(); reinitialiserChute();
      joueur.abrite = false; joueur.cachette = null; Audio.murer(false);
    }
  }

  majAudioSpatial(dt, dP);
  majPaves(joueur.x, joueur.z, visuel.fogD);

  jeu.dread = lerp(jeu.dread,
    clamp(1 - (dP-2.5)/16, 0, 1) * (creature.state === ST.CHASE ? 1 : 0.55),
    1 - Math.exp(-4*dt));

  dessinerImage(dt, dP);

  compteurUI += dt;
  majFlash(dt);
  if(compteurUI > 0.2){
    compteurUI = 0;
    majHUD({
      joueur, biome: jeu.biome, nappe: Audio.nomNappe(),
      pavesVus: visuel.pavesVus, pavesTotal: paves.size, graine: graine(),
      sortie: objectif.sortie, monde,
    });
  }
}

function simuler(dt){
  /* ── vent ── (il pilote l'audio, l'odeur ET le froid : une seule source) */
  vent.angle += dt*0.055;
  vent.freq = 0.45 + 0.55*(0.5 + 0.5*Math.sin(jeu.temps*0.031));
  const ci = w2c(joueur.x), cz = w2c(joueur.z);
  const ouvert = isFloor(ci,cz) ? openN[idx(ci,cz)] : 0.5;
  const ciel   = isFloor(ci,cz) ? sky[idx(ci,cz)] : 0;
  let prochesGouffre = 0;
  for(const g of gouffres){
    const d = Math.hypot(c2w(g.x)-joueur.x, c2w(g.z)-joueur.z);
    const r = Math.max(g.rx, g.rz)*CELL + 25;
    if(d < r){ prochesGouffre = Math.max(prochesGouffre, 1 - d/r); }
  }
  /* Le ciel au-dessus de MOI, pas le biome de la salle : c'est ce qui décide
     s'il neige et si la lune se voit. Lissé, sinon passer sous un surplomb
     ferait clignoter la neige. */
  const cielIci = (isFloor(ci,cz) && !joueur.abrite) ? sky[idx(ci,cz)] : 0;
  jeu.cielOuvert = lerp(jeu.cielOuvert, cielIci, 1 - Math.exp(-2.2*dt));

  jeu.ventForce = Audio.souffler(ciel, ouvert, prochesGouffre, joueur.abrite);
  jeu.ventX = Math.cos(vent.angle)*vent.freq*jeu.ventForce;
  jeu.ventZ = Math.sin(vent.angle)*vent.freq*jeu.ventForce;

  /* ── feu, santé, ramassages ── */
  updateFeu(dt, joueur, {});
  updateSante(dt);
  const pris = ramasserFeu(joueur);
  if(pris.bois || pris.fusees) Audio.effets.ramasse();
  if(ramasserTrousse(joueur.x, joueur.gy, joueur.z)){
    Audio.effets.soin(); flash('TROUSSE UTILISÉE');
  }
  // brandir la lampe coûte cher : c'est ce qui l'empêche d'être une solution
  if(inventaire.brandit && torche.on)
    torche.jus = Math.max(0, torche.jus - dt*SETUP.feu.brandirConso);

  /* ── froid ── */
  joueur.torcheAllumee = torche.on;
  const brasero = refugeProche(joueur.x, joueur.gy, joueur.z);
  const safe = dansSafe(joueur.x, joueur.z);
  const gainFeu = chaleurDuFeu(joueur.x, joueur.z);
  const auChaud = !!brasero || !!safe || gainFeu > 0;
  const F = updateFroid(dt, joueur, jeu.ventForce, auChaud, {
    souffle: i => Audio.effets.souffle(i),
    coeur:   i => Audio.effets.coeur(i),
  });
  joueur.derive = F.derive;
  if(F.souffleRayon > 0 && !joueur.abrite)
    emettreSon(joueur.x, joueur.z, F.souffleRayon, false);
  /* Le froid ne tue plus d'un coup : il ronge la santé. C'est ce qui rend les
     trousses médicales utiles et laisse une chance d'atteindre un feu. */
  if(froid.chaleur <= 0.01) blesser(SETUP.sante.degatsFroid*dt, true);
  if(sante.mort){ mourir('froid'); return; }

  /* ── joueur ── */
  updateJoueur(dt, F.vitesse, {
    pas: g => Audio.effets.pas(g),
    impactSol: (hauteur) => {
      const r = impactSol(hauteur);
      if(r === CHUTE.MORT_HAUTEUR) mourir(CHUTE.MORT_HAUTEUR);
      else if(r === CHUTE.SONNE){
        Audio.effets.chute(clamp(hauteur/14, 0.3, 1));
        blesser((hauteur - SETUP.relief.degatChute) * SETUP.sante.degatsChute);
        if(sante.mort) mourir(CHUTE.MORT_HAUTEUR);
      }
    },
  });
  // le vent emporte l'odeur, la neige l'efface — un seul appel par image
  decroitreTraces(dt, jeu.ventX, jeu.ventZ, 1 + visuel.neige*2.6*vent.freq);

  if(verifierVide() === CHUTE.MORT_VIDE){ mourir(CHUTE.MORT_VIDE); return; }

  // sortie d'une cachette si on s'en éloigne (déplacement forcé, secousse…)
  if(joueur.abrite && !dansCachette(joueur.cachette, joueur.x, joueur.z)){
    joueur.abrite = false; joueur.cachette = null; Audio.murer(false);
  }

  updateTorche(dt, joueur, !!brasero) && Audio.effets.ramasse();
  ramasserLeurres(joueur) && Audio.effets.ramasse();
  updateVol(dt, {
    impact: (x,y,z) => {
      emettreSon(x, z, 30, true);
      Audio.effets.impact();
      // les jeunes aussi vont l'étudier : c'était « impossibles à leurrer »
      attirerJeunes(x, z);
    },
  });

  const prise = ramasser(joueur.x, joueur.gy, joueur.z);
  if(prise){ ajouter(prise.id); majAffichage(); Audio.effets.carte(prise.rang); }

  /* ── IA ── */
  directeur.update(dt, joueur, creature);
  const dP = updateCreature(dt, joueur, sons, odeur, jeu.temps);
  const J = updateJeunes(dt, joueur, jeu.temps, sons);

  if((jeu.temps*3|0) !== compteurPop){ compteurPop = (jeu.temps*3|0); majPopulation(joueur); }

  /* ── biome ── */
  const nb = biomeAt(joueur.x, joueur.z);
  if(nb !== jeu.biome){
    jeu.biome = nb; visuel.biome = nb;
    Audio.changerNappe(NAPPE_DE_BIOME[nb]);
    Audio.reglerReverb(BIOMES[nb].reverb);
  }

  /* ── ambiance de caverne ── */
  const exiguite = clamp(1 - degagement(joueur.x, joueur.z)/6, 0, 1);
  const humide = (nb === 0 || nb === 2) ? 1 : nb === 1 ? 0.35 : 0.1;
  Audio.majCavernes(dt, exiguite, humide, joueur.abrite);
  Audio.majEffondrements(dt, declencherEffondrement);
  jeu.secousseEvt = Math.max(0, jeu.secousseEvt - dt/SETUP.audio.effondrement.duree);

  /* ── tremblement et chute sismique ── */
  majTremblement(dt, joueur, creature, jeunes, jeu.secousseEvt);
  if(tirerChuteSismique(dt) === CHUTE.SISMIQUE){
    Audio.effets.chute(0.8);
    flash('TU AS PERDU L\'ÉQUILIBRE');
  }

  /* ── mort et blessures ── */
  // LA MÈRE tue. Toujours, quoi qu'il reste de santé. Elle n'est pas un
  // adversaire, elle est une fin — lui opposer une barre de vie la banaliserait.
  if(dP < 1.15 && !joueur.abrite && !safe) mourir('creature');
  // les jeunes MORDENT. On peut survivre, saigner, et fuir vers un village.
  if(J.mort && !joueur.abrite && !safe){
    if(blesser(SETUP.sante.degatsJeune)){
      Audio.effets.morsure();
      joueur.shake = Math.max(joueur.shake, 0.7);
    }
    if(sante.mort) mourir('jeunes');
  }

  /* ── victoire ── */
  if(atteinte(joueur)) jeu.gagne = true;
}

function majAudioSpatial(dt, dP){
  if(!Audio.pret()) return;
  // position de la créature dans le repère de l'auditeur (il regarde vers −Z)
  const cy = Math.cos(joueur.yaw), sy = Math.sin(joueur.yaw);
  const dx = creature.x - joueur.x, dz = creature.z - joueur.z;
  const lx = dx*cy - dz*sy, f = dx*-sy + dz*-cy;
  Audio.creature(lx, creature.y - (joueur.gy + joueur.eye), -f, dP,
                 creature.state === ST.CHASE, dt);
  Audio.menace(dP, creature.state === ST.CHASE);

  let pj = null, dj = 1e9;
  for(const j of jeunes) if(j.proche < dj){ dj = j.proche; pj = j; }
  if(pj){
    const jx = pj.x - joueur.x, jz = pj.z - joueur.z;
    Audio.jeunes(jx*cy - jz*sy, pj.y - (joueur.gy + joueur.eye), -(jx*-sy + jz*-cy), dj);
  } else Audio.jeunes(0, 0, -30, 999);
}

function dessinerImage(dt, dP){
  /* Les lumières que le joueur a créées lui-même : feux, fusées, loupiotes.
     Reconstruites à chaque image parce qu'elles bougent, s'éteignent et
     clignotent — les cuire dans un pavé n'aurait aucun sens. */
  lumieresDynamiques.length = 0;
  lumieresDuFeu(lumieresDynamiques, jeu.temps);
  lumieresPancartes(lumieresDynamiques, jeu.temps);

  /* La carte non ramassée la plus proche éclaire vraiment. Une seule : c'est
     assez pour qu'on la repère dans la brume, et ça ne vole pas tous les
     emplacements de lumière au décor. */
  {
    let pc = null, pd = 1600;
    for(const k of cartes){
      if(k.prise) continue;
      const d = (k.x-joueur.x)**2 + (k.z-joueur.z)**2;
      if(d < pd){ pd = d; pc = k; }
    }
    if(pc){
      const c = RANGS[pc.rang].couleur;
      const p = 0.8 + 0.2*Math.sin(jeu.temps*2.4 + pc.id*1.7);
      lumieresDynamiques.push({x:pc.x, y:pc.y+0.3, z:pc.z,
                               c:[c[0]*2.2*p, c[1]*2.2*p, c[2]*2.2*p]});
    }
  }

  const P = SETUP.froid.paliers[froid.palier];
  construireVue(joueur, jeu.temps, tampon.w/tampon.h, P.vision, joueur.derive);

  const gainLampe = (torche.on ? 1 : 0.07)
    * (0.45 + 0.55*Math.min(1, (froid.chaleur/100)*2.4))
    * (joueur.abrite ? 0.35 : 1);

  rendre({
    joueur, jeunes, temps: jeu.temps, dread: jeu.dread,
    vision: P.vision, froidVis: intensiteVisuelle(),
    // le battement de cœur suit maintenant la SANTÉ autant que le froid
    coeur: Math.max(froid.palier === 3 ? 1 - froid.chaleur/15 : 0,
                    gravite() > 0.6 ? (gravite()-0.6)/0.4 : 0),
    gainLampe, cartes, combustibles, leurres,
    meshCarte: jeu.meshCarte, ventX: jeu.ventX, rangs: RANGS,
    cielOuvert: jeu.cielOuvert,
    monde: {bois, fusees, trousses, feux, fuseesActives, pancartes},
  });
  dessinerScope(joueur, sons, odeur, dP);
}

/* ─────────────── démarrage ─────────────── */

async function demarrer(){
  jeu.meshCarte = boite(-0.5, 0.5);
  creerCreature();
  resize();

  chargerCollection();
  sonderStacks(() => majAffichage());
  majAffichage();

  brancherCri(() => { Audio.cri(); Audio.accroc(); });
  brancherStridulation(() => Audio.stridulation());
  /* Les jeunes n'ont pas à connaître la torche ni les feux : on leur donne une
     fonction qui répond « y a-t-il du feu près de toi ? ». */
  brancherFeu(j => feuProche(j.x, j.z, joueur, torche.on));

  construireMenu(() => {
    // pendant la génération il n'y a rien à verrouiller
    if(!jeu.pret){ messageMenu('LE MONDE SE CREUSE ENCORE…'); return; }

    /* requestPointerLock peut ÉCHOUER sans que ce soit une erreur : le
       navigateur impose un délai après un exitPointerLock, et rejette la
       demande pendant ce temps. Non traité, ça produit une promesse rejetée
       dans la console et un menu qui a l'air cassé. On le dit à l'écran. */
    try {
      const p = cv.requestPointerLock();
      if(p && typeof p.catch === 'function')
        p.catch(() => messageMenu('ENCORE UN CLIC — LE NAVIGATEUR A REFUSÉ'));
    } catch(e){
      messageMenu('ENCORE UN CLIC — LE NAVIGATEUR A REFUSÉ');
    }

    Audio.demarrer(NAPPE_DE_BIOME[jeu.biome]);
    Audio.reprendre();
  });
  brancherEntrees();

  await genererMonde(undefined);

  /* ═══ CONSOLE DE MISE AU POINT ═══
     Ouvrir index.html?debug expose window.SCOLO dans la console du navigateur.
     Sert à régler une valeur à chaud sans recharger :

         SCOLO.SETUP.creature.yeux.poursuite.taille = 3
         SCOLO.SETUP.froid.base[0] = 5        // pour voir les paliers défiler
         SCOLO.rapport()                      // compte-rendu du monde
         SCOLO.regenerer()                    // nouveau monde

     C'est aussi ce que pilote outils/smoke.py. Rien n'est exposé sans le
     paramètre : une partie normale n'a pas de porte dérobée. */
  if(location.search.includes('debug')){
    window.SCOLO = {
      SETUP, jeu, joueur, creature, jeunes, froid, directeur, monde, cachettes,
      Grille,
      rapport: rapportMonde,
      regenerer: g => genererMonde(g),
      effondrement: declencherEffondrement,
    };
    console.log('SCOLO exposé (mode debug)');
  }

  requestAnimationFrame(frame);
}

demarrer();
