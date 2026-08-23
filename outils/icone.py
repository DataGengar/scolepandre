#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ICÔNE — dessine `icon.ico`.

    python outils/icone.py

Un mille-pattes stylisé, blanc sur le bleu nuit de la charte : une épine
courbe, ses anneaux, et deux yeux rouges. Vu à 16 px il ne reste que la courbe
et les deux points rouges — c'est le but. Une icône se reconnaît à sa
silhouette et à sa tache de couleur, pas à ses détails.

Généré plutôt que dessiné à la main pour que l'icône reste dans le dépôt sous
forme de code : trente lignes lisibles valent mieux qu'un binaire opaque qu'on
n'ose plus toucher.
"""

import math
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Pillow est nécessaire :  pip install pillow")
    sys.exit(1)

RACINE = Path(__file__).resolve().parent.parent

FOND  = (13, 17, 23, 255)        # #0d1117
CORPS = (201, 209, 217, 255)     # #c9d1d9
PATTE = (125, 133, 144, 255)     # #7d8590
OEIL  = (248, 81, 73, 255)       # #f85149
ACCENT= (31, 111, 235, 255)      # #1f6feb


def dessiner(n=512):
    """Dessine à `n` pixels ; les tailles d'icône en sont rééchantillonnées."""
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    u = n / 512.0                      # tout est exprimé en 512e

    # pastille de fond, légèrement arrondie
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(96 * u), fill=FOND,
                        outline=ACCENT, width=max(1, int(8 * u)))

    # l'épine : une sinusoïde qui traverse en diagonale
    SEG = 46
    pts = []
    for i in range(SEG + 1):
        t = i / SEG
        x = 78 + t * 356
        y = 300 - t * 118 + math.sin(t * 5.4) * 62
        pts.append((x * u, y * u))

    # pattes : deux traits par anneau, plus courtes vers la queue
    for i in range(2, SEG - 1, 2):
        x, y = pts[i]
        px, py = pts[i - 1]
        nx, ny = pts[i + 1]
        # normale à la tangente
        tx, ty = nx - px, ny - py
        L = math.hypot(tx, ty) or 1
        tx, ty = -ty / L, tx / L
        lg = (58 - 30 * (i / SEG)) * u
        w = max(1, int(7 * u))
        d.line([x - tx * lg, y - ty * lg, x, y], fill=PATTE, width=w)
        d.line([x + tx * lg, y + ty * lg, x, y], fill=PATTE, width=w)

    # le corps : des disques dégressifs, du plus gros (tête) au plus fin
    for i, (x, y) in enumerate(pts):
        t = i / SEG
        r = (34 - 20 * t) * u
        d.ellipse([x - r, y - r, x + r, y + r], fill=CORPS)

    # les yeux, sur la tête (le premier point)
    hx, hy = pts[0]
    ro = 9 * u
    for dx in (-13 * u, 13 * u):
        d.ellipse([hx + dx - ro, hy - 8 * u - ro, hx + dx + ro, hy - 8 * u + ro],
                  fill=OEIL)
    return im


def main():
    grand = dessiner(512)
    cible = RACINE / "icon.ico"
    tailles = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    grand.save(cible, format="ICO", sizes=tailles)
    (RACINE / "lanceur" / "icone.png").write_bytes(b"")   # placeholder remplacé
    grand.resize((256, 256), Image.LANCZOS).save(RACINE / "lanceur" / "icone.png")
    print("écrit :", cible, "·", ", ".join("%dx%d" % t for t in tailles))
    print("écrit :", RACINE / "lanceur" / "icone.png")


if __name__ == "__main__":
    main()
