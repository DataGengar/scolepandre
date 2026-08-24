# WHAT'S NEW

Suivi de l'évolution du projet.

---

# v5 — 24 août 2026 · le terrain devient procédural, et les hitbox deviennent honnêtes

Trois demandes : *« il faut qu'on parte en procédural pour le terrain »*, *« je
suis souvent bloqué entre 2 objets et le R de déblocage ne change rien »*, et
*« les hitbox sont trop grosses et ne correspondent pas à l'objet qu'elles
contiennent »*.

## 1. LE TERRAIN N'EST PLUS CREUSÉ, IL EST ÉCHANTILLONNÉ

La v4 posait **300 rectangles** de salle, 90 blobs de caverne, et les reliait
par des **couloirs en L**. Le maillage avait beau déplacer chaque coin d'un
bruit, ça ne rattrapait rien : un rectangle a quatre angles droits, un couloir
en L en a deux, et l'œil lit la RÈGLE avant de lire le lieu. Les aperçus
étaient sans appel — sol parfaitement plan, murs d'aplomb à intervalles
réguliers, plafond en caissons.

La v5 renverse le procédé. Le monde est **deux champs continus** évalués en
tout point de la planche (`src/noyau/bruit.js`, `src/monde/generation.js`) :

- l'**altitude** du sol, écrite partout, roche comprise. Une seule surface,
  continue : une galerie qui débouche dans une salle arrive au bon niveau, sans
  marche de raccord. Elle est faite d'une descente d'ensemble (le barrage au
  fond, la surface au jour), de quatre octaves de relief, et de **failles** —
  un bruit de crête franchi d'un coup, qui y taille de vrais à-pics ;
- la **roche** : les galeries sont les **lignes de crête** d'un bruit *ridged*.
  Un bruit ordinaire donne des taches ; un bruit de crête donne des lignes qui
  serpentent, se divisent et se rejoignent. C'est un réseau, pas un gruyère.

Le tout est évalué dans un **domaine déformé** : rien n'est aligné sur les
axes, les strates se plissent, une galerie ne part jamais droit.

Les grandes cavités sont ensuite *repérées* dans le champ (et non plus posées),
chaînées par altitude et reliées par des galeries sinueuses : c'est l'épine, le
chemin garanti du fond jusqu'au jour.

**Ce qui n'a pas bougé** : la grille, la stratigraphie par altitude, les
gouffres, les ponts, les villages, le décor, la navigation, et le PLAN de
l'éditeur, qui garde le dernier mot sur le biome comme sur la cote.

### Six pannes trouvées en mesurant, toutes muettes

Aucune ne se voyait à l'écran. Chacune a demandé un chiffre, et deux d'entre
elles une image — c'est pour ça que `outils/carte_monde.py` existe.

- **Le bruit n'était pas calibré.** Une somme d'octaves normalisée tient dans
  [−1,1] mais ne les remplit pas : écart-type mesuré, **0,20**. Toutes les
  amplitudes valaient donc cinq fois moins que ce qu'elles annonçaient, et la
  première version du terrain sortait un monde plat. `fbm2` est désormais
  calibré à écart-type 1, et un réglage en mètres veut enfin dire des mètres.
- **La relaxation saturait en silence.** Son garde-fou coupait la boucle avant
  la fin et laissait **2 778 marches infranchissables** sans un mot. Elle est
  refaite : le problème est un plus court chemin à poids constant, donc des
  seaux suffisent, chaque cellule est réglée une fois, et il n'y a plus de
  garde-fou à régler. **12,1 s → 0,2 s**, zéro marche restante.
- **Les galeries de perçage coupaient le monde.** `percerEnclaves` posait
  l'altitude de sa galerie par interpolation linéaire, et l'écrivait **sur des
  cellules déjà creusées** : là où elle croisait le réseau, elle laissait une
  marche en travers. Mesuré graine 1 : **76,5 %** du sol praticable dans un
  seul morceau. La galerie part maintenant du terrain, ne touche jamais à une
  cellule acquise, rabote son profil en deux passes, et **renonce** si le tracé
  est trop court pour le dénivelé. → **98,2 %**.
- **Un élément massif dans un boyau est un mur.** Un pilier posé au milieu
  d'une galerie de deux cellules de large condamne tout ce qu'il y a derrière.
  Invisible en v4, dont les couloirs étaient larges ; fatal sur un réseau de
  galeries. Mesuré : le décor à lui seul faisait tomber la part du monde
  atteignable à pied de **99,6 % à 65 %** — un monde sur trois avait sa
  surface entière, la destination du jeu, condamnée par quelques piliers tombés
  au mauvais endroit. On ne les pose plus là (`SETUP.decor.rayonBouchon`,
  `ouvertureMassif`), et le décor perd 20 % de ses éléments sans qu'on voie la
  différence.
- **Le dehors se décrochait du monde.** En relaxant le souterrain et pas la
  surface, on abaisse d'un côté de la lisière et pas de l'autre : il se forme
  une marche tout du long, et le dehors devient une île. On relaxe donc un
  **ourlet** de vingt-deux cellules côté ciel — assez pour recoudre, trop peu
  pour raboter les à-pics du grand dehors.
- **`?graine=` n'était jamais lu.** `apercu.py --graine 7` annonçait une graine
  depuis des mois et photographiait un monde différent à chaque lancement :
  deux captures censées comparer deux réglages comparaient deux mondes. Le jeu
  lit la graine dans l'URL.

### Mesuré (3 mondes, `outils/diag_passage.py`)

| | v4 | v5 |
|---|---|---|
| part du sol praticable dans un seul morceau | 98,5 % | **99,2 %** (98,4 à 99,6) |
| morceaux significatifs inatteignables | 1,3 | **1,0** |
| part de la planche creusée | ~9 % | 24 % |
| durée de génération | 0,1 s | 1,4 s |

Le chemin pour y arriver vaut la peine d'être noté, parce qu'il a été
entièrement piloté par la mesure : 88,6 % au premier jet, toujours 88,6 %
après avoir corrigé la relaxation, **76,5 %** sur le pire monde, **65 %** en
cherchant pourquoi — puis 99,2 % une fois les trois vraies causes trouvées.
Trois fois sur trois, l'hypothèse de départ était fausse et le chiffre l'a
dit.

## 2. LES HITBOX ÉPOUSENT ENFIN L'OBJET

Un élément de décor — dix, vingt parts — recevait **un seul cercle**, de rayon
égal à sa part la plus large, plafonné à 1,40 m, posé au sol, sans hauteur.
D'où : une poutre suspendue à quatre mètres qui bloque au niveau du sol, un
lampadaire qui bloque sur le rayon de sa crosse, une voiture couchée qui bloque
un disque d'1,40 m alors qu'elle est longue et étroite.

Chaque **part** a maintenant sa hitbox, en forme de **capsule** — un segment,
un rayon, et l'étage qu'elle occupe (`capsulePart`, dans `monde/formes.js`). Un
mur de 5 m sur 26 cm devient un segment de 4,74 m et 13 cm de rayon, et non un
disque de 2,50 m. Et parce que la capsule connaît sa hauteur : **on enjambe ce
qui est sous le pas, on passe sous ce qui est au-dessus de la tête** — en
rampant, sous ce qu'on ne franchit pas debout.

| | v4 | v5 |
|---|---|---|
| rayon médian d'une hitbox | 0,68 m | **0,07 m** |
| part du sol occupée par une hitbox | 10,1 % | **7,4 %** |
| points de sol pris À L'INTÉRIEUR d'un objet | **13,6 %** | **6,5 %** |

Une case de sol sur sept était donc dans une hitbox invisible. C'est ça, « on
se cogne partout ».

## 3. ON NE SE FAIT PLUS PINCER, ET LE « R » DÉGAGE VRAIMENT

Deux causes distinctes, deux corrections.

**Le pincement.** Le déplacement était testé axe par axe : si X et Z étaient
tous deux refusés — ce qui arrive dès qu'on aborde un obstacle de biais — on
s'arrêtait net. Entre deux objets, les deux axes sont refusés en permanence.
Le relief garde ce test (il est aligné sur la grille, on y glisse déjà) ; les
**éléments, eux, ne bloquent plus : ils repoussent**. On avance, puis on sort
le joueur de ce qu'il chevauche, le long de la normale. Deux objets serrés le
recrachent d'un côté au lieu de le pincer, et aborder un tronc de biais fait
glisser dessus sans une ligne de plus.

**Le « R » qui ne changeait rien.** Il changeait pourtant quelque chose : il
posait le joueur sur la cellule libre **la plus proche** — c'est-à-dire, quand
on est pincé entre deux troncs, sur l'autre case du même pincement. Une cellule
d'accueil doit désormais offrir une **issue** : on compte, autour d'elle,
combien des huit directions laissent réellement partir, et en dessous de cinq
sur huit ce n'est pas un dégagement, c'est un autre piège.

| | v4 | v5 |
|---|---|---|
| déblocages qui laissent vraiment repartir | **67,8 %** | **99,3 %** |

(sur 154 dégagements tentés en v4 et 324 en v5 ; en ne comptant que les points
où l'on peut réellement se tenir, l'échantillon tombe à quelques dizaines et
l'écart reste le même, 27 % contre 95 %.)

## 4. TROIS OUTILS DE PLUS

- **`outils/carte_monde.py`** — la planche vue d'en haut, en une image : la
  matière (ce qui est creusé, par biome), le relief ombré, et **ce qu'on peut
  atteindre à pied** (vert : la composante principale ; rouge : coupé du
  monde). C'est ce troisième panneau qui a trouvé la galerie fautive en une
  image, après deux heures de chiffres qui ne disaient rien.
- **`outils/diag_collision.py`** — se cogne-t-on, et le « R » dégage-t-il ? Il
  sonde des dizaines de milliers de points avec le vrai code de collision,
  compte les pièges, tente un déblocage sur chacun, et sait lire les hitbox de
  la v4 comme celles de la v5 — c'est ce qui rend le tableau ci-dessus
  comparable.
- **`diag_passage.py`** a été corrigé au passage : sa classification des
  frontières sautait le cas intéressant (un voisin praticable DANS la
  composante principale, c'est-à-dire une marche) et concluait donc
  invariablement « de la roche non creusée ». La bonne classification vit
  maintenant dans `carte_monde.py`.

## 5. CE QUI RESTE

- Le **frottement** est monté : 9,8 % des points de sol n'offrent que une à
  trois issues sur huit, contre 4,5 % en v4 — et c'est le TERRAIN, pas le
  décor. La mesure sépare les deux (une seconde passe, index de collision
  vidé) : le relief seul en explique 9,8 sur 9,8. Un réseau de galeries est
  plus étroit qu'une enfilade de salles. À juger à la manette : si c'est
  pénible, `SETUP.terrain.seuilGalerie` est le curseur — et élargir les
  galeries a été essayé, ça n'a rien changé au frottement et ça a creusé 15 %
  de monde en plus.
- Les **gouffres** restent des ellipses régulières : sur la carte du monde, ils
  se lisent comme des pastilles. `monde/relief.js` n'a pas été touché.
- **Maisons et huttes n'ont toujours aucune collision** : on les traverse. Les
  rendre solides est facile maintenant que les hitbox suivent les parts, mais
  ça change la circulation dans les villages — à faire volontairement, pas en
  passant.

---

# v3.4 — 23 août 2026 · l'application, et la forge pour de vrai

Deux demandes : le style d'Héphaïstos, et un `.exe` pour tester. La seconde a
entraîné la troisième — une fois qu'un serveur local sert le jeu, la forge peut
enfin écrire dedans.

## SCOLOPANDRE.EXE

```sh
python outils/construire_exe.py     # → application/Scolopandre/Scolopandre.exe
```

Une fenêtre sombre : **JOUER**, **Ouvrir la forge**, les vérifications, et une
console. 27 Mo, démarre en une seconde, aucune dépendance à installer.

**Pourquoi une fenêtre plutôt qu'un raccourci.** Un raccourci suffirait à
jouer ; il ne suffit pas à *rapporter*. Quand le monde ne se génère pas ou que
le rendu se fige, il faut pouvoir dire quoi, et avoir une trace à recopier. La
console est le vrai contenu de la fenêtre.

**Pourquoi un serveur.** Le jeu est fait de modules ES ; un navigateur refuse
`import` depuis `file://`. Écoute sur 127.0.0.1 uniquement, premier port libre
à partir de 8757, sans cache.

**Pourquoi Chrome en `--app`.** pywebview, c'est 150 Mo de dépendances et un
WebGL en retard. Electron, c'est réécrire l'empaquetage. Chrome en mode
application donne une fenêtre sans barre d'adresse, avec le WebGL du jour, pour
zéro dépendance. Profil dédié sous `%LOCALAPPDATA%`, donc pas d'extensions dans
la page et un `localStorage` qui survit.

Deux pannes trouvées en le construisant, toutes deux invisibles :

- l'entrée `lanceur/__main__.py` faisait un **import relatif**, ce qui ne marche
  pas pour un script d'entrée gelé. En mode fenêtré, l'exécutable disparaissait
  sans un mot. `lancer.py` importe en absolu **et** emballe tout : la trace part
  désormais dans `panne.log` et dans une boîte de dialogue.
- PyInstaller 6 range les données dans `_internal/`. Le contrôle de fin de
  construction l'a attrapé — il est là pour ça : une donnée oubliée produit un
  exécutable qui démarre très bien et affiche une fenêtre vide.

Les données du jeu sont copiées **à plat** à côté de l'exécutable : le dossier
construit ressemble au dépôt, et on peut corriger un module puis relancer sans
reconstruire.

## LE STYLE D'HÉPHAÏSTOS

Palette « Rich Black » (`#0d1117` / `#161b22`), accent bleu `#58a6ff`,
logotype à deux lignes dont le sous-titre est inter-lettré à la largeur du nom,
libellés de section sur filet, console à six niveaux colorés. Les noms sont
ceux d'Héphaïstos — `PANEL_BG`, `SECTION`, `MAGIC`, `LOG_COLORS` — pour que
passer d'un projet à l'autre ne demande aucune traduction.

Trois exemplaires de la même charte : `ui/theme.py` chez Héphaïstos,
`src/editeur/theme.css` pour la forge, `lanceur/theme.py` pour le banc d'essai.

**Le jeu garde sa palette os-et-vide.** C'est une direction artistique, pas une
charte d'interface ; habiller un jeu d'horreur en bleu GitHub le tuerait.

## LA FORGE ÉCRIT DANS LE JEU

C'était le défaut de fond de la v3.3 : la forge produisait un extrait à
recopier soi-même dans `props.js`. On le fait une fois. À la dixième, on ne le
fait plus, et l'outil ne sert à rien.

Le serveur du lanceur expose des routes `/_forge/…`. **`Écrire dans props.js`**
pose l'élément directement dans le jeu — le bouton n'apparaît que si
l'application tourne.

Le serveur ne réécrit pas le fichier : il remplace **un** `case` du `switch`, en
comptant les accolades et en sautant chaînes et commentaires. Sauvegarde
horodatée avant chaque écriture, refus si le fichier n'est plus équilibré après
coup, refus de tout chemin sortant du projet.

**Et le dernier maillon** : `Semer` inscrit l'élément dans la liste `props` des
biomes choisis, dans `biomes.js`. Sans ça, un `case` fraîchement écrit ne serait
jamais appelé — le générateur tire au sort dans cette liste, et on chercherait
son objet en croyant à un défaut de génération. La chaîne va donc maintenant de
bout en bout : composer → écrire → semer → jouer.

## CINQ PRIMITIVES AU LIEU DE DEUX

Le décor n'avait que la boîte et le prisme. Assez pour bâtir, pas pour
sculpter — d'où les monolithes qui restaient des boîtes et les gravats qui
ressemblaient à des dés.

| forme | triangles | pour quoi |
|---|---|---|
| **coin** | 8 | toits, rampes, éboulis, appuis |
| **plaque** | 4 | panneaux, planches — *les objets fins demandés en v3.2* |
| **roche** | 20 / 80 | la seule forme sans arêtes vives du moteur |

Et le **lacet** `ry` : jusqu'ici une boîte ne pouvait que s'incliner, jamais
pivoter autour de la verticale. Impossible de poser une caisse de biais ou
d'orienter une maison autrement que face au nord. On composait tout sur les
axes, et ça se voyait.

Le vocabulaire descend dans `src/monde/formes.js` : `props.js` en a besoin pour
mesurer, la forge encore plus, et brancher la mesure avait créé un cycle
d'import.

**Un gaspillage trouvé au passage.** Une primitive qui veut un triangle passait
un quad dont le 4ᵉ point est le 1ᵉʳ. Les deux émetteurs produisaient quand même
deux triangles, dont un d'aire nulle — invisible, mais assemblé et rastérisé.
La moitié du coût de chaque roche, de chaque bouchon de tube du monde entier.
Corrigé : une comparaison par quad.

## LES MODIFICATEURS

C'est ce qui sépare un empilement de blocs d'un outil de composition. Une
grille de barreaux, une cage thoracique, une palissade, un tas d'éboulis : ces
objets ont une **règle**, et la décrire pièce par pièce revient à copier-coller
sa propre règle à la main.

```
base ─▶ miroir ─▶ réseau ×8 ─▶ bruit ─▶ ce qu'on voit
```

**Miroir · Réseau · Radial · Dispersion · Bruit.** La base reste modifiable :
change une dimension, les quarante copies suivent. L'ordre compte.
`Figer la pile` transforme le résultat en nouvelle base.

Tout tirage se fait sur une graine locale — un asset est identique d'une
session à l'autre, et régler un modificateur ne décale pas le monde.

## LE RESTE DE LA FORGE

- **glisser une pièce dans la vue** : le bouton gauche orbite s'il tombe dans le
  vide, déplace s'il tombe sur une pièce (`MAJ` pour la hauteur). Le curseur est
  projeté sur un plan, pas converti depuis des pixels — sinon l'objet décroche
  dès qu'on change de zoom ;
- **un champ où taper la valeur exacte** à côté de chaque curseur. Un curseur
  suffit pour chercher une valeur, pas pour en poser une ;
- **bibliothèque** de plusieurs éléments par projet, piles conservées ;
- **sélection multiple**, au clic dans la vue 3D comme dans la liste, la
  sélection surlignée en bleu ;
- **annulation** `Ctrl+Z` / `Ctrl+Y`, magnétisme 5 cm, déplacement aux flèches ;
- **conversion** d'une forme à l'autre en gardant position et taille ;
- **silhouette de 1,75 m** — sans repère on modélise des portes de trois mètres
  sans s'en apercevoir ;
- **éclairage « jeu »** — une seule lampe à l'œil, sombre. Un caillou magnifique
  en studio peut être une tache noire dans un souterrain ;
- **budget de triangles**, `confortable` / `tendu` / `lourd` ;
- **console** dans la forge aussi : la génération dit ce qu'elle fait, et
  **prévient si une zone du plan n'a produit aucune cellule de sol** — ce que
  rien à l'écran ne montrerait.

## VÉRIFICATION

Deux tests neufs.

`outils/smoke_formes.py` contrôle les cinq primitives sommet par sommet. Une
primitive fausse ne lève aucune exception : elle produit une forme qui « rend
bizarre » dans le noir, une fois sur cinquante.

```
forme            tri   dit  boîte englobante    rayon
bloc              12    12  2.00×4.00×1.00      1.000
bloc+lacet        12    12  1.00×4.00×2.00      1.118
coin               8     8  2.00×1.00×3.00      1.500
plaque             4     4  1.20×0.80×0.00      0.600
tube              22    22  0.55×2.00×0.55      0.300
roche             20    20  0.97×0.92×0.79      0.630
roche+sub         80    80  1.02×1.03×1.09      0.630
roche reproductible : identique=oui, différente si autre graine=oui
lacet 90° : 4,00×0,50 → 0,50×4,00
```

`outils/smoke_pont.py` est le seul qui prouve que la forge sert à quelque
chose : il compose un élément dans un vrai navigateur, l'écrit dans une copie
du projet, relit le fichier et revérifie sa syntaxe.

```
composé : 1 base → 7 parts, 84 triangles, confortable
écriture 1 : ajouté     écriture 2 : remplacé     écriture 3 : ajouté
props.js contient 23 case · les deux éléments sont présents
nom invalide refusé · 3 sauvegardes · syntaxe ok
```

Ces tests ont trouvé quatre vrais défauts : les comptes de triangles annoncés
étaient faux pour trois formes sur cinq, `etenduePart()` sous-estimait les
formes inclinées, les quads dégénérés doublaient le coût, et **le rayon de
sélection partait vers +Z alors que la caméra regarde vers −Z** — cliquer sur
un objet n'aurait jamais rien sélectionné, sans que rien à l'écran ne
l'explique.

## CE QUI RESTE

- **Ni le rendu ni l'audio n'ont encore été vus.** WebGL est simulé dans tous
  les tests. C'est la limite de fond du dispositif.
- L'onglet TERRAIN n'a toujours pas de prévisualisation 3D navigable.
- La mère ne monte pas sur les passerelles (navigation à un seul niveau).

---

# v3.3 — 23 août 2026 · l'éditeur

`editeur.html`, à côté de `index.html`. Il tourne **sur le moteur du jeu** :
mêmes shaders, mêmes primitives, même code de génération.

## LA FONDATION : LE PLAN

`src/monde/plan.js`. C'est la couche qui manquait — jusqu'ici le monde était
entièrement décidé par la stratigraphie, on pouvait régler des nombres mais pas
dire « ICI, c'est une glacière ».

Un plan est une liste de **zones**. Chacune dit, pour ce qu'elle couvre :
quel **biome** (ou `auto`), quelle **altitude** (avec pente), **ce qu'on a le
droit d'y générer** — décor, lumières, gouffres, ponts, cachettes, villages,
cartes, créatures — et à quelle **densité**.

La dernière zone tracée l'emporte, comme des calques. **Hors zone, rien ne
change** : un plan vide n'a strictement aucun effet, ce qui garantit que
l'éditeur ne casse rien tant qu'on ne s'en sert pas.

Sept modules du générateur le consultent : `generation`, `relief`, `villages`,
`cachettes`, `ponts`, `props`, `carte/placement`.

## LES TROIS ONGLETS

**TERRAIN** — une carte de dessus. Le monde fait 1,6 km et son relief va de
−131 à +137 m : le poser à la main en 3D serait interminable. Ce qu'on veut
décider, ce n'est pas la forme du terrain — le générateur la fabrique bien —
c'est *où se trouve quoi*. `Générer un aperçu` lance la vraie génération et
photographie le résultat en couleurs de biome ; `Jouer ce monde` ouvre le jeu,
qui relit le plan tout seul.

**ASSETS** — composer un élément de décor, en 3D temps réel. Deux entrées :
partir de primitives (`bloc`, `tube`), ou **charger un élément du jeu**. Dans ce
second cas l'éditeur appelle la vraie fonction `addProp()` dans un bac à sable et
récupère la géométrie produite : c'est l'élément tel qu'il apparaît en partie,
pas une imitation. `Copier le code` sort un extrait prêt à coller dans
`monde/props.js`.

**CRÉATURE** — il n'y a volontairement pas de modeleur : le scolopandre n'est pas
un maillage, c'est un algorithme. Son corps est reconstruit à chaque image à
partir de sa trace et d'une quarantaine de paramètres. L'onglet expose ces
nombres et rejoue le vrai code de `creatures/geometrie.js`.

Un bug trouvé en construisant l'onglet : `C_SEG`, `C_RING` et `C_PAIRES` étaient
lus **une seule fois à l'import**. Les curseurs d'anatomie ne faisaient donc
rien. Relus à chaque image — vérifié, 6 904 → 5 144 triangles quand on ramène
les anneaux de 64 à 24.

## VÉRIFICATION

`outils/smoke_editeur.py` joue une séance complète en headless. Le test qui
compte est celui-ci — un éditeur qui dessine sans que le générateur suive ne
sert à rien :

```
zone tracée : glacière, 557 × 520 cellules, villages interdits
  cellules de sol dans la zone    : 33 367
  dont du biome imposé            : 33 367  (100,0 %)
  villages tombés dans la zone    : 0
  villages ailleurs               : 7
  21 types d'éléments testés      : tous produisent de la géométrie
  projet enregistré puis relu     : identique
```

## AU PASSAGE

`outils/verifier.py` ne connaissait qu'un point d'entrée et prenait tout
`src/editeur/` pour du code mort. Il en connaît deux maintenant — ce qui a
révélé quatre valeurs de `SETUP` déclarées mais jamais lues
(`lampe.gainEteinte`, `jeunes.peurDuFeu`, `villages.safeChaleur`,
`feu.rayonFusee`). Elles étaient doublées en dur ailleurs. Toutes branchées, et
`feu.portéeRepulsion` supprimée puisque `jeunes.peurDuFeu` la remplace — la
distance à laquelle une bête recule est une propriété de la bête, pas du feu.

## CE QUI RESTE

- **Ni le rendu ni l'audio n'ont encore été vus.** WebGL est simulé dans les
  tests.
- L'onglet TERRAIN n'a pas de prévisualisation 3D navigable : on passe par
  `Jouer ce monde`.
- L'éditeur d'assets ne sait pas encore écrire dans `props.js` tout seul : il
  produit un extrait à coller.

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
