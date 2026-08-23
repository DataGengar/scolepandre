#!/usr/bin/env python3
"""
GABARIT_CARTE — fabrique des cartes d'essai pour voir ce que le moteur rend.

    python outils/gabarit_carte.py

Écrit un jeu de cartes de démonstration dans cartes/communes, rares et
legendaires. Elles reprennent la mise en page d'une vraie carte à
collectionner — le format que le moteur attend :

    · rapport 3:4 portrait (768 × 1024)
    · un LISERÉ BLANC de découpe autour du sujet, comme un sticker
    · des coins arrondis
    · un fond en dégradé, plus clair vers le sujet
    · un grain léger, qui casse les aplats et évite le banding

Le fond est teinté selon le rang : gris pour commune, bleu pour rare, ambre
pour légendaire. Le sujet est une silhouette géométrique — l'idée n'est pas de
faire un beau dessin, c'est de vérifier que le moteur affiche correctement le
cadrage, la transparence, les mipmaps et la lisibilité dans la brume.

POUR METTRE TES PROPRES CARTES : remplace simplement les fichiers. Le jeu sonde
1.png, 2.png… dans chaque dossier, jusqu'à trois manquants d'affilée.

PRÉFÈRE LE PNG : le GIF n'a qu'un bit de transparence et déchiquette les coins
arrondis. Si tu tiens au GIF, change `ext` dans src/carte/rangs.js.
"""

import math
import random
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    raise SystemExit("Pillow est nécessaire :  pip install Pillow")

RACINE = Path(__file__).resolve().parent.parent
L, H = 768, 1024                       # 3:4, le format d'une carte
MARGE = 54                             # le liseré blanc de découpe
RAYON = 46                             # coins arrondis

RANGS = [
    ("communes",    (58, 60, 66),   (128, 132, 140), 4),
    ("rares",       (34, 58, 84),   (86, 158, 214),  3),
    ("legendaires", (78, 58, 22),   (232, 176, 72),  2),
]


def fond(sombre, clair):
    """Dégradé radial décentré, comme un éclairage de studio."""
    img = Image.new("RGB", (L, H), sombre)
    px = img.load()
    cx, cy = L * 0.5, H * 0.38
    rmax = math.hypot(L, H) * 0.62
    for y in range(H):
        for x in range(0, L, 2):        # une colonne sur deux, puis on lisse
            t = max(0.0, 1.0 - math.hypot(x - cx, y - cy) / rmax)
            t = t * t
            c = tuple(int(sombre[i] + (clair[i] - sombre[i]) * t * 0.55) for i in range(3))
            px[x, y] = c
            if x + 1 < L:
                px[x + 1, y] = c
    return img.filter(ImageFilter.GaussianBlur(1.2))


def sujet(d, clair, cotes):
    """
    Une silhouette géométrique centrée. Volontairement abstraite : ce gabarit
    sert à régler le moteur, pas à décorer.
    """
    cx, cy = L / 2, H * 0.46
    r = L * 0.30
    pts = [(cx + math.cos(a) * r * (1 + 0.16 * math.sin(a * cotes)),
            cy + math.sin(a) * r * 1.28 * (1 + 0.10 * math.cos(a * cotes)))
           for a in [i / 160 * math.tau for i in range(160)]]
    d.polygon(pts, fill=tuple(int(c * 0.45) for c in clair))
    # Pillow 8 n'accepte pas `width` sur polygon() : on trace le contour à part
    d.line(pts + [pts[0]], fill=clair, width=5, joint="curve")
    # quelques facettes, pour qu'il y ait du détail à filtrer par les mipmaps
    for k in range(cotes * 2):
        a0 = k / (cotes * 2) * math.tau
        d.line([cx, cy,
                cx + math.cos(a0) * r * 0.92,
                cy + math.sin(a0) * r * 1.18],
               fill=tuple(min(255, int(c * 1.25)) for c in clair), width=3)
    d.ellipse([cx - r * 0.22, cy - r * 0.26, cx + r * 0.22, cy + r * 0.26],
              fill=tuple(min(255, int(c * 1.5)) for c in clair))


def grain(img, force=7):
    px = img.load()
    for y in range(0, H, 2):
        for x in range(0, L, 2):
            n = random.randint(-force, force)
            r, g, b = px[x, y]
            px[x, y] = (max(0, min(255, r + n)),
                        max(0, min(255, g + n)),
                        max(0, min(255, b + n)))
    return img


def masque_arrondi(w, h, r):
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    return m


def carte(sombre, clair, cotes, numero):
    interieur = fond(sombre, clair)
    d = ImageDraw.Draw(interieur)
    sujet(d, clair, cotes)

    # une bande en bas, où poser un titre si tu en veux un
    d.rectangle([0, H - 150, L, H], fill=tuple(int(c * 0.55) for c in sombre))
    d.line([60, H - 150, L - 60, H - 150], fill=clair, width=3)
    for k in range(numero):
        d.ellipse([60 + k * 34, H - 96, 84 + k * 34, H - 72], fill=clair)

    interieur = grain(interieur)

    # le liseré blanc de découpe, comme un sticker
    fondu = Image.new("RGBA", (L, H), (0, 0, 0, 0))
    fondu.paste((250, 250, 252, 255), (0, 0, L, H),
                masque_arrondi(L, H, RAYON))
    iw, ih = L - MARGE * 2, H - MARGE * 2
    petit = interieur.resize((iw, ih))
    fondu.paste(petit, (MARGE, MARGE), masque_arrondi(iw, ih, int(RAYON * 0.62)))

    # coins arrondis sur l'ensemble : le fond reste transparent
    sortie = Image.new("RGBA", (L, H), (0, 0, 0, 0))
    sortie.paste(fondu, (0, 0), masque_arrondi(L, H, RAYON))
    return sortie


def main():
    random.seed(7)
    total = 0
    for dossier, sombre, clair, cotes in RANGS:
        d = RACINE / "cartes" / dossier
        d.mkdir(parents=True, exist_ok=True)
        combien = {"communes": 4, "rares": 3, "legendaires": 2}[dossier]
        for n in range(1, combien + 1):
            img = carte(sombre, clair, cotes + n % 3, n)
            chemin = d / f"{n}.png"
            # PNG et pas GIF : le GIF n'a qu'UN BIT de transparence, ce qui
            # déchiquette les coins arrondis et le liseré de découpe. Le PNG a
            # un vrai canal alpha, dont le moteur se sert pour découper la
            # carte (voir le `discard` dans rendu/carte-rendu.js).
            img.save(chemin)
            total += 1
            print(f"  {chemin.relative_to(RACINE)}")
    print(f"\n  {total} cartes d'essai écrites.")
    print("  Remplace-les par les tiennes : mêmes noms, même format 3:4.\n")


if __name__ == "__main__":
    main()
