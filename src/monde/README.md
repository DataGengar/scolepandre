# monde/ — le terrain et ce qu'il porte

Lis `index.js` en premier : c'est lui qui dit dans quel ORDRE le monde se
construit, et l'ordre compte.

| fichier | à ouvrir pour… |
|---|---|
| `index.js` | changer l'ordre de génération, lire le rapport |
| `plan.js` | **ce que l'éditeur produit** : zones, biomes imposés, contenus autorisés |
| `connexite.js` | composantes connexes, et les rampes qui les relient |
| `grille.js` | les champs par cellule, les accesseurs, la granularité |
| `biomes.js` | **la table des biomes — source unique**, partagée avec l'éditeur |
| `generation.js` | **le terrain** : les deux champs, les lieux, les galeries |
| `relief.js` | gouffres sans fond, précipices, éboulis |
| `ponts.js` | passerelles suspendues et leurs échelles |
| `cachettes.js` | les trous où l'on disparaît |
| `props.js` | tout le décor, et le polycount |
| `maillage.js` | cuisson des pavés, streaming |
| `navigation.js` | A*, ligne de vue, lissage de trajet |
| `sortie.js` | l'objectif |
| `import-png.js` | lecture d'une carte dessinée dans RELEVÉ |

## Le terrain n'est pas creusé, il est échantillonné (v5)

Jusqu'en v4 on posait 300 rectangles de salle et on les reliait par des
couloirs en L. Ça se voyait : l'œil lit une trame régulière avant de lire un
lieu. Depuis la v5, `generation.js` évalue **deux champs continus** sur toute
la planche — l'altitude du sol, et la présence de roche — et les galeries sont
les lignes de crête d'un bruit *ridged*. Lis l'en-tête du fichier : tout y est.

Les réglages sont dans `SETUP.terrain`. Les deux qui changent vraiment le
monde : `seuilGalerie` (combien de roche est creusée) et `amplitudeRelief`
(à quel point ça monte et descend dans une strate).

Pour voir le résultat sans jouer :

    python outils/carte_monde.py --graine 3

## Le point délicat : falaises contre traversabilité

La v2 relaxait tout le champ de hauteur pour garantir qu'aucune marche ne soit
infranchissable — ce qui interdisait toute falaise. La v3 ne relaxait que le
long d'une **épine navigable**.

La v5 tranche autrement, et c'est mesuré : **tout le creux SOUS TERRE est
relaxé** (`SETUP.terrain.relaxerSouterrain`), parce que dans un boyau de trois
cellules de large on ne contourne rien — une marche de deux mètres coupe la
galerie et tout ce qu'il y a derrière. **Le dehors garde son relief brut** : à
ciel ouvert on contourne, et c'est là que les à-pics ont un sens.

Les falaises viennent donc désormais des **failles** (`SETUP.terrain.
hauteurFaille`, un ressaut franc taillé dans le champ d'altitude), des gouffres
et de la surface — plus du hasard du bruit.

## Changer la granularité

`SETUP.monde.cellule`, `.largeur`, `.hauteur`, `.pave`. Les dimensions de
`SETUP.relief` sont en **mètres** et se convertissent seules : tu peux changer
la taille de cellule sans que les gouffres changent de dimension.
