# -*- mode: python ; coding: utf-8 -*-
"""
RECETTE PYINSTALLER — Scolopandre.exe

    python outils/construire_exe.py          (recommandé : vérifie avant)
    pyinstaller Scolopandre.spec --noconfirm --distpath application --workpath build

── POURQUOI --distpath application ───────────────────────────────────────────
PyInstaller écrit dans `dist/` par défaut. Or `dist/scolopandre.html` est le
fichier jouable du dépôt, suivi par git : le laisser faire l'écraserait. La
sortie va donc dans `application/`, qui est ignoré par git.

── ONEDIR, PAS ONEFILE ───────────────────────────────────────────────────────
`--onefile` produit un exécutable unique élégant, mais qui se dézippe dans un
dossier temporaire à CHAQUE lancement : quatre à six secondes d'attente pour
5 Mo de données de jeu, et un chemin qui change à chaque fois. Le mode dossier
démarre instantanément et laisse `src/` lisible à côté de l'exécutable — ce qui
est exactement ce qu'on veut d'un banc d'essai : pouvoir corriger un module et
relancer sans reconstruire.
"""

from PyInstaller.utils.hooks import collect_submodules

# ── ce que PyInstaller embarque : l'icone, et rien d'autre ──
#
# Les donnees du jeu ne passent PAS par ici. PyInstaller 6 range tout ce qu'on
# lui confie dans un sous-dossier `_internal/`, ou personne n'ira jamais
# regarder. Or le propre d'un banc d'essai est qu'on puisse ouvrir `src/`,
# corriger un module et relancer sans reconstruire.
#
# `outils/construire_exe.py` les copie donc A PLAT a cote de l'executable,
# juste apres l'empaquetage. Le dossier construit ressemble alors au depot,
# ce qui est la seule disposition qu'on n'ait pas a expliquer.
donnees = [
    ("icon.ico", "."),
]

a = Analysis(
    ["lancer.py"],
    pathex=["."],
    binaries=[],
    datas=donnees,
    hiddenimports=collect_submodules("lanceur"),
    hookspath=[],
    runtime_hooks=[],
    # Rien de scientifique dans le lanceur : numpy et scipy ne servent qu'au
    # pipeline OBJ (outils/build.py), qu'on ne lance pas depuis l'application.
    # Sans cette exclusion l'exécutable pèse 300 Mo au lieu de 20.
    excludes=["numpy", "scipy", "matplotlib", "PIL", "pandas", "pytest",
              "IPython", "notebook", "setuptools", "pip"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Scolopandre",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,          # fenêtré : pas de console noire derrière la fenêtre
    icon="icon.ico",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="Scolopandre",
)
