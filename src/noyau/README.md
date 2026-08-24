# noyau/ — le socle

Aucune règle de jeu ici. Ces cinq fichiers n'importent (presque) rien et sont
importés par tout le monde.

| fichier | contenu |
|---|---|
| `math.js` | matrices 4×4, `clamp`, `lerp`, `hash2`, `deltaAngle`, `trs` |
| `rng.js` | générateur à graine : même graine, même monde |
| `bruit.js` | **les champs continus du terrain** : perlin, fBm, crêtes, plis |
| `gl.js` | contexte WebGL2, compilation de shaders, maillages statiques |
| `shaders.js` | les quatre sources GLSL, plus la liste de leurs uniformes |

`bruit.js` est **calibré** : `fbm2` a un écart-type de 1, pas une amplitude de
1. Un appelant qui écrit « 9 mètres » obtient un relief typique de 9 m et des
crêtes à deux ou trois fois plus — sans cette calibration, la première version
du terrain v5 sortait un monde plat parce que la somme d'octaves ne remplit
jamais l'intervalle qu'elle occupe (écart-type mesuré : 0,20).

`rng.rnd()` sert à **la génération** (rejouable). `Math.random()` sert à l'audio
et aux effets visuels, qui n'ont pas besoin de l'être.
