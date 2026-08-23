# lanceur/ — le banc d'essai

```sh
python -m lanceur                    # en développement
python outils/construire_exe.py      # → application/Scolopandre/Scolopandre.exe
```

Une fenêtre sombre avec trois boutons et une console. C'est ce que devient
`Scolopandre.exe`.

| fichier | rôle |
|---|---|
| `lanceur.py` | la fenêtre, et rien d'autre |
| `theme.py` | la palette d'Héphaïstos, en Python |
| `serveur.py` | le serveur HTTP local |
| `navigateur.py` | Chrome ou Edge en fenêtre d'application |
| `forge.py` | le pont qui laisse la forge écrire dans le jeu |

## Pourquoi une fenêtre plutôt qu'un raccourci

Un raccourci qui ouvre le navigateur suffirait à **jouer**. Il ne suffit pas à
**rapporter**. Quand le monde ne se génère pas, qu'une zone du plan reste vide
ou que le rendu se fige, il faut pouvoir dire quoi — et avoir une trace à
recopier. La console est le vrai contenu de cette fenêtre ; les boutons ne font
que la remplir.

Les vérifications sont là pour la même raison : `Cohérence du code` et
`Test de fumée` répondent à « est-ce mon installation ou le jeu ? » avant même
d'avoir lancé une partie.

## Pourquoi un serveur

Le jeu est fait de modules ES. Un navigateur refuse `import` depuis `file://` —
tous les fichiers du disque y partagent une origine « nulle ». Ouvrir
`index.html` directement donne une page noire et une erreur CORS.

Le serveur n'écoute que sur `127.0.0.1`, sur le premier port libre à partir de
8757, et sert sans cache — sinon on débogue un module qu'on vient de corriger
mais que le navigateur n'a pas relu.

## Pourquoi Chrome en mode `--app`

Le jeu est du WebGL2 : il lui faut un moteur web. Restait à choisir la fenêtre.

| voie | verdict |
|---|---|
| pywebview / Qt WebEngine | vraie fenêtre native, mais 150 Mo de dépendances et un WebGL souvent en retard |
| Electron / Tauri | il faudrait réécrire tout l'empaquetage en JS |
| **Chrome `--app`** | fenêtre sans barre d'adresse ni onglets, zéro dépendance, le WebGL du jour |

Le compromis : Chrome ou Edge doit être installé — sur Windows, Edge l'est
toujours. Sinon on retombe sur le navigateur par défaut, dans un onglet
ordinaire.

Le profil du navigateur est à nous, sous `%LOCALAPPDATA%\Scolopandre\`. Sans
ça, si Chrome tourne déjà, il ouvre la fenêtre dans le processus existant et
rend la main aussitôt — on ne peut plus savoir si le jeu est ouvert. En prime,
aucune extension ne s'injecte dans la page, et le `localStorage` du jeu
(réglages, collection, plan de la forge) survit aux nettoyages du navigateur.
`Effacer les données du navigateur` supprime ce dossier : c'est le premier
réflexe quand un état enregistré empêche le jeu de démarrer.

## Le pont de la forge

`forge.py` expose quelques routes `/_forge/…` qui permettent à l'éditeur, qui
tourne dans une page, d'écrire sur le disque. Sans elles, la forge ne pouvait
que produire un extrait à recopier soi-même — ce qu'on fait une fois, puis
plus jamais.

`enregistrer_prop()` ne réécrit pas `src/monde/props.js` : il remplace **un**
`case` du `switch`, en comptant les accolades (et en sautant chaînes et
commentaires) pour trouver sa fin. Il refuse d'écrire si le fichier n'est plus
équilibré après coup.

Garde-fous : tout chemin est résolu et doit rester sous la racine du projet,
seules quelques extensions sont acceptées en écriture, une copie horodatée part
dans `.sauvegardes/` avant chaque écriture (les vingt dernières sont gardées),
et le contenu est plafonné. Ce n'est pas une protection contre un attaquant —
il faudrait déjà être sur ce poste — c'est une protection contre une faute de
frappe.

**Ces routes n'existent que si l'application tourne.** Ouvrir `editeur.html`
par un `python -m http.server` reste parfaitement valable : la forge détecte
l'absence du pont, masque le bouton d'écriture, et retombe sur le
presse-papiers.

## Les outils, lancés dans le processus

Les boutons de vérification exécutent les scripts d'`outils/` par `runpy`,
**dans le processus du lanceur**, pas en appelant `python outils/…`. Une fois
empaqueté il n'y a plus de `python.exe` : `sys.executable` désigne
l'exécutable lui-même. Passer par `runpy` fait marcher les outils à
l'identique en développement et dans l'application — ce qui est exactement la
propriété qu'on attend d'un banc d'essai.

Leur sortie est redirigée ligne par ligne vers la console, colorée d'après ce
qu'elle dit. Grossier — c'est de la coloration de prose — mais suffisant : ce
qu'on veut voir d'un coup d'œil, c'est s'il y a du rouge.

## L'empaquetage

`Scolopandre.spec`, en mode **dossier** et non fichier unique : `--onefile` se
dézippe dans un dossier temporaire à chaque lancement, soit plusieurs secondes
d'attente pour 5 Mo de données de jeu.

PyInstaller n'embarque que l'icône. Les données du jeu sont copiées **à plat**
à côté de l'exécutable par `construire_exe.py`, et non dans le `_internal/` où
PyInstaller 6 range ce qu'on lui confie — parce que le propre d'un banc
d'essai est qu'on puisse ouvrir `src/`, corriger un module et relancer sans
reconstruire. Le dossier construit ressemble au dépôt.

La sortie va dans `application/` et non `dist/`, qui contient déjà le fichier
jouable du dépôt.

`construire_exe.py` vérifie le dossier construit à la fin. Ce n'est pas
décoratif : une donnée oubliée produit un exécutable qui démarre très bien et
affiche une fenêtre vide.

## Si l'exécutable ne démarre pas

Il est construit en mode fenêtré : sans console, une exception au démarrage le
ferait disparaître sans un mot. `lancer.py` emballe donc tout — la trace part
dans `panne.log`, à côté de l'exécutable, **et** dans une boîte de dialogue.
