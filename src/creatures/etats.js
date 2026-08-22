/* ═══ CRÉATURES / ÉTATS ═══
   Les six états de la mère, dans un fichier à part parce que trois modules les
   lisent : mere.js les fait vivre, lueurs.js en tire la couleur des yeux,
   rendu/sismographe.js en tire l'étiquette affichée.

   Un fichier de six lignes, mais il évite trois copies de la même liste.    */

export const ST = {
  PATROL:  'traque',      // elle ne sait rien, elle quadrille
  INVEST:  'approche',    // elle a un point à vérifier
  SEARCH:  'fouille',     // elle tourne autour du point
  LISTEN:  'écoute',      // elle s'arrête net — et son ouïe double
  CHASE:   'poursuite',   // elle te suit
  RETREAT: 'retrait',     // elle abandonne et s'éloigne
};
