# audio/ — le son

`index.js` est la façade : `jeu.js` n'importe que lui.

| fichier | contenu |
|---|---|
| `index.js` | façade unique |
| `contexte.js` | AudioContext, bus, limiteur, convolution, délai |
| `nappes.js` | les drones d'ambiance, un par biome |
| `vent.js` | souffle et rafales |
| `cavernes.js` | gouttes, craquements, résonances lointaines |
| `effondrements.js` | l'événement dynamique |
| `creature-audio.js` | menace, infrasons, frottement, clics, cri |
| `effets.js` | pas, ramassage, souffle, battement de cœur |

## Pourquoi la nappe est plus mélodieuse

La v2 faisait une marche aléatoire sur une gamme — un mouvement brownien, pas
une mélodie. La v3 ajoute une **progression d'accords** (modes phrygien, mineur
harmonique, locrien) tenue 25 à 50 s, et la voix mélodique choisit ses notes
**dans l'accord courant**. Une voix médiane tient la tierce et glisse d'un
accord au suivant : c'est le mouvement harmonique qu'on entend.

## Pourquoi c'est plus fort

Trois choses se cumulaient en v2, toutes desserrées dans `SETUP.audio` : la
courbe de volume (exposant 1,55 → 1,20), le limiteur (−12 dB / 12:1 → −8 dB /
6:1) et le gain des notes (0,30 → 0,52).

**Règle conservée :** un drone ne se transforme jamais en un autre. Changer de
biome fait un fondu sortant complet puis un fondu entrant.
