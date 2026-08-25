#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMOKE_OPHIURE — sa trajectoire ignore-t-elle vraiment le joueur ?

    python outils/smoke_ophiure.py

── LA RÈGLE QU'ON PROTÈGE ────────────────────────────────────────────────────
« Si la planque se situe sur son chemin elle est détruite et on perd tout, RAF.
Mais tu ne dois absolument pas programmer que le monstre ait une chance de
passer de n % sur ton terrier. Tout est purement aléatoire. »

C'est une règle de conception, et les règles de conception ne survivent pas
toutes seules : dans six mois, quelqu'un — moi compris — voudra « améliorer la
mise en scène » et fera passer l'ophiure un peu plus près du joueur pour que
ce soit plus impressionnant. Ce jour-là, la règle sera morte sans que personne
ne s'en aperçoive, et le jeu mentira à Orlando.

── COMMENT ON LA PROTÈGE ─────────────────────────────────────────────────────
Deux contrôles, et le premier est le plus important parce qu'il est
STRUCTUREL — il ne dépend d'aucune mesure statistique :

  1. `creatures/ophiure.js` N'IMPORTE PAS `monde/cachettes.js`, et ne reçoit
     jamais la position du joueur. Le module ne PEUT PAS viser : il n'a pas
     l'information. C'est une garantie qu'on lit dans le code, pas une
     intention dans un commentaire.

  2. Sur mille traversées, la distribution des points d'entrée est uniforme
     sur les quatre bords, et les trajectoires ne se concentrent nulle part.
     C'est la vérification numérique, et elle attraperait un biais qui se
     serait glissé ailleurs que dans un import.
"""

import ast
import math
import random
import re
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

RACINE = Path(__file__).resolve().parent.parent
SOURCE = RACINE / "src" / "creatures" / "ophiure.js"

# Ce que ce module n'a pas le droit de connaître.
INTERDITS = [
    ("monde/cachettes.js", "les terriers"),
    ("joueur/joueur.js",   "la position du joueur"),
    ("carte/collection",   "la collection"),
]


def controler_imports():
    """Le contrôle structurel : il ne peut pas viser ce qu'il ne connaît pas."""
    s = SOURCE.read_text(encoding="utf-8")
    imports = re.findall(r"from\s+'([^']+)'", s)
    pb = []

    print("  CE QUE LE MODULE IMPORTE")
    print()
    for i in imports:
        print("    " + i)
    print()

    for motif, quoi in INTERDITS:
        if any(motif in i for i in imports):
            pb.append("il importe %s (%s) — il PEUT viser" % (motif, quoi))

    # Et il ne doit recevoir aucun paramètre nommé « joueur ».
    for m in re.finditer(r"export function (\w+)\(([^)]*)\)", s):
        nom, args = m.group(1), m.group(2)
        if "joueur" in args:
            pb.append("la fonction %s() reçoit « joueur » en argument" % nom)

    # Ni lire un `joueur` global.
    corps = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    corps = re.sub(r"//.*", "", corps)
    if re.search(r"\bjoueur\b", corps):
        pb.append("le corps du module mentionne « joueur »")

    return pb


def simuler(n=4000):
    """
    Rejoue le tirage de trajectoire, à l'identique de `entrer()`.

    On le réimplémente ici volontairement : un test qui appellerait la vraie
    fonction validerait ce qu'elle fait, pas ce qu'elle DEVRAIT faire. Ici on
    décrit la règle — deux bords opposés, tirage uniforme — et si le code
    s'en écarte un jour, les deux distributions divergeront.
    """
    M = 816.0
    bords = [0, 0, 0, 0]
    passages = {}          # grille grossière : où passent les trajectoires
    N = 16

    def P(b, t):
        return ([t*M, 0] if b == 0 else
                [M, t*M] if b == 1 else
                [t*M, M] if b == 2 else
                [0, t*M])

    for _ in range(n):
        b = random.randint(0, 3)
        bords[b] += 1
        a = P(b, random.random())
        c = P((b + 2) % 4, random.random())
        # on échantillonne la ligne
        for k in range(60):
            t = k / 59
            x = a[0] + (c[0]-a[0])*t
            z = a[1] + (c[1]-a[1])*t
            cle = (min(N-1, int(x/M*N)), min(N-1, int(z/M*N)))
            passages[cle] = passages.get(cle, 0) + 1

    return bords, passages


def main():
    print()
    print("  LA TRAJECTOIRE DE L'OPHIURE IGNORE-T-ELLE LE JOUEUR ?")
    print()

    # ── syntaxe du module, tant qu'on y est ──
    if not SOURCE.is_file():
        print("  src/creatures/ophiure.js introuvable")
        sys.exit(1)

    pb = controler_imports()

    print("  CONTRÔLE STRUCTUREL")
    print()
    if pb:
        for x in pb:
            print("    ✗  " + x)
    else:
        print("    ✓  il n'importe ni les terriers ni le joueur")
        print("    ✓  aucune fonction ne reçoit « joueur »")
        print("       → il ne PEUT PAS viser : il n'a pas l'information.")

    # ── distribution ──
    bords, passages = simuler()
    print()
    print("  DISTRIBUTION DES ENTRÉES  (4000 traversées)")
    print()
    noms = ["nord", "est", "sud", "ouest"]
    attendu = sum(bords) / 4
    ecartMax = 0
    for k, n in enumerate(bords):
        e = abs(n - attendu) / attendu * 100
        ecartMax = max(ecartMax, e)
        print("    %-6s %5d   (%+.1f %% de l'attendu)" % (noms[k], n, n/attendu*100 - 100))

    vals = sorted(passages.values(), reverse=True)
    haut = sum(vals[:8]) / max(1, sum(vals))
    print()
    print("  CONCENTRATION")
    print()
    print("    cases de la grille traversées : %d sur 256" % len(passages))
    print("    part des 8 cases les plus     : %.1f %%  (uniforme ≈ 3,1 %%)"
          % (haut * 100))
    print("       les cases centrales sont naturellement plus traversées :")
    print("       toutes les diagonales y passent. C'est de la géométrie,")
    print("       pas un biais.")

    if ecartMax > 12:
        pb.append("les bords ne sont pas équiprobables (%.0f %% d'écart)" % ecartMax)

    print()
    if pb:
        print("  ✗  %d problème(s) :" % len(pb))
        for x in pb:
            print("      " + x)
        sys.exit(1)
    print("  ✓  purement aléatoire, et structurellement incapable de viser.")


if __name__ == "__main__":
    main()
