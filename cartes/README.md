# cartes/ — tes stacks de collectionnables

Trois dossiers, trois rangs. Dépose tes fichiers nommés `1.gif`, `2.gif`,
`3.gif`… dans chacun.

    cartes/
      communes/      1.gif  2.gif  3.gif  …
      rares/         1.gif  2.gif  …
      legendaires/   1.gif  …

Le jeu sonde chaque dossier au démarrage et s'arrête après trois numéros
manquants d'affilée. **Tu n'as aucune liste à tenir.**

Pour changer les chemins, l'extension ou la profondeur d'apparition d'un rang :
`src/carte/rangs.js`.

Tant que les dossiers sont vides le jeu tourne avec des cartes procédurales de
remplacement — rien ne casse.

Attention : les images ne se chargent que si le jeu est **servi par un
serveur** :

    python -m http.server 8000
