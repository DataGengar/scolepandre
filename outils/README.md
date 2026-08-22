# outils/ — la boîte à outils

    python -m http.server 8000        # puis http://localhost:8000

| outil | ce qu'il fait |
|---|---|
| `verifier.py` | **à lancer avant chaque commit** — cohérence du projet |
| `syntaxe.py` | équilibre des délimiteurs dans tous les `.js` |
| `smoke.py` | **exécute vraiment le jeu** dans Chrome headless, sans GPU |
| `bundler.py` | `src/` → `dist/scoleopandre.html`, fichier unique |
| `exporter_biomes.py` | `biomes.js` → `biomes.json`, pour l'éditeur |
| `releve.html` | l'éditeur de carte (dessine un PNG, glisse-le dans le jeu) |
| `build.py`, `scolo_pipeline.py`, `make_test_level.py` | pipeline OBJ → navigation (hors jeu) |

## Le rituel avant de pousser

    python outils/syntaxe.py
    python outils/verifier.py
    python outils/smoke.py
    python outils/bundler.py

`smoke.py` est le plus utile : il lance le jeu pour de vrai avec un faux WebGL,
joue 30 secondes tout seul (marche, leurre, cachette, effondrement, froid
extrême, régénération) et rapporte la moindre exception. Il affiche aussi ce
qui a été **traversé** — paliers de froid, états de la créature, jeunes
bloqués — ce qui vaut bien mieux qu'un simple « ça n'a pas planté ».

## Ce que verifier.py contrôle

1. imports vers un symbole non exporté
2. `export let` réassigné (marche en modules ES, **casse dans le bundle**)
3. clés de `SETUP` jamais lues
4. curseurs pointant vers une clé inexistante
5. `biomes.json` désynchronisé de `biomes.js`
6. modules que personne n'importe
