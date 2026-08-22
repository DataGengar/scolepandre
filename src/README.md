# src/ — le code du jeu

Chaque dossier regroupe les fonctionnalités d'un élément du jeu. Pour modifier
quelque chose, va dans le dossier de son domaine — pas ailleurs.

| dossier | ce qu'il contient | à ouvrir pour… |
|---|---|---|
| `setup.js` | **toutes** les valeurs réglables | changer un nombre, quel qu'il soit |
| `noyau/` | maths, RNG, WebGL, shaders | le socle technique, rarement |
| `monde/` | terrain, gouffres, ponts, cachettes, décor | la carte et ce qu'il y a dessus |
| `carte/` | les cartes à collectionner | brancher tes dossiers de GIF |
| `creatures/` | la mère, les jeunes, leurs lueurs | l'IA et l'apparence des bêtes |
| `joueur/` | déplacement, froid, chute, torche, leurres | ce que tu subis et ce que tu fais |
| `audio/` | nappes, vent, cavernes, effondrements | tout le son |
| `rendu/` | caméra, lumières, pipeline, sismographe | l'image |
| `ui/` | menu, HUD, réglages | l'interface |
| `jeu.js` | assemblage + boucle | brancher un module à un autre |

## La règle qui tient l'ensemble

**Aucun fichier n'écrit un nombre réglable en dur.** Tout vient de `setup.js`.
C'est ce qui fait qu'une valeur ne peut pas exister en deux exemplaires
divergents, et `python outils/verifier.py` le contrôle.
