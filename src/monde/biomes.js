/* ═══ MONDE / BIOMES ═══
   SOURCE UNIQUE de la table des biomes, et de la règle qui décide où ils sont.

   ── LE MONDE A UNE STRATIGRAPHIE (v3.1) ────────────────────────────────────
   Retour de test : « les biomes sont placés au bol n'importe où » et « il
   neige dans les souterrains, ça n'a aucun sens ». C'était fondé : le biome
   était tiré par l'INDICE de la salle dans le plan, pas par sa PROFONDEUR, et
   les cavernes ajoutaient encore leur propre règle. Deux salles voisines à la
   même altitude pouvaient donc être de biomes différents.

   Le biome est désormais UNE FONCTION DE L'ALTITUDE, et rien d'autre. Le monde
   se lit comme une coupe géologique, du bas vers le haut :

     −131 … −85   BARRAGE            l'ouvrage noyé, tout au fond
      −85 … −45   GLACIÈRE           les grottes de glace
      −45 … +10   SOUTERRAIN         la roche nue, le gros du monde
      +10 … +70   VILLE ENSEVELIE    ce qu'il reste des gens
      +70 …       SURFACE GELÉE      dehors, la neige, la lune brisée

   La frontière est brouillée de quelques mètres par un bruit déterministe :
   une coupe parfaitement plane ferait maquette.

   ── LA NEIGE ───────────────────────────────────────────────────────────────
   `snow` ne vaut plus que pour la SURFACE. La glacière est SOUTERRAINE : elle
   a du givre sur les parois, pas des flocons qui tombent. Le rendu croise en
   plus cette valeur avec l'ouverture réelle du ciel au-dessus du joueur.

   ── QUI LIT CE FICHIER ─────────────────────────────────────────────────────
     monde/generation.js   quel biome à quelle altitude
     monde/props.js        quel décor y pousse
     monde/maillage.js     couleurs du sol, des parois, du plafond
     rendu/pipeline.js     fog, ambiante, neige
     audio/nappes.js       quelle nappe joue (via NAPPE_DE_BIOME)
     joueur/froid.js       vitesse de perte de chaleur (via SETUP.froid.base)
     outils/releve.html    via outils/biomes.json, REGÉNÉRÉ depuis ce fichier

   L'ORDRE FAIT FOI. Les cartes PNG dessinées dans RELEVÉ encodent l'index du
   biome ; le réordonner casse les cartes déjà dessinées.                    */

/* ═══ DEUX RÉGIMES D'AIR ═══════════════════════════════════════════════════

   « Il y a trop de lumière, trop de couleurs pétantes, et ça manque de smog
   à la Silent Hill. » Le retour était juste, et la correction n'est pas
   « assombrir ».

   ── CE QUE FAIT VRAIMENT SILENT HILL ──────────────────────────────────────
   Son brouillard est CLAIR. Un gris lumineux, très dense, presque blanc. On
   voit net à une douzaine de mètres, et au-delà le monde n'est pas noir : il
   est ABSENT. C'est bien pire. Le noir, on l'éclaire ; le gris, on ne le
   traverse pas — et on avance en sachant que ce qui arrive sera déjà sur nous
   quand on le verra.

   D'où deux régimes, et non un réglage :

     SMOG      brouillard CLAIR. Surface, glacière, ville. La brume est
               visible, elle a une couleur, elle est éclairée par ce qui s'y
               trouve. L'ambiante monte : un smog clair diffuse la lumière.

     TÉNÈBRES  brouillard SOMBRE. Souterrain profond, barrage. Là, c'est le
               noir qui mange le monde, et la lampe compte.

   ── LA DENSITÉ N'A PAS BOUGÉ, ET C'EST DÉLIBÉRÉ ───────────────────────────
   Première tentative : couleurs claires ET densité relevée de 20 à 40 %.
   Résultat, mesuré au rendu logiciel puis en portée utile : un souterrain
   quasiment noir, et une portée qui tombait de 12,8 m à 9,8 m. C'est
   exactement le défaut déjà signalé deux fois — « on ne voit absolument
   rien ».

   La leçon : ce qui fait le smog, c'est la COULEUR du brouillard, pas sa
   quantité. Un gris clair à densité égale dissout le monde dans du gris ; un
   gris sombre le noie dans du noir. Le premier est angoissant, le second est
   seulement illisible. Les densités sont donc revenues à leurs valeurs
   d'origine, à un cheveu près.

   Descendre change donc l'air qu'on respire, et c'est lisible sans un mot.

   ── LES COULEURS ONT ÉTÉ DÉSATURÉES ───────────────────────────────────────
   Les `lum` d'origine étaient des teintes pures — orange saturé, bleu
   électrique, rouge vif. Une lampe orange pur dans une caverne brune, c'est
   du carnaval. Elles sont ramenées vers le gris : il reste assez de teinte
   pour identifier un biome, plus assez pour faire joli.                     */

export const BIOMES = [
  {
    n:'SOUTERRAIN', code:'#8a4a22',
    // TÉNÈBRES : la roche profonde. Le noir mange tout, la lampe est vitale.
    air:'tenebres',
    fog:[.020,.019,.017], fogD:4.8, h:1.00, amb:.15, snow:0, sky:0,
    floor:[.21,.19,.17], wall:[.26,.24,.22], ceil:[.09,.09,.09],
    lum:[0.52,0.34,0.20],
    reverb:'moyenne',
    props:['pilier','gravats','stalag','arche','os','cotes','crane','cristal',
           'monolithe','cristal','champignon','champignon'],
  },
  {
    n:'GLACIÈRE', code:'#2f7fa8',
    // souterraine : du givre, pas des flocons. snow reste à 0.
    // SMOG : la vapeur froide. Elle est claire, elle brille, elle aveugle.
    air:'smog',
    fog:[.112,.122,.134], fogD:5.4, h:1.35, amb:.26, snow:0, sky:0,
    floor:[.31,.34,.38], wall:[.28,.31,.35], ceil:[.17,.20,.24],
    lum:[0.26,0.38,0.52],
    reverb:'longue',
    props:['glace','gravats','stalag','os','cotes','cristal','cristal',
           'monolithe','glace'],
  },
  {
    n:'BARRAGE', code:'#9a8b4a',
    // TÉNÈBRES : du béton dans le noir. Les grandes salles s'y perdent.
    air:'tenebres',
    fog:[.026,.026,.025], fogD:3.4, h:2.60, amb:.15, snow:0, sky:0,
    floor:[.24,.24,.23], wall:[.28,.28,.27], ceil:[.11,.11,.11],
    lum:[0.54,0.46,0.30],
    reverb:'longue',
    props:['poutre','conduit','gravats','os','crane','monolithe','monolithe',
           'cristal','carcasse','lampadaire'],
  },
  {
    n:'SURFACE GELÉE', code:'#cfd8dd',
    // le seul biome à ciel ouvert : la neige et la lune brisée sont ici
    // SMOG, le plus dense du jeu. Le blanc pur de Silent Hill : dehors, on ne
    // voit pas plus loin que dedans, et c'est ça qui met mal à l'aise.
    air:'smog',
    fog:[.198,.202,.208], fogD:4.4, h:1.00, amb:.44, snow:1, sky:1,
    floor:[.42,.44,.47], wall:[.19,.20,.22], ceil:[.06,.07,.08],
    lum:[0.30,0.34,0.42],
    reverb:'aucune',
    props:['tronc','tronc','tronc','souche','souche','os','cotes','monolithe',
           'cristal','carcasse','maison','pylone'],
  },
  /* VILLE ENSEVELIE — ce qu'il reste des gens : immeubles éventrés, meneaux,
     fenêtres encore allumées on ne sait par quoi, voitures retournées. C'est
     la couche juste sous la surface : on l'a construite, puis elle a été
     recouverte. Nommée VILLE ROUGE en v3.0. */
  {
    n:'VILLE ENSEVELIE', code:'#7a1410',
    /* SMOG rouge sale. Esprit BACKROOMS : ce n'est pas une ruine, c'est du
       liminal. Des néons que personne n'a éteints, une lumière uniforme et
       bourdonnante, rien qui varie. La peur vient de la monotonie et de
       l'absence de sortie, pas du danger. D'où un rouge DÉSATURÉ et constant
       plutôt que l'écarlate d'avant : un rouge vif est spectaculaire, un
       rouge sale est habité par personne. */
    air:'smog',
    fog:[.082,.055,.052], fogD:4.8, h:3.4, amb:.22, snow:0, sky:0,
    floor:[.17,.10,.095], wall:[.21,.12,.11], ceil:[.08,.05,.05],
    lum:[0.72,0.34,0.26],
    reverb:'moyenne',
    props:['tourFenetres','meneau','tourFenetres','meneau','gravats','os',
           'cotes','monolithe','carcasse','maison','lampadaire','pylone'],
  },
];

/* ═══ LA STRATIGRAPHIE ═══
   Bornes hautes, dans l'ordre. Le dernier attrape tout ce qui dépasse.
   C'est LA règle : le biome ne dépend que de l'altitude. */
export const ETAGES = [
  {jusqua:-85, biome:2},   // BARRAGE
  {jusqua:-45, biome:1},   // GLACIÈRE
  {jusqua: 10, biome:0},   // SOUTERRAIN
  {jusqua: 70, biome:4},   // VILLE ENSEVELIE
  {jusqua: 1e9, biome:3},  // SURFACE GELÉE
];

/**
 * Le biome d'une altitude. `x` et `z` ne servent qu'à brouiller la frontière :
 * une coupe parfaitement plane ferait maquette de géologie.
 */
export function biomePourAltitude(e, x = 0, z = 0){
  const bruit = Math.sin(x * 0.021 + z * 0.017) * 5.5
              + Math.sin(x * 0.007 - z * 0.011) * 3.5;
  const a = e + bruit;
  for(const et of ETAGES) if(a < et.jusqua) return et.biome;
  return ETAGES[ETAGES.length - 1].biome;
}

/* Codes couleur lus dans les PNG de RELEVÉ. L'index 0 est la roche pleine ;
   les suivants sont BIOMES[i-1]. Dérivé de `code` pour qu'une seule valeur
   fasse foi — la v2 avait deux tables indépendantes qui pouvaient diverger. */
export const CODE_BIOME = [
  [0,0,0],
  ...BIOMES.map(b => [
    parseInt(b.code.slice(1,3),16),
    parseInt(b.code.slice(3,5),16),
    parseInt(b.code.slice(5,7),16),
  ]),
];

/** Index de la nappe audio pour un biome. Un pour un, mais nommé : si un jour
    deux biomes partagent une nappe, c'est ici que ça se dit. */
export const NAPPE_DE_BIOME = ['gouffre','givre','beton','gelisol','ville'];
