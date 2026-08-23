# editeur/ — la forge

```sh
Scolopandre.exe                   → « Ouvrir la forge »
python -m http.server 8000        → http://localhost:8000/editeur.html
```

Elle tourne **sur le moteur du jeu** : mêmes shaders, mêmes primitives, même
code de génération. Ce que tu vois ici est ce que tu auras en partie. Un
éditeur qui rend autrement que le moteur ment, et on s'en aperçoit trop tard.

| fichier | rôle |
|---|---|
| `editeur.js` | assemblage, onglets, panneaux, boucle |
| `apercu3d.js` | caméra orbitale + rendu, sur les shaders du jeu |
| `terrain.js` | la carte de dessus : tracer des zones |
| `assets.js` | la forge d'éléments : bibliothèque, sélection, export |
| `primitives.js` | la description des cinq formes, qui construit l'interface |
| `modificateurs.js` | miroir, réseau, radial, dispersion, bruit |
| `creature-edit.js` | régler le scolopandre en le regardant |
| `pont.js` | écrire sur le disque, quand le lanceur est là |
| `console.js` | le journal horodaté du bas |
| `theme.css` | la palette d'Héphaïstos |

---

## TERRAIN — dire où se trouve quoi

Tu traces des **zones**. Chacune dit, pour ce qu'elle couvre : quel **biome**
(ou `auto`, c'est-à-dire « laisse la stratigraphie décider »), quelle
**altitude** avec sa pente, **ce qu'on a le droit d'y générer** — décor,
lumières, gouffres, ponts, cachettes, villages, cartes, créatures — et à quelle
**densité**.

**La dernière zone tracée l'emporte** : on pose une grande glacière, puis on y
découpe un morceau. Comme des calques. Hors zone, rien ne change : **un plan
vide n'a strictement aucun effet**, ce qui garantit que la forge ne casse rien
tant qu'on ne s'en sert pas.

`Générer un aperçu` lance la vraie génération et photographie le résultat en
couleurs de biome. La console dit combien de cellules de sol chaque zone a
produit — **et prévient si une zone n'en produit aucune**, ce que rien à
l'écran ne montrerait.

Souris : clic **tracer** · `MAJ`+glisser **déplacer** · molette **zoom**.

---

## ASSETS — la forge

### Les cinq formes

| forme | triangles | pour quoi |
|---|---|---|
| **bloc** | 12 | tout ce qui est bâti |
| **coin** | 8 | toits, rampes, éboulis, appuis |
| **plaque** | 4 | panneaux, planches, tôles — *les objets fins* |
| **tube** | 3N−2 | troncs, os, câbles, cannelures |
| **roche** | 20 ou 80 | la seule forme sans arêtes vives |

`coin`, `plaque` et `roche` sont neuves en v3.4, ainsi que le **lacet** `ry`.
Jusque-là une boîte ne pouvait que s'incliner : impossible de poser une caisse
de biais ou d'orienter une maison autrement que face au nord. On composait donc
tout sur les axes, et ça se voyait.

Chaque forme se décrit elle-même dans `primitives.js` — ses champs, leurs
bornes, comment les lire. Le panneau est construit à partir de cette
description. Ajouter un paramètre, c'est ajouter une ligne, pas trois.

`convertir en` change la forme en gardant position et taille : on pose un bloc,
on se rend compte qu'un coin irait mieux, on ne ressaisit pas six nombres.

### Les modificateurs

C'est ce qui sépare un empilement de blocs d'un outil de composition. Une
grille de barreaux, une cage thoracique, une palissade, un tas d'éboulis : ces
objets ont une **règle**. Les décrire pièce par pièce, c'est copier-coller sa
propre règle à la main.

Une pile s'applique aux primitives de base :

```
base ─▶ miroir ─▶ réseau ×8 ─▶ bruit ─▶ ce qu'on voit
```

| modificateur | ce qu'il fait |
|---|---|
| **Miroir** | symétrie sur X ou Z. La base de tout ce qui est bâti. |
| **Réseau** | N copies en ligne, avec pas, rotation et échelle par copie. |
| **Radial** | N copies en couronne, orientées ou non. |
| **Dispersion** | N copies au hasard dans un disque, graine fixe. |
| **Bruit** | dérègle chaque part un peu. Ce qui sépare le bâti du fabriqué. |

**La base reste modifiable** : change une dimension, les quarante copies
suivent. L'ordre compte — un miroir après un réseau ne donne pas la même chose
qu'avant. `Figer la pile` transforme le résultat en nouvelle base, pour
retoucher trois copies sur quarante à la main.

Tout ce qui tire au sort le fait sur une graine locale : un asset est identique
d'une session à l'autre, et régler un modificateur ne décale pas le monde.

Au-delà de 6 000 primitives la pile est **tronquée** plutôt que refusée : une
pile qui explose est une pile qu'on est en train de régler, et couper net en le
disant vaut mieux qu'une page figée.

### Juger ce qu'on fait

- **silhouette 1,75 m** — sans repère, on modélise des portes de trois mètres
  sans s'en apercevoir ;
- **éclairage jeu** — une seule lampe à l'œil, sombre, comme la lampe de poche.
  Un caillou magnifique en studio peut être une tache noire dans un souterrain ;
- **teinte du biome** — l'objet dans la lumière où il vivra ;
- **budget** — `confortable` sous 200 triangles, `tendu` sous 600, `lourd`
  au-delà. Le décor pose des milliers d'éléments par pavé ;
- **base seule** — voir les primitives sans la pile.

### Commandes

Le bouton gauche fait deux choses, décidées à l'instant du clic :

| le clic tombe | |
|---|---|
| **dans le vide** | la caméra orbite |
| **sur une pièce** | on la déplace — `MAJ` pour la monter |

C'est la convention de tous les éditeurs 3D, et elle s'apprend sans qu'on
l'explique. Le déplacement projette le curseur sur un **plan** — le sol, ou
celui de l'écran pour la hauteur — et non sur des pixels : convertir des pixels
en mètres donnerait un objet qui décroche dès qu'on change de zoom.

Clic droit **panoramique** · molette **zoom** · `MAJ`+clic pour ajouter à la
sélection.

Chaque champ a un **curseur et une case où taper**. Un curseur suffit pour
chercher une valeur, pas pour en poser une : « 0,25 exactement » est une demande
courante — aligner deux pièces, respecter une trame — et un curseur au pas de
1 cm sur 40 m ne la sert pas.

| touche | |
|---|---|
| `Ctrl+Z` / `Ctrl+Y` | annuler / rétablir |
| `Ctrl+D` | dupliquer · `Suppr` supprimer · `Ctrl+A` tout |
| flèches, `Pg↑` `Pg↓` | déplacer d'un cran (`MAJ` = ×4) |
| `F` | recadrer |

### Sortir vers le jeu

`Copier le code` produit le bloc `case` complet.

**`Écrire dans props.js`** le pose directement dans le jeu — le bouton
n'apparaît que si le lanceur tourne (voir `lanceur/README.md`). Le serveur
remplace le `case` s'il existe, l'ajoute sinon, garde une copie horodatée dans
`.sauvegardes/`, et refuse d'écrire si le fichier n'est plus équilibré.

**`Semer`** est le dernier maillon, et le plus facile à oublier : écrire un
`case` ne fait **pas** apparaître l'objet dans le monde. Le générateur tire au
sort dans la liste `props` du biome de chaque cellule ; tant que le nom n'y
figure pas, la fonction n'est jamais appelée — et on cherche son objet pendant
vingt minutes en croyant à un défaut de génération.

Coche les biomes, règle la fréquence (c'est un nombre d'occurrences dans la
liste : y figurer deux fois double la chance), et sème. `Retirer` l'enlève de
partout. L'opération est idempotente et se relit : les cases montrent l'état
réel de `biomes.js`.

Le code contient le **résultat**, pas la recette : le jeu ne charge aucun asset
à l'exécution, et c'est ce qui lui permet de tenir en un seul fichier. La
recette, elle, est conservée dans le projet.

> Le monde est bâti au chargement : il faut relancer une partie pour voir
> l'élément apparaître.

---

## CRÉATURE — régler le scolopandre

**Il n'y a pas de modeleur, et c'est normal** : le scolopandre n'est pas un
maillage, c'est un algorithme. Son corps est reconstruit à chaque image à partir
de sa trace, de son état et d'une quarantaine de paramètres. Il n'y a pas de
sommets à déplacer, il y a des nombres à régler.

L'onglet expose ces nombres et rejoue le **vrai** code de
`creatures/geometrie.js`.

---

## Enregistrement

**Navigateur** — automatique. Le jeu lit le plan au même endroit : « éditer
puis jouer » ne demande aucune manipulation.

**Fichier `.json`** — par les boutons, ou en glissant un fichier sur la page.

Un projet garde la **bibliothèque entière, piles comprises** : ce sont les
recettes qu'on voudra reprendre. Il ne conserve de `SETUP` que les valeurs
modifiées — enregistrer `SETUP` en entier figerait les défauts du jour, alors
qu'en ne gardant que les écarts un projet reste valable après une mise à jour.

---

## Vérification

```sh
python outils/smoke_formes.py     # les 5 primitives, sommet par sommet
python outils/smoke_editeur.py    # une séance complète
python outils/smoke_pont.py       # la forge écrit-elle vraiment dans le jeu ?
```

`smoke_formes` compte les triangles réellement produits, cherche les sommets
non finis et les normales nulles, et vérifie que le lacet fait tourner la
géométrie. Une primitive fausse ne lève aucune exception : elle produit une
forme qui « rend bizarre » dans le noir, une fois sur cinquante.

`smoke_editeur` trace une zone, lui impose un biome, lui interdit les villages,
génère, **vérifie que le générateur a suivi**, pose les cinq formes, applique
chaque modificateur, éprouve l'annulation et la visée au clic.

`smoke_pont` est le seul qui prouve que la forge sert à quelque chose : il
compose un élément dans un vrai navigateur, l'écrit dans une copie du projet,
et relit le fichier.
