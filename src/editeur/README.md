# editeur/ — l'éditeur visuel

```sh
python -m http.server 8000        # puis http://localhost:8000/editeur.html
```

Il tourne **sur le moteur du jeu** : mêmes shaders, mêmes primitives, même code
de génération. Ce que tu vois ici est ce que tu auras en partie. Un éditeur qui
rend autrement que le moteur ment, et on s'en aperçoit trop tard.

| fichier | rôle |
|---|---|
| `editeur.js` | assemblage, onglets, panneaux, boucle |
| `apercu3d.js` | caméra orbitale + rendu, sur les shaders du jeu |
| `terrain.js` | la carte de dessus : tracer des zones |
| `assets.js` | composer un élément de décor |
| `creature-edit.js` | régler le scolopandre en le regardant |
| `projet.js` | enregistrer / ouvrir |

## TERRAIN — dire où se trouve quoi

Tu traces des **zones** sur la planche. Chacune dit, pour ce qu'elle couvre :

- **quel biome** y règne — ou `auto`, c'est-à-dire « laisse la stratigraphie
  décider selon l'altitude », exactement comme un monde sans plan ;
- **quelle altitude** imposer, avec une pente éventuelle ;
- **ce qu'on a le droit d'y générer** : décor, lumières, gouffres, ponts,
  cachettes, villages, cartes, créatures. C'est ça, « quels endroits peuvent
  être générés aléatoirement ou en fonction du biome spécifié » ;
- à **quelle densité**.

**La dernière zone tracée l'emporte** : on peut poser une grande glacière, puis
y découper un morceau plus petit par-dessus. Comme des calques.

Hors zone, rien ne change : le monde reste procédural. **Un plan vide n'a
strictement aucun effet** — c'est la garantie que l'éditeur ne casse rien tant
qu'on ne s'en sert pas.

`Générer un aperçu` lance la vraie génération et photographie le résultat en
couleurs de biome. C'est la vérification : on voit tout de suite si une zone est
trop petite pour contenir un village, ou si un biome imposé n'a produit aucune
salle. `Jouer ce monde` ouvre le jeu, qui relit le plan tout seul.

Souris : tracer au clic gauche · `MAJ`+glisser pour déplacer la vue · molette
pour zoomer.

## ASSETS — composer un élément

Deux façons de commencer :

1. **Charger un élément du jeu** — pilier, maison, carcasse, crâne… L'éditeur
   appelle la vraie fonction `addProp()` dans un bac à sable et récupère la
   géométrie produite. C'est l'élément tel qu'il apparaît en partie, pas une
   imitation. C'est le mode le plus utile : la plupart du temps on ne veut pas
   inventer, on veut corriger.
2. **Empiler des primitives** — `bloc` (une boîte) et `tube` (un prisme à N
   côtés entre deux points). Les deux acceptent `émissif`.

`Copier le code` produit un extrait prêt à coller dans le `switch` de
`monde/props.js`. Le jeu ne charge pas d'assets à l'exécution — tout y est
procédural, et c'est ce qui lui permet de tenir en un seul fichier.

Souris : clic gauche pour orbiter · clic droit pour la panoramique · molette
pour zoomer.

## CRÉATURE — régler le scolopandre

**Il n'y a pas de modeleur, et c'est normal** : le scolopandre n'est pas un
maillage, c'est un algorithme. Son corps est reconstruit à chaque image à partir
de sa trace, de son état et d'une quarantaine de paramètres. Il n'y a pas de
sommets à déplacer, il y a des nombres à régler.

L'onglet expose ces nombres et rejoue le **vrai** code de `creatures/geometrie.js`.
Ce qui tourne là est littéralement la bête du jeu.

L'état (`traque`, `écoute`, `poursuite`…) change la grammaire des yeux et la
cadence des pattes. La trace est factice — en jeu le corps suit l'historique des
positions de la tête, qui est vide à l'arrêt — et son étirement et sa courbure
se règlent, ce qui permet de juger l'ondulation.

## Enregistrement

**Navigateur** — automatique, à chaque modification. Le jeu lit le plan au même
endroit : « éditer puis jouer » ne demande aucune manipulation.

**Fichier `.json`** — par les boutons, ou en glissant un fichier sur la page.
C'est ce qu'on met sur le dépôt.

Un projet ne conserve de `SETUP` **que les valeurs modifiées**. Enregistrer
`SETUP` en entier figerait les défauts du jour ; en ne gardant que les écarts, un
projet reste valable après une mise à jour du jeu.

## Vérification

```sh
python outils/smoke_editeur.py
```

Joue une séance complète en headless : trace une zone, lui impose un biome, lui
interdit les villages, **génère et vérifie que le générateur a suivi**, charge
les 21 types d'éléments, fait tourner la créature, enregistre et relit.

Le point qui compte est le troisième : un éditeur qui dessine sans que le
générateur suive ne sert à rien.
