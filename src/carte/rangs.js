/* ╔══════════════════════════════════════════════════════════════════════════╗
   ║  TES STACKS DE CARTES — C'EST LE SEUL FICHIER À OUVRIR                   ║
   ║                                                                          ║
   ║  Trois rangs, trois dossiers. Change les `chemin` ci-dessous et c'est    ║
   ║  tout : rien d'autre dans le jeu ne connaît ces chemins.                 ║
   ║                                                                          ║
   ║  ── COMMENT ÇA MARCHE ────────────────────────────────────────────────   ║
   ║  Le jeu SONDE chaque dossier : il tente 1.gif, 2.gif, 3.gif… jusqu'à     ║
   ║  trois échecs d'affilée. Le total collectionnable est donc la SOMME des  ║
   ║  cartes réellement présentes — tu n'as aucune liste à tenir.             ║
   ║                                                                          ║
   ║  · Nomme les fichiers 1.gif, 2.gif, … dans chaque dossier.               ║
   ║  · Change `ext` si tu utilises png ou webp au lieu de gif.               ║
   ║  · Le jeu doit être servi par un serveur — file:// bloque la lecture.    ║
   ║        depuis le dossier du jeu :   python -m http.server 8000           ║
   ║                                                                          ║
   ║  ── OÙ UNE CARTE APPARAÎT ────────────────────────────────────────────   ║
   ║  `profondeurMin` est la profondeur normalisée à partir de laquelle le    ║
   ║  rang peut sortir : 0 = surface, 1 = point le plus bas du monde.         ║
   ║  Une légendaire à 0.78 ne se trouve donc que dans le dernier quart.      ║
   ╚══════════════════════════════════════════════════════════════════════════╝ */

export const RANGS = [
  {
    id:'commune',
    nom:'Commune',
    chemin:'cartes/communes/',
    ext:'png',
    couleur:[0.55,0.53,0.48],   // teinte de la carte au sol et de son cadre
    profondeurMin:0.00,
    poids:0.62,                 // part relative des tirages là où le rang est permis
  },
  {
    id:'rare',
    nom:'Rare',
    chemin:'cartes/rares/',
    ext:'png',
    couleur:[0.35,0.62,0.75],
    profondeurMin:0.45,
    poids:0.28,
  },
  {
    id:'legendaire',
    nom:'Légendaire',
    chemin:'cartes/legendaires/',
    ext:'png',
    couleur:[1.00,0.72,0.28],
    profondeurMin:0.78,
    poids:0.10,
  },
];

/* Noms de repli, utilisés tant qu'aucun dossier n'est rempli : le jeu reste
   jouable et collectionnable avec des cartes procédurales. */
export const NOMS_REPLI = [
  'ÉCHINE','MUE','MANDIBULE','GÉSIER','OEUF','NID','GRIFFE','ANTENNE',
  'CARAPACE','PONTE','LARVE','CHITINE','VENIN','SILLON','TERRIER','ESSAIM',
  'MÈRE','ROI','ABYSSE','PREMIÈRE',
];

/** Le rang le plus élevé autorisé à cette profondeur. */
export function rangsPermis(profondeur){
  return RANGS.filter(r => profondeur >= r.profondeurMin);
}
