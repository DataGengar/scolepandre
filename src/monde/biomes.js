/* ═══ MONDE / BIOMES ═══
   SOURCE UNIQUE de la table des biomes.

   Cette table est lue par :
     · monde/generation.js    quel biome à quelle altitude
     · monde/props.js         quel décor y pousse
     · monde/maillage.js      couleurs du sol, des parois, du plafond
     · rendu/pipeline.js      fog, ambiante, neige
     · audio/nappes.js        quelle nappe joue    (via l'index)
     · joueur/froid.js        vitesse de perte de chaleur (via SETUP.froid.base)
     · outils/releve.html     via outils/biomes.json, REGÉNÉRÉ depuis ce fichier

   Si tu ajoutes un biome ici : ajoute aussi son entrée dans SETUP.froid.base
   et une nappe dans audio/nappes.js — verifier.py te le rappellera.
   Puis relance   python outils/exporter_biomes.py   pour l'éditeur.

   L'ORDRE FAIT FOI. Les cartes PNG dessinées dans RELEVÉ encodent l'index du
   biome ; le réordonner casse les cartes déjà dessinées.                    */

export const BIOMES = [
  {
    n:'SOUTERRAIN', code:'#8a4a22',
    fog:[.011,.012,.015], fogD:5.4, h:1.00, amb:.016, snow:0, sky:0,
    floor:[.21,.19,.17], wall:[.27,.25,.23], ceil:[.09,.09,.10],
    lum:[0.58,0.24,0.06],
    reverb:'moyenne',
    props:['pilier','gravats','stalag','arche','os','cotes','crane','cristal','monolithe','cristal'],
  },
  {
    n:'GLACIÈRE', code:'#2f7fa8',
    fog:[.021,.027,.037], fogD:7.8, h:1.35, amb:.026, snow:.3, sky:0,
    floor:[.31,.36,.43], wall:[.27,.33,.41], ceil:[.15,.20,.28],
    lum:[0.09,0.30,0.58],
    reverb:'longue',
    props:['glace','gravats','stalag','os','cotes','cristal','cristal','monolithe'],
  },
  {
    n:'BARRAGE', code:'#9a8b4a',
    fog:[.013,.014,.016], fogD:3.6, h:2.60, amb:.018, snow:0, sky:0,
    floor:[.25,.25,.24], wall:[.30,.30,.29], ceil:[.11,.11,.12],
    lum:[0.62,0.46,0.16],
    reverb:'longue',
    props:['poutre','conduit','gravats','os','crane','monolithe','monolithe','cristal'],
  },
  {
    n:'SURFACE GELÉE', code:'#cfd8dd',
    fog:[.062,.068,.079], fogD:7.2, h:1.00, amb:.115, snow:1, sky:1,
    floor:[.44,.47,.53], wall:[.17,.18,.21], ceil:[.05,.06,.08],
    lum:[0.16,0.26,0.42],
    reverb:'aucune',
    props:['tronc','tronc','tronc','tronc','souche','souche','os','cotes','monolithe','cristal'],
  },
  /* VILLE ROUGE — noir profond viré rouge, meneaux verticaux au premier plan,
     grilles de fenêtres lointaines dans le fog. Presque aucune ambiante :
     toute la lumière vient des fenêtres. */
  {
    n:'VILLE ROUGE', code:'#7a1410',
    fog:[.048,.007,.006], fogD:5.6, h:3.4, amb:.010, snow:0, sky:0,
    floor:[.14,.055,.05], wall:[.20,.07,.062], ceil:[.06,.02,.02],
    lum:[0.95,0.30,0.16],
    reverb:'moyenne',
    props:['tourFenetres','meneau','tourFenetres','meneau','gravats','os','cotes','monolithe'],
  },
];

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
