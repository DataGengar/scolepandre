# WHAT'S NEW

Suivi de l'évolution du projet. Trois sections : **demandé**, **implémenté**,
**à faire**.

---

# v3.2 — 23 août 2026 · lisibilité, connexité, greedy meshing

Le fichier jouable est **`dist/scolopandre.html`**, présent sur le dépôt.

## LE BUG QUI RENDAIT LES PANCARTES ILLISIBLES

« Je ne peux pas lire les pancartes ! »

`flash()` et le message de palier de froid écrivaient tous les deux dans
`#alerte`, **sans arbitrage**. Comme `flash()` déposait son texte dans
`dernierMessage` et que la mise à jour du HUD tourne cinq fois par seconde, la
comparaison `froid.message !== dernierMessage` était vraie à l'itération
suivante — et le HUD effaçait le flash au bout de **200 ms**.

Ça ne touchait pas que les pancartes : *aucun* message transitoire n'était
lisible. Ni « À L'ABRI », ni « FEU ALLUMÉ », ni « EFFONDREMENT ».

Un seul écrivain désormais, avec une priorité explicite (flash > palier > rien).
Et surtout : **la lecture d'une pancarte est passive**. Un panneau dédié
s'affiche dès qu'on est à portée et y reste. `B` ne sert plus qu'à écrire.
Chaque pancarte pose aussi **un point cyan clignotant sur le sismographe**, à
toute distance — c'était l'intérêt même de la mécanique.

## LES RAMPES NE RELIAIENT RIEN

« Les plateformes ne fonctionnent pas, elles sont un peu placées au hasard, sont
inaccessibles et ne mènent nulle part. »

C'était littéral. L'ancienne fonction tirait **une cellule au hasard**, regardait
si elle avait par chance un voisin plus bas, et y bâtissait un escalier. Elle ne
se demandait jamais si cette falaise séparait quoi que ce soit.

Nouveau module **`src/monde/connexite.js`** :

1. calcul des **composantes connexes** du sol praticable, avec la vraie règle du
   joueur — deux cellules ne sont reliées que si la marche passe **dans les deux
   sens**. Une corniche d'où l'on saute sans pouvoir remonter ne relie rien ;
2. pour chaque morceau isolé qui compte, on cherche la frontière où le
   franchissement est le **moins cher** ;
3. on y taille un escalier d'éboulis, et on recommence.

Mesuré : **176 morceaux → 1 seul morceau significatif isolé**, avec **21 rampes**
au lieu de 140. Beaucoup moins nombreuses, et chacune relie deux régions qui
étaient réellement coupées.

## GREEDY MESHING — ET SON RÉSULTAT RÉEL

Implémenté sur les trois surfaces : fusion 2D des sols et plafonds, fusion 1D
des parois. Les mesures, honnêtement :

| | avant | après |
|---|---|---|
| sols + plafonds | — | **−15 % de quads** |
| parois | — | −4 % |
| cellules à sol plan | 21 % | 36 % |

Deux constats en cours de route, tous deux mesurés :

- **La moucheture bloquait tout.** Elle était tirée par cellule via `hash2(x,z)`
  et quantifiée en cinq paliers : deux voisines partageaient leur palier une
  fois sur cinq, la plage fusionnable moyenne tombait à 1,25 cellule. Même une
  salle parfaitement plate ne pouvait pas fusionner, **uniquement à cause de la
  couleur**. Elle est maintenant tirée par bloc de 4 × 4 cellules.
- **Je m'attaquais au mauvais tiers.** Les parois représentaient **61 %** de la
  géométrie (45 786 quads contre 29 064) et n'étaient pas fusionnées du tout.

**Pourquoi le gain reste modeste, et c'est structurel :** le greedy meshing paie
énormément sur un monde de voxels, où tout est plan par construction. Ici le
terrain est un **champ de hauteur lissé** — les cavernes portent un bruit par
cellule, les couloirs interpolent leur altitude, la relaxation crée des pentes.
Seules 36 % des cellules ont un sol réellement plan, et `cornerH` biseaute les
coins dès qu'un voisin diffère. Aller plus loin voudrait dire changer la nature
du terrain, ce qui est une décision d'esthétique, pas une optimisation.

Ce qui a été fait dans ce sens : `SETUP.monde.quantifierRelief` arrondit les
altitudes à 25 cm. Le lissage de `cornerH` le rend presque invisible, le pas
reste cinq fois inférieur à la marche du joueur, et les cellules planes passent
de 21 % à 36 %. Mets-le à `0` pour le désactiver.

## LE RESTE

**Saut** — `ESPACE`. Le monde était devenu trop vertical pour s'en passer. Apex
0,96 m, ce qui permet de se hisser à 2,21 m ; **elle en franchit 2,90**, donc
l'asymétrie verticale — un pilier du jeu — est préservée avec 0,7 m de marge.
Sauter fait du bruit. Le leurre passe au clic gauche seul.

**Se dégager** — `D`. Le moteur bâtit son terrain par champ de hauteur : il
finira toujours par coincer quelqu'un quelque part, et ce n'est pas la faute du
joueur. La touche cherche une cellule d'accueil en spirale, **jamais un
gouffre**, la plus proche possible, et fait du bruit en le faisant.

**Visibilité divisée par deux** — la v3.1 avait sur-corrigé : on voyait à 40 m,
ce qui vide la brume de son intérêt. Fog 1,05 → 2,10, godrays 1,35 → 0,65.

**Cartes** — nouveau programme de rendu **texturé** (`src/rendu/carte-rendu.js`),
avec son propre quad et ses UV. Les illustrations s'affichent vraiment dans le
monde, découpées par leur canal alpha. Cadre ramené à un liseré de 1,8 cm au
lieu d'une bordure de 12 cm, flottement abaissé de 1,10 m à 0,62 m et amplitude
réduite de moitié, son de ramassage relevé d'environ 50 %.

`python outils/gabarit_carte.py` génère neuf cartes d'essai au format 3:4 avec
liseré de découpe et coins arrondis. **Les rangs passent en PNG** : le GIF n'a
qu'un bit de transparence et déchiquette les coins arrondis.

**Objets au sol** — le bois devient trois branches croisées, la fusée un tube
avec sa coiffe, la trousse une mallette plate à croix, le leurre deux éclats de
pierre. C'étaient des cubes de 40 à 55 cm.

**Villages** — rien sur la carte au départ, comme demandé. On entre une fois
dans la place barricadée, le village est **marqué pour de bon** (sauvegardé par
graine). Chacun a maintenant une **cabane** où chaleur et santé remontent au
maximum, sans consommer de ressource : le prix, c'est le trajet.

## COMMANDES À JOUR

`ESPACE` sauter · `CLIC` leurre · `CLIC DROIT` brandir la lampe · `F` lampe ·
`C` ramper · `E` cachette / échelle · `G` feu de camp · `V` fusée ·
`B` écrire sur une pancarte (`MAJ+B` la retirer) · **`D` se dégager** ·
`TAB` sismographe · `I` collection · `P` réglages · `R` nouveau monde

## CE QUI RESTE

- **Le rendu n'a toujours pas été vu, ni l'audio écouté.** WebGL est simulé dans
  le test ; tous les chiffres de lumière et de géométrie sont calculés.
- La mère ne monte pas sur les passerelles (navigation à un seul étage).
- Monolithe et tour à fenêtres sont encore des boîtes.

---

# v3.1 — 22 août 2026 · « on ne voit rien »

Deuxième passe de test. Vingt-deux retours, dont plusieurs régressions
introduites par la v3.0. Le fichier jouable est **`dist/scolopandre.html`**, et
il est désormais SUR le dépôt : `dist/` n'est plus dans le `.gitignore`.

## 1. LE DIAGNOSTIC D'ABORD

Avant de toucher quoi que ce soit, j'ai mesuré. Trois chiffres expliquent la
moitié des retours :

| mesure | v3.0 | cause |
|---|---|---|
| objet visible à 10 m | **2 % à 17 %** | fog à 2,625 (« 75 % du max », pris au mot) |
| densité de lumières | **÷4 vs v2** | grille passée à 1088² sans toucher `maxLumieres` |
| densité de décor | **÷4 vs v2** | même oubli sur `semis` |
| son de la créature à 30 m | **1 % du signal** | distance appliquée DEUX fois |

Les deux « ÷4 » sont ma faute directe : j'ai quadruplé le nombre de cellules en
v3.0 et laissé les compteurs de décor et de lumières inchangés. Le monde était
donc littéralement quatre fois plus vide et plus noir qu'en v2.

## 2. CE QUI A ÉTÉ CORRIGÉ

### On ne voyait rien

| | avant | après |
|---|---|---|
| fog | 2,625 | **1,05** — 42 % de visibilité à 20 m au lieu de 0,05 % |
| ambiante des biomes | 0,010 – 0,115 | **0,15 – 0,34** |
| vignette | 92 % des bords | **55 %** |
| lumières dans le monde | 3 200 | **~9 000** |
| éléments de décor | ~8 000 | **~20 000** |

**La torche devient une lampe de poche.** Le vieux cône `pow(cos,3)` avec une
atténuation `exp(-d×0,085)` ne laissait que 18 % à 20 m. Le nouveau faisceau a
un cœur net (`smoothstep` entre deux angles), une nappe faible autour, et une
portée réelle : **57 % à 20 m, 33 % à 40 m**.

**Les lumières du décor mouraient à 5 m** (16 %). L'atténuation est réglable et
desserrée : **59 % à 10 m, 21 % à 20 m**. Cristaux, fenêtres et braseros
éclairent enfin la pièce.

**Nouvelles sources** : champignons luminescents dans le souterrain (vert froid,
qui contraste avec l'orange des cristaux), lampadaires qui marchent encore deux
fois sur trois, plafonniers de voiture, braseros de village.

### La lune brisée

`src/rendu/lune.js`. Dehors seulement : un corps amputé d'un quartier, onze
fragments qui s'échappent le long de l'ancienne ligne de rupture, et une
poussière d'éclats plus loin. Dessinée comme un fond de ciel (profondeur
coupée, `uCiel=1` pour sauter la brume). Elle n'éclaire presque pas — c'est
l'ambiante du biome qui porte la clarté.

### Il neigeait sous terre

La neige suivait le BIOME, et la glacière est souterraine. Elle suit maintenant
l'**ouverture réelle du ciel au-dessus du joueur**, et la glacière n'a plus de
`snow` du tout : elle a du givre sur les parois, pas des flocons.

### Les biomes étaient placés au hasard

Le biome était tiré par l'INDICE de la salle dans le plan, pas par sa
profondeur. Deux salles voisines à la même altitude pouvaient être de biomes
différents. Le monde a maintenant une **stratigraphie**, et le biome est une
FONCTION DE L'ALTITUDE, rien d'autre :

```
−131 … −85   BARRAGE            l'ouvrage noyé, tout au fond
 −85 … −45   GLACIÈRE           les grottes de glace
 −45 … +10   SOUTERRAIN         la roche nue, le gros du monde
 +10 … +70   VILLE ENSEVELIE    ce qu'il reste des gens
 +70 …       SURFACE GELÉE      dehors, la neige, la lune
```

La frontière est brouillée de quelques mètres par un bruit déterministe : une
coupe parfaitement plane ferait maquette.

### Les plateformes flottaient

Elles étaient posées au MILIEU des salles dégagées et ne reliaient rien.
Supprimées. À la place, des **rampes d'éboulis** : on cherche les falaises et on
y taille un escalier, marche par marche, chacune franchissable. On ne creuse
jamais dans la roche — on relève des cellules de sol déjà praticables du côté
bas. ~140 par monde, avec deux repères lumineux au pied et au sommet.

### On n'entendait pas les scolopandres

**La distance était appliquée deux fois** : le PannerNode atténuait, et une
courbe explicite atténuait encore par-dessus. Il restait 1 % du signal à 30 m et
0,01 % à 80 m.

Le panner ne sert plus qu'à donner la DIRECTION (`refDistance` 30, rolloff
0,15), la courbe porte seule l'éloignement. Gain à 30 m : **0,010 → 0,39**.

Et il manquait le son de proximité. Nouvelle couche **PANIQUE** sous 14 m :
stridence dissonante qui monte, souffle de mandibules, cœur qui cogne de plus en
plus vite. C'est le « elle est SUR toi » qui n'existait pas.

### Le drone n'était pas grave

Paradoxalement parce qu'il était TROP bas : les fondamentales à 16–27 Hz sont
sous le seuil d'audition et absentes de n'importe quel haut-parleur. On
n'entendait pas un grave, on n'entendait rien.

Quatre voix maintenant : un sub à la fréquence réelle (le poids), la tonique
remontée d'une octave (33–55 Hz, le grave qu'on entend), la quinte, et une
**neuvième mineure** très en retrait — c'est la dissonance tenue qui fait peur,
pas la hauteur. La mélodie descend de deux octaves. Plus un **grondement** de
bruit brun filtré qui balaie lentement sous le tout.

### Le son saturait

Le gain maître valait **1,41** — au-dessus de 1, donc écrêtage permanent, vent
ou pas. Ramené à 0,82 max, et un **écrêteur doux** (WaveShaper en tanh) arrondit
les crêtes en bout de chaîne au lieu de les couper.

### Le froid mordait trop vite

45 secondes de 100 à 0 sur la surface gelée, et trois braseros seulement sur
1 632 m. Divisé par ~4 (surface : **4 minutes**), le vent compte deux fois
moins, et il y a maintenant **14 braseros**, les villages, et les feux de camp.

Surtout : **le froid ne tue plus d'un coup**. À zéro il ronge la santé, ce qui
laisse le temps d'atteindre un feu.

### Les cartes n'avaient plus leur bordure ni leur son

Le shader ne teintait PAS l'émissif (`vC*uEmit` au lieu de `vC*uTint*uEmit`) :
le halo sortait blanc au lieu de porter la couleur du rang. Corrigé, plus trois
passes de rendu (face, liseré, halo diffus) et **la carte la plus proche est une
vraie source de lumière**. Le son de ramassage passe à six voix et était de toute
façon noyé par la saturation.

### Les jeunes

**Trop rapides** : 4,2 m/s contre 3,2 en marche. Ramenés à **2,9**, avec une
endurance de 7 s puis 6 s de répit.

**Impossibles à leurrer** : ils ignoraient complètement les leurres. Un impact
les fixe maintenant dans un rayon de 26 m, pendant 7 s. Et **le feu les
repousse** — feu de camp, fusée, ou lampe brandie.

**Moches et risibles** : c'était la même recette que la mère, une chaîne de
tubes coniques. Corps entièrement refait — une larve cuirassée basse et large,
huit plaques dorsales qui se chevauchent, une tête distincte à mandibules en
crochet, un abdomen translucide qui pulse, quatre yeux en grappe, douze pattes
anguleuses à contact réel.

### Le nom

**scolopandre**, pas scoléopandre. Renommé partout (le dépôt GitHub s'appelait
déjà `scolepandre`).

## 3. CE QUI A ÉTÉ AJOUTÉ

### Vestiges humains

Cinq nouveaux éléments de décor : **maisons** crevées (un mur sur quatre tombé,
charpente sans toit), **voitures** sur le flanc ou sur le toit, jamais à
l'endroit, **lampadaires**, **pylônes** en treillis, **champignons**
luminescents.

### Villages engloutis — `src/monde/villages.js`

Une dizaine par monde. Maisons, carcasses et lampadaires en couronne autour
d'une **place barricadée** :

- la créature et les jeunes **refusent d'y entrer** ;
- quatre braseros : on s'y réchauffe presque comme à un refuge ;
- une à trois **trousses médicales, épuisables** — elles ne repoussent pas ;
- du bois empilé contre les maisons.

Le prix : c'est fixe, donc il faut y retourner, et c'est éclairé, donc tout ce
qui rôde sait où c'est.

### Santé — `src/joueur/sante.js`

Il n'y en avait aucune : on mourait d'un coup, ce qui rendait les trousses
absurdes. 100 points. Morsure de jeune −22, chute −9/m, froid à zéro −3,5/s.
Régénération très lente après 12 s sans blessure. Trousse +45.

**La mère tue toujours net.** Lui opposer une barre de vie la banaliserait.

### Feu — `src/joueur/feu.js`

Trois demandes, une seule idée : le feu chauffe, éclaire et repousse.

- **BOIS** (six max) → **feu de camp** (`G`), 150 s, réchauffe dans 6 m,
  repousse les petits dans 9 m ;
- **FUSÉE** (`V`), 26 s, éclaire dans **14 m** — c'est l'outil pour LIRE une
  salle d'un coup ;
- **LAMPE BRANDIE** (clic droit maintenu) : ils reculent, mais le jus fond sept
  fois plus vite. Dernier recours, jamais une stratégie.

Aucun n'a d'effet sur la mère. Elle est aveugle : le feu ne lui dit rien.

### Pancartes — `src/monde/pancartes.js`

`B` pour poser une pancarte avec un message, `B` à côté pour la lire, `MAJ+B`
pour la retirer. Une **loupiote qui clignote** — le seul élément du jeu qui
clignote, donc immédiatement lisible comme artificiel, donc comme le tien.
Sauvegardées par graine de monde.

## 4. VÉRIFICATION

`outils/smoke.py`, sur les modules **et** sur le bundle, zéro erreur :

```
génération 1,5 s
390 salles · 42 gouffres · 147 rampes · 260 ponts · 16 cachettes · 11 villages
19 800 éléments · 9 000 lumières       ← 2,5× et 2,8× la v3.0
altitude −131 … +141 m
paliers de froid traversés : les quatre
états créature vus : traque, écoute, approche, fouille, poursuite
JEUNES BLOQUÉS : 0
chute sismique, cachette, passerelle : déclenchés
```

Un bug trouvé au passage : un **accent grave dans un commentaire GLSL** fermait
le template literal qui l'englobait, et la page ne démarrait plus du tout.
Invisible à la lecture, et l'équilibre des délimiteurs restait juste puisqu'il y
en avait deux. `outils/syntaxe.py` a maintenant une règle pour ça.

## 5. CE QUI RESTE

- **Le rendu n'a toujours pas été vu.** WebGL est simulé dans le test. Tous les
  chiffres de lumière ci-dessus sont calculés, pas observés. C'est ton prochain
  lancement qui tranchera. Quatre curseurs ont été ajoutés au panneau RÉGLAGES
  pour que tu puisses ajuster sans moi : **Lumière ambiante**, **Vignette**,
  **Puissance de la lampe** et **Portée de la lampe**.
- **L'audio n'a pas été écouté.** Le graphe se monte sans erreur.
- Le monolithe et la tour à fenêtres restent des boîtes : ils mériteraient le
  même traitement que les maisons.
- La mère ne monte toujours pas sur les passerelles (navigation à un étage).

---

# v3 — 22 août 2026

Refonte complète : le jeu passe d'un fichier unique de 2 846 lignes à 48 modules
ES organisés par domaine, plus un lot de changements de contenu.

## 1. DEMANDÉ

Reproduit tel quel, pour qu'on puisse cocher.

1. Normaliser le code en modules clairs et succincts, en dossiers par élément du
   jeu, avec les liens synchronisés en cas de mise à jour d'un module. Classes
   recommandées. Il est crucial de savoir où trouver quoi.
2. Regrouper les paramètres et valeurs modifiables à la volée dans un fichier
   commun de type `setup`.
3. Créer explicitement un module **carte** avec les 3 rangs, où renseigner le
   chemin des stacks de cartes collectionnables.
4. Son ambient : plus mélodieux, plus sombre, plus fort.
5. Son des scolopandres : revoir, et accroître la distance d'audition.
6. Caméra : trembler davantage en présence d'un scolopandre en mouvement.
7. Le personnage peut chuter à cause des mouvements sismiques.
8. Scolopandres : yeux rouges lumineux, flippants, visibles de loin. Si les
   yeux changent de couleur ou grossissent, c'est qu'ils veulent te bouffer.
   Pattes lumineuses. Interstices de carapace lumineux pour attirer les proies.
   Les rendre terrifiants.
9. Falaises, gouffres sans fond, précipices, ponts suspendus.
10. Hauteur de la map ×3, taille des blocs ÷2 (plus granulaire).
11. Accroître le polycount des objets et des carcasses.
12. Le système de froid ne fait rien : implémenter une règle et s'y tenir.
13. Pas assez de cachettes de survie — littéralement des trous. Peu dans le
    monde, mais visibles discrètement sur la carte.
14. Dossiers propres, commentaires explicatifs.
15. Des mini-scolopandres (jeunes) restent bloqués ou immobiles. Rectifier.
16. Fog et godrays à 75 % du max comme standard.
17. Travailler à fond l'ambiance sonore : d'autres sons, meilleures fonctions
    génératives.
18. Ajouter le bruit du vent, des cavernes, des effondrements dynamiques.
19. Rendre les lieux souterrains plus exigus.
20. Tout synchroniser sur le dépôt GitHub, avec suivi et mémo « what's new ».

## 2. IMPLÉMENTÉ

### 1 · Modularisation — `src/`

48 modules ES répartis en 8 dossiers par domaine. Chaque dossier a son
`README.md` qui dit ce qu'il contient et quel fichier ouvrir pour quelle
modification. Chaque fichier s'ouvre sur un commentaire expliquant son rôle et,
quand il corrige quelque chose, ce qui n'allait pas avant.

`jeu.js` ne contient plus aucune règle : il branche les modules et fait tourner
la boucle.

Sur les classes : elles sont utilisées là où il y a un état encapsulé à
protéger (`Heap` dans `monde/navigation.js`). Ailleurs, les modules ES donnent
déjà l'encapsulation qu'on cherchait, et un singleton de classe n'aurait été
qu'un objet avec des étapes en plus. C'est un écart assumé à la recommandation.

### 1b · Synchronisation des liens — quatre mécanismes

| mécanisme | ce qu'il empêche |
|---|---|
| `src/setup.js` source unique + `abonner()` | qu'une valeur existe en deux exemplaires divergents |
| `src/monde/biomes.js` → `outils/biomes.json` | que l'éditeur de carte et le jeu codent les biomes différemment |
| `outils/verifier.py` | 6 classes d'incohérence, listées ci-dessous |
| `outils/bundler.py` | qu'un export renommé produise un fichier cassé au lieu d'une erreur |

`verifier.py` contrôle : imports vers un symbole non exporté · `export let`
réassigné · clé de `SETUP` jamais lue · curseur orphelin · `biomes.json`
désynchronisé · module que personne n'importe.

### 2 · `src/setup.js`

Toutes les valeurs réglables du jeu, en un arbre commenté. **Aucun autre fichier
n'écrit un nombre réglable en dur.** Le panneau RÉGLAGES en jeu se construit
tout seul à partir de `SETUP.CURSEURS` : ajouter une ligne suffit à faire
apparaître un curseur fonctionnel.

Bonus : `index.html?debug` expose `window.SCOLO` pour régler à chaud depuis la
console du navigateur.

### 3 · Module carte — `src/carte/`

`rangs.js` est **le seul fichier à ouvrir** pour brancher tes stacks :

```js
export const RANGS = [
  { id:'commune',    chemin:'cartes/communes/',    ext:'gif', profondeurMin:0.00 },
  { id:'rare',       chemin:'cartes/rares/',       ext:'gif', profondeurMin:0.45 },
  { id:'legendaire', chemin:'cartes/legendaires/', ext:'gif', profondeurMin:0.78 },
];
```

Le jeu sonde chaque dossier (`1.gif`, `2.gif`… jusqu'à trois échecs) : aucune
liste à tenir. **Trois rangs partout** — la v2 en déclarait 3 côté dossiers mais
4 côté raretés, reliés par un `Math.min(3, stack)` bancal ; c'est normalisé.

La collection est désormais sauvegardée dans le navigateur (`localStorage`) :
elle survit à un rechargement.

### 4 · Nappe ambient — plus mélodieuse, plus sombre, plus forte

La v2 faisait une marche aléatoire sur une gamme : un mouvement brownien, pas
une mélodie. Trois changements dans `audio/nappes.js` :

- **Harmonie.** Chaque drone a un mode sombre (phrygien, mineur harmonique,
  locrien) et une progression de 4 à 5 accords tenus 25–50 s en fondu croisé.
  La voix mélodique choisit ses notes *dans l'accord courant*. Une voix médiane
  tient la tierce et glisse d'un accord au suivant : c'est le mouvement
  harmonique qu'on entend.
- **Registre.** Fondamentales descendues à 16–28 Hz (contre 20–37).
- **Niveau.** Courbe de volume 1,55 → 1,20 · limiteur −12 dB/12:1 → −8 dB/6:1
  (il compressait la nappe en permanence) · gain des notes 0,30 → 0,52 · volume
  par défaut 82 → 90.

Nouvel événement lent : le **soupir**, un glissando descendant de 11 s sur la
quinte diminuée.

Règle conservée : un drone ne se transforme jamais en un autre.

### 5 · Son de la créature — portée très accrue

`audio/creature-audio.js` : `maxDistance` 40 → **110 m**, rolloff 1,1 → 0,75,
courbe de menace 34 → **95 m**, jeunes 22 → **55 m**. Nouveau **sub d'infrasons
à 14 Hz audible jusqu'à 150 m**, hors panner (un son de 14 Hz n'est pas
localisable) : on la sent avant de l'entendre. Le cri gagne une seconde voix une
octave plus bas. Les jeunes stridulent entre eux.

### 6 · Tremblement de caméra

`rendu/camera.js`. La v2 valait `sin(t·47)×0,035` — invisible, et surtout **sans
roulis**, or c'est le roulis qui fait sentir que le *sol* bouge. Maintenant :
amplitudes ×3,5, trois sinusoïdes incommensurables par axe, et `rotZ` ajouté à
la chaîne de vue. L'intensité dépend de la distance, de **la vitesse réelle** de
la créature et de son état — une créature immobile ne fait pas trembler le sol.

### 7 · Chute sismique

`joueur/chute.js`. Au-delà de `seuilChute` (0,55), tirage proportionnel à
l'excès. Tomber met au sol 1,4 s sans aucun contrôle **et émet une vibration de
rayon 22** : tomber te trahit. Gère aussi la chute de falaise (sonné à 6 m, mort
à 14 m) et la chute dans le vide.

### 8 · Terreur — `creatures/lueurs.js`

**Yeux.** Deux bulbes émissifs, injectés dans le tableau de lumières du rendu :
ils produisent donc des **godrays rouges dans le fog** et se voient bien avant
la silhouette. Grammaire constante :

| état | couleur | taille |
|---|---|---|
| traque / retrait | rouge sombre | ×1,0 |
| écoute | rouge **fixe**, sans pulsation | ×1,0 |
| approche / fouille | rouge vif, pulsation lente | ×1,3 |
| poursuite | **orange-blanc**, pulsation rapide | **×2,2** |

Fondu de 0,4 s : assez pour voir le changement, trop court pour réfléchir.

**Pattes lumineuses** : tarses et griffes émissifs, palpitant avec la vague de
marche — on lit sa démarche dans le noir.

**Interstices de carapace** : bandes bioluminescentes entre les anneaux. Elles
pulsent au repos (leurre à proies) et **s'éteignent** en poursuite :
l'extinction est le signal d'attaque.

Plus : maxillaires (crochets sous les mandibules), antennes à 7 segments.

### 9 · Falaises, gouffres, précipices, ponts

Le point délicat. La v2 relaxait *tout* le champ de hauteur pour garantir
l'absence de cul-de-sac — ce qui interdisait toute falaise. La v3 ne relaxe que
le long d'une **épine navigable** (le chemin reliant les salles, plus une
marge). Hors épine, le dénivelé brut survit : ce sont les falaises.

- **Gouffres sans fond** : 42 fosses creusées à l'intérieur du monde
  (`monde/relief.js`), 20–64 m de long. On y tombe et on meurt.
- **Précipices** : la lèvre est marquée, relevée de 12 cm, et éclairée en
  rasant. On voit le trou arriver dans le fog au lieu d'y tomber bêtement.
- **Ponts suspendus** : 260, dont **un par gouffre en priorité** — un gouffre
  infranchissable couperait la carte, un gouffre avec un pont est un choix.
- **On marche dessus.** Le second étage est implémenté : `E` sur une échelle
  (aux deux bouts de chaque tronçon) monte sur le tablier, `E` redescend. Le
  tablier fait exactement une cellule de large — 1,5 m au-dessus d'un gouffre
  sans fond, sans rambarde. Sortir par le côté ne bloque pas : tu tombes.
  Conséquence à connaître : **la créature ne monte pas sur les ponts**, sa
  navigation reste à un seul étage. Un tablier est donc un répit — jusqu'à ce
  qu'il faille redescendre.
- Le maillage descend la paroi d'un gouffre de 40 m : c'est un puits, pas une
  flaque noire.
- Le sismographe montre les gouffres en noir plein cerné de rouge sourd.

### 10 · Granularité et verticalité

| | v2 | v3 |
|---|---|---|
| cellule | 3,0 m | **1,5 m** |
| grille | 544² | **1088²** (1,18 M cellules) |
| monde | 1632 m | 1632 m (inchangé) |
| altitude | −42 … +44 m | **−126 … +132 m** (×3) |

Deux réécritures rendues nécessaires, sans quoi la génération devenait
injouable :

- `relaxHeights` faisait 120 passes sur toute la grille (142 M d'itérations) →
  **file d'attente circulaire**, coût proportionnel au nombre de corrections.
- Le calcul d'ouverture faisait 49 lectures par cellule (58 M d'accès) →
  **image intégrale**, deux passes linéaires.

Résultat mesuré : **génération en 1,4 s**, contre les 5–15 s estimées.

### 11 · Polycount

`monde/props.js` disposait uniquement de boîtes à 6 faces. Trois primitives
maintenant, toutes pilotées par `SETUP.image.detail` (curseur en jeu) : boîte,
**colonne** (prisme à N côtés) et **éclat** (roche irrégulière).

Reprises en détail : piliers cannelés · arches à vrais voussoirs · stalactites
au plafond (le plafond était nu) · troncs à branches · souches à racines ·
conduits à colliers.

**Carcasses** : les os deviennent de vrais os (diaphyse fine, épiphyses renflées
aux deux bouts) · les côtes sont des arceaux courbes à 4 segments avec des
vertèbres réelles, plus un peigne de barreaux · le crâne a un museau effilé, des
orbites creuses et une mandibule décrochée.

**Créature** : 46 → **64** segments, 16 → **22** anneaux, ~4 000 → **~14 000**
triangles, toujours en un seul appel de rendu.

### 12 · Le froid — une règle, tenue partout

La v2 perdait 0,0008 à 0,0046 par seconde pour un seul effet à peine
perceptible. C'était exact : ça ne faisait rien. `joueur/froid.js` porte
désormais la règle en toutes lettres :

```
perte/s = base(biome) × exposition × mouvement × torche × géothermie

  base        souterrain 0,35 · barrage 0,50 · ville 0,60
              glacière 1,60 · surface gelée 2,20
  exposition  1 + 1,4 × force_du_vent · ×0,5 sous plafond bas · 0 en cachette
  mouvement   marche 0,85 · course 0,70 · immobile 1,25 · rampé 1,10
  torche      allumée 0,55 · éteinte 1,00
  géothermie  −0,4 %/m sous 0 m, plancher ×0,35

gain/s = brasero +14 · cachette +3,5
```

| chaleur | palier | effets |
|---|---|---|
| 100–70 | — | aucun |
| 70–40 | **ENGOURDI** | vitesse ×0,88 · souffle audible (r=4) : **tu deviens repérable** |
| 40–15 | **GELÉ** | vitesse ×0,65 · champ −18 % · tremblement de main (visée et lancer imprécis) |
| 15–0 | **HYPOTHERMIE** | vitesse ×0,45 · champ −32 % · image désaturée · battement de cœur · 20 s à zéro = mort |

Jauge dédiée dans le HUD, message au franchissement de chaque seuil.

**Le pivot :** descendre réchauffe, et les cartes rares sont au fond. Le froid ne
combat pas la collection — il combat l'hésitation.

### 13 · Cachettes — `monde/cachettes.js`

16 trous creusés dans la roche : une entrée basse (rampé obligatoire) et une
alcôve de 2×2. `E` pour entrer.

Dedans : la créature ne perçoit **ni ton odeur ni tes vibrations** (`sense()`
sort immédiatement si `joueur.abrite`) · le vent ne t'atteint plus · la chaleur
remonte · le monde extérieur passe par un passe-bas à 520 Hz.

Sur le sismographe : un losange creux visible **seulement à moins de 30 m** —
discrètement visible, comme demandé. Il faut s'en approcher une fois pour les
connaître.

Ce n'est pas gratuit : on n'y voit presque rien, on n'y ramasse rien, et elle
continue de patrouiller.

### 14 · Dossiers et commentaires

12 `README.md` (un par dossier + la racine). Chaque module s'ouvre sur un bloc
qui explique son rôle et, pour les corrections, ce qui n'allait pas avant et
pourquoi. Les commentaires disent le *pourquoi*, pas le *quoi*.

### 15 · Jeunes bloqués — quatre causes, quatre correctifs

Ce n'était pas un bug mais quatre :

1. **Aucun repli au déplacement.** `if(isFree(nx,nz)){ j.x=nx; }` — bloqué, le
   jeune gardait son cap dans le mur pour toujours. → glissement le long de
   l'obstacle (X seul puis Z seul).
2. **Aucun contrôle de marche.** Il tentait des dénivelés que le relief refuse.
   → même test que la mère.
3. **Charge en ligne droite.** À moins de 13 m il visait le joueur sans tenir
   compte des murs et se coinçait en angle. → A* à petit budget, recalculé
   toutes les 0,8 s.
4. **`majJeunes` n'ajoutait qu'un jeune par appel** (un `break` inconditionnel)
   et recalculait le min/max d'altitude sur toute la grille 3 fois par seconde —
   insoutenable à 1,18 M de cellules. → boucle correcte, bornes mises en cache.

Plus un filet indépendant : **détecteur de blocage**. Moins de 0,3 m parcouru en
1,2 s → nouveau cap ; au bout de 2,5 s → repositionnement hors de vue. Aucun
jeune ne peut rester immobile plus de 2,5 s.

Vérifié : `python outils/smoke.py` rapporte `jeunesCoincesMax: 0` sur 30 s de
partie avec jusqu'à 12 jeunes simultanés.

### 16 · Fog et godrays à 75 %

`fog 1,55 → 2,625` (75 % de 3,5) et `rays 1,15 → 2,25` (75 % de 3,0). Visibilité
ramenée d'environ 35 m à environ 15 m. Les maxima des curseurs sont désormais
lus depuis `SETUP` et ne peuvent plus se désynchroniser des défauts.

Effet de bord bienvenu : moins de pavés à dessiner, donc plus fluide.

### 17–18 · Ambiance sonore, vent, cavernes, effondrements

**`audio/vent.js`** — bruit brun → deux passe-bande (souffle grave large,
sifflement aigu résonant) modulés par deux LFO incommensurables, plus des
rafales de 4 à 12 s. L'intensité suit le ciel ouvert, l'ouverture du lieu et la
proximité d'un gouffre. Nul en cachette. **Une seule source de vérité :** la
même valeur pilote le son, la dérive de l'odeur et l'exposition au froid.

**`audio/cavernes.js`** — gouttes d'eau (deux impulsions pour faire « plic » et
non « bip », plus un écho en boyau étroit), craquements de roche, résonances
lointaines. Tout spatialisé au hasard autour de l'auditeur. Le taux suit
l'exiguïté et l'humidité du biome. Longueur de réverbération par biome.

**`audio/effondrements.js`** — toutes les 60 à 180 s : grondement sub montant
sur 2 s, puis fracas (bruit brun filtré + 14 à 26 impacts secs étalés),
tremblement de caméra à 0,8 pendant 3 s, **vibration de rayon 60 émise dans le
monde — la créature accourt**, et le terrain se soulève localement en gravats.
Le vrai danger n'est pas la roche : c'est ce qu'elle attire.

**`audio/effets.js`** — souffle (l'effet audible du palier ENGOURDI, qui te rend
repérable), battement de cœur en hypothermie, entrée et sortie de cachette,
impact de chute.

### 19 · Souterrains plus exigus

Plafond : `2,8 + openN×3,2` → **`1,9 + openN×2,1`**. Sous 1,30 m le rampé est
forcé — ce qui a un intérêt mécanique direct puisque ramper n'imprime aucune
trace. Les cachettes ont une entrée à 0,95 m.

### 20 · GitHub

Dépôt initialisé, `.gitignore`, commits séquentiels lisibles, poussé sur `main`.
Ce fichier tient le suivi.

---

## 3. VÉRIFICATION EFFECTUÉE

Pas de moteur JavaScript en ligne de commande sur cette machine, mais Chrome est
là : `outils/smoke.py` exécute le jeu en headless avec un faux contexte WebGL et
le joue seul pendant 30 s.

Dernier relevé, sur les modules **et** sur le bundle, **zéro erreur** :

```
génération        1,4 s
monde             390 salles · 42 gouffres · 260 ponts · 16 cachettes
                  8 000 éléments · 3 222 lumières
altitude          −131 m … +136 m           ← la verticalité ×3
distance parcourue 1 124 m
paliers de froid  —, ENGOURDI, GELÉ, HYPOTHERMIE   ← les quatre traversés
états créature    traque, écoute, approche, fouille, poursuite
secousse max      1,0
images au sol     62                        ← la chute sismique se déclenche
images en cachette 45                       ← on entre et on ressort
images sur pont   148                       ← on monte, on marche, on redescend
jeunes max        12
JEUNES BLOQUÉS    0                         ← le correctif tient
morts             2 (dont une chute à −191 m, sous le fond du monde)
```

Trois bugs ont été trouvés et corrigés par cette vérification, tous invisibles à
la lecture :

1. **Le bundle ne démarrait pas du tout** : les imports sur plusieurs lignes
   n'étaient pas reconnus par le bundler et restaient tels quels.
2. **Cinq `const` déclarés deux fois** dans `monde/index.js` une fois bundlé
   (un module qui importe *et* ré-exporte le même nom) — `SyntaxError`.
3. **Le vent et la neige n'agissaient plus sur l'odeur** : la décroissance des
   traces était appelée à deux endroits, et celle qui portait le vent recevait
   `dt = 0`.

Plus deux corrections trouvées à la relecture : une file d'attente qui débordait
silencieusement (écriture hors bornes d'un `Int32Array`, ignorée par JavaScript)
et des gouffres convertis deux fois en cellules, qui sortaient à 17 × 7 m.

## 3bis. CORRECTIONS APRÈS RETOUR

### Le menu de départ ne se laissait pas cliquer

Signalé : « le clic pour ouvrir le jeu ne fonctionne pas depuis le menu ».
Diagnostiqué avec `elementFromPoint` sur la page réelle en headless, plutôt que
deviné. **Deux défauts distincts**, tous deux confirmés :

1. **Le clic droit ne faisait rien.** Un événement `click` n'est jamais émis
   pour le bouton secondaire — il faut écouter `contextmenu`.
2. **Le clic gauche ne marchait que sur `#mJouer`.** Le relevé donnait, au
   centre exact de l'écran, `button.mo` : le milieu de la page — l'endroit où
   l'on clique naturellement — est occupé par la rangée d'onglets. Cliquer « au
   milieu » changeait donc d'onglet au lieu de lancer. Et le voile porte
   `cursor:pointer` sur toute sa surface : il promettait d'être cliquable
   partout sans l'être.

Corrigé : tout le voile lance la partie, au clic gauche comme au clic droit, et
`Entrée` ou `Espace` aussi. Les onglets et les panneaux Réglages / Collection
sont exclus, et on ne lance que depuis l'onglet « Descendre » — sinon relâcher
un curseur hors de sa piste démarrerait la partie. Le menu contextuel du clic
droit est supprimé, en jeu comme au menu.

Deux défauts trouvés en passant :

- `requestPointerLock` peut légitimement échouer (le navigateur impose un délai
  après un `exitPointerLock`). Le rejet n'était pas traité : promesse rejetée
  dans la console et menu qui a l'air cassé. C'est désormais annoncé à l'écran.
- **Les touches de jeu agissaient depuis le menu.** `Espace` y lançait un
  leurre dans un monde qu'on ne regarde pas — et c'est précisément la touche qui
  doit démarrer la partie. `R` reste volontairement accessible depuis le menu.

Vérifié en headless : les 8 gestes qui doivent lancer lancent, les 4 qui ne
doivent rien faire ne font rien.

## 4. À FAIRE

### De ton côté

- **Remplir les dossiers de cartes** — `cartes/communes/`, `cartes/rares/`,
  `cartes/legendaires/`, fichiers `1.gif`, `2.gif`… Le jeu tourne avec des
  cartes procédurales en attendant.
- **Équilibrage à la manette.** Les valeurs sont posées avec cohérence mais
  jouées seulement par un robot. À surveiller en priorité :
  fog à 2,625 (visibilité ~15 m, peut-être trop court à ton goût) · vitesse de
  perte de chaleur par biome · fréquence des effondrements · nombre de cachettes
  (16 sur 1 632 m — peu, volontairement).

### Ce qui n'est pas fait

- **Le rendu n'a pas été vu.** WebGL est simulé dans le test ; les shaders
  compilent en théorie mais personne n'a regardé l'écran. À faire au premier
  lancement : yeux visibles de loin, godrays rouges, interstices qui s'éteignent
  en poursuite.
- **Pas d'audio réellement écouté.** Le graphe se construit sans erreur, mais la
  nappe n'a pas été entendue. Les niveaux peuvent demander un ajustement.
- Les cartes PNG dessinées dans RELEVÉ ne reçoivent ni gouffres ni falaises
  marquées (par choix : ton relief reste le tien), mais elles reçoivent ponts et
  cachettes.
- `monde/relief.js` sait faire des éboulis, mais un effondrement ne perce pas
  encore de nouveau passage — il ne fait que soulever le sol et poser des
  gravats.

---

# Historique

## v2 — moteur monofichier

Archivée dans `archives/scoleopandre2-monofichier.html`. WebGL2 brut, 2 846
lignes, 5 biomes, IA à croyance et directeur de pression, nappes ambient
génératives, streaming de pavés, cartes à collectionner, éditeur de relevé.

## v1

Archivée dans `archives/scoleopandre.html`.
