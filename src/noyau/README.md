# noyau/ — le socle

Aucune règle de jeu ici. Ces quatre fichiers n'importent (presque) rien et sont
importés par tout le monde.

| fichier | contenu |
|---|---|
| `math.js` | matrices 4×4, `clamp`, `lerp`, `hash2`, `deltaAngle`, `trs` |
| `rng.js` | générateur à graine : même graine, même monde |
| `gl.js` | contexte WebGL2, compilation de shaders, maillages statiques |
| `shaders.js` | les quatre sources GLSL, plus la liste de leurs uniformes |

`rng.rnd()` sert à **la génération** (rejouable). `Math.random()` sert à l'audio
et aux effets visuels, qui n'ont pas besoin de l'être.
