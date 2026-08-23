#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CONSTRUIRE_EXE — fabrique `application/Scolopandre/Scolopandre.exe`.

    python outils/construire_exe.py
    python outils/construire_exe.py --rapide     (saute les vérifications)

Enchaîne, dans l'ordre :

  1. les vérifications de cohérence — construire un exécutable à partir d'un
     code cassé ne fait que déplacer le problème plus loin dans la journée ;
  2. l'icône ;
  3. le fichier unique `dist/scolopandre.html`, embarqué pour dépanner ;
  4. PyInstaller ;
  5. un contrôle de ce qui est réellement arrivé dans le dossier de sortie.

L'étape 5 n'est pas décorative : une donnée oubliée dans le `.spec` produit un
exécutable qui démarre très bien et affiche une fenêtre vide. On préfère
l'apprendre ici.
"""

import shutil
import subprocess
import sys
import time
from pathlib import Path

# La console Windows est en cp1252 : sans ca, le premier filet Unicode fait
# planter le script avant meme d'avoir construit quoi que ce soit.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

RACINE = Path(__file__).resolve().parent.parent
SORTIE = RACINE / "application" / "Scolopandre"

# Ce qui doit se trouver dans le dossier construit, sans quoi l'application
# démarre mais ne sert rien.
ATTENDU = [
    "Scolopandre.exe",
    "index.html",
    "editeur.html",
    "src/jeu.js",
    "src/setup.js",
    "src/editeur/editeur.js",
    "src/editeur/theme.css",
    "outils/verifier.py",
]

# Dossiers qui doivent exister ET ne pas être vides. Exiger un NOM de fichier
# précis a cassé la construction le jour où les vraies cartes sont arrivées :
# elles s'appellent carte_045.png, pas 1.png. C'est le dossier qui compte.
ATTENDU_NON_VIDE = ["cartes/communes", "cartes/rares", "cartes/legendaires"]


def titre(t):
    print()
    print("  " + t)
    print("  " + "─" * (len(t) + 2))


def executer(argv, nom):
    t0 = time.time()
    p = subprocess.run(argv, cwd=str(RACINE))
    dt = time.time() - t0
    if p.returncode:
        print("\n  ÉCHEC : %s (code %d)" % (nom, p.returncode))
        sys.exit(p.returncode)
    print("  %s : %.1f s" % (nom, dt))


# Les dossiers et fichiers du jeu, posés à plat à côté de l'exécutable.
# Volontairement pas dans `_internal/` : on veut pouvoir ouvrir src/, corriger
# un module et relancer. Voir l'en-tête de Scolopandre.spec.
A_COPIER = ["index.html", "editeur.html", "README.md", "WHATS_NEW.md",
            "src", "cartes", "outils", "dist"]

# Ce qui n'a rien à faire dans une application livrée.
REBUTS = {"__pycache__", ".git", "nav_out", "_smoke.html", "_diag.html"}


def copier_donnees():
    def filtrer(dossier, noms):
        return [n for n in noms if n in REBUTS or n.endswith(".pyc")]

    total = 0
    for nom in A_COPIER:
        src = RACINE / nom
        dst = SORTIE / nom
        if not src.exists():
            print("    (absent, ignoré) " + nom)
            continue
        if src.is_dir():
            shutil.copytree(src, dst, dirs_exist_ok=True, ignore=filtrer)
            n = sum(1 for f in dst.rglob("*") if f.is_file())
            print("    %-14s %d fichiers" % (nom, n))
            total += n
        else:
            shutil.copy2(src, dst)
            print("    %-14s" % nom)
            total += 1
    print("  %d fichiers copiés" % total)


def main():
    rapide = "--rapide" in sys.argv
    py = sys.executable

    if not rapide:
        titre("1 · VÉRIFICATIONS")
        executer([py, "outils/syntaxe.py"], "syntaxe")
        executer([py, "outils/verifier.py"], "cohérence")
    else:
        print("\n  (vérifications sautées)")

    titre("2 · ICÔNE")
    executer([py, "outils/icone.py"], "icône")

    titre("3 · FICHIER UNIQUE")
    executer([py, "outils/bundler.py"], "bundle")

    titre("4 · PYINSTALLER")
    if SORTIE.exists():
        shutil.rmtree(SORTIE, ignore_errors=True)
    executer([py, "-m", "PyInstaller", "Scolopandre.spec", "--noconfirm",
              "--distpath", "application", "--workpath", "build",
              "--log-level", "WARN"], "empaquetage")

    titre("5 · COPIE DES DONNÉES DU JEU")
    copier_donnees()

    titre("6 · CONTRÔLE DU DOSSIER CONSTRUIT")
    manque = [r for r in ATTENDU if not (SORTIE / r).exists()]
    for d in ATTENDU_NON_VIDE:
        p = SORTIE / d
        if not p.is_dir():
            manque.append(d + "  (dossier absent)")
        elif not any(p.iterdir()):
            manque.append(d + "  (dossier vide)")
    if manque:
        print("  MANQUANT dans %s :" % SORTIE)
        for m in manque:
            print("    ·", m)
        print("\n  Ajoute-le aux `donnees` de Scolopandre.spec.")
        sys.exit(1)

    total = sum(f.stat().st_size for f in SORTIE.rglob("*") if f.is_file())
    nb = sum(1 for f in SORTIE.rglob("*") if f.is_file())
    print("  %d fichiers · %.1f Mo" % (nb, total / 1e6))
    for r in ATTENDU:
        print("    ok  " + r)
    for d in ATTENDU_NON_VIDE:
        print("    ok  %-22s %d fichiers"
              % (d, sum(1 for _ in (SORTIE / d).iterdir())))

    print()
    print("  ✓  " + str(SORTIE / "Scolopandre.exe"))
    print()
    print("     Le dossier entier est l'application : on le déplace d'un bloc,")
    print("     ou on le compresse pour l'envoyer ailleurs.")


if __name__ == "__main__":
    main()
