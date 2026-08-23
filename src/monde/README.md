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
| `generation.js` | salles, cavernes, couloirs, relaxation, plateformes |
| `relief.js` | gouffres sans fond, précipices, éboulis |
| `ponts.js` | passerelles suspendues et leurs échelles |
| `cachettes.js` | les trous où l'on disparaît |
| `props.js` | tout le décor, et le polycount |
| `maillage.js` | cuisson des pavés, streaming |
| `navigation.js` | A*, ligne de vue, lissage de trajet |
| `sortie.js` | l'objectif |
| `import-png.js` | lecture d'une carte dessinée dans RELEVÉ |

## Le point délicat : falaises contre traversabilité

La v2 relaxait tout le champ de hauteur pour garantir qu'aucune marche ne soit
infranchissable — ce qui interdisait toute falaise. La v3 ne relaxe que le long
d'une **épine navigable** (le chemin qui relie les salles). Partout ailleurs le
dénivelé brut survit, et c'est exactement ça, les falaises et les précipices.

`SETUP.relief.epineMarge` est ce curseur : plus grand = plus praticable et plus
plat, plus petit = plus vertical et plus risqué.

## Changer la granularité

`SETUP.monde.cellule`, `.largeur`, `.hauteur`, `.pave`. Les dimensions de
`SETUP.relief` sont en **mètres** et se convertissent seules : tu peux changer
la taille de cellule sans que les gouffres changent de dimension.
