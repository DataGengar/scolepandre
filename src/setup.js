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
    /* ─── IRRÉGULARITÉ DU RELIEF ───
        « Pourquoi tout est cubique ? » Parce que chaque coin de cellule était
        posé exactement sur la ligne de grille : l'œil lit la trame avant de
        lire la forme. Chaque coin est maintenant déplacé d'un bruit stable —
        stable au sens où il ne dépend que du coin, donc les cellules voisines
        s'accordent et rien ne se décolle.

        Exprimé en fraction de cellule. 0 rend la grille parfaite d'avant ;
        au-delà de 0,15 les parois s'écartent trop de la grille de collision
        et l'on frotte le décor sans comprendre pourquoi. */
    irregularite:0.11,
    cellule:1.5,         // côté d'une cellule en mètres (3.0 en v2)
    largeur:1088,        // cellules en X  → 1088 × 1.5 = 1632 m
    hauteur:1088,        // cellules en Z
    pave:32,             // côté d'un pavé de maillage, en cellules (48 m)

    // Amplitude verticale. ×3 par rapport à la v2 qui allait de −42 à +44.
    altBasse:-126,
    altHaute:104,

    /* Les LIEUX repérés dans le champ (v5 : plus des salles POSÉES, mais les
       grandes cavités du bruit, chaînées par altitude — voir monde/
       generation.js). `nbSalles` en est le plafond, `nbRaccourcis` le nombre
       de galeries en plus de la chaîne, pour que le monde soit un réseau. */
    nbSalles:300,
    nbRaccourcis:140,

    // Plafonds : plus bas qu'en v2 (2.8 + openN*3.2) → souterrain exigu.
    plafondBase:1.9,
    plafondOuvert:2.1,
    plafondCiel:26,
    plafondRampe:1.30,   // en dessous, il faut ramper

    /* ─── QUANTIFICATION DU RELIEF ───
        Arrondit toutes les altitudes à ce pas, en mètres. 0 = désactivé.

        Ce n'est pas qu'une optimisation : ça change le LOOK. Le sol devient une
        succession de plateaux, comme des strates de roche, au lieu d'une pente
        continue. Le greedy meshing y gagne énormément — un sol plan fusionne,
        un sol bruité non — et le rendu bas de gamme du jeu s'y prête.

        Le pas doit rester très inférieur à la marche du joueur (1,25 m) pour
        qu'aucune strate ne devienne infranchissable. */
    quantifierRelief:0.25,

    bordVide:14,         // cellules de vide tout autour de la planche
    marcheJoueur:1.25,   // STEPUP — ce que le joueur enjambe
    corniche:1.1,        // LEDGE — au-delà, l'arête reste franche
  },

  /* ═══════════════ TERRAIN : LES CHAMPS QUI FONT LE MONDE ═══════════════
      v5. Le terrain n'est plus creusé (des rectangles et des couloirs en L)
      mais ÉCHANTILLONNÉ : deux champs continus, l'un pour l'altitude du sol,
      l'autre pour savoir s'il y a du creux ou du plein. Voir l'en-tête de
      monde/generation.js — ces valeurs n'ont de sens qu'avec lui sous les
      yeux.

      LES DEUX RÉGLAGES QUI CHANGENT VRAIMENT LE MONDE :
        · seuilGalerie  — combien de roche est creusée. Monter = un monde
          plus plein, des boyaux plus rares. Descendre = des cavernes partout.
        · amplitudeRelief — à quel point ça monte et descend DANS une strate.
          Trop haut, la strate se mélange à ses voisines et la stratigraphie
          ne se lit plus.                                                    */
  terrain:{
    // Un nœud tous les N cellules pour les champs lents, puis interpolation.
    pasEchantillon:4,

    /* ─── LE PLI ─── le domaine lui-même est déformé avant toute évaluation.
        C'est le seul procédé qui, à si peu de frais, transforme des bandes en
        couches géologiques. L'amplitude est en CELLULES. */
    echellePli:340,
    amplitudePli:34,    // cellules, écart-type (le bruit est calibré)

    /* ─── LE RELIEF ─── autour de la descente d'ensemble. */
    echelleRelief:200,   // cellules : taille des grandes formes
    amplitudeRelief:9,   // mètres d'écart-type : les crêtes montent au double
    octavesRelief:4,
    gainRelief:0.42,     // < 0,5 : le détail apporte moins de pente que le fond

    /* ─── LES FAILLES ─── les ressauts francs. Sans elles, un terrain de bruit
        est une houle : joli, et sans un seul à-pic. */
    echelleFaille:380,   // cellules : grand = des escarpements rares et longs
    seuilFaille:0.60,    // sur le bruit de crête, dans [0,1] : 37 % du monde surélevé
    largeurFaille:0.004, // demi-largeur de la bande : étroite = un à-pic, large = une pente
    hauteurFaille:10,    // mètres de dénivelé au franchissement

    /* ─── LE DÉTAIL ─── ce que le joueur a sous les pieds et sous les yeux.
        Le relief d'ensemble ne se voit pas à quinze mètres de portée : c'est
        CE bruit-ci qui fait la différence entre une caverne et un gymnase. */
    echelleDetail:9,     // cellules (13 m) pour la première octave
    amplitudeDetail:0.45,// mètres d'écart-type : au-delà, chaque pas est une marche
    echelleRugosite:5,   // cellules : la dentelle des parois
    rugositeRoche:0.035, // décalage (écart-type) appliqué aux deux seuils de creux

    /* ─── LA ROCHE ─── galeries (crêtes) et cavités (taches). */
    echelleGalerie:44,   // cellules : écartement du réseau
    seuilGalerie:0.80,   // ~7 % de la planche : plus haut = galeries plus rares
    echelleSalle:110,    // cellules
    seuilSalle:1.75,     // en écarts-type : ~4 % de la planche en grandes cavités

    /* ─── LES LIEUX ─── repérage des grandes cavités. */
    pasLieux:6,          // cellules : maille du comptage de densité
    densiteLieu:0.55,    // part de creux autour, au-delà de laquelle c'est un lieu
    ecartLieux:34,       // cellules : deux lieux ne se touchent pas

    /* ─── LES GALERIES DE LIAISON ─── */
    largeurGalerie:2.2,  // rayon en cellules
    sinuosite:0.12,      // écart latéral typique, en fraction de la longueur
    sinuositeMax:26,     // cellules : au-delà, la galerie part faire du tourisme
    echelleSinus:26,     // cellules : longueur d'onde des méandres
    deniveleRaccourci:26,// mètres : au-delà, pas de raccourci entre deux lieux
    pocheMin:400,        // cellules : en dessous, une poche isolée est rebouchée
    /* Relaxer TOUT le creux souterrain, et pas seulement l'épine. Sous terre
       on ne contourne pas : un boyau coupé par une marche est un cul-de-sac.
       À ciel ouvert, au contraire, le relief brut survit — voir
       monde/generation.js. */
    relaxerSouterrain:true,
    /* Et le dehors ? Voir monde/README.md : à ciel ouvert on contourne, donc
       le relief brut y survivait. Mesuré : il s'y coupait quand même en
       terrasses infranchissables. */
    relaxerDehors:false,
    /* Largeur, en cellules, de l'ourlet de surface relaxé le long de la
       lisière du souterrain. C'est ce qui empêche le dehors de se décrocher du
       monde quand on ne le relaxe pas. */
    ourletDehors:22,
    largeurLiaison:1,    // rayon en cellules du percement vers une poche

    /* ─── LE PLAFOND ─── il ondule, sinon le souterrain est un caisson. */
    echellePlafond:11,   // cellules
    reliefPlafond:0.22,  // fraction de hauteur, en écart-type
    plafondMin:1.1,      // mètres : jamais moins, on doit pouvoir ramper
  },

  /* ─────────────── RELIEF : falaises, gouffres, ponts ─────────────── */
  relief:{
    // La relaxation n'agit QUE le long de l'épine navigable, plus cette marge.
    // Hors épine, le dénivelé brut survit : c'est ça, les falaises.
    epineMarge:6,        // cellules de part et d'autre du chemin garanti
    falaiseMin:2.2,      // dénivelé à partir duquel on parle de falaise

    // Toutes ces dimensions sont en MÈTRES ; relief.js les convertit en
    // cellules. Mesurés en jeu, les premiers réglages donnaient des crevasses
    // de 17 × 7 m — on ne les lisait pas comme des gouffres.
    nbGouffres:42,       // fosses sans fond creusées à l'intérieur
    gouffreLongMin:20,
    gouffreLongMax:64,
    gouffreLargMin:9,
    gouffreLargMax:28,

    /* ─── RAMPES D'ÉBOULIS ───
        Elles ne sont plus tirées au hasard : monde/connexite.js calcule les
        morceaux du monde qui sont réellement COUPÉS les uns des autres, et ne
        pose une rampe qu'à la frontière la moins chère entre deux d'entre eux.
        D'où un nombre bien plus faible qu'en v3.1 — et chacune sert. */
    /* ─── GALERIES DE PERÇAGE ───
        Les rampes ne franchissent qu'un dénivelé. Ce qui restait isolé l'était
        surtout par de la ROCHE — 60 % des frontières de poche, mesuré par
        outils/diag_passage.py. monde/connexite.js perce donc une fissure
        jusqu'aux poches qui en valent la peine. */
    enclaveTailleMin:110,  // cellules : en dessous, une alcôve, on laisse
    nbGaleries:70,         // borne haute : au-delà le monde devient un gruyère

    nbRampes:120,
    rampeChuteMax:11,      // au-delà, un escalier n'est plus plausible
    rampePasses:4,         // on recommence tant que ça relie encore
    rampeTailleMin:260,    // cellules : en dessous, c'est une miette

    /* ─── PASSERELLES ───
        Refaites en v4. Un tablier part du sol et y revient : plus de dalle
        flottant à 3,6 m au-dessus des deux rives, plus d'échelle invisible,
        plus de semis au hasard. Un pont franchit un gouffre, ou n'existe pas.
        Il n'y a donc plus de « nombre de ponts » à régler : c'est le nombre de
        gouffres franchissables qui le décide. */
    pontPorteeMax:70,    // mètres : au-delà, aucune passerelle n'est crédible
    pontDeniveleMax:5.0, // écart d'altitude toléré entre les deux rives
    pontFlecheMax:1.8,   // creux au milieu — au-delà on plonge dans le trou
    pontTeteMin:2.4,     // dégagement au-dessus du tablier, pour la tête
    pontLargeur:2,       // cellules : 3 m. Une passerelle, pas une corde raide
    pontEssais:14,       // décalages tentés le long de chaque gouffre

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

  /* ─────────────── IMAGE ───────────────
     La v3.0 mettait fog et godrays à 75 % du maximum, littéralement. Mesuré
     ensuite : à 10 m on ne voyait plus que 2 % d'un objet dans la glacière,
     16 % dans le souterrain. Ce n'était pas oppressant, c'était noir.
     Ramené à un niveau où l'on distingue le relief à 20 m et où la brume
     avale à 35 m. Les curseurs restent là pour durcir si tu veux.          */
  image:{
    /* v3.1 avait sur-corrigé : on voyait à 40 m, ce qui vide la brume de tout
       son intérêt. Densité doublée — la portée est donc divisée par deux,
       ~20 m au lieu de ~40. Et les godrays étaient trop appuyés : ils
       écrasaient le reste de l'image dès qu'une source entrait dans le champ. */
    /* ─── PORTÉE ───
        « Toujours un peu trop lumineux, pas assez de fog, vision trop
        lointaine : réduire de 40 %. » 2.10 → 3.50, soit un facteur 1,67 sur la
        densité, ce qui divise la portée utile par 1,67. Mesuré :

            souterrain  12,4 m → 7,4 m       barrage   17,2 m → 10,3 m
            surface     13,4 m → 8,0 m       ville     12,4 m → 7,4 m

        C'est la portée d'une lampe de poche dans une cave, et c'est le but. */
    fog:3.50,    fogMax:5.0,
    rays:0.55,   raysMax:3.0,

    /* ─── C'EST LA TORCHE QUI ÉCLAIRE ───
        Référence donnée par Orlando : Resident Evil Requiem, où presque toute
        la lumière vient de la lampe qu'on tient. Tout le reste n'est qu'une
        présence — assez pour deviner une masse, jamais assez pour lire une
        pièce.

        L'ambiante tombe donc de 0,92 à 0,45. Ce qui rend la scène lisible,
        c'est le faisceau : là où il pointe on voit net, ailleurs on devine.
        C'est ce qui force à BALAYER une pièce au lieu de l'embrasser, et
        balayer une pièce, c'est se demander ce qu'il y a derrière soi. */
    ambiance:0.45,       // multiplicateur global de la lumière ambiante
    vignette:0.55,       // 0.92 en v3.0 : les bords de l'écran étaient noirs
    grain:0.115,

    /* ─── DÉSATURATION ───
        « Trop de couleurs pétantes. » Les teintes de biome et les lampes ont
        été ramenées vers le gris à la source (voir monde/biomes.js), et une
        dernière passe vide ce qu'il reste. À 0 le monde est criard, à 1 il est
        en noir et blanc ; 0.45 laisse juste ce qu'il faut pour reconnaître un
        endroit sans le trouver joli. */
    desaturation:0.45,
    res:360,             // hauteur du tampon interne, en pixels
    detail:1.0,          // multiplicateur de polycount du décor
    fov:1.30,
  },

  /* ─────────────── LAMPE DE POCHE ───────────────
     La v3.0 avait « une torche » : un cône mou en pow(cos,3) qui s'éteignait
     en exp(-d*0.085), soit 18 % à 20 m. On n'éclairait rien.
     Ici c'est une vraie lampe de poche : un cœur net, un bord franc, une
     nappe faible autour, et une portée de plusieurs dizaines de mètres.     */
  lampe:{
    coneInterieur:0.955,  // cos de l'angle du cœur    (~17°)
    coneExterieur:0.74,   // cos de l'angle du bord    (~42°)
    intensite:6.8,        // le faisceau — c'est LUI qui éclaire la scène
    halo:0.16,            // ce qui déborde autour, très faible
    portee:0.028,         // atténuation par mètre : exp(-d × portee)
    /* Lampe éteinte, il ne reste presque rien : c'est le prix à payer pour
       que l'allumer ait un sens, et pour que l'éteindre soit une décision. */
    gainEteinte:0.03,
  },

  /* ─────────────── LUMIÈRES DU DÉCOR ───────────────
     Cristaux, fenêtres, braseros, lèvres de gouffre. En v3.0 leur atténuation
     1/(1+0.22d+0.16d²) les tuait à 5 m : elles ne servaient plus à rien.     */
  lumiereDecor:{
    attenLin:0.07,
    attenQuad:0.020,
    /* 2.2 en v3.3. Chaque cristal, chaque fenêtre, chaque braise éclairait
       comme un projecteur ; additionnées par milliers, elles noyaient le
       brouillard qui fait tout le travail. Une source de décor doit se VOIR
       de loin sans ÉCLAIRER de loin. */
    /* 2,2 en v3.3, 1,7 en v4.0, 1,05 ici. Chaque cristal et chaque fenêtre
       éclairait comme un projecteur ; additionnées par milliers, elles
       rendaient la lampe inutile — or c'est la lampe qui doit faire peur.
       Une source de décor se VOIT de loin, elle n'ÉCLAIRE plus de loin. */
    gain:1.05,
  },

  /* ─────────────── LUNE BRISÉE ───────────────
     Dehors seulement. Éclate en fragments dérivants, façon lune fracturée.
     Elle n'éclaire presque pas : c'est l'ambiante du biome qui porte la
     clarté, la lune donne la direction et le motif.                         */
  lune:{
    distance:260,
    rayon:26,
    fragments:11,
    couleur:[0.62,0.68,0.86],
    eclat:1.15,
    hauteur:0.42,        // hauteur dans le ciel, 0 = horizon, 1 = zénith
    azimut:2.3,
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
    /* De l'œil au sommet du crâne. Ce qui passe au-dessus ne nous concerne
       pas : c'est ce qui permet de marcher sous une poutre, et de ramper sous
       ce qu'on ne franchit pas debout. */
    margeTete:0.16,
    /* DÉBLOCAGE (touche R). Une cellule d'accueil doit offrir au moins
       `issuesMin` directions de sortie sur huit, sondées à `pasIssue` mètres —
       sinon on se contente de déplacer le joueur d'un piège à l'autre, ce qui
       est exactement le reproche qui a été fait à la v4. */
    issuesMin:5,
    pasIssue:0.9,
    gravite:24,

    /* ─── LE SAUT ───
       Le monde est devenu très vertical : sans saut, une corniche de 1,60 m
       oblige à contourner sur cinquante mètres. Mais L'ASYMÉTRIE VERTICALE EST
       UN PILIER DU JEU — elle grimpe 2,90 m, pas toi — et un saut trop haut la
       détruirait.

       Le calcul : apex = v² / (2g) = 6.8² / 48 = 0,96 m. Comme la collision
       compare la marche à l'altitude COURANTE, on peut donc se hisser jusqu'à
       0,96 + 1,25 = 2,21 m en sautant. Elle en franchit 2,90. La marge de
       0,7 m est ce qui garantit qu'il reste des endroits où elle va et pas toi. */
    forceSaut:6.8,
    bruitSaut:5,         // décoller n'est pas discret
    delaiSaut:0.22,      // anti-rebond : on ne mitraille pas la barre d'espace

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

    /* base par biome, dans l'ordre exact de la table BIOMES.
       v3.0 : [0.35, 1.6, 0.50, 2.2, 0.60] — sur la surface gelée on passait
       de 100 à 0 en 45 secondes, moins avec le vent. Impossible de trouver un
       brasero à temps, et il n'y en avait que trois sur 1 632 m.
       Divisé par ~4, et le nombre de sources de chaleur multiplié par 5. */
    base:[0.09, 0.30, 0.12, 0.42, 0.14],
    //   souterrain glacière barrage surface ville
    //   ~18 min     5,5 min  14 min  4 min   12 min

    exposVent:0.8,       // exposition = 1 + exposVent × force_du_vent (1.4 en v3.0)
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
    gainFeu:9,           // feu de camp allumé avec du bois ramassé

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
    conso:0.0085,        // fraction par seconde (0.0125 en v3.0)
    recharge:0.34,       // par combustible ramassé
    rechargeBrasero:0.22,
    nbCombustibles:900,  // 260 — même remise à l'échelle que le décor
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
    /* Ils meurent, la mère non. Deux coups de pied-de-biche, un tir. */
    pv:100,
    sonneSecondes:1.1,     // étourdissement après un coup non fatal

    maxParProfondeur:9,
    vitesseErrance:1.3,
    /* 4.2 en v3.0, contre 3.2 en marche pour le joueur : ils rattrapaient
       quelqu'un qui marche, et rien ne les détournait. Ils sont maintenant
       plus lents que la marche, s'essoufflent, et un leurre les fixe. */
    vitesseCharge:2.9,
    endurance:7,         // secondes de charge avant de renoncer
    repos:6,             // secondes avant de pouvoir recharger
    porteeLeurre:26,     // un leurre qui tombe les attire de loin
    fixationLeurre:7,    // secondes pendant lesquelles ils l'étudient
    peurDuFeu:9,         // mètres : ils fuient une torche brandie ou un feu
    porteeCharge:11,
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
    volume:82,
    /* gainMaitre = (v/100)^courbe × facteur.
       v3.0 : facteur 1.60 → un gain maître de 1.41 à volume 90, soit bien
       au-dessus de 1. Ça saturait en permanence, vent ou pas. Ramené sous 1,
       et un écrêteur doux (WaveShaper) est ajouté en bout de chaîne pour que
       les crêtes s'arrondissent au lieu de claquer. */
    courbeVolume:1.20,
    facteurVolume:0.82,
    ecreteurDoux:2.4,    // dureté de la courbe tanh de fin de chaîne

    limiteurSeuil:-10,
    limiteurRatio:8,
    limiteurKnee:12,

    gainNote:0.52,       // 0.30 en v2
    gainPedale:0.34,     // 0.26 en v2

    // Progression harmonique : le cœur du « plus mélodieux ».
    accordDuree:[25,50], // secondes, tiré entre les deux
    accordFondu:8,

    reverbCourte:3.5,    // boyau exigu
    reverbLongue:16,     // grande salle

    /* ─── PORTÉE DE LA CRÉATURE ───
       LE BUG DE LA v3.0 : le panner HRTF atténuait avec la distance, ET une
       courbe explicite atténuait encore par-dessus. Mesuré, il ne restait que
       1 % du signal à 30 m et 0,01 % à 80 m : on ne l'entendait littéralement
       jamais. Le panner ne sert plus qu'à DONNER LA DIRECTION — refDistance
       très grand et rolloff quasi nul — et c'est la courbe qui porte seule
       l'éloignement. */
    creatureDistanceMax:400,   // le panner ne coupe plus rien
    creatureRefDistance:30,
    creatureRolloff:0.15,
    creaturePorteeMenace:105,
    creatureCourbe:1.4,        // exposant : plus bas = s'entend de plus loin
    creatureGain:0.62,         // en approche
    creatureGainChasse:0.95,   // en poursuite
    creaturePorteeInfra:170,   // on la sent avant de l'entendre
    creaturePorteePanique:14,  // en deçà : la couche « elle est SUR toi »
    jeunesPortee:70,
    jeunesRefDistance:18,

    vent:{gain:0.55, dureeRafale:[4,12], ecartRafale:[9,34]},
    gouttes:{tauxMin:0.15, tauxMax:1.4, portee:26},
    effondrement:{intervalle:[60,180], portee:60, secousse:0.8, duree:3},
  },

  /* ─────────────── VILLAGES ENGLOUTIS ───────────────
     « Placer des zones d'anciens villages dépeuplés car tous mangés, mais qui
     ont une safe zone et des trousses médicales épuisables. »
     Un village est un amas de maisons, de carcasses et de lampadaires autour
     d'une place barricadée. Rare, mais on le voit de loin à ses lumières. */
  villages:{
    nombre:22,
    rayon:26,            // mètres
    maisons:[6,14],
    carcasses:[3,9],
    lampadaires:[2,6],
    ecartMin:190,
    trousses:[1,3],      // par village, épuisables
    boisParVillage:[3,7],
    /* La place barricadée : la créature refuse d'y entrer, les jeunes aussi.
       Ce n'est pas magique — c'est un cercle de feux et de ferraille. */
    safeRayon:9,
    safeChaleur:11,      // on s'y réchauffe presque comme à un brasero
  },

  /* ─────────────── SANTÉ ───────────────
     Il n'y avait aucun point de vie en v3.0 : on mourait d'un coup. Les
     trousses médicales demandées impliquaient de pouvoir être blessé. */
  /* ─── ARMES ───
      Une arme ACHÈTE DU TEMPS contre la mère, elle ne la tue pas : tout le
      jeu tient sur le fait qu'elle est inarrêtable. Voir joueur/armes.js. */
  armes:{
    reculSecondes:2.6,      // durée de repli pour une répulsion de 1.0
    /* Chaque coup encaissé la rend moins impressionnable. 0.62 veut dire que
       le deuxième coup vaut 62 % du premier, le troisième 38 %. Sans cette
       décroissance, marteler la même touche la tiendrait à distance
       indéfiniment et le jeu serait résolu. */
    accoutumanceBase:0.62,
    oubliSecondes:38,       // temps pour oublier un coup
    cellulesDepart:0,       // le thunderbolt se trouve vide
    cellulesParTas:4,       // munitions ramassées d'un coup
    nbArmesDansLeMonde:14,  // exemplaires semés
    nbTasDeCellules:26,

    /* ─── COMMENT ON LA TIENT ───
        L'arme est dessinée devant la caméra, pas dans le monde. Ces valeurs
        sont en mètres, dans le repère de l'œil : X à droite, Y en haut,
        Z devant. */
    tenueX:0.30, tenueY:-0.26, tenueZ:0.52,
    orientation:-1.5708,     // l'arme est bâtie le long de +X : on la tourne
    balanLateral:0.030,      // amplitude du pas, à gauche-droite
    balanVertical:0.022,
    /* Le retard sur le regard. C'est le détail le moins cher et celui qui
       change le plus : sans lui, on tient une décalcomanie collée à l'écran.
       `suiviRegard` est une vitesse de rattrapage, `amplitudeRetard` dit
       de combien l'arme se laisse distancer. */
    suiviRegard:11.0,
    amplitudeRetard:0.55,
    inclinaisonCoup:0.9,     // radians, au sommet du geste
  },

  sante:{
    max:100,
    degatsJeune:22,      // une morsure de jeune
    degatsChute:9,       // par mètre au-delà du seuil de dégât
    degatsFroid:3.5,     // par seconde à zéro de chaleur
    invulnerabilite:1.1, // secondes après un coup
    regen:0.35,          // par seconde, très lent, seulement au repos
    seuilRepos:12,       // ne régénère qu'après ce délai sans blessure
    soinTrousse:45,
  },

  /* ─────────────── FEU : BOIS, FEUX DE CAMP, FUSÉES ───────────────
     « Trouver du bois pour se réchauffer » et « donner au joueur le moyen
     d'avoir une arme ou un objet pour se défendre ». */
  feu:{
    nbBois:700,          // fagots au sol
    maxBoisPorte:6,
    dureeFeu:150,        // secondes de combustion d'un feu de camp
    rayonFeu:6,          // mètres où l'on se réchauffe
    // la distance à laquelle les jeunes reculent est SETUP.jeunes.peurDuFeu :
    // c'est une propriété de la bête, pas du feu.

    nbFusees:180,        // fusées de détresse au sol
    maxFuseesPortees:4,
    dureeFusee:26,
    rayonFusee:14,       // elles éclairent LARGE : c'est leur intérêt premier
    /* Brandir la lampe : les jeunes reculent, mais ça consomme le jus vite.
       C'est la défense de dernier recours, pas une arme. */
    brandirConso:0.06,
  },

  /* ─────────────── PANCARTES ───────────────
     « Laisser des pancartes avec possibilité d'écrire des messages et une
     petite loupiotte qui clignote pour dire que je suis déjà passé ici. » */
  pancartes:{
    maxPosees:60,
    porteeLecture:4,
    clignotement:1.6,    // période en secondes
  },

  /* ─────────────── CARTES À COLLECTIONNER ───────────────
     Les CHEMINS des stacks sont dans src/carte/rangs.js — c'est le seul
     fichier à ouvrir pour brancher tes dossiers. Ici, seulement le dosage. */
  cartes:{
    nombreDansLeMonde:420,
    essaisPlacement:48000,

    /* ─── APPARENCE DANS LE MONDE ───
       Retour de test : « cadre trop gros / vulgaire, les rendre plus fines et
       plus esthétiques, et volant un peu moins haut ».
       Le rapport 3:4 est celui d'une carte à collectionner ; garde-le si tu
       changes les dimensions, sinon les illustrations seront déformées. */
    /* Plus grandes : le cadre a disparu, l'image occupe désormais toute la
       place qu'il prenait. Rapport 3:4, celui d'une carte à collectionner —
       garde-le si tu changes ces valeurs, sinon les illustrations seront
       déformées. */
    largeur:0.74,
    hauteur:0.99,              // 0.74 × 4/3
    hauteurFlottement:0.62,    // au-dessus du sol (1.10 en v3.1 : trop haut)
    amplitudeFlottement:0.055, // le balancement vertical (0.12 : trop agité)

    /* La carte fait FACE au joueur : la rotation est dans le GIF lui-même, et
       la superposer donnait une illustration de profil une fois sur deux.
       Il ne reste qu'un léger dandinement, en radians — sans lui, une carte
       parfaitement immobile ressemble à une affiche collée dans l'air. */
    balancement:0.16,
    eclatIllustration:1.30,    // l'image doit rester lisible dans la brume
    porteeRendu:58,            // mètres
  },

  /* ─────────────── DÉCOR ───────────────
     LA RÉGRESSION LA PLUS VISIBLE DE LA v3.0 : la grille est passée de 544² à
     1088², soit quatre fois plus de cellules, et ces compteurs n'ont pas
     bougé. Le décor et les lumières étaient donc QUATRE FOIS moins denses
     qu'en v2 — d'où un monde vide et noir. Tout est remis à l'échelle.      */
  decor:{
    /* ─── LE BOUCHON ───
        Un élément massif posé dans un boyau condamne tout ce qu'il y a
        derrière. Au-delà de `rayonBouchon` mètres de rayon, on ne le pose que
        là où l'ouverture locale dépasse `ouvertureMassif` (0 = boyau, 1 =
        grande salle). Voir monde/props.js. */
    rayonBouchon:0.55,
    ouvertureMassif:0.45,

    semis:104000,        // 26 000 en v3.0
    ossuaires:1000,      // 260
    maxLumieres:13000,   // 3 200
    nbLeurres:1400,      // 600
    nbRefuges:14,        // 3 — trois braseros sur 1 632 m, c'était introuvable
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
  {chemin:'image.ambiance',nom:'Lumière ambiante',  min:0.2,max:2.5, pas:0.05, fmt:v=>'×'+v.toFixed(2)},
  {chemin:'image.vignette',nom:'Vignette',          min:0,  max:0.95,pas:0.05, fmt:v=>(v*100).toFixed(0)+' %'},
  {chemin:'lampe.intensite',nom:'Puissance de la lampe',min:1,max:12,pas:0.2, fmt:v=>'×'+v.toFixed(1)},
  {chemin:'lampe.portee',  nom:'Portée de la lampe', min:0.010,max:0.09,pas:0.002,
   fmt:v=>(Math.log(0.15)/-v).toFixed(0)+' m'},
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
