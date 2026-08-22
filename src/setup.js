/* ══════════════════════════════════════════════════════════════════════════
   SETUP — SOURCE UNIQUE DE TOUTES LES VALEURS RÉGLABLES
   ──────────────────────────────────────────────────────────────────────────
   RÈGLE ABSOLUE DU PROJET : aucun autre fichier n'écrit un nombre réglable en
   dur. Si une valeur peut avoir envie de changer un jour, elle vit ICI.

   Trois choses dans ce fichier :

     1. SETUP        l'arbre des valeurs. C'est ce que tu modifies.
     2. CURSEURS     la liste des réglages exposés en jeu (panneau RÉGLAGES).
                     Ajouter une ligne ici = un curseur apparaît tout seul.
     3. abonner()    pour qu'un module réagisse quand une valeur bouge.

   Lire un réglage depuis un module :
       import {SETUP} from '../setup.js';
       const v = SETUP.image.fog;

   Réagir à un changement :
       import {abonner} from '../setup.js';
       abonner('image.res', () => resize());
   ══════════════════════════════════════════════════════════════════════════ */

export const SETUP = {

  /* ─────────────── MONDE : dimensions et granularité ─────────────── */
  monde:{
    cellule:1.5,         // côté d'une cellule en mètres (3.0 en v2)
    largeur:1088,        // cellules en X  → 1088 × 1.5 = 1632 m
    hauteur:1088,        // cellules en Z
    pave:32,             // côté d'un pavé de maillage, en cellules (48 m)

    // Amplitude verticale. ×3 par rapport à la v2 qui allait de −42 à +44.
    altBasse:-126,
    altHaute:132,

    nbSalles:300,
    nbCavernes:90,
    nbRaccourcis:140,

    // Plafonds : plus bas qu'en v2 (2.8 + openN*3.2) → souterrain exigu.
    plafondBase:1.9,
    plafondOuvert:2.1,
    plafondCiel:26,
    plafondRampe:1.30,   // en dessous, il faut ramper

    bordVide:14,         // cellules de vide tout autour de la planche
    marcheJoueur:1.25,   // STEPUP — ce que le joueur enjambe
    corniche:1.1,        // LEDGE — au-delà, l'arête reste franche
  },

  /* ─────────────── RELIEF : falaises, gouffres, ponts ─────────────── */
  relief:{
    // La relaxation n'agit QUE le long de l'épine navigable, plus cette marge.
    // Hors épine, le dénivelé brut survit : c'est ça, les falaises.
    epineMarge:6,        // cellules de part et d'autre du chemin garanti
    relaxPasses:8,       // passes de la file d'attente (elle converge vite)
    falaiseMin:2.2,      // dénivelé à partir duquel on parle de falaise

    // Toutes ces dimensions sont en MÈTRES ; relief.js les convertit en
    // cellules. Mesurés en jeu, les premiers réglages donnaient des crevasses
    // de 17 × 7 m — on ne les lisait pas comme des gouffres.
    nbGouffres:42,       // fosses sans fond creusées à l'intérieur
    gouffreLongMin:20,
    gouffreLongMax:64,
    gouffreLargMin:9,
    gouffreLargMax:28,

    nbPonts:260,
    pontLongMin:14,
    pontLongMax:46,
    pontTirantAir:3.6,   // dégagement sous le tablier

    mortChute:14,        // mètres de chute au-delà desquels on meurt
    degatChute:6,        // mètres au-delà desquels on est sonné
    fondDuVide:60,       // profondeur sous le sol le plus bas = mort
  },

  /* ─────────────── CACHETTES ─────────────── */
  cachettes:{
    nombre:16,
    ecartMin:140,        // mètres entre deux cachettes
    porteeMarqueur:30,   // distance à laquelle le sismographe la révèle
    filtreSon:520,       // Hz — passe-bas appliqué au monde extérieur
    // le gain de chaleur à l'abri vit dans SETUP.froid.gainCachette :
    // une seule valeur, lue par le seul module qui applique la règle du froid.
  },

  /* ─────────────── IMAGE ─────────────── */
  image:{
    // 75 % du maximum du curseur, comme demandé. Épais et oppressant.
    fog:2.625,   fogMax:3.5,
    rays:2.25,   raysMax:3.0,
    grain:0.115,
    res:360,             // hauteur du tampon interne, en pixels
    detail:1.0,          // multiplicateur de polycount du décor
    fov:1.30,
  },

  /* ─────────────── CAMÉRA : tremblement sismique ─────────────── */
  camera:{
    tremblementOeil:0.122,   // ×3.5 par rapport à la v2 (0.035)
    tremblementLacet:0.042,  // ×3.5 (0.012)
    tremblementRoulis:0.075, // NOUVEAU — c'est le roulis qui fait « séisme »
    porteeTremblement:34,    // mètres : au-delà, on ne sent plus rien
    poidsVitesse:0.6,        // part du tremblement due à SA vitesse réelle
    decroissance:2.2,        // amortissement par seconde
  },

  /* ─────────────── JOUEUR ─────────────── */
  joueur:{
    vitesseMarche:3.2,
    vitesseCourse:5.6,
    vitesseRampe:1.5,
    hauteurOeil:1.62,
    hauteurRampe:1.02,
    rayon:0.30,
    gravite:24,

    // Chute provoquée par les secousses
    seuilChute:0.55,     // au-delà de ce tremblement, on peut tomber
    tauxChute:0.8,       // chutes par seconde à tremblement maximal
    dureeProne:1.4,      // secondes au sol
    bruitChute:22,       // rayon de la vibration émise en tombant
  },

  /* ─────────────── FROID — la règle, tenue partout ───────────────
     chaleur ∈ [0,100], départ 100.
     perte/s = base(biome) × exposition × mouvement × torche × géothermie   */
  froid:{
    depart:100,

    // base par biome, dans l'ordre exact de la table BIOMES
    base:[0.35, 1.6, 0.50, 2.2, 0.60],
    //   souterrain glacière barrage surface ville

    exposVent:1.4,       // exposition = 1 + exposVent × force_du_vent
    exposPlafondBas:0.5, // sous un plafond bas, on est abrité
    exposCachette:0.0,   // à l'abri, aucune perte

    mvtMarche:0.85, mvtCourse:0.70, mvtImmobile:1.25, mvtRampe:1.10,
    torcheAllumee:0.55, torcheEteinte:1.0,

    // Géothermie : descendre réchauffe. C'est ce qui pousse vers les cartes
    // rares du fond au lieu de l'en éloigner.
    geoParMetre:0.004,   // −0,4 % de perte par mètre sous 0 m
    geoPlancher:0.35,    // la perte ne descend jamais sous 35 % de la base

    gainBrasero:14,
    gainCachette:3.5,

    // Les quatre paliers. Franchir un seuil affiche un message.
    paliers:[
      {min:70, nom:'—',           vitesse:1.00, vision:1.00, souffle:0, derive:0},
      {min:40, nom:'ENGOURDI',    vitesse:0.88, vision:1.00, souffle:4, derive:0},
      {min:15, nom:'GELÉ',        vitesse:0.65, vision:0.82, souffle:6, derive:0.35},
      {min:0,  nom:'HYPOTHERMIE', vitesse:0.45, vision:0.68, souffle:8, derive:0.80},
    ],
    delaiMort:20,        // secondes à zéro avant de mourir
  },

  /* ─────────────── TORCHE ─────────────── */
  torche:{
    conso:0.0125,        // fraction par seconde
    recharge:0.34,       // par combustible ramassé
    rechargeBrasero:0.22,
    nbCombustibles:260,
  },

  /* ─────────────── TRACES ET PERCEPTION ─────────────── */
  traces:{
    persistanceOdeur:22, // secondes
    porteeVibrations:1,  // multiplicateur
    endurancePiste:10,   // secondes avant qu'elle perde le fil
    reposPiste:18,       // secondes avant de pouvoir reprendre une piste
    pasMarche:6, pasCourse:11, pasRampe:1.2,   // rayons de vibration
  },

  /* ─────────────── CRÉATURE MÈRE ─────────────── */
  creature:{
    vitesseTraque:5.3,
    aversionOuvert:1.1,
    monteePression:0.04,
    escalade:2.9,        // CLIMB — ce qu'elle franchit, bien au-delà de toi
    chuteMax:14,         // DROPMAX
    segments:64,         // C_SEG   (46 en v2)
    anneaux:22,          // C_RING  (16 en v2)
    paires:21,           // paires de pattes
    maxSommets:90000,    // C_MAXV  (40000 en v2)
    budgetAStar:40000,   // grille 4× plus dense → budget relevé

    // Grammaire des yeux : c'est un signal de jeu, donc une règle constante.
    yeux:{
      traque:    {c:[0.45,0.03,0.02], taille:1.00, pulse:0.6},
      ecoute:    {c:[0.60,0.05,0.03], taille:1.00, pulse:0.0},
      approche:  {c:[1.40,0.10,0.05], taille:1.30, pulse:1.4},
      poursuite: {c:[3.00,0.90,0.35], taille:2.20, pulse:5.0},
      transition:0.4,    // secondes de fondu entre deux états
      portee:120,        // mètres — ils éclairent le fog de très loin
    },
    pattes:{emission:0.9, ondulation:1.0},
    interstices:{emissionRepos:1.2, emissionChasse:0.05, periode:3.4},
  },

  /* ─────────────── JEUNES ─────────────── */
  jeunes:{
    maxParProfondeur:9,
    vitesseErrance:1.7,
    vitesseCharge:4.2,
    porteeCharge:13,
    budgetAStar:2000,
    repath:0.8,
    // Détecteur de blocage — c'était le bug : ils restaient plantés dans un mur
    seuilBlocage:0.3,    // mètres parcourus
    fenetreBlocage:1.2,  // sur cette durée
    delaiTeleport:2.5,   // s'ils restent coincés, on les replace hors de vue
    echelleMin:0.30, echelleMax:0.52,
    yeux:{c:[0.9,0.35,0.05], taille:0.5},
  },

  /* ─────────────── AUDIO ─────────────── */
  audio:{
    volume:90,           // 82 en v2 — la nappe était trop faible
    // gainMaitre = (v/100)^courbe × facteur
    courbeVolume:1.20,   // 1.55 en v2 : écrasait le bas du curseur
    facteurVolume:1.60,  // 1.05 en v2

    // Le limiteur écrasait la nappe. Desserré.
    limiteurSeuil:-8,    // −12 en v2
    limiteurRatio:6,     // 12 en v2
    limiteurKnee:10,

    gainNote:0.52,       // 0.30 en v2
    gainPedale:0.34,     // 0.26 en v2

    // Progression harmonique : le cœur du « plus mélodieux ».
    accordDuree:[25,50], // secondes, tiré entre les deux
    accordFondu:8,

    reverbCourte:3.5,    // boyau exigu
    reverbLongue:16,     // grande salle

    // Portée de la créature — très augmentée
    creatureDistanceMax:110,   // 40 en v2
    creatureRolloff:0.75,      // 1.1 en v2
    creaturePorteeMenace:95,   // 34 en v2
    creaturePorteeInfra:150,   // NOUVEAU : on la sent avant de l'entendre
    jeunesPortee:55,           // 22 en v2

    vent:{gain:0.55, dureeRafale:[4,12], ecartRafale:[9,34]},
    gouttes:{tauxMin:0.15, tauxMax:1.4, portee:26},
    effondrement:{intervalle:[60,180], portee:60, secousse:0.8, duree:3},
  },

  /* ─────────────── CARTES À COLLECTIONNER ───────────────
     Les CHEMINS des stacks sont dans src/carte/rangs.js — c'est le seul
     fichier à ouvrir pour brancher tes dossiers. Ici, seulement le dosage. */
  cartes:{
    nombreDansLeMonde:420,
    essaisPlacement:48000,
  },

  /* ─────────────── DÉCOR ─────────────── */
  decor:{
    semis:26000,
    ossuaires:260,
    maxLumieres:3200,
    nbLeurres:600,
    nbRefuges:3,
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   CURSEURS — le panneau RÉGLAGES se construit tout seul à partir d'ici.
   Ajouter une ligne suffit : le curseur apparaît, lit et écrit dans SETUP.
   ══════════════════════════════════════════════════════════════════════════ */
export const CURSEURS = [
  {groupe:'IMAGE'},
  // max lus dans SETUP : les défauts valent 75 % de ces maxima, et ils ne
  // peuvent donc pas se désynchroniser d'un curseur écrit à la main.
  {chemin:'image.fog',    nom:'Densité du fog',     min:0.4,max:SETUP.image.fogMax,  pas:0.05, fmt:v=>'×'+v.toFixed(2)},
  {chemin:'image.rays',   nom:'Godrays',            min:0,  max:SETUP.image.raysMax, pas:0.05, fmt:v=>'×'+v.toFixed(2)},
  {chemin:'image.grain',  nom:'Grain',              min:0,  max:0.3, pas:0.005,fmt:v=>v.toFixed(3)},
  {chemin:'image.res',    nom:'Résolution interne', min:140,max:900, pas:10,   fmt:v=>v.toFixed(0)+' p'},
  {chemin:'image.detail', nom:'Détail du décor',    min:0.5,max:2,   pas:0.1,  fmt:v=>'×'+v.toFixed(1)},

  {groupe:'CAMÉRA'},
  {chemin:'camera.tremblementOeil',  nom:'Secousse verticale',min:0,max:0.3,pas:0.005,fmt:v=>v.toFixed(3)},
  {chemin:'camera.tremblementRoulis',nom:'Roulis sismique',   min:0,max:0.2,pas:0.005,fmt:v=>v.toFixed(3)},

  {groupe:'TRACES'},
  {chemin:'traces.persistanceOdeur',nom:"Persistance de l'odeur",min:4,max:60,pas:1,   fmt:v=>v.toFixed(0)+' s'},
  {chemin:'traces.endurancePiste',  nom:'Endurance sur la piste',min:2,max:30,pas:0.5, fmt:v=>v.toFixed(1)+' s'},
  {chemin:'traces.porteeVibrations',nom:'Portée des vibrations', min:0.3,max:2.5,pas:0.05,fmt:v=>'×'+v.toFixed(2)},

  {groupe:'CRÉATURE'},
  {chemin:'creature.vitesseTraque', nom:'Vitesse de traque',   min:2,max:9,pas:0.1,fmt:v=>v.toFixed(1)+' m/s'},
  {chemin:'creature.aversionOuvert',nom:'Aversion aux espaces ouverts',min:0,max:3,pas:0.05,fmt:v=>v.toFixed(2)},
  {chemin:'creature.monteePression',nom:'Montée de la pression',min:0.01,max:0.2,pas:0.005,fmt:v=>v.toFixed(3)},

  {groupe:'AUDIO'},
  {chemin:'audio.volume',    nom:'Volume', min:0,max:100,pas:1,   fmt:v=>v.toFixed(0)},
  {chemin:'audio.vent.gain', nom:'Vent',   min:0,max:1.5,pas:0.05,fmt:v=>'×'+v.toFixed(2)},
  {chemin:'audio.creaturePorteeMenace',nom:'Portée de la menace',min:20,max:160,pas:5,fmt:v=>v.toFixed(0)+' m'},
];

/* ══════════════════════════════════════════════════════════════════════════
   Accès par chemin + abonnements. C'est le mécanisme qui garde les modules
   synchronisés : personne ne recopie une valeur, tout le monde la lit, et
   ceux qui doivent reconstruire quelque chose s'abonnent.
   ══════════════════════════════════════════════════════════════════════════ */
const abonnes = new Map();

export function lire(chemin){
  return chemin.split('.').reduce((o,k)=>(o==null?o:o[k]), SETUP);
}

export function ecrire(chemin, valeur){
  const parties = chemin.split('.');
  const cle = parties.pop();
  const cible = parties.reduce((o,k)=>o[k], SETUP);
  if(cible[cle] === valeur) return;
  cible[cle] = valeur;
  // on prévient l'abonné exact, puis tous les abonnés d'un préfixe parent
  for(const [motif, liste] of abonnes)
    if(chemin === motif || chemin.startsWith(motif+'.'))
      for(const fn of liste){ try{ fn(valeur, chemin); }catch(e){ console.error(e); } }
}

export function abonner(chemin, fn){
  if(!abonnes.has(chemin)) abonnes.set(chemin, []);
  abonnes.get(chemin).push(fn);
  return () => {
    const l = abonnes.get(chemin);
    const i = l.indexOf(fn); if(i>=0) l.splice(i,1);
  };
}

/* Raccourcis dérivés — pour ne pas recopier la même formule dans six modules.
   Ce sont des getters : si la granularité change, ils suivent. */
export const DERIVE = {
  get largeurMonde(){ return SETUP.monde.largeur * SETUP.monde.cellule; },
  get hauteurMonde(){ return SETUP.monde.hauteur * SETUP.monde.cellule; },
  get nbCellules(){ return SETUP.monde.largeur * SETUP.monde.hauteur; },
  get pavesX(){ return Math.ceil(SETUP.monde.largeur / SETUP.monde.pave); },
  get pavesZ(){ return Math.ceil(SETUP.monde.hauteur / SETUP.monde.pave); },
  get paveMetres(){ return SETUP.monde.pave * SETUP.monde.cellule; },
};
