# carte/ — les cartes à collectionner

**Pour brancher tes dossiers : ouvre `rangs.js` et change les trois `chemin`.
C'est tout.** Rien d'autre dans le jeu ne connaît ces chemins.

| fichier | rôle |
|---|---|
| `rangs.js` | **les 3 rangs et leurs dossiers** — le seul fichier à éditer |
| `catalogue.js` | sonde les dossiers (1.gif, 2.gif… jusqu'à 3 échecs) |
| `placement.js` | répartit les cartes selon la profondeur |
| `collection.js` | ce que tu possèdes, sauvegardé dans le navigateur |

## Comment ça marche

Dépose `1.gif`, `2.gif`, `3.gif`… dans `cartes/communes/`, `cartes/rares/` et
`cartes/legendaires/`. Le jeu les découvre seul : **aucune liste à tenir.**

`profondeurMin` décide où un rang peut apparaître : 0 = partout, 0.78 = dans le
dernier quart du monde en profondeur.

Le jeu doit être servi par un serveur — `file://` bloque la lecture des images :

    python -m http.server 8000
