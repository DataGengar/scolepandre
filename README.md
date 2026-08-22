# SCOLOPANDRE

Un jeu d'horreur souterraine en WebGL2 brut. Zéro dépendance, zéro build
obligatoire, un moteur maison.

> Elle est aveugle. Elle ne connaît que le sol qui tremble et l'odeur que tu
> laisses. Ramper n'imprime aucune trace.

---

## Jouer

```sh
python -m http.server 8000
```

puis <http://localhost:8000>.

Un serveur est nécessaire : les modules ES et les images de cartes sont bloqués
en `file://`.

**Version fichier unique** (double-cliquable, sans serveur) :

```sh
python outils/bundler.py      # → dist/scolopandre.html
```

Les GIF de cartes exigent toujours un serveur ; le monde, lui, se joue hors ligne.

## Commandes

| touche | action |
|---|---|
| `ZQSD` / `WASD` | avancer |
| `MAJ` | courir |
| `C` (ou `MAJ.VERR` pour basculer) | ramper — **n'imprime aucune trace** |
| `F` | lampe de poche |
| `CLIC DROIT` (maintenu) | brandir la lampe : les petits reculent, le jus fond |
| `CLIC` ou `ESPACE` | lancer un leurre |
| `G` | allumer un feu de camp (il faut du bois) |
| `V` | lancer une fusée de détresse |
| `B` | poser une pancarte · à côté d'une : la lire · `MAJ+B` : la retirer |
| `E` | cachette, ou échelle de passerelle |
| `TAB` | sismographe |
| `I` | collection |
| `P` | réglages |
| `R` | nouveau monde |
| `ÉCHAP` | menu (rend la souris) |

### Survivre

- **On ne combat pas la mère.** Elle tue au contact, quoi qu'il reste de santé.
- **Les petits, si.** Le feu les repousse : feu de camp, fusée, lampe brandie.
  Un leurre les fixe aussi. Ils mordent au lieu de tuer net.
- **Le froid** ronge en surface, beaucoup moins en profondeur : descendre
  réchauffe. Les villages ont des braseros et des trousses médicales.
- **Les villages** ont une place barricadée où rien n'entre. Les trousses ne
  repoussent pas.

---

## Où trouver quoi

```
index.html            coquille HTML + style, aucune logique
src/
  setup.js            ★ TOUTES les valeurs réglables
  jeu.js              assemblage + boucle principale
  noyau/              maths, RNG, WebGL, shaders
  monde/              terrain, gouffres, ponts, cachettes, villages, décor
  carte/              ★ les 3 rangs de cartes et leurs dossiers
  creatures/          la mère, les jeunes, leurs lueurs, leur maillage
  joueur/             déplacement, froid, santé, chute, feu, leurres
  audio/              nappes, vent, cavernes, effondrements, créature
  rendu/              caméra, lumières, lune, pipeline, sismographe
  ui/                 menu, HUD, réglages
outils/               vérification, bundler, éditeur de carte, pipeline OBJ
cartes/               tes stacks : communes/ rares/ legendaires/
archives/             les versions monofichier v1 et v2
dist/                 le fichier unique généré
```

**Chaque dossier a son propre `README.md`** qui dit ce qu'il contient et quel
fichier ouvrir pour quelle modification.

### Les deux fichiers que tu ouvriras le plus

- **`src/setup.js`** — tout ce qui se règle. Aucun autre fichier n'écrit un
  nombre réglable en dur.
- **`src/carte/rangs.js`** — les chemins de tes trois dossiers de cartes.

---

## Comment les modules restent synchronisés

Quatre mécanismes, pas une intention :

1. **Une source unique par valeur.** `setup.js` pour les nombres,
   `monde/biomes.js` pour les biomes, `carte/rangs.js` pour les stacks. Les
   modules lisent, ils ne recopient pas. `SETUP.abonner(chemin, fn)` permet à un
   module de réagir quand une valeur change en jeu.

2. **Le panneau de réglages se construit tout seul** depuis `SETUP.CURSEURS`.
   Ajouter un réglage = ajouter une ligne.

3. **`outils/verifier.py`** refuse un projet incohérent : import vers un symbole
   non exporté, `export let` réassigné, clé de `SETUP` jamais lue, curseur
   orphelin, table des biomes désynchronisée de l'éditeur, module que personne
   n'importe.

4. **`outils/bundler.py` résout lui-même le graphe d'imports** et échoue
   bruyamment plutôt que de produire un fichier cassé.

---

## Développer

```sh
python outils/syntaxe.py      # délimiteurs équilibrés dans tous les .js
python outils/verifier.py     # cohérence du projet
python outils/smoke.py        # LANCE LE JEU pour de vrai, 30 s, sans GPU
python outils/bundler.py      # produit dist/scolopandre.html
```

`smoke.py` est l'outil important : il exécute le jeu dans Chrome headless avec
un faux contexte WebGL, joue tout seul pendant trente secondes (marche, leurre,
cachette, effondrement, froid extrême, régénération) et rapporte la moindre
exception — plus un relevé de ce qui a été *traversé* : paliers de froid
franchis, états de la créature vus, jeunes restés bloqués, morts.

### Console de mise au point

Ouvre `index.html?debug` : `window.SCOLO` expose `SETUP`, le joueur, la
créature, les jeunes, le froid. Utile pour régler à chaud.

```js
SCOLO.SETUP.creature.yeux.poursuite.taille = 3
SCOLO.rapport()
SCOLO.regenerer()
```

### Dessiner une carte à la main

Ouvre `outils/releve.html`, dessine, exporte un PNG, **glisse-le sur la fenêtre
du jeu**, puis `R`. Le relief que tu as tracé n'est pas relaxé : tes falaises
restent tes falaises.

Après toute modification de `src/monde/biomes.js`, relance
`python outils/exporter_biomes.py` pour que l'éditeur reste en phase.

---

## Suivi

[`WHATS_NEW.md`](WHATS_NEW.md) — ce qui a été demandé, ce qui est fait, ce qui
reste.
