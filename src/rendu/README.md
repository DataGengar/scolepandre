# rendu/ — l'image

| fichier | à ouvrir pour… |
|---|---|
| `pipeline.js` | les deux passes, les uniformes |
| `camera.js` | **le tremblement sismique**, les matrices de vue |
| `lumieres.js` | choix des sources, projection des godrays |
| `sismographe.js` | la mini-carte |

## Le tremblement

La v2 était invisible : une seule sinusoïde de faible amplitude, et **aucun
roulis** — or c'est le roulis qui fait sentir que le SOL bouge. La v3 somme
trois sinusoïdes incommensurables par axe, ajoute `rotZ` à la chaîne de vue, et
fait dépendre l'intensité de la distance, de **la vitesse réelle** de la
créature et de son état. Une créature immobile ne fait pas trembler le sol.

Au-delà de `SETUP.joueur.seuilChute` ce tremblement peut te faire tomber — et
tomber émet une vibration qui la prévient.
