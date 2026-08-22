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

export const BIOMES = [
  {
    n:'SOUTERRAIN', code:'#8a4a22',
    fog:[.013,.014,.017], fogD:4.6, h:1.00, amb:.16, snow:0, sky:0,
    floor:[.23,.21,.18], wall:[.29,.27,.24], ceil:[.10,.10,.11],
    lum:[0.72,0.31,0.09],
    reverb:'moyenne',
    props:['pilier','gravats','stalag','arche','os','cotes','crane','cristal',
           'monolithe','cristal','champignon','champignon'],
  },
  {
    n:'GLACIÈRE', code:'#2f7fa8',
    // souterraine : du givre, pas des flocons. snow reste à 0.
    fog:[.024,.031,.042], fogD:5.4, h:1.35, amb:.19, snow:0, sky:0,
    floor:[.33,.38,.45], wall:[.29,.35,.43], ceil:[.16,.21,.29],
    lum:[0.14,0.42,0.78],
    reverb:'longue',
    props:['glace','gravats','stalag','os','cotes','cristal','cristal',
           'monolithe','glace'],
  },
  {
    n:'BARRAGE', code:'#9a8b4a',
    fog:[.015,.016,.018], fogD:3.2, h:2.60, amb:.15, snow:0, sky:0,
    floor:[.26,.26,.25], wall:[.31,.31,.30], ceil:[.12,.12,.13],
    lum:[0.80,0.58,0.20],
    reverb:'longue',
    props:['poutre','conduit','gravats','os','crane','monolithe','monolithe',
           'cristal','carcasse','lampadaire'],
  },
  {
    n:'SURFACE GELÉE', code:'#cfd8dd',
    // le seul biome à ciel ouvert : la neige et la lune brisée sont ici
    fog:[.070,.077,.090], fogD:4.2, h:1.00, amb:.34, snow:1, sky:1,
    floor:[.46,.49,.55], wall:[.18,.19,.22], ceil:[.05,.06,.08],
    lum:[0.22,0.34,0.55],
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
    fog:[.052,.010,.009], fogD:4.8, h:3.4, amb:.17, snow:0, sky:0,
    floor:[.16,.065,.06], wall:[.22,.08,.07], ceil:[.07,.025,.025],
    lum:[1.05,0.34,0.18],
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
